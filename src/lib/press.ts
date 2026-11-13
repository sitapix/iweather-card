import { onHidden } from './dom.ts';
import { SECOND } from './time.ts';

// Pressing a tile: it shrinks to 95% about its middle while held, along the ease curve
// (0.25, 0.1, 0.25, 1) over 0.2 s, and springs back when let go: mass 1, stiffness 280, damping 34,
// just past critical, so it settles in about 0.4 s without going past full size. The spring is
// added to whatever is left of the press, so a quick click still dips a little before it comes
// back. A finger rests 0.15 s before what it touches gives, so one that sets off to scroll moves
// nothing at all, and one lifted sooner gives as it lifts, dipping as a quick click does. A finger
// that moves 10 px from where it pressed lets go, as a scroll or a cancelled press does. A mouse
// presses at once, and its button keeps it pressed for as long as it is held, wherever the pointer
// goes, and what was pressed opens only with the pointer over it: let go elsewhere, it opens
// nothing. Held, a tile opens without being let go: a small one after 1.1 s, the map after 0.35 s
// (as long as each takes to open when held), or as soon as the pointer comes back over it after
// that; a list's rows open only when let go.
const PRESSED = 0.95;
const PRESS: KeyframeAnimationOptions = { duration: 200, easing: 'cubic-bezier(.25,.1,.25,1)', fill: 'forwards' };
const SPRING = { mass: 1, stiffness: 280, damping: 34 } as const;
const MOVE_LIMIT = 10;
const TOUCH_REST = 150;
// A browser too old to ease along a curve of points takes a plain ease-out, as `animate` throws on
// what it can't read.
export const pointEasing = (curve: string): string =>
  typeof CSS === 'undefined' || CSS.supports('animation-timing-function', curve) ? curve : 'ease-out';
// A spring's way from 0 to 1, worked out a millisecond at a time and sampled every 20 ms over the
// `settle` ms it takes to come within a hundred-thousandth of the end; as a CSS linear() easing.
const SETTLE = 600,
  SAMPLE_EVERY = 20,
  SAMPLE_DIGITS = 4;
export function springEasing(
  { mass = 1, stiffness, damping }: { mass?: number; stiffness: number; damping: number } = SPRING,
  settle = SETTLE,
): string {
  const samples: number[] = [];
  let position = 0,
    velocity = 0;
  for (let ms = 0; ms <= settle; ms++) {
    if (ms % SAMPLE_EVERY === 0) samples.push(position);
    const force = stiffness * (1 - position) - damping * velocity;
    velocity += force / mass / SECOND;
    position += velocity / SECOND;
  }
  samples[samples.length - 1] = 1;
  return pointEasing(`linear(${samples.map(value => value.toFixed(SAMPLE_DIGITS)).join(',')})`);
}
const RELEASE: KeyframeAnimationOptions = {
  duration: SETTLE,
  easing: springEasing(),
  fill: 'forwards',
  composite: 'add',
};
// The scale an element is drawn at now, from its transform matrix.
const scaleOf = (element: Element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a;

// Presses the elements matching `selector` inside `root`, or the ancestor `scaled` names (a list's
// tile, for one of its rows); `ignore` names parts that aren't pressed with them (switches inside a
// panel). Without motion, nothing moves; `touchOnly`, a mouse moves nothing either, though its
// press is followed all the same. Held long enough (`hold`, in ms, by what is pressed), a press
// opens what it would open when let go: it springs back, `open` runs with what was pressed, and
// the click that letting go then makes is swallowed.
export interface PressOptions {
  ignore?: string;
  scaled?: string;
  touchOnly?: boolean;
  hold?: (pressed: Element) => number | null;
  open?: (pressed: HTMLElement) => void;
}
export function pressMotion(root: HTMLElement, selector: string, options: PressOptions = {}): void {
  const { ignore = '', scaled = '', touchOnly = false, hold, open } = options;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const running = new WeakMap<Element, Animation[]>();
  const stop = (element: Element) => {
    for (const animation of running.get(element) ?? []) animation.cancel();
    running.delete(element);
  };
  let swallow = false;
  root.addEventListener(
    'click',
    event => {
      if (!swallow) return;
      swallow = false;
      event.stopPropagation();
      event.preventDefault();
    },
    { capture: true },
  );
  root.addEventListener('pointerdown', event => {
    swallow = false;
    const target = event.target instanceof Element ? event.target : null,
      pressed = target?.closest(selector),
      element = scaled ? pressed?.closest(scaled) : pressed;
    if (
      !(pressed instanceof HTMLElement) ||
      !element ||
      !event.isPrimary ||
      event.button !== 0 ||
      (ignore && target?.closest(ignore))
    )
      return;
    const { clientX, clientY, pointerId } = event,
      mouse = event.pointerType === 'mouse',
      after = hold?.(pressed) ?? null;
    // Held long enough, it opens, at once with the pointer over it, or else as the pointer comes back.
    let over = true,
      due = false;
    const openHeld = () => {
      release();
      swallow = true;
      open?.(pressed);
    };
    const timer =
      open && after !== null
        ? setTimeout(() => {
            if (over) openHeld();
            else due = true;
          }, after)
        : undefined;
    // From wherever it is, should it still be springing back from the last press; without motion,
    // it stays put. A mouse presses at once, unless only a finger is to, and a finger once it has
    // rested.
    let press: Animation | null = null;
    const begin = () => {
      if (!motion.matches && !(mouse && touchOnly)) press = pressDown(element);
    };
    const resting = mouse ? undefined : setTimeout(begin, TOUCH_REST);
    if (mouse) begin();
    // Lifted before it had rested, a finger presses now, so the tap still dips; taken for a scroll
    // or moved off, it never presses at all.
    const release = (lifted = false) => {
      clearTimeout(timer);
      clearTimeout(resting);
      ignoreHidden();
      removeEventListener('pointermove', moved);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', cancel);
      if (lifted && !press) begin();
      if (!press || running.get(element)?.[0] !== press) return;
      const back = element.animate([{ transform: 'scale(1)' }, { transform: `scale(${1 / PRESSED})` }], RELEASE);
      running.set(element, [press, back]);
      back.addEventListener('finish', () => {
        if (running.get(element)?.[1] === back) stop(element);
      });
    };
    // Let go off what it pressed, a mouse opens nothing, whatever the browser gives the click to.
    const up = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      if (mouse && !within(next)) swallow = true;
      release(true);
    };
    // The browser taking the pointer, for a scroll or anything else, lets go with no tap.
    const cancel = (next: PointerEvent) => {
      if (next.pointerId === pointerId) release();
    };
    // A finger moved too far lets go, and opens nothing.
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId || Math.hypot(next.clientX - clientX, next.clientY - clientY) <= MOVE_LIMIT)
        return;
      release();
      swallow = true;
    };
    // A mouse holds it wherever it goes, so all that's followed is whether the pointer is over what
    // it pressed. That is read from where the pointer is, as a browser may not say when it leaves
    // a box while a button is held.
    const within = (at: PointerEvent) => {
      const box = pressed.getBoundingClientRect();
      return at.clientX >= box.left && at.clientX <= box.right && at.clientY >= box.top && at.clientY <= box.bottom;
    };
    const follow = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      over = within(next);
      if (over && due) openHeld();
    };
    const moved = mouse ? follow : move;
    const ignoreHidden = onHidden(release);
    addEventListener('pointermove', moved);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', cancel);
  });
  function pressDown(element: Element): Animation {
    const from = scaleOf(element);
    stop(element);
    const press = element.animate([{ transform: `scale(${from})` }, { transform: `scale(${PRESSED})` }], PRESS);
    running.set(element, [press]);
    return press;
  }
}
