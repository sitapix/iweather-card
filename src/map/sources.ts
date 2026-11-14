import { HALF_TURN, FULL_TURN } from '../lib/compass.ts';
import { type Fetcher, askJson } from '../lib/asking.ts';
import { COORDINATE_DIGITS, OPEN_METEO, RAINVIEWER } from '../lib/services.ts';
import { isRecord, text, isList, finite } from '../lib/values.ts';
import { HOUR, MINUTE, fromUnix } from '../lib/time.ts';
import type { ForecastEntry } from '../card/home-assistant.ts';
import { conditionPrecipitation } from '../weather/precipitation.ts';
import { type RainOutlook, rainOutlook } from '../weather/rain-outlook.ts';
import type { MapLayerKind } from '../card/config.ts';
import { NEAR_MINUTES } from '../cards/next-hour/rules.ts';

// --- Radar map -------------------------------------------------------------
// Web Mercator tile coordinates (fractional) for a location at a zoom level.
const MERCATOR_LIMIT = (Math.atan(Math.sinh(Math.PI)) * HALF_TURN) / Math.PI;
export function tilePoint(latitude: number, longitude: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom,
    phi = (Math.max(-MERCATOR_LIMIT, Math.min(MERCATOR_LIMIT, latitude)) * Math.PI) / HALF_TURN;
  return {
    x: ((longitude + HALF_TURN) / FULL_TURN) * n,
    y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n,
  };
}

// The 256-pixel tiles that cover a width × height view centred on the point, each
// with its offset in the view.
export interface MapTile {
  x: number;
  y: number;
  z: number;
  left: number;
  top: number;
}

export function tileGrid(
  latitude: number,
  longitude: number,
  zoom: number,
  width: number,
  height: number,
  size = 256,
): MapTile[] {
  const { x, y } = tilePoint(latitude, longitude, zoom),
    n = 2 ** zoom,
    tiles: MapTile[] = [];
  const left = x * size - width / 2,
    top = y * size - height / 2;
  for (let ty = Math.floor(top / size); ty * size < top + height; ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(left / size); tx * size < left + width; tx++)
      tiles.push({
        x: ((tx % n) + n) % n,
        y: ty,
        z: zoom,
        left: Math.round(tx * size - left),
        top: Math.round(ty * size - top),
      });
  }
  return tiles;
}

// RainViewer's observations, ten minutes apart. Future frames come from a separate model source.
export interface RadarFrame {
  time: number;
  url: string;
}

export async function radarFrames(fetcher: Fetcher = fetch): Promise<RadarFrame[]> {
  const data = await askJson(fetcher, RAINVIEWER.frames, 'RainViewer'),
    radar = isRecord(data) && isRecord(data['radar']) ? data['radar'] : {},
    host = isRecord(data) && text(data['host']) ? data['host'] : '';
  const frames = (key: string): readonly unknown[] => {
    const list = radar[key];
    return isList(list) ? list : [];
  };
  return frames('past').flatMap(frame =>
    isRecord(frame) && finite(frame['time']) && text(frame['path'])
      ? [{ time: fromUnix(frame['time']), url: `${host}${frame['path']}` }]
      : [],
  );
}

export const MAP_ZOOM = 7;

// The place at fractional tile coordinates (the inverse of tilePoint).
export function tilePlace(x: number, y: number, zoom: number): { latitude: number; longitude: number } {
  const n = 2 ** zoom;
  return {
    longitude: (x / n) * FULL_TURN - HALF_TURN,
    latitude: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * HALF_TURN) / Math.PI,
  };
}

// --- Wind map --------------------------------------------------------------
// The wind across a map, hour by hour: a grid of points over what it shows, 1.25° apart (about
// 110 px) at its usual zoom, each with the wind 10 m up, for the sixteen hours the map's
// timeline plays: from three before this one to twelve after it (at 9:41, 6 AM to 9 PM). Held
// as the wind's push east and north in m/s, which blend between points and hours where
// bearings would not.
export const WIND_STEP = 1.25;

export const WIND_HOURS = { before: 3, after: 12 } as const;

// A grid's north-west point, the degrees between its points, and its size.
export interface WindPoints {
  north: number;
  west: number;
  step: number;
  rows: number;
  cols: number;
}

export interface WindField extends WindPoints {
  // Row by row from the north, west to east.
  east: Float32Array;
  northward: Float32Array;
}

// A reading at every point of a grid, row by row from the north, west to east; NaN where none
// came.
export interface ScalarField extends WindPoints {
  values: Float32Array;
}

// The map's readings hour by hour: each hour's start (ms) and its wind, and on the same points
// where asked for, the temperature (°C) and the US AQI; or the precipitation, each slot's end and
// its rate (mm an hour), with no wind (see loadRain), and how long its slots are.
export interface WindHours {
  times: number[];
  fields: WindField[];
  temperature?: ScalarField[];
  precipitation?: ScalarField[];
  aqi?: ScalarField[];
  slot?: number;
}

// Wind of `speed` m/s blowing from `bearing`, as its push east and north.
const push = (speed: number, bearing: number): [east: number, north: number] => {
  const toward = ((bearing + HALF_TURN) * Math.PI) / HALF_TURN;
  return [speed * Math.sin(toward), speed * Math.cos(toward)];
};

// One wind everywhere: the weather entity's, where nothing else is known.
export function steadyWind(speed: number, bearing: number): WindField {
  const [east, north] = push(speed, bearing);
  return {
    north: 0,
    west: 0,
    step: 1,
    rows: 1,
    cols: 1,
    east: Float32Array.of(east),
    northward: Float32Array.of(north),
  };
}

// A grid's reading at a place, blended from the four points around it; past the grid's edge,
// the edge's.
export function gridAt(grid: WindPoints, values: Float32Array, latitude: number, longitude: number): number {
  const { rows, cols, step } = grid,
    row = Math.min(rows - 1, Math.max(0, (grid.north - latitude) / step)),
    col = Math.min(cols - 1, Math.max(0, (longitude - grid.west) / step)),
    r = Math.min(rows - 2, Math.floor(row)),
    c = Math.min(cols - 2, Math.floor(col)),
    at = (i: number, j: number) => values[Math.max(0, i) * cols + Math.max(0, j)] ?? 0;
  if (rows < 2 || cols < 2) return at(0, 0);
  const fy = row - r,
    fx = col - c;
  return (at(r, c) * (1 - fx) + at(r, c + 1) * fx) * (1 - fy) + (at(r + 1, c) * (1 - fx) + at(r + 1, c + 1) * fx) * fy;
}

// The wind at a place: its push east and north there.
export const windAt = (field: WindField, latitude: number, longitude: number): [east: number, north: number] => [
  gridAt(field, field.east, latitude, longitude),
  gridAt(field, field.northward, latitude, longitude),
];

// Where `time` falls among the hours, as a fractional index, held to the first and last.
export function windHour({ times }: WindHours, time: number): number {
  const first = times[0];
  return first === undefined ? 0 : Math.min(times.length - 1, Math.max(0, (time - first) / HOUR));
}

// Points as far apart in pixels at every zoom: twice as far apart in degrees for each step out.
export const windStep = (zoom: number): number => WIND_STEP * 2 ** (MAP_ZOOM - zoom);

// The edges of a view or a grid, in degrees.
export interface Bounds {
  north: number;
  south: number;
  west: number;
  east: number;
}

// The grid of points `step` apart over `bounds`, centred on them with at least half a step to
// spare at each edge, and the edges of a grid.
export function windPoints(bounds: Bounds, step: number): WindPoints {
  const rows = Math.ceil((bounds.north - bounds.south) / step) + 2,
    cols = Math.ceil((bounds.east - bounds.west) / step) + 2;
  return {
    north: (bounds.north + bounds.south) / 2 + ((rows - 1) / 2) * step,
    west: (bounds.west + bounds.east) / 2 - ((cols - 1) / 2) * step,
    step,
    rows,
    cols,
  };
}

export const windBounds = ({ north, west, step, rows, cols }: WindPoints): Bounds => ({
  north,
  south: north - (rows - 1) * step,
  west,
  east: west + (cols - 1) * step,
});

// A grid of readings asked for: from the forecast (wind and temperature, or precipitation) or of
// the air; when, the degrees it spans and between its points, and its hours once they come.
export type GridSource = 'forecast' | 'air' | 'rain';

export interface WindGrid {
  source: GridSource;
  at: number;
  bounds: Bounds;
  step: number;
  hours: WindHours | null;
  // For precipitation, the model it came from (see rainPlan).
  model?: string;
}

export const covers = (outer: Bounds, inner: Bounds): boolean =>
  outer.north >= inner.north && outer.south <= inner.south && outer.west <= inner.west && outer.east >= inner.east;

// Open-Meteo's hourly wind at every point of a grid, in one request. Free and keyless; it
// answers with one entry per point, in the order asked, and counts each point as a call
// against its free limits (600 a minute, 10,000 a day).
const POLAR = 85;

// A grid's points as Open-Meteo's coordinate lists: held off the poles, within a turn.
export function gridPoints({ north, west, step, rows, cols }: WindPoints) {
  const points = Array.from({ length: rows * cols }, (_, i) => ({
    latitude: Math.max(-POLAR, Math.min(POLAR, north - Math.floor(i / cols) * step)),
    longitude: ((((west + (i % cols) * step + HALF_TURN) % FULL_TURN) + FULL_TURN) % FULL_TURN) - HALF_TURN,
  }));
  const list = (key: 'latitude' | 'longitude') => points.map(point => point[key].toFixed(COORDINATE_DIGITS)).join(',');
  return { count: points.length, query: `latitude=${list('latitude')}&longitude=${list('longitude')}` };
}

// A reading per point from Open-Meteo's entries, NaN where one is missing.
const scalar = (grid: WindPoints, count: number, value: (i: number) => unknown): ScalarField => ({
  ...grid,
  values: Float32Array.from({ length: count }, (_, i) => {
    const reading = value(i);
    return finite(reading) ? reading : Number.NaN;
  }),
});

// With the wind comes the temperature at the same points and hours, which costs no more:
// Open-Meteo counts the points, not up to ten readings at each.
export async function openMeteoWind(grid: WindPoints, fetcher: Fetcher = fetch): Promise<WindHours | null> {
  const { north, west, step, rows, cols } = grid;
  if (!finite(north) || !finite(west)) return null;
  const { count, query } = gridPoints(grid);
  const body = await askJson(
      fetcher,
      `${OPEN_METEO.forecast}?${query}&hourly=wind_speed_10m,wind_direction_10m,temperature_2m&past_hours=${WIND_HOURS.before}&forecast_hours=${WIND_HOURS.after + 1}&wind_speed_unit=ms&timeformat=unixtime`,
      'Open-Meteo',
    ),
    entries = isList(body) ? body : [body];
  if (entries.length !== count) throw new Error('Open-Meteo sent no wind for the map');
  const hourly = (entry: unknown) => (isRecord(entry) && isRecord(entry['hourly']) ? entry['hourly'] : {}),
    stamps = hourly(entries[0])['time'],
    times = isList(stamps) ? stamps.filter(finite).map(fromUnix) : [];
  const fields = times.map(() => ({
    north,
    west,
    step,
    rows,
    cols,
    east: new Float32Array(count),
    northward: new Float32Array(count),
  }));
  entries.forEach((entry, i) => {
    const { wind_speed_10m: speeds, wind_direction_10m: bearings } = hourly(entry);
    if (!isList(speeds) || !isList(bearings)) return;
    fields.forEach((field, hour) => {
      const speed = speeds[hour],
        bearing = bearings[hour];
      if (finite(speed) && finite(bearing)) [field.east[i], field.northward[i]] = push(speed, bearing);
    });
  });
  const reading = (key: string, hour: number) =>
    scalar(grid, count, i => {
      const list = hourly(entries[i])[key];
      return isList(list) ? list[hour] : undefined;
    });
  return times.length ? { times, fields, temperature: times.map((_, hour) => reading('temperature_2m', hour)) } : null;
}

// Where `time` falls among the precipitation's slots, as a fractional index held to the first and
// last: each slot's rate shows at its middle, half a slot before it ends. A slot that didn't come
// leaves a longer step between the two either side of it.
export function rainSlot({ times, slot = HOUR }: Pick<WindHours, 'times' | 'slot'>, time: number): number {
  const middle = (i: number) => (times[i] ?? 0) - slot / 2,
    last = times.length - 1;
  if (last < 0 || time <= middle(0)) return 0;
  if (time >= middle(last)) return last;
  let low = 0,
    high = last;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (middle(mid) <= time) low = mid;
    else high = mid;
  }
  return low + (time - middle(low)) / (middle(high) - middle(low));
}
// The hours the precipitation timeline marks at `now`: from three before this one to twelve after.
export const rainTimeline = (now: number): number[] =>
  Array.from(
    { length: WIND_HOURS.before + WIND_HOURS.after + 1 },
    (_, hour) => now - (now % HOUR) + (hour - WIND_HOURS.before) * HOUR,
  );

// Open-Meteo's US AQI now at every point of a grid, in one request; keyless, and counted by the
// point like the forecast.
export async function openMeteoAir(grid: WindPoints, fetcher: Fetcher = fetch): Promise<WindHours | null> {
  if (!finite(grid.north) || !finite(grid.west)) return null;
  const { count, query } = gridPoints(grid);
  const body = await askJson(
      fetcher,
      `${OPEN_METEO.airQuality}?${query}&current=us_aqi&timeformat=unixtime`,
      'Open-Meteo',
    ),
    entries = isList(body) ? body : [body];
  if (entries.length !== count) throw new Error('Open-Meteo sent no air quality for the map');
  const current = (entry: unknown) => (isRecord(entry) && isRecord(entry['current']) ? entry['current'] : {}),
    time = current(entries[0])['time'];
  return finite(time)
    ? { times: [fromUnix(time)], fields: [], aqi: [scalar(grid, count, i => current(entries[i])['us_aqi'])] }
    : null;
}

// Which map to show: the forecast panel's choice while it shows wind, or precipitation with the
// radar to show it; else precipitation while precipitation is near (the next-hour panel is up, it is falling, or the coming hour brings
// it within 50 minutes); else air quality when it is bad enough to put first (see
// airIsSignificant); else the wind, on a dry day when it is windy or gusting past 15 mph; else
// the radar, or without it the temperature, the map with something to show.
export interface MapChoice {
  // The forecast panel's view ('conditions', 'rain' or 'wind').
  mode?: string | undefined;
  // The weather entity's condition.
  state?: string | undefined;
  hourly?: readonly ForecastEntry[];
  now?: number;
  // The next-hour panel is showing precipitation on its way.
  nextHour?: boolean;
  // How soon precipitation comes (see rainOutlook), which sets how far out its map looks.
  outlook?: RainOutlook | undefined;
  radar?: boolean;
  // The air quality is bad enough to put first.
  airSignificant?: boolean;
  // The strongest wind now, gusts included, in km/h.
  gust?: number | undefined;
}

// Whether a condition brings precipitation.
const wet = (condition: string | undefined) => conditionPrecipitation(condition) !== undefined;

// Gusts past this, in km/h (15 mph), are worth a map of their own on a dry day.
const GUSTY = 24.14;
// A day stops being dry at two hours of the next twelve with a 30% chance of precipitation. An
// hour with no chance on it goes by what it brings.
const DRY_DAY = { hours: 12, chance: 30, wetHours: 2 } as const;
const wetHours = (hourly: readonly ForecastEntry[], now: number): number =>
  hourly.filter(entry => {
    const t = Date.parse(entry.datetime ?? ''),
      chance = entry.precipitation_probability;
    if (!(t > now - HOUR && t <= now + DRY_DAY.hours * HOUR)) return false;
    return finite(chance) ? chance >= DRY_DAY.chance : (entry.precipitation ?? 0) > 0 || wet(entry.condition);
  }).length;
const blowing = (state: string | undefined, gust: number | undefined) =>
  state === 'windy' || state === 'windy-variant' || (finite(gust) && gust > GUSTY);

// How long until the hourly forecast next brings precipitation; forever if it doesn't.
const rainDue = (hourly: readonly ForecastEntry[], now: number): number =>
  Math.min(
    Number.POSITIVE_INFINITY,
    ...hourly.flatMap(entry => {
      const t = Date.parse(entry.datetime ?? '');
      return t > now && ((entry.precipitation ?? 0) > 0 || wet(entry.condition)) ? [t - now] : [];
    }),
  );

export function mapKind({
  mode,
  state,
  hourly = [],
  now = Date.now(),
  nextHour = false,
  radar = false,
  airSignificant = false,
  gust,
}: MapChoice = {}): MapLayerKind {
  if (mode === 'wind') return 'wind';
  if (mode === 'rain' && radar) return 'precipitation';
  const near = rainDue(hourly, now) <= NEAR_MINUTES * MINUTE;
  if (nextHour || near || wet(state)) return 'precipitation';
  if (airSignificant) return 'air_quality';
  if (mode !== 'rain' && blowing(state, gust) && wetHours(hourly, now) < DRY_DAY.wetHours) return 'wind';
  return radar ? 'precipitation' : 'temperature';
}

// How far out the large map opens. Precipitation opens by its outlook (see rainOutlook): close in
// while it is falling and further out the longer it is off, out to the whole region with none due,
// so that what is coming is in view; each other layer has a distance of its own.
const OPENING_ZOOMS = { wind: 6, temperature: 6.5, air_quality: 10 } as const,
  RAIN_ZOOMS: Readonly<Record<RainOutlook, number>> = {
    now: 8.5,
    nextHour: 8,
    nextThreeHours: 6.5,
    nextSixHours: 5.5,
    none: 4,
    unknown: 4,
  };

export function openingZoom(kind: MapLayerKind, { hourly = [], now = Date.now(), outlook }: MapChoice = {}): number {
  if (kind !== 'precipitation') return OPENING_ZOOMS[kind];
  return RAIN_ZOOMS[outlook ?? rainOutlook([], hourly, now)];
}
