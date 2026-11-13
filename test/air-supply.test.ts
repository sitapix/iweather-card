import { afterEach, beforeEach, test, vi, type Mock } from 'vitest';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/card/config.ts';
import type { HomeAssistant } from '../src/card/home-assistant.ts';
import { WeatherRecords, type RecordsHost } from '../src/card/records.ts';
import { RANK } from '../src/cards/card.ts';
import { airQuality } from '../src/cards/air-quality/index.ts';
import { AIR_SOURCE, type AirSupply, openMeteoAir, parseAirSupply } from '../src/cards/air-quality/open-meteo.ts';
import { airNow } from '../src/cards/air-quality/rules.ts';
import { AIR_SCALES } from '../src/cards/air-quality/scales.ts';
import { airQualityDetail } from '../src/cards/air-quality/sheet.ts';
import type { TileContext } from '../src/cards/shared/context.ts';
import { weatherNumber } from '../src/lib/formats.ts';
import { mapView } from '../src/map/view.ts';
import type { Fetcher } from '../src/lib/asking.ts';

const NOW = Date.UTC(2026, 10, 2, 19, 30),
  HOUR = 3_600_000,
  MINUTE = 60_000,
  NOW_HOUR = Math.floor(NOW / HOUR) * HOUR;

// An answer: the index now, yesterday's hours (each `back` from the reading's) and some pollutants.
const answer = ({ index = 42, back = 0, yesterday = 31 } = {}) => {
  const hours = Array.from({ length: 48 }, (_, i) => (NOW_HOUR - (24 - i) * HOUR + back) / 1000);
  return {
    current: { time: NOW_HOUR / 1000, us_aqi: index, pm2_5: 2.5, pm10: 4.1, ozone: 52, carbon_monoxide: 163 },
    hourly: { time: hours, us_aqi: hours.map((_, i) => (i === 0 ? yesterday : 40)) },
  };
};
const supply = (index: number): AirSupply => {
  const parsed = parseAirSupply(answer({ index }), NOW);
  if (!parsed) throw new Error('No supply.');
  return parsed;
};

test('an answer gives the US index now, the hour a day before it, and the pollutants behind it', () => {
  const parsed = parseAirSupply(answer(), NOW);
  assert.ok(parsed);
  assert.equal(parsed.index, 42);
  assert.equal(parsed.yesterday, 31);
  assert.equal(parsed.at, NOW);
  assert.deepEqual(parsed.pollutants, [
    { kind: 'pm25', value: 2.5, unit: 'µg/m³' },
    { kind: 'pm10', value: 4.1, unit: 'µg/m³' },
    { kind: 'ozone', value: 52, unit: 'µg/m³' },
    { kind: 'carbon_monoxide', value: 163, unit: 'µg/m³' },
  ]);
  assert.equal(parseAirSupply(answer({ back: 45 * MINUTE }), NOW)?.yesterday, undefined, 'none near a day ago');
  assert.equal(parseAirSupply({ current: { time: NOW_HOUR / 1000 } }, NOW), null, 'no index, no reading');
  assert.equal(parseAirSupply('Too many requests', NOW), null);
});

// --- Asking -----------------------------------------------------------------------------
const storage = () => {
  const held = new Map<string, string>();
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
  };
};
const good: Fetcher = () => Promise.resolve({ ok: true, json: () => Promise.resolve(answer()) });
let asked: Mock<Fetcher>;
beforeEach(() => {
  asked = vi.fn<Fetcher>(good);
  vi.stubGlobal('fetch', asked);
  vi.stubGlobal('localStorage', storage());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test('one request names the place, the index now and a day back, and the pollutants', async () => {
  await openMeteoAir(38.627_31, -90.199_42, NOW);
  assert.equal(asked.mock.calls.length, 1);
  const url = new URL(asked.mock.calls[0]?.[0] ?? ''),
    param = (name: string) => url.searchParams.get(name);
  assert.equal(`${url.origin}${url.pathname}`, 'https://air-quality-api.open-meteo.com/v1/air-quality');
  assert.equal(param('latitude'), '38.627');
  assert.equal(param('longitude'), '-90.199');
  assert.deepEqual(param('current')?.split(',').toSorted(), [
    'carbon_monoxide',
    'nitrogen_dioxide',
    'ozone',
    'pm10',
    'pm2_5',
    'sulphur_dioxide',
    'us_aqi',
  ]);
  assert.equal(param('hourly'), 'us_aqi');
  assert.equal(param('past_days'), '1');
});

test('cards asking together share one request, and its answer serves the browser for an hour', async () => {
  const [one, two] = await Promise.all([openMeteoAir(38.6, -90.2, NOW), openMeteoAir(38.6, -90.2, NOW)]);
  assert.equal(one?.index, 42);
  assert.equal(two?.index, 42);
  assert.equal(asked.mock.calls.length, 1);
  const saved = await openMeteoAir(38.6, -90.2, NOW + 59 * MINUTE);
  assert.equal(asked.mock.calls.length, 1, 'within the hour, the saved answer');
  assert.equal(saved?.at, NOW, 'as old as it is');
  await openMeteoAir(38.6, -90.2, NOW + HOUR);
  assert.equal(asked.mock.calls.length, 2, 'past it, a new one');
});

// --- Showing ----------------------------------------------------------------------------
const ctx = (extra: Partial<TileContext> = {}): TileContext => ({
  id: 't',
  attrs: { temperature_unit: '°F' },
  hourly: [],
  pastHours: [],
  daily: [],
  sun: undefined,
  config: normalizeConfig({ entity: 'weather.home' }),
  hass: { states: {} },
  locale: 'en-US',
  numbers: 'en-US',
  timeZone: 'America/Chicago',
  now: NOW,
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
const withSensor = (state: string): Partial<TileContext> => ({
  config: normalizeConfig({ entity: 'weather.home', air_quality_entity: 'sensor.toronto_aqhi' }),
  hass: { states: { 'sensor.toronto_aqhi': { entity_id: 'sensor.toronto_aqhi', state, attributes: {} } } },
  airYesterday: 3,
});

test('a sensor set gives the reading, on its own scale; without one, the index filled in on the US scale', () => {
  const sensor = airNow(ctx({ ...withSensor('4'), airSupply: supply(42) }));
  assert.equal(sensor?.value, 4);
  assert.equal(sensor.scale, AIR_SCALES.ca);
  assert.equal(sensor.yesterday, 3);
  assert.equal(sensor.supply, undefined);
  assert.equal(airNow(ctx({ ...withSensor('unavailable'), airSupply: supply(42) })), undefined, 'set but silent');
  const filled = airNow(ctx({ airSupply: supply(42) }));
  assert.equal(filled?.value, 42);
  assert.equal(filled.scale, AIR_SCALES.us);
  assert.equal(filled.yesterday, 31);
  assert.equal(airNow(ctx()), undefined);
});

test('with no sensor the tile shows the index filled in, and goes first once it matters', () => {
  assert.equal(airQuality.tile(ctx()), null);
  const fine = airQuality.tile(ctx({ airSupply: supply(42) })) ?? '';
  assert.match(fine, /<div class="big">42<\/div><div class="sub">Good<\/div>/);
  assert.match(fine, /which is worse than yesterday/, 'set against a day ago');
  const { rank } = airQuality;
  if (!rank) throw new Error('The tile has no rank.');
  assert.equal(rank(ctx({ airSupply: supply(42) })), RANK.usual);
  assert.equal(rank(ctx({ airSupply: supply(151) })), RANK.first);
  assert.match(airQuality.tile(ctx({ airSupply: supply(151) })) ?? '', /151 - Unhealthy/);
});

test('the sheet lists the pollutants filled in, the worst first in name, and where they come from', () => {
  const detail = airQualityDetail(ctx({ airSupply: supply(42) }));
  assert.match(detail, /Pollutant Details/);
  assert.match(detail, /PM<sub>2.5<\/sub>/);
  assert.match(detail, /µg\/m³/);
  assert.match(detail, /Primary Pollutant<\/h3><div class="detail-sub">O<sub>3<\/sub>/, 'ozone has the highest index');
  assert.ok(detail.includes(AIR_SOURCE));
  assert.doesNotMatch(airQualityDetail(ctx()), /Pollutant Details/);
});

test('the air quality map pins the index filled in', () => {
  const view = mapView(
    ctx({ config: normalizeConfig({ entity: 'weather.home', map: 'rainviewer' }), airSupply: supply(42) }),
    'air_quality',
  );
  assert.equal(view?.inputs.badge, '42');
});

// --- Loading ----------------------------------------------------------------------------
const home = (attributes: Record<string, unknown> = {}): HomeAssistant => ({
  states: { 'weather.home': { entity_id: 'weather.home', state: 'sunny', attributes } },
  config: { latitude: 38.63, longitude: -90.2, time_zone: 'America/Chicago' },
});
const host = (settings: Record<string, unknown> = {}, hass = home(), inSight = true) => {
  const redraws = vi.fn();
  const card: RecordsHost = {
    config: normalizeConfig({ entity: 'weather.home', weather_layout: 'page', ...settings }),
    readHass: hass,
    forecasts: { answered: true, own: {}, supplement: undefined, supply: () => undefined },
    timeZone: 'America/Chicago',
    inSight,
    redrawTiles: redraws,
  };
  return { records: new WeatherRecords(card), redraws };
};

test('the page fills in air quality for home when no sensor gives it, and asks again hourly', async () => {
  const { records, redraws } = host();
  await records.loadAirSupply(NOW);
  assert.equal(records.airSupply?.supply?.index, 42);
  assert.equal(redraws.mock.calls.length, 1);
  const url = new URL(asked.mock.calls[0]?.[0] ?? '');
  assert.equal(url.searchParams.get('latitude'), '38.630');
  await records.loadAirSupply(NOW + 30 * MINUTE);
  assert.equal(asked.mock.calls.length, 1);
  vi.stubGlobal('localStorage', storage());
  await records.loadAirSupply(NOW + HOUR);
  assert.equal(asked.mock.calls.length, 2);
});

test('the weather’s own place is asked for when its entity gives one', async () => {
  const { records } = host({}, home({ latitude: 35.68, longitude: 139.69 }));
  await records.loadAirSupply(NOW);
  const url = new URL(asked.mock.calls[0]?.[0] ?? '');
  assert.equal(url.searchParams.get('latitude'), '35.680');
  assert.equal(url.searchParams.get('longitude'), '139.690');
});

test('nothing is asked with a sensor set, with local only, without the tile, off the page or out of sight', async () => {
  for (const [settings, inSight] of [
    [{ air_quality_entity: 'sensor.aqi' }, true],
    [{ local_only: true }, true],
    [{ tiles: ['wind', 'moon'] }, true],
    [{ weather_layout: 'expanded' }, true],
    [{}, false],
  ] as const) {
    const { records } = host(settings, home(), inSight);
    await records.loadAirSupply(NOW);
    assert.equal(records.airSupply, undefined, JSON.stringify(settings));
  }
  assert.equal(asked.mock.calls.length, 0);
});

test('a try that brings nothing is made again in a quarter of an hour, keeping what came before for a while', async () => {
  const { records } = host();
  await records.loadAirSupply(NOW);
  vi.stubGlobal('localStorage', storage());
  asked.mockImplementation(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }));
  await records.loadAirSupply(NOW + HOUR);
  assert.equal(records.airSupply?.supply?.index, 42, 'an hour old still shows');
  await records.loadAirSupply(NOW + HOUR + 10 * MINUTE);
  assert.equal(asked.mock.calls.length, 2);
  await records.loadAirSupply(NOW + HOUR + 15 * MINUTE);
  assert.equal(asked.mock.calls.length, 3);
  await records.loadAirSupply(NOW + 2 * HOUR);
  assert.equal(records.airSupply.supply, null, 'two hours old is too old');
});

test('the tile holds its room while an answer comes for a place answered here before, and gives it up on a failure', async () => {
  const waiting = airQuality.tile(ctx({ airAwaited: true })) ?? '';
  assert.match(waiting, /Air Quality/);
  assert.doesNotMatch(waiting, /class="big"/);
  const fresh = host(),
    first = fresh.records.loadAirSupply(NOW);
  assert.equal(fresh.records.airAwaited, false, 'never answered here: offline it would only come to go');
  await first;
  // The page opened again later: the answer saved is too old to show, but says one will come.
  const again = host(),
    later = again.records.loadAirSupply(NOW + 2 * HOUR);
  assert.equal(again.records.airAwaited, true);
  await later;
  assert.equal(again.records.airAwaited, false, 'it came');
  const failing = host();
  asked.mockImplementation(() => Promise.reject(new TypeError('Offline.')));
  const failed = failing.records.loadAirSupply(NOW + 4 * HOUR);
  assert.equal(failing.records.airAwaited, true);
  await failed;
  assert.equal(failing.records.airAwaited, false, 'it won’t come, so the room goes');
  assert.equal(airQuality.tile(ctx({ airAwaited: failing.records.airAwaited })), null);
});
