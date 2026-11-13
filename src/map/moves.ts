// How the large map moves: under a drag or a trackpad, by a pinch, the wheel, its buttons or the
// keyboard. All of it is one motion of its layer (see Motion), drawn again where it came to once
// it rests (see MapViews).
import { haptic } from '../lib/haptics.ts';
import { bindGlassMenu } from '../lib/glass-menu.ts';
import { isLayer } from './markup.ts';
import type { MapViews } from './views.ts';
import { GL_ZOOM_OFFSET } from './gl.ts';
import { MAP_ZOOMS, STILL, movedMap, zoomMotion, type Motion } from './wind.ts';

// A drag starts after 4 px, and a tap moves less than 5. The map moves with every frame of a gesture and is drawn again once
// it rests: as the fingers lift, 200 ms after a trackpad or wheel stops, or as an eased move
// (250 ms) ends; the map as it was stays under the new one until the new tiles come, at most
// 2 s. A trackpad's pinch reports 100 px for each e-fold its fingers spread, and zooms as far as
// they do (`pinch` steps a px); a mouse wheel's notch zooms half a step.
const MAP_SLOP = 4,
  MAP_TAP = 5,
  PINCH_PER_E = 100;
export const MOTION = { rest: 200, ease: 250, hold: 2000, pinch: 1 / (PINCH_PER_E * Math.LN2), notch: 0.5 } as const;
// A mouse wheel's notch, not a trackpad's glide: whole lines or pages, the 4.000244… px of Chrome
// on a Mac, or 100 or 120 px elsewhere.
const NOTCH = { mac: 4.000244140625, sizes: [100, 120] } as const;
export const notched = ({ deltaMode, deltaX, deltaY }: WheelEvent) =>
  deltaMode !== WheelEvent.DOM_DELTA_PIXEL ||
  (deltaX === 0 &&
    deltaY !== 0 &&
    (deltaY % NOTCH.mac === 0 || NOTCH.sizes.some(size => Number.isInteger(deltaY / size))));
// The large map's keys: the arrows move it an eighth of its size, and + and − zoom it.
const MAP_KEYS: Readonly<Record<string, readonly [across: number, down: number]>> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  },
  ZOOM_KEYS: Readonly<Record<string, number>> = { '+': 1, '=': 1, '-': -1, _: -1 },
  MAP_KEY_STEP = 8;

// Shows a motion of the large map: its layer moved and scaled, held from being drawn again
// meanwhile, and the pins kept their size, following home to where the motion takes it.
export function showMotion(view: HTMLElement, motion: Motion, eased: boolean) {
  const pan = view.querySelector<HTMLElement>('.map-pan:not(.map-old)');
  if (!pan) return;
  view.setAttribute('data-dragging', '');
  pan.toggleAttribute('data-eased', eased);
  const middleX = view.clientWidth / 2,
    middleY = view.clientHeight / 2;
  Object.assign(pan.style, {
    transformOrigin: `${middleX}px ${middleY}px`,
    translate: `${motion.dx}px ${motion.dy}px`,
    scale: String(motion.scale),
  });
  const pins = view.querySelector<HTMLElement>('.map-pins');
  if (pins) {
    const x = Number(pins.dataset['x']),
      y = Number(pins.dataset['y']);
    pins.toggleAttribute('data-eased', eased);
    pins.style.translate = `${motion.dx + (motion.scale - 1) * (x - middleX)}px ${motion.dy + (motion.scale - 1) * (y - middleY)}px`;
  }
}
// Lets go of a motion of the large map: its layer back as drawn and its pins where they were, with
// nothing left on either. Even a transform that moves nothing sets the layer apart, and the light
// the wind's streaks add would stop at its edge (see the styles).
export function restMotion(view: HTMLElement) {
  view.removeAttribute('data-dragging');
  for (const layer of view.querySelectorAll<HTMLElement>(':scope > :is(.map-pan:not(.map-old), .map-pins)')) {
    layer.removeAttribute('data-eased');
    for (const property of ['translate', 'scale', 'transform-origin']) layer.style.removeProperty(property);
  }
}

// What moves the map reads and asks of its views.
type Moving = Pick<
  MapViews,
  | 'inputsOf'
  | 'card'
  | 'gl'
  | 'centre'
  | 'glHome'
  | 'centreOf'
  | 'move'
  | 'opensAt'
  | 'setPin'
  | 'showLayer'
  | 'largeView'
>;
// The pointer in the map's own px, which the card's zoom scales.
function localTo(view: HTMLElement, event: { clientX: number; clientY: number }) {
  const box = view.getBoundingClientRect(),
    ratio = box.width / view.clientWidth || 1;
  return { x: (event.clientX - box.left) / ratio, y: (event.clientY - box.top) / ratio };
}
// The tools are drawn again with the map; the one pressed keeps the focus. The layers button
// opens the menu of them (see glass-menu.ts), and a layer chosen from it is drawn instead: from the
// foot coming out of its button as a drop, beside a tile simply shown. The pin gives a card with a
// tap or a key, and a tap on the map itself makes it small.
function bindMapTools(view: HTMLElement, map: Moving, step: (steps: number) => void, goHome: () => void) {
  // The map drawn now, this one or the one drawn again in its place for the layer chosen.
  const shown = () => (view.isConnected ? view : (map.largeView() ?? view));
  bindGlassMenu(view, {
    parts: () => {
      const now = shown(),
        button = now.querySelector<HTMLElement>('[data-layers]'),
        menu = now.querySelector<HTMLElement>('.map-layers:not([data-leaving])');
      return button && menu ? { button, menu } : undefined;
    },
    still: () => map.card.motion?.matches === true || !view.closest('[data-full]'),
    opened: () => {
      haptic(map.card, 'light');
    },
    chosen: layer => {
      if (!isLayer(layer)) return;
      haptic(map.card, 'selection');
      map.showLayer(layer);
    },
    ticked: () => {
      haptic(map.card, 'selection', 'moon');
    },
  });
  view.addEventListener('keydown', event => {
    if (
      (event.key === 'Enter' || event.key === ' ') &&
      event.target instanceof Element &&
      event.target.matches('.map-drop')
    ) {
      event.preventDefault();
      map.setPin(view, 'card');
    }
  });
  // A tap, not the end of a drag, as far as where it went down.
  let pressed = { x: 0, y: 0 };
  view.addEventListener('pointerdown', event => (pressed = localTo(view, event)), true);
  view.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    // The menu and its button answer for themselves.
    if (target?.closest('[data-layers],.map-layers')) return;
    const about = target?.closest('.map-data button');
    if (about) {
      haptic(map.card, 'light');
      about.setAttribute('aria-expanded', String(about.getAttribute('aria-expanded') !== 'true'));
      return;
    }
    if (target?.closest('.map-drop')) {
      haptic(map.card, 'light');
      map.setPin(view, 'card');
      return;
    }
    const { x, y } = localTo(view, event);
    if (
      Math.hypot(x - pressed.x, y - pressed.y) < MAP_TAP &&
      !target?.closest('a,button,.map-key,.map-layers,.map-card,.wind-time')
    )
      map.setPin(view, 'small');
    const button = target?.closest('.map-tools button');
    if (!(button instanceof HTMLElement)) return;
    haptic(map.card, 'light');
    const { zoom } = button.dataset;
    const live = map.gl?.map;
    if (zoom) step(Number(zoom));
    else if (live) {
      const home = map.inputsOf(view);
      map.glHome = map.centre !== undefined;
      if (map.glHome && home)
        live.easeTo({
          center: [home.longitude, home.latitude],
          zoom: map.opensAt() - GL_ZOOM_OFFSET,
        });
    } else goHome();
    view.querySelector<HTMLElement>(zoom ? `[data-zoom="${zoom}"]` : '[data-home]')?.focus();
  });
}
// The large map moves under a drag or a trackpad, zooms with a pinch (fingers or trackpad),
// the wheel (about the pointer) or its buttons, and is moved and zoomed from the keyboard too;
// the arrow button takes it back home. All of it is one motion of its layer (see Motion),
// smooth at any zoom, drawn again where it came to once it rests (see MapViews.draw).
export function bindMapMoves(view: HTMLElement, map: Moving) {
  if ('moves' in view.dataset) return;
  view.dataset['moves'] = '';
  const local = (event: { clientX: number; clientY: number }) => localTo(view, event);
  let motion: Motion | undefined,
    resting = 0;
  // Shows the motion on the map's layer, eased for a button, key or wheel notch, at once for
  // fingers and trackpads, and holds the map from being drawn again meanwhile.
  const show = (eased: boolean) => {
    if (motion) showMotion(view, motion, eased);
  };
  const settle = () => {
    window.clearTimeout(resting);
    const done = motion;
    motion = undefined;
    view.removeAttribute('data-dragging');
    if (done)
      map.move(
        movedMap(map.centreOf(view), view.clientWidth, view.clientHeight, done, MAP_ZOOMS.least, MAP_ZOOMS.most),
      );
  };
  const restIn = (ms: number) => {
    window.clearTimeout(resting);
    resting = window.setTimeout(settle, ms);
  };
  const shift = (dx: number, dy: number) => {
    const now = motion ?? STILL;
    motion = { ...now, dx: now.dx + dx, dy: now.dy + dy };
  };
  // Zooms `steps` about (x, y) px, held within the map's zooms.
  const zoomBy = (steps: number, x: number, y: number) => {
    const now = motion ?? STILL,
      zoom = map.centreOf(view).zoom + Math.log2(now.scale),
      target = Math.min(MAP_ZOOMS.most, Math.max(MAP_ZOOMS.least, zoom + steps));
    if (target !== zoom) motion = zoomMotion(now, 2 ** (target - zoom), x, y, view.clientWidth, view.clientHeight);
  };
  const step = (steps: number) => {
    const live = map.gl?.map;
    if (live) live.easeTo({ zoom: live.getZoom() + steps, duration: MOTION.ease });
    else {
      zoomBy(steps, view.clientWidth / 2, view.clientHeight / 2);
      show(true);
      restIn(MOTION.ease);
    }
  };
  // Over the live ground, its own gestures move the map instead (see MapViews.startGl).
  // The mouse or fingers on the map, where each is now. One drags it; two pinch it, zooming
  // it about the point between them, which moves with them. Each that lands starts afresh
  // from the motion so far (`start`), and where the fingers were (`from`). Let go, the map is
  // drawn where they left it; a finger left on it after a pinch moves nothing.
  const held = new Map<number, { x: number; y: number }>();
  let gesture: { start: Motion; from: { x: number; y: number; spread: number }; over: boolean } | undefined;
  const between = () => {
    const [a, b = a] = held.values();
    return a && b
      ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, spread: Math.hypot(a.x - b.x, a.y - b.y) }
      : { x: 0, y: 0, spread: 0 };
  };
  view.addEventListener('pointerdown', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (
      map.gl ||
      gesture?.over ||
      held.size > 1 ||
      event.button !== 0 ||
      target?.closest('button,a,.wind-time,.map-key,.map-layers,.map-card,.map-drop')
    )
      return;
    window.clearTimeout(resting);
    held.set(event.pointerId, local(event));
    view.setPointerCapture(event.pointerId);
    gesture = { start: motion ?? STILL, from: between(), over: false };
  });
  view.addEventListener('pointermove', event => {
    if (!gesture || gesture.over || !held.has(event.pointerId)) return;
    held.set(event.pointerId, local(event));
    const now = between(),
      { start, from } = gesture,
      moved = { ...start, dx: start.dx + now.x - from.x, dy: start.dy + now.y - from.y };
    if (
      !view.hasAttribute('data-dragging') &&
      Math.hypot(now.x - from.x, now.y - from.y) < MAP_SLOP &&
      Math.abs(now.spread - from.spread) < MAP_SLOP
    )
      return;
    motion = moved;
    if (held.size > 1 && from.spread) {
      const zoom = map.centreOf(view).zoom + Math.log2(start.scale),
        steps = Math.log2(now.spread / from.spread),
        kept = Math.min(MAP_ZOOMS.most, Math.max(MAP_ZOOMS.least, zoom + steps)) - zoom;
      motion = zoomMotion(moved, 2 ** kept, now.x, now.y, view.clientWidth, view.clientHeight);
    }
    show(false);
  });
  const release = (event: PointerEvent) => {
    if (!held.delete(event.pointerId) || !gesture) return;
    const { over } = gesture;
    gesture = held.size ? { ...gesture, over: true } : undefined;
    if (!over) settle();
  };
  view.addEventListener('pointerup', release);
  view.addEventListener('pointercancel', release);
  // A trackpad's two fingers move the map and its pinch zooms it about the pointer, as they
  // go; a mouse wheel's notch zooms it half a step, eased. Over the live ground, a wheel on the
  // pin, its card or the controls above the ground is handed to the ground as if it had come
  // there, so a pinch over them zooms the map and not the page.
  view.addEventListener(
    'wheel',
    event => {
      const live = map.gl;
      if (live) {
        if (event.target instanceof Node && live.container.contains(event.target)) return;
        event.stopPropagation();
        if (!live.map.getCanvas().dispatchEvent(new WheelEvent('wheel', event))) event.preventDefault();
        return;
      }
      event.preventDefault();
      const { x, y } = local(event);
      if (event.ctrlKey) zoomBy(-event.deltaY * MOTION.pinch, x, y);
      else if (notched(event)) zoomBy(-Math.sign(event.deltaY) * MOTION.notch, x, y);
      else shift(-event.deltaX, -event.deltaY);
      const eased = !event.ctrlKey && notched(event);
      show(eased);
      restIn(eased ? MOTION.ease : MOTION.rest);
    },
    { passive: false },
  );
  // Safari reports a trackpad's pinch as gestures, each with its scale so far.
  let pinched = 1;
  view.addEventListener('gesturestart', event => {
    if (map.gl) return;
    event.preventDefault();
    pinched = 1;
  });
  view.addEventListener('gesturechange', event => {
    if (map.gl) return;
    event.preventDefault();
    const scale = 'scale' in event && typeof event.scale === 'number' ? event.scale : pinched,
      at =
        'clientX' in event &&
        typeof event.clientX === 'number' &&
        'clientY' in event &&
        typeof event.clientY === 'number'
          ? local({ clientX: event.clientX, clientY: event.clientY })
          : { x: view.clientWidth / 2, y: view.clientHeight / 2 };
    zoomBy(Math.log2(scale / pinched), at.x, at.y);
    pinched = scale;
    show(false);
    restIn(MOTION.rest);
  });
  // From the keyboard, while the map itself has the focus: the arrows move it an eighth of
  // its size, + and − zoom it, eased.
  view.addEventListener('keydown', event => {
    if (event.target !== view) return;
    const [across, down] = MAP_KEYS[event.key] ?? [0, 0],
      zoom = ZOOM_KEYS[event.key];
    if (!across && !down && zoom === undefined) return;
    event.preventDefault();
    const live = map.gl?.map;
    if (zoom !== undefined) step(zoom);
    else if (live) live.panBy([(across * view.clientWidth) / MAP_KEY_STEP, (down * view.clientHeight) / MAP_KEY_STEP]);
    else {
      shift((-across * view.clientWidth) / MAP_KEY_STEP, (-down * view.clientHeight) / MAP_KEY_STEP);
      show(true);
      restIn(MOTION.ease);
    }
  });
  bindMapTools(view, map, step, () => {
    window.clearTimeout(resting);
    motion = undefined;
    view.removeAttribute('data-dragging');
    map.move(undefined);
  });
}
