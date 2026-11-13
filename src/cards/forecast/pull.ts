// Pulling the hourly strip past its start. A trackpad or wheel going back over the first hour, or a
// finger drawing it on, moves the hours along after it, less and less the further they go, and
// brings the precipitation view's labels in beside the bars; let go, it all goes back. Nothing here
// scrolls the strip, which has nowhere further to go.
import { clamp } from '../../lib/values.ts';

// A wheel's line, and how long after its last turn it counts as let go.
const WHEEL = { line: 16, rest: 200 } as const;
// The hours give (1 − 1 / (pull × this / width + 1)) of the strip's width.
const GIVE = 0.55;
// Whether the labels are all in, to a thousandth.
const REVEAL_DIGITS = 3;

// Sets the strip up, and says whether it can be pulled now: at its start, in that view. Only then
// are the listeners on that can hold up a scroll, so that one anywhere else stays with the browser.
export function stripPull(hours: HTMLElement, zoom: () => number): (can: boolean) => void {
  let armed = false,
    pulled = 0,
    rest: number | undefined,
    from: { x: number; y: number } | null = null;
  const show = () => {
    const scale = zoom(),
      width = hours.getBoundingClientRect().width / scale,
      pull = (1 - 1 / ((pulled * GIVE) / width + 1)) * width,
      labels = hours.querySelector(':scope > .strip-labels'),
      all = labels
        ? labels.getBoundingClientRect().width / scale + parseFloat(getComputedStyle(labels).left)
        : Number.POSITIVE_INFINITY;
    hours.toggleAttribute('data-pulled', true);
    hours.toggleAttribute('data-settling', true);
    hours.style.setProperty('--pull', `${pull}px`);
    hours.style.setProperty('--reveal', clamp(pull / all).toFixed(REVEAL_DIGITS));
  };
  const letGo = () => {
    clearTimeout(rest);
    pulled = 0;
    from = null;
    hours.removeAttribute('data-pulled');
    hours.style.removeProperty('--pull');
    hours.style.removeProperty('--reveal');
    // Snapping goes by where the hours are drawn, so it waits until they are back.
    void Promise.allSettled(hours.getAnimations({ subtree: true }).map(({ finished }) => finished)).then(() => {
      if (!pulled) hours.removeAttribute('data-settling');
    });
  };
  const wheel = (event: WheelEvent) => {
    const back = -event.deltaX * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL.line : 1),
      across = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    if (event.ctrlKey || (!pulled && (!across || back <= 0))) return;
    event.preventDefault();
    pulled = Math.max(0, pulled + back / zoom());
    clearTimeout(rest);
    if (!pulled) {
      letGo();
      return;
    }
    rest = window.setTimeout(letGo, WHEEL.rest);
    show();
  };
  const touchStart = ({ touches: [touch, other] }: TouchEvent) => {
    from = armed && touch && !other ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const touchMove = (event: TouchEvent) => {
    const [touch] = event.touches;
    if (!from || !touch) return;
    const across = touch.clientX - from.x;
    // It goes with the page, or along the strip, from its first move.
    if (!pulled && (across <= 0 || Math.abs(touch.clientY - from.y) >= across)) {
      from = null;
      return;
    }
    if (event.cancelable) event.preventDefault();
    pulled = Math.max(0, across / zoom());
    show();
  };
  hours.addEventListener('touchstart', touchStart, { passive: true });
  hours.addEventListener('touchend', letGo, { passive: true });
  hours.addEventListener('touchcancel', letGo, { passive: true });
  return can => {
    if (can === armed) return;
    armed = can;
    if (can) {
      hours.addEventListener('wheel', wheel, { passive: false });
      hours.addEventListener('touchmove', touchMove, { passive: false });
      return;
    }
    hours.removeEventListener('wheel', wheel);
    hours.removeEventListener('touchmove', touchMove);
    letGo();
  };
}
