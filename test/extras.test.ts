import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import type { Connection, ForecastEntry } from '../src/card/home-assistant.ts';
import {
  climateIn,
  climateNormals,
  dayBand,
  openMeteoClimate,
  openMeteoDayBand,
  openMeteoRecentRain,
  statisticsDayBand,
  type DayRecord,
} from '../src/cards/averages/climate.ts';
import { minutePoints, minuteSeries, nextHourForecast, nextHourOf } from '../src/cards/next-hour/rules.ts';
import { nextHourMarkup } from '../src/cards/next-hour/panel.ts';
import { recentPrecipitation } from '../src/cards/precipitation/recent.ts';
import {
  tileGrid,
  tilePoint,
  radarFrames,
  openMeteoWind,
  rainTimeline,
  steadyWind,
  tilePlace,
  windHour,
  WIND_STEP,
  WIND_HOURS,
} from '../src/map/sources.ts';
import { windAt } from '../src/map/sources.ts';
import { averageToday } from '../src/cards/averages/rules.ts';
import { normalizeConfig } from '../src/card/config.ts';

const now = Date.UTC(2026, 9, 27, 15);

test('climate normals average each date over the years, with a normal range', () => {
  const days: DayRecord[] = [];
  for (const year of [2019, 2020, 2021])
    for (let d = 0; d < 365; d++) {
      const date = new Date(Date.UTC(year, 0, 1) + d * 86400000).toISOString().slice(0, 10);
      days.push({ date, high: 60 + (year - 2020) * 3, low: 40, precipitation: 1 });
    }
  const climate = climateNormals(days);
  assert.ok(climate);
  assert.equal(climate.years, 3);
  assert.equal(climate.since, 2019);
  const normal = climate.normals['10-27'];
  assert.ok(normal);
  assert.equal(Math.round(normal.high), 60);
  assert.deepEqual(normal.range, [57, 63]);
  assert.equal(Math.round(climate.months[9]?.precipitation ?? Number.NaN), 31);
  assert.equal(climateNormals(days.filter(day => day.date.startsWith('2020'))), null);
  const ctx = { climate, now, timeZone: 'UTC', daily: [{ today: true, high: 65 }] };
  const average = averageToday(ctx);
  assert.deepEqual([average?.difference, average?.label], [5, 'above average daily high']);
});

test('open-meteo normals come from one archive request', async () => {
  // Node has no localStorage here; the card reads and writes the cache inside try/catch.
  let url: string | undefined;
  const fetcher = (request: string) => {
    url = request;
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          daily: {
            time: ['2019-10-27', '2020-10-27'],
            temperature_2m_max: [60, 64],
            temperature_2m_min: [40, 44],
            precipitation_sum: [0, 1],
          },
        }),
    });
  };
  const climate = await openMeteoClimate(38.6, -90.2, '°F', 'in', fetcher);
  assert.match(url ?? '', /start_date=1991-01-01&end_date=2020-12-31/);
  assert.match(url ?? '', /temperature_unit=fahrenheit&precipitation_unit=inch/);
  assert.equal(climate?.normals['10-27']?.high, 62);
});

test('the normal range through a day is each hour’s middle 80%', () => {
  const hour = 3600000,
    readings = Array.from({ length: 24 * 30 }, (_, i) => ({ time: i * hour, value: (i % 24) + Math.floor(i / 24) }));
  const band = dayBand(readings, 'UTC');
  // Hour 5 reads 5…34 over the 30 days: its 10th percentile is 8, its 90th 32.
  assert.deepEqual([band?.low[5], band?.high[5]], [8, 32]);
  assert.equal(dayBand(readings.slice(0, 24 * 10), 'UTC'), null);
});

test('the normal range comes in one request per date, kept, and not asked again soon after failing', async () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  vi.useFakeTimers({ now: Date.parse('2026-10-30T12:00:00Z') });
  try {
    const urls: string[] = [];
    let ok = true;
    const years = Array.from({ length: 30 }, (_, i) => ({
      hourly: {
        time: Array.from({ length: 15 * 24 }, (_, h) => Date.UTC(1991 + i, 9, 23) / 1000 + h * 3600),
        temperature_2m: Array.from({ length: 15 * 24 }, (_, h) => 50 + (h % 24)),
      },
    }));
    const fetcher = (url: string) => {
      urls.push(url);
      return Promise.resolve({ ok, status: ok ? 200 : 429, json: () => Promise.resolve(years) });
    };
    const ask = (date: string) => openMeteoDayBand(38.63, -90.2, '°F', date, 'UTC', fetcher);
    // Asked twice at once: one request, a window a week either side of the date in each year.
    const [band] = await Promise.all([ask('10-30'), ask('10-30')]);
    const url = urls.join(' ');
    assert.equal(urls.length, 1);
    assert.equal(url.match(/38\.630/g)?.length, 30);
    assert.match(url, /start_date=1991-10-23,1992-10-23,.*&end_date=1991-11-06,/);
    assert.match(url, /&timezone=GMT&timeformat=unixtime$/);
    assert.equal(band?.low[0], 50);
    // Kept: asked again, it isn't fetched.
    await ask('10-30');
    assert.equal(urls.length, 1);
    // A failure isn't asked for again within the hour, and is after it.
    ok = false;
    assert.equal(await ask('10-31'), null);
    assert.equal(await ask('11-01'), null);
    assert.equal(urls.length, 2);
    ok = true;
    vi.advanceTimersByTime(3600001);
    assert.ok(await ask('11-01'));
    assert.equal(urls.length, 3);
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

test('the normal range can come from Home Assistant’s own hourly statistics', async () => {
  const asked: unknown[] = [];
  const hass = {
    config: { time_zone: 'UTC' },
    callWS: (message: unknown) => {
      asked.push(message);
      return Promise.resolve({
        'sensor.outside': Array.from({ length: 15 * 24 }, (_, h) => ({ start: h * 3600000, mean: 40 + (h % 24) })),
      });
    },
  };
  const band = await statisticsDayBand(
    hass,
    'sensor.outside',
    '°F',
    '10-30',
    2024,
    'UTC',
    Date.parse('2026-10-30T12:00:00Z'),
  );
  // 2024 and 2025, each its own hourly request a week either side of the date.
  assert.equal(asked.length, 2);
  assert.match(
    JSON.stringify(asked[0]),
    /"start_time":"2024-10-23T00:00:00.000Z","end_time":"2024-11-06T23:59:59.999Z".*"period":"hour","types":\["mean"\]/,
  );
  assert.deepEqual([band?.low[3], band?.high[3]], [43, 43]);
  const local = await statisticsDayBand(
    hass,
    'sensor.outside',
    '°F',
    '10-30',
    2024,
    'America/Los_Angeles',
    Date.UTC(2026, 9, 30),
  );
  assert.equal(local?.high[12], 60);
  assert.match(JSON.stringify(asked[2]), /2024-10-23T07:00:00.000Z.*2024-11-07T07:59:59.999Z/);
});

test('next-hour titles name the hour, and a low chance reads as possible', () => {
  const at = (pick: (minute: number) => number) => Array.from({ length: 60 }, (_, minute) => pick(minute));
  assert.deepEqual(
    nextHourForecast(
      at(() => 4),
      'mm',
    ),
    { title: 'Rain Forecasted', text: 'Rain for the next hour' },
  );
  assert.equal(
    nextHourForecast(
      at(m => (m < 20 ? 4 : 0)),
      'mm',
    )?.title,
    'Rain Stopping',
  );
  assert.equal(
    nextHourForecast(
      at(m => (m < 10 || m >= 25 ? 4 : 0)),
      'mm',
    )?.title,
    'Rain Stopping Briefly',
  );
  assert.equal(
    nextHourForecast(
      at(m => (m < 10 || m >= 45 ? 4 : 0)),
      'mm',
    )?.title,
    'Rain Stopping',
  );
  assert.equal(
    nextHourForecast(
      at(m => (m < 30 ? 0 : 9)),
      'mm',
      'snow',
    )?.title,
    'Snow Forecasted',
  );
  assert.deepEqual(
    nextHourForecast(
      at(() => 9),
      'mm',
      'snow',
      30,
    ),
    {
      title: 'Possible Flurries',
      text: 'Chance of flurries for the next hour',
    },
  );
  assert.deepEqual(
    nextHourForecast(
      at(m => (m < 30 ? 0 : 4)),
      'mm',
      'rain',
      20,
    ),
    {
      title: 'Possible Light Rain',
      text: 'Chance of light rain in the next hour',
    },
  );
});

test('a precipitation sensor adds up what fell lately', () => {
  const hour = 3600000,
    end = 10 * hour;
  // A rate sensor: 2 mm/h for the last three hours, nothing before.
  const rate = [
    { time: 0, value: 0 },
    { time: 7 * hour, value: 2 },
  ];
  assert.equal(recentPrecipitation(rate, true, end, 6).amount, 6);
  assert.equal(recentPrecipitation(rate, true, end, 1).amount, 2);
  // A gauge's running total that resets at midnight: rises count, the reset doesn't.
  const gauge = [
    { time: 2 * hour, value: 4 },
    { time: 3 * hour, value: 5 },
    { time: 6 * hour, value: 0 },
    { time: 8 * hour, value: 1.5 },
  ];
  assert.equal(recentPrecipitation(gauge, false, end, 6).amount, 1.5);
  assert.equal(recentPrecipitation(gauge, false, end, 24).amount, 2.5);
});

// A nowcast sensor's readings, five minutes apart from `back` minutes ago, on a card that reads it.
const nowcast = (rate: (reading: number) => number, back = 0, step = 5) => {
  const config = normalizeConfig({ entity: 'weather.home', weather_layout: 'page', next_hour_entity: 'sensor.rain' }),
    forecast = Array.from({ length: 13 }, (_, i) => ({
      datetime: new Date(now + (i * step - back) * 60000).toISOString(),
      precipitation: rate(i),
    }));
  return nextHourOf(
    config,
    {
      states: {
        'sensor.rain': {
          entity_id: 'sensor.rain',
          state: '0',
          attributes: { unit_of_measurement: 'mm/h', forecast },
        },
      },
    },
    { entity_id: 'weather.home', state: 'rainy', attributes: {} },
    now,
    undefined,
  );
};
const bars = (html: string) => [...html.matchAll(/<rect x="([\d.]+)%" y="([\d.]+)%" width="3\.75"[^>]*>/g)];

test('the next hour draws what is falling, starting and stopping, and says so in its title', () => {
  const starting = nowcast(i => (i >= 3 ? 4 : 0)),
    stopping = nowcast(i => (i < 6 ? 4 : 0)),
    continuing = nowcast(() => 4);
  assert.deepEqual([starting.data?.title, starting.data?.text], ['Rain Forecasted', 'Rain starting in 15 min']);
  assert.deepEqual([stopping.data?.title, stopping.data?.text], ['Rain Stopping', 'Rain stopping in 30 min']);
  assert.deepEqual([continuing.data?.title, continuing.data?.text], ['Rain Forecasted', 'Rain for the next hour']);
  const drawn = (panel: ReturnType<typeof nextHourOf>) =>
    panel.data ? bars(nextHourMarkup(panel.data, 'a')).map(match => Number(match[1])) : [];
  assert.equal(drawn(starting).length, 45);
  assert.ok((drawn(starting)[0] ?? 0) > 25, 'none before it starts');
  assert.equal(drawn(stopping).length, 30);
  assert.ok((drawn(stopping).at(-1) ?? 100) < 50, 'none after it stops');
  assert.equal(drawn(continuing).length, 60);
  assert.equal(drawn(continuing)[0], 0.83, 'each in the middle of its minute');
  assert.equal(drawn(continuing)[59], 99.17);
});
test('a next-hour bar stands 3.75 px wide on the chart’s scale, rounded at its top, floating over the baseline', () => {
  const panel = nowcast(() => 4),
    html = panel.data ? nextHourMarkup(panel.data, 'a') : '';
  assert.match(html, /<rect x="[\d.]+%" y="[\d.]+%" width="3\.75" height="[\d.]+%" rx="1\.25"\/>/);
  // A clip that ends 2.5 px up squares off the foot.
  assert.match(html, /<clipPath id="next-foot-a"><rect y="-2\.5" width="100%" height="100%"\/>/);
  assert.match(html, /clip-path="url\(#next-foot-a\)"/);
  assert.match(
    html,
    /x2="0" y2="100%"><stop offset="0" stop-color="#caf3fe"\/><stop offset="1" stop-color="#86ddff"\/>/,
  );
  // Three dashed levels at even heights, a solid base, and nothing on the tile naming them.
  assert.deepEqual(
    [...html.matchAll(/<line x2="100%" y1="([\d.]+)%"/g)].map(match => match[1]),
    ['66.7', '33.3', '0.0'],
  );
  assert.match(html, /<line class="base" x2="100%" y1="100%" y2="100%"\/>/);
  assert.doesNotMatch(html, /<span style="top:/);
});
test('next-hour snow keeps its own word and title, and a bar as high as it feels', () => {
  const snow = nextHourOf(
    normalizeConfig({ entity: 'weather.home', weather_layout: 'page', next_hour_entity: 'sensor.rain' }),
    {
      states: {
        'sensor.rain': {
          entity_id: 'sensor.rain',
          state: '0',
          attributes: {
            unit_of_measurement: 'mm/h',
            forecast: [0, 1, 2, 3].map(i => ({
              datetime: new Date(now + i * 20 * 60000).toISOString(),
              precipitation: 0.4,
            })),
          },
        },
      },
    },
    { entity_id: 'weather.home', state: 'snowy', attributes: {} },
    now,
    undefined,
  );
  assert.equal(snow.felt, 'snow');
  assert.deepEqual([snow.data?.title, snow.data?.text], ['Snow Forecasted', 'Flurries for the next hour']);
});
test('the next hour’s chart starts at the reading under way, and its minutes gone are dimmed', () => {
  const drawn = (panel: ReturnType<typeof nowcast>) => {
    if (!panel.data) throw new Error('No panel.');
    return { ...panel.data, html: nextHourMarkup(panel.data, 'a') };
  };
  const { past, chart, series, html } = drawn(nowcast(() => 4, 4));
  assert.deepEqual([past, chart.length, series.length], [4, 60, 60]);
  assert.equal((html.match(/class="past"/g) ?? []).length, 4);
  assert.match(html, /<line class="now" x1="6\.67%" x2="6\.67%" y2="100%"\/>/);
  assert.match(html, /<span style="left:6\.7%">Now<\/span><span style="left:23\.3%">10m<\/span>/);
  const fresh = drawn(nowcast(() => 4));
  assert.equal(fresh.past, 0);
  assert.doesNotMatch(fresh.html, /class="past"|class="now"/);
  // Later labels give way rather than run off the chart.
  const old = drawn(nowcast(() => 4, 12, 15));
  assert.equal(old.past, 12);
  assert.doesNotMatch(old.html, />50m</);
});
test('next-hour data needs sub-hourly steps and reads naturally', () => {
  const list = Array.from({ length: 13 }, (_, i) => ({
    datetime: new Date(now + i * 300000).toISOString(),
    precipitation: i >= 3 && i < 9 ? 2 : 0,
  }));
  const points = minutePoints({ attributes: { forecast: list } }, now);
  const series = minuteSeries(points, now);
  assert.equal(series.length, 60);
  assert.equal(nextHourForecast(series, 'mm')?.text ?? null, 'Light rain starting in 15 min, lasting for 30 min');
  const at = (pick: (minute: number) => number) => Array.from({ length: 60 }, (_, minute) => pick(minute));
  assert.equal(
    nextHourForecast(
      at(() => 0.3),
      'mm',
      'snow',
    )?.text ?? null,
    'Flurries for the next hour',
    'light snow is flurries',
  );
  assert.equal(
    nextHourForecast(
      at(() => 9),
      'mm',
      'sleet',
    )?.text ?? null,
    'Sleet for the next hour',
    'sleet has no heavy form',
  );
  assert.equal(
    nextHourForecast(
      at(m => (m < 10 || m >= 30 ? 4 : 0)),
      'mm',
    )?.text ?? null,
    'Rain stopping in 10 min, starting again 20 min later',
  );
  assert.equal(
    nextHourForecast(
      at(m => (m < 20 ? 1 : 9)),
      'mm',
    )?.text ?? null,
    'Light rain for 20 min, followed by heavy rain',
  );
  assert.equal(
    nextHourForecast(
      at(m => (m < 5 ? 0 : m < 25 ? 1 : 9)),
      'mm',
    )?.text ?? null,
    'Light rain starting in 5 min, then turning to heavy rain 20 min later',
  );
  assert.equal(
    nextHourForecast(
      series.map(() => 9),
      'mm',
      'snow',
    )?.text ?? null,
    'Heavy snow for the next hour',
  );
  assert.equal(
    nextHourForecast(
      series.map((_, i) => (i < 20 ? 4 : 0)),
      'mm',
    )?.text ?? null,
    'Rain stopping in 20 min',
  );
  assert.equal(
    nextHourForecast(
      series.map(() => 0),
      'mm',
    )?.text ?? null,
    null,
  );
  const hourly = Array.from({ length: 3 }, (_, i) => ({
    datetime: new Date(now + i * 3600000).toISOString(),
    precipitation: 1,
  }));
  assert.deepEqual(minutePoints(hourly, now), []);
  assert.equal(
    minutePoints(
      [
        { time: now / 1000, precipIntensity: 1 },
        { time: now / 1000 + 60, precipIntensity: 2 },
      ],
      now,
    ).length,
    2,
  );
});

test('radar tiles cover the view around home', async () => {
  const point = tilePoint(0, 0, 1);
  assert.deepEqual([point.x, point.y], [1, 1]);
  const tiles = tileGrid(38.63, -90.2, 7, 400, 200);
  assert.ok(
    tiles.length >= 2 &&
      tiles.every(tile => tile.z === 7 && tile.left <= 400 && tile.top <= 200 && tile.left > -256 && tile.top > -256),
  );
  const frames = await radarFrames(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          host: 'https://h',
          radar: { past: [{ time: 10, path: '/a' }], nowcast: [{ time: 20, path: '/b' }] },
        }),
    }),
  );
  assert.deepEqual(frames, [{ time: 10000, url: 'https://h/a' }]);
});

test('the optional sources validate', () => {
  const base = { entity: 'weather.home' };
  for (const extra of [
    { averages: 'open-meteo' },
    { averages: 'sensor.outdoor' },
    { next_hour_entity: 'weather.nowcast' },
    { map: 'rainviewer' },
    { map_tile_url: 'https://t/{z}/{x}/{y}.png' },
    { map_tile_url: 'https://t/MapServer/tile/{z}/{y}/{x}' },
    { map_layers: { wind: 'https://{s}.t/{z}/{x}/{y}.png' } },
    { place_name: 'St. Louis' },
  ])
    assert.doesNotThrow(() => normalizeConfig({ ...base, ...extra }));
  for (const extra of [
    { averages: 'noaa' },
    { next_hour_entity: 'light.x' },
    { map: 'google' },
    { map_tile_url: 'http://t/{z}/{x}/{y}.png' },
    { map_tile_url: 'https://t/{z}/{x}.png' },
    { place_name: 5 },
  ])
    assert.throws(() => normalizeConfig({ ...base, ...extra }));
});

test('the map shows wind with the wind view, else precipitation when it is near, then air quality that matters, then wind on a dry blowing day, then the radar or temperature', async () => {
  const { mapKind } = await import('../src/map/sources.ts');
  const now = Date.UTC(2026, 9, 27, 12),
    soon = (minutes: number, precipitation: number): ForecastEntry => ({
      datetime: new Date(now + minutes * 60000).toISOString(),
      precipitation,
    });
  // Precipitation near: the next-hour panel is up, it is falling, or the coming hour brings it within 50 minutes.
  assert.equal(mapKind({ state: 'sunny', now, nextHour: true, airSignificant: true }), 'precipitation');
  assert.equal(mapKind({ state: 'rainy', now, airSignificant: true }), 'precipitation');
  assert.equal(mapKind({ state: 'cloudy', now, hourly: [soon(40, 0.2)] }), 'precipitation');
  assert.equal(mapKind({ state: 'cloudy', now, hourly: [soon(70, 0.2)] }), 'temperature');
  // Then air quality that matters, then the radar, else temperature.
  assert.equal(mapKind({ state: 'windy', now, radar: true, airSignificant: true }), 'air_quality');
  assert.equal(mapKind({ state: 'sunny', now }), 'temperature');
  assert.equal(mapKind({ state: 'sunny', now, radar: true }), 'precipitation');
  // The forecast panel showing wind puts the wind map first, even with rain near.
  assert.equal(mapKind({ mode: 'wind', state: 'rainy', now, radar: true, airSignificant: true }), 'wind');
  assert.equal(mapKind({ mode: 'rain', state: 'sunny', now, radar: true, airSignificant: true }), 'precipitation');
  assert.equal(mapKind({ mode: 'rain', state: 'sunny', now, airSignificant: true }), 'air_quality');
  assert.equal(mapKind({ mode: 'rain', state: 'sunny', now }), 'temperature');
});

test('a dry day turns the map to the wind when it is windy or gusting past 15 mph', async () => {
  const { mapKind } = await import('../src/map/sources.ts');
  const now = Date.UTC(2026, 9, 27, 12),
    hour = (hours: number, chance: number): ForecastEntry => ({
      datetime: new Date(now + hours * 3600000).toISOString(),
      precipitation_probability: chance,
    });
  // Gusts count only past the limit, and either way the windy conditions do.
  assert.equal(mapKind({ state: 'cloudy', now, radar: true, gust: 24.14 }), 'precipitation');
  assert.equal(mapKind({ state: 'cloudy', now, radar: true, gust: 24.2 }), 'wind');
  assert.equal(mapKind({ state: 'sunny', now, gust: 30 }), 'wind');
  assert.equal(mapKind({ state: 'windy', now, radar: true }), 'wind');
  assert.equal(mapKind({ state: 'windy-variant', now, radar: true, gust: 5 }), 'wind');
  // One wet hour of the next twelve leaves the day dry; two don't.
  assert.equal(mapKind({ state: 'cloudy', now, radar: true, gust: 40, hourly: [hour(3, 45)] }), 'wind');
  assert.equal(
    mapKind({ state: 'cloudy', now, radar: true, gust: 40, hourly: [hour(3, 45), hour(5, 30)] }),
    'precipitation',
  );
  // Hours past the twelfth, and chances under 30%, don't count.
  assert.equal(mapKind({ state: 'cloudy', now, radar: true, gust: 40, hourly: [hour(3, 29), hour(5, 29)] }), 'wind');
  assert.equal(mapKind({ state: 'cloudy', now, radar: true, gust: 40, hourly: [hour(13, 80), hour(14, 80)] }), 'wind');
  // An hour with no chance on it goes by what it brings.
  const bringing = (hours: number): ForecastEntry => ({
    datetime: new Date(now + hours * 3600000).toISOString(),
    condition: 'rainy',
  });
  assert.equal(
    mapKind({ state: 'cloudy', now, radar: true, gust: 40, hourly: [bringing(3), bringing(4)] }),
    'precipitation',
  );
  // Rain falling or near wins, and so does air quality that matters.
  assert.equal(mapKind({ state: 'rainy', now, radar: true, gust: 40 }), 'precipitation');
  assert.equal(mapKind({ state: 'sunny', now, radar: true, gust: 40, nextHour: true }), 'precipitation');
  assert.equal(mapKind({ state: 'sunny', now, radar: true, gust: 40, airSignificant: true }), 'air_quality');
  // A chosen precipitation view stays on it, even without radar to show.
  assert.equal(mapKind({ mode: 'rain', state: 'sunny', now, radar: true, gust: 40 }), 'precipitation');
  assert.equal(mapKind({ mode: 'rain', state: 'sunny', now, gust: 40 }), 'temperature');
});

test('the large map opens further out the longer precipitation is off, and each other layer at its own distance', async () => {
  const { openingZoom } = await import('../src/map/sources.ts');
  const now = Date.UTC(2026, 9, 27, 12),
    soon = (hours: number): ForecastEntry[] => [
      { datetime: new Date(now + hours * 3600000).toISOString(), precipitation: 0.2 },
    ],
    rain = (hourly: ForecastEntry[]) => openingZoom('precipitation', { hourly, now });
  // By the outlook: falling now and starting within the hour, which only the minute forecast tells.
  assert.equal(openingZoom('precipitation', { outlook: 'now', now }), 8.5);
  assert.equal(openingZoom('precipitation', { outlook: 'nextHour', now }), 8);
  // Otherwise the first wet hour, in whole hours off.
  assert.equal(rain(soon(1)), 6.5);
  assert.equal(rain(soon(2)), 6.5);
  assert.equal(rain(soon(5)), 5.5);
  assert.equal(rain(soon(7)), 4);
  assert.equal(rain([]), 4);
  // Rain begun over an hour ago doesn't count, and the soonest of several does.
  assert.equal(rain(soon(-2)), 4);
  assert.equal(rain([...soon(5), ...soon(2)]), 6.5);
  assert.equal(openingZoom('wind', { state: 'rainy', now }), 6);
  assert.equal(openingZoom('temperature', { state: 'rainy', now }), 6.5);
  assert.equal(openingZoom('air_quality', { state: 'rainy', now }), 10);
});

test('readings can come from other sensors, converted into the weather entity’s units', async () => {
  const { withSensors, missingReadings } = await import('../src/weather/sources.ts');
  const weather = {
    entity_id: 'weather.home',
    state: 'sunny',
    attributes: {
      temperature: 70,
      temperature_unit: '°F',
      wind_speed: 5,
      wind_speed_unit: 'mph',
      pressure_unit: 'inHg',
    },
  };
  const hass = {
    states: {
      'weather.home': weather,
      'sensor.uv': { entity_id: 'sensor.uv', state: '6.2', attributes: {} },
      'sensor.gust': { entity_id: 'sensor.gust', state: '36', attributes: { unit_of_measurement: 'km/h' } },
      'sensor.dew': { entity_id: 'sensor.dew', state: '10', attributes: { unit_of_measurement: '°C' } },
      'sensor.dir': { entity_id: 'sensor.dir', state: 'SW', attributes: {} },
      'sensor.visibility': { entity_id: 'sensor.visibility', state: '8', attributes: { unit_of_measurement: 'km' } },
      'sensor.broken': { entity_id: 'sensor.broken', state: 'unavailable', attributes: { unit_of_measurement: 'hPa' } },
    },
  };
  const config = {
    entity: 'weather.home',
    uv_index_entity: 'sensor.uv',
    wind_gust_speed_entity: 'sensor.gust',
    dew_point_entity: 'sensor.dew',
    wind_bearing_entity: 'sensor.dir',
    visibility_entity: 'sensor.visibility',
    pressure_entity: 'sensor.broken',
  };
  const attrs = withSensors(hass, config).states['weather.home']?.attributes;
  assert.ok(attrs);
  assert.equal(attrs.uv_index, 6.2);
  assert.ok(Math.abs((attrs.wind_gust_speed ?? Number.NaN) - 22.37) < 0.01, 'km/h into the entity’s mph');
  assert.equal(attrs.dew_point, 50);
  assert.equal(attrs.wind_bearing, 225, 'a compass point becomes degrees');
  assert.equal(attrs.visibility, 8);
  assert.equal(attrs.visibility_unit, 'km', 'the sensor’s unit when the entity has none');
  assert.equal(attrs.pressure, undefined, 'an unavailable sensor leaves the reading alone');
  // Unchanged inputs keep their identity; no configured sensors leave HA's state untouched.
  assert.equal(withSensors(hass, config).states['weather.home'], withSensors(hass, config).states['weather.home']);
  assert.equal(withSensors(hass, { entity: 'weather.home' }), hass);
  assert.deepEqual(missingReadings(weather.attributes), [
    'apparent_temperature',
    'humidity',
    'dew_point',
    'pressure',
    'uv_index',
    'wind_gust_speed',
    'wind_bearing',
    'visibility',
    'cloud_coverage',
  ]);
});

test('a second weather entity supplies the forecast types the card’s entity lacks', async () => {
  const { ForecastSources } = await import('../src/weather/forecast.ts');
  const asked: string[] = [];
  const connection: Connection = {
    subscribeMessage(callback, message) {
      asked.push(`${message.entity_id}:${message.forecast_type}`);
      queueMicrotask(() =>
        callback({
          forecast: [
            { datetime: '2026-10-27T12:00:00Z', temperature: message.entity_id === 'weather.second' ? 20 : 70 },
          ],
        }),
      );
      return Promise.resolve(() => {});
    },
  };
  const sources = new ForecastSources(
    () => {},
    (list, source) =>
      source === 'extra'
        ? list.map(entry => ({
            ...entry,
            temperature: entry.temperature === undefined ? undefined : (entry.temperature * 9) / 5 + 32,
          }))
        : list,
  );
  sources.update(connection, 'weather.home', ['daily'], 'weather.second', ['hourly']);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(asked.toSorted(), ['weather.home:daily', 'weather.second:hourly']);
  assert.equal(sources.data.daily?.forecast[0]?.temperature, 70);
  assert.equal(sources.data.hourly?.forecast[0]?.temperature, 68, 'converted into the card entity’s units');
  sources.update(connection, 'weather.home', ['daily'], undefined, []);
  assert.equal(sources.data.hourly, undefined, 'removing the second entity drops its forecasts');
});

test('readings and the condition can come from another weather entity, converted', async () => {
  const { withSensors } = await import('../src/weather/sources.ts');
  const hass = {
    states: {
      'weather.home': {
        entity_id: 'weather.home',
        state: 'cloudy',
        attributes: { temperature: 70, temperature_unit: '°F', wind_speed_unit: 'mph' },
      },
      'weather.open_meteo': {
        entity_id: 'weather.open_meteo',
        state: 'rainy',
        attributes: { uv_index: 3.1, wind_gust_speed: 36, wind_speed_unit: 'km/h' },
      },
      'sensor.condition': { entity_id: 'sensor.condition', state: 'not-a-condition', attributes: {} },
    },
  };
  const state = withSensors(hass, {
    entity: 'weather.home',
    uv_index_entity: 'weather.open_meteo',
    wind_gust_speed_entity: 'weather.open_meteo',
    condition_entity: 'weather.open_meteo',
  }).states['weather.home'];
  assert.ok(state);
  assert.equal(state.attributes.uv_index, 3.1);
  assert.ok(Math.abs((state.attributes.wind_gust_speed ?? Number.NaN) - 22.37) < 0.01, 'in the card entity’s mph');
  assert.equal(state.state, 'rainy');
  assert.equal(
    withSensors(hass, { entity: 'weather.home', condition_entity: 'sensor.condition' }).states['weather.home']?.state,
    'cloudy',
    'an unknown condition is ignored',
  );
});

test('a second entity fills forecast details the card’s entity leaves out, by nearest time', async () => {
  const { fillForecast } = await import('../src/weather/forecast.ts');
  const own = [
    { datetime: '2026-10-27T12:00:00Z', temperature: 70 },
    { datetime: '2026-10-27T13:00:00Z', temperature: 71, uv_index: 2 },
  ];
  const other = [
    { datetime: '2026-10-27T12:10:00Z', temperature: 20, precipitation_probability: 40, uv_index: 5 },
    { datetime: '2026-10-27T15:00:00Z', precipitation_probability: 90 },
  ];
  const filled = fillForecast(own, other, 1800000);
  assert.deepEqual(filled[0], {
    datetime: '2026-10-27T12:00:00Z',
    temperature: 70,
    precipitation_probability: 40,
    uv_index: 5,
  });
  assert.equal(filled[1], own[1], 'no entry within half an hour leaves the entry as it was');
});

test('a place and its map tile coordinates go both ways', () => {
  const { x, y } = tilePoint(38.63, -90.2, 7),
    place = tilePlace(x, y, 7);
  assert.ok(Math.abs(place.latitude - 38.63) < 1e-9 && Math.abs(place.longitude + 90.2) < 1e-9);
});

test('the wind map asks Open-Meteo for hours of wind on a grid around home and blends between them', async () => {
  let asked = '';
  const rows = 9,
    cols = 11,
    step = WIND_STEP,
    grid = { north: 38.63 + ((rows - 1) / 2) * step, west: -90.2 - ((cols - 1) / 2) * step, step, rows, cols },
    hours = WIND_HOURS.before + WIND_HOURS.after + 1,
    start = Date.UTC(2026, 9, 29, 2) / 1000;
  // From the south at 4 m/s in the west half of the grid, from the west at 2 m/s in the east;
  // calm in the last hour.
  const series = (value: number) => Array.from({ length: hours }, (_, hour) => (hour === hours - 1 ? 0 : value));
  const wind = await openMeteoWind(grid, url => {
    asked = url;
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve(
          Array.from({ length: rows * cols }, (_, i) => ({
            hourly: {
              time: Array.from({ length: hours }, (_, hour) => start + hour * 3600),
              wind_speed_10m: series(i % cols < cols / 2 ? 4 : 2),
              wind_direction_10m: series(i % cols < cols / 2 ? 180 : 270),
            },
          })),
        ),
    });
  });
  if (!wind) throw new Error('No wind.');
  const search = new URL(asked).searchParams,
    latitudes = search.get('latitude')?.split(',') ?? [];
  assert.equal(latitudes.length, rows * cols);
  assert.equal(latitudes[0], (38.63 + ((rows - 1) / 2) * step).toFixed(3));
  assert.equal(search.get('wind_speed_unit'), 'ms');
  assert.equal(search.get('past_hours'), String(WIND_HOURS.before));
  assert.equal(wind.times.length, hours);
  assert.equal(wind.times[0], start * 1000);
  const [field] = wind.fields;
  if (!field) throw new Error('No first hour.');
  const west = -90.2 - ((cols - 1) / 2) * step,
    north = 38.63 + ((rows - 1) / 2) * step;
  // Blowing from the south pushes north; from the west, east.
  const [east, northward] = windAt(field, 38.63, west + step);
  assert.ok(Math.abs(east) < 1e-6 && Math.abs(northward - 4) < 1e-6);
  const [eastward, still] = windAt(field, 38.63, west + (cols - 2) * step);
  assert.ok(Math.abs(eastward - 2) < 1e-6 && Math.abs(still) < 1e-6);
  // Beyond the grid, its edge's wind.
  assert.deepEqual(windAt(field, 80, -150), windAt(field, north, west));
  // Halfway between two columns, half of each.
  const between = windAt(field, 38.63, west + ((cols - 1) / 2 + 0.5) * step);
  assert.ok(Math.abs(between[0] - 1) < 1e-6 && Math.abs(between[1] - 2) < 1e-6);
  // The timeline finds its hour among them, held to the first and last.
  assert.equal(windHour(wind, start * 1000 + 90 * 60000), 1.5);
  assert.equal(windHour(wind, 0), 0);
  assert.equal(windHour(wind, Date.UTC(2030, 0, 1)), hours - 1);
  // One wind everywhere when only home's is known.
  const [steadyEast, steadyNorth] = windAt(steadyWind(3, 90), 0, 0);
  assert.ok(Math.abs(steadyEast + 3) < 1e-6 && Math.abs(steadyNorth) < 1e-6);
});

test('the 12-hour map marks the hours from three before this one to twelve after it', () => {
  const hours = rainTimeline(Date.UTC(2026, 10, 2, 23, 40));
  assert.equal(hours.length, WIND_HOURS.before + WIND_HOURS.after + 1);
  assert.equal(hours[0], Date.UTC(2026, 10, 2, 20));
  assert.equal(hours.at(-1), Date.UTC(2026, 10, 3, 11));
});

test("the wind map key covers 70 knots in the card's unit with round marks, its bar ending at the highest", async () => {
  const { windKey } = await import('../src/map/wind.ts');
  assert.deepEqual(windKey('mph')?.marks, [0, 25, 50, 75]);
  assert.equal(windKey('mph')?.top, 75);
  assert.equal(windKey('km/h')?.top, 120);
  assert.deepEqual(windKey('km/h')?.marks, [0, 40, 80, 120]);
  assert.deepEqual(windKey('m/s')?.marks, [0, 10, 20, 30]);
  assert.deepEqual(windKey('kn')?.marks, [0, 20, 40, 60]);
});

test('the large map moves under a drag and zooms about a point, keeping the place there', async () => {
  const { panMap, placeAt, pointOf, zoomMap } = await import('../src/map/wind.ts');
  const home = { latitude: 38.63, longitude: -90.2, zoom: 7 },
    near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  // Dragged 300 px left and 150 up, home follows the pointer.
  const moved = panMap(home, 1100, 820, -300, -150),
    pin = pointOf(moved, 1100, 820, home.latitude, home.longitude);
  assert.ok(near(pin.x, 250) && near(pin.y, 260));
  // A step out about (250, 260): that place stays at (250, 260), at the new zoom.
  const place = placeAt(moved, 1100, 820, 250, 260),
    out = zoomMap(moved, 1100, 820, 6, 250, 260),
    there = pointOf(out, 1100, 820, place.latitude, place.longitude);
  assert.equal(out.zoom, 6);
  assert.ok(near(there.x, 250) && near(there.y, 260));
  // Its middle stays off the poles and within a turn; a place across the date line is drawn
  // on the side nearer the middle.
  assert.equal(panMap(home, 1100, 820, 0, 100_000).latitude, 85);
  const east = panMap({ latitude: 0, longitude: 179, zoom: 7 }, 1100, 820, -400, 0);
  assert.ok(east.longitude < -179 + 5 && east.longitude > -180);
  assert.ok(pointOf(east, 1100, 820, 0, 179).x < 550);
});

test('the wind is asked for over each map view, and a grid fits a view it covers at about its spacing', async () => {
  const { fitsWind, windPointsFor } = await import('../src/map/wind.ts');
  const { windBounds, windStep } = await import('../src/map/sources.ts');
  const home = { latitude: 38.63, longitude: -90.2, zoom: 7 },
    grid = (points: ReturnType<typeof windPointsFor>) => ({
      source: 'forecast' as const,
      at: 0,
      bounds: windBounds(points),
      step: points.step,
      hours: null,
    });
  assert.equal(windStep(7), WIND_STEP);
  assert.equal(windStep(5), WIND_STEP * 4);
  // The small map's grid is 20 points, its own spacing apart; it fits the small map, not the
  // large one.
  const small = windPointsFor(home, 304, 152, false);
  assert.equal(small.step, WIND_STEP);
  assert.equal(small.rows * small.cols, 20);
  assert.ok(fitsWind(grid(small), home, 304, 152));
  assert.ok(!fitsWind(grid(small), home, 1100, 820));
  // The largest map's, with room to move in, stays under 100 points. It fits the map moved a
  // fifth of its width, not two fifths; a step deeper, not two; and never a step out.
  const roomy = windPointsFor(home, 1100, 820, true),
    large = grid(roomy),
    width = (1100 / 256) * (360 / 2 ** 7);
  assert.ok(roomy.rows * roomy.cols < 100);
  assert.ok(fitsWind(large, { ...home, longitude: home.longitude + width / 5 }, 1100, 820));
  assert.ok(!fitsWind(large, { ...home, longitude: home.longitude + (width * 2) / 5 }, 1100, 820));
  assert.ok(fitsWind(large, { ...home, zoom: 8 }, 1100, 820));
  assert.ok(!fitsWind(large, { ...home, zoom: 9 }, 1100, 820));
  assert.ok(!fitsWind(large, { ...home, zoom: 6 }, 1100, 820));
});

test('a motion lands the map where it was moved and zoomed, at any zoom between steps', async () => {
  const { STILL, movedMap, placeAt, pointOf, zoomMotion } = await import('../src/map/wind.ts');
  const home = { latitude: 38.63, longitude: -90.2, zoom: 7 },
    near = (a: number, b: number) => Math.abs(a - b) < 1e-6,
    place = placeAt(home, 1100, 820, 300, 200);
  // Moved 40 px right, then zoomed 1.7 times about where that place went: it stays there, the
  // map log2(1.7) steps deeper, not rounded to one.
  const motion = zoomMotion({ ...STILL, dx: 40 }, 1.7, 340, 200, 1100, 820),
    landed = movedMap(home, 1100, 820, motion, 3, 10),
    there = pointOf(landed, 1100, 820, place.latitude, place.longitude);
  assert.ok(near(landed.zoom, 7 + Math.log2(1.7)));
  assert.ok(near(there.x, 340) && near(there.y, 200));
  // Past the deepest zoom, it stops there.
  assert.equal(movedMap(home, 1100, 820, { ...STILL, scale: 16 }, 3, 7).zoom, 7);
});

test("the radar's own colours come out in the forecast's, by reflectivity", async () => {
  const { RADAR, radarRecolour } = await import('../src/map/field.ts');
  // Clear; 0 dBZ (grey, too faint for rain); 16 (light); 27 (moderate); 50 (heavy); 65 (white).
  const pixels = new Uint8ClampedArray([
    0, 0, 0, 0, 0x82, 0x7b, 0x69, 0x49, 0x6c, 0xd1, 0xeb, 0xff, 0x00, 0x69, 0x9c, 0xff, 0xc1, 0x00, 0x00, 0xff, 0xff,
    0xff, 0xff, 0xff,
  ]);
  radarRecolour(RADAR)(pixels);
  assert.deepEqual(
    [...pixels],
    [
      0, 0, 0, 0, 0, 0, 0, 0, 0x5a, 0xc8, 0xfa, 0xff, 0xaf, 0x52, 0xde, 0xdc, 0xff, 0xff, 0x00, 0xff, 0xff, 0xff, 0xff,
      0xff,
    ],
  );
});

test('a forecast the entity leaves empty gives way to the second entity’s', async () => {
  const { ForecastSources } = await import('../src/weather/forecast.ts');
  const connection: Connection = {
    subscribeMessage(callback, message) {
      const second = message.entity_id === 'weather.second';
      queueMicrotask(() =>
        callback({ forecast: second ? [{ datetime: '2026-10-27T12:00:00Z', temperature: 20 }] : [] }),
      );
      return Promise.resolve(() => {});
    },
  };
  const sources = new ForecastSources(
    () => {},
    list => list,
  );
  sources.update(connection, 'weather.home', ['hourly'], 'weather.second', ['hourly']);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(sources.data.hourly?.forecast[0]?.temperature, 20);
});

test('a rain-rate sensor converts as its amount', async () => {
  const { withSensors } = await import('../src/weather/sources.ts');
  const hass = {
    states: {
      'weather.home': {
        entity_id: 'weather.home',
        state: 'rainy',
        attributes: { temperature: 70, precipitation_unit: 'mm' },
      },
      'sensor.rate': {
        entity_id: 'sensor.rate',
        state: '0.2',
        attributes: { unit_of_measurement: 'in/h' },
      },
    },
  };
  const { precipitation } =
    withSensors(hass, { entity: 'weather.home', precipitation_entity: 'sensor.rate' }).states['weather.home']
      ?.attributes ?? {};
  assert.ok(Math.abs((precipitation ?? 0) - 5.08) < 0.001);
});

test('with no next-hour entity, the minutes an integration gave when asked draw as rates in mm/h', () => {
  const config = normalizeConfig({ entity: 'weather.home', weather_layout: 'page' }),
    weather = { entity_id: 'weather.home', state: 'rainy', attributes: { precipitation_unit: 'in' } },
    minutes = Array.from({ length: 61 }, (_, i) => ({
      datetime: new Date(now + i * 60000).toISOString(),
      precipitation: i >= 20 ? 1.2 : 0,
    }));
  const panel = nextHourOf(config, { states: {} }, weather, now, undefined, undefined, minutes);
  // 1.2 mm/h is light; read as an amount a minute it would be heavy.
  assert.deepEqual([panel.data?.title, panel.data?.text], ['Rain Forecasted', 'Light rain starting in 20 min']);
  assert.equal(panel.data?.unit, 'mm');
  assert.equal(panel.data.series[30], 1.2, 'a rate, not an amount a minute');
  // A next-hour entity set takes over from them.
  const set = normalizeConfig({ entity: 'weather.home', weather_layout: 'page', next_hour_entity: 'sensor.rain' });
  assert.equal(nextHourOf(set, { states: {} }, weather, now, undefined, undefined, minutes).data, undefined);
});

test('normals held while a record in new units is asked for show in those units', () => {
  const held = {
      normals: { '11-09': { high: 50, low: 32, range: [41, 59], span: [23, 68], rain: 0.1 } },
      since: 1970,
      years: 50,
      months: [{ high: 212, low: 32, precipitation: 1 }, null],
    } satisfies Parameters<typeof climateIn>[0],
    from = { temperature_unit: '°F', precipitation_unit: 'in' };
  assert.equal(climateIn(held, from, from), held);
  const shown = climateIn(held, from, { temperature_unit: '°C', precipitation_unit: 'mm' });
  assert.deepEqual(shown.normals['11-09'], { high: 10, low: 0, range: [5, 15], span: [-5, 20], rain: 2.54 });
  assert.deepEqual(shown.months, [{ high: 100, low: 0, precipitation: 25.4 }, null]);
});

test('sparse normals use calendar neighbors, wrap at New Year, and count only years with temperatures', () => {
  const days = [2023, 2024].flatMap(year =>
    (
      [
        ['01-02', 0],
        ['12-31', 2],
        ['07-15', 30],
      ] as const
    ).map(([date, value]) => ({ date: `${year}-${date}`, high: value, low: value })),
  );
  const climate = climateNormals(days);
  assert.equal(climate?.normals['01-02']?.high, 1);
  assert.equal(climate.normals['07-15']?.high, 30);
  assert.equal(
    climateNormals([
      { date: '2023-01-01', high: 1, low: 0 },
      { date: '2024-01-01', high: null, low: null },
      { date: '2024-02-31', high: 18, low: 9 },
    ]),
    null,
  );
});

test('a shared archive download serves each caller in its own units', async () => {
  const dates = ['2019-01-02', '2020-01-02'],
    daily = { time: dates, temperature_2m_max: [10, 10], temperature_2m_min: [0, 0], precipitation_sum: [10, 10] },
    fetcher = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ daily }) }));
  const [metric, other] = await Promise.all([
    openMeteoClimate(10, 20, '°C', 'mm', fetcher),
    openMeteoClimate(10, 20, 'K', 'cm', fetcher),
  ]);
  assert.equal(fetcher.mock.calls.length, 1);
  assert.equal(metric?.normals['01-02']?.high, 10);
  assert.equal(other?.normals['01-02']?.high, 283.15);
  assert.equal(other.normals['01-02'].rain, 1);
  const rain = await openMeteoRecentRain(10, 20, 'cm', 1, fetcher);
  assert.deepEqual(rain, { dates: [dates[0]], amounts: [1], total: 1 });
  const time = Array.from({ length: 24 * 20 }, (_, i) => i * 3600);
  const band = await openMeteoDayBand(10, 20, 'K', '01-02', 'UTC', () =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ hourly: { time, temperature_2m: time.map(() => 10) } }),
    }),
  );
  assert.equal(band?.high[12], 283.15);
});
