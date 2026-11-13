import { expect, test } from 'vitest';
import { context2d } from '../src/lib/canvas.ts';
import { WeatherScene } from '../src/sky/scene.ts';

const canvas = (width: number, height: number) => {
  const image = document.createElement('canvas');
  image.width = width;
  image.height = height;
  const ctx = context2d(image),
    fill = ctx.createLinearGradient(0, 0, width, height);
  fill.addColorStop(0, '#18263c');
  fill.addColorStop(0.5, '#788ea8');
  fill.addColorStop(1, '#e5ded6');
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, height);
  ctx.scale(1.5, 1.5);
  return ctx;
};

test.each([
  [127, 251],
  [513, 387],
  [861, 390],
])('cached grain matches a repeated pattern at %i×%i', (width, height) => {
  const scene = new WeatherScene(null);
  for (const alpha of [1, 0.4]) {
    const actual = canvas(width, height),
      expected = canvas(width, height);
    actual.globalAlpha = expected.globalAlpha = alpha;
    scene.paintGrain(actual);
    const grain = WeatherScene.sprites.grain;
    if (!grain) throw new Error('No grain sprite.');
    const pattern = expected.createPattern(grain, 'repeat');
    if (!pattern) throw new Error('No grain pattern.');
    expected.save();
    expected.setTransform(1, 0, 0, 1, 0, 0);
    expected.globalCompositeOperation = 'overlay';
    expected.fillStyle = pattern;
    expected.fillRect(0, 0, width, height);
    expected.restore();
    const pixels = actual.getImageData(0, 0, width, height).data,
      reference = expected.getImageData(0, 0, width, height).data;
    let difference = 0;
    for (let i = 0; i < pixels.length; i++)
      difference = Math.max(difference, Math.abs((pixels[i] ?? 0) - (reference[i] ?? 0)));
    // Canvas image and pattern blending can round one 8-bit step differently.
    expect(difference, `maximum channel difference at opacity ${alpha}`).toBeLessThanOrEqual(1);
    expect(actual.getTransform().a).toBe(1.5);
    expect(actual.globalCompositeOperation).toBe('source-over');
  }
});

test('grain is reused, resized and released when hidden or no longer needed', () => {
  const scene = new WeatherScene(null);
  scene.prepare({ condition: 'fog' });
  scene.paintGrain(canvas(700, 400));
  const first = scene.grainStrip;
  scene.paintGrain(canvas(800, 400));
  expect(scene.grainStrip).toBe(first);
  expect(scene.grainStrip?.width).toBeLessThanOrEqual(512);
  scene.paintGrain(canvas(800, 500));
  expect(scene.grainStrip?.height).toBe(500);
  scene.release();
  expect(scene.grainStrip).toBeUndefined();
  scene.paintGrain(canvas(700, 400));
  scene.prepare({ condition: 'sunny' });
  expect(scene.grainStrip).toBeUndefined();
});
