// How a line runs between readings. A monotone cubic (Fritsch–Carlson) doesn't overshoot flat
// stretches such as UV 0 overnight: each tangent is the slopes' weighted harmonic mean. A Catmull–Rom
// runs freer, its tangent along the two readings either side, which with even hours is the uniform
// curve and with the reading now among them stays a function of time. Fewer than three points draw
// straight, and a cubic's handles reach a third of the way along each segment.
export type Curve = 'monotone' | 'catmullRom' | 'straight';
export const CURVES: readonly Curve[] = ['monotone', 'catmullRom', 'straight'];
export const CURVE_POINTS = 3,
  THIRD = 3;
export type XY = readonly [x: number, y: number];
// Each segment from one point to the next, with its width and slope, and the curve's slope at
// each point.
function curveOf(xy: readonly XY[], curve: Curve) {
  const segments = xy.slice(1).map((b, i) => {
    const a = xy[i] ?? b,
      dx = b[0] - a[0];
    return { a, b, dx, m: dx ? (b[1] - a[1]) / dx : 0 };
  });
  const tangents = xy.map((_, i) => {
    const before = segments[i - 1],
      after = segments[i];
    if (!before) return after?.m ?? 0;
    if (!after) return before.m;
    if (curve === 'catmullRom') return (before.m * before.dx + after.m * after.dx) / (before.dx + after.dx);
    return before.m * after.m <= 0
      ? 0
      : (THIRD * (before.dx + after.dx)) /
          ((2 * after.dx + before.dx) / before.m + (after.dx + 2 * before.dx) / after.m);
  });
  return { segments, tangents };
}
const straightPath = (xy: readonly XY[]): string =>
  xy.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join('');
export function smoothPath(xy: readonly XY[], curve: Curve = 'monotone'): string {
  const [start] = xy;
  if (curve === 'straight' || xy.length < CURVE_POINTS || !start) return straightPath(xy);
  const { segments, tangents } = curveOf(xy, curve);
  let path = `M${start[0].toFixed(1)} ${start[1].toFixed(1)}`;
  segments.forEach(({ a, b, dx }, i) => {
    const h = dx / THIRD,
      from = tangents[i] ?? 0,
      to = tangents[i + 1] ?? 0;
    path += `C${(a[0] + h).toFixed(1)} ${(a[1] + from * h).toFixed(1)} ${(b[0] - h).toFixed(1)} ${(b[1] - to * h).toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  });
  return path;
}
// The height of the line smoothPath draws through `xy` at `x` (within its ends): the cubic of the
// segment there, or straight between two points. The curve keeps its shape under any scale of
// either axis, so it can be followed in the chart's own shares as well as in readings.
export function heightAt(xy: readonly XY[], curve: Curve = 'monotone'): (x: number) => number {
  const { segments, tangents } = curveOf(xy, curve),
    straight = curve === 'straight' || xy.length < CURVE_POINTS;
  return x => {
    const found = segments.findIndex(({ b }) => x <= b[0]),
      index = found < 0 ? segments.length - 1 : found,
      segment = segments[index];
    if (!segment) return xy[0]?.[1] ?? 0;
    const { a, b, dx, m } = segment,
      t = dx ? Math.min(1, Math.max(0, (x - a[0]) / dx)) : 0;
    if (straight) return a[1] + m * dx * t;
    // The segment's cubic, as drawn: its handles a third of the way along at each end's tangent.
    const lerp = (from: number, to: number) => from + (to - from) * t,
      start = a[1] + ((tangents[index] ?? 0) * dx) / THIRD,
      end = b[1] - ((tangents[index + 1] ?? 0) * dx) / THIRD,
      [p, q, r] = [lerp(a[1], start), lerp(start, end), lerp(end, b[1])];
    return lerp(lerp(p, q), lerp(q, r));
  };
}
