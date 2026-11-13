// The forecast's precipitation across the large map, hour by hour, from public forecast models that
// send readings rather than pictures: over the Nordic countries MET Norway's MEPS (2.5 km), over the
// United States NOAA's HRRR (3 km), elsewhere in North America Canada's regional model (10 km), and
// everywhere else Canada's global one (15 km), with Open-Meteo's points behind them all. Each is put
// on a grid of the map's own (see ScalarField), as fine as the model or as the view needs, whichever
// is coarser, and its hours come one by one, the hour now first, so the map has rain to show before
// the rest has come. A model that answers nothing, or would cost the view too much, gives way to the
// next that covers it, so every place on Earth has a forecast whichever service is down.
import type { Bounds, ScalarField, WindHours, WindPoints } from './sources.ts';
import { gridPoints, windPoints } from './sources.ts';
import { lambert, type LambertCone } from './lambert.ts';
import { readBlosc } from './blosc.ts';
import { keepTile, keptTile } from './kept-tiles.ts';
import { readGeoTiff, type GeoGrid } from './geotiff.ts';
import { readDap } from './dap.ts';
import { HOUR, MINUTE, fromUnix } from '../lib/time.ts';
import { finite, isList, isRecord } from '../lib/values.ts';
import { FULL_TURN, HALF_TURN } from '../lib/compass.ts';
import { OPEN_METEO } from '../lib/services.ts';

// Enough of `fetch` for bytes, ranges of them and text.
export type BytesFetcher = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ ok: boolean; status?: number; arrayBuffer(): Promise<ArrayBuffer>; text(): Promise<string> }>;

export interface RainModel {
  id: 'meps' | 'hrrr' | 'rdps' | 'gdps' | 'open-meteo';
  // Who it comes from, for the map's credits.
  credit: string;
  // The degrees between its points, about: no grid of the map's is made finer than this, nor than
  // `stepFor` asks where a model counts its points.
  native: number;
  stepFor?(bounds: Bounds): number;
  covers(bounds: Bounds): boolean;
  // Each hour's precipitation (mm) to each of `ends`, on `grid`'s points, as each comes; or
  // 'declined' where it would cost the view too much, and the next model is asked.
  load(grid: WindPoints, ends: readonly number[], fetcher: BytesFetcher, each: Each): Promise<Answer>;
}
type Answer = 'tried' | 'declined';
type Each = (end: number, values: Float32Array) => void;

// The most points a grid of the map's has across or down: a texture of each hour.
const MOST_POINTS = 400,
  // Hours to the timeline's first, from three before this one, and the hours to its end, so
  // each hour's middle covers it (see rainTimeline and rainSlot).
  BEFORE = 3,
  HOURS = 18,
  // At once from one service, and how long a model's newest run is trusted before it is asked again.
  AT_ONCE = 4,
  RUN_KEPT = 10 * MINUTE,
  // A model that answered nothing rests this long before it is asked again, so a view isn't asked
  // of it over and over; the next that covers the view answers meanwhile.
  REST = 10 * MINUTE,
  // A float's bytes.
  FLOAT_BYTES = 4,
  PAD = 2,
  // Points along each edge of a view at which a model must have readings to cover it.
  EDGE_SAMPLES = 9;

// --- Grids ----------------------------------------------------------------------------------
// The value of a grid's values at fractional column and row, from the four around it; NaN outside.
// A point a hair past the edge, by rounding, is on it; or, where `reach` says, as far past as that.
const EDGE = 1e-3;
function bilinear(
  values: ArrayLike<number>,
  cols: number,
  rows: number,
  across: number,
  down: number,
  reach = EDGE,
): number {
  if (!(across > -reach && down > -reach && across < cols - 1 + reach && down < rows - 1 + reach)) return Number.NaN;
  const col = Math.min(cols - 1, Math.max(0, across)),
    row = Math.min(rows - 1, Math.max(0, down)),
    c = Math.min(cols - 2, Math.floor(col)),
    r = Math.min(rows - 2, Math.floor(row)),
    fx = col - c,
    fy = row - r,
    at = (i: number, j: number) => values[j * cols + i] ?? Number.NaN;
  if (cols < 2 || rows < 2) return at(0, 0);
  return (at(c, r) * (1 - fx) + at(c + 1, r) * fx) * (1 - fy) + (at(c, r + 1) * (1 - fx) + at(c + 1, r + 1) * fx) * fy;
}

// A grid's points as places, row by row from the north.
function places(grid: WindPoints, visit: (latitude: number, longitude: number, i: number) => void) {
  for (let row = 0; row < grid.rows; row++)
    for (let col = 0; col < grid.cols; col++)
      visit(grid.north - row * grid.step, grid.west + col * grid.step, row * grid.cols + col);
}

// A model's grid on a Lambert cone: metres east and north of its first point (south-west), the
// metres between points, and its size. `shift` moves the cone's own north to the grid's.
interface ConeGrid {
  cone: LambertCone;
  x: number;
  y: number;
  dx: number;
  dy: number;
  cols: number;
  rows: number;
  shift: number;
}
// Where each of a map grid's points falls on a cone grid, in its columns and rows.
function onCone(grid: WindPoints, cone: ConeGrid) {
  const project = lambert(cone.cone),
    cols = new Float32Array(grid.rows * grid.cols),
    rows = new Float32Array(grid.rows * grid.cols);
  places(grid, (latitude, longitude, i) => {
    const { x, y } = project(latitude, longitude);
    cols[i] = (x - cone.x) / cone.dx;
    rows[i] = (y + cone.shift - cone.y) / cone.dy;
  });
  return (values: ArrayLike<number>, width = cone.cols, height = cone.rows) => {
    const out = new Float32Array(cols.length);
    for (let i = 0; i < cols.length; i++)
      out[i] = bilinear(values, width, height, cols[i] ?? Number.NaN, rows[i] ?? Number.NaN);
    return out;
  };
}
// Whether every sampled place along a view's edges falls inside a cone grid.
function coneCovers(cone: ConeGrid, bounds: Bounds): boolean {
  const project = lambert(cone.cone);
  for (let a = 0; a < EDGE_SAMPLES; a++)
    for (let b = 0; b < EDGE_SAMPLES; b++) {
      const latitude = bounds.south + ((bounds.north - bounds.south) * a) / (EDGE_SAMPLES - 1),
        longitude = bounds.west + ((bounds.east - bounds.west) * b) / (EDGE_SAMPLES - 1),
        { x, y } = project(latitude, longitude),
        col = (x - cone.x) / cone.dx,
        row = (y + cone.shift - cone.y) / cone.dy;
      if (!(col >= 0 && row >= 0 && col <= cone.cols - 1 && row <= cone.rows - 1)) return false;
    }
  return true;
}
// A map grid's values from grids on longitude and latitude: one, or the two either side of the date
// line, each place read from whichever holds its longitude. A place up to half a cell past a grid's
// outer middles is in its cell: on the date line itself, it falls between the two grids' last.
const HALF_CELL = 1 / 2 + EDGE;
function fromGeo(grid: WindPoints, geos: readonly GeoGrid[]): Float32Array {
  const values = new Float32Array(grid.rows * grid.cols).fill(Number.NaN);
  places(grid, (latitude, longitude, i) => {
    const wrapped = ((((longitude + HALF_TURN) % FULL_TURN) + FULL_TURN) % FULL_TURN) - HALF_TURN;
    for (const geo of geos)
      for (const at of [longitude, wrapped]) {
        const value = bilinear(
          geo.values,
          geo.cols,
          geo.rows,
          (at - geo.west) / geo.stepX,
          (geo.north - latitude) / geo.stepY,
          HALF_CELL,
        );
        if (!Number.isNaN(value)) {
          values[i] = value;
          return;
        }
      }
  });
  return values;
}

// One piece of work after another from a list, a few at a time.
async function inTurn<T>(items: readonly T[], work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(AT_ONCE, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        if (item !== undefined)
          try {
            await work(item);
          } catch {}
      }
    }),
  );
}

const resting = new Map<string, number>(),
  rests = (id: string) => (resting.get(id) ?? 0) > Date.now();
const isoHour = (time: number) => new Date(time).toISOString().replace(/:00\.000Z$/, ':00Z'),
  two = (value: number) => String(value).padStart(PAD, '0'),
  // Degrees in a request, without the noise of sums in binary.
  DEGREE_DIGITS = 6,
  degrees = (value: number) => Number(value.toFixed(DEGREE_DIGITS));

// --- HRRR, NOAA's 3 km model of the United States, from the University of Utah's Zarr archive -----
// Each run's hourly amounts in tiles of 150 by 150 points, every hour of the run in one tile: a view
// takes a few tiles, a request each, kept in the browser for next time (see keptTile). A run every
// hour, 18 hours long (48 at 00, 06, 12 and 18 UTC), out two or three hours after it starts. One run
// is read for the whole timeline: the newest that began before its first hour.
const HRRR = {
  host: 'https://hrrrzarr.s3.amazonaws.com',
  array: 'surface/APCP_1hr_acc_fcst/surface/APCP_1hr_acc_fcst',
  grid: {
    cone: { parallels: [38.5, 38.5], meridian: -97.5, radius: 6_371_229 },
    x: -2_697_520.14,
    y: -1_587_306.15,
    d: 3000,
    cols: 1799,
    rows: 1059,
  },
  // The latitude its grid's north counts from, and a tile's side. A view is read from at most so
  // many tiles, and so many bytes of them not yet kept (a wet tile of a long run is 3 MB); past
  // either, the regional model is asked instead, and the area left to it for a while. The runs
  // before the one wanted that are tried; what it writes where it has nothing.
  origin: 38.5,
  tile: 150,
  mostTiles: 12,
  budget: 6_000_000,
  declined: 30 * MINUTE,
  back: 3,
  fill: -9999,
  native: 0.03,
} as const;
const hrrrCone: ConeGrid = (() => {
  const { cone, x, y, d, cols, rows } = HRRR.grid;
  return { cone, x, y, dx: d, dy: d, cols, rows, shift: -lambert(cone)(HRRR.origin, cone.meridian).y };
})();
const hrrrRun = (run: number) => {
  const date = new Date(run),
    day = `${date.getUTCFullYear()}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}`;
  return `${HRRR.host}/sfc/${day}/${day}_${two(date.getUTCHours())}z_fcst.zarr/${HRRR.array}`;
};
// The tiles under a grid's points, by column and row of tiles.
function hrrrTiles(grid: WindPoints) {
  const project = lambert(hrrrCone.cone),
    span = { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity };
  places(grid, (latitude, longitude) => {
    const { x, y } = project(latitude, longitude),
      col = (x - hrrrCone.x) / hrrrCone.dx,
      row = (y + hrrrCone.shift - hrrrCone.y) / hrrrCone.dy;
    span.left = Math.min(span.left, col);
    span.right = Math.max(span.right, col);
    span.bottom = Math.min(span.bottom, row);
    span.top = Math.max(span.top, row);
  });
  const last = (size: number) => Math.ceil(size / HRRR.tile) - 1,
    tile = (at: number, top: number) => Math.min(top, Math.max(0, Math.floor(at / HRRR.tile)));
  return {
    left: tile(span.left, last(hrrrCone.cols)),
    right: tile(span.right, last(hrrrCone.cols)),
    bottom: tile(span.bottom, last(hrrrCone.rows)),
    top: tile(span.top, last(hrrrCone.rows)),
  };
}
// The newest run that began an hour or more before `first`: its length in hours and the size of each
// tile, from one listing of the archive, which also finds a run without asking for a file that may
// not be there yet (a 404 every browser would log).
interface HrrrRun {
  first: number;
  at: number;
  run: number;
  hours: number;
  sizes: ReadonlyMap<string, number>;
}
const LISTING = /<Key>[^<]*\/([^/<]+)<\/Key>[\s\S]*?<Size>(\d+)<\/Size>/g;
let hrrrFound: HrrrRun | undefined;
async function hrrrLatest(first: number, fetcher: BytesFetcher): Promise<HrrrRun | undefined> {
  const now = Date.now();
  if (hrrrFound && hrrrFound.first === first && now - hrrrFound.at < RUN_KEPT) return hrrrFound;
  for (let back = 0; back <= HRRR.back; back++) {
    const run = first - HOUR - back * HOUR,
      prefix = `${hrrrRun(run).slice(HRRR.host.length + 1)}/`,
      listed = await fetcher(`${HRRR.host}/?list-type=2&prefix=${encodeURIComponent(prefix)}`);
    if (!listed.ok) continue;
    const sizes = new Map(
      [...(await listed.text()).split('<Contents>').join('\n').matchAll(LISTING)].map(([, key = '', size = '0']) => [
        key,
        Number(size),
      ]),
    );
    if (!sizes.has('.zarray')) continue;
    const response = await fetcher(`${hrrrRun(run)}/.zarray`);
    if (!response.ok) continue;
    const meta: unknown = JSON.parse(await response.text()),
      shape = isRecord(meta) ? meta['shape'] : undefined,
      hours = isList(shape) ? shape[0] : undefined;
    if (!finite(hours)) continue;
    hrrrFound = { first, at: now, run, hours, sizes };
    return hrrrFound;
  }
  return undefined;
}
// Tile areas whose tiles came to more than a view's worth (see HRRR.budget), and until when they
// are left to the regional model.
const declined = new Map<string, number>(),
  tilesKey = ({ left, right, bottom, top }: ReturnType<typeof hrrrTiles>) => `${left}:${right}:${bottom}:${top}`;
const hrrr: RainModel = {
  id: 'hrrr',
  credit: 'NOAA',
  native: HRRR.native,
  covers(bounds) {
    if (!coneCovers(hrrrCone, bounds)) return false;
    const tiles = hrrrTiles(windPoints(bounds, HRRR.native)),
      { left, right, bottom, top } = tiles;
    return (
      (right - left + 1) * (top - bottom + 1) <= HRRR.mostTiles && (declined.get(tilesKey(tiles)) ?? 0) <= Date.now()
    );
  },
  async load(grid, ends, fetcher, each) {
    const found = await hrrrLatest(Math.min(...ends), fetcher);
    if (!found) return 'tried';
    // The hours wanted, by their place in the run's tiles.
    const wanted = ends.flatMap(end => {
      const index = (end - found.run) / HOUR - 1;
      return index >= 0 && index < found.hours ? [{ end, index }] : [];
    });
    const { left, right, bottom, top } = hrrrTiles(grid),
      { tile } = HRRR,
      width = (right - left + 1) * tile,
      height = (top - bottom + 1) * tile,
      plane = width * height,
      hours = new Float32Array(wanted.length * plane).fill(Number.NaN),
      tiles = Array.from({ length: (right - left + 1) * (top - bottom + 1) }, (_, k) => ({
        col: left + (k % (right - left + 1)),
        row: bottom + Math.floor(k / (right - left + 1)),
      }));
    // What the tiles not yet kept would cost, from the listing, before any is asked for.
    const kept = await Promise.all(tiles.map(({ col, row }) => keptTile(`${hrrrRun(found.run)}/0.${row}.${col}`)));
    const cost = tiles.reduce(
      (sum, { col, row }, k) => sum + (kept[k] ? 0 : (found.sizes.get(`0.${row}.${col}`) ?? 0)),
      0,
    );
    if (cost > HRRR.budget) {
      declined.set(tilesKey({ left, right, bottom, top }), Date.now() + HRRR.declined);
      return 'declined';
    }
    await inTurn(tiles, async ({ col, row }, k = tiles.findIndex(each => each.col === col && each.row === row)) => {
      const url = `${hrrrRun(found.run)}/0.${row}.${col}`;
      let bytes = kept[k];
      if (!bytes) {
        const response = await fetcher(url);
        if (!response.ok) return;
        bytes = await response.arrayBuffer();
        void keepTile(url, bytes);
      }
      const raw = readBlosc(new Uint8Array(bytes)),
        view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength),
        square = tile * tile;
      wanted.forEach(({ index }, slot) => {
        for (let y = 0; y < tile; y++)
          for (let x = 0; x < tile; x++) {
            const value = view.getFloat32((index * square + y * tile + x) * FLOAT_BYTES, true);
            hours[slot * plane + ((row - bottom) * tile + y) * width + (col - left) * tile + x] =
              value === HRRR.fill ? Number.NaN : value;
          }
      });
    });
    const sample = onCone(grid, {
      ...hrrrCone,
      x: hrrrCone.x + left * tile * hrrrCone.dx,
      y: hrrrCone.y + bottom * tile * hrrrCone.dy,
      cols: width,
      rows: height,
    });
    wanted.forEach(({ end }, slot) => {
      each(end, sample(hours.subarray(slot * plane, (slot + 1) * plane), width, height));
    });
    return 'tried';
  },
};

// --- MEPS, MET Norway's model of the Nordic countries -----------------------------------------
// One OPeNDAP request for every hour: the precipitation since the run began, every so many points
// of the window over the view, with the window's coordinates. A run every three hours.
const MEPS = {
  catalog: 'https://thredds.met.no/thredds/catalog/mepslatest/catalog.xml',
  data: 'https://thredds.met.no/thredds/dodsC/mepslatest/',
  grid: {
    cone: { parallels: [63.3, 63.3], meridian: 15, radius: 6_371_000 },
    x: -1_060_084,
    y: -1_332_517.9,
    d: 2500,
    cols: 949,
    rows: 1069,
  },
  // The latitude the grid's own north counts from; its last hour; what it writes where it has none.
  origin: 63.3,
  hours: 66,
  fill: 9e36,
  native: 0.025,
  // Its answers come uncompressed: every hour of the window in no more than this many bytes.
  budget: 3_000_000,
} as const;
const mepsCone: ConeGrid = (() => {
  const { cone, x, y, d, cols, rows } = MEPS.grid;
  return { cone, x, y, dx: d, dy: d, cols, rows, shift: -lambert(cone)(MEPS.origin, cone.meridian).y };
})();
const RUN_NAME = /meps_det_2_5km_(\d{4})(\d{2})(\d{2})T(\d{2})Z\.ncml/g;
let mepsRuns: { at: number; runs: number[] } | undefined;
async function mepsLatest(fetcher: BytesFetcher): Promise<number[]> {
  const now = Date.now();
  if (mepsRuns && now - mepsRuns.at < RUN_KEPT) return mepsRuns.runs;
  const response = await fetcher(MEPS.catalog);
  if (!response.ok) return [];
  const runs = [...(await response.text()).matchAll(RUN_NAME)].map(([, y = '', m = '', d = '', h = '']) =>
    Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h)),
  );
  mepsRuns = { at: now, runs };
  return runs;
}
const meps: RainModel = {
  id: 'meps',
  credit: 'MET Norway',
  native: MEPS.native,
  covers: bounds => coneCovers(mepsCone, bounds),
  async load(grid, ends, fetcher, each) {
    const first = Math.min(...ends),
      last = Math.max(...ends),
      // The newest run that began before the first hour: its amounts start from the hour before.
      run = Math.max(...(await mepsLatest(fetcher)).filter(time => time <= first - HOUR));
    if (!Number.isFinite(run)) return 'tried';
    const from = (first - HOUR - run) / HOUR,
      to = Math.min(MEPS.hours, (last - run) / HOUR);
    // The window over the view, every so many points.
    const project = lambert(mepsCone.cone);
    let left = Infinity,
      right = -Infinity,
      bottom = Infinity,
      top = -Infinity;
    places(grid, (latitude, longitude) => {
      const { x, y } = project(latitude, longitude),
        col = (x - mepsCone.x) / mepsCone.dx,
        row = (y + mepsCone.shift - mepsCone.y) / mepsCone.dy;
      left = Math.min(left, col);
      right = Math.max(right, col);
      bottom = Math.min(bottom, row);
      top = Math.max(top, row);
    });
    const i0 = Math.max(0, Math.floor(left) - 1),
      i1 = Math.min(mepsCone.cols - 1, Math.ceil(right) + 1),
      j0 = Math.max(0, Math.floor(bottom) - 1),
      j1 = Math.min(mepsCone.rows - 1, Math.ceil(top) + 1),
      // Every so many points: no more across than the map's grid, nor more in all than fit the budget.
      most = MEPS.budget / ((to - from + 1) * FLOAT_BYTES),
      stride = Math.max(
        1,
        Math.ceil(Math.max(i1 - i0, j1 - j0) / MOST_POINTS),
        Math.ceil(Math.sqrt(((i1 - i0 + 1) * (j1 - j0 + 1)) / most)),
      ),
      name = new Date(run).toISOString().replace(/[-:]/g, '').slice(0, 'YYYYMMDDTHH'.length),
      range = (a: number, step: number, b: number) => `%5B${a}:${step}:${b}%5D`,
      url = `${MEPS.data}meps_det_2_5km_${name}Z.ncml.dods?precipitation_amount_acc${range(from, 1, to)}%5B0%5D${range(j0, stride, j1)}${range(i0, stride, i1)}`,
      response = await fetcher(url);
    if (!response.ok) return 'tried';
    const arrays = readDap(await response.arrayBuffer()),
      amounts = arrays.get('precipitation_amount_acc'),
      xs = arrays.get('x')?.values,
      ys = arrays.get('y')?.values;
    if (!amounts || !xs || !ys || xs.length < 2 || ys.length < 2) return 'tried';
    const cols = xs.length,
      rows = ys.length,
      size = cols * rows,
      sample = onCone(grid, {
        ...mepsCone,
        x: xs[0] ?? 0,
        y: ys[0] ?? 0,
        dx: (xs[1] ?? 0) - (xs[0] ?? 0),
        dy: (ys[1] ?? 0) - (ys[0] ?? 0),
        cols,
        rows,
      }),
      hourAmount = new Float32Array(size);
    for (let k = 1; k <= to - from; k++) {
      for (let i = 0; i < size; i++) {
        const now = amounts.values[k * size + i] ?? Number.NaN,
          before = amounts.values[(k - 1) * size + i] ?? Number.NaN;
        hourAmount[i] = now > MEPS.fill || before > MEPS.fill ? Number.NaN : Math.max(0, now - before);
      }
      each(run + (from + k) * HOUR, sample(hourAmount, cols, rows));
    }
    return 'tried';
  },
};

// --- Canada's regional and global models, from MSC GeoMet --------------------------------------
// A WCS request an hour, answered with exactly the points asked for, as 32-bit floats.
const GEOMET = 'https://geo.weather.gc.ca/geomet',
  // Canada's regional model reaches every place from 15°N to the pole between these longitudes, and
  // answers 0 where it has nothing, so it is asked only within them.
  REGIONAL = { south: 15, north: 85, west: -140, east: -50 } as const,
  CANADA_NATIVE = { regional: 0.09, global: 0.15 } as const,
  POLE = 89.9;
function geomet(id: 'rdps' | 'gdps', layer: string, native: number, covers: (bounds: Bounds) => boolean): RainModel {
  return {
    id,
    credit: 'Environment and Climate Change Canada',
    native,
    covers,
    async load(grid, ends, fetcher, each) {
      // The points' cells, so each answered value sits on a point of the grid; either side of the
      // date line a part of its own, as the service's longitudes stop there.
      const north = Math.min(POLE, grid.north + grid.step / 2),
        south = Math.max(-POLE, grid.north - (grid.rows - 1 / 2) * grid.step),
        west = grid.west - grid.step / 2,
        east = grid.west + (grid.cols - 1 / 2) * grid.step,
        rows = Math.max(1, Math.round((north - south) / grid.step)),
        parts: [number, number][] =
          east > HALF_TURN
            ? [
                [west, HALF_TURN],
                [-HALF_TURN, east - FULL_TURN],
              ]
            : west < -HALF_TURN
              ? [
                  [west + FULL_TURN, HALF_TURN],
                  [-HALF_TURN, east],
                ]
              : [[west, east]];
      await inTurn(ends, async end => {
        const geos: GeoGrid[] = [];
        for (const [from, to] of parts) {
          const response = await fetcher(
            `${GEOMET}?service=WCS&version=2.0.1&request=GetCoverage&coverageId=${layer}&format=image/tiff&subsettingcrs=EPSG:4326&subset=lat(${degrees(south)},${degrees(north)})&subset=lon(${degrees(from)},${degrees(to)})&scalesize=lat(${rows}),lon(${Math.max(1, Math.round((to - from) / grid.step))})&time=${isoHour(end)}`,
          );
          if (!response.ok) return;
          geos.push(readGeoTiff(await response.arrayBuffer()));
        }
        each(end, fromGeo(grid, geos));
      });
      return 'tried';
    },
  };
}
const rdps = geomet(
    'rdps',
    'RDPS_10km_Precip-Accum1h',
    CANADA_NATIVE.regional,
    bounds =>
      bounds.south >= REGIONAL.south &&
      bounds.north <= REGIONAL.north &&
      bounds.west >= REGIONAL.west &&
      bounds.east <= REGIONAL.east,
  ),
  gdps = geomet('gdps', 'GDPS_15km_Precip-Accum1h', CANADA_NATIVE.global, () => true);

// --- Open-Meteo, behind them all ------------------------------------------------------------
// Its forecast at as many points of a grid as 300 allow over the view, a quarter hour at a time,
// each hour the sum of its four. Keyless; counted by the point against the shared daily limit, so it
// is asked only when every model above it has failed.
const OPEN_METEO_GRID = {
    points: 300,
    finest: 0.05,
    grow: 1.05,
  } as const,
  QUARTER = 15 * MINUTE;
const openMeteo: RainModel = {
  id: 'open-meteo',
  credit: 'Open-Meteo',
  native: OPEN_METEO_GRID.finest,
  stepFor(bounds) {
    const count = (step: number) => {
      const points = windPoints(bounds, step);
      return points.rows * points.cols;
    };
    let step = Math.max(
      OPEN_METEO_GRID.finest,
      Math.sqrt(((bounds.north - bounds.south) * (bounds.east - bounds.west)) / OPEN_METEO_GRID.points),
    );
    while (count(step) > OPEN_METEO_GRID.points) step *= OPEN_METEO_GRID.grow;
    return step;
  },
  covers: () => true,
  async load(grid, ends, fetcher, each) {
    const { count, query } = gridPoints(grid);
    if (count > OPEN_METEO_GRID.points) return 'declined';
    const now = Date.now(),
      past = Math.max(1, Math.ceil((now - Math.min(...ends) + HOUR) / QUARTER) + 1),
      ahead = Math.max(1, Math.ceil((Math.max(...ends) - now) / QUARTER) + 1),
      response = await fetcher(
        `${OPEN_METEO.forecast}?${query}&minutely_15=precipitation&past_minutely_15=${past}&forecast_minutely_15=${ahead}&timeformat=unixtime`,
      );
    if (!response.ok) return 'tried';
    const body: unknown = JSON.parse(await response.text()),
      entries = isList(body) ? body : [body];
    if (entries.length !== count) return 'tried';
    const quarters = entries.map(entry => {
      const minutes = isRecord(entry) && isRecord(entry['minutely_15']) ? entry['minutely_15'] : {},
        times = minutes['time'],
        amounts = minutes['precipitation'];
      return { times: isList(times) ? times : [], amounts: isList(amounts) ? amounts : [] };
    });
    // Each quarter's amount at its end, in the hour it ends in.
    for (const end of ends) {
      const values = new Float32Array(count).fill(Number.NaN);
      quarters.forEach(({ times, amounts }, i) => {
        let sum = 0,
          seen = 0;
        times.forEach((time, k) => {
          const amount = amounts[k];
          if (finite(time) && finite(amount) && fromUnix(time) > end - HOUR && fromUnix(time) <= end) {
            sum += amount;
            seen += 1;
          }
        });
        if (seen > 0) values[i] = sum;
      });
      each(end, values);
    }
    return 'tried';
  },
};

// --- Choosing and loading ----------------------------------------------------------------------
// The finest model first, Open-Meteo last.
export const RAIN_MODELS: readonly RainModel[] = [meps, hrrr, rdps, gdps, openMeteo];

export interface RainPlan {
  model: RainModel;
  points: WindPoints;
}
// Every model that covers a view's bounds and isn't resting, finest first, each with the grid it
// would be put on: as fine as the model, unless the view is so wide that would make too many points.
export function rainPlans(bounds: Bounds, models: readonly RainModel[] = RAIN_MODELS): RainPlan[] {
  const span = Math.max(bounds.north - bounds.south, bounds.east - bounds.west);
  return models
    .filter(model => !rests(model.id) && model.covers(bounds))
    .map(model => ({
      model,
      points: windPoints(bounds, Math.max(model.stepFor?.(bounds) ?? model.native, span / MOST_POINTS)),
    }));
}
// The model a view is read from while all is well: the first of its plans.
export const rainPlan = (bounds: Bounds, models: readonly RainModel[] = RAIN_MODELS): RainPlan | undefined =>
  rainPlans(bounds, models)[0];

// The hours of the first plan that answers, each the hour's amount at its end, as they come:
// `update` hears each time one more has (in time order, an hour apart but where one failed), and
// from which plan. A model that answers nothing rests (see REST) and the next is asked.
export async function loadRain(
  plans: readonly RainPlan[],
  now: number,
  update: (hours: WindHours, plan: RainPlan) => void,
  fetcher: BytesFetcher = fetch,
): Promise<{ hours: WindHours; plan: RainPlan } | null> {
  const first = Math.floor(now / HOUR) * HOUR - BEFORE * HOUR,
    ends = Array.from({ length: HOURS }, (_, k) => first + k * HOUR)
      // The hour now first, then outward from it.
      .sort((a, b) => Math.abs(a - now - HOUR / 2) - Math.abs(b - now - HOUR / 2));
  for (const plan of plans) {
    const come = new Map<number, ScalarField>(),
      // What has come, in time order.
      gathered = (): WindHours => {
        const times = [...come.keys()].sort((a, b) => a - b);
        return { times, fields: [], precipitation: times.flatMap(time => come.get(time) ?? []), slot: HOUR };
      };
    let answer: Answer = 'tried';
    try {
      answer = await plan.model.load(plan.points, ends, fetcher, (end, values) => {
        come.set(end, { ...plan.points, values });
        update(gathered(), plan);
      });
    } catch {}
    if (come.size > 0) return { hours: gathered(), plan };
    if (answer !== 'declined') resting.set(plan.model.id, Date.now() + REST);
  }
  return null;
}
