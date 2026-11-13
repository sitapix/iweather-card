import { afterEach, expect, test } from 'vitest';
import { normalizeConfig } from '../src/card/config.ts';
import type { EntityState, HomeAssistant } from '../src/card/home-assistant.ts';
import { workOut, type UpdateSources } from '../src/card/update.ts';
import { conditionsBody } from '../src/cards/forecast/conditions.ts';
import { freshnessMarkup } from '../src/cards/forecast/freshness.ts';
import { sheetDays } from '../src/sheets/days.ts';
import { dataUpdates } from '../src/weather/freshness.ts';
import { weatherText } from '../src/weather/i18n.ts';
import { useWords } from '../src/weather/words.ts';
import { isRecord } from '../src/lib/values.ts';
import german from '../src/weather/word-files/de.json?raw';

const NOW = Date.parse('2026-11-03T18:10:00Z'),
  UPDATED = '2026-11-03T18:05:00Z',
  RETRIEVED = Date.parse('2026-11-03T16:10:00Z');
const entity = (entity_id: string, over: Partial<EntityState> = {}): EntityState => ({
  entity_id,
  state: 'sunny',
  last_updated: UPDATED,
  last_reported: new Date(NOW).toISOString(),
  attributes: { temperature: 20, temperature_unit: '°C', friendly_name: 'Home' },
  ...over,
});
const sources = (over: Partial<UpdateSources> = {}): UpdateSources => ({
  config: normalizeConfig({ entity: 'weather.home', weather_layout: 'page', local_only: true }),
  hass: { states: { 'weather.home': entity('weather.home') }, locale: { language: 'en-US', time_format: '24' } },
  data: {},
  supplied: false,
  awaited: false,
  nowcast: undefined,
  timeZone: 'UTC',
  prefersDark: false,
  text: locale => weatherText(locale ?? 'en'),
  mode: undefined,
  narrow: false,
  id: 'freshness',
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

afterEach(() => useWords('en', {}));

test('data updates use each configured source once, with entity-change times and friendly-name fallbacks', () => {
  const config = normalizeConfig({
      entity: 'weather.home',
      forecast_entity: 'weather.other',
      condition_entity: 'weather.other',
      temperature_entity: 'weather.home',
      humidity_entity: 'sensor.humidity',
    }),
    hass: HomeAssistant = {
      states: {
        'weather.home': entity('weather.home'),
        'weather.other': entity('weather.other', { attributes: { friendly_name: '  Forecast  ' } }),
        'sensor.humidity': entity('sensor.humidity', { state: '0', attributes: { friendly_name: ' ' } }),
        'sensor.unrelated': entity('sensor.unrelated'),
      },
    };
  expect(dataUpdates(config, hass, NOW, RETRIEVED)).toEqual([
    { kind: 'entity', entity: 'weather.home', name: 'Home', at: Date.parse(UPDATED) },
    { kind: 'entity', entity: 'weather.other', name: 'Forecast', at: Date.parse(UPDATED) },
    { kind: 'entity', entity: 'sensor.humidity', name: 'sensor.humidity', at: Date.parse(UPDATED) },
    { kind: 'supplement', at: RETRIEVED },
  ]);
});

test('missing, invalid and future update times stay absent instead of borrowing the report or render time', () => {
  const { config } = sources();
  for (const stamp of ['', 'invalid', '2026-11-03T18:10:01Z']) {
    const hass = { states: { 'weather.home': entity('weather.home', { last_updated: stamp }) } };
    expect(dataUpdates(config, hass, NOW)).toEqual([]);
  }
  expect(
    dataUpdates(
      config,
      {
        states: {
          'weather.home': { entity_id: 'weather.home', state: 'sunny', attributes: {}, last_reported: UPDATED },
        },
      },
      NOW,
    ),
  ).toEqual([]);
  for (const stamp of [NaN, Infinity, NOW + 1]) expect(dataUpdates(config, undefined, NOW, stamp)).toEqual([]);
});

test('updates retain source timestamps on unrelated renders and change only when the source changes', () => {
  const original = sources({ supplementAt: RETRIEVED }),
    first = workOut(original).ctx.freshness,
    later = workOut({ ...original, now: NOW + 60_000 }).ctx.freshness;
  expect(later).toEqual(first);
  const changed = workOut({
    ...original,
    hass: { states: { 'weather.home': entity('weather.home', { last_updated: new Date(NOW).toISOString() }) } },
  }).ctx.freshness;
  expect(changed?.[0]?.at).toBe(NOW);
  expect(changed?.at(-1)?.at).toBe(RETRIEVED);
});

test('freshness shows escaped source names, relative ages and the actual date and time in the chosen zone', () => {
  const update = workOut(
      sources({
        hass: {
          states: { 'weather.home': entity('weather.home', { attributes: { friendly_name: '<img src=x>' } }) },
          locale: { language: 'en-US', time_format: '24' },
        },
        timeZone: 'Asia/Kolkata',
        supplementAt: RETRIEVED,
      }),
    ),
    html = freshnessMarkup(update.ctx);
  expect(html).toContain('Home Assistant updated &lt;img src=x&gt;:');
  expect(html).not.toContain('<img');
  expect(html).toContain('datetime="2026-11-03T18:05:00.000Z"');
  expect(html).toContain('5 minutes ago');
  expect(html).toContain('23:35:00');
  expect(html).toContain('Nov 3, 2026');
  expect(html).toContain('Supplemental forecast retrieved:');
  expect(html).toContain('2 hours ago');
  expect(html).toContain('not weather observation times.');
});

test('freshness sentences and relative ages follow the selected language', () => {
  const table: unknown = JSON.parse(german);
  if (!isRecord(table)) throw new Error('Missing German words');
  useWords(
    'de',
    Object.fromEntries(
      Object.entries(table).flatMap(([key, value]) => (typeof value === 'string' ? [[key, value]] : [])),
    ),
  );
  const { ctx } = workOut(
      sources({
        hass: { states: { 'weather.home': entity('weather.home') }, locale: { language: 'de', time_format: '24' } },
      }),
    ),
    html = freshnessMarkup(ctx);
  expect(html).toContain('Datenaktualisierungen');
  expect(html).toContain('Home Assistant hat Home aktualisiert:');
  expect(html).toContain('vor 5 Minuten');
  expect(html).toContain('18:05:00');
});

test('conditions append freshness below the existing details, and omit the section when no timestamps exist', () => {
  const update = workOut(sources()),
    day = sheetDays(update.ctx, undefined).find(item => item.today);
  if (!day) throw new Error('Missing today');
  const inputs = { history: undefined, reach: null, pending: false, nowName: update.conditionText, named: String },
    context = { ...update.ctx, hourly: [] },
    html = conditionsBody(context, day, 'temperature', inputs),
    without = conditionsBody({ ...context, freshness: [] }, day, 'temperature', inputs);
  expect(html).toContain('Data Updates');
  expect(html.indexOf('Data Updates')).toBeGreaterThan(html.indexOf('About Feels Like Temperature'));
  expect(without).not.toContain('Data Updates');
  expect(html).toBe(without + freshnessMarkup(context));
});
