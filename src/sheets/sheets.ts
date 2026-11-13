// The sheets a tile, a day or a panel opens: a day picker, the day's hourly chart, a summary and,
// for today, a comparison with yesterday from Home Assistant's history. The map docks beside the
// page where there is room, in a sheet of its own that stays open, the page beside it, while
// other tiles open their sheets over the page.
import { type ChartReader, scrubCharts } from './chart-scrub.ts';
import { child, targetOf } from '../lib/dom.ts';
import { PERCENT } from '../lib/html.ts';
import { haptic } from '../lib/haptics.ts';
import { springEasing } from '../lib/press.ts';
import { bindMoonTimeline } from '../cards/moon/timeline.ts';
import { HOUR } from '../lib/time.ts';
import { type AnchorRect, SHEET_TAIL, placePopover, restingBox, sheetEdge, sheetOutline } from './popover.ts';
import { backCurve, isCompact, pastPlace, pullToClose, SHOWN, thrownCurve } from './bottom-sheet.ts';
import { keepLastWords } from './parts.ts';
import { type DetailDay, sheetDays } from './days.ts';
import { drawKeepingPages, stripOf } from './pages.ts';
import { clockOf } from './time.ts';
import { type HistoryHost, SheetHistory } from './history.ts';
import { type Reach, seriesReach } from './series.ts';
import type { History } from '../weather/history.ts';
import type { SheetId } from '../cards/ids.ts';
import { SHEET_CARDS, SWITCHABLE } from '../cards/index.ts';
import type { MapLayerKind } from '../card/config.ts';
import { say } from '../weather/words.ts';
import type { TileContext } from '../cards/shared/context.ts';
import { bindSwitcher, type SheetChoice, switcherMarkup } from './switcher.ts';
import { bindOptions, optionsMarkup, type UnitsHost } from './options.ts';

// The transform that lays a box drawn at `box` over `onto` instead, from its top left.
const towards = (box: DOMRect, onto: DOMRect): string =>
  `translate(${onto.left - box.left}px,${onto.top - box.top}px) scale(${onto.width / box.width},${onto.height / box.height})`;
// Docked, the map takes half the card's width (see the styles), and the page keeps the rest
// when that holds three columns (620 px of its own).
export const DOCK = { share: 0.5, least: 620 } as const;
// Docking, in ms: the panel grows for 320 and shrinks away for 260, the map comes up in it over
// 160, and the page fades back in from 15% over 240.
const DOCKING = {
  grow: 320,
  shrink: 260,
  content: 160,
  page: 240,
  faded: 0.15,
  landing: 'cubic-bezier(.2,.8,.2,1)',
  leaving: 'cubic-bezier(.4,0,.2,1)',
} as const;
// A sheet opens out of its tail on a spring, from nothing: a little past full size by a quarter of
// a second, and settled about a quarter of a second on, its first tenth of a second fading in. It
// goes in a tenth of a second, fading where it is.
const OPENING = {
  from: 0.01,
  duration: 600,
  easing: springEasing({ stiffness: 424, damping: 32.5 }),
  fade: 110,
} as const;
const CLOSING = { duration: 110, easing: 'ease-out', fill: 'forwards' } as const;
// Let go by a finger, a sheet from the foot goes on out or back to its place on a spring of its own
// (see bottom-sheet.ts), from where it is drawn as it sets off. Where a curve can't be given point
// by point, it goes on the curve it slides by (`SLIDES`, as the styles do), for no more than `most`
// ms, a whole slide: thrown out, for the time that sets it off as fast as it was going, at `slope`
// times its mean speed, and no less than `least` ms. What the page sets going is first shown as far
// along as it would be some ms on (`SHOWN`), so a sheet thrown out waits that long, to set off
// from where it is shown rather than leap ahead: thrown by its scroll, the scroll carries it on
// meanwhile.
const RELEASE = { slope: 2.25, least: 120, most: 500 } as const;
const SLIDES = 'cubic-bezier(.32,.72,0,1)';
const springs = () => CSS.supports('transition-timing-function', 'linear(0, 1)');
// A sheet from the foot of the screen is drawn at the size that fills it, up to its widest, over the
// page as it stands.
const OWN_WIDTH = 400,
  FOOT_WIDEST = 540;
// The title bar shows once the content has gone this many px under it: a zoomed page or a flick's
// bounce can leave it a little short of its top, and there it reads as at the top. It is read
// again once the scrolling has settled, this many ms after the last move, as the last move of a
// flick or a bounce may never be reported.
const SCROLLED = 4,
  SETTLED = 150;
// A sheet's tabs: the thumb slides on a tight spring, half way by a tenth of a second, a shade past
// its place by a third and settled soon after, keeping its size all the way.
const SLIDING = { duration: 700, easing: springEasing({ stiffness: 256, damping: 27.4 }, 700) } as const;
// A strip easing to its place, in ms, in and out (3t² − 2t³). Pages take longer the further they go.
const GLIDE = 350;
// Pages a finger let go of settle on a spring that just doesn't pass their place: its rate, a ms, so
// that from rest a page goes in about a third of a second. Within this many px of their place, and
// slower than this many px a ms, they're there.
const SETTLE = 0.025,
  AT_REST = 0.3,
  RESTING = 0.01;
// What's left between a tail's tip and what it points at, on screen.
const TIP_GAP = 2;
// From the foot, its close button swells while pressed on a quick spring, a shade past its size in
// a fifth of a second, and let go it goes back on a looser one, dipping under its size first (see
// the styles).
const CLOSE_PRESS = {
  swell: springEasing({ stiffness: 576, damping: 29.8 }, 450),
  settle: springEasing({ stiffness: 256, damping: 12.8 }, 800),
} as const;

export interface DetailSheet {
  dialog: HTMLDialogElement;
  sheet: HTMLElement;
  // The glass under it, cut to the sheet's shape with its tail: the sheet scrolls in a plain
  // rectangle, so nothing it holds reaches the tail, and what scrolls under the title can fade
  // while the glass stays as it is.
  glass: HTMLElement;
  // The title held over the sheet once it's scrolled.
  band: HTMLElement;
  // What is drawn round the glass (see sheetEdge), over all the rest.
  edge: HTMLElement;
  followed: (event: Event) => void;
  resized: () => void;
  id: SheetId;
  anchor: HTMLElement;
  // Where the anchor was last seen: its box at rest, kept for when it can't be found.
  seen: AnchorRect | undefined;
  // The shape the glass is cut to.
  outline: string;
  day: string | undefined;
  variant: string;
  month: number;
  moonOffset: number;
  days: DetailDay[];
  history: History | null | undefined;
  historyKey: string | undefined;
  // How far its reading goes, for its charts' scale (see render).
  reach: Reach | null;
  // What it was last drawn from (see render).
  drawnFrom: string;
  // Its strip of days easing along (see glide).
  gliding: number;
  // Reads its charts, and puts what's read away.
  reader: ChartReader;
  // The page its charts are sliding to, for a day picked (see slide), and the frame that takes them.
  heading: number | undefined;
  sliding: number;
  // Its day, turned to by a finger, to draw once its pages are there (see turnTo).
  owed: boolean;
  // Going (see close), and its animations under way.
  closing: boolean;
  motion: Animation[];
  // From the foot, let go short of going, its way back to its place, and whether it was drawn down
  // with its content held, rather than pulled by its scroll.
  returning: Animation | undefined;
  held: boolean;
}

// A strip eases to `left`, each frame's request told to `asked` so it can be called off. A browser's
// own smooth scrolling doesn't serve. A strip is drawn again under it at every press, and WebKit then
// doesn't go at all, and a place set while it runs moves where it ends rather than taking over, past
// that place.
function easeAcross(
  strip: HTMLElement,
  left: number,
  duration: number,
  asked: (frame: number) => void,
  arrived?: () => void,
) {
  const from = strip.scrollLeft,
    begun = performance.now(),
    step = (now: number) => {
      const gone = Math.min(1, (now - begun) / duration);
      strip.scrollLeft = from + (left - from) * gone * gone * (1 + 2 * (1 - gone));
      if (gone < 1) asked(requestAnimationFrame(step));
      else arrived?.();
    };
  asked(requestAnimationFrame(step));
}
// A strip let go of goes on to `left` from the speed it was going at (`speed`, its own px a ms along
// it), so nothing stops as the finger lifts: on a spring with no bounce, x = (x₀ + (v₀ + kx₀)t)e^(−kt)
// from its place. Going towards it fast enough for that spring to pass it, it slows from that speed
// instead, as x₀e^(−kt) with k = v₀/x₀.
function settleAcross(
  strip: HTMLElement,
  left: number,
  speed: number,
  asked: (frame: number) => void,
  arrived: () => void,
) {
  const off = strip.scrollLeft - left,
    rate = speed * off < 0 ? Math.max(SETTLE, Math.abs(speed / off)) : SETTLE,
    lean = speed + rate * off,
    // Timed from the frame that drew it where it was let go, as each frame's time is when it began.
    frame = document.timeline.currentTime,
    begun = typeof frame === 'number' ? frame : performance.now(),
    step = (now: number) => {
      const time = Math.max(0, now - begun),
        fade = Math.exp(-rate * time),
        away = (off + lean * time) * fade;
      if (Math.abs(away) < AT_REST && Math.abs((speed - rate * lean * time) * fade) < RESTING) {
        strip.scrollLeft = left;
        arrived();
        return;
      }
      strip.scrollLeft = left + away;
      asked(requestAnimationFrame(step));
    };
  asked(requestAnimationFrame(step));
}

// What the sheets read from the card, and ask of it.
export interface SheetHost
  extends EventTarget,
    HistoryHost,
    Pick<HTMLElement, 'hasAttribute' | 'toggleAttribute' | 'removeAttribute' | 'getBoundingClientRect'> {
  readonly root: ShadowRoot;
  readonly motion: MediaQueryList | undefined;
  // The map, at the one place sheets and maps meet: a sheet tells it when it opens and closes, and
  // to draw itself in the sheet it holds.
  readonly maps: {
    readonly layer: MapLayerKind | undefined;
    opening(): void;
    reset(): void;
    draw(): void;
  };
  // The units its readings are shown in, which its options pick (see options.ts).
  readonly units: UnitsHost;
  measureZoom(): number;
  remeasure(): void;
  drawMoons(): void;
}
// What a sheet's tabs and strip of days are when it's drawn again.
interface Held {
  thumb: number | undefined;
  strip: number | undefined;
}
const heldBy = (sheet: HTMLElement): Held => ({
  thumb: sheet.querySelector('.segmented .thumb')?.getBoundingClientRect().left,
  strip: sheet.querySelector('.detail-days')?.scrollLeft,
});
// Drawing replaces the controls around the pages. Keep the keyboard on the same action; a day
// arrow that became disabled hands it to the chosen day instead.
const CONTROL_KEYS = ['day', 'step', 'variant', 'month', 'hours', 'close', 'option'];
function focusedControl(sheet: HTMLElement): string | undefined {
  const focused = sheet.querySelector<HTMLElement>(':focus');
  if (focused?.matches('.chart-time')) {
    const chart = focused.closest('.chart'),
      id = chart?.getAttribute('data-chart');
    return `${id ? `.chart[data-chart="${CSS.escape(id)}"]` : '.chart'} .chart-time`;
  }
  if (!focused?.matches('button, select')) return undefined;
  const key = CONTROL_KEYS.find(name => focused.dataset[name] !== undefined);
  return key === undefined
    ? undefined
    : `${focused.localName}[data-${key}="${CSS.escape(focused.dataset[key] ?? '')}"]`;
}
// The scale a sheet draws at: its own px are the screen's over this.
const zoomOf = (sheet: HTMLElement) => parseFloat(getComputedStyle(sheet).zoom) || 1;
// Puts the strip of days at `left`, unless it reads within a pixel of it already. WebKit reads a
// strip in a zoomed sheet a pixel on from where it stands near its start, so writing back what was
// read would move it that pixel, and on again each time the sheet is drawn.
function moveStrip(strip: HTMLElement, left: number) {
  if (Math.abs(strip.scrollLeft - left) >= 1) strip.scrollLeft = left;
}
export class DetailSheets {
  readonly card: SheetHost;
  detail: DetailSheet | undefined;
  // The map docked beside the page, in a sheet of its own, which stays while other tiles open theirs.
  dock: DetailSheet | undefined;
  // What they ask for beyond the forecast.
  readonly history: SheetHistory;
  constructor(card: SheetHost) {
    this.card = card;
    this.history = new SheetHistory(card, this);
  }
  open(id: SheetId, anchor: HTMLElement, day?: string, variant = 'temperature') {
    const docking = id === 'map' && (this.dock?.dialog.open === true || this.canDock());
    if (docking) this.dock ??= this.make(id, anchor);
    else this.detail ??= this.make(id, anchor);
    const detail = docking ? this.dock : this.detail;
    if (!detail) return;
    const { dialog } = detail;
    if (id === 'map' && !(dialog.open && detail.id === 'map')) this.card.maps.opening();
    const opened = dialog.open;
    if (detail.closing) this.settle(detail);
    Object.assign(detail, {
      id,
      anchor,
      day,
      variant,
      month: 0,
      moonOffset: 0,
      reach: null,
      drawnFrom: '',
      seen: undefined,
      heading: undefined,
    });
    let grow: DOMRect | undefined;
    if (opened) {
      // The docked map, asked for again.
    } else if (docking) {
      grow = anchor.getBoundingClientRect();
      this.dockBeside(dialog);
      dialog.show();
    } else {
      dialog.toggleAttribute('data-bottom', this.fromFoot(detail));
      dialog.toggleAttribute('data-full', this.fullScreen(detail));
      if ('closedBy' in HTMLDialogElement.prototype) dialog.setAttribute('closedby', 'any');
      dialog.showModal();
    }
    this.scrollContent(detail, 0);
    dialog.removeAttribute('data-scrolled');
    if (!opened) dialog.removeAttribute('data-touched');
    this.render(detail);
    if (grow) this.growDock(grow);
    else if (!opened) this.rise(detail);
    addEventListener('resize', detail.resized);
    // A page scrolling on the document runs on behind a modal sheet, so the sheet goes with its tile.
    addEventListener('scroll', detail.followed, true);
    if (!docking) void this.history.loadHistory();
  }
  // A sheet's dialog, with what it answers: picking a day, a tab or a month, closing, and reading
  // its charts.
  make(id: SheetId, anchor: HTMLElement): DetailSheet {
    const { card } = this,
      dialog = document.createElement('dialog');
    dialog.className = 'detail';
    dialog.innerHTML =
      '<div class="sheet-glass"></div><div class="sheet-hold"><div class="sheet"></div></div><header class="sheet-band" aria-hidden="true"></header><i class="sheet-edge"></i>';
    const created: DetailSheet = {
      dialog,
      sheet: child(dialog, '.sheet'),
      glass: child(dialog, '.sheet-glass'),
      band: child(dialog, '.sheet-band'),
      edge: child(dialog, '.sheet-edge'),
      // The sheet's own scrolling, from the foot, isn't the page's.
      followed: ({ target }) => {
        if (target !== dialog) this.place(created, true);
      },
      // A change of size closes a sheet, as what it points at may be anywhere now. The map holds
      // the middle of the screen, or the dock, wherever that goes.
      resized: () => {
        if (created.id === 'map') this.place(created);
        else this.close(created);
      },
      id,
      anchor,
      seen: undefined,
      outline: '',
      day: undefined,
      variant: 'temperature',
      month: 0,
      moonOffset: 0,
      days: [],
      history: undefined,
      historyKey: undefined,
      reach: null,
      drawnFrom: '',
      gliding: 0,
      // Hover a chart, or press and drag, to read it at any moment.
      reader: scrubCharts(dialog, {
        clock: time => {
          const ctx = card.update?.ctx;
          return ctx ? clockOf(ctx)(time) : '';
        },
        step: () => haptic(card, 'selection'),
        turned: (strip, page, speed) => this.turnTo(created, strip, page, speed),
        // On its way out, thrown or closed, its charts are only passing under the finger.
        keeps: () => !created.closing,
      }),
      heading: undefined,
      sliding: 0,
      owed: false,
      closing: false,
      motion: [],
      returning: undefined,
      held: false,
    };
    // The title's band shows once something has passed under it.
    const banded = () => dialog.toggleAttribute('data-scrolled', this.scrolledBy(created) >= SCROLLED);
    let settling = 0;
    for (const scroller of [created.sheet, dialog])
      scroller.addEventListener(
        'scroll',
        ({ target }) => {
          if (target !== scroller) return;
          banded();
          clearTimeout(settling);
          settling = window.setTimeout(banded, SETTLED);
        },
        { passive: true },
      );
    // Its charts' pages don't bubble their scrolling up to here, but it can be caught on the way down.
    created.sheet.addEventListener(
      'scroll',
      ({ target }) => {
        if (target instanceof HTMLElement && target.matches('.chart-pages')) this.pagesMoved(created, target);
      },
      { capture: true, passive: true },
    );
    // A hand on the pages takes over from a day picked, and the sheet goes with where they are (see
    // pagesMoved). A wheel going down the sheet is only passing over them.
    for (const type of ['wheel', 'touchstart', 'keydown'] as const)
      created.sheet.addEventListener(
        type,
        event => {
          const { target } = event,
            strip = target instanceof Element ? target.closest<HTMLElement>('.chart-pages') : null;
          if (!strip || created.heading === undefined) return;
          if (event instanceof WheelEvent && Math.abs(event.deltaY) >= Math.abs(event.deltaX)) return;
          this.pagesStopped(created);
          this.drawOwed(created);
          this.pagesMoved(created, strip);
        },
        { capture: true, passive: true },
      );
    // Snapping that comes back under a scroll already going can leave them between pages. Pages a
    // finger holds are let go by it (see turnTo).
    created.sheet.addEventListener(
      'scrollend',
      ({ target }) => {
        if (
          !(target instanceof HTMLElement) ||
          !target.matches('.chart-pages') ||
          created.heading !== undefined ||
          target.hasAttribute('data-sliding')
        )
          return;
        const nearest = Math.round(target.scrollLeft / target.clientWidth);
        if (Math.abs(nearest * target.clientWidth - target.scrollLeft) > 1) this.slidePages(created, target, nearest);
      },
      { capture: true, passive: true },
    );
    pullToClose(dialog, {
      active: () => dialog.open && 'bottom' in dialog.dataset && !created.closing,
      began: () => {
        created.reader.drop();
      },
      // Drawn down, it moves as a whole, on nothing that eases it, so its content holds still.
      moved: y => {
        dialog.style.translate = `0 ${y}px`;
      },
      released: (by, go, speed) => {
        if (go) this.thrown(created, speed, Math.max(0, dialog.clientHeight - by));
        else this.back(created, by, speed, true);
      },
      grabbed: () => this.grabbed(created),
      thrown: (speed, from) => {
        this.thrown(created, speed, from, true);
      },
      back: (by, speed) => {
        this.back(created, by, speed);
      },
      caught: () => {
        this.caught(created);
      },
      gone: () => {
        this.gone(created);
      },
    });
    // Once a finger, the mouse or a key has touched it, the date's arrows show (see the styles).
    for (const type of ['pointerdown', 'keydown'] as const)
      dialog.addEventListener(type, () => {
        dialog.toggleAttribute('data-touched', true);
      });
    // From the foot, its close button is pressed for as long as a finger or the mouse holds it down,
    // its light standing where the finger is (see the styles).
    dialog.style.setProperty('--close-swell', CLOSE_PRESS.swell);
    dialog.style.setProperty('--close-settle', CLOSE_PRESS.settle);
    dialog.addEventListener('pointerdown', down => {
      const { target } = down,
        button = target instanceof Element ? target.closest<HTMLElement>('.sheet>header>[data-close]') : null;
      if (!button || !('bottom' in dialog.dataset)) return;
      const light = ({ clientX, clientY }: PointerEvent) => {
        const box = button.getBoundingClientRect();
        if (!box.width) return;
        button.style.setProperty('--light-x', `${((clientX - box.left) / box.width) * PERCENT}%`);
        button.style.setProperty('--light-y', `${((clientY - box.top) / box.height) * PERCENT}%`);
      };
      light(down);
      button.toggleAttribute('data-pressed', true);
      const up = () => {
        button.removeAttribute('data-pressed');
        removeEventListener('pointermove', light);
        removeEventListener('pointerup', up);
        removeEventListener('pointercancel', up);
      };
      addEventListener('pointermove', light);
      addEventListener('pointerup', up);
      addEventListener('pointercancel', up);
    });
    // A backdrop press while a menu is open dismisses only that menu. Decide before its
    // pointer handler closes it; the browser checks the dialog policy when the press ends.
    if ('closedBy' in HTMLDialogElement.prototype) {
      dialog.addEventListener(
        'pointerdown',
        event => {
          if (event.target !== dialog || 'docked' in dialog.dataset) return;
          const menu = dialog.querySelector('[aria-haspopup="menu"][aria-expanded="true"]');
          dialog.setAttribute('closedby', menu ? 'closerequest' : 'any');
        },
        true,
      );
    } else {
      // The dock has no backdrop. Older browsers need both ends of a press to land outside:
      // dragging out of the sheet also delivers a click to the dialog.
      let pressedBackdrop = false;
      dialog.addEventListener('pointerdown', event => {
        pressedBackdrop = event.target === dialog;
      });
      dialog.addEventListener('click', event => {
        if (pressedBackdrop && event.target === dialog && !('docked' in dialog.dataset)) this.close(created);
      });
    }
    // From the foot, a sheet of a day's readings turns to another from its menu.
    bindSwitcher(dialog, {
      still: () => card.motion?.matches === true,
      opened: () => {
        haptic(card, 'light');
      },
      chosen: picked => {
        const id = SWITCHABLE.find(each => each === picked);
        if (id) this.switchTo(created, id);
      },
      ticked: () => {
        haptic(card, 'selection', 'moon');
      },
    });
    // Its options pick the units its readings are shown in.
    bindOptions(dialog, {
      still: () => card.motion?.matches === true,
      opened: () => {
        haptic(card, 'light');
      },
      pick: (kind, unit) => {
        haptic(card, 'selection');
        card.units.pick(kind, unit);
      },
      ticked: () => {
        haptic(card, 'selection', 'moon');
      },
    });
    dialog.addEventListener('click', event => {
      const button = targetOf(
        event,
        'button[data-day],button[data-step],button[data-close],button[data-variant],button[data-month],button[data-hours]',
      );
      if (!button) return;
      const { month, variant, hours } = button.dataset;
      // A day in the moon calendar: the timeline moves to its noon.
      if (hours) {
        created.moonOffset = Number(hours) * HOUR;
        haptic(card, 'selection');
        this.render(created);
        return;
      }
      if (month) {
        created.month += Number(month);
        haptic(card, 'selection');
        this.render(created);
        return;
      }
      if (variant) {
        created.variant = variant;
        haptic(card, 'selection');
        this.render(created);
        return;
      }
      if (button.dataset['close'] !== undefined) {
        this.close(created);
        return;
      }
      const { day, step } = button.dataset;
      if (step) {
        this.stepDay(created, Number(step));
        return;
      }
      created.day = day;
      haptic(card, 'selection');
      this.render(created);
    });
    // Docked, Escape closes it too, as it does a sheet over the page.
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !('docked' in dialog.dataset)) return;
      event.preventDefault();
      this.close(created);
    });
    // Escape takes a sheet over the page out the way a press outside it does.
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      this.close(created);
    });
    dialog.addEventListener('close', () => {
      // A sheet that showed the map takes the map's state with it; the dock, the page's room.
      if (created.id === 'map') card.maps.reset();
      if (created === this.dock) this.undock();
      // Opened again meanwhile, as another sheet, it keeps its own listeners and focus.
      if (dialog.open) return;
      this.settle(created);
      if ('bottom' in dialog.dataset) this.landed(created);
      removeEventListener('resize', created.resized);
      removeEventListener('scroll', created.followed, true);
      this.anchorOf(created).focus({ preventScroll: true });
    });
    card.root.append(dialog);
    return created;
  }
  // The day `by` days on from the one chosen, or the nearest there is.
  stepDay(detail: DetailSheet, by: number) {
    const { days } = detail,
      index = days.findIndex(item => item.key === detail.day);
    detail.day = days[Math.max(0, Math.min(days.length - 1, index + by))]?.key;
    haptic(this.card, 'selection');
    this.render(detail);
  }
  // The map's sheet drawn again, for what is chosen in it.
  renderMap(): HTMLElement | undefined {
    const sheet = this.mapSheet();
    this.render(sheet);
    return sheet?.sheet;
  }
  // The open sheet that shows the map: the dock, or a sheet over the page.
  mapSheet(): DetailSheet | undefined {
    return this.dock?.dialog.open ? this.dock : this.detail;
  }
  // A unit picked from a sheet's options: what the open sheets hold in the unit before, their charts'
  // scales and the readings asked for, is worked out again.
  unitsPicked() {
    for (const sheet of [this.detail, this.dock])
      if (sheet) Object.assign(sheet, { reach: null, history: undefined, historyKey: undefined });
  }
  // Every open sheet, drawn again.
  renderAll() {
    for (const sheet of [this.detail, this.dock]) if (sheet?.dialog.open) this.render(sheet);
  }
  render(detail = this.detail) {
    const { card } = this,
      ctx = card.update?.ctx;
    if (!detail || !ctx) return;
    // Its day is drawn now, whatever was owed (see turnTo).
    detail.owed = false;
    const days = sheetDays(ctx, detail.history);
    detail.days = days;
    if (!days.some(day => day.key === detail.day)) detail.day = days.find(day => day.today)?.key;
    const sheetCard = SHEET_CARDS[detail.id];
    // Worked out once the forecast has hours and held from there until the sheet closes, so that
    // history answering late, or a new forecast, can't move an axis.
    if (!ctx.hourly.length) detail.reach = null;
    if (sheetCard.series) detail.reach ??= seriesReach(sheetCard.series, { ...ctx, history: detail.history });
    detail.dialog.setAttribute('aria-label', sheetCard.named?.(ctx, card.maps.layer) ?? say(sheetCard.title));
    detail.dialog.dataset['id'] = detail.id;
    // With nothing new to show it's left as it is, so a chart being read isn't put away. Drawn
    // again, it stays scrolled where it was.
    // Drop a band from another source, date, zone, or unit before using it in the chart.
    void this.history.loadDayBand();
    const shown = days.find(day => day.key === detail.day),
      markup = this.markup(detail, shown, days);
    // What it showed has gone, as the next hour's rain does: it stays as it was until it's closed.
    if (!markup && detail.drawnFrom) return;
    const drawnFrom = `${markup}${JSON.stringify(sheetCard.redrawnBy?.(ctx, card.maps.layer))}`,
      top = this.scrolledBy(detail);
    if (detail.dialog.open && drawnFrom === detail.drawnFrom) {
      // The map draws itself again when what it shows has changed: its markup doesn't say.
      if (detail.id === 'map') card.maps.draw();
      return;
    }
    // Drawn again, its tabs and days start over: where they were goes across to the new ones.
    const before = detail.drawnFrom ? heldBy(detail.sheet) : undefined,
      focused = focusedControl(detail.sheet);
    detail.drawnFrom = drawnFrom;
    detail.reader.clear();
    let stayed = false;
    if (before) stayed = drawKeepingPages(detail.sheet, markup);
    else detail.sheet.innerHTML = markup;
    detail.band.innerHTML = detail.sheet.querySelector(':scope > header')?.innerHTML ?? '';
    detail.band.querySelector('button')?.setAttribute('tabindex', '-1');
    if (detail.dialog.open) this.place(detail);
    this.scrollContent(detail, top);
    this.carryOver(detail, before);
    this.slide(detail, stayed);
    if (focused) {
      const control =
        [...detail.sheet.querySelectorAll<HTMLElement>(`${focused}:not(:disabled)`)].find(
          node => !node.closest('[inert]'),
        ) ?? detail.sheet.querySelector<HTMLElement>('.detail-days [aria-pressed=true]');
      control?.focus({ preventScroll: true });
    }
    card.drawMoons();
    card.maps.draw();
    bindMoonTimeline(detail, card);
  }
  // Its tabs' thumb slides from where it was, and the strip of days stays where it was and moves
  // the least that shows the day chosen, on its own: scrolling to the day would take the sheet and
  // the page with it.
  carryOver(detail: DetailSheet, before: Held | undefined) {
    const { sheet } = detail,
      still = this.card.motion?.matches,
      strip = sheet.querySelector<HTMLElement>('.detail-days'),
      day = strip?.querySelector<HTMLElement>('[aria-pressed=true]'),
      thumb = sheet.querySelector('.segmented .thumb');
    if (strip && day) {
      if (before?.strip !== undefined) moveStrip(strip, before.strip);
      // The first and last days have the strip's own ends beyond them.
      const start = day.previousElementSibling ? day.offsetLeft : 0,
        end = day.nextElementSibling ? day.offsetLeft + day.offsetWidth : strip.scrollWidth,
        left = Math.max(end - strip.clientWidth, Math.min(start, strip.scrollLeft));
      if (before && !still) this.glide(detail, strip, left);
      else moveStrip(strip, left);
    }
    if (!thumb || before?.thumb === undefined || still) return;
    const moved = (before.thumb - thumb.getBoundingClientRect().left) / zoomOf(sheet);
    if (moved) thumb.animate([{ translate: `${moved}px` }, { translate: '0' }], SLIDING);
  }
  // The page of the day chosen comes into view, in a slide if it was drawn already: a day picked
  // takes the pages there, past any between, while one reached by sliding the pages is there
  // already. A first drawing is simply in place.
  slide(detail: DetailSheet, stayed: boolean) {
    const strip = stripOf(detail.sheet),
      index = detail.days.findIndex(item => item.key === detail.day);
    if (!strip || index < 0) return;
    for (const page of strip.querySelectorAll<HTMLElement>('.chart-page'))
      page.inert = page.dataset['day'] !== detail.day;
    if (!strip.clientWidth) return;
    const at = detail.heading ?? Math.round(strip.scrollLeft / strip.clientWidth);
    if (!stayed) {
      this.pagesStopped(detail);
      strip.scrollLeft = index * strip.clientWidth;
    } else if (at !== index) this.slidePages(detail, strip, index);
  }
  // Pages slide to `index`: eased, for a day picked, or let go of at `speed`, settling from it.
  slidePages(detail: DetailSheet, strip: HTMLElement, index: number, speed?: number) {
    const left = index * strip.clientWidth,
      there = () => {
        this.pagesStopped(detail);
        this.drawOwed(detail);
      };
    this.pagesStopped(detail);
    if (this.card.motion?.matches) {
      strip.scrollLeft = left;
      there();
      return;
    }
    detail.heading = index;
    // Snapping would take each step of the way back to a page.
    strip.toggleAttribute('data-sliding', true);
    const asked = (frame: number) => {
      detail.sliding = frame;
    };
    if (speed === undefined)
      easeAcross(strip, left, GLIDE * Math.sqrt(Math.abs(left - strip.scrollLeft) / strip.clientWidth), asked, there);
    else settleAcross(strip, left, speed, asked, there);
  }
  // A finger let go of the pages it was turning, for `page`, at `speed`: they go on there, and the
  // sheet takes its day as it does a day picked. Pulled only a little way, they go back, and the day
  // stands. The day is drawn once they're there, as drawing it on the way would hold a frame up.
  turnTo(detail: DetailSheet, strip: HTMLElement, page: number, speed: number) {
    const day = detail.days[page];
    if (day && day.key !== detail.day) {
      detail.day = day.key;
      detail.owed = true;
      haptic(this.card, 'selection');
    }
    this.slidePages(detail, strip, page, speed);
  }
  drawOwed(detail: DetailSheet) {
    if (!detail.owed) return;
    detail.owed = false;
    if (detail.dialog.open) this.render(detail);
  }
  pagesStopped(detail: DetailSheet) {
    cancelAnimationFrame(detail.sliding);
    detail.heading = undefined;
    stripOf(detail.sheet)?.removeAttribute('data-sliding');
  }
  // Pages sliding by themselves, by a trackpad or the keyboard, take the sheet to the day past half
  // way across it, and it follows at once. While a day picked takes them there they say nothing of the
  // days on the way, and that day stands. Only a hand on them takes over (see make). Pages a finger
  // turns wait to be let go (see turnTo).
  pagesMoved(detail: DetailSheet, strip: HTMLElement) {
    if (detail.heading !== undefined || strip.hasAttribute('data-sliding')) return;
    const day = detail.days[Math.round(strip.scrollLeft / strip.clientWidth)];
    if (!day || day.key === detail.day || !detail.dialog.open) return;
    detail.day = day.key;
    haptic(this.card, 'selection');
    this.render(detail);
  }
  glide(detail: DetailSheet, strip: HTMLElement, left: number) {
    cancelAnimationFrame(detail.gliding);
    if (Math.abs(left - strip.scrollLeft) >= 1)
      easeAcross(strip, left, GLIDE, frame => {
        detail.gliding = frame;
      });
  }
  markup(detail: DetailSheet, day: DetailDay | undefined, days: DetailDay[]): string {
    const { card } = this,
      update = card.update;
    if (!update) return '';
    const { sheet, title, units = [] } = SHEET_CARDS[detail.id],
      options = optionsMarkup(typeof units === 'function' ? units(detail.variant) : units, card.units);
    const drawn = sheet({
      ctx: update.ctx,
      title: say(title),
      day,
      days,
      variant: detail.variant,
      month: detail.month,
      moonOffset: detail.moonOffset,
      history: detail.history,
      reach: detail.reach,
      canAsk: update.hass?.callWS !== undefined,
      dayBand: this.history.dayBand?.band,
      alerts: update.alerts,
      nextHour: update.nextHour.data,
      named: update.named,
      nowName: update.conditionText,
      nowSky: update.sky,
      mapLayer: card.maps.layer,
      switcher: this.switcher(detail, update.ctx),
    });
    // Its options come last, under whatever it shows.
    return drawn ? keepLastWords(`${drawn}${options}`) : '';
  }
  // From the foot, a sheet of a day's readings offers those of the others with something to show,
  // in a menu (see switcher.ts).
  switcher(detail: DetailSheet, ctx: TileContext): string {
    if (!('bottom' in detail.dialog.dataset) || !SWITCHABLE.includes(detail.id)) return '';
    const choices = SWITCHABLE.flatMap((id): SheetChoice[] => {
      const { title, series, glyph = '', shows = [] } = SHEET_CARDS[id];
      return id === detail.id || !series || seriesReach(series, { ...ctx, history: detail.history })
        ? [{ id, title: say(title), glyph, shows: shows.map(each => say(each)).join(' · ') }]
        : [];
    });
    return switcherMarkup(say('Weather details'), detail.id, choices);
  }
  // A sheet from the foot turned to another from its menu: on the same day, on its first tab and
  // from the top of its content, with the focus on the menu's button. It goes back to the other's
  // tile, where there is one.
  switchTo(detail: DetailSheet, id: SheetId) {
    if (id === detail.id || !detail.dialog.open || detail.closing) return;
    haptic(this.card, 'selection');
    Object.assign(detail, { id, variant: 'temperature', reach: null, drawnFrom: '' });
    detail.anchor = this.card.root.querySelector<HTMLElement>(`.tile[data-tile="${id}"]`) ?? detail.anchor;
    detail.seen = undefined;
    this.pagesStopped(detail);
    this.scrollContent(detail, 0);
    this.render(detail);
    detail.sheet.querySelector<HTMLElement>('[data-switch]')?.focus({ preventScroll: true });
  }
  // Whether this one comes up from the foot of the screen. The map doesn't, as a drag there moves it.
  fromFoot(detail: DetailSheet) {
    return detail.id !== 'map' && this.sheetsHere();
  }
  // Where other sheets come from the foot, the map takes the whole screen.
  fullScreen(detail: DetailSheet) {
    return detail.id === 'map' && this.sheetsHere();
  }
  // Whether sheets come from the foot here, by the card's setting and the screen.
  sheetsHere() {
    const style = this.card.config?.sheet_style ?? 'auto';
    return style === 'sheet' || (style === 'auto' && isCompact());
  }
  // How far a sheet's content is scrolled, and scrolling it there: from the foot the dialog scrolls
  // it, past the sheet's place (see the styles), and a popover scrolls its own.
  scrolledBy({ dialog, sheet }: DetailSheet) {
    return 'bottom' in dialog.dataset ? pastPlace(dialog) : sheet.scrollTop;
  }
  scrollContent({ dialog, sheet }: DetailSheet, top: number) {
    if ('bottom' in dialog.dataset) dialog.scrollTop = dialog.clientHeight + top;
    else sheet.scrollTop = top;
  }
  // A sheet going down off the screen.
  sink(detail: DetailSheet) {
    const { dialog } = detail;
    dialog.toggleAttribute('data-sinking', true);
    this.leave(detail, dialog.getAnimations());
  }
  // Let go on its way out, going `speed` px a ms, `left` px short of out of sight, it goes the rest
  // of the way by itself (see `RELEASE` and the styles), from wherever it is drawn, setting off as
  // fast as it was going. Pulled by its scroll, the scroll is `coasting` on under it, carrying it
  // on as it was going, so it sets off from rest on top of that. Nothing can take it back on the
  // way, and it closes once it is out of sight.
  thrown(detail: DetailSheet, speed: number, left: number, coasting = false) {
    const { dialog } = detail;
    if (!dialog.open || detail.closing) return;
    if (this.card.motion?.matches) {
      this.close(detail);
      return;
    }
    dialog.style.setProperty('--thrown-by', `${left}px`);
    dialog.style.setProperty('--thrown-after', `${SHOWN}ms`);
    if (springs()) {
      const { points, ms } = thrownCurve(left, speed, coasting ? 0 : speed);
      dialog.style.setProperty('--thrown-in', `${ms}ms`);
      dialog.style.setProperty('--thrown-ease', `linear(${points.join(', ')})`);
    } else {
      const time = speed > 0 ? (RELEASE.slope * left) / speed : RELEASE.most;
      dialog.style.setProperty('--thrown-in', `${Math.round(Math.min(RELEASE.most, Math.max(RELEASE.least, time)))}ms`);
    }
    dialog.toggleAttribute('data-thrown', true);
    this.leave(detail, dialog.getAnimations());
  }
  // Let go `by` px below its place, short of going, still going down `speed` px a ms, it goes back
  // up to it on its own spring, drawn from where it was. Pulled by its scroll, the scroll is already
  // back (see pullToClose); drawn down, it is `held`, its content where it was.
  back(detail: DetailSheet, by: number, speed = 0, held = false) {
    detail.returning?.cancel();
    detail.returning = undefined;
    detail.held = held;
    detail.dialog.style.translate = '';
    if (this.card.motion?.matches || by < 1) return;
    // Drawn down, nothing carries it on while the page sets it going, so it waits to be shown
    // setting off, as a sheet thrown out does (see RELEASE).
    const { points, ms } = backCurve(by, speed),
      timing = { delay: held ? SHOWN : 0, fill: 'backwards' } as const;
    detail.returning = detail.dialog.animate(
      [{ transform: `translateY(${by}px)` }, { transform: 'none' }],
      springs()
        ? { ...timing, duration: ms, easing: `linear(${points.join(', ')})` }
        : { ...timing, duration: RELEASE.most, easing: SLIDES },
    );
  }
  // How far below its place it is drawn on its way back, in px, which it stops at.
  stopped({ dialog, returning }: DetailSheet) {
    const by = new DOMMatrixReadOnly(getComputedStyle(dialog).transform).m42;
    returning?.cancel();
    return by;
  }
  // Caught by a finger on its way back from a pull, it stands where it has got to, as a scroll.
  caught(detail: DetailSheet) {
    if (!detail.returning || detail.held) return;
    const by = this.stopped(detail);
    detail.returning = undefined;
    detail.dialog.scrollTop -= by;
  }
  // Caught on its way back from being drawn down, by what draws it, it stands where it has got to,
  // drawn there, and says how far below its place that is, in px.
  grabbed(detail: DetailSheet) {
    if (!detail.returning || !detail.held) return 0;
    const by = this.stopped(detail);
    detail.returning = undefined;
    detail.dialog.style.translate = `0 ${by}px`;
    return by;
  }
  // Thrown out of sight by a finger, it has gone. Where the dimming behind it has gone with it (see
  // the styles) that's all; elsewhere the dimming fades as it would.
  gone(detail: DetailSheet) {
    if (!detail.dialog.open || detail.closing) return;
    if (!CSS.supports('animation-timeline', 'view()')) {
      this.close(detail);
      return;
    }
    this.settle(detail);
    detail.dialog.close();
  }
  // It has gone.
  landed({ dialog }: DetailSheet) {
    dialog.removeAttribute('data-bottom');
  }
  // A sheet opens out of its tail: the glass, what's on it and what's round it, each as one.
  rise(detail: DetailSheet) {
    if (this.card.motion?.matches || detail.dialog.dataset['side'] === 'sheet') return;
    const { from, duration, easing, fade } = OPENING;
    detail.motion = [detail.glass, detail.sheet, detail.edge].flatMap(part => [
      part.animate([{ transform: `scale(${from})` }, { transform: 'none' }], { duration, easing }),
      part.animate([{ opacity: 0 }, { opacity: 1 }], { duration: fade }),
    ]);
  }
  // The docked map grows out of its tile (`from`, where it was before the page made room): its
  // panel, covered at first, from the tile's place to its own, slowing as it lands, and the map
  // coming up in it then (the cover is the sheet's own, as its content is drawn again whenever
  // the page is); the page, laid out again for the room left, fades back in meanwhile.
  growDock(from: DOMRect) {
    const detail = this.dock,
      to = detail?.sheet.getBoundingClientRect();
    if (!detail || !to || to.width === 0 || to.height === 0 || this.card.motion?.matches) return;
    const { sheet } = detail;
    detail.motion = [
      sheet.animate([{ transform: towards(to, from) }, { transform: 'none' }], {
        duration: DOCKING.grow,
        easing: DOCKING.landing,
      }),
      sheet.animate([{ opacity: 1 }, { opacity: 0 }], {
        pseudoElement: '::after',
        duration: DOCKING.content,
        delay: DOCKING.grow - DOCKING.content / 2,
        easing: 'ease-out',
        fill: 'backwards',
      }),
    ];
    this.fadePage(DOCKING.grow - DOCKING.page);
  }
  // Closes the sheet: it fades where it is. Docked, the map shrinks back into its tile, fading as
  // it goes, while the page goes back to its full width and fades back in.
  close(detail = this.detail) {
    if (!detail?.dialog.open || detail.closing) return;
    const { card } = this,
      { dialog, sheet } = detail,
      anchor = this.anchorOf(detail),
      from = sheet.getBoundingClientRect();
    this.settle(detail);
    if (card.motion?.matches || !from.width) {
      dialog.close();
      return;
    }
    if ('bottom' in dialog.dataset) {
      this.sink(detail);
      return;
    }
    if (!('docked' in dialog.dataset)) {
      this.fade(detail);
      return;
    }
    // The page takes its full width at once; the map, still beside it, goes.
    card.removeAttribute('data-docked');
    card.toggleAttribute('data-undocking', true);
    const to = anchor.isConnected ? anchor.getBoundingClientRect() : from;
    const shrink = sheet.animate([{ transform: 'none' }, { transform: towards(from, to), opacity: 0 }], {
      duration: DOCKING.shrink,
      easing: DOCKING.leaving,
      fill: 'forwards',
    });
    this.fadePage(0);
    this.leave(detail, [shrink]);
  }
  // A sheet over the page fades, its parts one by one: an opacity on anything holding the glass
  // would blind it. The band's glass goes on its own for the same reason.
  fade(detail: DetailSheet) {
    const { glass, sheet, edge, band } = detail,
      gone = { opacity: 0 };
    this.leave(detail, [
      ...[glass, sheet, edge, ...band.children].map(part => part.animate(gone, CLOSING)),
      band.animate(gone, { ...CLOSING, pseudoElement: '::before' }),
    ]);
  }
  // Once `motion` ends it's closed.
  leave(detail: DetailSheet, motion: Animation[]) {
    detail.closing = true;
    detail.motion = motion;
    const closed = () => {
      if (detail.motion !== motion) return;
      this.settle(detail);
      detail.dialog.close();
    };
    void Promise.all(motion.map(animation => animation.finished)).then(closed, closed);
  }
  // Its animations over, and its parts set back for the next time.
  settle(detail: DetailSheet) {
    detail.closing = false;
    detail.dialog.removeAttribute('data-sinking');
    detail.dialog.removeAttribute('data-thrown');
    detail.dialog.style.translate = '';
    detail.returning?.cancel();
    detail.returning = undefined;
    for (const animation of detail.motion) animation.cancel();
    detail.motion = [];
  }
  // The page's panels fade back in, after `delay` ms, as they take their new places.
  fadePage(delay: number) {
    for (const panel of this.card.root.querySelectorAll('.frame :is(.alert,.next-hour,.forecast,.daily,.tile)'))
      panel.animate([{ opacity: DOCKING.faded }, { opacity: 1 }], {
        duration: DOCKING.page,
        delay,
        easing: 'ease-out',
        fill: 'backwards',
      });
  }
  // Whether the map docks beside the page rather than opening over it: on a page given its
  // height (which scrolls in place), wide enough that what it leaves the page still holds
  // three columns of tiles.
  canDock(): boolean {
    const { card } = this;
    if (card.config?.weather_layout !== 'page' || !(card.hasAttribute('data-panel') || card.hasAttribute('data-grid')))
      return false;
    return (card.getBoundingClientRect().width / card.measureZoom()) * (1 - DOCK.share) >= DOCK.least;
  }
  // Docks `dialog` beside the page, which runs on behind it (see the styles).
  dockBeside(dialog: HTMLDialogElement) {
    dialog.dataset['docked'] = '';
    this.card.toggleAttribute('data-docked', true);
  }
  undock() {
    this.dock?.dialog.removeAttribute('data-docked');
    this.card.removeAttribute('data-docked');
    this.card.removeAttribute('data-undocking');
  }
  // What a sheet points at. The tiles are replaced whenever one of them changes, the days with their
  // list and the alerts with theirs, so it may be the one drawn in its place since the sheet opened.
  anchorOf(detail: DetailSheet): HTMLElement {
    if (!detail.anchor.isConnected) {
      const { tile, key, index = '' } = detail.anchor.dataset,
        again = this.card.root.querySelector<HTMLElement>(
          tile
            ? `.tile[data-tile="${tile}"]`
            : key
              ? `.day[data-key="${key}"]`
              : `.alert button[data-index="${index}"]`,
        );
      if (again) detail.anchor = again;
    }
    return detail.anchor;
  }
  // Where a sheet's anchor lies: its box at rest, taken as the sheet opens, and again only as the
  // page scrolls behind it, so nothing drawn while it's open can move it. A tile taken away, a row
  // whose day has gone or a panel that hid leaves it where it last was.
  seen(detail: DetailSheet, scrolled: boolean): AnchorRect | undefined {
    const anchor = this.anchorOf(detail);
    if (anchor.isConnected && (scrolled || !detail.seen)) {
      const box = restingBox(anchor);
      if (box.width && box.height) detail.seen = box;
    }
    return detail.seen;
  }
  // Placed by placePopover: the first side it fits on, else shortened on the roomiest
  // side, else a bottom sheet. It closes once its tile has scrolled off screen.
  place(detail = this.detail, scrolled = false) {
    if (!detail?.dialog.open) return;
    const { dialog, sheet, glass, edge } = detail,
      top = sheet.scrollTop;
    dialog.style.maxHeight = '';
    // The map opens large, docked beside the page (see dockBeside), or in the middle of the screen.
    if (detail.id === 'map') {
      dialog.dataset['side'] = 'sheet';
      const docked = 'docked' in dialog.dataset;
      dialog.style.left = docked ? '' : `${Math.round((innerWidth - dialog.offsetWidth) / 2)}px`;
      dialog.style.top = docked ? '' : `${Math.round((innerHeight - dialog.offsetHeight) / 2)}px`;
      return;
    }
    // From the foot of the screen it fills the width, drawn to fit, and has no tail.
    if ('bottom' in dialog.dataset) {
      dialog.dataset['side'] = 'sheet';
      dialog.style.left = '';
      dialog.style.top = '';
      dialog.style.setProperty('--sheet-zoom', String(Math.min(innerWidth, FOOT_WIDEST) / OWN_WIDTH));
      glass.style.clipPath = '';
      detail.outline = '';
      return;
    }
    // Beside the docked map, a sheet keeps to the page.
    const dock = this.dock?.dialog.open ? this.dock.sheet.getBoundingClientRect().left : innerWidth,
      // The sheet draws at the page's scale (see the styles), so its own px are the screen's over that.
      scale = zoomOf(sheet);
    const place = placePopover({
      anchor: this.seen(detail, scrolled),
      width: dialog.offsetWidth,
      height: dialog.offsetHeight,
      vw: dock,
      vh: innerHeight,
      gap: SHEET_TAIL.depth * scale + TIP_GAP,
    });
    if (place.side === 'gone') {
      this.close(detail);
      return;
    }
    // A shortened sheet scrolls inside.
    dialog.style.maxHeight = `${Math.floor(place.maxHeight)}px`;
    sheet.scrollTop = top;
    dialog.dataset['side'] = place.side;
    dialog.style.left = `${Math.round(place.left)}px`;
    dialog.style.top = `${Math.round(place.top)}px`;
    const { side, arrowX = 0, arrowY = 0 } = place,
      width = sheet.offsetWidth,
      height = sheet.offsetHeight,
      across = side === 'below' || side === 'above',
      along = (across ? arrowX : arrowY) / scale,
      out = SHEET_TAIL.depth;
    dialog.style.setProperty('--tip-x', `${across ? along : side === 'right' ? -out : width + out}px`);
    dialog.style.setProperty('--tip-y', `${across ? (side === 'below' ? -out : height + out) : along}px`);
    // The glass and its tail are one shape, with one line round both.
    const outline = sheetOutline(side, width, height, along);
    if (outline === detail.outline) return;
    detail.outline = outline;
    glass.style.clipPath = `path('${outline}')`;
    edge.style.setProperty('--outline', sheetEdge(outline, width, height));
  }
}
