// How far the rain moved between two radar frames painted alike: the shift that best lays the earlier
// over the later, found first on a coarse grid of their coverage and then refined on a finer one, in
// the frames' own pixels. Only places with rain in either frame are compared, so open sky neither
// pulls the shift towards nothing nor away from it, and of shifts that fit as well the shorter wins.
export interface Drift {
  x: number;
  y: number;
}
export const STILL: Drift = { x: 0, y: 0 };
// The coarse grid takes COARSE pixels a cell and looks REACH cells either way; the fine grid takes
// FINE pixels a cell and looks REFINE cells about where the coarse one landed.
const COARSE = 8,
  REACH = 6,
  FINE = 2,
  REFINE = 3,
  ALPHA = 3,
  CHANNELS = 4,
  // A cell counts as rain at a sixteenth of full cover.
  WET = 16;

// The pixels' cover (alpha), averaged over `cell`-pixel cells.
export function coverGrid(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  cell: number,
): { cover: Float32Array; cols: number; rows: number } {
  const cols = Math.floor(width / cell),
    rows = Math.floor(height / cell),
    cover = new Float32Array(cols * rows),
    area = cell * cell;
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      let sum = 0;
      for (let y = row * cell; y < (row + 1) * cell; y++)
        for (let x = col * cell; x < (col + 1) * cell; x++) sum += pixels[(y * width + x) * CHANNELS + ALPHA] ?? 0;
      cover[row * cols + col] = sum / area;
    }
  return { cover, cols, rows };
}

// The shift (in cells) about `around` within `reach` that best lays `before` over `after`: after at a
// cell matches before that far back. Null where neither has any rain.
export function bestShift(
  before: Float32Array,
  after: Float32Array,
  cols: number,
  rows: number,
  reach: number,
  around: Drift = STILL,
): Drift | null {
  let best = Number.POSITIVE_INFINITY,
    found: Drift | null = null;
  for (let dy = around.y - reach; dy <= around.y + reach; dy++)
    for (let dx = around.x - reach; dx <= around.x + reach; dx++) {
      let sum = 0,
        count = 0;
      for (let y = Math.max(0, dy); y < Math.min(rows, rows + dy); y++)
        for (let x = Math.max(0, dx); x < Math.min(cols, cols + dx); x++) {
          const now = after[y * cols + x] ?? 0,
            then = before[(y - dy) * cols + (x - dx)] ?? 0;
          if (now < WET && then < WET) continue;
          sum += Math.abs(now - then);
          count++;
        }
      if (count === 0) continue;
      const score = sum / count,
        shorter = found && Math.hypot(dx, dy) < Math.hypot(found.x, found.y);
      if (score < best || (score === best && shorter)) {
        best = score;
        found = { x: dx, y: dy };
      }
    }
  return found;
}

// The drift between two frames' pixels, `width` × `height`, in pixels from the first to the second.
export function driftBetween(
  before: Uint8ClampedArray,
  after: Uint8ClampedArray,
  width: number,
  height: number,
): Drift {
  const coarseBefore = coverGrid(before, width, height, COARSE),
    coarseAfter = coverGrid(after, width, height, COARSE),
    rough = bestShift(coarseBefore.cover, coarseAfter.cover, coarseAfter.cols, coarseAfter.rows, REACH);
  if (!rough) return STILL;
  const scale = COARSE / FINE,
    fineBefore = coverGrid(before, width, height, FINE),
    fineAfter = coverGrid(after, width, height, FINE),
    fine = bestShift(fineBefore.cover, fineAfter.cover, fineAfter.cols, fineAfter.rows, REFINE, {
      x: rough.x * scale,
      y: rough.y * scale,
    }) ?? { x: rough.x * scale, y: rough.y * scale };
  return { x: fine.x * FINE, y: fine.y * FINE };
}

// The drift between two radar frames painted by `paint` into canvases of their own, or none where
// either fails to paint.
export async function measureDrift<Frame>(
  paint: (canvas: HTMLCanvasElement, frame: Frame, signal: AbortSignal) => Promise<boolean>,
  before: Frame,
  after: Frame,
  signal: AbortSignal,
): Promise<Drift> {
  const [then, now] = [document.createElement('canvas'), document.createElement('canvas')],
    [painted, paintedToo] = await Promise.all([paint(then, before, signal), paint(now, after, signal)]),
    width = now.width,
    height = now.height;
  if (!painted || !paintedToo || !width || !height || then.width !== width || then.height !== height) return STILL;
  const read = (canvas: HTMLCanvasElement) => canvas.getContext('2d')?.getImageData(0, 0, width, height).data;
  const a = read(then),
    b = read(now);
  return a && b ? driftBetween(a, b, width, height) : STILL;
}

// Carries what `canvas` shows `x` and `y` of its pixels along.
export function carry(canvas: HTMLCanvasElement, x: number, y: number) {
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext('2d')?.drawImage(canvas, 0, 0);
  const context = canvas.getContext('2d');
  context?.clearRect(0, 0, canvas.width, canvas.height);
  context?.drawImage(copy, x, y);
}
