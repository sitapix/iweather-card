import { afterEach, beforeEach, test, vi, type Mock } from 'vitest';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/card/config.ts';
import type { HomeAssistant } from '../src/card/home-assistant.ts';
import { WeatherRecords, type RecordsHost } from '../src/card/records.ts';
import { nwsAlerts, nwsCovers, parseNwsAlerts } from '../src/cards/alerts/nws.ts';
import { pageAlerts } from '../src/cards/alerts/rules.ts';
import type { Fetcher } from '../src/lib/asking.ts';

const NOW = Date.parse('2026-11-07T03:10:00-06:00'),
  HOUR = 3_600_000,
  MINUTE = 60_000,
  PAGE = 'https://forecast.weather.gov/MapClick.php?lat=38.6300&lon=-90.2000';

// An alert as the service sends it, cut down to what the card reads and a little it doesn't.
const freeze = {
  '@id': 'https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.1',
  areaDesc: 'St. Louis City; St. Louis',
  sent: '2026-11-06T12:31:00-06:00',
  effective: '2026-11-06T12:31:00-06:00',
  onset: '2026-11-07T00:00:00-06:00',
  expires: '2026-11-07T03:45:00-06:00',
  ends: '2026-11-07T08:00:00-06:00',
  status: 'Actual',
  messageType: 'Update',
  severity: 'Severe',
  urgency: 'Expected',
  event: 'Freeze Warning',
  senderName: 'NWS St Louis MO',
  headline: 'Freeze Warning issued November 6 at 12:31PM CST until November 7 at 8:00AM CST by NWS St Louis MO',
  description: '* WHAT...Sub-freezing temperatures as low as 28 expected.',
  instruction: 'Take steps now to protect tender plants from the cold.',
  response: 'Execute',
  web: 'http://www.weather.gov',
};
const feature = (properties: Record<string, unknown>) => ({
  id: properties['@id'],
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[-90.3, 38.5]]] },
  properties,
});
const answer = (...alerts: Record<string, unknown>[]) => ({ type: 'FeatureCollection', features: alerts.map(feature) });

test('an alert ends when its event does, not when its message expires, and goes by the service', () => {
  const [alert, ...rest] = parseNwsAlerts(answer(freeze), PAGE) ?? [];
  assert.equal(rest.length, 0);
  assert.equal(alert?.event, 'Freeze Warning');
  assert.equal(alert.ends, Date.parse(freeze.ends));
  assert.equal(alert.starts, Date.parse(freeze.onset));
  assert.equal(alert.severity, 'Severe');
  assert.equal(alert.source, 'National Weather Service');
  assert.equal(alert.url, PAGE, 'the forecast page for the place, not the service’s home');
  assert.equal(alert.area, 'St. Louis City; St. Louis');
  assert.deepEqual(alert.responses, ['execute']);
  assert.equal(alert.description, `${freeze.description}\n\n${freeze.instruction}`);
});

test('tests, exercises and cancelled alerts are left out, and an answer without a list is none', () => {
  const alerts = parseNwsAlerts(
    answer(
      freeze,
      { ...freeze, status: 'Test', event: 'Tornado Warning' },
      { ...freeze, status: 'Exercise', event: 'Tsunami Warning' },
      { ...freeze, messageType: 'Cancel', event: 'Flood Warning' },
    ),
    PAGE,
  );
  assert.deepEqual(
    alerts?.map(alert => alert.event),
    ['Freeze Warning'],
  );
  assert.deepEqual(parseNwsAlerts(answer(), PAGE), []);
  assert.equal(parseNwsAlerts({ title: 'Too many requests' }, PAGE), null);
});

test('the service covers its own integration’s weather, and any in the United States and its territories', () => {
  assert.equal(nwsCovers('nws', undefined), true);
  assert.equal(nwsCovers('met', 'US'), true);
  assert.equal(nwsCovers(undefined, 'pr'), true);
  assert.equal(nwsCovers('met', 'CH'), false);
  assert.equal(nwsCovers(undefined, null), false);
});

test('alert sensors set take over from the alerts asked for', () => {
  const asked = parseNwsAlerts(answer(freeze), PAGE) ?? [],
    hass: HomeAssistant = {
      states: {
        'sensor.alerts': {
          entity_id: 'sensor.alerts',
          state: '1',
          attributes: { Alerts: [{ Event: 'Flood Watch', Severity: 'Moderate' }] },
        },
      },
    },
    page = normalizeConfig({ entity: 'weather.home', weather_layout: 'page' }),
    sensors = normalizeConfig({ entity: 'weather.home', weather_layout: 'page', alert_entities: ['sensor.alerts'] });
  assert.deepEqual(
    pageAlerts(page, hass, NOW, asked).map(alert => alert.event),
    ['Freeze Warning'],
  );
  assert.deepEqual(
    pageAlerts(sensors, hass, NOW, asked).map(alert => alert.event),
    ['Flood Watch'],
  );
  assert.deepEqual(pageAlerts(normalizeConfig({ entity: 'weather.home' }), hass, NOW, asked), []);
});

// --- Asking -----------------------------------------------------------------------------
const storage = () => {
  const held = new Map<string, string>();
  return {
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => void held.set(key, value),
    held,
  };
};
const good: Fetcher = () => Promise.resolve({ ok: true, json: () => Promise.resolve(answer(freeze)) });
let asked: Mock<Fetcher>, saved: ReturnType<typeof storage>;
beforeEach(() => {
  asked = vi.fn<Fetcher>(good);
  saved = storage();
  vi.stubGlobal('fetch', asked);
  vi.stubGlobal('localStorage', saved);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

test('one request names the point, to four places, and only real alerts; cards asking together share it', async () => {
  const [first, second] = await Promise.all([
    nwsAlerts(38.627_31, -90.199_42, NOW),
    nwsAlerts(38.627_31, -90.199_42, NOW),
  ]);
  assert.equal(asked.mock.calls.length, 1);
  assert.equal(first, second);
  const url = new URL(asked.mock.calls[0]?.[0] ?? '');
  assert.equal(url.origin, 'https://api.weather.gov');
  assert.equal(url.pathname, '/alerts/active');
  assert.equal(url.searchParams.get('point'), '38.6273,-90.1994');
  assert.equal(url.searchParams.get('status'), 'actual');
  assert.equal(first?.alerts[0]?.url, 'https://forecast.weather.gov/MapClick.php?lat=38.6273&lon=-90.1994');
});

test('an answer is kept for five minutes, without the areas’ outlines', async () => {
  await nwsAlerts(38.63, -90.2, NOW);
  const kept = [...saved.held.values()].join('');
  assert.ok(kept.includes('Freeze Warning'));
  assert.ok(!kept.includes('Polygon'));
  assert.equal((await nwsAlerts(38.63, -90.2, NOW + 4 * MINUTE))?.at, NOW);
  assert.equal(asked.mock.calls.length, 1);
  await nwsAlerts(38.63, -90.2, NOW + 5 * MINUTE);
  assert.equal(asked.mock.calls.length, 2);
});

// --- Loading ----------------------------------------------------------------------------
const home = (country?: string, platform?: string): HomeAssistant => ({
  states: { 'weather.home': { entity_id: 'weather.home', state: 'clear-night', attributes: {} } },
  ...(platform ? { entities: { 'weather.home': { platform } } } : {}),
  config: { latitude: 38.63, longitude: -90.2, time_zone: 'America/Chicago', ...(country ? { country } : {}) },
});
const host = (settings: Record<string, unknown> = {}, hass = home(undefined, 'nws'), inSight = true) => {
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

test('the page asks for the alerts where the service covers the weather, every five minutes', async () => {
  for (const hass of [home(undefined, 'nws'), home('US', 'met')]) {
    vi.stubGlobal('localStorage', storage());
    const { records, redraws } = host({}, hass);
    await records.loadNwsAlerts(NOW);
    assert.equal(records.alerts?.found?.alerts[0]?.event, 'Freeze Warning');
    assert.equal(redraws.mock.calls.length, 1);
  }
  const { records } = host();
  vi.stubGlobal('localStorage', storage());
  await records.loadNwsAlerts(NOW);
  const calls = asked.mock.calls.length;
  await records.loadNwsAlerts(NOW + 4 * MINUTE);
  assert.equal(asked.mock.calls.length, calls);
  vi.stubGlobal('localStorage', storage());
  await records.loadNwsAlerts(NOW + 5 * MINUTE);
  assert.equal(asked.mock.calls.length, calls + 1);
});

test('nothing is asked with alert sensors set, with local only, off the page, out of sight, or elsewhere', async () => {
  for (const [settings, hass, inSight] of [
    [{ alert_entities: ['sensor.alerts'] }, home(undefined, 'nws'), true],
    [{ local_only: true }, home(undefined, 'nws'), true],
    [{ weather_layout: 'expanded' }, home(undefined, 'nws'), true],
    [{}, home(undefined, 'nws'), false],
    [{}, home('CH', 'met'), true],
    [{}, home(), true],
  ] as const) {
    const { records } = host(settings, hass, inSight);
    await records.loadNwsAlerts(NOW);
    assert.equal(records.alerts?.found ?? undefined, undefined, JSON.stringify([settings, hass.config, inSight]));
  }
  assert.equal(asked.mock.calls.length, 0);
});

test('a try that brings nothing is made again in five minutes, keeping the alerts for an hour', async () => {
  const { records } = host();
  await records.loadNwsAlerts(NOW);
  vi.stubGlobal('localStorage', storage());
  asked.mockImplementation(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }));
  await records.loadNwsAlerts(NOW + 30 * MINUTE);
  assert.equal(records.alerts?.found?.alerts.length, 1, 'half an hour old still shows');
  await records.loadNwsAlerts(NOW + 34 * MINUTE);
  assert.equal(asked.mock.calls.length, 2);
  await records.loadNwsAlerts(NOW + 35 * MINUTE);
  assert.equal(asked.mock.calls.length, 3);
  await records.loadNwsAlerts(NOW + HOUR);
  assert.equal(records.alerts.found, null, 'an hour old is too old');
});

test('alerts asked for go once alert sensors are set', async () => {
  const hass = home(undefined, 'nws'),
    { records, redraws } = host({}, hass);
  await records.loadNwsAlerts(NOW);
  assert.ok(records.alerts);
  const card = {
      ...records.card,
      config: normalizeConfig({ entity: 'weather.home', weather_layout: 'page', alert_entities: ['sensor.alerts'] }),
    },
    later = new WeatherRecords(card);
  later.alerts = records.alerts;
  await later.loadNwsAlerts(NOW + MINUTE);
  assert.equal(later.alerts, undefined);
  assert.ok(redraws.mock.calls.length >= 1);
});
