import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import '../src/iweather-card.ts';
import type { ForecastEntry, ForecastSubscription, HomeAssistant } from '../src/card/home-assistant.ts';
import type { IWeatherCard } from '../src/iweather-card.ts';
import type { SheetId } from '../src/cards/ids.ts';

// The full page with a forecast like most entities send: two days of hours, six days, and neither
// a chance nor a gust among them. A chance of 40% every hour and 70% every day shows what filled it.
const NOW = Date.UTC(2026, 9, 27, 17, 30),
  HOUR = 3_600_000,
  DAY = 24 * HOUR,
  MIDNIGHT = Date.UTC(2026, 9, 26, 5),
  ZONE = 'America/Chicago';
const start = Math.floor(NOW / HOUR) * HOUR;
const hoursOf = (count: number, entry: ForecastEntry = {}): ForecastEntry[] =>
  Array.from({ length: count }, (_, i) => ({
    datetime: new Date(start + i * HOUR).toISOString(),
    temperature: 66,
    condition: 'cloudy',
    wind_speed: 6,
    wind_bearing: 200,
    uv_index: 2,
    humidity: 60,
    pressure: 1012,
    precipitation: 0,
    ...entry,
  }));
const daysOf = (count: number, entry: ForecastEntry = {}): ForecastEntry[] =>
  Array.from({ length: count }, (_, i) => ({
    datetime: new Date(NOW + i * DAY).toISOString(),
    temperature: 68,
    templow: 50,
    condition: 'cloudy',
    precipitation: 0.3,
    wind_speed: 6,
    ...entry,
  }));
const body = () => {
  const hours = Array.from({ length: 288 }, (_, i) => MIDNIGHT / 1000 + i * 3600),
    days = Array.from({ length: 12 }, (_, i) => MIDNIGHT / 1000 + i * 86400);
  return {
    hourly: {
      time: hours,
      precipitation_probability: hours.map(() => 40),
      wind_gusts_10m: hours.map(() => 9),
      wind_speed_10m: hours.map(() => 4),
      wind_direction_10m: hours.map(() => 180),
      apparent_temperature: hours.map(() => 17),
      dew_point_2m: hours.map(() => 9),
      visibility: hours.map(() => 16000),
      precipitation: hours.map(() => 0),
      snowfall: hours.map(() => 0),
      weather_code: hours.map(() => 3),
      temperature_2m: hours.map(() => 18),
      cloud_cover: hours.map(() => 90),
    },
    daily: {
      time: days,
      weather_code: days.map(() => 3),
      temperature_2m_max: days.map(() => 20),
      temperature_2m_min: days.map(() => 10),
      precipitation_sum: days.map(() => 0),
      precipitation_probability_max: days.map(() => 70),
      wind_speed_10m_max: days.map(() => 6),
      wind_gusts_10m_max: days.map(() => 12),
      sunrise: days.map(time => time + 7 * 3600),
      sunset: days.map(time => time + 18 * 3600),
    },
  };
};
const hassWith = (
  hourly: readonly ForecastEntry[],
  daily: readonly ForecastEntry[],
  latitude = 41.9,
): HomeAssistant => ({
  states: {
    'weather.home': {
      entity_id: 'weather.home',
      state: 'cloudy',
      attributes: {
        temperature: 66,
        temperature_unit: '°F',
        wind_speed: 6,
        wind_bearing: 200,
        wind_speed_unit: 'mph',
        precipitation_unit: 'in',
        visibility_unit: 'mi',
        attribution: 'The entity’s own words.',
        friendly_name: 'Chicago',
        supported_features: 3,
      },
    },
    'sun.sun': { entity_id: 'sun.sun', state: 'above_horizon', attributes: { elevation: 38, rising: false } },
  },
  locale: { language: 'en', time_format: '12' },
  config: { time_zone: ZONE, latitude, longitude: -87.6 },
  connection: {
    subscribeMessage(callback: (message: unknown) => void, message: ForecastSubscription) {
      queueMicrotask(() => {
        callback({ forecast: message.forecast_type === 'hourly' ? hourly : daily });
      });
      return Promise.resolve(() => undefined);
    },
  },
});
function page(hass: HomeAssistant, extra: object = {}, beforeMount?: (card: IWeatherCard) => void): IWeatherCard {
  const card = document.createElement('iweather-card');
  card.style.cssText = 'display:block;width:1100px';
  card.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    weather_animation: false,
    ...extra,
  });
  card.hass = hass;
  beforeMount?.(card);
  document.body.replaceChildren(card);
  return card;
}
const rows = (card: IWeatherCard) => card.root.querySelectorAll('.day');
const text = (card: IWeatherCard, selector: string) => card.root.querySelector(selector)?.textContent ?? '';
const link = (card: IWeatherCard) => card.root.querySelector<HTMLAnchorElement>('.credit-link');
const settled = () => new Promise(resolve => setTimeout(resolve, 40));
const asked = vi.fn((_url: string | Request) =>
  Promise.resolve<{ ok: boolean; status?: number; json(): Promise<unknown> }>({
    ok: true,
    json: () => Promise.resolve(body()),
  }),
);
// The map's loader asks with a Request, and the forecast with its address.
const addressOf = (url: string | Request) => (typeof url === 'string' ? url : url.url);
const forecastCalls = () => asked.mock.calls.filter(([url]) => addressOf(url).includes('daily=')).length;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  asked.mockReset();
  vi.stubGlobal('fetch', asked);
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

test('changing a setting rebuilds the preview with its known cloud cover from the first paint', async () => {
  const partly = body();
  partly.hourly.cloud_cover = partly.hourly.time.map(() => 75);
  asked.mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve(partly) }));
  const fixture = hassWith(hoursOf(48), daysOf(6)),
    home = fixture.states['weather.home'];
  if (!home) throw new Error('No weather entity.');
  const hass = { ...fixture, states: { ...fixture.states, 'weather.home': { ...home, state: 'windy' } } },
    first = page(hass, { weather_animation: true });
  await vi.waitFor(() => {
    expect(first.scene.preset?.kind).toBe('mostlyCloudyLowAltitude');
    expect(first.scene.outgoing).toBeNull();
  });
  const painted: { kind: string | undefined; transitioning: boolean }[] = [];
  let latest = first;
  for (const settings of [{ low_power: true }, { show_high_low: false }, { glass_refraction: false }]) {
    painted.length = 0;
    const next = page(hass, { weather_animation: true, ...settings }, card => {
      const { scene } = card,
        paint = scene.paint.bind(scene);
      vi.spyOn(scene, 'paint').mockImplementation((...args) => {
        painted.push({ kind: scene.preset?.kind, transitioning: scene.outgoing !== null });
        paint(...args);
      });
    });
    await settled();
    next.setConfig({ ...next.config, show_name: false });
    await settled();
    expect(next.animating).toBe(true);
    expect(next.scene.preset?.kind).toBe('mostlyCloudyLowAltitude');
    expect(painted.length).toBeGreaterThan(0);
    expect(painted.filter(frame => frame.kind !== 'mostlyCloudyLowAltitude' || frame.transitioning)).toEqual([]);
    latest = next;
  }
  expect(forecastCalls()).toBe(1);
  // A real weather change still transitions while the scene animates.
  latest.hass = { ...hass, states: { ...hass.states, 'weather.home': { ...home, state: 'rainy' } } };
  expect(latest.scene.preset?.kind).not.toBe('mostlyCloudyLowAltitude');
  expect(latest.scene.outgoing).not.toBeNull();
});

test('returning to the viewport refreshes an overdue forecast without waiting for the minute tick', async () => {
  const card = page(hassWith(hoursOf(48), daysOf(6)), { forecast_refresh_minutes: 15 });
  await vi.waitFor(() => expect(forecastCalls()).toBe(1));
  card.style.transform = 'translateY(10000px)';
  await vi.waitFor(() => expect(card.visible).toBe(false));
  vi.setSystemTime(NOW + HOUR);
  card.render();
  await settled();
  expect(forecastCalls()).toBe(1);
  card.style.transform = '';
  await vi.waitFor(() => expect(forecastCalls()).toBe(2));
  await vi.waitFor(() => expect(card.forecasts.supplement?.raw.at).toBeGreaterThanOrEqual(NOW + HOUR));
  expect(card.forecasts.supplement?.raw.at).toBeLessThan(NOW + HOUR + 60_000);
});

test('what the entity leaves out is filled: ten rows, a chance on the hours and days, gusts, and a credit', async () => {
  const card = page(hassWith(hoursOf(48, { condition: 'rainy' }), daysOf(6, { condition: 'rainy' })), {
    weather_mode: 'conditions',
  });
  await vi.waitFor(() => {
    expect(rows(card)).toHaveLength(10);
  });
  expect(forecastCalls()).toBe(1);
  expect(card.root.querySelector('.hour-chance')?.textContent).toBe('40%');
  const chances = [...card.root.querySelectorAll('.day-chance')].map(chance => chance.textContent);
  expect(chances[0], 'today’s is the worst hour left').toBe('40%');
  expect(chances[1], 'a later day’s, its own').toBe('70%');
  // The entity's hours keep their temperature, and the sixth row its own low.
  expect(card.update?.ctx.hourly[1]?.temperature).toBe(66);
  expect(card.update?.ctx.daily[5]?.low).toBe(50);
  expect(card.update?.ctx.daily[6]?.low, 'a supplement day comes in the card’s units: 10 °C').toBe(50);
  expect(link(card)?.hidden).toBe(false);
  expect(card.parts.credit.hidden).toBe(false);
  expect(link(card)?.href).toBe('https://open-meteo.com/');
  expect(text(card, '.credit')).toContain('The entity’s own words.');
  // Gusts join the heading of the wind view.
  card.root.querySelector<HTMLElement>('.modes [data-mode=wind]')?.click();
  await vi.waitFor(() => {
    expect(text(card, '.measure')).toContain('Gusts');
  });
});

test('the credit shows for an entity that words no attribution of its own', async () => {
  const hass = hassWith(hoursOf(48), daysOf(6)),
    home = hass.states['weather.home'],
    card = page({
      ...hass,
      states: {
        ...hass.states,
        ...(home && { 'weather.home': { ...home, attributes: { ...home.attributes, attribution: '' } } }),
      },
    });
  await vi.waitFor(() => {
    expect(rows(card)).toHaveLength(10);
  });
  expect(card.parts.credit.hidden).toBe(false);
});

test('each source the page draws from is credited on a line of its own', async () => {
  const hass = hassWith(hoursOf(48), daysOf(6)),
    card = page(
      {
        ...hass,
        states: {
          ...hass.states,
          'sensor.yard': {
            entity_id: 'sensor.yard',
            state: '64',
            attributes: { unit_of_measurement: '°F', attribution: 'A station’s words.' },
          },
        },
      },
      { temperature_entity: 'sensor.yard' },
    );
  await vi.waitFor(() => {
    expect(rows(card)).toHaveLength(10);
  });
  const source = card.parts.creditSource;
  expect(source.textContent).toBe('The entity’s own words.\nA station’s words.');
  // Twice the one line of the place's name above, at whatever size the card is drawn.
  expect(source.getBoundingClientRect().height).toBeCloseTo(2 * card.parts.creditName.getBoundingClientRect().height);
  expect(link(card)?.hidden).toBe(false);
});

test('hours over before the entity’s first are there for the charts, and not in the strip', async () => {
  const card = page(hassWith(hoursOf(48), daysOf(6)));
  await vi.waitFor(() => {
    expect(card.update?.ctx.pastHours.length).toBeGreaterThan(0);
  });
  const { ctx } = card.update ?? {},
    last = ctx?.pastHours.at(-1)?.time ?? 0;
  expect(ctx?.pastHours[0]?.time).toBe(MIDNIGHT);
  expect(last).toBeLessThan(start);
  expect(ctx?.hourly[0]?.time).toBe(start);
  expect(ctx?.pastHours.at(-1)?.temperature).toBeCloseTo(64.4);
  expect(card.update?.strip.points[1]?.time).toBe(start + HOUR);
});

test('the hours over reach a day’s charts, and the last 24 hours, and go without them', async () => {
  const wet = body();
  wet.hourly.precipitation = wet.hourly.time.map(() => 0.5);
  asked.mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve(wet) }));
  const card = page(hassWith(hoursOf(48), daysOf(6)));
  await vi.waitFor(() => {
    expect(card.update?.ctx.pastHours.length).toBeGreaterThan(0);
  });
  const shown = (id: SheetId) => {
    card.sheets.open(id, card);
    return card.sheets.detail?.sheet;
  };
  const wind = shown('wind'),
    today = () =>
      `.chart-page[data-day="${card.sheets.detail?.sheet.querySelector<HTMLElement>('.detail-days [aria-pressed=true]')?.dataset['day'] ?? ''}"]`;
  expect(wind?.querySelectorAll(`${today()} .chart[data-chart=wind] path[stroke-dasharray]`)).toHaveLength(2);
  expect(wind?.querySelector('.detail-sub')?.textContent, '9 m/s from the hour under way').toBe('Gusts: 20 mph');
  card.sheets.detail?.dialog.close();
  // Noon in Chicago with the hours from midnight: twelve early bars, under the fade.
  const rain = shown('precipitation');
  expect(rain?.querySelectorAll(`${today()} .chart[data-chart=precipitation] g rect`).length).toBeGreaterThanOrEqual(
    12,
  );
  expect(rain?.querySelector('.detail-totals dt')?.textContent).toBe('Last 24 Hours');
  expect(rain?.querySelector('.chart-hatch')).not.toBeNull();
});

test('with no supplement a day’s chart starts at now, with neither gusts nor a chance', async () => {
  const card = page(hassWith(hoursOf(48), daysOf(6)), { open_meteo_forecast: false });
  await vi.waitFor(() => {
    expect(rows(card)).toHaveLength(6);
  });
  card.sheets.open('wind', card);
  const wind = card.sheets.detail?.sheet;
  expect(wind?.querySelector('.chart[data-chart=wind]')).not.toBeNull();
  expect(wind?.querySelectorAll('path[stroke-dasharray]')).toHaveLength(0);
  expect(wind?.querySelector('.detail-sub')?.textContent).toBe('');
  card.sheets.detail?.dialog.close();
  card.sheets.open('precipitation', card);
  const rain = card.sheets.detail?.sheet;
  expect(rain?.querySelector('.detail-chance')).toBeNull();
  expect(rain?.textContent).not.toContain('Last 24 Hours');
});

test('an entity that sends everything keeps the card off the network', async () => {
  const whole = hoursOf(48, { precipitation_probability: 15, wind_gust_speed: 11, cloud_coverage: 40 }),
    card = page(hassWith(whole, daysOf(10)));
  await vi.waitFor(() => {
    expect(rows(card)).toHaveLength(10);
  });
  await settled();
  expect(forecastCalls()).toBe(0);
  expect(link(card)?.hidden).toBe(true);
  expect(card.update?.ctx.pastHours).toEqual([]);
});

// Where the block of the page came out.
const places = (card: IWeatherCard) =>
  [...card.root.querySelectorAll('.daily, .forecast, .tile[data-tile=map]')].map(node => {
    const { left, top, width, height } = node.getBoundingClientRect();
    return [left, top, width, height].map(Math.round).join();
  });
// A reply that is held back until `send` is called.
const heldBack = (answer: () => { ok: boolean; json(): Promise<unknown> }) => {
  let send: () => void = () => undefined;
  asked.mockImplementation(url =>
    addressOf(url).includes('daily=')
      ? new Promise(resolve => {
          send = () => {
            resolve(answer());
          };
        })
      : Promise.resolve({ ok: true, json: () => Promise.resolve([]) }),
  );
  return () => {
    send();
  };
};

test('days on their way hold their room, so that their coming moves nothing around them', async () => {
  const send = heldBack(() => ({ ok: true, json: () => Promise.resolve(body()) })),
    card = page(hassWith(hoursOf(48), daysOf(6)), { weather_mode: 'conditions', map: 'rainviewer' });
  await vi.waitFor(() => {
    expect(rows(card)).toHaveLength(6);
    expect(forecastCalls()).toBe(1);
  });
  await settled();
  const before = places(card);
  expect(before).toHaveLength(3);
  send();
  await vi.waitFor(() => {
    expect(rows(card)).toHaveLength(10);
  });
  await settled();
  expect(places(card)).toEqual(before);
});

test('days that never come give their room back', async () => {
  const send = heldBack(() => ({ ok: false, json: () => Promise.resolve({}) })),
    card = page(hassWith(hoursOf(48), daysOf(6)), { weather_mode: 'conditions' }),
    spanned = () => card.root.querySelector<HTMLElement>('.weather')?.style.getPropertyValue('--daily-rows');
  await vi.waitFor(() => {
    expect(forecastCalls()).toBe(1);
    expect(rows(card)).toHaveLength(6);
  });
  await settled();
  expect(spanned()).toBe('3');
  send();
  await vi.waitFor(() => {
    expect(spanned()).toBe('2');
  });
  expect(rows(card)).toHaveLength(6);
});

test('a try after a failure holds no room, or the page would move for each one', async () => {
  asked.mockImplementation(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
  const card = page(hassWith(hoursOf(48), daysOf(6)), { weather_mode: 'conditions' }),
    spanned = () => card.root.querySelector<HTMLElement>('.weather')?.style.getPropertyValue('--daily-rows');
  await vi.waitFor(() => {
    expect(forecastCalls()).toBe(1);
    expect(spanned()).toBe('2');
  });
  const send = heldBack(() => ({ ok: false, json: () => Promise.resolve({}) }));
  vi.setSystemTime(NOW + 16 * 60_000);
  card.hass = hassWith(hoursOf(48), daysOf(6));
  card.sync();
  await vi.waitFor(() => {
    expect(forecastCalls()).toBe(2);
  });
  await settled();
  expect(spanned()).toBe('2');
  send();
});

test('a failed call leaves the entity’s forecast as it was, and says nothing', async () => {
  asked.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
  const spoken = vi.spyOn(console, 'error'),
    card = page(hassWith(hoursOf(48, { condition: 'rainy' }), daysOf(6, { condition: 'rainy' })), {
      weather_mode: 'conditions',
    });
  await vi.waitFor(() => {
    expect(rows(card)).toHaveLength(6);
  });
  await settled();
  expect(forecastCalls()).toBe(1);
  expect(card.root.querySelector('.hour-chance')).toBeNull();
  expect(card.root.querySelector('.day-chance')).toBeNull();
  expect(text(card, '.hours')).not.toContain('%');
  expect(link(card)?.hidden).toBe(true);
  expect(card.parts.status.hidden).toBe(true);
  expect(spoken).not.toHaveBeenCalled();
});

test('with the switch off the card asks for nothing', async () => {
  const card = page(hassWith(hoursOf(48), daysOf(6)), { open_meteo_forecast: false });
  await vi.waitFor(() => {
    expect(rows(card)).toHaveLength(6);
  });
  await settled();
  expect(forecastCalls()).toBe(0);
});

test('off the full page the card asks for nothing', async () => {
  const card = page(hassWith(hoursOf(48), daysOf(6)), { weather_layout: 'expanded' });
  await vi.waitFor(() => {
    expect(rows(card).length).toBeGreaterThan(0);
  });
  await settled();
  expect(forecastCalls()).toBe(0);
});

test('a home that moves is noticed though no entity changed, and its old hours go', async () => {
  const hourly = hoursOf(48),
    daily = daysOf(6),
    hass = hassWith(hourly, daily),
    card = page(hass);
  await vi.waitFor(() => {
    expect(rows(card)).toHaveLength(10);
  });
  card.hass = { ...hass, config: { ...hass.config, latitude: 30 } };
  await vi.waitFor(() => {
    expect(forecastCalls()).toBe(2);
  });
  expect(asked.mock.calls.at(-1)?.[0]).toContain('latitude=30.000');
});

test('a sheet offers the same days whatever its reading, and says so of the days without it', async () => {
  const card = page(hassWith(hoursOf(48), daysOf(6)));
  await vi.waitFor(() => {
    expect(rows(card)).toHaveLength(10);
  });
  const offered = async (id: SheetId) => {
    card.sheets.open(id, card.parts.forecast);
    await vi.waitFor(() => {
      expect(card.root.querySelector('.detail-days')).not.toBeNull();
    });
    const days = card.root.querySelectorAll('.detail-days button').length;
    card.sheets.detail?.dialog.close();
    return days;
  };
  expect(await offered('uv')).toBe(11);
  expect(await offered('humidity')).toBe(11);
  expect(await offered('wind')).toBe(11);
});

test('the conditions sheet has a chart on a day past the entity’s hours', async () => {
  const card = page(hassWith(hoursOf(48), daysOf(6)));
  await vi.waitFor(() => {
    expect(rows(card)).toHaveLength(10);
  });
  const late = card.update?.ctx.daily[7];
  card.sheets.open(
    'conditions',
    card.parts.forecast,
    new Date(late?.time ?? 0).toLocaleDateString('en-CA', { timeZone: ZONE }),
  );
  await vi.waitFor(() => {
    expect(card.root.querySelector('.detail-sheet .chart svg, dialog .chart svg')).not.toBeNull();
  });
});

test('visibility the entity lacks comes from the hour under way, so its tile can open its sheet', async () => {
  const card = page(hassWith(hoursOf(48), daysOf(6)));
  await vi.waitFor(() => {
    expect(card.root.querySelector('.tile[data-tile=visibility]')).not.toBeNull();
  });
  expect(card.root.querySelector('.tile[data-tile=visibility]')?.textContent).toContain('9.9 mi');
  expect(card.root.querySelector<HTMLElement>('.tile[data-tile=visibility]')?.dataset['detail']).toBe('');
});

test('hours covering under half a day are no total for it: the day’s own stands', async () => {
  // Twelve hours today, a whole tomorrow, and four of the day after, wet ones.
  const hours = hoursOf(40).map((hour, i) => (i >= 36 ? { ...hour, precipitation: 0.01 } : hour)),
    card = page(hassWith(hours, daysOf(6)), { open_meteo_forecast: false, weather_mode: 'rain' });
  await vi.waitFor(() => {
    expect(rows(card)).toHaveLength(6);
  });
  const amount = (index: number) => rows(card)[index]?.querySelector('.day-amount>span')?.textContent;
  expect(amount(1), 'a whole day counts its own hours').toBe('0″');
  expect(amount(2)).toBe('.3″');
  expect(amount(3), 'and a day with none takes the daily forecast’s').toBe('.3″');
});

test('the weather for another place is filled in from that place, not home', async () => {
  const hass = hassWith(hoursOf(48), daysOf(6)),
    state = hass.states['weather.home'];
  if (!state) throw new Error('No entity.');
  page({
    ...hass,
    states: {
      ...hass.states,
      'weather.home': { ...state, attributes: { ...state.attributes, latitude: 48.85, longitude: 2.35 } },
    },
  });
  await vi.waitFor(() => {
    expect(forecastCalls()).toBe(1);
  });
  const address = asked.mock.calls.map(([url]) => addressOf(url)).find(url => url.includes('daily=')) ?? '';
  expect(address).toContain('latitude=48.850');
  expect(address).toContain('longitude=2.350');
});

test('a zone set is where the weather is filled in from', async () => {
  const hass = hassWith(hoursOf(48), daysOf(6));
  page(
    {
      ...hass,
      states: {
        ...hass.states,
        'zone.paris': { entity_id: 'zone.paris', state: '0', attributes: { latitude: 48.85, longitude: 2.35 } },
      },
    },
    { zone: 'zone.paris' },
  );
  await vi.waitFor(() => {
    expect(forecastCalls()).toBe(1);
  });
  const address = asked.mock.calls.map(([url]) => addressOf(url)).find(url => url.includes('daily=')) ?? '';
  expect(address).toContain('latitude=48.850');
  expect(address).toContain('longitude=2.350');
});
