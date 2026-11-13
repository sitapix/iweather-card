import { expect, test } from 'vitest';
import { HOUR, MINUTE } from '../src/lib/time.ts';
import { RADAR_NONE, RADAR_STILL, scaleColour } from '../src/map/field.ts';
import { timelineAt, timelineDuration, type Timeline } from '../src/map/markup.ts';
import {
  forecastLevels,
  forecastRecolour,
  nextRadarFrames,
  radarForecast,
  radarTemplate,
} from '../src/map/radar-forecast.ts';

const RUN = Date.parse('2026-11-04T02:00:00Z'),
  NOW = RUN + 2 * HOUR + 10 * MINUTE,
  metadata = {
    model_init_utc: new Date(RUN).toISOString(),
    model_forecast_utc: new Date(RUN + 18 * HOUR).toISOString(),
    forecast_minute: 1080,
  };
const answer = (data: unknown) => () => Promise.resolve({ ok: true, json: () => Promise.resolve(data) });

test('forecast URLs pin one model run and use forecast minutes, with actual valid times', async () => {
  const forecast = await radarForecast(NOW, answer(metadata));
  expect(forecast?.run).toBe(RUN);
  const frames = nextRadarFrames(forecast, [{ time: NOW - 10 * MINUTE, url: 'observed' }], NOW);
  expect(frames.map(frame => frame.time)).toEqual([135, 150, 165, 180].map(minute => RUN + minute * MINUTE));
  expect(frames[0]?.url).toBe(
    'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/hrrr::REFD-F0135-202611040200/{z}/{x}/{y}.png',
  );
  expect(new Set(frames.map(frame => frame.url)).size).toBe(frames.length);
  const frame = frames[0];
  if (!frame) throw new Error('No frame');
  expect(radarTemplate(frame)).toBe(frame.url);
  expect(radarTemplate({ time: NOW, url: 'observed' })).toBe('observed/512/{z}/{x}/{y}/2/1_1.png');
});

test('stale, future, malformed and inconsistent model metadata cannot extend radar', async () => {
  for (const data of [
    null,
    {},
    { ...metadata, model_init_utc: 'invalid' },
    { ...metadata, model_forecast_utc: new Date(RUN + 17 * HOUR).toISOString() },
    { ...metadata, forecast_minute: 60 },
  ]) {
    expect(await radarForecast(NOW, answer(data))).toBeNull();
  }
  expect(await radarForecast(RUN - MINUTE, answer(metadata))).toBeNull();
  expect(await radarForecast(RUN + 7 * HOUR, answer(metadata))).toBeNull();
  await expect(
    radarForecast(NOW, () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve(metadata) })),
  ).rejects.toThrow('503');
});

test('cached runs expire and missing or stale radar never manufactures a future', async () => {
  const forecast = await radarForecast(NOW, answer(metadata)),
    observed = [{ time: NOW - 10 * MINUTE, url: 'observed' }];
  expect(nextRadarFrames(null, observed, NOW)).toEqual([]);
  expect(nextRadarFrames(forecast, [], NOW)).toEqual([]);
  expect(nextRadarFrames(forecast, observed, NOW + HOUR)).toEqual([]);
  expect(nextRadarFrames(forecast, [{ time: RUN + 7 * HOUR, url: 'observed' }], RUN + 7 * HOUR)).toEqual([]);
});

test('the timeline interpolates real timestamps across the 10-minute / 15-minute boundary', () => {
  const timeline: Timeline = {
    times: [0, 10, 20, 30, 45, 60].map(minute => minute * MINUTE),
    step: 10 * MINUTE,
    title: 'Radar',
    clock: true,
    span: '1h',
  };
  expect(timelineAt(timeline, 25 * MINUTE)).toBe(2.5);
  expect(timelineAt(timeline, 37.5 * MINUTE)).toBe(3.5);
  expect(timelineAt(timeline, 60 * MINUTE)).toBe(5);
  expect(timelineDuration(timeline)).toBe(70 * MINUTE);
});

test('IEM colors decode to reflectivity, including clear and transparent pixels', () => {
  // Published N0Q entries: 145 = 40 dBZ, 165 = 50 dBZ, 1 = -32 dBZ (below the display range).
  const pixels = Uint8ClampedArray.from([255, 226, 0, 255, 248, 0, 0, 255, 133, 113, 143, 255, 255, 226, 0, 0]);
  expect([...forecastLevels(pixels)]).toEqual([40 - RADAR_NONE, 50 - RADAR_NONE, 0, 0]);
  expect(() => forecastLevels(Uint8ClampedArray.of(1, 2, 3, 255))).toThrow('palette');
});

test("a forecast tile takes the small map's colours by its dBZ, and its faintest and empty pixels are clear", () => {
  const pixels = Uint8ClampedArray.from([255, 226, 0, 255, 248, 0, 0, 255, 133, 113, 143, 255, 255, 226, 0, 0]);
  forecastRecolour(RADAR_STILL)(pixels);
  const colour = (dbz: number) => scaleColour(RADAR_STILL, dbz).map(Math.round);
  expect(Array.from(pixels.subarray(0, 4))).toEqual(colour(40));
  expect(Array.from(pixels.subarray(4, 8))).toEqual(colour(50));
  expect(Array.from(pixels.subarray(8))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
});
