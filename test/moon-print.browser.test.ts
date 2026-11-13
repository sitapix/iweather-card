import { afterEach, expect, test, vi } from 'vitest';
import { drawMoon } from '../src/sky/moon.ts';

// Without WebGL2 the calendar's moon is drawn on the CPU, and comes out as the GPU draws it: white,
// as much as its light, a full moon bright and a new one a faint disc.
afterEach(() => {
  vi.restoreAllMocks();
});

const tones = (canvas: HTMLCanvasElement) => {
  const { data } = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height) ?? { data: [] },
    alphas: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    if (!(data[i + 3] ?? 0)) continue;
    expect([data[i], data[i + 1], data[i + 2]]).toEqual([255, 255, 255]);
    alphas.push(data[i + 3] ?? 0);
  }
  return alphas.reduce((sum, alpha) => sum + alpha, 0) / alphas.length;
};

test('without WebGL2 the calendar’s moon is still white light, bright at full and faint at new', async () => {
  // The GPU asks for its context first of all, and keeps the answer.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValueOnce(null);
  const moon = async (phase: number) => {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:40px;height:40px';
    document.body.append(canvas);
    await drawMoon(canvas, phase, 0, 'calendar');
    expect(canvas.dataset['drawn']).toMatch(/:calendar$/u);
    return canvas;
  };
  expect(tones(await moon(0.5))).toBeGreaterThan(110);
  const dark = tones(await moon(0));
  expect(dark).toBeGreaterThan(5);
  expect(dark).toBeLessThan(25);
  document.body.replaceChildren();
});
