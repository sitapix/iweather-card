import { afterEach, expect, test, vi } from 'vitest';
import { context2d } from '../src/lib/canvas.ts';
import { GlassRain } from '../src/sky/glass-gl.ts';
import { paintDroplets } from '../src/sky/droplets.ts';

const SIZE = { width: 240, height: 180 },
  PHASE = 8,
  FAST_STEP = 1 / 64,
  SLOW_STEP = 1 / 4,
  UPLOAD_INTERVAL = 1 / 8,
  UPLOAD_DRAWS = 3,
  TEXTURES = 2,
  CACHE_LIMIT = 4,
  CACHE_CYCLES = 3,
  RED = '#e03030',
  BLUE = '#3040e0';
const contexts: WebGLRenderingContext[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const gl of contexts.splice(0)) if (!gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext();
  document.body.replaceChildren();
});

function fill(canvas: HTMLCanvasElement, color: string) {
  const ctx = context2d(canvas);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function sky(color = RED) {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE.width;
  canvas.height = SIZE.height;
  fill(canvas, color);
  document.body.append(canvas);
  return canvas;
}

function painter() {
  const canvas = document.createElement('canvas'),
    rain = new GlassRain(canvas),
    gl = canvas.getContext('webgl'),
    target = document.createElement('canvas');
  if (!gl || !rain.ready) throw new Error('The glass renderer requires WebGL.');
  contexts.push(gl);
  const draw = (
    source: HTMLCanvasElement | null | undefined,
    seconds = PHASE,
    size = SIZE,
    scale = 1,
    refraction = true,
  ) => {
    const width = Math.round(size.width * scale),
      height = Math.round(size.height * scale);
    if (target.width !== width || target.height !== height) {
      target.width = width;
      target.height = height;
    }
    rain.draw([{ x: 0, y: 0, ...size }], 2, seconds, source, size, scale, undefined, target, undefined, refraction);
  };
  const pixels = () => context2d(target).getImageData(0, 0, target.width, target.height).data;
  return { rain, gl, draw, pixels };
}

test('plain droplets animate without allocating textures, uploading or copying the sky', () => {
  const { gl, draw, pixels } = painter(),
    source = sky(),
    textures = vi.spyOn(gl, 'createTexture'),
    uploads = vi.spyOn(gl, 'texImage2D'),
    copies = vi.spyOn(CanvasRenderingContext2D.prototype, 'drawImage');
  draw(source, PHASE, SIZE, 1, false);
  const first = pixels();
  expect(first.some((channel, i) => i % 4 === 3 && channel > 0)).toBe(true);
  fill(source, BLUE);
  draw(source, PHASE, SIZE, 1, false);
  expect(pixels()).toEqual(first);
  draw(source, PHASE + 1, SIZE, 1, false);
  expect(pixels()).not.toEqual(first);
  expect(textures).not.toHaveBeenCalled();
  expect(uploads).not.toHaveBeenCalled();
  expect(copies.mock.calls.some(([image]) => image === source)).toBe(false);
  expect(gl.getError()).toBe(gl.NO_ERROR);
});

test('turning refraction off releases only that card’s textures and turning it on restores its look', () => {
  const { gl, draw, pixels } = painter(),
    red = sky(RED),
    blue = sky(BLUE),
    uploads = vi.spyOn(gl, 'texImage2D'),
    removed = vi.spyOn(gl, 'deleteTexture');
  draw(red);
  const first = pixels();
  draw(blue);
  const other = pixels();
  draw(red, PHASE, SIZE, 1, false);
  expect(pixels()).not.toEqual(first);
  expect(removed).toHaveBeenCalledTimes(TEXTURES);
  draw(blue);
  expect(pixels()).toEqual(other);
  expect(uploads).toHaveBeenCalledTimes(TEXTURES * 2);
  draw(red, PHASE + 1, SIZE, 1, false);
  expect(removed).toHaveBeenCalledTimes(TEXTURES);
  draw(red);
  expect(pixels()).toEqual(first);
  expect(uploads).toHaveBeenCalledTimes(TEXTURES * 3);
  expect(gl.getError()).toBe(gl.NO_ERROR);
});

test('the canvas fallback keeps visible moving droplets without a sky source', () => {
  const target = sky(),
    ctx = context2d(target),
    copies = vi.spyOn(ctx, 'drawImage'),
    paint = (time: number) => {
      ctx.clearRect(0, 0, SIZE.width, SIZE.height);
      paintDroplets(ctx, [{ x: 0, y: 0, ...SIZE }], 2, time, null);
      return ctx.getImageData(0, 0, SIZE.width, SIZE.height).data;
    },
    first = paint(PHASE * 1000);
  expect(first.some((channel, i) => i % 4 === 3 && channel > 0)).toBe(true);
  expect(paint((PHASE + 1) * 1000)).not.toEqual(first);
  expect(copies).not.toHaveBeenCalled();
});

test('alternating skies reuse their textures and draw the same pixels when returning to a card', () => {
  const { gl, draw, pixels } = painter(),
    red = sky(RED),
    blue = sky(BLUE),
    uploads = vi.spyOn(gl, 'texImage2D');
  draw(red);
  const first = pixels();
  expect(first.some(channel => channel > 0)).toBe(true);
  draw(blue);
  expect(pixels()).not.toEqual(first);
  draw(red);
  expect(pixels()).toEqual(first);
  expect(uploads).toHaveBeenCalledTimes(TEXTURES * 2);
  expect(gl.getError()).toBe(gl.NO_ERROR);
});

test('fast glass draws wait for the upload interval even after three frames', () => {
  const { gl, draw } = painter(),
    source = sky(),
    uploads = vi.spyOn(gl, 'texImage2D');
  draw(source);
  for (let frame = 1; frame <= UPLOAD_DRAWS; frame++) draw(source, PHASE + frame * FAST_STEP);
  expect(uploads).toHaveBeenCalledTimes(TEXTURES);
  draw(source, PHASE + UPLOAD_INTERVAL);
  expect(uploads).toHaveBeenCalledTimes(TEXTURES * 2);
});

test('slow alternating cards each wait for three of their own draws before uploading again', () => {
  const { gl, draw } = painter(),
    red = sky(RED),
    blue = sky(BLUE),
    uploads = vi.spyOn(gl, 'texImage2D');
  draw(red);
  draw(blue);
  for (let frame = 1; frame < UPLOAD_DRAWS; frame++) {
    draw(red, PHASE + frame * SLOW_STEP);
    draw(blue, PHASE + frame * SLOW_STEP);
  }
  expect(uploads).toHaveBeenCalledTimes(TEXTURES * 2);
  draw(red, PHASE + UPLOAD_DRAWS * SLOW_STEP);
  expect(uploads).toHaveBeenCalledTimes(TEXTURES * UPLOAD_DRAWS);
  draw(blue, PHASE + UPLOAD_DRAWS * SLOW_STEP);
  expect(uploads).toHaveBeenCalledTimes(TEXTURES * CACHE_LIMIT);
});

test('a still repaint refreshes changed pixels in the same sky canvas immediately', () => {
  const { gl, draw, pixels } = painter(),
    source = sky(RED),
    uploads = vi.spyOn(gl, 'texImage2D');
  draw(source, 0);
  const first = pixels();
  fill(source, BLUE);
  draw(source, 0);
  expect(pixels()).not.toEqual(first);
  expect(uploads).toHaveBeenCalledTimes(TEXTURES * 2);
});

test('rewinding the animation clock refreshes the sky without waiting for more frames', () => {
  const { gl, draw } = painter(),
    source = sky(),
    uploads = vi.spyOn(gl, 'texImage2D');
  draw(source);
  draw(source, PHASE - FAST_STEP);
  expect(uploads).toHaveBeenCalledTimes(TEXTURES * 2);
});

test.each(['width', 'height'] as const)('changing the overlay %s refreshes its sky immediately', dimension => {
  const { gl, draw } = painter(),
    source = sky(),
    uploads = vi.spyOn(gl, 'texImage2D');
  draw(source);
  draw(source, PHASE, { ...SIZE, [dimension]: SIZE[dimension] + 1 });
  expect(uploads).toHaveBeenCalledTimes(TEXTURES * 2);
  expect(gl.getError()).toBe(gl.NO_ERROR);
});

test('changing the device scale refreshes the sky immediately', () => {
  const { gl, draw } = painter(),
    source = sky(),
    uploads = vi.spyOn(gl, 'texImage2D');
  draw(source);
  draw(source, PHASE, SIZE, 2);
  expect(uploads).toHaveBeenCalledTimes(TEXTURES * 2);
  expect(gl.getError()).toBe(gl.NO_ERROR);
});

test.each(['width', 'height'] as const)('changing the source sky %s refreshes its texture immediately', dimension => {
  const { gl, draw } = painter(),
    source = sky(),
    uploads = vi.spyOn(gl, 'texImage2D');
  draw(source);
  source[dimension] += 1;
  fill(source, BLUE);
  draw(source);
  expect(uploads).toHaveBeenCalledTimes(TEXTURES * 2);
  expect(gl.getError()).toBe(gl.NO_ERROR);
});

test('releasing a sky deletes its textures once and lets the same canvas return', () => {
  const { rain, gl, draw, pixels } = painter(),
    source = sky(),
    removed = vi.spyOn(gl, 'deleteTexture'),
    uploads = vi.spyOn(gl, 'texImage2D');
  draw(source);
  const first = pixels();
  rain.release(source);
  expect(removed).toHaveBeenCalledTimes(TEXTURES);
  rain.release(source);
  expect(removed).toHaveBeenCalledTimes(TEXTURES);
  draw(source);
  expect(uploads).toHaveBeenCalledTimes(TEXTURES * 2);
  expect(pixels()).toEqual(first);
  expect(gl.getError()).toBe(gl.NO_ERROR);
});

test('extra skies reuse the least recent texture pair without allocating during repeated card switches', () => {
  const { gl, draw, pixels } = painter(),
    first = sky(RED),
    oldest = sky(BLUE),
    remaining = Array.from({ length: CACHE_LIMIT - 2 }, () => sky()),
    extra = sky(BLUE),
    created = vi.spyOn(gl, 'createTexture'),
    removed = vi.spyOn(gl, 'deleteTexture'),
    uploads = vi.spyOn(gl, 'texImage2D');
  draw(first);
  const redPixels = pixels();
  draw(oldest);
  const bluePixels = pixels();
  for (const source of remaining) draw(source);
  expect(created).toHaveBeenCalledTimes(TEXTURES * CACHE_LIMIT);
  expect(removed).not.toHaveBeenCalled();
  draw(first);
  draw(extra);
  expect(pixels()).toEqual(bluePixels);
  expect(uploads).toHaveBeenCalledTimes(TEXTURES * (CACHE_LIMIT + 1));
  draw(first);
  expect(pixels()).toEqual(redPixels);
  expect(uploads).toHaveBeenCalledTimes(TEXTURES * (CACHE_LIMIT + 1));
  draw(oldest);
  expect(pixels()).toEqual(bluePixels);
  expect(uploads).toHaveBeenCalledTimes(TEXTURES * (CACHE_LIMIT + 2));
  const cards = [
    { source: first, expected: redPixels },
    { source: oldest, expected: bluePixels },
    ...remaining.map(source => ({ source, expected: redPixels })),
    { source: extra, expected: bluePixels },
  ];
  for (let cycle = 0; cycle < CACHE_CYCLES; cycle++)
    for (const { source, expected } of cards) {
      draw(source);
      expect(pixels()).toEqual(expected);
    }
  expect(created).toHaveBeenCalledTimes(TEXTURES * CACHE_LIMIT);
  expect(removed).not.toHaveBeenCalled();
  expect(gl.getError()).toBe(gl.NO_ERROR);
});

test('a lost context stops drawing and a fresh renderer can use the same sky', async () => {
  const { rain, gl, draw, pixels } = painter(),
    source = sky(),
    lost = gl.getExtension('WEBGL_lose_context');
  if (!lost) throw new Error('The test browser cannot simulate losing WebGL.');
  draw(source);
  const first = pixels();
  lost.loseContext();
  await vi.waitFor(() => {
    expect(rain.ready).toBe(false);
  });
  const uploads = vi.spyOn(gl, 'texImage2D');
  expect(() => {
    rain.release(source);
    draw(source);
  }).not.toThrow();
  expect(uploads).not.toHaveBeenCalled();
  const fresh = painter();
  fresh.draw(source);
  expect(fresh.pixels()).toEqual(first);
  expect(fresh.gl.getError()).toBe(fresh.gl.NO_ERROR);
});

test.each([1, 1.5, 2])('cropped glass preserves the full overlay pixels at scale %s', scale => {
  const canvas = document.createElement('canvas'),
    rain = new GlassRain(canvas),
    gl = canvas.getContext('webgl'),
    full = document.createElement('canvas'),
    cropped = document.createElement('canvas'),
    source = sky(),
    size = { width: SIZE.width + 0.25, height: SIZE.height + 0.25 },
    panels = [{ x: 11.25, y: 13.5, width: 210, height: 150, radius: 15 }];
  if (!gl || !rain.ready) throw new Error('The glass renderer requires WebGL.');
  contexts.push(gl);
  const ctx = context2d(source),
    gradient = ctx.createLinearGradient(0, 0, SIZE.width, SIZE.height);
  gradient.addColorStop(0, RED);
  gradient.addColorStop(1, BLUE);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, SIZE.width, SIZE.height);
  full.width = Math.round(size.width * scale);
  full.height = Math.round(size.height * scale);
  rain.draw(panels, 2, PHASE, source, size, scale, undefined, full);
  for (const offset of [
    { x: 0, y: 0 },
    { x: 17, y: 23 },
    { x: 51, y: 49 },
  ]) {
    cropped.width = full.width - offset.x - 5;
    cropped.height = full.height - offset.y - 7;
    rain.draw(panels, 2, PHASE, source, size, scale, undefined, cropped, offset);
    const expected = context2d(full).getImageData(offset.x, offset.y, cropped.width, cropped.height).data,
      actual = context2d(cropped).getImageData(0, 0, cropped.width, cropped.height).data;
    expect(actual.some(channel => channel > 0)).toBe(true);
    expect(actual).toEqual(expected);
  }
  expect(gl.getError()).toBe(gl.NO_ERROR);
});
