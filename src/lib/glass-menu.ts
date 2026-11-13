// A menu of choices that comes out of its button as a drop of glass: each choice with a check, its
// glyph and its name, the one shown checked. A press anywhere else, or Escape, puts it away and does
// nothing else. A press on the button opens it at once, and held, the choice under it is lit and let
// go over one, that one is chosen. Whoever draws it says where its button and menu are, so that a
// menu drawn again for what is chosen is found afresh. With no room under its button, it rises over it
// instead, the same motion turned upside down.
import { springEasing } from './press.ts';
import { SECOND } from './time.ts';

// A choice the menu offers: what it stands for, its name, any glyph, and what it shows that its name
// doesn't say.
export interface MenuChoice {
  value: string;
  title: string;
  glyph?: string;
  note?: string;
}
const CHECK =
  '<svg class="glass-menu-check" viewBox="0 0 9 9" aria-hidden="true"><path d="M1 4.8 3.3 7.3 8 1.5"/></svg>';
// The menu, hidden until its button opens it, with `kind` as a class of its own for where it stands.
export function glassMenuMarkup(label: string, shown: string, choices: readonly MenuChoice[], kind: string): string {
  const rows = choices.map(
    ({ value, title, glyph, note }) =>
      `<button type="button" role="menuitemradio" data-choice="${value}" aria-checked="${value === shown}">${CHECK}${glyph === undefined ? '' : `<i class="glass-menu-glyph">${glyph}</i>`}<span>${title}${note ? `<small>${note}</small>` : ''}</span></button>`,
  );
  return `<div class="glass-menu ${kind}" role="menu" aria-label="${label}" hidden><div class="glass-menu-rows" role="none">${rows.join('')}</div></div>`;
}

// The menu comes out of its button as a drop of glass, the button gone into it (see the styles). The
// button draws in to a ball a little below and left of itself, and the ball swells down and left,
// its bottom reaching the menu's in a sixth of a second and its left soon after, while its top first
// sinks and then climbs back to the button's, last, by about a third of a second. It swells a shade
// past its size, a fortieth wider and a thirtieth taller a quarter of a second in, and eases back to
// it by half a second. It is as round as it can be until an eighth of a second in, and its corners
// close in to the menu's by a third of a second. What it holds stands at its place in the menu
// from the start, a sixth larger about the middle of the menu's top and blurred, sharp by a fifth of
// a second and its size by two fifths; the glass all but goes as the button draws in, and comes
// back as the drop swells.
// Put away, it draws in toward the button and fades, gone in a sixth of a second before it gets
// there: its top drops by a fifth of its height and its foot by a few px, then its left and its
// foot close in and its right hardly at all, its corners rounding out to a quarter of its width,
// and what it holds blurs and is gone in the first tenth. The button stands again under it and
// comes back at under half its size, a little to the left, growing into its place by a third of a
// second and rising a little as it does, settled by half a second. Every edge moves on a smooth
// course of its own, so that nothing jerks, and the menu is drawn at its size at rest and only
// moved and stretched, what it holds stretched back the other way, so that the motion never waits
// on the page. Only its corners closing in are drawn afresh, as it is clipped by its own box and
// not a clip over it: one engine blurs what is behind a clip's rounded corners out to its square
// ones.
//
// Its edges at a moment: its left from the button's (1) to the menu's (0); its right, in from the
// corner they share, in button widths; its top, down from that corner, in menu heights; its bottom
// from the button's (0) to the menu's (1).
interface Edges {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
// A damped spring's share of the way still to go `t` s after it sets off from rest: 1 down to 0.
interface Spring {
  pace: number;
  damping: number;
}
function settling(t: number, { pace, damping }: Spring): number {
  const time = Math.max(0, t);
  if (damping >= 1) return Math.exp(-pace * time) * (1 + pace * time);
  const ringing = pace * Math.sqrt(1 - damping * damping);
  return (
    Math.exp(-damping * pace * time) *
    (Math.cos(ringing * time) + ((damping * pace) / ringing) * Math.sin(ringing * time))
  );
}
// A smooth swing out and back at `t` s: none at first, `by` at `peak` s, and none again, the sooner
// back the larger `sharp`.
interface Swing {
  by: number;
  peak: number;
  sharp: number;
}
const swing = (t: number, { by, peak, sharp }: Swing): number => {
  const share = Math.max(0, t) / peak;
  return by * share ** sharp * Math.exp(sharp * (1 - share));
};
// Opening: the left and bottom each spring across, the left first drawn in a little and the bottom
// held back a little as they go, both a few px past and back, the bottom most; the right draws in
// and comes back without passing; the top sinks, climbs a shade past home and settles. So it swells
// a fortieth wider and a thirtieth taller than at rest a quarter of a second in, and eases back.
const OPENING = {
  left: { spring: { pace: 17.53, damping: 0.725 }, swing: { by: 0.1072, peak: 0.0294, sharp: 0.63 } },
  right: [
    { by: 0.878, peak: 0.0617, sharp: 4.091 },
    { by: -0.4267, peak: 0.0814, sharp: 10 },
  ],
  top: [
    { by: 0.1829, peak: 0.1063, sharp: 2.209 },
    { by: -0.0525, peak: 0.2397, sharp: 9.614 },
  ],
  bottom: { spring: { pace: 20.05, damping: 0.6594 }, swing: { by: -0.0493, peak: 0.0337, sharp: 3.1 } },
} as const;
// Done once the edges are all within half a px.
const OPEN_MS = 500;
const openingCourse = (seconds: number): Edges => ({
  left: settling(seconds, OPENING.left.spring) + swing(seconds, OPENING.left.swing),
  right: OPENING.right.reduce((sum, each) => sum + swing(seconds, each), 0),
  top: OPENING.top.reduce((sum, each) => sum + swing(seconds, each), 0),
  bottom: 1 - settling(seconds, OPENING.bottom.spring) + swing(seconds, OPENING.bottom.swing),
});
// Closing, as steps [ms, left, right, top, bottom] that its edges pass through, and how much of its
// glass shows: its top drops and comes back a little, its foot drops a few px and then climbs, its
// left closes in and its right hardly, and it is gone before it reaches the button.
const CLOSING: readonly (readonly [ms: number, left: number, right: number, top: number, bottom: number])[] = [
  [0, 0, 0, 0, 1],
  [10, 0.024, 0.009, 0.05, 1.033],
  [22, 0.067, 0.024, 0.108, 1.05],
  [44, 0.163, 0.06, 0.171, 1.018],
  [68, 0.26, 0.09, 0.192, 0.944],
  [77, 0.307, 0.108, 0.193, 0.896],
  [102, 0.46, 0.165, 0.175, 0.727],
  [110, 0.507, 0.182, 0.165, 0.669],
  [135, 0.645, 0.238, 0.129, 0.499],
  [144, 0.69, 0.253, 0.116, 0.445],
  [170, 0.83, 0.295, 0.082, 0.29],
];
const CLOSING_GLASS: readonly (readonly [ms: number, share: number])[] = [
  [0, 1],
  [10, 0.96],
  [22, 0.81],
  [44, 0.65],
  [68, 0.57],
  [77, 0.5],
  [102, 0.35],
  [110, 0.31],
  [135, 0.19],
  [144, 0.17],
  [170, 0],
];
// What it holds as it opens: [ms, size, blur in px, opacity], about the middle of the menu's top.
const SHOWING: readonly (readonly [ms: number, size: number, blur: number, opacity: number])[] = [
  [0, 1.16, 8, 0],
  [78, 1.16, 8, 0.15],
  [103, 1.16, 6, 0.35],
  [128, 1.15, 3.5, 0.75],
  [153, 1.15, 1.5, 1],
  [177, 1.14, 0.5, 1],
  [192, 1.12, 0, 1],
  [218, 1.1, 0, 1],
  [235, 1.09, 0, 1],
  [250, 1.067, 0, 1],
  [267, 1.045, 0, 1],
  [285, 1.03, 0, 1],
  [303, 1.025, 0, 1],
  [335, 1.008, 0, 1],
  [368, 1, 0, 1],
  [OPEN_MS, 1, 0, 1],
];
// How much of its glass shows as it opens: [ms, share]. The button all but goes as it draws in,
// and the glass comes back as the drop swells, whole by a fifth of a second.
const GLASS: readonly (readonly [ms: number, share: number])[] = [
  [0, 1],
  [30, 0.15],
  [50, 0.1],
  [78, 0.32],
  [100, 0.5],
  [120, 0.66],
  [140, 0.79],
  [160, 0.9],
  [180, 0.96],
  [200, 1],
  [OPEN_MS, 1],
];
// What it holds blurs as it fades away: [ms, blur in px].
const FADING_BLUR: readonly (readonly [ms: number, blur: number])[] = [
  [0, 0],
  [33, 4],
  [70, 8],
];
// The button comes back from under the menu put away, nothing until then, at under half its size,
// to the left of its place, and grows back into it, rising a little as it does and settling back:
// [ms from the start of the menu going, size, across and down in shares of the button's size].
const BUTTON_BACK: readonly (readonly [ms: number, size: number, across: number, down: number])[] = [
  [145, 0.43, -0.17, -0.113],
  [164, 0.55, -0.152, -0.201],
  [198, 0.79, -0.081, -0.283],
  [232, 0.89, -0.04, -0.27],
  [266, 0.95, -0.016, -0.222],
  [300, 0.98, -0.005, -0.164],
  [334, 0.995, 0, -0.119],
  [368, 1, 0, -0.072],
  [402, 1, 0, -0.044],
  [436, 1, 0, -0.02],
  [470, 1, 0, -0.01],
  [504, 1, 0, 0],
];
const FRAMES_PER_SECOND = 60,
  FADING = 100;
// The share of the way from one place to another at `share` of the time, still at both ends:
// 3x² - 2x³, whose slope is none at 0 and at 1.
const STEEP = 3;
const easeBetween = (share: number) => {
  const x = Math.min(1, Math.max(0, share));
  return x * x * (STEEP - 2 * x);
};
// A table's row at `ms`, each value on a smooth curve through the steps that never runs past the
// steps either side of it.
function smoothAt(table: readonly (readonly number[])[], ms: number): number[] {
  const last = table.length - 1,
    next = Math.max(
      1,
      Math.min(
        last,
        table.findIndex(row => (row[0] ?? 0) >= ms),
      ),
    ),
    at = (i: number) => table[Math.max(0, Math.min(last, i))] ?? [];
  const [from = 0] = at(next - 1),
    [to = 0] = at(next),
    span = to - from || 1,
    share = Math.min(1, Math.max(0, (ms - from) / span));
  // The slope a column leaves step `i` at: none where the steps turn, else a mean of those beside.
  const slope = (i: number, column: number): number => {
    const rise = (k: number) => {
      const [t0 = 0] = at(k),
        [t1 = 0] = at(k + 1);
      return t1 > t0 ? ((at(k + 1)[column] ?? 0) - (at(k)[column] ?? 0)) / (t1 - t0) : 0;
    };
    if (i <= 0) return rise(0);
    if (i >= last) return rise(last - 1);
    const before = rise(i - 1),
      after = rise(i);
    if (before * after <= 0) return 0;
    const [t0 = 0] = at(i - 1),
      [t1 = 0] = at(i),
      [t2 = 0] = at(i + 1),
      wide = 2 * (t2 - t1) + (t1 - t0),
      deep = t2 - t1 + 2 * (t1 - t0);
    return (wide + deep) / (wide / before + deep / after);
  };
  // How far from the step before to the one after, and how much each end's slope carries.
  const towards = easeBetween(share),
    leaving = share * (1 - share) ** 2,
    arriving = share * share * (share - 1);
  return at(next).map((end, column) => {
    if (column === 0) return ms;
    const start = at(next - 1)[column] ?? end;
    return (
      start + (end - start) * towards + span * (leaving * slope(next - 1, column) + arriving * slope(next, column))
    );
  });
}
const closingCourse = (seconds: number): Edges => {
  const [, left = 0, right = 0, top = 0, bottom = 0] = smoothAt(CLOSING, seconds * SECOND);
  return { left, right, top, bottom };
};
const CLOSE_MS = 170;
interface Size {
  width: number;
  height: number;
}
// The menu's box for its edges, from where it rests at the corner it shares with the button: its
// left and top in px in from there, and its share of its size at rest each way, never quite nothing
// across, as what it holds is stretched back by as much.
const LEAST = 0.01;
function boxAt({ left, right, top, bottom }: Edges, menu: Size, button: Size) {
  const inLeft = (menu.width - button.width) * left,
    down = menu.height * top;
  return {
    left: inLeft,
    top: down,
    across: Math.max(LEAST, (menu.width - button.width * right - inLeft) / (menu.width || 1)),
    tall: Math.max(LEAST, (button.height + (menu.height - button.height) * bottom - down) / (menu.height || 1)),
  };
}
// Its corners, as one radius in px, never more than half its width or height: opening, as round as
// it can be while it swells, and from an eighth of a second in closing on a spring from two fifths
// of the menu's width to the menu's own, as it settles; closing, out to a quarter of the menu's
// width in a sixteenth of a second, and so round once it has drawn in far enough.
const CORNERS = { from: 0.123, widest: 0.409, spring: { pace: 18.4, damping: 0.826 } } as const,
  CLOSING_CORNERS = {
    widest: 0.258,
    steps: [
      [0, 0],
      [12, 0.4],
      [24, 0.55],
      [36, 0.81],
      [60, 1],
      [CLOSE_MS, 1],
    ],
  } as const;
const openingCorner = (seconds: number, width: number, corner: number) => {
  const widest = CORNERS.widest * width;
  return seconds < CORNERS.from
    ? widest
    : corner + (widest - corner) * settling(seconds - CORNERS.from, CORNERS.spring);
};
const closingCorner = (ms: number, width: number, corner: number) => {
  const [, share = 1] = smoothAt(CLOSING_CORNERS.steps, ms);
  return corner + (CLOSING_CORNERS.widest * width - corner) * share;
};
// The corners for a box `width` by `height` on screen with corners `radius` px round, as shares of the
// box, which it is stretched with.
const WHOLE = 100;
function cornersAt(width: number, height: number, radius: number): string {
  const round = Math.max(0, Math.min(radius, width / 2, height / 2));
  return `${(WHOLE * round) / (width || 1)}% / ${(WHOLE * round) / (height || 1)}%`;
}
// Held, the menu leans after the pointer, each way by a share of its size: none with the pointer
// over its middle, `edge` with it over its edge, and `beyond` more for each px past that. It moves
// by that share toward the pointer and grows by as much that way, and draws in by as much the other
// way, so that it keeps its area, its corner at the button standing where it is: pulled down, its
// top goes down and its foot twice as far, and it grows thinner. It follows the pointer as it
// moves, and let go, it springs back, a few px past and back, settled in about a second. A press
// moves once it has gone `SETTLES` px.
const LEAN = { edge: 0.0034, beyond: 0.00017 } as const,
  BACK = { stiffness: 114, damping: 10.7 } as const,
  BACK_MS = 1100,
  SETTLES = 6;
// The share a pointer at `at` leans the menu along a way it spans from `start` to `end`, in px on
// the screen, signed toward the pointer.
function leanAlong(at: number, start: number, end: number): number {
  const half = (end - start) / 2,
    off = at - start - half,
    past = Math.abs(off) - half;
  return Math.sign(off) * (past > 0 ? LEAN.edge + LEAN.beyond * past : (LEAN.edge * Math.abs(off)) / (half || 1));
}

export interface MenuParts {
  button: HTMLElement;
  menu: HTMLElement;
  // What the menu comes out of and goes back into, where that is only part of the button.
  from?: HTMLElement;
}
export interface MenuHost {
  // The menu's button and the menu as drawn now, leaving none on its way out.
  parts: () => MenuParts | undefined;
  // Its motion is off.
  still: () => boolean;
  // The menu opened.
  opened: () => void;
  // Where it stands, once it shows and before it moves: marked `data-rising`, it rises from the
  // corner it shares with the button's foot.
  place?: (parts: MenuParts) => void;
  // A choice picked from it.
  chosen: (value: string) => void;
  // Another choice is lit under a held pointer.
  ticked: () => void;
}
export function bindGlassMenu(root: HTMLElement, host: MenuHost) {
  const { parts } = host;
  // Open, as the button says: on its way out, the menu still shows but is no longer open.
  const isOpen = () => parts()?.button.getAttribute('aria-expanded') === 'true';
  // A box's size to the fraction of a px, as its own.
  const sizeOf = (box: HTMLElement): Size => {
    const { width, height } = getComputedStyle(box);
    return { width: parseFloat(width) || 0, height: parseFloat(height) || 0 };
  };
  // Runs the menu through a table, a frame at a time, moved and stretched from where it rests, what
  // it holds stretched back to stand at its place in the menu at rest: coming out of a blur, larger
  // about the middle of the menu's top, as it opens, and fading as it goes. Each transform is about
  // the box's own middle, where it turns by default, and moves only transforms and fades, so the
  // browser can run it on its own; the corners, which it can't, go in a motion of their own.
  const morph = (menu: HTMLElement, button: HTMLElement, opening: boolean) => {
    for (const running of menu.getAnimations({ subtree: true })) running.cancel();
    // Rising, every edge's course runs from the foot: what is worked out going down is turned over.
    const rising = menu.hasAttribute('data-rising'),
      size = sizeOf(menu),
      from = sizeOf(button),
      corner = parseFloat(getComputedStyle(menu).borderTopLeftRadius) || 0,
      total = opening ? OPEN_MS : CLOSE_MS,
      course = opening ? openingCourse : closingCourse,
      rows = menu.querySelector<HTMLElement>(':scope>.glass-menu-rows'),
      // The rows' middle in the menu, and the menu's own.
      own = rows ? sizeOf(rows) : size,
      place = rows ? { x: rows.offsetLeft + own.width / 2, y: rows.offsetTop + own.height / 2 } : { x: 0, y: 0 },
      middle = { x: size.width / 2, y: size.height / 2 },
      shapes: Keyframe[] = [],
      corners: Keyframe[] = [],
      held: Keyframe[] = [],
      blurs: Keyframe[] = [];
    for (let ms = 0; ; ms = Math.min(total, ms + SECOND / FRAMES_PER_SECOND)) {
      const offset = ms / total,
        edges = course(ms / SECOND),
        { left, top, across, tall } = boxAt(edges, size, from),
        // Its box's top, and the edge it shares with the button, which what it holds grows about.
        boxTop = rising ? size.height * (1 - tall) - top : top,
        shared = rising ? size.height : 0,
        [, grown = 1, clearing = 0, opacity = 1] = opening ? smoothAt(SHOWING, ms) : [],
        [, fading = 0] = opening ? [] : smoothAt(FADING_BLUR, ms),
        [, glass = 1] = smoothAt(opening ? GLASS : CLOSING_GLASS, ms);
      shapes.push({
        transform: `translate(${left - middle.x}px, ${boxTop - middle.y}px) scale(${across}, ${tall}) translate(${middle.x}px, ${middle.y}px)`,
        opacity: glass,
        offset,
      });
      const wide = size.width * across,
        high = size.height * tall,
        radius = opening ? openingCorner(ms / SECOND, size.width, corner) : closingCorner(ms, size.width, corner);
      corners.push({ borderRadius: cornersAt(wide, high, radius), offset });
      held.push({
        transform: `translate(${-place.x}px, ${-place.y}px) scale(${1 / across}, ${1 / tall}) translate(${middle.x - left}px, ${shared - boxTop}px) scale(${grown}) translate(${place.x - middle.x}px, ${place.y - shared}px)`,
        opacity: opening ? opacity : 1 - easeBetween(ms / FADING),
        offset,
      });
      blurs.push({ filter: `blur(${opening ? clearing : fading}px)`, offset });
      if (ms >= total) break;
    }
    const timing: KeyframeAnimationOptions = {
      duration: total,
      easing: 'linear',
      fill: opening ? 'none' : 'forwards',
    };
    // A blur is a motion of its own, as one engine runs nothing that blurs on its own.
    rows?.animate(held, timing);
    rows?.animate(blurs, timing);
    menu.animate(corners, timing);
    return menu.animate(shapes, timing);
  };
  // What a menu came out of growing back as it goes, by what it came out of. Under a menu that rose
  // over it, it sinks rather than rises.
  const growing = new WeakMap<HTMLElement, Animation>();
  const growBack = (button: HTMLElement, rising: boolean) => {
    growing.get(button)?.cancel();
    const own = sizeOf(button),
      way = rising ? -1 : 1,
      [first = 0] = BUTTON_BACK[0] ?? [],
      [last = 0] = BUTTON_BACK.at(-1) ?? [],
      frames: Keyframe[] = [];
    for (let ms = 0; ; ms = Math.min(last, ms + SECOND / FRAMES_PER_SECOND)) {
      const [, size = 1, across = 0, down = 0] = smoothAt(BUTTON_BACK, Math.max(first, ms));
      frames.push({
        transform: `translate(${across * own.width}px, ${way * down * own.height}px) scale(${size})`,
        opacity: ms < first ? 0 : 1,
        offset: ms / last,
      });
      if (ms >= last) break;
    }
    growing.set(button, button.animate(frames, { duration: last, easing: 'linear' }));
  };
  // Put away, the menu shrinks and fades and what it came out of grows back, standing as it is again
  // while the menu goes (see the styles).
  const shrink = (menu: HTMLElement, from: HTMLElement) => {
    growBack(from, menu.hasAttribute('data-rising'));
    return morph(menu, from, false);
  };
  // Opened from the keyboard, the choice shown takes the focus, and put away by Escape the button
  // has it again.
  const show = (open: boolean, focus = false) => {
    const found = parts();
    if (found === undefined || open === isOpen()) return;
    const { button, menu, from = button } = found;
    button.setAttribute('aria-expanded', String(open));
    for (const running of menu.getAnimations({ subtree: true })) running.cancel();
    if (open) {
      menu.removeAttribute('data-closing');
      growing.get(from)?.cancel();
      menu.hidden = false;
      host.place?.(found);
      if (focus) menu.querySelector<HTMLElement>('[aria-checked=true]')?.focus({ preventScroll: true });
      if (!host.still()) morph(menu, from, true);
      return;
    }
    if (focus) button.focus({ preventScroll: true });
    if (host.still()) {
      menu.hidden = true;
      return;
    }
    menu.toggleAttribute('data-closing', true);
    const going = shrink(menu, from);
    going.onfinish = () => {
      if (isOpen()) return;
      menu.hidden = true;
      menu.removeAttribute('data-closing');
      for (const running of menu.getAnimations({ subtree: true })) running.cancel();
    };
  };
  const choose = (chosen: string) => {
    const before = parts();
    host.chosen(chosen);
    const after = parts();
    // Drawn again for the choice, its menu shrinks into the new button, taking nothing more; with
    // the same one shown, it is simply put away.
    if (before === undefined || after === undefined || before.menu === after.menu) show(false);
    else if (!host.still()) {
      const { menu } = before;
      menu.inert = true;
      menu.setAttribute('aria-hidden', 'true');
      menu.toggleAttribute('data-leaving', true);
      after.menu.after(menu);
      shrink(menu, after.from ?? after.button).onfinish = () => {
        menu.remove();
      };
    }
  };
  // The choice in the menu at a point on the screen.
  const rowAt = (x: number, y: number) => {
    const page = root.getRootNode(),
      under = page instanceof ShadowRoot || page instanceof Document ? page.elementFromPoint(x, y) : null,
      row = under?.closest<HTMLElement>('[data-choice]');
    return row && parts()?.menu.contains(row) ? row : undefined;
  };
  // Whether a part of the page is the menu's button, or in the menu now drawn.
  const within = (on: Element | null, part: 'button' | 'menu') => {
    const found = parts();
    return Boolean(on && found?.[part].contains(on));
  };
  // A finger or the mouse held on the menu, or on its button, which opens it at once: the choice
  // under it is lit, with a tick each time another is, and let go over one, that one is chosen. The
  // press is the menu's, so what holds it never moves with it (see the touchmove below), and the
  // click it makes is its own.
  let held:
    | { pointer: number; x: number; y: number; moved: boolean; opened: boolean; lit: HTMLElement | undefined }
    | undefined;
  let swallow = false;
  const light = (row: HTMLElement | undefined) => {
    if (!held || row === held.lit) return;
    held.lit?.removeAttribute('data-lit');
    row?.toggleAttribute('data-lit', true);
    if (row && held.moved) host.ticked();
    held.lit = row;
  };
  // The menu's box at rest, from the button's corner it stands at: drawn stretched or swelling, its
  // own box says nothing.
  const restingBox = () => {
    const found = parts();
    if (!found) return undefined;
    // What it comes out of as it stands unpressed, as a held button is drawn in about its middle.
    const { button, menu, from = button } = found,
      whole = button.getBoundingClientRect(),
      pressed = new DOMMatrixReadOnly(getComputedStyle(button).transform),
      unpressed = (at: number, middle: number, by: number) => middle + (at - middle) / (by || 1),
      across = (at: number) => unpressed(at, whole.left + whole.width / 2, pressed.a),
      down = (at: number) => unpressed(at, whole.top + whole.height / 2, pressed.d),
      drawn = from.getBoundingClientRect(),
      own = sizeOf(from).width,
      scale = own ? (across(drawn.right) - across(drawn.left)) / own : 1,
      size = sizeOf(menu),
      right = across(drawn.right),
      top = menu.hasAttribute('data-rising') ? down(drawn.bottom) - size.height * scale : down(drawn.top);
    return { menu, left: right - size.width * scale, right, top, bottom: top + size.height * scale };
  };
  const stretch = (x: number, y: number) => {
    const box = restingBox();
    if (!box || host.still()) return;
    const { menu, left, right, top, bottom } = box,
      across = leanAlong(x, left, right),
      down = leanAlong(y, top, bottom),
      wide = (1 + Math.abs(across)) / (1 + Math.abs(down)),
      high = 1 / wide,
      own = sizeOf(menu);
    // Stretched about its middle, moved back so that the corner it shares with the button stays put,
    // its top right or, risen over the button, its bottom right, and moved on by the lean.
    const pinned = menu.hasAttribute('data-rising') ? 1 - high : high - 1;
    menu.style.scale = `${wide} ${high}`;
    menu.style.translate = `${((1 - wide) * own.width) / 2 + across * own.width}px ${(pinned * own.height) / 2 + down * own.height}px`;
  };
  const unstretch = () => {
    const menu = parts()?.menu;
    if (!menu?.style.scale) return;
    const from = { scale: menu.style.scale, translate: menu.style.translate || '0px 0px' };
    menu.style.scale = '';
    menu.style.translate = '';
    if (!host.still())
      menu.animate(
        { scale: [from.scale, '1 1'], translate: [from.translate, '0px 0px'] },
        { duration: BACK_MS, easing: springEasing(BACK, BACK_MS) },
      );
  };
  // A press that put the menu away goes no further: the click it makes is swallowed.
  let dismissing = false;
  root.addEventListener(
    'pointerdown',
    event => {
      const on = event.target instanceof Element ? event.target : null;
      swallow = false;
      dismissing = isOpen() && !within(on, 'button') && !within(on, 'menu');
      if (dismissing) {
        show(false);
        return;
      }
      if (held || event.button !== 0) return;
      const onButton = within(on, 'button'),
        onMenu = within(on, 'menu');
      if (!onButton && !(onMenu && isOpen())) return;
      const opened = onButton && !isOpen();
      if (opened) {
        host.opened();
        show(true);
      }
      held = { pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false, opened, lit: undefined };
      light(rowAt(event.clientX, event.clientY));
      // Held here, the press is no one else's: what holds the menu leaves a captured pointer alone.
      try {
        parts()?.[onButton ? 'button' : 'menu'].setPointerCapture(event.pointerId);
      } catch {}
    },
    true,
  );
  root.addEventListener(
    'pointermove',
    event => {
      if (!held || event.pointerId !== held.pointer) return;
      if (!held.moved && Math.hypot(event.clientX - held.x, event.clientY - held.y) < SETTLES) return;
      held.moved = true;
      light(rowAt(event.clientX, event.clientY));
      stretch(event.clientX, event.clientY);
    },
    true,
  );
  for (const type of ['pointerup', 'pointercancel'] as const)
    root.addEventListener(
      type,
      event => {
        if (!held || event.pointerId !== held.pointer) return;
        const { lit, moved, opened } = held;
        held = undefined;
        lit?.removeAttribute('data-lit');
        unstretch();
        if (type === 'pointercancel') return;
        swallow = true;
        const chosen = lit?.dataset['choice'];
        if (chosen && (moved || !opened)) choose(chosen);
      },
      true,
    );
  // WebKit scrolls a sheet from anywhere in it, whatever the styles say, so a held press keeps its
  // moves from scrolling anything.
  root.addEventListener(
    'touchmove',
    event => {
      if (held && event.cancelable) event.preventDefault();
    },
    { passive: false },
  );
  root.addEventListener(
    'click',
    event => {
      if (dismissing) {
        dismissing = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (swallow) {
        swallow = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const target = event.target instanceof Element ? event.target : null,
        row = target?.closest<HTMLElement>('[data-choice]'),
        chosen = row && within(row, 'menu') ? row.dataset['choice'] : undefined;
      if (chosen) choose(chosen);
      else if (within(target, 'button')) {
        const open = !isOpen();
        if (open) host.opened();
        show(open, event.detail === 0);
      }
    },
    true,
  );
  // A press that became a scroll makes no click.
  root.addEventListener('pointercancel', () => {
    dismissing = false;
    swallow = false;
  });
  // Escape puts the menu away rather than what holds it; the arrows go up and down it; Tab leaves it.
  root.addEventListener('keydown', event => {
    dismissing = false;
    swallow = false;
    const found = parts();
    if (found === undefined || !isOpen()) return;
    const items = [...found.menu.querySelectorAll<HTMLElement>('[data-choice]')],
      at = event.target instanceof HTMLElement ? items.indexOf(event.target) : -1,
      to = (index: number) => {
        event.preventDefault();
        items[(index + items.length) % items.length]?.focus({ preventScroll: true });
      };
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      show(false, true);
    } else if (event.key === 'ArrowDown') to(at + 1);
    else if (event.key === 'ArrowUp') to(at < 0 ? -1 : at - 1);
    else if (event.key === 'Home') to(0);
    else if (event.key === 'End') to(-1);
    else if (event.key === 'Tab') show(false);
  });
}
