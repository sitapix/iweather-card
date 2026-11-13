import { onHidden } from '../lib/dom.ts';
import type { ActionSetting, CardAction } from './config.ts';

// The ways of pressing something that Home Assistant's actions name.
export type Press = 'tap' | 'hold' | 'double_tap';
type Actions = Partial<Record<ActionSetting, CardAction>>;
// How long a press lasts to be a hold, how long a tap waits for a second, and how far a finger can
// stray before it is a scroll.
const HOLD = 500;
const SECOND_TAP = 250;
const STRAY = 10;
const enabled = (action: CardAction | undefined) => action !== undefined && action.action !== 'none';

// Calls `press` for what is done to `node`. A hold or a double tap is only waited for where one is
// set, so a tap otherwise answers at once.
export function bindPresses(node: HTMLElement, actions: () => Actions, press: (kind: Press) => void) {
  let holding: ReturnType<typeof setTimeout> | undefined,
    tapped: ReturnType<typeof setTimeout> | undefined,
    start: { x: number; y: number } | undefined,
    held = false,
    ignoreHidden = () => {};
  const letGo = () => {
    clearTimeout(holding);
    holding = undefined;
    start = undefined;
    ignoreHidden();
  };
  node.addEventListener('pointerdown', event => {
    held = false;
    if (!enabled(actions().hold_action) || !event.isPrimary || event.button !== 0) return;
    letGo();
    start = { x: event.clientX, y: event.clientY };
    ignoreHidden = onHidden(letGo);
    holding = setTimeout(() => {
      letGo();
      held = true;
      press('hold');
    }, HOLD);
  });
  node.addEventListener('pointermove', event => {
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > STRAY) letGo();
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) node.addEventListener(type, letGo);
  // A held finger brings up the browser's own menu, where a hold is set to do something else.
  node.addEventListener('contextmenu', event => {
    if (enabled(actions().hold_action)) event.preventDefault();
  });
  node.addEventListener('click', () => {
    if (held) {
      held = false;
      return;
    }
    if (!enabled(actions().double_tap_action)) {
      press('tap');
      return;
    }
    if (tapped === undefined) {
      tapped = setTimeout(() => {
        tapped = undefined;
        press('tap');
      }, SECOND_TAP);
      return;
    }
    clearTimeout(tapped);
    tapped = undefined;
    press('double_tap');
  });
}
