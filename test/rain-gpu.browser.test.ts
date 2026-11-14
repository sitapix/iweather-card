import { afterEach, expect, test, vi } from 'vitest';
import { GlassRain } from '../src/sky/glass-gl.ts';
import { context2d } from '../src/lib/canvas.ts';
import { WeatherScene } from '../src/sky/scene.ts';
import { sharedGlass } from '../src/sky/glass-gl.ts';
import type { SceneInputs } from '../src/sky/sky.ts';
import { CloudAtlas } from '../src/sky/cloud-decks.ts';
import { CloudPainter, resetCloudPainter } from '../src/sky/clouds-gl.ts';
import { CLOUD_MAPS } from './cloud-maps.ts';

const contexts: WebGLRenderingContext[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const gl of contexts.splice(0)) gl.getExtension('WEBGL_lose_context')?.loseContext();
});
function setup() {
  const output = document.createElement('canvas'),
    renderer = new GlassRain(output),
    gl = output.getContext('webgl'),
    canvas = document.createElement('canvas');
  if (!gl || !renderer.ready) throw new Error('WebGL is required.');
  contexts.push(gl);
  canvas.width = 240;
  canvas.height = 180;
  const sky = renderer.beginSky(canvas, 1);
  if (!sky) throw new Error('The GPU sky must be available.');
  return { renderer, gl, canvas, sky, ctx: context2d(canvas) };
}

test('GPU rain preserves overlap opacity and the ordering of sky layers', () => {
  const { sky, canvas, ctx, gl } = setup();
  ctx.fillStyle = '#204060';
  ctx.fillRect(0, 0, 240, 180);
  sky.layer(ctx);
  const batch = sky.gpu.batches[0];
  if (!batch) throw new Error('No rain batch.');
  batch.opacity = 0.5;
  batch.quad(120, 90, 0, 1, 100, 8, 1, false);
  batch.quad(120, 90, 0, 1, 100, 8, 1, false);
  sky.gpu.draw(sky.color, null);
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 240, 60);
  sky.finish(canvas);
  const pixel = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data);
  expect(pixel(120, 50)).toEqual([255, 0, 0, 255]);
  expect(pixel(120, 90)).toEqual([144, 160, 176, 255]);
  expect(pixel(20, 90)).toEqual([32, 64, 96, 255]);
  expect(gl.getError()).toBe(gl.NO_ERROR);
});

test('near rain samples its selected colored sprite and reuses it between cards', () => {
  const { sky, canvas, ctx, gl } = setup();
  const strip = (a: string, b: string) => {
    const image = document.createElement('canvas');
    image.width = 4;
    image.height = 2;
    const pen = context2d(image);
    pen.fillStyle = a;
    pen.fillRect(0, 0, 2, 2);
    pen.fillStyle = b;
    pen.fillRect(2, 0, 2, 2);
    return image;
  };
  const first = strip('#ff0000', '#0000ff'),
    second = strip('#00ff00', '#ff00ff');
  const sample = (image: HTMLCanvasElement, cell: number) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    sky.begin();
    sky.layer(ctx);
    const batch = sky.gpu.batches[0];
    if (!batch) throw new Error('No rain batch.');
    batch.quad(120, 90, 0, 1, 50, 8, 0.5, cell);
    sky.gpu.draw(sky.color, image, 2);
    sky.finish(canvas);
    return Array.from(ctx.getImageData(120, 90, 1, 1).data);
  };
  expect(sample(first, 0)).toEqual([128, 0, 0, 255]);
  expect(sample(first, 1)).toEqual([0, 0, 128, 255]);
  expect(sample(second, 0)).toEqual([0, 128, 0, 255]);
  const uploads = vi.spyOn(gl, 'texImage2D');
  expect(sample(first, 1)).toEqual([0, 0, 128, 255]);
  expect(uploads.mock.calls.some(args => args.at(-1) === first)).toBe(false);
  expect(gl.getError()).toBe(gl.NO_ERROR);
});

test('glass samples the resident sky without canvas uploads, including a taller overlay', () => {
  const { renderer, sky, canvas, ctx, gl } = setup();
  ctx.fillStyle = '#e03030';
  ctx.fillRect(0, 0, 240, 90);
  ctx.fillStyle = '#3040e0';
  ctx.fillRect(0, 90, 240, 90);
  sky.finish(canvas);
  const uploads = vi.spyOn(gl, 'texImage2D'),
    copies = vi.spyOn(CanvasRenderingContext2D.prototype, 'drawImage'),
    target = document.createElement('canvas');
  target.width = 240;
  target.height = 300;
  renderer.draw(
    [{ x: 0, y: 0, width: 240, height: 300 }],
    2,
    8,
    canvas,
    { width: 240, height: 300 },
    1,
    undefined,
    target,
  );
  expect(uploads).not.toHaveBeenCalled();
  expect(copies.mock.calls.some(([image]) => image === canvas)).toBe(false);
  expect(
    context2d(target)
      .getImageData(0, 0, 240, 300)
      .data.some((value, i) => i % 4 === 3 && value > 0),
  ).toBe(true);
  expect(gl.getError()).toBe(gl.NO_ERROR);
  renderer.releaseSky(canvas);
  expect(renderer.hasSky(canvas)).toBe(false);
});

test('a lost GPU context discards the resident sky and declines new rain frames', async () => {
  const { renderer, gl, canvas } = setup(),
    extension = gl.getExtension('WEBGL_lose_context');
  if (!extension) throw new Error('Context loss must be available in the test browser.');
  extension.loseContext();
  await vi.waitFor(() => expect(renderer.ready).toBe(false));
  expect(renderer.hasSky(canvas)).toBe(false);
  expect(renderer.beginSky(canvas, 1)).toBeNull();
});

test('a GPU sky is released on dry, hidden and still scenes, then rebuilt on resume', () => {
  const scene = new WeatherScene(document.createElement('canvas'));
  scene.prepare({ condition: 'rainy' });
  scene.paint(240, 180, 2, 8000);
  expect(scene.hasGPUSky).toBe(true);
  expect(scene.farRain).toBeUndefined();
  expect(scene.rainTile).toBeUndefined();
  scene.release();
  expect(scene.hasGPUSky).toBe(false);
  scene.paint(240, 180, 2, 9000);
  expect(scene.hasGPUSky).toBe(true);
  scene.paint(240, 180, 2, 0);
  expect(scene.hasGPUSky).toBe(false);
  scene.paint(240, 180, 2, 10000);
  expect(scene.hasGPUSky).toBe(true);
  scene.prepare({ condition: 'sunny' });
  // A condition change lets the outgoing rain fade before its surfaces are released.
  for (let phase = 11000; phase <= 17000; phase += 500) scene.paint(240, 180, 2, phase);
  expect(scene.live?.rain).toBe(0);
  expect(scene.hasGPUSky).toBe(false);
});

test.each(['lighter', 'screen'] as const)('GPU layers retain %s light blending', blend => {
  const { sky, canvas, ctx, gl } = setup(),
    reference = document.createElement('canvas');
  reference.width = canvas.width;
  reference.height = canvas.height;
  const original = context2d(reference);
  for (const target of [ctx, original]) {
    target.fillStyle = '#204060';
    target.fillRect(0, 0, 240, 180);
  }
  sky.layer(ctx);
  ctx.fillStyle = 'rgba(220, 80, 20, .5)';
  ctx.fillRect(0, 0, 240, 180);
  sky.layer(ctx, blend);
  sky.finish(canvas);
  original.globalCompositeOperation = blend;
  original.fillStyle = 'rgba(220, 80, 20, .5)';
  original.fillRect(0, 0, 240, 180);
  const actual = ctx.getImageData(10, 10, 1, 1).data,
    expected = original.getImageData(10, 10, 1, 1).data;
  for (const [i, value] of actual.entries()) expect(Math.abs(value - (expected[i] ?? 0))).toBeLessThanOrEqual(1);
  expect(gl.getError()).toBe(gl.NO_ERROR);
});

test('alternating card sizes reuse the shared mask and preserve their pixels', () => {
  const { renderer, canvas, ctx, gl } = setup(),
    smaller = document.createElement('canvas');
  smaller.width = 120;
  smaller.height = 90;
  const draw = (source: HTMLCanvasElement) => {
    const sky = renderer.beginSky(source, 1);
    if (!sky) throw new Error('No GPU sky.');
    const target = context2d(source);
    target.clearRect(0, 0, source.width, source.height);
    target.fillStyle = '#204060';
    target.fillRect(0, 0, source.width, source.height);
    sky.layer(target);
    const batch = sky.gpu.batches[0];
    if (!batch) throw new Error('No rain batch.');
    batch.opacity = 0.5;
    batch.quad(60, 45, 0, 1, 50, 8, 1, false);
    sky.gpu.draw(sky.color, null);
    sky.finish(source);
    return Array.from(target.getImageData(60, 45, 1, 1).data);
  };
  const first = draw(canvas);
  draw(smaller);
  const allocated = vi.spyOn(gl, 'createTexture');
  for (let i = 0; i < 3; i++) {
    expect(draw(canvas)).toEqual(first);
    expect(draw(smaller)).toEqual(first);
  }
  expect(allocated).not.toHaveBeenCalled();
  expect(ctx.getImageData(10, 10, 1, 1).data).toEqual(new Uint8ClampedArray([32, 64, 96, 255]));
  expect(gl.getError()).toBe(gl.NO_ERROR);
});

test('additional cards fall back without evicting live GPU skies or reallocating each frame', () => {
  const { renderer, canvas, gl } = setup(),
    canvases = [canvas];
  for (let i = 0; i < 4; i++) {
    const next = document.createElement('canvas');
    next.width = canvas.width;
    next.height = canvas.height;
    canvases.push(next);
    expect(Boolean(renderer.beginSky(next, 1))).toBe(i < 3);
  }
  const allocated = vi.spyOn(gl, 'createTexture');
  for (let frame = 0; frame < 3; frame++)
    for (const [i, source] of canvases.entries()) expect(Boolean(renderer.beginSky(source, 1))).toBe(i < 4);
  expect(allocated).not.toHaveBeenCalled();
  renderer.releaseSky(canvas);
  const extra = canvases[4];
  if (!extra) throw new Error('No additional card.');
  expect(renderer.beginSky(extra, 1)).not.toBeNull();
  for (const source of canvases) renderer.releaseSky(source);
  expect(gl.getError()).toBe(gl.NO_ERROR);
});

const WEATHER: SceneInputs[] = [
  { condition: 'rainy' },
  { condition: 'pouring', windSpeed: 12 },
  { condition: 'rainy', temperature: -2 },
  { condition: 'exceptional', windSpeed: 35 },
  { condition: 'snowy-rainy' },
];
test.each(WEATHER)('GPU rain retains trajectories, density and streak detail: %o', inputs => {
  const renderer = sharedGlass();
  if (!renderer) throw new Error('No shared renderer.');
  for (const ratio of [1, 1.5, 2]) {
    const original = new WeatherScene(document.createElement('canvas')),
      actual = new WeatherScene(document.createElement('canvas'));
    original.prepare(inputs);
    actual.prepare(inputs);
    for (const time of [8000, 12016, 700]) {
      const fallback = vi.spyOn(renderer, 'beginSky').mockReturnValue(null);
      original.paint(240, 180, ratio, time);
      fallback.mockRestore();
      actual.paint(240, 180, ratio, time);
      expect(actual.hasGPUSky).toBe(true);
      if (!actual.canvas || !original.canvas) throw new Error('No canvas.');
      const a = context2d(actual.canvas).getImageData(0, 0, actual.canvas.width, actual.canvas.height).data,
        b = context2d(original.canvas).getImageData(0, 0, original.canvas.width, original.canvas.height).data;
      let difference = 0;
      for (const [i, value] of a.entries()) difference += Math.abs(value - (b[i] ?? 0));
      expect(difference / a.length, `DPR ${ratio}, phase ${time}`).toBeLessThan(0.8);
    }
    original.release();
    actual.release();
    expect(actual.hasGPUSky).toBe(false);
  }
});

test('GPU rain preserves the lit clouds and their ordering by day, at night and in storms', async () => {
  const renderer = sharedGlass();
  if (!renderer) throw new Error('No shared renderer.');
  CloudPainter.software = true;
  WeatherScene.atlas = new CloudAtlas(CLOUD_MAPS, { now: false });
  const original = new WeatherScene(document.createElement('canvas')),
    actual = new WeatherScene(document.createElement('canvas'));
  try {
    await vi.waitFor(() => expect(original.painter()).not.toBeNull(), { timeout: 10000 });
    for (const inputs of [
      { condition: 'rainy', elevation: 38 },
      { condition: 'rainy', night: true, elevation: -30, moonAltitude: 45 },
      { condition: 'lightning-rainy', elevation: 38, precipitation: 9 },
    ]) {
      original.prepare(inputs);
      actual.prepare(inputs);
      original.advance(0);
      actual.advance(0);
      for (const phase of [8000, 17000]) {
        const fallback = vi.spyOn(renderer, 'beginSky').mockReturnValue(null);
        original.paint(390, 400, 2, phase);
        fallback.mockRestore();
        actual.paint(390, 400, 2, phase);
        expect(actual.hasGPUSky).toBe(true);
        if (!original.canvas || !actual.canvas) throw new Error('No sky canvas.');
        const expected = context2d(original.canvas).getImageData(0, 0, 780, 800).data,
          result = context2d(actual.canvas).getImageData(0, 0, 780, 800).data;
        let difference = 0;
        for (const [i, value] of result.entries()) difference += Math.abs(value - (expected[i] ?? 0));
        expect(difference / result.length, `${inputs.condition}, phase ${phase}`).toBeLessThan(0.8);
      }
    }
  } finally {
    original.release();
    actual.release();
    resetCloudPainter();
    CloudPainter.software = false;
    WeatherScene.atlas = undefined;
  }
});
