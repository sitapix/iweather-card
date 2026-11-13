import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readBlosc } from '../src/map/blosc.ts';
import { readGeoTiff } from '../src/map/geotiff.ts';
import { readDap } from '../src/map/dap.ts';
import { lambert } from '../src/map/lambert.ts';
import {
  loadRain,
  rainPlan,
  rainPlans,
  RAIN_MODELS,
  type BytesFetcher,
  type RainModel,
} from '../src/map/rain-grids.ts';
import { rainSlot, windBounds, type WindGrid } from '../src/map/sources.ts';
import { fitsWind, rainBounds } from '../src/map/wind.ts';
import { HOUR } from '../src/lib/time.ts';
import { bloscStored, bucketListing, dapGrid, geoTiff, hrrrSizes } from './forecast-files.ts';

const close = (a: number | undefined, b: number, within = 1e-3) =>
  assert.ok(a !== undefined && Math.abs(a - b) <= within, `${String(a)} is not ${b}`);
const bufferOf = (bytes: Uint8Array) => Uint8Array.from(bytes).buffer;
// A stand-in for fetch: each URL answered by the first matching rule, everything else 404.
function answers(rules: [RegExp, (url: string, range?: string) => ArrayBuffer | string | undefined][]) {
  const asked: { url: string; range?: string }[] = [];
  const fetcher: BytesFetcher = (url, init) => {
    const range = init?.headers?.['Range'];
    asked.push(range === undefined ? { url } : { url, range });
    const rule = rules.find(([pattern]) => pattern.test(url)),
      body = rule?.[1](url, range);
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body).buffer : body;
    return Promise.resolve({
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      arrayBuffer: () => Promise.resolve(bytes ?? new ArrayBuffer(0)),
      text: () => Promise.resolve(typeof body === 'string' ? body : ''),
    });
  };
  return { fetcher, asked };
}

test('a Blosc chunk of LZ4 pieces, its bytes shuffled, reads as it was written', () => {
  // Three hours of 150 by 150 floats in two blocks, the second shorter, as the forecast archive
  // writes them; the first three rows marked as having nothing.
  const bytes = readBlosc(new Uint8Array(bufferOf(readFileSync(new URL('blosc-lz4-shuffled.bin', import.meta.url))))),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(bytes.length, 3 * 150 * 150 * 4);
  let wrong = 0;
  for (let t = 0; t < 3; t++)
    for (let y = 0; y < 150; y++)
      for (let x = 0; x < 150; x++) {
        const want = t === 0 && y < 3 ? -9999 : Math.fround(((t * 7 + y * 3 + x) % 50) / 10);
        if (view.getFloat32(((t * 150 + y) * 150 + x) * 4, true) !== want) wrong += 1;
      }
  assert.equal(wrong, 0);
  // Stored as it is, where it wouldn't compress.
  const stored = readBlosc(new Uint8Array(bloscStored([1.5, -9999, 0])));
  assert.deepEqual([...new Float32Array(stored.buffer)], [1.5, -9999, 0]);
});

test('the Lambert cone puts places where the models’ own grids have them', () => {
  // HRRR's grid and MET Norway's, each counted from its cone's own north.
  const hrrr = lambert({ parallels: [38.5, 38.5], meridian: -97.5, radius: 6_371_229 }),
    hrrrNorth = -hrrr(38.5, -97.5).y,
    stLouis = hrrr(38.63, -90.2),
    col = (stLouis.x + 2_697_520.14) / 3000,
    row = (stLouis.y + hrrrNorth + 1_587_306.15) / 3000;
  assert.ok(Math.abs(col - 1110.3309) < 1e-3 && Math.abs(row - 542.2989) < 1e-3);
  const meps = lambert({ parallels: [63.3, 63.3], meridian: 15, radius: 6_371_000 }),
    north = -meps(63.3, 15).y,
    oslo = meps(59.91, 10.75);
  close((oslo.x + 1_060_084) / 2500, 329.1702);
  close((oslo.y + north + 1_332_517.9) / 2500, 385.2855);
});

test('a GeoTIFF of floats reads in either byte order, placed by its tie point', () => {
  const placed = readGeoTiff(
    geoTiff({ cols: 3, rows: 2, values: [0, 1, 2, 3, 4, 5.5], north: 40, west: -95, step: 0.5 }),
  );
  assert.equal(placed.cols, 3);
  assert.equal(placed.rows, 2);
  assert.deepEqual([...placed.values], [0, 1, 2, 3, 4, 5.5]);
  // Each pixel's middle: half a pixel in from the corner.
  close(placed.north, 39.75);
  close(placed.west, -94.75);
  close(placed.stepX, 0.5);
  const wide = readGeoTiff(geoTiff({ cols: 2, rows: 2, values: [0.25, 0, 0, 1.5], wide: true }));
  assert.deepEqual([...wide.values], [0.25, 0, 0, 1.5]);
});

test('an OPeNDAP answer reads as its grid and the coordinates beside it', () => {
  const arrays = readDap(
    dapGrid({
      name: 'precipitation_amount_acc',
      times: [100, 3700],
      ys: [-5, 2495],
      xs: [10, 2510, 5010],
      values: [0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6],
    }),
  );
  assert.deepEqual(arrays.get('precipitation_amount_acc')?.shape, [2, 1, 2, 3]);
  assert.deepEqual([...(arrays.get('precipitation_amount_acc')?.values ?? [])].slice(6), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...(arrays.get('time')?.values ?? [])], [100, 3700]);
  assert.deepEqual([...(arrays.get('x')?.values ?? [])], [10, 2510, 5010]);
});

test('the 12-hour map takes the finest model that has the whole view', () => {
  const view = (latitude: number, longitude: number, half = 1) => ({
    north: latitude + half,
    south: latitude - half,
    west: longitude - half * 2,
    east: longitude + half * 2,
  });
  assert.equal(rainPlan(view(38.6, -90.2))?.model.id, 'hrrr');
  assert.equal(rainPlan(view(59.9, 10.8))?.model.id, 'meps');
  // Hudson Bay and Mexico City lie beyond HRRR's grid, inside Canada's regional model's.
  assert.equal(rainPlan(view(61, -90))?.model.id, 'rdps');
  assert.equal(rainPlan(view(19.4, -99.1))?.model.id, 'rdps');
  // Anchorage lies west of where the regional model is asked.
  assert.equal(rainPlan(view(61.2, -149.9))?.model.id, 'gdps');
  assert.equal(rainPlan(view(51.5, -0.1))?.model.id, 'gdps');
  assert.equal(rainPlan(view(35.7, 139.7))?.model.id, 'gdps');
  // A view that runs off a model's grid goes to one that has all of it, and one that would take
  // too many of HRRR's tiles to its regional neighbour.
  assert.equal(rainPlan(view(54, -95, 1))?.model.id, 'rdps');
  assert.equal(rainPlan(view(38.6, -90.2, 5))?.model.id, 'rdps');
  // As fine as the model, until the view is so wide that would make too many points.
  const near = rainPlan(view(38.6, -90.2));
  assert.equal(near?.points.step, near?.model.native);
  const far = rainPlan(view(51.5, -0.1, 20));
  assert.ok((far?.points.step ?? 0) > (far?.model.native ?? 0));
  assert.ok(Math.max(far?.points.rows ?? 0, far?.points.cols ?? 0) <= 403);
});

test('a precipitation grid fits its view and a short move, a finer zoom while the model is no finer, but not a wider view', () => {
  const centre = { latitude: 38.63, longitude: -90.2, zoom: 8 },
    width = 1000,
    height = 700,
    plan = rainPlan(rainBounds(centre, width, height));
  if (!plan) throw new Error('No plan.');
  const grid: WindGrid = {
    source: 'rain',
    at: 0,
    bounds: windBounds(plan.points),
    step: plan.points.step,
    hours: null,
    model: plan.model.id,
  };
  assert.ok(fitsWind(grid, centre, width, height));
  assert.ok(fitsWind(grid, { ...centre, longitude: centre.longitude + 0.2 }, width, height));
  assert.ok(fitsWind(grid, { ...centre, zoom: 10 }, width, height));
  assert.ok(!fitsWind(grid, { ...centre, zoom: 7 }, width, height));
  // Nor one from another model.
  assert.ok(!fitsWind({ ...grid, model: 'gdps' }, centre, width, height));
});

test('each hour’s rate shows at its middle, held at the ends, and a missing hour is blended across', () => {
  const start = Date.UTC(2026, 10, 3, 12),
    hours = { times: [start, start + HOUR, start + 3 * HOUR], fields: [], slot: HOUR };
  assert.equal(rainSlot(hours, start - HOUR), 0);
  assert.equal(rainSlot(hours, start - HOUR / 2), 0);
  assert.equal(rainSlot(hours, start), 0.5);
  assert.equal(rainSlot(hours, start + HOUR / 2), 1);
  // Halfway from the second hour's middle to the fourth's, across the third that didn't come.
  assert.equal(rainSlot(hours, start + 1.5 * HOUR), 1.5);
  assert.equal(rainSlot(hours, start + 10 * HOUR), 2);
});

test('the forecast’s hours come the hour now first, then outward, each telling the map as it comes', async () => {
  const now = Date.UTC(2026, 10, 3, 17, 20),
    asked: number[] = [],
    model: RainModel = {
      id: 'gdps',
      credit: 'Environment and Climate Change Canada',
      native: 0.15,
      covers: () => true,
      load(grid, ends, _fetcher, each) {
        for (const end of ends) {
          asked.push(end);
          each(end, new Float32Array(grid.rows * grid.cols).fill(end === Date.UTC(2026, 10, 3, 18) ? 2 : 0));
        }
        return Promise.resolve('tried' as const);
      },
    },
    plan = rainPlan({ north: 40, south: 39, west: -91, east: -90 }, [model]);
  if (!plan) throw new Error('No plan.');
  const seen: number[] = [],
    hours = (await loadRain([plan], now, update => seen.push(update.times.length)))?.hours;
  // At 17:20 the map blends the hours to 17:00 and 18:00 (their middles 16:30 and 17:30): the hour
  // under way first, then the one before it, then the next.
  assert.deepEqual(asked.slice(0, 3), [
    Date.UTC(2026, 10, 3, 18),
    Date.UTC(2026, 10, 3, 17),
    Date.UTC(2026, 10, 3, 19),
  ]);
  if (!hours) throw new Error('No hours.');
  // Eighteen hours, the first ending three hours before this one.
  assert.equal(hours.times[0], Date.UTC(2026, 10, 3, 14));
  assert.equal(hours.times.length, 18);
  assert.deepEqual(
    seen,
    Array.from({ length: 18 }, (_, k) => k + 1),
  );
  assert.equal(hours.slot, HOUR);
  assert.equal(hours.precipitation?.[hours.times.indexOf(Date.UTC(2026, 10, 3, 18))]?.values[0], 2);
});

test('HRRR is read from the tiles under the view, every hour of one run in each, the run before the timeline’s first hour', async () => {
  const hrrr = RAIN_MODELS.find(model => model.id === 'hrrr');
  if (!hrrr) throw new Error('No model.');
  // Hours ending 13:00 to 15:00 want the run from 12:00; it isn't out, so the one from 11:00.
  const first = Date.UTC(2026, 10, 3, 13),
    ends = [first, first + HOUR, first + 2 * HOUR],
    tile = (hour: number) =>
      bloscStored(
        Array.from({ length: 18 * 150 * 150 }, (_, i) =>
          Math.floor(i / 22_500) === hour ? -9999 : Math.floor(i / 22_500) + 1,
        ),
      ),
    { fetcher, asked } = answers([
      [
        /list-type=2/,
        url => {
          const prefix = new URL(url).searchParams.get('prefix') ?? '';
          return bucketListing(prefix, prefix.includes('20261103_12z') ? {} : hrrrSizes(1000));
        },
      ],
      [/\.zarray$/, () => JSON.stringify({ shape: [18, 1059, 1799], chunks: [18, 150, 150] })],
      [/\/0\.\d+\.\d+$/, url => tile(url.includes('0.3.7') ? 3 : -1)],
    ]),
    got = new Map<number, Float32Array>();
  // A few points around St. Louis, all in one tile.
  await hrrr.load({ north: 38.7, west: -90.3, step: 0.03, rows: 3, cols: 4 }, ends, fetcher, (end, values) =>
    got.set(end, values),
  );
  const tiles = asked.filter(({ url }) => /\/0\.\d+\.\d+$/.test(url)).map(({ url }) => url);
  assert.deepEqual(
    tiles.map(url => url.slice(url.lastIndexOf('/') + 1)),
    ['0.3.7'],
  );
  assert.ok(
    tiles[0]?.includes('/sfc/20261103/20261103_11z_fcst.zarr/surface/APCP_1hr_acc_fcst/surface/APCP_1hr_acc_fcst/'),
  );
  // The run's hours are its 1st, 2nd and 3rd after 11:00: slices 1, 2 and 3, the last marked empty.
  for (const value of got.get(first) ?? []) close(value, 2);
  for (const value of got.get(first + HOUR) ?? []) close(value, 3);
  for (const value of got.get(first + 2 * HOUR) ?? []) assert.ok(Number.isNaN(value));
});

test('Canada’s models are asked for exactly the grid’s points, an hour a request', async () => {
  const gdps = RAIN_MODELS.find(model => model.id === 'gdps');
  if (!gdps) throw new Error('No model.');
  const grid = { north: 52, west: -1, step: 0.15, rows: 4, cols: 5 },
    end = Date.UTC(2026, 10, 3, 19),
    { fetcher, asked } = answers([
      [
        /geo\.weather\.gc\.ca/,
        () =>
          geoTiff({
            cols: 5,
            rows: 4,
            values: Array.from({ length: 20 }, (_, i) => i / 10),
            north: 52.075,
            west: -1.075,
            step: 0.15,
          }),
      ],
    ]),
    got: Float32Array[] = [];
  await gdps.load(grid, [end], fetcher, (_end, values) => got.push(values));
  const url = new URL(asked[0]?.url ?? '');
  assert.equal(url.searchParams.get('coverageId'), 'GDPS_15km_Precip-Accum1h');
  assert.equal(url.searchParams.get('time'), '2026-11-03T19:00:00Z');
  assert.equal(url.searchParams.get('scalesize'), 'lat(4),lon(5)');
  assert.deepEqual(url.searchParams.getAll('subset'), ['lat(51.475,52.075)', 'lon(-1.075,-0.325)']);
  got[0]?.forEach((value, i) => {
    close(value, i / 10, 1e-5);
  });
});

test('MET Norway’s model is read in one request for every hour, each the difference since the hour before', async () => {
  const meps = RAIN_MODELS.find(model => model.id === 'meps');
  if (!meps) throw new Error('No model.');
  const now = Date.now(),
    run = Math.floor(now / (3 * HOUR)) * 3 * HOUR - 6 * HOUR,
    name = new Date(run).toISOString().replace(/[-:]/g, '').slice(0, 11),
    ends = [run + 2 * HOUR, run + 3 * HOUR],
    // A run's grid around Oslo, the amount since the run began growing 1 mm, then 4 mm, an hour.
    cone = lambert({ parallels: [63.3, 63.3], meridian: 15, radius: 6_371_000 }),
    north = -cone(63.3, 15).y,
    oslo = cone(59.91, 10.75),
    xs = Array.from({ length: 6 }, (_, i) => oslo.x - 10_000 + i * 5000),
    ys = Array.from({ length: 6 }, (_, j) => oslo.y + north - 10_000 + j * 5000),
    { fetcher, asked } = answers([
      [
        /catalog\.xml$/,
        () => `<dataset name="meps_det_2_5km_${name}Z.ncml" /><dataset name="meps_det_2_5km_20200101T00Z.ncml" />`,
      ],
      [
        /\.dods\?/,
        () =>
          dapGrid({
            name: 'precipitation_amount_acc',
            times: [0, 1, 2],
            ys,
            xs,
            values: [
              ...Array.from({ length: 36 }, () => 1),
              ...Array.from({ length: 36 }, () => 2),
              ...Array.from({ length: 36 }, () => 6),
            ],
          }),
      ],
    ]),
    got = new Map<number, Float32Array>();
  await meps.load({ north: 59.95, west: 10.7, step: 0.025, rows: 3, cols: 4 }, ends, fetcher, (end, values) =>
    got.set(end, values),
  );
  const dods = asked.find(({ url }) => url.includes('.dods'))?.url ?? '';
  assert.ok(dods.includes(`meps_det_2_5km_${name}Z.ncml.dods?precipitation_amount_acc%5B1:1:3%5D%5B0%5D`));
  assert.deepEqual([...got.keys()], ends);
  for (const value of got.get(ends[0] ?? 0) ?? []) close(value, 1);
  for (const value of got.get(ends[1] ?? 0) ?? []) close(value, 4);
});

test('a model that answers nothing gives way to the next that covers the view, and rests a while', async () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 3, 17, 20), toFake: ['Date'] });
  try {
    const answered = (id: RainModel['id'], works: boolean): RainModel => ({
        id,
        credit: id,
        native: 0.1,
        covers: () => true,
        load(grid, ends, _fetcher, each) {
          if (!works) return Promise.reject(new Error('Down'));
          for (const end of ends) each(end, new Float32Array(grid.rows * grid.cols).fill(1));
          return Promise.resolve('tried');
        },
      }),
      models = [answered('rdps', false), answered('gdps', true)],
      bounds = { north: 40, south: 39, west: -91, east: -90 },
      got = await loadRain(rainPlans(bounds, models), Date.now(), () => {});
    if (!got) throw new Error('Nothing came.');
    assert.equal(got.plan.model.id, 'gdps');
    assert.equal(got.hours.times.length, 18);
    // The one that failed isn't asked again for a while, so the view's grid fits and stays.
    assert.equal(rainPlan(bounds, models)?.model.id, 'gdps');
    vi.setSystemTime(Date.now() + 11 * 60_000);
    assert.equal(rainPlan(bounds, models)?.model.id, 'rdps');
  } finally {
    vi.useRealTimers();
  }
});

test('HRRR leaves a view to the regional model when its tiles would cost more than a view’s worth', async () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 3, 18), toFake: ['Date'] });
  try {
    const hrrr = RAIN_MODELS.find(model => model.id === 'hrrr');
    if (!hrrr) throw new Error('No model.');
    // Denver, its tiles listed at 4 MB each.
    const bounds = { north: 40.5, south: 39, west: -106, east: -104 },
      { fetcher, asked } = answers([
        [/list-type=2/, url => bucketListing(new URL(url).searchParams.get('prefix') ?? '', hrrrSizes(4_000_000))],
        [/\.zarray$/, () => JSON.stringify({ shape: [18, 1059, 1799], chunks: [18, 150, 150] })],
      ]);
    assert.equal(rainPlan(bounds)?.model.id, 'hrrr');
    const plan = rainPlans(bounds).find(each => each.model.id === 'hrrr');
    if (!plan) throw new Error('No plan.');
    const answer = await hrrr.load(plan.points, [Date.UTC(2026, 10, 3, 16)], fetcher, () => {});
    assert.equal(answer, 'declined');
    // No tile was asked for, and the view now goes to the regional model, for a while.
    assert.ok(!asked.some(({ url }) => /\/0\.\d+\.\d+$/.test(url)));
    assert.equal(rainPlan(bounds)?.model.id, 'rdps');
    vi.setSystemTime(Date.now() + 31 * 60_000);
    assert.equal(rainPlan(bounds)?.model.id, 'hrrr');
  } finally {
    vi.useRealTimers();
  }
});

test('Canada’s global model is asked for either side of the date line, and a view across it is filled', async () => {
  const gdps = RAIN_MODELS.find(model => model.id === 'gdps');
  if (!gdps) throw new Error('No model.');
  // Fiji: points from 177.75° to 182.25°, that is to 177.75° west.
  const grid = { north: -17.85, west: 177.75, step: 0.15, rows: 4, cols: 31 },
    { fetcher, asked } = answers([
      [
        /geo\.weather\.gc\.ca/,
        url => {
          // As the service answers: exactly the cells asked for, over exactly the span asked.
          const text = decodeURIComponent(url),
            [, from = '0', to = '0'] = /lon\(([-\d.]+),([-\d.]+)\)/.exec(text) ?? [],
            cols = Number(/scalesize=lat\(\d+\),lon\((\d+)\)/.exec(text)?.[1]);
          return geoTiff({
            cols,
            rows: 4,
            values: Array.from({ length: cols * 4 }, () => 2.5),
            north: -17.775,
            west: Number(from),
            step: (Number(to) - Number(from)) / cols,
          });
        },
      ],
    ]),
    got: Float32Array[] = [];
  await gdps.load(grid, [Date.UTC(2026, 10, 3, 19)], fetcher, (_end, values) => got.push(values));
  const spans = asked.map(({ url }) => new URL(url).searchParams.getAll('subset')[1]);
  assert.deepEqual(spans, ['lon(177.675,180)', 'lon(-180,-177.675)']);
  assert.equal(got.length, 1);
  assert.ok([...(got[0] ?? [])].every(value => Math.abs(value - 2.5) < 1e-6));
});

test('MET Norway’s model is asked for no more points than fit its budget, however wide the view', async () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 3, 18), toFake: ['Date'] });
  try {
    const meps = RAIN_MODELS.find(model => model.id === 'meps');
    if (!meps) throw new Error('No model.');
    const { fetcher, asked } = answers([
      [/catalog\.xml$/, () => '<dataset name="meps_det_2_5km_20261103T09Z.ncml" />'],
    ]);
    const first = Date.UTC(2026, 10, 3, 15),
      ends = Array.from({ length: 18 }, (_, k) => first + k * HOUR);
    // Most of Scandinavia at the map's finest.
    await meps.load({ north: 66, west: 4, step: 0.025, rows: 400, cols: 400 }, ends, fetcher, () => {});
    const url = decodeURIComponent(asked.find(({ url }) => url.includes('.dods'))?.url ?? ''),
      [, rows = '0', down = '1', rowsTo = '0', cols = '0', across = '1', colsTo = '0'] =
        /\[0\]\[(\d+):(\d+):(\d+)\]\[(\d+):(\d+):(\d+)\]/.exec(url) ?? [];
    const points =
      (Math.floor((Number(rowsTo) - Number(rows)) / Number(down)) + 1) *
      (Math.floor((Number(colsTo) - Number(cols)) / Number(across)) + 1);
    assert.ok(points * 19 * 4 <= 3_000_000, `${points} points`);
  } finally {
    vi.useRealTimers();
  }
});

test('Open-Meteo, behind every model, is asked for at most 300 points, each hour the sum of its quarters', async () => {
  vi.useFakeTimers({ now: Date.UTC(2026, 10, 3, 17, 20), toFake: ['Date'] });
  try {
    const last = RAIN_MODELS.at(-1);
    if (last?.id !== 'open-meteo') throw new Error('Open-Meteo is not last.');
    const bounds = { north: 45, south: 35, west: -100, east: -80 },
      plan = rainPlans(bounds).at(-1);
    if (!plan) throw new Error('No plan.');
    assert.ok(plan.points.rows * plan.points.cols <= 300);
    const end = Date.UTC(2026, 10, 3, 18),
      { fetcher, asked } = answers([
        [
          /api\.open-meteo\.com/,
          url =>
            JSON.stringify(
              (new URL(url).searchParams.get('latitude')?.split(',') ?? []).map(() => ({
                minutely_15: {
                  // The four quarters ending 17:15 to 18:00, and one either side.
                  time: [17, 17.25, 17.5, 17.75, 18, 18.25].map(hour => Date.UTC(2026, 10, 3) / 1000 + hour * 3600),
                  precipitation: [9, 0.1, 0.2, 0.3, 0.4, 9],
                },
              })),
            ),
        ],
      ]),
      got = new Map<number, Float32Array>();
    await last.load(plan.points, [end], fetcher, (time, values) => got.set(time, values));
    const search = new URL(asked[0]?.url ?? '').searchParams;
    assert.equal(search.get('minutely_15'), 'precipitation');
    assert.ok((search.get('latitude')?.split(',').length ?? 0) <= 300);
    close(got.get(end)?.[0], 1, 1e-5);
  } finally {
    vi.useRealTimers();
  }
});
