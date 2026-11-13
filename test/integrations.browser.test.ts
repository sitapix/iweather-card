import { afterEach, expect, test, vi } from 'vitest';
import '../src/iweather-card.ts';
import type { ForecastSubscription, HomeAssistant } from '../src/card/home-assistant.ts';
import type { IWeatherCard } from '../src/iweather-card.ts';
import { ENTITY, INTEGRATIONS, hassOf, type Integration } from './integrations.ts';

// The card as it ships, on each integration's entity and forecasts as Home Assistant sends them:
// it draws without an error, and no tile or sheet writes a value it doesn't have.
const BROKEN = /\bNaN\b|\bundefined\b|\bnull\b|\[object|Infinity/;

function hassWith(integration: Integration): HomeAssistant {
  return {
    ...hassOf(integration),
    connection: {
      subscribeMessage(callback: (message: unknown) => void, message: ForecastSubscription) {
        const forecast = integration.sent[message.forecast_type] ?? [];
        queueMicrotask(() => {
          callback({ forecast });
        });
        return Promise.resolve(() => undefined);
      },
    },
  };
}
// Each integration is shown in the units it sends, and in the other system's, as the card can be set to.
const UNITS = {
  us: {
    temperature_unit: '°F',
    wind_speed_unit: 'mph',
    pressure_unit: 'inHg',
    distance_unit: 'mi',
    precipitation_unit: 'in',
  },
  metric: {
    temperature_unit: '°C',
    wind_speed_unit: 'km/h',
    pressure_unit: 'hPa',
    distance_unit: 'km',
    precipitation_unit: 'mm',
  },
};
const PASSES = (integration: Integration) =>
  [
    ['its own units', {}],
    [integration.units === 'us' ? 'metric units' : 'US units', UNITS[integration.units === 'us' ? 'metric' : 'us']],
  ] as const;
async function mount(integration: Integration, units: object): Promise<IWeatherCard> {
  const card = document.createElement('iweather-card');
  card.style.cssText = 'display:block;width:1100px';
  card.setConfig({
    type: 'custom:iweather-card',
    entity: ENTITY,
    weather_layout: 'page',
    open_meteo_forecast: false,
    weather_animation: false,
    weather_scene: false,
    map: 'none',
    ...units,
  });
  card.hass = hassWith(integration);
  document.body.replaceChildren(card);
  await vi.waitFor(() => {
    expect(card.root.querySelectorAll('.tile[data-tile]').length).toBeGreaterThan(1);
  });
  return card;
}
const words = (node: Element) => node.textContent;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

for (const integration of INTEGRATIONS) {
  for (const [shown, units] of PASSES(integration))
    test(`${integration.name}: every tile and its sheet draw what it sends, in ${shown}`, async () => {
      vi.useFakeTimers({ now: integration.now, toFake: ['Date'] });
      const errors = vi.spyOn(console, 'error');
      const card = await mount(integration, units);
      expect(words(card.parts.weather)).not.toMatch(BROKEN);
      const tiles = [...card.root.querySelectorAll<HTMLElement>('.tile[data-detail]')].map(
        tile => tile.dataset['tile'],
      );
      for (const id of tiles) {
        const tile = card.root.querySelector<HTMLElement>(`.tile[data-detail][data-tile=${id ?? ''}]`);
        if (!tile) continue;
        // A press lands on a tile on the screen, and the page is taller than this window.
        tile.scrollIntoView({ block: 'center' });
        tile.click();
        const dialog = card.root.querySelector('dialog[open]');
        expect(dialog, `${id ?? ''} opens a sheet`).toBeTruthy();
        if (dialog instanceof HTMLDialogElement) {
          expect(words(dialog), id).not.toMatch(BROKEN);
          dialog.close();
        }
      }
      // And a day's.
      const day = card.root.querySelector<HTMLElement>('.day[data-key]');
      if (day) {
        day.scrollIntoView({ block: 'center' });
        day.click();
        const dialog = card.root.querySelector('dialog[open]');
        if (dialog instanceof HTMLDialogElement) {
          expect(words(dialog), 'a day').not.toMatch(BROKEN);
          dialog.close();
        }
      }
      expect(errors).not.toHaveBeenCalled();
      card.remove();
    });
}
