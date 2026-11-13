// How the live ground follows a pinch: two fingers on a screen, or two on a trackpad. What was
// under the fingers stays under them as they spread and move, from the first px; let go while
// still spreading, and the zoom carries on, slowing to a stop. One finger, a double tap and a
// mouse wheel are the ground's own (see MapViews.startGl).
import { SECOND } from '../lib/time.ts';
import type { GlMap } from './gl.ts';
import { MOTION, notched } from './moves.ts';

type Point = { x: number; y: number };
// A zoom the ground came to, and when (an event's time stamp).
type Sample = readonly [time: number, zoom: number];
type PinchMap = Pick<GlMap, 'getZoom' | 'jumpTo' | 'easeTo' | 'unproject' | 'stop' | 'on'>;

// A flick: the zoom's speed over the last 80 ms before the fingers let go (and never less than a
// frame, 16 ms), in steps a second. Faster than 0.8, it carries on as far as 0.15 s more at that
// speed would take it, at most two steps, slowing all the way: its speed falls the same share
// each moment, and it ends once 1% of the way is left, which keeps its speed as the fingers left
// it at the start.
export const FLICK = { window: 80, frame: 16, least: 0.8, carry: 0.15, most: 2, left: 0.01 } as const;
const FLICK_TIME = FLICK.carry * -Math.log(FLICK.left) * SECOND;
export const flickEasing = (progress: number) => (1 - FLICK.left ** progress) / (1 - FLICK.left);
// A trackpad's pinch tells no lift of its own: 50 ms without one of its wheels is one. Two
// fingers down and up within 500 ms, moving under 30 px all told, zoom out a step over 300 ms.
const TRACKPAD_LIFT = 50,
  TWO_TAP = { time: 500, reach: 30, ease: 300 } as const;
const TOUCHES = ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const;
// Only a browser with touches knows TouchEvent, so a touch is told by its fingers.
const isTouch = (event: Event): event is TouchEvent => 'touches' in event;

// How far a pinch that let go at `end` carries on, in steps, and over how long; none if it
// was going slower than a flick, or had stopped.
export function flickOf(samples: readonly Sample[], end: number): { by: number; duration: number } | undefined {
  const recent = samples.filter(([time]) => time >= end - FLICK.window),
    first = recent[0],
    last = recent.at(-1);
  if (!first || !last || recent.length < 2) return undefined;
  const speed = ((last[1] - first[1]) / Math.max(FLICK.frame, end - first[0])) * SECOND;
  if (Math.abs(speed) < FLICK.least) return undefined;
  return { by: Math.sign(speed) * Math.min(FLICK.most, Math.abs(speed) * FLICK.carry), duration: FLICK_TIME };
}

// The middle of some fingers and how far they are from it, on average.
function between(points: readonly Point[]) {
  const count = points.length || 1,
    x = points.reduce((sum, point) => sum + point.x, 0) / count,
    y = points.reduce((sum, point) => sum + point.y, 0) / count;
  return { x, y, spread: points.reduce((sum, point) => sum + Math.hypot(point.x - x, point.y - y), 0) / count };
}

// What a pinch reads: whether it holds the ground, so it isn't drawn again until it lets go.
export interface Pinch {
  readonly held: boolean;
}
// Binds the pinch to the ground's element, which holds the map's own; `rest` draws the map again
// where a pinch left it, unless it flicks, when the map's move ending does.
export function bindPinch(
  container: HTMLElement,
  map: PinchMap,
  zooms: { least: number; most: number },
  rest: () => void,
): Pinch {
  const pinch = { held: false };
  let samples: Sample[] = [];
  // A point on the page in the map's own px, which the card's zoom scales.
  const local = (at: { clientX: number; clientY: number }): Point => {
    const box = container.getBoundingClientRect(),
      ratio = box.width / container.clientWidth || 1;
    return { x: (at.clientX - box.left) / ratio, y: (at.clientY - box.top) / ratio };
  };
  const place = ({ x, y }: Point): [number, number] => {
    const { lng, lat } = map.unproject([x, y]);
    return [lng, lat];
  };
  // Holds the ground for a pinch, stopping whatever moved it; fingers landing at `down` are
  // where its zoom starts from, while a trackpad's first wheel has already moved it.
  const hold = (down?: number) => {
    if (pinch.held) return;
    pinch.held = true;
    map.stop();
    samples = down === undefined ? [] : [[down, map.getZoom()]];
  };
  // Keeps what was under `from` under `to`, `scale` times the size, within the ground's zooms.
  const follow = (from: Point, to: Point, scale: number, time: number) => {
    const zoom = map.getZoom(),
      target = Math.min(zooms.most, Math.max(zooms.least, zoom + Math.log2(scale))),
      kept = 2 ** (target - zoom),
      middle = { x: container.clientWidth / 2, y: container.clientHeight / 2 };
    map.jumpTo({
      center: place({ x: from.x + (middle.x - to.x) / kept, y: from.y + (middle.y - to.y) / kept }),
      zoom: target,
    });
    samples.push([time, target]);
  };
  // Lets go, zooming on by `by` steps about `around` if it is given, eased with `easing`.
  const letGo = (zoom?: { by: number; duration: number; around: Point; easing?: (progress: number) => number }) => {
    pinch.held = false;
    const target = zoom && Math.min(zooms.most, Math.max(zooms.least, map.getZoom() + zoom.by));
    if (zoom === undefined || target === undefined || target === map.getZoom()) rest();
    else
      map.easeTo({
        zoom: target,
        around: place(zoom.around),
        duration: zoom.duration,
        ...(zoom.easing ? { easing: zoom.easing } : {}),
      });
  };

  // Fingers. One alone is the ground's own; once a second lands, the pinch is this until the
  // last lets go, and the ground sees none of it. A finger on the place's pin is one on the
  // ground too, though its touches never pass through the ground: they are read where all the
  // card's pass, and only watched there, so no scroll elsewhere in the card waits on them. A
  // finger left after the others lift moves the map on its own.
  let touch: { from: ReturnType<typeof between>; at: Point; down: number; travel: number; most: number } | undefined;
  const taken = new WeakSet<Event>();
  const onGround = (target: EventTarget | null) =>
    target instanceof Node &&
    (container.contains(target) ||
      (target instanceof Element &&
        target.closest('.map-drop') !== null &&
        (container.parentElement?.contains(target) ?? false)));
  const fingers = (event: TouchEvent) =>
    Array.from(event.touches)
      .filter(({ target }) => onGround(target))
      .map(local);
  const onTouch = (event: Event) => {
    if (!isTouch(event)) return;
    const points = fingers(event);
    if (!touch) {
      if (event.type !== 'touchstart' || points.length < 2) return;
      hold(event.timeStamp);
      const from = between(points);
      touch = { from, at: from, down: event.timeStamp, travel: 0, most: points.length };
    }
    taken.add(event);
    const now = between(points),
      { from } = touch;
    touch.most = Math.max(touch.most, points.length);
    if (event.type === 'touchmove') {
      const scale = points.length > 1 && from.spread > 0 && now.spread > 0 ? now.spread / from.spread : 1;
      follow(from, now, scale, event.timeStamp);
      touch.travel += Math.hypot(now.x - from.x, now.y - from.y) + Math.abs(now.spread - from.spread);
      if (points.length > 1) touch.at = now;
    }
    touch.from = now;
    if (points.length) return;
    const ended = touch;
    touch = undefined;
    if (event.type === 'touchcancel') letGo();
    else if (ended.most === 2 && ended.travel < TWO_TAP.reach && event.timeStamp - ended.down < TWO_TAP.time)
      letGo({ by: -1, duration: TWO_TAP.ease, around: ended.at });
    else {
      const flick = flickOf(samples, event.timeStamp);
      letGo(flick && { ...flick, around: ended.at, easing: flickEasing });
    }
  };
  const page = container.getRootNode();
  for (const type of TOUCHES) page.addEventListener(type, onTouch, { capture: true, passive: true });
  map.on('remove', () => {
    for (const type of TOUCHES) page.removeEventListener(type, onTouch, { capture: true });
  });
  // What the pinch has taken, the ground never sees, and a move of it scrolls nothing.
  const keep = (event: Event) => {
    if (!taken.has(event)) return;
    event.stopPropagation();
    if (event.type === 'touchmove' && event.cancelable) event.preventDefault();
  };
  for (const type of TOUCHES) container.addEventListener(type, keep, { capture: true, passive: false });

  // A trackpad's pinch, as a wheel with the control key: it zooms about the pointer as the
  // fingers spread. Paused without a flick, the map is drawn again once it has rested.
  let lifting = 0;
  map.on('remove', () => window.clearTimeout(lifting));
  container.addEventListener(
    'wheel',
    event => {
      if (!event.ctrlKey || notched(event)) return;
      event.preventDefault();
      event.stopPropagation();
      hold();
      window.clearTimeout(lifting);
      const at = local(event);
      follow(at, at, 2 ** (-event.deltaY * MOTION.pinch), event.timeStamp);
      lifting = window.setTimeout(() => {
        const flick = flickOf(samples, samples.at(-1)?.[0] ?? 0);
        if (flick) letGo({ ...flick, around: at, easing: flickEasing });
        else lifting = window.setTimeout(() => letGo(), MOTION.rest - TRACKPAD_LIFT);
      }, TRACKPAD_LIFT);
    },
    { capture: true, passive: false },
  );
  return pinch;
}
