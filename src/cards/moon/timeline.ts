// The moon sheet's timeline: dragging the strip under the marker moves the moon, its phase,
// the moment and the rows through the hours, without rebuilding the sheet around it.
import { child } from '../../lib/dom.ts';
import { type Haptic, haptic } from '../../lib/haptics.ts';
import { HOUR, SECOND } from '../../lib/time.ts';
import { MOON_HOUR_PX, MOON_TICK, moonLive, moonStep } from './sheet.ts';
import { dateKey } from '../../weather/forecast-items.ts';
import type { Update } from '../../card/update.ts';

// The moon timeline let go: moving faster than `speed` (px a second) it runs on for `coast`
// seconds of that speed, as a flick does, measured over the last `window` ms of the drag;
// either way it settles on the hour it was heading for on a critically damped spring of
// `response` seconds, ending within `rest` px.
const MOON_FLICK = { speed: 100, coast: 0.25, window: 100, response: 0.55, rest: 0.5 } as const;

// What the timeline reads from the card, and the sheet it is in.
interface MoonHost extends EventTarget {
  readonly update: Update | undefined;
  drawMoons(): void;
}
interface MoonSheet {
  sheet: HTMLElement;
  moonOffset: number;
}

// A strip at rest within this many px of a tick is on it, as a scroller can stop a shade short.
const ON_TICK = 0.5;
// One of the strip's ticks: its day, by the day's midnight, and its place in the day.
export interface Tick {
  readonly day: number;
  readonly mark: number;
}
// Which of the strip's ticks lies under the marker, or last passed it, at `left`, with each day
// counted from its midnight in `midnights`. Days aren't all as long.
export function tickAt(left: number, midnights: readonly number[]): Tick {
  const day = midnights.findLastIndex(midnight => midnight <= left + ON_TICK),
    from = midnights[day] ?? 0;
  return { day, mark: Math.floor((left - from + ON_TICK) / (MOON_TICK.hours * MOON_HOUR_PX)) };
}
// The feedback for the strip moving from tick `from` to `to`: a firm one when it crosses a
// midnight's bold line, which a change of day means, a light one for any other mark, and none
// while it stays on the same tick.
export function tickFeel(from: Tick, to: Tick): Haptic | undefined {
  if (to.day !== from.day) return 'medium';
  return to.mark === from.mark ? undefined : 'light';
}
// As the strip scrolls, the moon and the rows follow it, an hour at a time, and each tick that
// passes under the marker gives a tick of feedback, as a picker's wheel does, firmer at midnight.
function followStrip(
  detail: MoonSheet,
  card: MoonHost,
  scroller: HTMLElement,
  origin: number,
  midnights: readonly number[],
) {
  let frame = 0,
    passed = tickAt(scroller.scrollLeft, midnights);
  scroller.addEventListener(
    'scroll',
    () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        // The sheet may be drawn again, or be another sheet, by the time the frame comes.
        if (!scroller.isConnected) return;
        const tick = tickAt(scroller.scrollLeft, midnights),
          feel = tickFeel(passed, tick);
        passed = tick;
        if (feel) haptic(card, feel, 'moon');
        const ctx = card.update?.ctx,
          hours = Math.round((scroller.scrollLeft - origin) / MOON_HOUR_PX),
          offset = hours * HOUR;
        if (!ctx || offset === detail.moonOffset) return;
        detail.moonOffset = offset;
        const [hero, list] = moonLive(ctx, offset);
        // The moon's canvas stays, its picture showing until the next one is drawn over it:
        // a new canvas would be blank for a frame, and the moon would flicker as it turns.
        const box = child(detail.sheet, '.moon-hero'),
          disc = box.querySelector('canvas'),
          next = document.createElement('div');
        next.innerHTML = hero;
        const fresh = next.querySelector('canvas');
        if (disc && fresh) {
          disc.dataset['phase'] = fresh.dataset['phase'] ?? '';
          disc.dataset['turn'] = fresh.dataset['turn'] ?? '';
          fresh.replaceWith(disc);
        }
        box.replaceChildren(...next.childNodes);
        child(detail.sheet, '.moon-rows').innerHTML = list;
        const key = dateKey(ctx.now + offset, ctx.timeZone);
        for (const day of detail.sheet.querySelectorAll<HTMLElement>('.moon-grid [data-key]'))
          day.setAttribute('aria-pressed', String(day.dataset['key'] === key));
        card.drawMoons();
      });
    },
    { passive: true },
  );
}
export function bindMoonTimeline(detail: MoonSheet, card: MoonHost) {
  const scroller = detail.sheet.querySelector('.moon-scroll');
  if (!(scroller instanceof HTMLElement)) return;
  const origin = Number(scroller.dataset['origin']),
    midnights = (scroller.dataset['midnights'] ?? '').split(',').map(Number);
  scroller.scrollLeft = origin + (detail.moonOffset / HOUR) * MOON_HOUR_PX;
  followStrip(detail, card, scroller, origin, midnights);
  // Glides the strip to `target` on a critically damped spring, from rest.
  let glide = 0,
    heading: number | undefined;
  const settle = (target: number) => {
    cancelAnimationFrame(glide);
    heading = target;
    const from = scroller.scrollLeft,
      omega = (2 * Math.PI) / MOON_FLICK.response,
      start = performance.now();
    const step = (time: number) => {
      const t = (time - start) / SECOND,
        left = target + (from - target) * (1 + omega * t) * Math.exp(-omega * t);
      const done = Math.abs(left - target) < MOON_FLICK.rest;
      scroller.scrollLeft = done ? target : left;
      glide = done ? 0 : requestAnimationFrame(step);
      if (done) heading = undefined;
    };
    glide = requestAnimationFrame(step);
  };
  const stop = () => {
    cancelAnimationFrame(glide);
    heading = undefined;
  };
  scroller.addEventListener('wheel', stop, { passive: true });
  scroller.addEventListener('keydown', stop);
  // Where it settles: the hour it was heading for, never past either end.
  const land = (left: number, forward: boolean) => {
    const hour = (forward ? Math.ceil : Math.floor)(left / MOON_HOUR_PX) * MOON_HOUR_PX;
    return Math.min(Math.max(hour, 0), scroller.scrollWidth - scroller.clientWidth);
  };
  // A mouse drags the strip as a finger does and can flick it; touch and pens keep the
  // native scroll and its own momentum.
  let grab: { id: number; x: number; left: number; moves: { time: number; x: number }[] } | undefined;
  scroller.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    event.preventDefault();
    stop();
    scroller.focus({ preventScroll: true });
    grab = { id: event.pointerId, x: event.clientX, left: scroller.scrollLeft, moves: [] };
    scroller.setPointerCapture(event.pointerId);
  });
  scroller.addEventListener('pointermove', event => {
    if (grab?.id !== event.pointerId) return;
    scroller.scrollLeft = grab.left - (event.clientX - grab.x);
    grab.moves.push({ time: event.timeStamp, x: event.clientX });
    while ((grab.moves[0]?.time ?? Infinity) < event.timeStamp - MOON_FLICK.window) grab.moves.shift();
  });
  const release = (event: PointerEvent) => {
    if (grab?.id !== event.pointerId) return;
    const { x, left, moves } = grab,
      first = moves[0],
      last = moves.at(-1);
    grab = undefined;
    // A click that never moved leaves the strip where it is.
    if (!last) return;
    // The speed over the drag's last moments; none if the pointer had come to rest.
    const speed =
      first && last.time > first.time && event.timeStamp - last.time < MOON_FLICK.window
        ? ((last.x - first.x) / (last.time - first.time)) * SECOND
        : 0;
    const travel = event.clientX - x + (Math.abs(speed) > MOON_FLICK.speed ? speed * MOON_FLICK.coast : 0),
      target = left - travel;
    settle(land(target, target > left));
  };
  scroller.addEventListener('pointerup', release);
  scroller.addEventListener('pointercancel', release);
  // Back to now: shown on the side now has gone off to, once it is out of the strip's view.
  const home = detail.sheet.querySelector<HTMLButtonElement>('.moon-now'),
    here = detail.sheet.querySelector<HTMLElement>('.moon-here');
  // The moon's arrows step a day, each while that stays on the strip. Quick presses add up: each
  // carries on from where the last was headed.
  const arrows = [...detail.sheet.querySelectorAll<HTMLElement>('.moon-arrow')];
  const show = () => {
    const from = heading ?? scroller.scrollLeft,
      end = scroller.scrollWidth - scroller.clientWidth;
    for (const arrow of arrows) {
      const to = moonStep(from, arrow.dataset['edge'] === 'end', midnights);
      arrow.toggleAttribute('data-more', to !== undefined && to <= end);
    }
    const away = origin - scroller.scrollLeft;
    // A dot marks now on the strip once the marker has left it.
    if (here) here.hidden = Math.abs(away) < MOON_HOUR_PX / 2;
    if (!home) return;
    const half = scroller.clientWidth / 2,
      side = away < -half ? 'before' : away > half ? 'after' : '';
    home.hidden = !side;
    home.dataset['side'] = side;
  };
  home?.addEventListener('click', () => {
    haptic(card, 'selection');
    settle(origin);
  });
  for (const arrow of arrows)
    arrow.addEventListener('click', () => {
      haptic(card, 'selection');
      const to = moonStep(heading ?? scroller.scrollLeft, arrow.dataset['edge'] === 'end', midnights);
      if (to !== undefined) settle(to);
    });
  scroller.addEventListener('scroll', show, { passive: true });
  show();
}
