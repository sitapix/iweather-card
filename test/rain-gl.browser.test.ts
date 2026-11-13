import { afterEach, expect, test, vi } from 'vitest';
import { loadMapLibre, newMap, showRadar, pickRadar, type GlMap } from '../src/map/gl.ts';
import { RainLayer, type RadarLoad } from '../src/map/rain-gl.ts';
import { PRECIPITATION, RADAR, RADAR_NONE, radarLevels, scaleColour, type Stop } from '../src/map/field.ts';
import type { ScalarField } from '../src/map/sources.ts';

// The rain layer on a live map with nothing else on it: a black ground, no tiles of its own, and
// readings made up here, so what it draws can be read back pixel by pixel.
// A map under a busy machine can take a while to draw what it was given: as long as `vi.waitFor` is
// given (see browser-setup), rather than a poll's own second.
const PATIENCE = { timeout: 10_000 };
const SIZE = 256,
  TILE = 512,
  STYLE = `data:application/json,${encodeURIComponent(
    JSON.stringify({
      version: 8,
      sources: {},
      layers: [{ id: 'ground', type: 'background', paint: { 'background-color': '#000000' } }],
    }),
  )}`;
let shown: { map: GlMap; host: HTMLElement } | undefined;
afterEach(() => {
  vi.restoreAllMocks();
  shown?.map.remove();
  shown?.host.remove();
  shown = undefined;
});
async function liveMap(zoom: number): Promise<GlMap> {
  const host = document.createElement('div');
  host.style.cssText = `width:${SIZE}px;height:${SIZE}px`;
  const root = host.attachShadow({ mode: 'open' }),
    container = document.createElement('div');
  container.style.cssText = `width:${SIZE}px;height:${SIZE}px`;
  root.append(container);
  document.body.append(host);
  const maplibre = await loadMapLibre(root);
  if (!maplibre) throw new Error('No MapLibre.');
  const map = newMap(maplibre, {
    container,
    style: STYLE,
    center: [0, 0],
    zoom,
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    trackResize: false,
    pixelRatio: 1,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  if (!map) throw new Error('No map.');
  shown = { map, host };
  await new Promise(done => map.once('load', () => done(undefined)));
  return map;
}
// Waits for the map to have drawn what it was given, drawing it again first: a map already at rest
// says so no more. And reads a pixel of it (0-255, from the top left).
async function settled(map: GlMap) {
  const idle = new Promise(done => map.once('idle', () => done(undefined)));
  map.triggerRepaint();
  await idle;
  await new Promise(requestAnimationFrame);
}
function pixel(map: GlMap, x: number, y: number): number[] {
  const canvas = map.getCanvas(),
    copy = new OffscreenCanvas(canvas.width, canvas.height),
    context = copy.getContext('2d');
  if (!context) throw new Error('No 2D canvas.');
  context.drawImage(canvas, 0, 0);
  return [...context.getImageData(x, y, 1, 1).data];
}
// A reading's colour as the layer lays it over black: straight from the scale, at 90%.
const over = (stops: readonly Stop[], value: number) => {
  const [red, green, blue, alpha] = scaleColour(stops, value),
    share = (alpha / 255) * 0.9;
  return [red * share, green * share, blue * share];
};
const near = (seen: number[], wanted: number[], within = 4) =>
  wanted.every((value, i) => Math.abs((seen[i] ?? 0) - value) <= within);

const field = (value: (latitude: number, longitude: number) => number): ScalarField => {
  const rows = 21,
    cols = 21,
    step = 2;
  return {
    north: 20,
    west: -20,
    step,
    rows,
    cols,
    values: Float32Array.from({ length: rows * cols }, (_, i) =>
      value(20 - Math.floor(i / cols) * step, -20 + (i % cols) * step),
    ),
  };
};

test('the forecast’s rain blends between quarters in its readings, and only then takes its colours', async () => {
  const map = await liveMap(3),
    layer = new RainLayer('rain', map, () => Promise.resolve(null));
  map.addLayer(layer);
  // Dry, then 2 mm an hour everywhere: halfway, 1 mm an hour's colour, not half of 2 mm's.
  layer.showGrid([field(() => 0), field(() => 2)], PRECIPITATION);
  layer.showAt(0.5);
  await settled(map);
  const middle = pixel(map, SIZE / 2, SIZE / 2),
    faded = over(PRECIPITATION, 2).map(value => value / 2);
  expect(near(middle, over(PRECIPITATION, 1))).toBe(true);
  expect(near(middle, faded, 12)).toBe(false);
  layer.showAt(1);
  await settled(map);
  expect(near(pixel(map, SIZE / 2, SIZE / 2), over(PRECIPITATION, 2))).toBe(true);
  layer.showAt(0);
  await settled(map);
  expect(near(pixel(map, SIZE / 2, SIZE / 2), [0, 0, 0])).toBe(true);
});

test('the forecast’s grid lies where its points are, north up and east right', async () => {
  const map = await liveMap(2),
    layer = new RainLayer('rain', map, () => Promise.resolve(null));
  map.addLayer(layer);
  // Heavy rain north-east of the middle alone.
  layer.showGrid([field((latitude, longitude) => (latitude > 2 && longitude > 2 ? 9 : 0))], PRECIPITATION);
  layer.showAt(0);
  await settled(map);
  const at = (latitude: number, longitude: number) => {
    const point = map.project([longitude, latitude]);
    return pixel(map, Math.round(point.x), Math.round(point.y));
  };
  expect(near(at(12, 12), over(PRECIPITATION, 9))).toBe(true);
  for (const [latitude, longitude] of [
    [-12, 12],
    [12, -12],
    [-12, -12],
  ] as const)
    expect(near(at(latitude, longitude), [0, 0, 0])).toBe(true);
});

test('the radar’s frames blend in reflectivity, tile by tile, and each tile lies where it belongs', async () => {
  const map = await liveMap(1),
    asked: string[] = [];
  // East of the prime meridian, 40 dBZ in the first frame and 20 in the second; west, none in either.
  const load: RadarLoad = url => {
    asked.push(url);
    const [, x = 0] = /\/(\d+)\/(\d+)\/(\d+)\.png$/u.exec(url)?.slice(1).map(Number) ?? [],
      dbz = url.includes('first') ? 40 : 20;
    return Promise.resolve(new Uint8Array(TILE * TILE).fill(x >= 1 ? dbz - RADAR_NONE : 0));
  };
  const layer = new RainLayer('rain', map, load);
  map.addLayer(layer);
  layer.showRadar(['https://radar.test/first/{z}/{x}/{y}.png', 'https://radar.test/second/{z}/{x}/{y}.png'], RADAR);
  layer.showAt(0.5);
  const east = map.project([30, 10]),
    west = map.project([-30, 10]);
  // Once its tiles have come.
  await expect
    .poll(async () => {
      await settled(map);
      return near(pixel(map, Math.round(east.x), Math.round(east.y)), over(RADAR, 30));
    }, PATIENCE)
    .toBe(true);
  expect(asked).toHaveLength(8);
  expect(near(pixel(map, Math.round(west.x), Math.round(west.y)), [0, 0, 0])).toBe(true);
  // Tiles come at the map's own zoom, no deeper than the radar's, wrapped round the world.
  expect(asked.every(url => /\/1\/[01]\/[01]\.png$/u.test(url))).toBe(true);
});

test('the radar’s colours read back as their reflectivity', () => {
  // Its colour for 30 dBZ, and one for nothing at all.
  const pixels = Uint8ClampedArray.from([0x00, 0x55, 0x88, 0xff, 0, 0, 0, 0]);
  expect([...radarLevels(pixels)]).toEqual([30 - RADAR_NONE, 0]);
});

test('future frames change shape and intensity from their own readings, with no synthetic translation', async () => {
  const map = await liveMap(1);
  const load: RadarLoad = url => {
    const [z = 0, x = 0, y = 0] = /\/(\d+)\/(\d+)\/(\d+)\.png$/u.exec(url)?.slice(1).map(Number) ?? [],
      across = 2 ** z,
      readings = new Uint8Array(TILE * TILE);
    for (let j = 0; j < TILE; j++) {
      const latitude = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + (j + 0.5) / TILE)) / across))) * 180) / Math.PI;
      if (Math.abs(latitude) > 4) continue;
      for (let i = 0; i < TILE; i++) {
        const longitude = ((x + (i + 0.5) / TILE) / across) * 360 - 180;
        const dbz = url.includes('forecast')
          ? longitude >= 14 && longitude < 30
            ? 20
            : longitude > -30 && longitude < -14
              ? 40
              : 0
          : longitude >= 14 && longitude < 22
            ? 40
            : 0;
        if (dbz) readings[j * TILE + i] = dbz - RADAR_NONE;
      }
    }
    return Promise.resolve(readings);
  };
  const layer = new RainLayer('rain', map, load);
  map.addLayer(layer);
  layer.showRadar(
    ['https://radar.test/observed/{z}/{x}/{y}.png', 'https://radar.test/forecast/{z}/{x}/{y}.png'],
    RADAR,
    1,
  );
  const at = (longitude: number) => {
    const point = map.project([longitude, 0]);
    return pixel(map, Math.round(point.x), Math.round(point.y));
  };
  layer.showAt(0);
  await expect
    .poll(async () => {
      await settled(map);
      return layer.loaded();
    }, PATIENCE)
    .toBe(true);
  expect(near(at(18), over(RADAR, 40))).toBe(true);
  expect(near(at(-20), [0, 0, 0])).toBe(true);
  layer.showAt(1);
  await settled(map);
  // Existing rain weakens and broadens, and a separate cell forms west of it.
  expect(near(at(18), over(RADAR, 20))).toBe(true);
  expect(near(at(26), over(RADAR, 20))).toBe(true);
  expect(near(at(-20), over(RADAR, 40))).toBe(true);
  // Asking past the data never translates the last image.
  layer.showAt(6);
  await settled(map);
  expect(near(at(18), over(RADAR, 20))).toBe(true);
  expect(near(at(-20), over(RADAR, 40))).toBe(true);
});

test('an unloaded forecast cannot substitute a historical radar frame', async () => {
  const map = await liveMap(1),
    layer = new RainLayer('rain', map, url =>
      url.includes('forecast')
        ? new Promise(() => undefined)
        : Promise.resolve(new Uint8Array(TILE * TILE).fill(40 - RADAR_NONE)),
    );
  map.addLayer(layer);
  layer.showRadar(
    ['https://radar.test/observed/{z}/{x}/{y}.png', 'https://radar.test/forecast/{z}/{x}/{y}.png'],
    RADAR,
    1,
  );
  layer.showAt(0);
  await expect
    .poll(async () => {
      await settled(map);
      return near(pixel(map, SIZE / 2, SIZE / 2), over(RADAR, 40));
    }, PATIENCE)
    .toBe(true);
  layer.showAt(1);
  await settled(map);
  expect(layer.readyAt(1)).toBe(false);
  expect(near(pixel(map, SIZE / 2, SIZE / 2), [0, 0, 0])).toBe(true);
});

test('forecast cells have rounded edges across tile joins, while radar and storm interiors retain their readings', async () => {
  const map = await liveMap(9),
    gl = map.getCanvas().getContext('webgl2');
  if (!gl) throw new Error('No WebGL.');
  const average = vi.spyOn(gl, 'generateMipmap'),
    stops: Stop[] = [
      { value: RADAR_NONE, colour: '#000000FF' },
      { value: 40, colour: '#FFFFFFFF' },
    ],
    layer = new RainLayer('rain', map, url => {
      const [, x = 0, y = 0] = /\/(\d+)\/(\d+)\/(\d+)\.png$/u.exec(url)?.slice(1).map(Number) ?? [];
      // A corner at the meeting of four tiles, heavy rain south-east of it.
      return Promise.resolve(new Uint8Array(TILE * TILE).fill(x >= 64 && y >= 64 ? 40 - RADAR_NONE : 0));
    });
  map.addLayer(layer);
  layer.showRadar(['https://radar.test/corner/{z}/{x}/{y}.png'], stops);
  await expect
    .poll(async () => {
      await settled(map);
      return layer.loaded();
    }, PATIENCE)
    .toBe(true);
  const value = (x: number, y: number) => pixel(map, SIZE / 2 + x, SIZE / 2 + y)[0] ?? 0,
    observed = value(4, 4);
  expect(average).not.toHaveBeenCalled();
  layer.showRadar(['https://radar.test/corner/{z}/{x}/{y}.png'], stops, 0);
  await settled(map);
  // The corner softens across tiles, without a gap at their join or a change far from the edge.
  expect(value(4, 4)).toBeLessThan(observed - 15);
  expect(value(0, 0)).toBeGreaterThan(40);
  expect(value(0, 0)).toBeLessThan(100);
  expect(value(32, 32)).toBeGreaterThan(225);
  expect(value(-32, -32)).toBe(0);
  const averages = average.mock.calls.length;
  expect(averages).toBeGreaterThan(0);
  await settled(map);
  expect(average).toHaveBeenCalledTimes(averages);
  layer.showRadar(['https://radar.test/corner/{z}/{x}/{y}.png'], stops);
  await settled(map);
  expect(value(4, 4)).toBe(observed);
});

test('held still, the radar asks for the frames near the one shown; playing, for every frame, and only then has it all', async () => {
  const map = await liveMap(1),
    asked = new Set<string>();
  const load: RadarLoad = url => {
    asked.add(url);
    return Promise.resolve(new Uint8Array(TILE * TILE));
  };
  const layer = new RainLayer('rain', map, load),
    frames = Array.from({ length: 6 }, (_, i) => `https://radar.test/f${i}/{z}/{x}/{y}.png`),
    framesAsked = () => new Set([...asked].map(url => /\/(f\d)\//u.exec(url)?.[1]));
  map.addLayer(layer);
  layer.showRadar(frames, RADAR);
  layer.showAt(0);
  // The frame shown and the three after it, each over the view's four tiles.
  await expect
    .poll(async () => {
      await settled(map);
      return asked.size;
    }, PATIENCE)
    .toBe(16);
  await settled(map);
  expect(framesAsked()).toEqual(new Set(['f0', 'f1', 'f2', 'f3']));
  expect(layer.loaded()).toBe(false);
  layer.play(true);
  await expect
    .poll(async () => {
      await settled(map);
      return layer.loaded();
    }, PATIENCE)
    .toBe(true);
  expect(asked.size).toBe(24);
});

test('forecast coverage hatches missing cells and places outside its grid, never valid dry cells', async () => {
  const map = await liveMap(2),
    layer = new RainLayer('rain', map, () => Promise.resolve(null));
  map.setPaintProperty('ground', 'background-color', '#ffffff');
  map.addLayer(layer);
  layer.showGrid([field(() => 0), field((_, longitude) => (longitude > 0 ? Number.NaN : 0))], PRECIPITATION);
  const shade = (latitude: number, longitude: number) => {
    const point = map.project([longitude, latitude]);
    // Read across a full stripe, so its phase doesn't affect the result.
    return Array.from({ length: 8 }, (_, x) => pixel(map, Math.round(point.x) + x, Math.round(point.y))[0] ?? 0);
  };
  layer.showAt(0);
  await settled(map);
  expect(shade(0, 10).every(value => value === 255)).toBe(true);
  expect(Math.min(...shade(30, 0))).toBeLessThan(220);
  layer.showAt(0.5);
  await settled(map);
  expect(Math.min(...shade(0, 10))).toBeLessThan(220);
  expect(shade(0, -10).every(value => value === 255)).toBe(true);
  layer.showAt(1);
  await settled(map);
  expect(Math.min(...shade(0, 10))).toBeLessThan(220);
  // Seeking back to an exact, valid frame must ignore the following frame's missing data.
  layer.showAt(0);
  await settled(map);
  expect(shade(0, 10).every(value => value === 255)).toBe(true);
});

test('live radar hatches the provider mask and removes that mask when the timeline enters forecast', async () => {
  const mask = new OffscreenCanvas(512, 512),
    pen = mask.getContext('2d');
  if (!pen) throw new Error('No canvas.');
  pen.fillRect(0, 0, 512, 512);
  const unavailable = await mask.convertToBlob();
  pen.clearRect(0, 0, 512, 512);
  const dry = await mask.convertToBlob(),
    fetchOriginal = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('/v2/coverage/')) return Promise.resolve(new Response(unavailable));
    if (url.includes('radar.test')) return Promise.resolve(new Response(dry));
    return fetchOriginal(input, init);
  });
  const map = await liveMap(1);
  map.setPaintProperty('ground', 'background-color', '#ffffff');
  showRadar(map, ['https://radar.test/a/{z}/{x}/{y}.png', 'https://radar.test/b/{z}/{x}/{y}.png'], 0, false, 1);
  const shade = () => Array.from({ length: 16 }, (_, x) => pixel(map, 120 + x, 128)[0] ?? 0);
  await expect
    .poll(async () => {
      await settled(map);
      return Math.min(...shade());
    }, PATIENCE)
    .toBeLessThan(230);
  pickRadar(map, 1);
  await settled(map);
  expect(shade().every(value => value === 255)).toBe(true);
  pickRadar(map, 0);
  await settled(map);
  expect(Math.min(...shade())).toBeLessThan(230);
});
