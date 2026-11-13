// A sheet that comes up from the foot of the screen, where a popover has no room to stand beside
// what it opened from. It takes the screen's height and has nothing to hold it by.
//
// A finger moves it the way it scrolls anything, because that is what it does. The dialog is the
// one scroll there is, with the sheet a screen down it and its content running on below (see the
// styles), so scrolling the content and pulling the sheet down are the same scroll, either side of
// the sheet's place, and a pull from the content's top moves the sheet however the content came
// there. Let go, it goes on out if it is far enough down or going fast enough (`letsGo`), and back
// to its place if not, each on a spring of its own. The scroll snaps to nothing: a browser's
// snapping would send on out any pull still moving down, however short. Nothing catches it on its
// way out, so a finger setting off to scroll the page can't bring it back; on its way back, a
// finger catches it where it has got to.
//
// Only a finger that comes down with the content at its top lowers it, or one on its title bar.
// One that comes down on the content scrolled scrolls only that, however far, and the content
// coasting up to its top stops there. Nothing moves it up from its place, and no wheel or key
// moves it down from there.
//
// With the content scrolled, the title bar takes no scroll: a finger there draws the whole sheet
// down, its content held where it is, and let go it goes on out or back as a pull does. A mouse
// doesn't scroll by dragging, so it draws the sheet the same way, from its title bar or from
// anywhere once its content is at the top, but not from what captures the pointer for its own.
import { onHidden } from '../lib/dom.ts';

// When to show one, given the card's setting: a phone held either way up.
const NARROW = '(max-width:539px)',
  LOW = '(max-height:439px)';
export const isCompact = () => matchMedia(NARROW).matches || matchMedia(LOW).matches;

// Let go, a pull goes if it is past half way, or will be: what its speed, in px a ms, carries it on
// this many ms is counted with how far it has come.
const LET_GO = { share: 0.5, ahead: 300 } as const;
export const letsGo = (travel: number, height: number, speed: number): boolean =>
  travel > 0 && travel + speed * LET_GO.ahead >= height * LET_GO.share;

// A spring read off as a curve: where it is, from 0 to 1 of the way, every
// `step` ms, to `places` decimals, until it is within `gone` px of the end of its move, for no
// longer than `most` ms.
const CURVE = { gone: 1, step: 8, places: 4, most: 1000 } as const;
const MS = 1000;
// How a spring with this `pace`, in radians a second, and `damping` (1 never overshoots) moves
// `distance` px, setting off at `speed` px a ms toward its end, or away from it below 0: where it
// is, a step apart, and how many ms it takes.
function springCurve(distance: number, pace: number, damping: number, speed = 0): { points: number[]; ms: number } {
  const decay = damping * pace,
    ringing = pace * Math.sqrt(Math.max(0, 1 - damping * damping)),
    // How fast it sets off, in shares of its distance a second.
    start = distance > 0 ? (speed * MS) / distance : 0,
    left = (t: number) =>
      ringing > 0
        ? Math.exp(-decay * t) * (Math.cos(ringing * t) + ((decay - start) / ringing) * Math.sin(ringing * t))
        : (1 + (pace - start) * t) * Math.exp(-pace * t),
    at = (ms: number) => 1 - left(ms / MS),
    round = (value: number) => Number(value.toFixed(CURVE.places)),
    points = [0];
  let ms = 0;
  while (ms < CURVE.most && (1 - at(ms)) * distance > CURVE.gone) {
    ms += CURVE.step;
    points.push(round(at(ms)));
  }
  points[points.length - 1] = 1;
  return { points, ms };
}

// Let go on its way out, it springs the rest of the way, setting off as fast as it was going, so
// that it never stands still or leaps as it goes from the finger to its own going: at `pace`, with
// damping from `firm` at `slow` px a ms or less to `loose` at `fast` or more, in proportion
// between, so thrown hard it is out of sight in half the time.
const THROWN = { pace: 17.3, firm: 0.98, loose: 0.79, slow: 1, fast: 1.5 } as const;
// How a sheet let go `left` px from out of sight, going `speed` px a ms, goes the rest of the way,
// setting off at `from` px a ms: from rest where its scroll coasts on under it, carrying it on.
export function thrownCurve(left: number, speed: number, from = speed) {
  const share = Math.min(1, Math.max(0, (speed - THROWN.slow) / (THROWN.fast - THROWN.slow)));
  return springCurve(left, THROWN.pace, THROWN.firm + (THROWN.loose - THROWN.firm) * share, Math.max(0, from));
}
// Let go short of going, it springs back to its place as it rises when it opens: stiffer, and
// with no overshoot. Let go still going down, it carries on a little before it turns.
const BACK = { pace: 18.4, damping: 1 } as const;
// How a sheet let go `by` px below its place, going down `speed` px a ms, goes back up to it.
export const backCurve = (by: number, speed = 0) => springCurve(by, BACK.pace, BACK.damping, -speed);

// The page draws a scroll about this many ms on from where it last said the scroll was, and first
// shows what it sets going about as far along. A sheet let go still going down is that much
// further down than its scroll says by the time it is drawn going back.
export const SHOWN = 33;
// How far back a drag's speed is read from, in ms. Anything older says nothing of how it was let go.
const SPEED_OVER = 100;
// How far a press that draws the sheet goes, in px, before it says where it is going.
const PRESS_SETTLES = 6;
// A scroll within a pixel of its end is at it: a zoomed page can leave it a fraction short.
const AT_END = 1;
// How long, in ms, a scroll goes without a step before it has come to rest, where the browser
// doesn't say so itself.
const RESTS = 150;
// A finger let go less than this, in px, from where it came down has only pressed: nothing under
// it has scrolled.
const STILL = 6;
// How far the dialog's scroll is past the sheet's place, a screen down it (see the styles): how far
// its content has scrolled, or, short of 0, how far down the sheet has been pulled.
export const pastPlace = (dialog: HTMLElement) => dialog.scrollTop - dialog.clientHeight;
// A stroke the page hears of within this many ms of its press came all at once, from a page too
// busy to hear it as it went, so it says nothing of how fast it went.
const AT_ONCE = 16;
// Keys that scroll up, which from the content's top would scroll the sheet away.
const UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home']);

export interface SheetDragHost {
  // Whether the dialog is one to pull, now.
  active(): boolean;
  // It has started down, so whatever else took the press is to let go.
  began(): void;
  // Where a press that draws it has it, in px below its place, its content held where it is.
  moved(y: number): void;
  // A press that drew it has let it go this many px below its place, going down this fast, in px a
  // ms: on out if `go`, back up to its place if not.
  released(by: number, go: boolean, speed: number): void;
  // A press that draws it has come down on it: on its way back from one, it stops where it has
  // got to. How far below its place that is, in px.
  grabbed(): number;
  // A finger has let it go on its way out, going this fast, in px a ms, with its scroll at most
  // this far from out of sight: it stops being a scroll where it is, and goes on from there.
  thrown(speed: number, from: number): void;
  // A finger has let it go this many px below its place, short of going, still going down this
  // fast, in px a ms, its scroll put back there: it is to go back up from where it is drawn.
  back(by: number, speed: number): void;
  // A finger has come down on it: on its way back, it stops where it has got to, as a scroll.
  caught(): void;
  // A finger has thrown it out of sight.
  gone(): void;
}

// Whether a scroll going up from `start` would reach the dialog: nothing on the way can go further.
function reachesDialog(start: EventTarget | null, dialog: HTMLElement): boolean {
  for (let at = start instanceof Element ? start : null; at && at !== dialog; at = at.parentElement)
    if (at.scrollTop > 0) {
      const { overflowY } = getComputedStyle(at);
      if (overflowY === 'auto' || overflowY === 'scroll') return false;
    }
  return true;
}

// Whether something inside has taken this press for its own, as a chart's reading does: it will have
// captured the pointer, on the way up to the dialog.
function claimed(target: EventTarget | null, pointer: number): boolean {
  for (let at = target instanceof Element ? target : null; at; at = at.parentElement)
    if (at.hasPointerCapture(pointer)) return true;
  return false;
}

// Call this after whatever in the dialog takes a press for its own has begun listening.
export function pullToClose(dialog: HTMLElement, host: SheetDragHost) {
  followScroll(dialog, host);
  followDrag(dialog, host);
}

// A finger let go: how fast it went, in px a ms, and how far down from where it came down.
type Release = { speed: number; moved: number };

function followScroll(dialog: HTMLElement, host: SheetDragHost) {
  let resting = 0,
    lowered = false,
    // Fingers down on it, whether a finger has moved it since it last came to rest, and whether the
    // first came down on its content scrolled, so that it scrolls the content only, however far:
    // one on its title bar carries on into the sheet, as the bar isn't what it scrolls. Scrolled
    // far enough to show the bar, the bar takes no scroll at all (see followDrag).
    fingers = 0,
    fingered = false,
    reading = false,
    // Let go on its way out: how fast it was going, in px a ms, until it sets off.
    throwing: number | undefined,
    // Let go having moved, before its scroll was heard of: how fast the finger went, in px a ms,
    // and how far down.
    released: Release | undefined,
    // Where the finger came down, or where it was as the sheet set off down, and where it has been
    // lately and when, for how far and how fast it goes: read from the finger itself, since a busy
    // page hears of its scroll late.
    pressed = 0,
    pressedAt = 0,
    trail: { y: number; time: number }[] = [],
    // Where its scroll was when it last moved, or was let go.
    lastTop: number | undefined;
  // Where its scroll stands with the sheet in its place and its content at the top.
  const place = () => dialog.clientHeight;
  // Whether it is kept at its place: the sheet is drawn there whatever its scroll does (see the
  // styles), so that the content coasting to its top, or a finger that came down on it scrolled,
  // takes it no further, on the very frame it gets there. Its scroll can still go on under it,
  // and is stopped once the page hears of it. It is kept so from when a finger leaves it standing
  // until one comes down on it with its content at the top, to pull it.
  const kept = () => 'kept' in dialog.dataset;
  const keep = (on: boolean) => {
    dialog.toggleAttribute('data-kept', on);
  };
  // Stopped at its place: for a frame it can't scroll at all, which stops a scroll still coasting
  // too. One still coasting would otherwise go on taking every finger that lands to stop it,
  // unheard.
  const halt = () => {
    dialog.scrollTop = place();
    dialog.toggleAttribute('data-halted', true);
    requestAnimationFrame(() => requestAnimationFrame(() => dialog.removeAttribute('data-halted')));
  };
  // Back to its place from `top`, going down `speed` px a ms: its scroll is put there at once, and
  // it is drawn going up from where it has got to.
  const back = (top: number, speed: number) => {
    halt();
    host.back(place() - top + Math.max(0, speed) * SHOWN, speed);
  };
  // Come to rest at the start of its scroll, it is out of sight; left short of its place with no
  // finger on it, as a finger taken from it leaves it, it goes back. Kept at its place, it is
  // there, wherever its scroll has stopped, and once no finger is on it, its scroll is too. A page
  // can say a scroll has ended as the finger leaves it, while it still coasts on.
  const rested = () => {
    clearTimeout(resting);
    if (!fingers) {
      fingered = false;
      released = undefined;
    }
    if (!host.active()) return;
    const top = dialog.scrollTop;
    if (kept()) {
      if (!fingers && top < place() - AT_END) halt();
    } else if (top < AT_END) host.gone();
    else if (!fingers && top < place() - AT_END) back(top, 0);
  };
  // Marks where the finger is, and says how fast it has gone down lately, in px a ms: since where
  // it was SPEED_OVER ms ago, read between the marks either side of then, as a busy page hears of
  // its moves seldom, some at once.
  const marked = (y: number, time: number) => {
    const since = time - SPEED_OVER,
      kept = [...trail, { y, time }];
    trail = kept.slice(Math.max(0, kept.filter(mark => mark.time <= since).length - 1));
    const [first, next] = trail;
    if (!first || first.time >= time) return 0;
    const from = Math.max(since, first.time),
      at =
        next && next.time > first.time
          ? first.y + ((next.y - first.y) * (from - first.time)) / (next.time - first.time)
          : first.y;
    return (y - at) / (time - from);
  };
  // Let go lowered, it goes on out if a sheet would, and back to its place if not. Its scroll can be
  // heard of late, but not the finger that moved it.
  const decide = (top: number, { speed, moved }: Release) => {
    lastTop = top;
    if (!letsGo(Math.max(place() - top, moved), place(), speed)) {
      back(top, speed);
      return;
    }
    throwing = speed;
    // Let go still, nothing scrolls on to set it off.
    requestAnimationFrame(() => {
      fling(dialog.scrollTop);
    });
  };
  // On its way out once let go, it goes the rest of the way by itself, so that nothing catches it
  // on the way, as a finger setting off to scroll the page can. It sets off when its scroll next
  // moves, a finger lands, or a frame has gone, whichever is first. Its scroll goes on coasting
  // under it, wherever the page has drawn it by then, which can be further on than the page has
  // said, so it is given the longer of the last two ways to go by itself: given more than it
  // needs, it only ends further out of sight.
  const fling = (top: number) => {
    if (throwing === undefined) return;
    const speed = throwing;
    throwing = undefined;
    host.thrown(speed, Math.max(top, lastTop ?? top));
  };
  dialog.addEventListener(
    'touchstart',
    event => {
      fingers = event.touches.length;
      // A dialog that isn't one to pull, as the map over the whole screen, is only touched: its
      // scroll stands at 0 there, which would read as pulled all the way down.
      if (!host.active()) return;
      fling(dialog.scrollTop);
      host.caught();
      released = undefined;
      fingered = true;
      const touch = event.changedTouches[0];
      if (fingers === 1 && touch) {
        reading =
          dialog.scrollTop > place() + AT_END && !(event.target instanceof Element && event.target.closest('header'));
        // Come down on its content scrolled, it is kept at its place; at its top, it is the
        // finger's to pull down.
        keep(reading);
        pressed = touch.clientY;
        pressedAt = event.timeStamp;
        trail = [];
        marked(pressed, event.timeStamp);
      }
    },
    { capture: true, passive: true },
  );
  dialog.addEventListener(
    'touchmove',
    event => {
      const touch = event.touches[0];
      if (touch) marked(touch.clientY, event.timeStamp);
    },
    { capture: true, passive: true },
  );
  for (const type of ['touchend', 'touchcancel'] as const)
    dialog.addEventListener(
      type,
      event => {
        fingers = event.touches.length;
        if (fingers || !host.active()) return;
        // Where it stands, or scrolling its content, nothing more is asked of it, short of stopping
        // at its place. Taken from the finger, it goes back. Moved down from its place before its
        // scroll was heard of at all, it is decided once it is.
        const touch = event.changedTouches[0],
          release =
            touch && type === 'touchend'
              ? {
                  speed: event.timeStamp - pressedAt < AT_ONCE ? 0 : marked(touch.clientY, event.timeStamp),
                  moved: touch.clientY - pressed,
                }
              : undefined,
          top = dialog.scrollTop;
        if (!reading && (lowered || top < place() - AT_END)) {
          if (release) decide(top, release);
        } else if (!reading && release && release.moved >= STILL && top < place() + AT_END) {
          released = release;
          clearTimeout(resting);
          resting = window.setTimeout(rested, RESTS);
        } else {
          if (top < place() - AT_END) halt();
          // Left where it stands, it is kept there, whatever its content does now.
          keep(true);
          fingered = false;
        }
      },
      { capture: true, passive: true },
    );
  dialog.addEventListener(
    'scroll',
    () => {
      if (!host.active()) return;
      const was = lowered,
        top = dialog.scrollTop;
      if (!fingers && released) {
        if (top < place() - AT_END) decide(top, released);
        released = undefined;
      }
      if (!fingers && throwing !== undefined) {
        fling(top);
        return;
      }
      lastTop = top;
      lowered = top < place() - AT_END;
      // Only a finger that came down with the content at its top lowers it. Anything else that would,
      // as the content coasting up to its top, a finger that set off scrolling it, or bringing
      // something into view can, is stopped at its place. Kept there, it is drawn there already;
      // stopping its scroll there too means a finger turning back scrolls the content at once.
      if (lowered && (!fingered || reading)) {
        halt();
        lowered = false;
        return;
      }
      if (!fingered) return;
      // Set off down, from wherever the finger has brought its content to the top: how far the
      // sheet has gone is counted from here.
      if (lowered && !was) {
        host.began();
        pressed = trail.at(-1)?.y ?? pressed;
      }
      clearTimeout(resting);
      resting = window.setTimeout(rested, RESTS);
    },
    { passive: true },
  );
  dialog.addEventListener('scrollend', rested);
  // A wheel or a key going up from the content's top would carry on into the sheet.
  const atTop = () => dialog.scrollTop < place() + AT_END;
  dialog.addEventListener(
    'wheel',
    event => {
      if (host.active() && event.deltaY < 0 && atTop() && reachesDialog(event.target, dialog)) event.preventDefault();
    },
    { passive: false },
  );
  dialog.addEventListener('keydown', event => {
    if (!host.active() || event.defaultPrevented) return;
    // Space on a button presses it.
    const up =
      UP_KEYS.has(event.key) || (event.key === ' ' && event.shiftKey && !(event.target instanceof HTMLButtonElement));
    if (up && atTop() && reachesDialog(event.target, dialog)) event.preventDefault();
  });
}

// A press that draws the sheet down rather than scrolling it: a mouse's, as a mouse doesn't scroll
// by dragging, and a finger's or a pen's on the title bar with the content scrolled, where the bar
// takes no scroll (see the styles). Either way its content stays where it is.
function followDrag(dialog: HTMLElement, host: SheetDragHost) {
  let press: { x: number; y: number; head: boolean; mouse: boolean; pointer: number; from: number } | null = null,
    dragging = false,
    // How far below its place it is drawn, in px.
    drawn = 0,
    trail: { y: number; time: number }[] = [],
    ignoreHidden = () => {};
  // Let go, or given up, it goes on out if it would, and back to its place if not. Caught on its
  // way back and never moved, it carries on back.
  const ended = (time: number, finished: boolean) => {
    const from = press,
      drew = dragging;
    ignoreHidden();
    press = null;
    dragging = false;
    if (!from || (!drew && from.from === 0)) return;
    const marks = trail.filter(mark => time - mark.time <= SPEED_OVER),
      [first] = marks,
      last = marks.at(-1),
      span = first && last ? last.time - first.time : 0,
      speed = first && last && span ? (last.y - first.y) / span : 0;
    host.released(drawn, finished && letsGo(drawn, dialog.offsetHeight, speed), speed);
  };
  // Says whether this move is the drag's. A mouse's first move far enough to say where it is going
  // decides: from the title bar, or with the content at its top, the sheet takes it if it goes more
  // down than across. A finger on the title bar has nothing else there to move, so the sheet takes
  // it whichever way it sets off, though never up past its place.
  const followed = (x: number, y: number, time: number): boolean => {
    if (!press) return false;
    const across = x - press.x,
      down = y - press.y;
    if (!dragging) {
      if (press.mouse && (!(press.head || pastPlace(dialog) < AT_END) || Math.abs(across) > down)) {
        ended(time, false);
        return false;
      }
      dragging = true;
      host.began();
    }
    trail = [...trail, { y, time }].filter(mark => time - mark.time <= SPEED_OVER);
    drawn = Math.max(0, press.from + down);
    host.moved(drawn);
    return true;
  };

  dialog.addEventListener('pointerdown', event => {
    const mouse = event.pointerType === 'mouse';
    if (dragging || (press && !mouse)) return;
    // A mouse let go where the page never heard of it.
    if (press) ended(event.timeStamp, false);
    // The dialog's own ground is the backdrop.
    if (!host.active() || event.button !== 0 || event.target === dialog) return;
    const { target, clientX: x, clientY: y, pointerId: pointer } = event,
      head = target instanceof Element && target.closest('header') !== null;
    if (mouse ? claimed(target, pointer) : !head || !('scrolled' in dialog.dataset)) return;
    trail = [];
    ignoreHidden();
    // Held as the page is suspended, the sheet goes back to its place.
    ignoreHidden = onHidden(() => {
      ended(performance.now(), false);
    });
    const from = host.grabbed();
    press = { x, y, head, mouse, pointer, from };
    drawn = from;
  });
  dialog.addEventListener('pointermove', event => {
    if (!press || event.pointerId !== press.pointer) return;
    // Let go off the window, it was never told. Drawing the sheet, a mouse let go there lets it go
    // where it last was, at the speed it had: the move that says so is from wherever the button
    // came up, and may be from nowhere at all.
    if (!event.buttons && (press.mouse || !dragging)) {
      ended(event.timeStamp, dragging);
      return;
    }
    if (!dragging && Math.hypot(event.clientX - press.x, event.clientY - press.y) < PRESS_SETTLES) return;
    const begun = !dragging;
    // Held by the dialog, it runs on past the window's edge, and what it started on isn't clicked.
    if (followed(event.clientX, event.clientY, event.timeStamp) && begun) dialog.setPointerCapture(event.pointerId);
  });
  for (const type of ['pointerup', 'pointercancel'] as const)
    dialog.addEventListener(type, event => {
      if (press && event.pointerId === press.pointer) ended(event.timeStamp, type === 'pointerup');
    });
  // WebKit scrolls from the title bar whatever the styles say, and then takes the press away, so a
  // finger drawing the sheet keeps its moves from scrolling anything. The charts already wait on
  // the dialog's moves, so this makes nothing wait that didn't.
  dialog.addEventListener(
    'touchmove',
    event => {
      if (press && !press.mouse && event.cancelable) event.preventDefault();
    },
    { passive: false },
  );
}
