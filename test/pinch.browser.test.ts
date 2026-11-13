import { afterEach, expect, test, vi } from 'vitest';
import { loadMapLibre, newMap, type GlMap } from '../src/map/gl.ts';
import { FLICK, bindPinch } from '../src/map/pinch.ts';

const SIZE = { width: 400, height: 300 },
  ZOOMS = { least: 2, most: 12 },
  START = 6,
  EMPTY = `data:application/json,${encodeURIComponent(JSON.stringify({ version: 8, sources: {}, layers: [] }))}`;

afterEach(() => document.body.replaceChildren());

// A live ground on its own, with the card's pinch bound to it as the card binds it, and the
// place's pin over it beside it, taking touches of its own, as the card draws them.
async function ground() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' }),
    view = document.createElement('div'),
    container = document.createElement('div'),
    pin = document.createElement('b');
  pin.className = 'map-drop';
  Object.assign(view.style, { position: 'relative', width: `${SIZE.width}px`, height: `${SIZE.height}px` });
  Object.assign(container.style, { width: `${SIZE.width}px`, height: `${SIZE.height}px` });
  Object.assign(pin.style, { position: 'absolute', left: '180px', top: '90px', width: '40px', height: '40px' });
  view.append(container, pin);
  root.append(view);
  const maplibre = await loadMapLibre(root);
  if (!maplibre) throw new Error('No MapLibre');
  const map = newMap(maplibre, {
    container,
    style: EMPTY,
    center: [-90.2, 38.63],
    zoom: START,
    minZoom: ZOOMS.least,
    maxZoom: ZOOMS.most,
    attributionControl: false,
    keyboard: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });
  if (!map) throw new Error('No map');
  map.touchZoomRotate.disableRotation();
  await new Promise<void>(done => map.once('load', done));
  const rest = vi.fn(),
    pinch = bindPinch(container, map, ZOOMS, rest);
  return { map, container, canvas: map.getCanvas(), pin, rest, pinch };
}

const frames = async (count: number) => {
  for (let i = 0; i < count; i++) await new Promise(done => requestAnimationFrame(done));
};
const moved = (map: GlMap) => new Promise<void>(done => map.on('moveend', done));
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

// Fingers on the ground at points in its own px, each with the touch event for it.
function fingers(canvas: HTMLCanvasElement, container: HTMLElement) {
  const box = container.getBoundingClientRect(),
    touch = ([x, y]: readonly [number, number], i: number) =>
      new Touch({ identifier: i + 1, target: canvas, clientX: box.left + x, clientY: box.top + y });
  return (type: string, points: readonly (readonly [number, number])[]) => {
    const list = points.map(touch);
    return canvas.dispatchEvent(
      new TouchEvent(type, {
        touches: list,
        targetTouches: list,
        changedTouches: list.length ? list : [touch([0, 0], 0)],
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );
  };
}
// Two fingers `spread` px apart either side of (x, y).
const pair = (x: number, y: number, spread: number) =>
  [
    [x - spread / 2, y],
    [x + spread / 2, y],
  ] as const;

test('two fingers spreading twice as far apart zoom one step, keeping what lay between them under them', async () => {
  const { map, container, canvas, rest, pinch } = await ground(),
    send = fingers(canvas, container),
    anchor = map.unproject([250, 150]);
  send('touchstart', [[210, 150]]);
  send('touchstart', pair(250, 150, 80));
  for (const spread of [100, 120, 140, 160]) send('touchmove', pair(250, 150, spread));
  // The ground's own pinch would have zoomed further by now.
  await frames(3);
  expect(pinch.held).toBe(true);
  expect(map.getZoom()).toBeCloseTo(START + 1, 6);
  expect(near(map.project([anchor.lng, anchor.lat]), { x: 250, y: 150 })).toBeLessThan(0.5);
  // Moved together, what was between them goes with them.
  send('touchmove', pair(280, 170, 160));
  expect(near(map.project([anchor.lng, anchor.lat]), { x: 280, y: 170 })).toBeLessThan(0.5);
  // Held still before letting go, the map stays where they left it and is drawn again.
  await new Promise(done => setTimeout(done, FLICK.window * 2));
  send('touchend', []);
  await frames(3);
  expect(map.getZoom()).toBeCloseTo(START + 1, 6);
  expect(pinch.held).toBe(false);
  expect(rest).toHaveBeenCalledTimes(1);
});

test('a quick spread carries on zooming after the fingers lift, slowing to a stop', async () => {
  const { map, container, canvas, rest, pinch } = await ground(),
    send = fingers(canvas, container);
  send('touchstart', pair(200, 150, 80));
  for (const spread of [100, 120, 140, 160]) send('touchmove', pair(200, 150, spread));
  const done = moved(map);
  send('touchend', []);
  expect(pinch.held).toBe(false);
  await done;
  // A spread this quick carries on as far as a flick goes; the map's move ending draws it again.
  expect(map.getZoom()).toBeCloseTo(START + 1 + FLICK.most, 6);
  expect(rest).not.toHaveBeenCalled();
});

test('a tap of two fingers zooms out a step', async () => {
  const { map, container, canvas } = await ground(),
    send = fingers(canvas, container);
  send('touchstart', pair(200, 150, 80));
  const done = moved(map);
  send('touchend', []);
  await done;
  expect(map.getZoom()).toBeCloseTo(START - 1, 6);
});

test('one finger is the ground’s own, and the pinch leaves it be', async () => {
  const { map, container, canvas, rest, pinch } = await ground(),
    send = fingers(canvas, container),
    before = map.getCenter();
  send('touchstart', [[200, 150]]);
  for (const x of [190, 170, 150, 130]) send('touchmove', [[x, 150]]);
  await frames(3);
  send('touchend', []);
  await frames(3);
  expect(pinch.held).toBe(false);
  expect(map.getCenter().lng).toBeGreaterThan(before.lng);
  expect(map.getZoom()).toBe(START);
  expect(rest).not.toHaveBeenCalled();
});

// Fingers each on what they landed on, at points in the ground's own px: a browser sends a
// finger's events to that, every finger down in each.
type Finger = { id: number; x: number; y: number; on: Element };
function landed(container: HTMLElement) {
  const box = container.getBoundingClientRect(),
    touch = ({ id, x, y, on }: Finger) =>
      new Touch({ identifier: id, target: on, clientX: box.left + x, clientY: box.top + y });
  return (type: string, to: Element, down: readonly Finger[], changed: readonly Finger[] = down) => {
    const list = down.map(touch);
    return to.dispatchEvent(
      new TouchEvent(type, {
        touches: list,
        targetTouches: list.filter(({ target }) => target === to),
        changedTouches: changed.map(touch),
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );
  };
}

test('a finger on the place’s pin pinches with one on the ground, and the ground’s own handlers never hear of them', async () => {
  const { map, container, canvas, pin, rest, pinch } = await ground(),
    send = landed(container),
    heard = vi.fn(),
    anchor = map.unproject([200, 150]);
  for (const type of ['touchstart', 'touchmove', 'touchend'] as const) canvas.addEventListener(type, heard);
  // The upper finger on the pin, the lower on the ground, `spread` px apart about (200, 150).
  const pair = (spread: number) =>
    [
      { id: 1, x: 200, y: 150 - spread / 2, on: pin },
      { id: 2, x: 200, y: 150 + spread / 2, on: canvas },
    ] as const;
  const [upper, lower] = pair(80);
  send('touchstart', pin, [upper]);
  send('touchstart', canvas, [upper, lower], [lower]);
  for (const spread of [100, 120, 140, 160]) {
    const both = pair(spread);
    send('touchmove', pin, both);
    send('touchmove', canvas, both);
  }
  await frames(3);
  expect(pinch.held).toBe(true);
  expect(map.getZoom()).toBeCloseTo(START + 1, 6);
  expect(near(map.project([anchor.lng, anchor.lat]), { x: 200, y: 150 })).toBeLessThan(0.5);
  await new Promise(done => setTimeout(done, FLICK.window * 2));
  const [upperLeft, lowerLeft] = pair(160);
  send('touchend', pin, [lowerLeft], [upperLeft]);
  send('touchend', canvas, [], [lowerLeft]);
  await frames(3);
  expect(pinch.held).toBe(false);
  expect(map.getZoom()).toBeCloseTo(START + 1, 6);
  expect(rest).toHaveBeenCalledTimes(1);
  expect(heard).not.toHaveBeenCalled();
});

test('a finger alone on the place’s pin is the pin’s, untouched by the pinch', async () => {
  const { map, container, pin, rest, pinch } = await ground(),
    send = landed(container),
    heard = vi.fn(),
    finger = { id: 1, x: 200, y: 110, on: pin };
  pin.addEventListener('touchend', heard);
  expect(send('touchstart', pin, [finger])).toBe(true);
  expect(send('touchend', pin, [], [finger])).toBe(true);
  expect(heard).toHaveBeenCalledTimes(1);
  expect(pinch.held).toBe(false);
  expect(map.getZoom()).toBe(START);
  expect(rest).not.toHaveBeenCalled();
});

test('a trackpad’s pinch zooms as far as its fingers spread, about the pointer, and rests', async () => {
  const { map, container, canvas, rest, pinch } = await ground(),
    box = container.getBoundingClientRect(),
    anchor = map.unproject([300, 100]);
  const wheel = (deltaY: number) =>
    canvas.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY,
        ctrlKey: true,
        clientX: box.left + 300,
        clientY: box.top + 100,
        bubbles: true,
        cancelable: true,
      }),
    );
  // Fingers twice as far apart: a wheel of 100 px for each e-fold. The ground jumps there at
  // once, and is held until the pinch rests 200 ms on, so it is read before any frame.
  expect(wheel(-100 * Math.LN2)).toBe(false);
  expect(map.getZoom()).toBeCloseTo(START + 1, 6);
  expect(near(map.project([anchor.lng, anchor.lat]), { x: 300, y: 100 })).toBeLessThan(0.5);
  expect(pinch.held).toBe(true);
  await vi.waitFor(() => expect(rest).toHaveBeenCalledTimes(1));
  expect(pinch.held).toBe(false);
  expect(map.getZoom()).toBeCloseTo(START + 1, 6);
});
