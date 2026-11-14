import { afterEach, expect, test, vi } from 'vitest';
import { drawMoon, loadSkyMoon, skyMoon } from '../src/sky/moon.ts';
import { skyMoonTint } from '../src/sky/sky.ts';

test('the sky moon applies the horizon tint once while retaining the phase texture', async () => {
  expect(await loadSkyMoon()).toBe(true);
  const plain = skyMoon(32, 0.5, 0, skyMoonTint('#ffffff', '#ffffff', 0));
  const tinted = skyMoon(32, 0.5, 0.1, skyMoonTint('#ffffff', '#0080ff', 0.1));
  expect(plain).toBeTruthy();
  expect(tinted).toBeTruthy();
  if (!plain || !tinted) return;
  const pixels = (canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Missing sky canvas');
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
  };
  const white = pixels(plain),
    warm = pixels(tinted);
  let checked = 0;
  for (let i = 0; i < white.length; i += 4) {
    const red = white[i] ?? 0;
    if (red < 48 || white[i + 3] !== 255) continue;
    expect(Math.abs((warm[i] ?? 0) - (red * 230) / 255)).toBeLessThanOrEqual(1);
    expect(warm[i + 2]).toBe(white[i + 2]);
    expect(warm[i + 3]).toBe(white[i + 3]);
    checked++;
  }
  expect(checked).toBeGreaterThan(10);
});

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
