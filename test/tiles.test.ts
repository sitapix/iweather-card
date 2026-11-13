import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { EntityAttributes } from '../src/card/home-assistant.ts';
import { tileMarkup, tileOrder } from '../src/cards/index.ts';
import { TILES } from '../src/cards/ids.ts';
import {
  airBand,
  airGlyphFor,
  airIsSignificant,
  airScale,
  airSentence,
  airShare,
} from '../src/cards/air-quality/rules.ts';
import { AIR_SCALES } from '../src/cards/air-quality/scales.ts';
import { AIR_SCALE_IDS } from '../src/card/config.ts';
import { glyphs } from '../src/cards/shared/glyphs.ts';
import { compass16 } from '../src/lib/compass.ts';
import { feelsLike } from '../src/cards/feels-like/rules.ts';
import { moonGlyph, moonInfo } from '../src/cards/moon/rules.ts';
import { sunPath } from '../src/cards/sun/rules.ts';
import { tileText } from '../src/cards/shared/tile.ts';
import { uvAdvice, uvSummary, uvLevel } from '../src/cards/uv/rules.ts';
import type { TileContext } from '../src/cards/shared/context.ts';
import { forecasts, type DailyItem, type TimedEntry } from '../src/weather/forecast-items.ts';
import { weatherNumber } from '../src/lib/formats.ts';
import { mapKind } from '../src/map/sources.ts';
import type { Climate, Normal } from '../src/cards/averages/climate.ts';
import { normalizeConfig } from '../src/card/config.ts';
import { moonTilt } from '../src/sky/sky.ts';
import { schemaFor } from '../src/card/editor-schema.ts';
import { map } from '../src/map/index.ts';
import { mapView } from '../src/map/view.ts';

const now = Date.parse('2026-10-26T17:45:00Z'),
  H = 3600000;
const ctx = (attrs: EntityAttributes, extra: Partial<TileContext> = {}): TileContext => ({
  id: 't',
  attrs: { temperature_unit: '°F', ...attrs },
  hourly: [],
  pastHours: [],
  daily: [],
  sun: undefined,
  config: normalizeConfig({ entity: 'weather.home' }),
  hass: { states: {} },
  locale: 'en-US',
  numbers: 'en-US',
  timeZone: 'America/Chicago',
  now,
  hour12: true,
  mode: undefined,
  condition: undefined,
  latitude: 38.63,
  longitude: -90.2,
  atHome: true,
  dark: false,
  pinName: 'My Location',
  placeName: '',
  earlier: undefined,
  climate: undefined,
  fmt: (v, d = 0) => weatherNumber(v, 'en-US', d),
  ...extra,
});
// An air quality sensor reading `state`, with the card set to use it.
const aqi = (state: string): Partial<TileContext> => ({
  config: normalizeConfig({ entity: 'weather.home', air_quality_entity: 'sensor.aqi' }),
  hass: { states: { 'sensor.aqi': { entity_id: 'sensor.aqi', state, attributes: {} } } },
});
const tileLabel = (html: string | null) => tileText(html ?? '');

test('the full layout and tiles are validated with defaults in order', () => {
  const config = normalizeConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
  });
  assert.deepEqual(config.tiles, TILES);
  assert.deepEqual(normalizeConfig({ entity: 'weather.home', tiles: ['moon', 'uv'] }).tiles, ['moon', 'uv']);
  for (const options of [
    { tiles: 'uv' },
    { tiles: ['radar'] },
    { tiles: ['uv', 'uv'] },
    { air_quality_entity: 'weather.home' },
    { weather_layout: 'full' },
  ])
    assert.throws(() => normalizeConfig({ entity: 'weather.home', ...options }), JSON.stringify(options));
  const tiles = JSON.stringify(schemaFor({ layout: 'page' }));
  assert.ok(tiles.includes('"reorder":true') && tiles.includes('"page"') && tiles.includes('air_quality_entity'));
});

test('a tile without data from the provider is left out rather than shown empty', () => {
  for (const id of [
    'uv',
    'wind',
    'feels_like',
    'humidity',
    'visibility',
    'pressure',
    'precipitation',
    'sun',
    'air_quality',
  ])
    assert.equal(tileMarkup(id, ctx({})), null, id);
  assert.equal(tileMarkup('air_quality', ctx({}, aqi('unavailable'))), null);
  assert.equal(tileMarkup('unknown', ctx({})), null);
  // The moon needs only the clock; rise and set need the location.
  assert.match(tileLabel(tileMarkup('moon', ctx({}, { latitude: undefined, longitude: undefined }))), /illuminated/);
});

test('UV levels and sun protection advice follow the hourly forecast', () => {
  assert.deepEqual(
    [0, 2.9, 3, 5.9, 6, 8, 11].map(value => uvLevel(value)),
    ['Low', 'Low', 'Moderate', 'Moderate', 'High', 'Very High', 'Extreme'],
  );
  const hourly = [3, 2.6, 2.2, 1, 0.3].map((uv_index, i) => ({
    datetime: new Date(now + i * H).toISOString(),
    uv_index,
  }));
  const c = ctx({});
  assert.match(uvAdvice(4.2, hourly, now, c.timeZone, c), /until 1<small>PM<\/small>/);
  assert.equal(
    uvAdvice(
      1,
      hourly.map(e => ({ ...e, uv_index: 1 })),
      now,
      c.timeZone,
      c,
    ),
    'Low for the rest of the day.',
  );
  // High later today: from the first high hour to the next low one, or at it when none follows.
  const at = (uv: readonly number[]) =>
    uv.map((uv_index, i) => ({ datetime: new Date(now + (i + 1) * H).toISOString(), uv_index }));
  assert.match(uvAdvice(1, at([1, 4, 4, 1]), now, c.timeZone, c), /^Use sun protection 2.*-4/);
  assert.match(uvAdvice(1, at([1, 4]), now, c.timeZone, c), /^Use sun protection at 2/);
  // High with no low hour ahead: the rest of the day after noon, all day before it.
  assert.equal(uvAdvice(5, at([5, 6]), now, c.timeZone, c), 'Use sun protection for the rest of the day.');
  const morning = now - 4 * H;
  assert.equal(uvAdvice(5, [], morning, c.timeZone, c), 'Use sun protection all day.');
  // A low morning with nothing high today is low all day.
  assert.equal(
    uvAdvice(
      1,
      [0, 1, 2].map(i => ({ datetime: new Date(morning + (i + 1) * H).toISOString(), uv_index: 1 })),
      morning,
      c.timeZone,
      c,
    ),
    'Low levels all day.',
  );
  // The UV sheet sums up today: protection recommended, strongly from 8; low now with more to come.
  assert.equal(uvSummary(5, [], now, c.timeZone), 'Sun protection recommended.');
  assert.equal(uvSummary(9, [], now, c.timeZone), 'Sun protection strongly recommended.');
  assert.equal(uvSummary(1, at([1, 4]), now, c.timeZone), 'Low levels currently.');
  assert.equal(uvSummary(1, at([1, 1]), now, c.timeZone), 'Low for the rest of the day.');
  assert.match(
    tileLabel(tileMarkup('uv', ctx({ uv_index: 4.2 }, { hourly: forecasts(hourly) }))),
    /UV index 4 Moderate Use sun protection/,
  );
});

test('feels-like uses the provider value, then heat index or wind chill', () => {
  assert.deepEqual(feelsLike({ apparent_temperature: 70, temperature: 72 }), { value: 70, estimated: false });
  assert.equal(feelsLike({ temperature: 69, temperature_unit: '°F', humidity: 60, wind_speed: 3 })?.value, 69);
  assert.ok((feelsLike({ temperature: 95, temperature_unit: '°F', humidity: 60 })?.value ?? Number.NaN) > 105);
  assert.ok(
    (feelsLike({ temperature: 0, temperature_unit: '°C', wind_speed: 30, wind_speed_unit: 'km/h' })?.value ??
      Number.NaN) < -4,
  );
  assert.equal(feelsLike({}), null);
  // A reading of its own, as the hour under way lends one (see readingsNow), isn't an estimate.
  const lent = tileLabel(tileMarkup('feels_like', ctx({ temperature: 60, apparent_temperature: 55 })));
  assert.match(lent, /55°/);
  assert.doesNotMatch(lent, /Estimated/);
  assert.match(
    tileLabel(tileMarkup('feels_like', ctx({ temperature: 30, wind_speed: 15, wind_speed_unit: 'mph' }))),
    /Wind is making it feel colder/,
  );
});

test('sun, moon, wind and air quality read correctly', () => {
  const sun = {
    state: 'above_horizon',
    attributes: {
      next_rising: '2026-10-27T12:22:41Z',
      next_setting: '2026-10-26T23:07:34Z',
      next_noon: '2026-10-27T17:44:50Z',
    },
  };
  // A 10¾-hour October day: the horizon sits 10¾/24 of the way down the curve, above its midpoint.
  const path = sunPath(sun, now, 'America/Chicago');
  assert.ok(
    path &&
      Math.abs(path.progress - 0.5) < 0.01 &&
      path.level(now) > 0.99 &&
      Math.abs(path.horizon - (1 - (2 * 10.75) / 24)) < 0.01,
  );
  // The Sun follows the curve by the clock, so it meets that line a little after sunset: 18 minutes
  // before a November sunset it still stands well above it, and at sunset it hasn't reached it.
  const november = {
      state: 'above_horizon',
      attributes: {
        next_rising: '2026-11-10T12:37:00Z',
        next_setting: '2026-11-09T22:52:00Z',
        next_noon: '2026-11-10T17:45:00Z',
      },
    },
    sunset = Date.parse('2026-11-09T22:52:00Z'),
    evening = sunPath(november, sunset - 18 * 60_000, 'America/Chicago');
  assert.ok(evening);
  assert.ok(evening.level(sunset - 18 * 60_000) - evening.horizon > 0.1);
  assert.ok(evening.level(sunset) > evening.horizon);
  assert.match(tileLabel(tileMarkup('sun', ctx({}, { sun }))), /Sunset 6:07 PM Sunrise: 7:22 AM/);
  const moon = moonInfo(now, 38.63, -90.2);
  assert.equal(moon.name, 'Full moon');
  assert.ok(moon.illumination > 0.98);
  assert.equal(moon.event?.kind, 'Moonrise');
  // The tile's moon stands as it does in the sky over the place now.
  const tilt = (moonTilt(now, 38.63, -90.2) ?? Number.NaN).toFixed(4);
  assert.match(
    tileMarkup('moon', ctx({})) ?? '',
    new RegExp(`class="moon-disc" data-phase="0\\.5\\d+" data-turn="${tilt}"`),
  );
  assert.deepEqual(
    [0, 190.9, 202.5, 359].map(bearing => compass16(bearing)),
    ['N', 'S', 'SSW', 'N'],
  );
  assert.match(
    tileLabel(tileMarkup('wind', ctx({ wind_speed: 4, wind_bearing: 202.5, wind_speed_unit: 'mph' }))),
    /4 mph From the SSW/,
  );
  assert.deepEqual(
    [0, 50, 51, 93, 151, 301].map(v => airBand(AIR_SCALES.us, v).name),
    ['Good', 'Good', 'Moderate', 'Moderate', 'Unhealthy', 'Hazardous'],
  );
  assert.match(tileLabel(tileMarkup('air_quality', ctx({}, aqi('93')))), /93 Moderate/);
});

test('the moon tile symbol is its phase’s name’s, lit on the side the moon is', () => {
  // One symbol for each name, whatever the moment within it.
  assert.equal(moonGlyph(0.04), moonGlyph(0.21));
  assert.equal(moonGlyph(0.79), moonGlyph(0.96));
  assert.equal(moonGlyph(0.98), moonGlyph(0.01));
  assert.equal(new Set([0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9].map(phase => moonGlyph(phase))).size, 8);
  // The full moon is the whole disc; every other has a dark part of its own, filled at a quarter,
  // and cut from the disc's.
  assert.equal(moonGlyph(0.5).match(/<path/g)?.length, 1);
  for (const phase of [0, 0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) {
    const [disc, dark] = [...moonGlyph(phase).matchAll(/ d="([^"]+)"/g)].map(match => match[1] ?? '');
    assert.match(moonGlyph(phase), /<path fill="currentColor" opacity="0.25" d="M/);
    assert.ok(dark && disc?.endsWith(dark));
  }
  // A quarter's edge runs straight down the middle.
  assert.match(moonGlyph(0.25), /V/);
  assert.doesNotMatch(moonGlyph(0.1), /V/);
  // As it waxes in the north it is lit on the side it is as it wanes in the south.
  for (const phase of [0.1, 0.25, 0.4]) {
    assert.equal(moonGlyph(phase), moonGlyph(1 - phase, true));
    assert.notEqual(moonGlyph(phase), moonGlyph(phase, true));
  }
});

test('the moon tile carries wide-layout facts, kept out of its label', () => {
  const html = tileMarkup('moon', ctx({})) ?? '';
  assert.match(html, /<dl class="facts added">.*Illumination.*Next Full Moon/s);
  assert.doesNotMatch(tileText(html), /Illumination/);
  // One line under the moon, the event alone.
  assert.match(tileText(html), /Moon(rise|set): /);
  assert.doesNotMatch(tileText(html), /Next/);
});

test('the wind tile ends on its gusts and where they come from', () => {
  const wind = (attrs: Record<string, unknown>) =>
    tileLabel(tileMarkup('wind', ctx({ wind_speed: 4, wind_speed_unit: 'mph', ...attrs })));
  assert.match(wind({ wind_gust_speed: 9, wind_bearing: 53 }), /Gusts: 9 mph NE/);
  assert.match(wind({ wind_gust_speed: 9 }), /Gusts: 9 mph$/);
  assert.match(wind({ wind_bearing: 53 }), /From the NE/);
});

// The curve is centred on the solar noon of the local date: however far from local midnight
// solar midnight falls, the sun stays on its day until the date turns, past either end if need be.
test('the sun tile places the sun from the solar noon of the local date', () => {
  const place = (time: string, next_noon: string, timeZone: string) => {
    const sun = {
      state: 'below_horizon',
      attributes: { next_noon, next_rising: next_noon, next_setting: next_noon },
    };
    return sunPath(sun, Date.parse(time), timeZone)?.progress ?? Number.NaN;
  };
  // St. Louis: solar noon at 12:43, so solar midnight is 43 minutes into the date.
  const chicago = 'America/Chicago',
    noon = '2026-10-31T12:43:00-05:00';
  assert.ok(Math.abs(place('2026-10-31T00:19:00-05:00', noon, chicago) + 0.017) < 0.001);
  assert.ok(Math.abs(place('2026-10-31T00:43:00-05:00', noon, chicago)) < 0.001);
  assert.ok(Math.abs(place('2026-10-31T12:43:00-05:00', '2026-11-01T12:43:00-05:00', chicago) - 0.5) < 0.001);
  // Tokyo: solar noon at 11:24, so its solar midnight comes before the date's end, and past it the
  // next noon is tomorrow's, not the one the sun is on.
  const tokyo = place('2026-10-31T23:30:00+09:00', '2026-11-01T11:24:00+09:00', 'Asia/Tokyo');
  assert.ok(tokyo > 1 && tokyo < 1.01, String(tokyo));
  // A sun past the edge is placed there, not held at it.
  const sun = {
    state: 'below_horizon',
    attributes: {
      next_noon: noon,
      next_rising: '2026-10-31T07:26:00-05:00',
      next_setting: '2026-10-31T18:01:00-05:00',
    },
  };
  const html = tileMarkup('sun', ctx({}, { sun, now: Date.parse('2026-10-31T00:19:00-05:00'), timeZone: chicago }));
  assert.match(html ?? '', /--x:-1\.7%/);
});

test('feels like and visibility use their thresholds', () => {
  const feels = (temperature: number, apparent: number) =>
    tileLabel(tileMarkup('feels_like', ctx({ temperature, apparent_temperature: apparent })));
  assert.match(feels(71.6, 72.4), /Similar to the actual temperature/, 'equal once rounded');
  assert.match(feels(80, 85), /feels warmer than the actual/);
  assert.match(feels(90, 95), /feels hotter than the actual/, 'from a feels-like of 92 °F');
  assert.match(feels(50, 45), /Wind is making it feel cooler/);
  assert.match(feels(40, 33), /Wind is making it feel colder/, 'below 40 °F');
  const sight = (visibility: number, unit: string, condition?: string) =>
    tileLabel(tileMarkup('visibility', ctx({ visibility, visibility_unit: unit }, { condition })));
  // In fog under 2 km, the fog by how thick.
  assert.match(sight(0.04, 'km', 'fog'), /Dense fog/);
  assert.match(sight(0.15, 'km', 'fog'), /Thick fog/);
  assert.match(sight(0.4, 'km', 'fog'), /Moderate fog/);
  assert.match(sight(0.8, 'km', 'fog'), /Light fog/);
  assert.match(sight(1.5, 'km', 'fog'), /Very light fog/);
  // From 2 to 10 km, haze in any weather; heavier to 4 km.
  assert.match(sight(3, 'km', 'rainy'), /^Visibility 3 km Haze is affecting/);
  assert.match(sight(6, 'km'), /Light haze/);
  // Otherwise how clear it is: a snowstorm at 500 m is moderate visibility, not fog.
  assert.match(sight(0.5, 'km', 'snowy'), /Visibility is moderate\./);
  assert.match(sight(0.1, 'km', 'snowy'), /Visibility is poor\./);
  assert.match(sight(0.04, 'km', 'pouring'), /Visibility is very poor\./);
  assert.match(sight(1.5, 'km'), /Fairly clear view\./);
  assert.match(sight(7, 'mi'), /Clear view/);
  assert.match(sight(9.4, 'mi'), /^Visibility 9.4 mi Clear view/);
  assert.match(sight(9.5, 'mi'), /Perfectly clear view/);
});

// The air quality tile sets today's reading against yesterday's at the same time when history
// has one, and says the reading alone when it doesn't.
test('the air quality tile compares with yesterday at about this time', () => {
  const tile = (state: string, airYesterday?: number) =>
    tileLabel(tileMarkup('air_quality', ctx({}, { ...aqi(state), airYesterday })));
  assert.match(tile('65', 62), /Air quality index is 65, which is similar to yesterday at about this time\./);
  assert.match(tile('65', 90), /better than yesterday/);
  assert.match(tile('65', 40), /worse than yesterday/);
  assert.match(tile('65'), /Current AQI \(US\) is 65\./);
});

test('air that matters leads with its band and no heading', () => {
  const tile = (state: string, air_quality_scale?: string) =>
    tileMarkup(
      'air_quality',
      ctx(
        {},
        {
          ...aqi(state),
          config: normalizeConfig({
            entity: 'weather.home',
            air_quality_entity: 'sensor.aqi',
            ...(air_quality_scale ? { air_quality_scale } : {}),
          }),
        },
      ),
    ) ?? '';
  assert.match(tile('343'), /<div class="air-headline">343 - Hazardous<\/div>/);
  assert.doesNotMatch(tile('343'), /<header/, 'it needs no heading');
  assert.match(tile('65'), /<header/);
  assert.doesNotMatch(tile('65'), /air-headline/);
  // Where a scale always shows in full, even clean air does, and a scale with no numbers shows none.
  assert.match(tile('65', 'cn'), /<div class="air-headline">65 - Good<\/div>/);
  assert.match(tile('5', 'eu'), /<div class="air-headline">Very Poor<\/div>/);
  // A scale with no numbers says its band where others say their number.
  assert.match(tile('3', 'eu'), /<div class="big">Moderate<\/div>/);
  assert.doesNotMatch(tile('3', 'eu'), /<div class="big">3/);
  // Each scale's own name for the tile.
  assert.match(tileLabel(tile('2', 'uk')), /Air Pollution/);
  assert.match(tileLabel(tile('5', 'ca')), /Moderate Health Risk/);
});

test('every air quality scale reads in order, ends on its range and keeps its stops in order', () => {
  for (const id of AIR_SCALE_IDS) {
    const scale = AIR_SCALES[id],
      [low, high] = scale.range,
      tops = scale.bands.map(band => band.top);
    assert.equal(tops.at(-1), high, id);
    assert.deepEqual(
      tops.toSorted((a, b) => a - b),
      tops,
      id,
    );
    assert.deepEqual(
      scale.bands.map(band => band.tier).toSorted((a, b) => a - b),
      scale.bands.map(band => band.tier),
      id,
    );
    assert.equal(airShare(scale, low), 0, id);
    assert.equal(airShare(scale, high), 1, id);
    const places = scale.stops.map(stop => Number.parseFloat(stop.split(' ')[1] ?? ''));
    assert.deepEqual(
      places.toSorted((a, b) => a - b),
      places,
      id,
    );
  }
});

test('air only matters past the band each scale sets for it', () => {
  // On the US scale that's still past 100.
  assert.equal(airIsSignificant(100), false);
  assert.equal(airIsSignificant(101), true);
  // A reading of 107 is tolerable on India's scale, and 343 isn't.
  assert.equal(airIsSignificant(107, AIR_SCALES.in), false);
  assert.equal(airIsSignificant(343, AIR_SCALES.in), true);
  assert.equal(airIsSignificant(2, AIR_SCALES.uk), false);
  assert.equal(airIsSignificant(7, AIR_SCALES.uk), true);
  assert.equal(airIsSignificant(5, AIR_SCALES.eu), true);
  assert.equal(airIsSignificant(10, AIR_SCALES.cn), true, 'a scale that always shows in full');
});

test('a scale with no numbers never says one', () => {
  const eu = AIR_SCALES.eu;
  assert.equal(airSentence(eu, '3', 3, 5), 'Air quality is better than yesterday at about this time.');
  assert.equal(airSentence(eu, '3', 3, 3), 'Air quality is similar to yesterday at about this time.');
  assert.equal(airSentence(eu, '3', 3, undefined), 'Current EAQI (EU) is Moderate.');
  assert.equal(airSentence(AIR_SCALES.cn, '65', 65, undefined), 'Current AQI (CN) is 65.');
  // A small scale compares by its own size: one step in ten is a real change.
  assert.equal(
    airSentence(AIR_SCALES.uk, '3', 3, 4),
    'Air quality index is 3, which is better than yesterday at about this time.',
  );
});

test('a tile says what it is by its glyph', () => {
  const sunTile = (state: string) =>
    tileMarkup(
      'sun',
      ctx(
        {},
        {
          sun: {
            state,
            attributes: {
              next_rising: '2026-10-27T12:22:41Z',
              next_setting: '2026-10-26T23:07:34Z',
              next_noon: '2026-10-27T17:44:50Z',
            },
          },
        },
      ),
    ) ?? '';
  assert.ok(sunTile('above_horizon').includes(glyphs.sunset), 'sets by day');
  assert.ok(sunTile('below_horizon').includes(glyphs.sun), 'rises by night');
  assert.notEqual(glyphs.sun, glyphs.sunset);
  // Rain falling is a drop; the precipitation map keeps its umbrella.
  const rain =
    tileMarkup(
      'precipitation',
      ctx(
        { precipitation_unit: 'in' },
        {
          daily: [
            {
              time: now,
              high: 60,
              low: 40,
              today: true,
              sky: { condition: 'rainy', night: false },
              precipitation: 0.2,
              condition: 'rainy',
            },
          ],
        },
      ),
    ) ?? '';
  assert.ok(rain.includes(glyphs.precipitation));
  assert.notEqual(glyphs.precipitation, glyphs.map);
  const map = tileMarkup(
    'map',
    ctx({}, { config: normalizeConfig({ entity: 'weather.home', map: 'rainviewer' }), condition: 'rainy' }),
  );
  assert.ok(map?.includes(glyphs.map), 'the map goes by the umbrella');
  // Filled throughout, for the title's added light is clipped to it and a clip knows only fills.
  for (const glyph of [...Object.values(glyphs), airGlyphFor(30), moonGlyph(0.25)]) {
    assert.match(glyph, /fill="currentColor"/);
    assert.doesNotMatch(glyph, /stroke|fill-rule/);
  }
  for (const glyph of Object.values(glyphs)) assert.match(glyph, /aria-hidden="true"/);
});
test('the map is redrawn for its theme and its name, and looks where the weather is for', () => {
  const config = normalizeConfig({ entity: 'weather.home', map: 'rainviewer' }),
    inputs = (extra: Partial<TileContext>, attrs: EntityAttributes = {}) => {
      const seen = map.redrawnBy?.(ctx(attrs, { config, ...extra }));
      return { seen, view: mapView(ctx(attrs, { config, ...extra }))?.inputs };
    };
  assert.notDeepEqual(inputs({ dark: true }).seen, inputs({ dark: false }).seen);
  assert.notDeepEqual(inputs({ pinName: 'Tokyo' }).seen, inputs({}).seen);
  assert.equal(inputs({}).view?.pinName, 'My Location');
  assert.equal(inputs({}, { latitude: 35.68, longitude: 139.69 }).view?.latitude, 38.63);
  // Away, the place worked out for the weather (see weatherPlace).
  const away = inputs({ atHome: false, pinName: 'Tokyo', latitude: 35.68, longitude: 139.69 }).view;
  assert.deepEqual([away?.latitude, away?.longitude, away?.pinName], [35.68, 139.69, 'Tokyo']);
});
test('the air quality glyph fills in as the air gets worse', () => {
  const dots = (glyph: string) => [...glyph.matchAll(/ r="([\d.]+)"/g)].map(match => Number(match[1]));
  const ink = (value: number) => dots(airGlyphFor(value)).reduce((sum, radius) => sum + radius * radius, 0);
  assert.equal(dots(airGlyphFor(30)).length, 19, 'always the whole hexagon');
  assert.equal(dots(airGlyphFor(400)).length, 19);
  assert.ok(ink(30) < ink(80), 'good is sparser than moderate');
  assert.ok(ink(80) < ink(120), 'moderate is sparser than worse');
  assert.equal(airGlyphFor(120), airGlyphFor(400));
  assert.equal(airGlyphFor(Number.NaN), airGlyphFor(80), 'with no reading it stays as drawn');
  assert.ok((tileMarkup('air_quality', ctx({}, aqi('30'))) ?? '').includes(airGlyphFor(30)));
});

// The precipitation tile looks ahead: the next 24 hours, then tomorrow, a weekday within the
// week or a date past it, with snow named; else none in the days it has.
test('the precipitation tile names when the next rain or snow comes', () => {
  const day = (offset: number, precipitation = 0, condition = 'rainy'): DailyItem => ({
    time: now + offset * 24 * H,
    high: 60,
    low: 40,
    today: offset === 0,
    sky: { condition, night: false },
    precipitation,
    condition,
  });
  const footer = (daily: DailyItem[], hourly: TimedEntry[] = []) =>
    tileLabel(tileMarkup('precipitation', ctx({ precipitation_unit: 'in' }, { daily, hourly })));
  assert.match(footer([day(0), day(1, 0.3)]), /\.3″ expected tomorrow\.$/);
  assert.match(footer([day(0), day(1, 0.3, 'snowy')]), /\.3″ snow tomorrow\.$/);
  assert.match(footer([day(0), day(1), day(3, 0.2)]), /Next expected is \.2″ Thu\.$/);
  assert.match(footer([day(0), day(1), day(3, 0.2, 'snowy')]), /Next snow is \.2″ Thu\.$/);
  assert.match(footer([day(0), ...[1, 2, 3, 4, 5, 6].map(n => day(n)), day(8, 0.4)]), /Next expected is \.4″ Nov 3\.$/);
  assert.match(footer([day(0), day(1), day(2)]), /None expected in next 2 days\.$/);
  assert.match(
    footer([day(0), day(1, 0.3)], [{ time: now + 3 * H, precipitation: 0.1 }]),
    /\.1″ expected in next 24h\.$/,
  );
  // A trace in the next day says less than the wet day it leads to.
  assert.match(
    footer([day(0), day(1, 0.3)], [{ time: now + 3 * H, precipitation: 0.01 }]),
    /\.3″ expected tomorrow\.$/,
  );
});

test('the pressure gauge spans 950 to 1075 hPa in every unit, and the steady sign stands level', () => {
  const mark = (pressure: number, pressure_unit: string) =>
    tileMarkup('pressure', ctx({ pressure, pressure_unit }))?.match(/class="mark" style="--a:(-?[\d.]+)deg/)?.[1];
  assert.equal(mark(30.22, 'inHg'), '21.8');
  assert.equal(mark(1023.4, 'hPa'), '22.0');
  assert.equal(mark(1012.5, 'mbar'), '0.0');
  assert.equal(mark(950, 'hPa'), '-126.0');
  assert.equal(mark(1075, 'hPa'), '126.0');
});

// Averages: today's high against its normal, whatever the last 30 days brought.
test('the averages tile stays on temperature after an unusual month', () => {
  const dates = Array.from({ length: 30 }, (_, i) => new Date(now - (30 - i) * 24 * H).toISOString().slice(0, 10));
  const climate = (rain: number): Climate => {
    const normal: Normal = { high: 62, low: 45, range: [55, 70], span: [38, 70], rain };
    return {
      normals: Object.fromEntries([...dates, '2026-10-26'].map(date => [date.slice(5), normal])),
      since: 1991,
      years: 30,
      months: [],
    };
  };
  const tile = (total: number, high: number) =>
    tileLabel(
      tileMarkup(
        'averages',
        ctx(
          { precipitation_unit: 'in' },
          {
            daily: [{ time: now, high, low: 45, today: true, sky: { condition: 'sunny', night: false } }],
            climate: climate(0.1),
            recentRain: { dates, amounts: dates.map(() => total / dates.length), total },
          },
        ),
      ),
    );
  // However wet or dry the month, the tile stays on temperature.
  assert.match(tile(3.3, 64), /\+2° above average daily high/);
  assert.match(tile(6.2, 64), /\+2° above average daily high/);
  assert.match(tile(1.2, 61), /−1° from average daily high/);
  assert.match(tile(3, 58), /−4° from average daily high/);
});

// Tiles move up while they matter: air quality over 100 first, then a feels-like 5 °F off the
// temperature and the averages on an unusual day; the rest keep their order.
test('tiles that matter move up', () => {
  const order = (attrs: EntityAttributes, aqiState = '60') =>
    tileOrder(TILES, ctx(attrs, { ...aqi(aqiState) }))
      .slice(0, 3)
      .map(({ id }) => id);
  assert.deepEqual(order({ temperature: 70, apparent_temperature: 71 }), ['air_quality', 'wind', 'moon']);
  assert.deepEqual(order({ temperature: 70, apparent_temperature: 76 }), ['feels_like', 'air_quality', 'wind']);
  assert.deepEqual(order({ temperature: 70, apparent_temperature: 76 }, '140'), ['air_quality', 'feels_like', 'wind']);
  // A significant reading turns the map to air quality, unless precipitation is near.
  assert.equal(mapKind({ airSignificant: true, radar: true }), 'air_quality');
  assert.equal(mapKind({ airSignificant: true, state: 'rainy' }), 'precipitation');
  assert.equal(mapKind({ radar: true }), 'precipitation');
});

test('gusts in any unit turn a dry day’s map to the wind, read from the entity or a forecast hour', () => {
  const config = normalizeConfig({ entity: 'weather.home', map: 'rainviewer' }),
    kind = (attrs: EntityAttributes, extra: Partial<TileContext> = {}) =>
      mapView(ctx({ latitude: 38.6, longitude: -90.2, ...attrs }, { config, ...extra }))?.kind;
  assert.equal(kind({ wind_gust_speed: 16, wind_speed: 6, wind_speed_unit: 'mph' }), 'wind');
  assert.equal(kind({ wind_gust_speed: 14, wind_speed: 6, wind_speed_unit: 'mph' }), 'precipitation');
  assert.equal(kind({ wind_gust_speed: 8, wind_speed: 3, wind_speed_unit: 'm/s' }), 'wind', 'about 29 km/h');
  assert.equal(kind({ wind_gust_speed: 20, wind_speed: 8, wind_speed_unit: 'km/h' }), 'precipitation');
  assert.equal(kind({ wind_speed: 20, wind_speed_unit: 'mph' }), 'wind', 'with no gust at all, the wind itself');
});

test('the tile says how long until a sun that is a long way off, up to a week', () => {
  const tile = (days: number) => {
    const rising = new Date(now + days * 86400000).toISOString();
    return (
      tileMarkup(
        'sun',
        ctx(
          {},
          {
            sun: {
              state: 'below_horizon',
              attributes: {
                next_noon: new Date(now + 43200000).toISOString(),
                next_rising: rising,
                next_setting: new Date(now + (days + 0.2) * 86400000).toISOString(),
              },
            },
          },
        ),
      ) ?? ''
    );
  };
  assert.match(tile(30), /&gt;7 <small>days<\/small>/);
  assert.match(tile(30), /No sunrise today/);
  assert.match(tile(3), />3 <small>days<\/small>/);
});

test('the moon tile names today’s rise or set, and the next one past today', () => {
  const tiles = [1, 22].map(
    hour =>
      tileMarkup(
        'moon',
        ctx({}, { now: Date.UTC(2026, 10, 1, hour), latitude: 38.6, longitude: -90.2, timeZone: 'UTC' }),
      ) ?? '',
  );
  assert.match(tiles[0] ?? '', /<p>Moonrise: /, 'today’s');
  assert.match(tiles[1] ?? '', /<p>Next Moonrise: /, 'tomorrow’s');
});

test('a sensor that names its scale needs no setting, and any other reads as the US scale', () => {
  const on = (entity: string, friendly_name?: string, air_quality_scale?: string) =>
    airScale({
      config: normalizeConfig({
        entity: 'weather.home',
        air_quality_entity: entity,
        ...(air_quality_scale ? { air_quality_scale } : {}),
      }),
      hass: {
        states: { [entity]: { entity_id: entity, state: '3', attributes: friendly_name ? { friendly_name } : {} } },
      },
    }).short;
  assert.equal(on('sensor.toronto_aqhi'), 'AQHI (CA)');
  assert.equal(on('sensor.london_daqi'), 'DAQI (UK)');
  assert.equal(on('sensor.air_quality', 'Paris EAQI'), 'EAQI (EU)');
  assert.equal(on('sensor.air_quality_index'), 'AQI (US)');
  // Part of a word doesn't count: this "ica" is in "indica".
  assert.equal(on('sensor.indica_air'), 'AQI (US)');
  // The setting wins either way.
  assert.equal(on('sensor.toronto_aqhi', undefined, 'us'), 'AQI (US)');
  assert.equal(on('sensor.air_quality_index', undefined, 'uk'), 'DAQI (UK)');
  assert.equal(on('sensor.toronto_aqhi', undefined, 'auto'), 'AQHI (CA)');
});

test('the European scale reads a level or the continuous index behind it', () => {
  const eu = AIR_SCALES.eu,
    name = (value: number) => airBand(eu, value).name;
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(name), ['Good', 'Fair', 'Moderate', 'Poor', 'Very Poor', 'Extremely Poor']);
  assert.deepEqual([15, 35, 55, 75, 95, 130].map(name), [
    'Good',
    'Fair',
    'Moderate',
    'Poor',
    'Very Poor',
    'Extremely Poor',
  ]);
  assert.equal(airShare(eu, 55), airShare(eu, 3));
});
