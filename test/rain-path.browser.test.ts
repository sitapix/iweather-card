import { expect, test } from 'vitest';
import { context2d } from '../src/lib/canvas.ts';
import { RainPath } from '../src/sky/rain-path.ts';

// Cross tile boundaries, overlap, double back, and enter from outside the canvas.
const LINES = [
  [-20, 256, 800, 256],
  [256, -20, 256, 600],
  [250, 250, 265, 265],
  [265, 250, 250, 265],
  [510, 500, 520, 520],
  [510, 500, 520, 520],
  [800, 100, -20, 100],
  [-20, -20, -10, -10],
  [800, 800, 900, 900],
] as const;

test.each([1, 1.5, 2, 3].flatMap(scale => [false, true].map(diagonal => ({ scale, diagonal }))))(
  'rain tiles preserve overlaps and have no seams: %o',
  ({ scale, diagonal }) => {
    for (const lineCap of ['butt', 'round', 'square'] as const) {
      const image = document.createElement('canvas');
      for (const alpha of [1, 0.4]) {
        const target = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 901;
          canvas.height = 707;
          const ctx = context2d(canvas);
          ctx.beginPath();
          ctx.rect(3, 5, 890, 695);
          ctx.clip();
          ctx.setTransform(scale, 0, 0, scale, 0.5, -1.25);
          ctx.lineCap = lineCap;
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(255,255,255,0.3)';
          ctx.globalAlpha = alpha;
          return ctx;
        };
        const expected = target(),
          actual = target(),
          original = new Path2D(),
          tiled = new RainPath(actual.getTransform(), actual.canvas.width, actual.canvas.height, actual.lineWidth);
        for (const [ax, ay, bx, by] of LINES) {
          if (!diagonal && ax !== bx && ay !== by) continue;
          original.moveTo(ax, ay);
          original.lineTo(bx, by);
          tiled.line(ax, ay, bx, by);
        }
        expected.stroke(original);
        tiled.stroke(actual, image);
        const a = actual.getImageData(0, 0, actual.canvas.width, actual.canvas.height).data,
          b = expected.getImageData(0, 0, expected.canvas.width, expected.canvas.height).data;
        let worst = 0,
          total = 0;
        for (let i = 3; i < a.length; i += 4) {
          const difference = Math.abs((a[i] ?? 0) - (b[i] ?? 0));
          worst = Math.max(worst, difference);
          total += difference;
        }
        // Axis-aligned crossings permit only surface-copy rounding. Native rasterizers
        // vary at diagonal intersections when path bounds change; keep that difference
        // local and small, while rejecting missing streaks or accumulated overlap opacity.
        expect(worst, `${lineCap}, alpha ${alpha}`).toBeLessThanOrEqual(diagonal ? 16 : 1);
        expect(total / (a.length / 4)).toBeLessThan(0.01);
        expect(actual.getTransform()).toEqual(expected.getTransform());
        expect(actual.globalAlpha).toBe(alpha);
        expect(actual.lineCap).toBe(lineCap);
        expect(actual.globalCompositeOperation).toBe('source-over');
        expect(image.width).toBe(258);
        expect(image.height).toBe(258);
      }
    }
  },
);
