// Coverage is separate from precipitation: a valid zero is dry, a missing reading is unknown.
// Radar supplies its own mask; forecast models keep missing grid samples as NaN.
import type { ScalarField, MapTile } from './sources.ts';
import { pacedFetch } from './pace.ts';
import { coverageTile } from '../lib/services.ts';

// Diagonals every 8 screen pixels; provider tiles cover 256 map pixels.
const GAP_SPACING = 8,
  MAP_TILE = 256,
  CHANNELS = 4,
  ALPHA = CHANNELS - 1;

interface Bounds {
  north: number;
  south: number;
  west: number;
  east: number;
}
const inside = (field: ScalarField, latitude: number, longitude: number) =>
  latitude <= field.north &&
  latitude >= field.north - (field.rows - 1) * field.step &&
  longitude >= field.west &&
  longitude <= field.west + (field.cols - 1) * field.step;

export function rainReading(field: ScalarField, latitude: number, longitude: number): number {
  if (!inside(field, latitude, longitude)) return Number.NaN;
  const row = (field.north - latitude) / field.step,
    col = (longitude - field.west) / field.step,
    top = Math.floor(row),
    left = Math.floor(col),
    fy = row - top,
    fx = col - left;
  let value = 0;
  for (let y = 0; y < 2; y++)
    for (let x = 0; x < 2; x++) {
      const weight = (x ? fx : 1 - fx) * (y ? fy : 1 - fy);
      // At an exact grid point an unused neighbour must not invalidate a known dry reading.
      if (weight === 0) continue;
      const sample = field.values[(top + y) * field.cols + left + x];
      if (sample === undefined || !Number.isFinite(sample)) return Number.NaN;
      value += sample * weight;
    }
  return value;
}
// Whether the visible part of a grid has gaps. Inspect its cells, including the neighbours used
// for interpolation; data outside the viewport doesn't put an unavailable note over the map.
export function fieldGaps(field: ScalarField | undefined, view: Bounds): boolean {
  if (!field) return false;
  if (!inside(field, view.north, view.west) || !inside(field, view.south, view.east)) return true;
  const top = Math.max(0, Math.floor((field.north - view.north) / field.step)),
    bottom = Math.min(field.rows - 1, Math.ceil((field.north - view.south) / field.step)),
    left = Math.max(0, Math.floor((view.west - field.west) / field.step)),
    right = Math.min(field.cols - 1, Math.ceil((view.east - field.west) / field.step));
  for (let row = top; row <= bottom; row++)
    for (let col = left; col <= right; col++) if (!Number.isFinite(field.values[row * field.cols + col])) return true;
  return false;
}

// A crisp pattern at screen scale, cut out by a coverage mask already drawn onto this canvas.
// Dark strokes remain legible on both the pale map and the grey night map.
export function hatch(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d');
  if (!context) return;
  const pattern = new OffscreenCanvas(GAP_SPACING, GAP_SPACING),
    pen = pattern.getContext('2d');
  if (!pen) return;
  pen.strokeStyle = 'rgba(0,0,0,0.22)';
  pen.lineWidth = 2;
  pen.beginPath();
  for (const start of [-GAP_SPACING, 0, GAP_SPACING]) {
    pen.moveTo(start, GAP_SPACING);
    pen.lineTo(start + GAP_SPACING, 0);
  }
  pen.stroke();
  const fill = context.createPattern(pattern, 'repeat');
  if (!fill) return;
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = fill;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = 'source-over';
}

// Fallback maps use the same worldwide provider mask as the live map. Failed mask requests
// leave coverage unknown, rather than inventing an unavailable region from a blank radar image.
export async function drawRadarCoverage(
  canvas: HTMLCanvasElement,
  tiles: readonly MapTile[],
  grow: number,
  width: number,
  height: number,
  signal: AbortSignal,
): Promise<void> {
  canvas.width = Math.ceil(width);
  canvas.height = Math.ceil(height);
  const mask = new OffscreenCanvas(canvas.width, canvas.height),
    context = mask.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  await Promise.all(
    tiles.map(async tile => {
      try {
        const response = await pacedFetch(coverageTile(tile.z, tile.x, tile.y), signal);
        if (!response.ok) return;
        const image = await createImageBitmap(await response.blob());
        context.drawImage(image, tile.left * grow, tile.top * grow, MAP_TILE * grow, MAP_TILE * grow);
        image.close();
      } catch {
        // A cancelled or unavailable mask says nothing about coverage.
      }
    }),
  );
  if (signal.aborted) return;
  canvas.dataset['gaps'] = String(
    context.getImageData(0, 0, canvas.width, canvas.height).data.some((v, i) => i % CHANNELS === ALPHA && v > 0),
  );
  canvas.getContext('2d')?.drawImage(mask, 0, 0);
  hatch(canvas);
}
