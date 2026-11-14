import assert from 'node:assert/strict';
import { test } from 'vitest';
import { normalizeConfig } from '../src/card/config.ts';
import { workOut, type UpdateSources } from '../src/card/update.ts';
import { isHome } from '../src/card/place.ts';
import type { HomeAssistant } from '../src/card/home-assistant.ts';
import { weatherText } from '../src/weather/i18n.ts';
import { weatherIcon } from '../src/weather/icons.ts';
import { SYMBOLS } from '../src/weather/symbols.ts';
import { solarElevation } from '../src/sky/sun.ts';
import { moonAltitude } from '../src/sky/sky.ts';
import { sunAt } from '../src/weather/conditions.ts';

const NOW = Date.UTC(2026, 9, 27, 17, 30);
const hass = (state: string, alert?: string): HomeAssistant => ({
  states: {
    'weather.home': {
      entity_id: 'weather.home',
      state,
      attributes: { temperature: 58, temperature_unit: '°F', friendly_name: 'Home' },
    },
    'sun.sun': { entity_id: 'sun.sun', state: 'above_horizon', attributes: {} },
    ...(alert
      ? {
          'sensor.alerts': {
            entity_id: 'sensor.alerts',
            state: '1',
            attributes: { Alerts: [{ Event: 'Flood Warning', Severity: alert }] },
          },
        }
      : {}),
  },
  locale: { language: 'en' },
  config: { latitude: 41.9, longitude: -87.6, time_zone: 'UTC' },
});
const sources = (over: Partial<UpdateSources> = {}): UpdateSources => ({
  config: normalizeConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    alert_entities: ['sensor.alerts'],
  }),
  hass: hass('rainy'),
  data: {},
  supplied: false,
  awaited: false,
  nowcast: undefined,
  timeZone: 'UTC',
  prefersDark: false,
  text: locale => weatherText(locale ?? 'en'),
  mode: undefined,
  narrow: false,
  id: 'card1',
  records: {
    earlier: undefined,
    recent: undefined,
    lastDay: undefined,
    airYesterday: undefined,
    recentRain: undefined,
    climate: undefined,
  },
  now: NOW,
  ...over,
});

test('in English a sky is capitalised as a headline, as Home Assistant’s own name isn’t', () => {
  const named = (state: string, language: string, translated?: string) => {
    const base = hass(state);
    return workOut(
      sources({
        hass: {
          ...base,
          locale: { language },
          ...(translated ? { formatEntityState: () => translated } : {}),
        },
      }),
    ).conditionText;
  };
  assert.equal(named('partlycloudy', 'en', 'Partly cloudy'), 'Partly Cloudy');
  assert.equal(named('snowy-rainy', 'en'), 'Mixed Rain and Snow');
  assert.equal(named('partlycloudy', 'de', 'Teilweise bewölkt'), 'Teilweise bewölkt');
  assert.equal(named('windy', 'de', 'Windig'), 'Windig');
  assert.equal(named('cloudy', 'de', 'Bewölkt'), 'Bewölkt');
});

test('an update is worked out from its sources alone, with no card and no page', () => {
  const update = workOut(sources());
  assert.equal(update.conditionText, 'Rain');
  assert.equal(update.ctx.condition, 'rainy');
  assert.equal(update.ctx.id, 'card1');
  assert.equal(update.ctx.mode, update.strip.mode);
  assert.equal(update.night, false);
  assert.deepEqual(update.alerts, []);
  assert.equal(update.alertsLead, false);
  assert.equal(update.nextHour.data, undefined);
  assert.equal(update.ctx.nextHour, false);
});
test('what leads the page is known before anything is drawn', () => {
  const update = workOut(sources({ hass: hass('rainy', 'Severe') }));
  assert.equal(update.alerts[0]?.event, 'Flood Warning');
  assert.equal(update.alertsLead, true);
  assert.equal(workOut(sources({ hass: hass('rainy', 'Minor') })).alertsLead, false);
});
test("each day knows its symbol, and only today's follows the night", () => {
  const dark = hass('clear-night');
  const sun = dark.states['sun.sun'];
  if (!sun) throw new Error('No sun.');
  sun.state = 'below_horizon';
  const noon = (day: number) => new Date(Date.UTC(2026, 9, day, 17)).toISOString();
  const { days, night } = workOut(
    sources({
      hass: dark,
      data: {
        daily: {
          status: 'ready',
          forecast: [
            { datetime: noon(27), condition: 'sunny', temperature: 60 },
            { datetime: noon(28), condition: 'clear-night', temperature: 60 },
            { datetime: noon(29), condition: 'partlycloudy', temperature: 60, is_daytime: false },
          ],
        },
      },
    }),
  );
  assert.equal(night, true);
  assert.deepEqual(
    days.map(({ sky }) => weatherIcon(sky.condition, sky.night)),
    [SYMBOLS.moon, SYMBOLS.sun, SYMBOLS['cloud-sun']],
  );
});
test('the theme is Home Assistant’s, or the screen’s where it doesn’t say, whatever the sky', () => {
  const themed = (darkMode: boolean) => ({ ...hass('sunny'), themes: { darkMode } });
  assert.equal(workOut(sources({ hass: themed(true) })).ctx.dark, true);
  assert.equal(workOut(sources({ hass: themed(false), prefersDark: true })).ctx.dark, false);
  assert.equal(workOut(sources({ prefersDark: true })).ctx.dark, true);
  assert.equal(workOut(sources()).ctx.dark, false);
  const { themes: _, ...unsaid } = { ...hass('sunny'), themes: {} };
  assert.equal(workOut(sources({ hass: { ...unsaid, themes: {} }, prefersDark: true })).ctx.dark, true);
});
test('an entity that says it is within 10 km of home is home, and one that doesn’t say is too', () => {
  const home = { latitude: 41.9, longitude: -87.6 },
    near = (latitude: number, longitude: number) => isHome({ latitude, longitude }, home);
  assert.equal(isHome({}, home), true);
  assert.equal(isHome({ latitude: 35 }, home), true);
  assert.equal(isHome({ latitude: 35, longitude: 139 }, {}), true);
  assert.equal(isHome({ latitude: 35, longitude: 139 }, undefined), true);
  assert.equal(near(41.9, -87.6), true);
  // Rounded to a tenth of a degree, and on a grid about 9.5 km off.
  assert.equal(near(41.88, -87.63), true);
  assert.equal(near(41.985, -87.6), true);
  // About 11 km north; a degree of longitude, 83 km here.
  assert.equal(near(42, -87.6), false);
  assert.equal(near(41.9, -86.6), false);
  // Near the pole a degree of longitude is short, and over the date line the short way round counts.
  assert.equal(isHome({ latitude: 89.9, longitude: 40 }, { latitude: 89.9, longitude: 41 }), true);
  assert.equal(isHome({ latitude: 0, longitude: 179.97 }, { latitude: 0, longitude: -179.97 }), true);
});
test('the pin is my location at home, the place set elsewhere, and unnamed with none set', () => {
  const entity = (attributes: object) => {
      const state = hass('sunny'),
        own = state.states['weather.home'];
      return own
        ? {
            ...state,
            states: { ...state.states, 'weather.home': { ...own, attributes: { ...own.attributes, ...attributes } } },
          }
        : state;
    },
    config = (extra: object) =>
      normalizeConfig({
        type: 'custom:iweather-card',
        entity: 'weather.home',
        weather_layout: 'page',
        ...extra,
      }),
    away = entity({ latitude: 35.68, longitude: 139.69 });
  const home = workOut(sources({ config: config({ place_name: 'Chicago' }) }));
  assert.deepEqual([home.atHome, home.placeName, home.ctx.pinName], [true, 'Chicago', 'My Location']);
  const there = workOut(sources({ hass: away, config: config({ place_name: ' Tokyo ' }) }));
  assert.deepEqual([there.atHome, there.placeName, there.ctx.pinName], [false, 'Tokyo', 'Tokyo']);
  assert.equal(workOut(sources({ hass: away, config: config({}) })).ctx.pinName, '');
  assert.equal(workOut(sources({ config: config({ place_name: '  ' }) })).placeName, '');
});
test('a zone set is where the weather is for, ahead of the entity’s own place, and names it away from home', () => {
  const zone = (friendly_name: string, latitude: number, longitude: number) => ({
      entity_id: 'zone.away',
      state: '0',
      attributes: { friendly_name, latitude, longitude },
    }),
    withZone = (state: ReturnType<typeof zone>, own: object = {}): HomeAssistant => {
      const base = hass('sunny'),
        entity = base.states['weather.home'];
      assert.ok(entity);
      return {
        ...base,
        states: {
          ...base.states,
          'weather.home': { ...entity, attributes: { ...entity.attributes, ...own } },
          'zone.away': state,
        },
      };
    },
    config = (extra: object) =>
      normalizeConfig({
        type: 'custom:iweather-card',
        entity: 'weather.home',
        weather_layout: 'page',
        ...extra,
      }),
    paris = withZone(zone('Paris', 48.857, 2.352), { latitude: 35.68, longitude: 139.69 });
  const there = workOut(sources({ hass: paris, config: config({ zone: 'zone.away' }) }));
  assert.deepEqual(
    [there.atHome, there.ctx.latitude, there.ctx.longitude, there.placeName, there.ctx.pinName],
    [false, 48.857, 2.352, 'Paris', 'Paris'],
  );
  assert.notEqual(there.sun, paris.states['sun.sun'], 'the sky’s sun is Paris’s, not home’s');
  const named = workOut(sources({ hass: paris, config: config({ zone: 'zone.away', place_name: 'Lutetia' }) }));
  assert.deepEqual([named.placeName, named.ctx.pinName], ['Lutetia', 'Lutetia']);
  // A zone at home is home, and its name ("Home") names nothing.
  const home = workOut(sources({ hass: withZone(zone('Home', 41.9, -87.6)), config: config({ zone: 'zone.away' }) }));
  assert.deepEqual([home.atHome, home.placeName, home.ctx.pinName], [true, '', 'My Location']);
  // A zone gone falls back on the entity’s own place.
  const gone = workOut(sources({ hass: hass('sunny'), config: config({ zone: 'zone.away' }) }));
  assert.deepEqual([gone.atHome, gone.ctx.latitude], [true, 41.9]);
});
test('zone takes a zone', () => {
  const base = { type: 'custom:iweather-card', entity: 'weather.home' };
  assert.equal(normalizeConfig({ ...base, zone: 'zone.paris' }).zone, 'zone.paris');
  assert.equal(normalizeConfig(base).zone, undefined);
  for (const zone of ['weather.paris', 'paris', 'zone.Paris', 3, ''])
    assert.throws(() => normalizeConfig({ ...base, zone }), /zone must be a zone/u, String(zone));
});
test('a remote weather entity uses its own sun and moon in the sky, tiles and hourly forecast', () => {
  const home = hass('sunny'),
    entity = home.states['weather.home'];
  assert.ok(entity);
  const latitude = 35.68,
    longitude = 139.69;
  const away: HomeAssistant = {
    ...home,
    states: {
      ...home.states,
      'weather.home': { ...entity, attributes: { ...entity.attributes, latitude, longitude } },
    },
  };
  const update = workOut(
    sources({
      hass: away,
      data: {
        hourly: {
          status: 'ready',
          forecast: [0, 1, 2, 3, 4].map(hours => ({
            datetime: new Date(NOW + hours * 3_600_000).toISOString(),
            condition: 'sunny',
            temperature: 60,
          })),
        },
      },
    }),
  );
  assert.deepEqual([update.ctx.latitude, update.ctx.longitude], [latitude, longitude]);
  assert.equal(update.night, true, 'it is after midnight there while the home sun is up');
  assert.equal(update.inputs.night, true);
  assert.equal(update.inputs.elevation, solarElevation(NOW, latitude, longitude));
  assert.equal(update.inputs.moonAltitude, moonAltitude(NOW, latitude, longitude));
  assert.equal(update.ctx.sun, update.sun);
  assert.notEqual(update.sun, home.states['sun.sun']);
  assert.equal(update.sun?.state, 'below_horizon');
  assert.ok(Date.parse(update.sun.attributes.next_rising ?? '') > NOW);
  assert.ok(Date.parse(update.sun.attributes.next_setting ?? '') > NOW);
  assert.ok(update.strip.points.some(point => point.night));
  assert.ok(update.strip.items.some(point => point.sun === 'sunrise'));
});
test('the home sun and coordinates stay intact for weather near home', () => {
  const home = hass('sunny'),
    update = workOut(sources({ hass: home }));
  assert.equal(update.sun, home.states['sun.sun']);
  assert.deepEqual([update.ctx.latitude, update.ctx.longitude], [home.config?.latitude, home.config?.longitude]);
});
test('entity coordinates also work when Home Assistant has no home coordinates', () => {
  const home = hass('sunny'),
    entity = home.states['weather.home'];
  assert.ok(entity);
  const update = workOut(
    sources({
      hass: {
        ...home,
        config: {},
        states: { ...home.states, 'weather.home': { ...entity, attributes: { latitude: 35.68, longitude: 139.69 } } },
      },
    }),
  );
  assert.equal(update.ctx.latitude, 35.68);
  assert.equal(update.ctx.longitude, 139.69);
  assert.equal(update.night, true);
});
test('a calculated sun finds distant polar events and refreshes after a cached event passes', () => {
  const place = { latitude: 69.65, longitude: 18.96 },
    now = Date.parse('2026-06-21T12:00:00Z'),
    first = sunAt(place, now);
  assert.equal(first?.state, 'above_horizon');
  const rising = Date.parse(first.attributes.next_rising ?? ''),
    setting = Date.parse(first.attributes.next_setting ?? '');
  assert.ok(rising > now && setting > now);
  const after = sunAt(place, Math.min(rising, setting) + 1);
  assert.ok(Date.parse(after?.attributes.next_rising ?? '') > Math.min(rising, setting));
  assert.ok(Date.parse(after?.attributes.next_setting ?? '') > Math.min(rising, setting));
  const pole = sunAt({ latitude: 90, longitude: 0 }, now);
  assert.equal(pole?.state, 'above_horizon');
});
test('working an update out twice gives the same result', () => {
  const { ctx: _one, fmt: _a, named: _b, t: _c, ...first } = workOut(sources()),
    { ctx: _two, fmt: _d, named: _e, t: _f, ...second } = workOut(sources());
  assert.deepEqual(first, second);
});
test('hours before the forecast reach the tiles and sheets apart from it, so the strip can’t shift', () => {
  const hour = 3_600_000,
    at = (offset: number) => new Date(Math.floor(NOW / hour) * hour + offset * hour).toISOString();
  const earlier = [
      { datetime: at(-2), temperature: 50 },
      { datetime: at(-1), temperature: 51 },
    ],
    forecast = [0, 1, 2].map(offset => ({ datetime: at(offset), temperature: 60 + offset }));
  const update = workOut(sources({ data: { hourly: { status: 'ready', forecast, earlier } }, supplied: true }));
  assert.deepEqual(
    update.ctx.pastHours.map(entry => entry.temperature),
    [50, 51],
  );
  assert.deepEqual(
    update.ctx.hourly.map(entry => entry.temperature),
    [60, 61, 62],
  );
  assert.equal(update.credits.openMeteo, true);
  assert.deepEqual(workOut(sources()).ctx.pastHours, []);
});
test('the hourly view opens on Conditions by itself, however wet the hours, and on a view once one is picked', () => {
  const hour = 3_600_000,
    at = (offset: number) => new Date(Math.floor(NOW / hour) * hour + offset * hour).toISOString(),
    forecast = [0, 1, 2].map(offset => ({
      datetime: at(offset),
      temperature: 60,
      condition: 'rainy',
      precipitation: 2,
      precipitation_probability: 90,
    })),
    opened = (over: Partial<UpdateSources> = {}) =>
      workOut(sources({ data: { hourly: { status: 'ready', forecast } }, ...over })).strip.mode;
  assert.equal(opened(), 'conditions');
  assert.equal(opened({ mode: 'rain' }), 'rain');
});

test('the hero names how it feels when that is far from the temperature', () => {
  const felt = (apparent_temperature: number, weather_layout = 'page') => {
    const base = hass('cloudy'),
      state = base.states['weather.home'];
    if (!state) throw new Error('No weather entity.');
    return workOut(
      sources({
        config: normalizeConfig({ type: 'custom:iweather-card', entity: 'weather.home', weather_layout }),
        hass: {
          ...base,
          states: {
            ...base.states,
            'weather.home': { ...state, attributes: { ...state.attributes, apparent_temperature } },
          },
        },
      }),
    ).feltText;
  };
  assert.equal(felt(58), '');
  assert.equal(felt(53.5), '', 'under 5 °F apart');
  assert.equal(felt(53), 'Feels Like: 53°');
  assert.equal(felt(70), 'Feels Like: 70°');
});

test('fog that has thinned past 5 km is named by the sky above it, and haze only in dry air', () => {
  const foggy = (attributes: object) => {
    const base = hass('fog'),
      home = base.states['weather.home'];
    if (!home) throw new Error('No weather.');
    return {
      ...base,
      states: { ...base.states, 'weather.home': { ...home, attributes: { ...home.attributes, ...attributes } } },
    };
  };
  const named = (attributes: object) => workOut(sources({ hass: foggy(attributes) })).conditionText;
  assert.equal(named({ visibility: 4, visibility_unit: 'mi', humidity: 100 }), 'Cloudy');
  assert.equal(named({ visibility: 2, visibility_unit: 'mi', humidity: 100 }), 'Fog');
  assert.equal(named({ visibility: 2, visibility_unit: 'mi', humidity: 40 }), 'Haze');
  assert.equal(named({ visibility: 0.2, visibility_unit: 'mi' }), 'Fog');
});

test('lent cover refines fog and wind while named clear and cloud skies keep their headlines', () => {
  const hour = 3_600_000,
    under = new Date(Math.floor(NOW / hour) * hour).toISOString();
  const update = (state: string, cloud_coverage: number, attributes: object = {}) => {
    const base = hass(state),
      home = base.states['weather.home'];
    if (!home) throw new Error('No weather.');
    return workOut(
      sources({
        hass: {
          ...base,
          states: { ...base.states, 'weather.home': { ...home, attributes: { ...home.attributes, ...attributes } } },
        },
        data: { hourly: { status: 'ready', forecast: [{ datetime: under, condition: state, cloud_coverage }] } },
      }),
    );
  };
  // Mist that has thinned past 5 km, with no cover of its own.
  const mist = { visibility: 5, visibility_unit: 'mi', humidity: 94 };
  assert.equal(update('fog', 100, mist).sky, 'cloudyLowAltitude');
  assert.equal(update('fog', 100, mist).conditionText, 'Cloudy');
  assert.equal(update('fog', 40, mist).sky, 'partlyCloudyLowAltitude');
  assert.equal(update('fog', 40, mist).conditionText, 'Partly Cloudy');
  assert.equal(update('cloudy', 75).sky, 'cloudyLowAltitude');
  assert.equal(update('cloudy', 75).conditionText, 'Cloudy');
  assert.equal(update('sunny', 95).sky, 'clear', 'an explicit clear condition keeps its sky');
  assert.equal(update('Mostly Cloudy', 10).sky, 'mostlyCloudyLowAltitude');
  assert.equal(update('Mostly Cloudy', 10).conditionText, 'Mostly Cloudy');
  assert.equal(update('windy', 75).sky, 'mostlyCloudyLowAltitude');
  assert.equal(update('windy', 75).conditionText, 'Windy');
});
