// The air over the United States, southern Canada and northern Mexico as its monitors read it:
// AirNow's latest contours, the areas standing in each band of the US index, made afresh each
// hour. A model's grid asked for point by point can't be fine enough, seen from far out, to show
// one city's air beside the next; these can, in a file of a few thousand corners. They are drawn
// over the grid's points as a field of the index, soft at their edges, with the model's own
// reading wherever they don't reach.
import { type Fetcher, askJson } from '../lib/asking.ts';
import { AIRNOW } from '../lib/services.ts';
import { clamp, finite, isList, isRecord } from '../lib/values.ts';
import { MINUTE } from '../lib/time.ts';
import { type Bounds, type ScalarField, type WindPoints, gridAt, windBounds, windPoints } from './sources.ts';

export const AIR_CONTOUR_CREDIT = 'AirNow';
// Where the contours reach.
export const AIR_CONTOUR_REACH: Bounds = { north: 60, south: 20, west: -130, east: -59.5 };

type Ring = readonly (readonly [number, number])[];
// One area in a band of the index, 1 (good) to 6 (hazardous): its outline, then any holes in it.
export interface AirContour {
  band: number;
  rings: readonly Ring[];
}

// The index each band is drawn as: the reading at which the scale shows that band's own colour.
const BAND_INDEX = [25, 75, 125, 175, 250, 400],
  BANDS = BAND_INDEX.length;
export function bandIndex(band: number): number {
  const held = clamp(band, 1, BANDS),
    low = Math.floor(held),
    from = BAND_INDEX[low - 1] ?? 0,
    to = BAND_INDEX[low] ?? from;
  return from + (to - from) * (held - low);
}

const ring = (points: unknown): Ring =>
  isList(points)
    ? points.flatMap((point): [number, number][] => {
        if (!isList(point)) return [];
        const [longitude, latitude] = point;
        return finite(longitude) && finite(latitude) ? [[longitude, latitude]] : [];
      })
    : [];
const polygon = (rings: unknown): Ring[] => (isList(rings) ? rings.map(ring).filter(each => each.length > 2) : []);

// The contours in what the service sends, the lowest band first, so that a worse one inside a
// better is drawn over it.
export function airContours(body: unknown): AirContour[] {
  const features = isRecord(body) && isList(body['features']) ? body['features'] : [];
  const found = features.flatMap((feature): AirContour[] => {
    if (!isRecord(feature) || !isRecord(feature['properties']) || !isRecord(feature['geometry'])) return [];
    const band = feature['properties']['gridcode'],
      { type, coordinates } = feature['geometry'];
    if (!finite(band) || band < 1 || band > BANDS) return [];
    const polygons =
      type === 'Polygon'
        ? [polygon(coordinates)]
        : type === 'MultiPolygon' && isList(coordinates)
          ? coordinates.map(polygon)
          : [];
    return polygons.filter(rings => rings.length > 0).map(rings => ({ band, rings }));
  });
  return [...found].sort((a, b) => a.band - b.band);
}

// Kept ten minutes, and asked for once however many maps want them.
const KEPT = 10 * MINUTE;
let held: { at: number; contours: Promise<AirContour[]> } | undefined;
export function loadAirContours(fetcher: Fetcher = fetch): Promise<AirContour[]> {
  const now = Date.now();
  if (!held || now - held.at > KEPT) {
    const asked = { at: now, contours: askJson(fetcher, AIRNOW.contours, AIR_CONTOUR_CREDIT).then(airContours) };
    held = asked;
    // One that failed is asked for again by the next map.
    asked.contours.catch(() => {
      if (held === asked) held = undefined;
    });
  }
  return held.contours;
}
export function forgetAirContours() {
  held = undefined;
}

// The points the contours are drawn over for a view whose model grid is `coarse`: the same
// ground at 240 points across, and never closer than the contours' own corners are worth; or
// none where the contours don't reach it.
const ACROSS = 240,
  CLOSEST = 0.05;
export function airPoints(coarse: WindPoints): WindPoints | null {
  const bounds = windBounds(coarse),
    reach = AIR_CONTOUR_REACH;
  if (bounds.south > reach.north || bounds.north < reach.south || bounds.west > reach.east || bounds.east < reach.west)
    return null;
  return windPoints(bounds, Math.max(CLOSEST, (bounds.east - bounds.west) / ACROSS));
}

// A band is painted as this much red, so six fit a byte with room between them.
const BAND_SHADE = 40,
  BYTE = 255,
  CHANNELS = 4,
  ALPHA = 3;
// An edge between two bands is softened over about a third of a degree, and at least a point
// either side, which leaves a small area of bad air its own colour: softened further, a town's
// red hour fades to orange.
const SOFT_DEGREES = 0.3,
  SOFTEST = 12;

// Each value the mean of those within `radius` of it along its row, then along its column.
function softened(values: Float32Array, cols: number, rows: number, radius: number): Float32Array {
  const pass = (from: Float32Array, count: number, lines: number, at: (line: number, i: number) => number) => {
    const to = new Float32Array(from.length);
    for (let line = 0; line < lines; line++)
      for (let i = 0; i < count; i++) {
        let sum = 0,
          taken = 0;
        for (let k = Math.max(0, i - radius); k <= Math.min(count - 1, i + radius); k++) {
          sum += from[at(line, k)] ?? 0;
          taken++;
        }
        to[at(line, i)] = sum / taken;
      }
    return to;
  };
  return pass(
    pass(values, cols, rows, (row, col) => row * cols + col),
    rows,
    cols,
    (col, row) => row * cols + col,
  );
}

// The index at each of `points`: the contours' where they reach, `under`'s (the model's, on its
// own coarser points) where they don't, and the two mixed across a contour's outer edge. None
// if the contours cover none of the points.
export function contourField(
  contours: readonly AirContour[],
  points: WindPoints,
  under?: ScalarField,
): ScalarField | null {
  const { north, west, step, rows, cols } = points,
    canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || contours.length === 0) return null;
  // Each point at the middle of its pixel.
  for (const { band, rings } of contours) {
    ctx.fillStyle = `rgb(${band * BAND_SHADE} 0 0)`;
    ctx.beginPath();
    for (const points of rings) {
      points.forEach(([longitude, latitude], i) => {
        const x = (longitude - west) / step + 1 / 2,
          y = (north - latitude) / step + 1 / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
    ctx.fill('evenodd');
  }
  const { data } = ctx.getImageData(0, 0, cols, rows),
    count = rows * cols,
    cover = new Float32Array(count),
    bands = new Float32Array(count);
  let covered = false;
  for (let i = 0; i < count; i++) {
    const share = (data[i * CHANNELS + ALPHA] ?? 0) / BYTE;
    cover[i] = share;
    bands[i] = ((data[i * CHANNELS] ?? 0) / BAND_SHADE) * share;
    if (share > 0) covered = true;
  }
  if (!covered) return null;
  const radius = clamp(Math.round(SOFT_DEGREES / step), 1, SOFTEST),
    reach = softened(cover, cols, rows, radius),
    band = softened(bands, cols, rows, radius),
    values = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const share = reach[i] ?? 0,
      index = share > 0 ? bandIndex((band[i] ?? 0) / share) : Number.NaN,
      beyond = under
        ? gridAt(under, under.values, north - Math.floor(i / cols) * step, west + (i % cols) * step)
        : Number.NaN;
    values[i] = Number.isFinite(beyond)
      ? share > 0
        ? index * share + beyond * (1 - share)
        : beyond
      : share >= 1 / 2
        ? index
        : Number.NaN;
  }
  return { ...points, values };
}
