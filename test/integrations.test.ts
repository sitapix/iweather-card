import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { test } from 'vitest';
import { normalizeConfig } from '../src/card/config.ts';
import { workOut, type Update } from '../src/card/update.ts';
import { TILE_CARDS } from '../src/cards/index.ts';
import { TILES } from '../src/cards/ids.ts';
import { tileText } from '../src/cards/shared/tile.ts';
import { finite, isRecord, text } from '../src/lib/values.ts';
import { dateKey, forecasts } from '../src/weather/forecast-items.ts';
import { weatherText } from '../src/weather/i18n.ts';
import { NOW_READINGS, hourUnderWay, plausible } from '../src/weather/now.ts';
import { ENTITY, INTEGRATIONS, hassOf, type Integration } from './integrations.ts';

// Whatever the integration, the card shows all it sends, fills what it can, and never writes a
// value it doesn't have.
const update = (integration: Integration): Update =>
  workOut({
    config: normalizeConfig({ type: 'custom:iweather-card', entity: ENTITY, weather_layout: 'page' }),
    hass: hassOf(integration),
    data: integration.forecasts,
    supplied: false,
    awaited: false,
    nowcast: undefined,
    timeZone: integration.timeZone,
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
    now: integration.now,
  });
// Words a value that isn't there would leave behind.
const BROKEN = /\bNaN\b|\bundefined\b|\bnull\b|\[object|Infinity/;
const DAY = 86_400_000,
  MIDNIGHT = /^(\d{4}-\d{2}-\d{2})(?:T00:00(?::00)?(?:Z|[+-]\d{2}:?\d{2})?)?$/u;
const shown = (value: unknown) => finite(value) || (typeof value === 'string' && value !== '');

test('every integration in test/integrations is tested', () => {
  // A glob Vitest caches keeps the list of files it first found (see iweather/uncached-glob).
  const files = readdirSync(new URL('integrations/', import.meta.url)).filter(name => name.endsWith('.json'));
  assert.equal(INTEGRATIONS.length, files.length, 'a fixture the glob didn’t find');
  for (const integration of INTEGRATIONS) assert.ok(Number.isFinite(integration.now), integration.name);
});

for (const integration of INTEGRATIONS) {
  test(`${integration.name}: every reading it sends now or for this hour is shown`, () => {
    const { attrs } = update(integration),
      hour = hourUnderWay(forecasts(integration.forecasts.hourly?.forecast), integration.now),
      // A reading sent, as the card counts one (see plausible).
      sent = (key: (typeof NOW_READINGS)[number], from: Readonly<Record<string, unknown>> | undefined) => {
        const value = from?.[key];
        return finite(value) && plausible(key, value, from?.['wind_speed']);
      },
      lost = NOW_READINGS.filter(key => (sent(key, integration.attributes) || sent(key, hour)) && !shown(attrs[key]));
    assert.deepEqual(lost, []);
    // With a temperature and humidity there is a dew point, if only one worked out from them.
    assert.ok(!finite(attrs.temperature) || !finite(attrs.humidity) || finite(attrs.dew_point));
  });

  test(`${integration.name}: no tile, hour or day says a value it doesn't have`, () => {
    const now = update(integration);
    // Each tile drawn as itself, as the card hides one that throws.
    for (const id of TILES) {
      const markup = TILE_CARDS[id].tile(now.ctx);
      if (markup !== null) assert.doesNotMatch(tileText(markup), BROKEN, id);
    }
    assert.doesNotMatch(JSON.stringify(now.strip.points.map(point => point.temperature)), BROKEN);
    assert.doesNotMatch(now.conditionText, BROKEN);
    for (const day of now.days) assert.ok(finite(day.high) || finite(day.low), `a day with neither high nor low`);
  });

  test(`${integration.name}: a day stamped at midnight falls on the date it names`, () => {
    const named = new Map<string, number>();
    for (const entry of integration.sent['daily'] ?? []) {
      const datetime = isRecord(entry) ? entry['datetime'] : undefined,
        date = text(datetime) ? MIDNIGHT.exec(datetime)?.[1] : undefined,
        high = isRecord(entry) ? entry['temperature'] : undefined;
      if (date !== undefined && finite(high)) named.set(date, high);
    }
    const days = update(integration)
      .days.filter(day => !day.today)
      .map(day => [dateKey(day.time, integration.timeZone), day.high] as const);
    assert.deepEqual(
      days.filter(([date]) => named.has(date)),
      days.filter(([date]) => named.has(date)).map(([date]) => [date, named.get(date)]),
    );
  });

  test(`${integration.name}: its forecasts are drawn`, () => {
    const now = update(integration),
      { hourly, daily, twice_daily: twice } = integration.forecasts,
      ahead = (list: Parameters<typeof forecasts>[0], within: number) =>
        forecasts(list).some(entry => entry.time >= integration.now - within);
    // An hour that starts now is the strip's Now, and with no hours it runs by the day.
    const hours = ahead(hourly?.forecast, -1),
      days = ahead(daily?.forecast, DAY) || ahead(twice?.forecast, DAY);
    assert.deepEqual(
      { strip: now.strip.points.some(point => !point.now && !point.sun), days: now.days.length > 0 },
      { strip: hours || ((hourly?.forecast.length ?? 0) === 0 && days), days },
    );
  });
}

// Some integrations pass on a condition of their own when they can't map one to Home Assistant's.
test('a condition outside Home Assistant’s set is named as it comes, and draws', () => {
  for (const integration of INTEGRATIONS) {
    const now = update({ ...integration, state: 'Dark_LightRainThunderSun' });
    assert.equal(now.available, true, integration.name);
    assert.equal(now.conditionText, 'Dark_LightRainThunderSun', integration.name);
    for (const id of TILES) {
      const markup = TILE_CARDS[id].tile(now.ctx);
      if (markup !== null) assert.doesNotMatch(tileText(markup), BROKEN, `${integration.name} ${id}`);
    }
  }
});
