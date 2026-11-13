import { test as base, expect, type Locator } from '@playwright/test';
import type { ForecastSubscription, HomeAssistant } from '../../src/card/home-assistant.ts';
import { openDashboard } from '../card.ts';
import { type Recording, recording } from '../recordings.ts';

// How the card looks, picture by picture: the built file on the stubbed dashboard e2e/card.ts
// serves, with its stand-ins answering what the card asks beyond Home Assistant, showing
// recordings from test/integrations at the time each was made. Every picture is the same from run
// to run on one machine: the clock is stopped, the sky and its motion are off, there is no map,
// the window is one size, and the type is the one the other tests set.

// The weather the card is given, as the page is passed it.
interface Weather {
  state: string;
  attributes: Readonly<Record<string, unknown>>;
  forecasts: Readonly<Record<string, unknown>>;
  place: { latitude: number; longitude: number; timeZone: string };
  // Whether the sun was up, then and there.
  sun: 'above_horizon' | 'below_horizon';
  settings: Readonly<Record<string, unknown>>;
}
const SETTINGS = {
  type: 'custom:iweather-card',
  entity: 'weather.home',
  weather_layout: 'page',
  weather_animation: false,
  weather_scene: false,
  map: 'none',
  // The recording's own forecast, as it sent it.
  open_meteo_forecast: false,
};

// Runs in the page, so it can use nothing from this module: only what it is passed.
function mount(weather: Weather) {
  const hass: HomeAssistant = {
    states: {
      'weather.home': { entity_id: 'weather.home', state: weather.state, attributes: { ...weather.attributes } },
      'sun.sun': { entity_id: 'sun.sun', state: weather.sun, attributes: {} },
    },
    language: 'en',
    locale: { language: 'en', time_format: '12' },
    config: {
      location_name: 'Home',
      time_zone: weather.place.timeZone,
      latitude: weather.place.latitude,
      longitude: weather.place.longitude,
    },
    connection: {
      subscribeMessage(callback: (message: unknown) => void, message: ForecastSubscription) {
        const forecast = weather.forecasts[message.forecast_type];
        queueMicrotask(() => {
          callback({ forecast: Array.isArray(forecast) ? forecast : [] });
        });
        return Promise.resolve(() => undefined);
      },
    },
  };
  const card = document.createElement('iweather-card');
  card.style.cssText = 'display:block;max-width:1100px';
  card.setConfig(weather.settings);
  card.hass = hass;
  document.body.replaceChildren(card);
}

type Sun = Weather['sun'];
// The card showing a recording, drawn and settled. Anything going wrong on its page, before the
// picture or after, fails the test.
const test = base.extend<{ show: (played: Recording, sun: Sun) => Promise<Locator> }>({
  show: async ({ page }, use) => {
    let faults: readonly string[] = [];
    await use(async (played, sun) => {
      faults = await openDashboard(page, played.now);
      await page.evaluate(mount, {
        state: played.state,
        attributes: played.attributes,
        forecasts: played.forecasts,
        place: { latitude: played.latitude, longitude: played.longitude, timeZone: played.timeZone },
        sun,
        settings: SETTINGS,
      });
      const card = page.locator('iweather-card');
      await expect(card.locator('.tile[data-tile]').nth(1)).toBeVisible();
      // Every font it asked for has loaded.
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      return card;
    });
    expect(faults).toEqual([]);
  },
});

// The box around every tile on the page. The tiles have no box of their own, as they share one grid
// with the hourly and daily panels, so it is the box around the whole grid.
async function aroundTiles(card: Locator) {
  const boxes = await card.locator('.tile[data-tile], .forecast, .daily').evaluateAll(tiles =>
      tiles.flatMap(tile => {
        const { left, top, right, bottom, width } = tile.getBoundingClientRect();
        return width > 0
          ? [{ left: left + scrollX, top: top + scrollY, right: right + scrollX, bottom: bottom + scrollY }]
          : [];
      }),
    ),
    x = Math.floor(Math.min(...boxes.map(box => box.left))),
    y = Math.floor(Math.min(...boxes.map(box => box.top)));
  return {
    x,
    y,
    width: Math.ceil(Math.max(...boxes.map(box => box.right))) - x,
    height: Math.ceil(Math.max(...boxes.map(box => box.bottom))) - y,
  };
}

const SHOTS: readonly { file: string; sun: Sun }[] = [
  { file: 'met.live', sun: 'below_horizon' },
  { file: 'nws.live.us', sun: 'above_horizon' },
  { file: 'open_meteo.live', sun: 'above_horizon' },
  { file: 'zamg.live', sun: 'below_horizon' },
];

for (const { file, sun } of SHOTS) {
  const played = recording(file);
  test.describe(file, () => {
    test.use({ timezoneId: played.timeZone });
    test('its tiles', async ({ show, page }) => {
      const card = await show(played, sun);
      await expect(page).toHaveScreenshot(`${file}-tiles.png`, { fullPage: true, clip: await aroundTiles(card) });
    });
  });
}

test.describe('met.live, more closely', () => {
  const played = recording('met.live');
  test.use({ timezoneId: played.timeZone });

  test('its hours', async ({ show }) => {
    const card = await show(played, 'below_horizon');
    await expect(card.locator('.forecast')).toHaveScreenshot('met.live-hours.png');
  });

  test('a tile’s sheet', async ({ show }) => {
    const card = await show(played, 'below_horizon');
    await card.locator('.tile[data-tile=humidity]').click();
    const dialog = card.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Past its opening, which scales it.
    await dialog.evaluate(node =>
      Promise.all(
        [node, ...node.querySelectorAll('*')]
          .flatMap(each => each.getAnimations())
          .map(animation => animation.finished),
      ),
    );
    await expect(dialog).toHaveScreenshot('met.live-sheet.png');
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test('the whole card', async ({ show }) => {
      const card = await show(played, 'below_horizon');
      await expect(card).toHaveScreenshot('met.live-phone.png');
    });
  });
});
