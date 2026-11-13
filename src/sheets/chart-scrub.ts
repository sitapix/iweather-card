import { clamp, finite, isList, isRecord } from '../lib/values.ts';
import { onHidden } from '../lib/dom.ts';
import { say } from '../weather/words.ts';
import { PERCENT } from '../lib/html.ts';
import { MINUTE, MINUTES_PER_HOUR } from '../lib/time.ts';
import { CURVES, type Curve, heightAt, type XY } from './curve.ts';

// Reading a chart at any moment: hovering with a mouse, or pressing and dragging with a finger or
// pen, puts a line and a dot on the reading there and labels it with its time and value. A line is
// read by the minute, along the line as drawn, from what its chart lists in `data-line`. Other
// charts list their readings in `data-points` as [left %, top %, label, hour], and are read at the
// nearest. The selection is the sheet's: every chart beside the one under the pointer shows the
// same moment on its own line, and a chart read by the hour shows the hour that moment falls in.
// One with nothing then shows nothing, and so does one marked `data-alone`, which is read only
// under the pointer and lends the charts beside it nothing either.
interface Mark {
  left: number;
  top: number;
  label: string;
  // The minute of the day it stands for, which the charts beside read too, if it has one.
  minute: number | undefined;
  // Which step along the chart it is in, for a tick of feedback as each is passed: the hour, for a
  // line and for a reading that has one, or else the reading itself.
  notch: number;
}
export type ChartMark = readonly [left: number, top: number, label: string, hour?: number];
// A chart, read: at a share of the way across, and at a minute of its day, where it has a reading.
interface Reading {
  near: (share: number) => Mark | undefined;
  at: (minute: number) => Mark | undefined;
}
const marks = new WeakMap<HTMLElement, readonly (Mark & { hour: number | undefined })[]>();
// A reading within 15% of either end keeps its label inside the chart, on that side.
const LABEL_EDGE = 15;
// A finger on a day's chart reads it once held still this many ms. Before then, a move of this many
// px turns the pages under it if it goes more across than down, and gives the press up to a scroll
// if not. A finger on any chart that stays this close to where it landed for this long keeps the
// chart until it lifts: it moves the reading whichever way it goes, and nothing scrolls. That is
// timed by the finger's own moves, so a busy page hearing them late doesn't take one setting off
// for one held.
const HOLD = 100,
  SETS_OFF = 10;
// Let go, the pages carry on at the finger's speed for this many ms, and settle on the page nearest
// there, no further than the next. The speed is read over the last this many ms.
const CARRIES = 300,
  SPEED_OVER = 100;
function marksOf(chart: HTMLElement) {
  const cached = marks.get(chart);
  if (cached) return cached;
  let parsed: unknown;
  try {
    parsed = JSON.parse(chart.dataset['points'] ?? '[]');
  } catch {
    parsed = [];
  }
  const list = isList(parsed)
    ? parsed.flatMap(item => {
        const [left, top, label, hour] = isList(item) ? item : [];
        return finite(left) && finite(top) && typeof label === 'string'
          ? [
              {
                left,
                top,
                label,
                hour: finite(hour) ? hour : undefined,
                minute: finite(hour) ? hour * MINUTES_PER_HOUR : undefined,
                notch: finite(hour) ? Math.floor(hour) : left,
              },
            ]
          : [];
      })
    : [];
  marks.set(chart, list);
  return list;
}
// A chart of readings is read at the one nearest, and at a minute by the hour it falls in.
function markReading(chart: HTMLElement): Reading | undefined {
  const list = marksOf(chart);
  if (!list.length) return undefined;
  return {
    near: share =>
      list.reduce((best, item) =>
        Math.abs(item.left - share * PERCENT) < Math.abs(best.left - share * PERCENT) ? item : best,
      ),
    at: minute => list.find(item => item.hour !== undefined && item.hour === Math.floor(minute / MINUTES_PER_HOUR)),
  };
}

// A line read by the minute: its day's start, how it runs and its places as drawn [hour, top %],
// the minutes it can be read between, and what it reads from each minute it changes, as markup:
// its value's line, and the line under it. Its time is the card's clock's, told by the sheet.
export interface ChartLine {
  start: number;
  curve: Curve;
  places: readonly XY[];
  from: number;
  to: number;
  reads: readonly (readonly [minute: number, label: string])[];
}
const PLACE_DIGITS = 4;
const attribute = (value: unknown): string =>
  JSON.stringify(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
export const lineAttribute = (line: ChartLine): string =>
  attribute({ ...line, places: line.places.map(([hour, top]) => [+hour.toFixed(PLACE_DIGITS), +top.toFixed(2)]) });
// What a line reads from each minute it changes, from one minute to another: tried every half
// hour, and halved down to the minute wherever it changed.
const TRY_EVERY = 30;
export function readsAlong(from: number, to: number, readAt: (minute: number) => string): [number, string][] {
  let shown = readAt(from);
  const reads: [number, string][] = [[from, shown]];
  const split = (start: number, first: string, end: number, last: string) => {
    if (first === last) return;
    if (end - start <= 1) {
      reads.push([end, last]);
      return;
    }
    const middle = Math.floor((start + end) / 2),
      between = readAt(middle);
    split(start, first, middle, between);
    split(middle, between, end, last);
  };
  for (let before = from; before < to; before = Math.min(to, before + TRY_EVERY)) {
    const next = Math.min(to, before + TRY_EVERY),
      label = readAt(next);
    split(before, shown, next, label);
    shown = label;
  }
  return reads;
}
interface Line extends Omit<ChartLine, 'places' | 'reads'> {
  topAt: (hour: number) => number;
  reads: readonly { minute: number; label: string }[];
}
const lines = new WeakMap<HTMLElement, Line | null>();
function lineOf(chart: HTMLElement): Line | null {
  const cached = lines.get(chart);
  if (cached !== undefined) return cached;
  let parsed: unknown;
  try {
    parsed = JSON.parse(chart.dataset['line'] ?? 'null');
  } catch {
    parsed = null;
  }
  const curve = isRecord(parsed) ? CURVES.find(name => name === parsed['curve']) : undefined,
    places =
      isRecord(parsed) && isList(parsed['places'])
        ? parsed['places'].flatMap((place): XY[] => {
            const [hour, top] = isList(place) ? place : [];
            return finite(hour) && finite(top) ? [[hour, top]] : [];
          })
        : [],
    reads =
      isRecord(parsed) && isList(parsed['reads'])
        ? parsed['reads'].flatMap(item => {
            const [minute, label] = isList(item) ? item : [];
            return finite(minute) && typeof label === 'string' ? [{ minute, label }] : [];
          })
        : [];
  const line =
    isRecord(parsed) &&
    curve &&
    finite(parsed['start']) &&
    finite(parsed['from']) &&
    finite(parsed['to']) &&
    places.length &&
    reads.length
      ? {
          start: parsed['start'],
          curve,
          from: parsed['from'],
          to: parsed['to'],
          topAt: heightAt(places, curve),
          reads,
        }
      : null;
  lines.set(chart, line);
  return line;
}
// A line is read at the minute under the pointer, kept to where it has readings, and at a minute
// given it if that is one of them; its time is the clock's at that minute.
function lineReading(chart: HTMLElement, clock: (time: number) => string): Reading | undefined {
  const line = lineOf(chart),
    minutes = Number(chart.dataset['hours']) * MINUTES_PER_HOUR;
  if (!line || !minutes) return undefined;
  const at = (minute: number): Mark | undefined => {
    if (minute < line.from || minute > line.to) return undefined;
    const read = line.reads.findLast(item => item.minute <= minute) ?? line.reads[0];
    return {
      left: (minute / minutes) * PERCENT,
      top: clamp(line.topAt(minute / MINUTES_PER_HOUR), 0, PERCENT),
      label: `${clock(line.start + minute * MINUTE)}\n${read?.label ?? ''}`,
      minute,
      notch: Math.floor(minute / MINUTES_PER_HOUR),
    };
  };
  return { near: share => at(clamp(Math.round(share * minutes), line.from, line.to)), at };
}
const readingOf = (chart: HTMLElement, clock: (time: number) => string): Reading | undefined =>
  lineReading(chart, clock) ?? markReading(chart);

export function timeSelector(from: number, to: number): string {
  return to < from
    ? ''
    : `<input class="chart-time" type="range" min="${from}" max="${to}" value="${from}" aria-label="${say('Time')}">`;
}
// The marks a chart lists, for its markup: [left %, top %, label, hour], escaped for an attribute.
export const pointsAttribute = (list: readonly ChartMark[]): string =>
  attribute(
    list.map(([left, top, label, hour]) => [
      +left.toFixed(2),
      +top.toFixed(2),
      label,
      ...(hour === undefined ? [] : [+hour.toFixed(PLACE_DIGITS)]),
    ]),
  );

// A chart may show its reading in an element beside it instead of in a label on the line: the
// one with the class its `data-readout` names, under what holds the chart or its pages. The
// label's lines go into that element's children, in order, as markup (the chart's own, from its
// readings), centred over the line but kept within the element; putting the reading away puts
// back what it showed. A line's `<i data-icon="n">` takes the chart's nth icon, from its
// `template.chart-icons`. Boxes are measured on screen and placed in the element's own px, which
// differ by any zoom.
const readouts = new WeakMap<HTMLElement, { parts: readonly string[]; height: string }>();
function readoutOf(chart: HTMLElement): HTMLElement | null {
  const name = chart.dataset['readout'],
    home = chart.closest('.chart-pages')?.parentElement ?? chart.parentElement,
    found = name ? home?.querySelector(`.${name}`) : null;
  return found instanceof HTMLElement ? found : null;
}
function showReadout(readout: HTMLElement, chart: HTMLElement, mark: Mark, plot: DOMRect) {
  const parts = [...readout.children],
    lines = mark.label.split('\n');
  // It holds its height while read, so what's below it never moves under the pointer.
  const kept = readouts.get(readout) ?? {
    parts: parts.map(part => part.innerHTML),
    height: getComputedStyle(readout).height,
  };
  readouts.set(readout, kept);
  readout.setAttribute('style', `height:${kept.height}`);
  const icons = chart.querySelector('template.chart-icons');
  lines.forEach((line, i) => {
    const part = parts[i];
    if (!part) return;
    part.innerHTML = line;
    for (const slot of part.querySelectorAll('i[data-icon]')) {
      const icon =
        icons instanceof HTMLTemplateElement ? icons.content.children[Number(slot.getAttribute('data-icon'))] : null;
      if (icon) slot.replaceWith(icon.cloneNode(true));
    }
  });
  readout.dataset['scrubbing'] = '';
  // With nothing under its value, a reading's time is larger.
  readout.toggleAttribute('data-plain', !lines[2]);
  const box = readout.getBoundingClientRect(),
    scale = readout.offsetWidth / box.width || 1,
    half = Math.max(0, ...parts.map(part => part.getBoundingClientRect().width)) / 2,
    at = plot.left - box.left + (mark.left / PERCENT) * plot.width;
  readout.setAttribute(
    'style',
    `height:${kept.height};--centre:${Math.min(box.width - half, Math.max(half, at)) * scale}px`,
  );
}
function hideReadout(readout: HTMLElement) {
  const kept = readouts.get(readout);
  if (kept)
    [...readout.children].forEach((part, i) => {
      part.innerHTML = kept.parts[i] ?? part.innerHTML;
    });
  readouts.delete(readout);
  readout.removeAttribute('style');
  delete readout.dataset['scrubbing'];
  delete readout.dataset['plain'];
}

// Puts a chart's cursor on a mark, and says whether that moved it.
function showMark(chart: HTMLElement, mark: Mark): boolean {
  const at = String(mark.left),
    plot = chart.querySelector<HTMLElement>('.chart-plot');
  if (!plot || (chart.dataset['at'] === at && 'scrubbing' in chart.dataset)) return false;
  // A day's chart keeps it clear of what fades the past (see the styles).
  const holder = chart.querySelector('.chart-marks') ?? plot;
  let cursor = holder.querySelector('.chart-cursor');
  if (!(cursor instanceof HTMLElement)) {
    cursor = document.createElement('span');
    cursor.className = 'chart-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    cursor.innerHTML = '<i></i><b></b>';
    holder.append(cursor);
  }
  if (!(cursor instanceof HTMLElement)) return false;
  // The plot takes the place too, to cut its drawing clear round the cursor (see the styles). They
  // are written as attributes so that taking them off leaves the chart as it was drawn, which the
  // sheet compares it with (see drawKeepingPages): Chromium leaves an empty one behind a script's.
  const place = `--x:${mark.left}%;--y:${mark.top}%`;
  plot.setAttribute('style', place);
  cursor.setAttribute(
    'style',
    `${place};--shift:${mark.left < LABEL_EDGE ? '0%' : mark.left > PERCENT - LABEL_EDGE ? '-100%' : '-50%'}`,
  );
  const label = cursor.querySelector('b'),
    readout = readoutOf(chart);
  if (readout) showReadout(readout, chart, mark, plot.getBoundingClientRect());
  else if (label) label.innerHTML = mark.label.split('\n').filter(Boolean).join(' · ');
  chart.dataset['at'] = at;
  chart.dataset['scrubbing'] = '';
  return true;
}
// Takes a chart's reading away, and every trace of it, so a chart read is a chart as it was drawn.
function hideMark(chart: Element) {
  if (!(chart instanceof HTMLElement)) return;
  const readout = readoutOf(chart);
  if (readout) hideReadout(readout);
  chart.querySelector('.chart-cursor')?.remove();
  chart.querySelector('.chart-plot')?.removeAttribute('style');
  delete chart.dataset['scrubbing'];
  delete chart.dataset['at'];
  delete chart.dataset['kept'];
}

// A chart on pages under way isn't read: a browser tells of a mouse moving when what's under it does.
function sliding(plot: HTMLElement): boolean {
  const pages = plot.closest('.chart-pages');
  if (!(pages instanceof HTMLElement)) return false;
  const { scrollLeft: left, clientWidth: width } = pages;
  return Math.abs(left - Math.round(left / width) * width) > 1;
}
// Every zoom an element is drawn under, from the styles: a box measured on screen would have a sheet's
// growing as it opens in it too.
function zoomUnder(element: Element): number {
  let zoom = 1;
  for (
    let at: Element | null = element;
    at;
    at = at.parentElement ?? (at.parentNode instanceof ShadowRoot ? at.parentNode.host : null)
  )
    zoom *= parseFloat(getComputedStyle(at).zoom) || 1;
  return zoom;
}
const plotOf = (target: EventTarget | null): HTMLElement | null => {
  const plot = target instanceof Element ? target.closest('.chart-plot') : null;
  return plot instanceof HTMLElement ? plot : null;
};

export interface ChartReader {
  // Puts every reading away.
  clear(): void;
  // Puts every reading away and forgets the press, which has been taken for something else.
  drop(): void;
}
// What a sheet does for its charts: `clock` tells a time as the card does, `step` runs as a press or
// drag passes each step along a chart, for a tick of feedback, and `turned` when a finger lets go of
// the pages it was turning, with the page they are to settle on and how fast they were going then,
// in the strip's own px a ms along it. `keeps` says whether a finger held on a chart may keep it
// from scrolling, as it may not on a sheet on its way out.
export interface ChartHooks {
  clock: (time: number) => string;
  step: () => void;
  turned: (strip: HTMLElement, page: number, speed: number) => void;
  keeps: () => boolean;
}
// A finger turning a strip of pages: where it and the strip were as it set off, the strip's own px
// to a px on screen, and where the finger has been lately.
interface Turning {
  strip: HTMLElement;
  x: number;
  left: number;
  scale: number;
  trail: { x: number; time: number }[];
}
// A press on a chart: where and when (`down`) it landed, where it is now (`at`, across), and by what.
// A finger on pages waits to be held still (`waiting`, the timer that ends the wait) or to set off
// across them. A finger is `still` until it sets off before the hold is up.
interface Press {
  id: number;
  plot: HTMLElement;
  x: number;
  y: number;
  down: number;
  at: number;
  kind: string;
  waiting: number | undefined;
  turning: Turning | undefined;
  still: boolean;
}
// Listens on `root` for every chart inside it, including charts drawn later.
export function scrubCharts(root: HTMLElement, { clock, step, turned, keeps }: ChartHooks): ChartReader {
  let held: Press | null = null,
    ignoreHidden = () => {},
    // Where along its day the last move read a chart, and the step it was in.
    last: { chart: HTMLElement; minute: number } | null = null,
    notched: number | undefined;
  const shown = (selector: string) => root.querySelectorAll(`.chart${selector}`);
  const clear = () => {
    for (const chart of shown('[data-scrubbing]')) hideMark(chart);
    last = null;
    notched = undefined;
  };
  const showSelection = (chart: HTMLElement, mark: Mark, kind: string) => {
    const beside = (chart.closest('.chart-page') ?? root).querySelectorAll<HTMLElement>('.chart'),
      alone = (other: HTMLElement) => other.hasAttribute('data-alone');
    let moved = false;
    for (const other of beside) {
      const same =
        other === chart
          ? mark
          : mark.minute === undefined || alone(chart) || alone(other)
            ? undefined
            : readingOf(other, clock)?.at(mark.minute);
      if (!same) hideMark(other);
      else if (showMark(other, same)) moved = true;
    }
    if (moved && mark.notch !== notched && kind !== 'mouse' && kind !== 'keyboard') step();
    notched = mark.notch;
  };
  // The native range supplies arrow, Home and End keys and exposes the same reading to assistive technology.
  const readSelection = ({ target }: Event) => {
    if (!(target instanceof HTMLInputElement) || !target.matches('.chart-time')) return;
    const chart = target.closest<HTMLElement>('.chart');
    if (!chart) return;
    const index = target.valueAsNumber,
      mark = lineReading(chart, clock)?.at(index) ?? marksOf(chart)[index];
    if (!mark) return;
    showSelection(chart, mark, 'keyboard');
    const words = document.createElement('template');
    words.innerHTML = mark.label;
    target.setAttribute('aria-valuetext', words.content.textContent.trim().replace(/\s+/gu, ' '));
  };
  root.addEventListener('focusin', readSelection);
  root.addEventListener('input', readSelection);
  root.addEventListener('focusout', ({ target }) => {
    if (target instanceof HTMLInputElement && target.matches('.chart-time')) clear();
  });
  const show = (plot: HTMLElement, x: number, kind: string) => {
    const chart = plot.closest('.chart');
    if (!(chart instanceof HTMLElement)) return;
    const reading = readingOf(chart, clock),
      box = plot.getBoundingClientRect();
    if (!reading || !box.width || sliding(plot)) return;
    const share = (x - box.left) / box.width,
      minute = share * Number(chart.dataset['hours']) * MINUTES_PER_HOUR;
    // A move of under a minute along the day is no move at all.
    if (last?.chart === chart && Math.abs(minute - last.minute) < 1) return;
    const mark = reading.near(share);
    if (!mark) return;
    last = { chart, minute };
    showSelection(chart, mark, kind);
  };
  // Let go, a strip being turned goes on to a page, by how far and how fast it was going (`time`, when
  // the finger let go; without it, the nearest page).
  const letGo = ({ strip, left, scale, trail }: Turning, time?: number) => {
    const width = strip.clientWidth,
      pages = strip.querySelectorAll(':scope > .chart-page').length;
    if (!strip.isConnected || !width || !pages) return;
    const marks = time === undefined ? [] : trail.filter(mark => time - mark.time <= SPEED_OVER),
      [first] = marks,
      latest = marks.at(-1),
      span = first && latest ? latest.time - first.time : 0,
      speed = first && latest && span ? (latest.x - first.x) / span : 0,
      start = Math.round(left / width),
      ahead = Math.round((strip.scrollLeft - speed * scale * CARRIES) / width);
    turned(strip, clamp(ahead, Math.max(0, start - 1), Math.min(pages - 1, start + 1)), -speed * scale);
  };
  // The press is over: its wait ends, and pages it was turning go on to a page.
  const end = (time?: number) => {
    if (!held) return;
    const { waiting, turning } = held;
    clearTimeout(waiting);
    ignoreHidden();
    held = null;
    if (turning) letGo(turning, time);
  };
  root.addEventListener('pointerdown', event => {
    const plot = plotOf(event.target);
    // Pressing anywhere else puts kept readings away.
    if (!plot) {
      if (shown('[data-kept]').length) clear();
      return;
    }
    if (!event.isPrimary) return;
    end();
    const kind = event.pointerType,
      chart = plot.closest('.chart'),
      // A chart with nothing to read is never held: a finger on it only sets off, across its pages
      // or down the sheet.
      reads = chart instanceof HTMLElement && readingOf(chart, clock) !== undefined,
      // On pages a finger reads only once held still, as a move across turns them.
      waits = kind !== 'mouse' && plot.closest('.chart-pages') !== null,
      press: Press = {
        id: event.pointerId,
        plot,
        x: event.clientX,
        y: event.clientY,
        down: event.timeStamp,
        at: event.clientX,
        kind,
        waiting: undefined,
        turning: undefined,
        still: kind !== 'mouse' && reads,
      };
    held = press;
    if (waits)
      press.waiting = window.setTimeout(() => {
        if (!reads) return;
        press.waiting = undefined;
        show(plot, press.at, kind);
      }, HOLD);
    // A new press ticks as it lands.
    notched = undefined;
    ignoreHidden = onHidden(() => {
      end();
      clear();
    });
    if (!waits) show(plot, event.clientX, kind);
    // Keeps the drag on this chart even when the finger strays off it.
    plot.setPointerCapture(event.pointerId);
  });
  root.addEventListener('pointermove', event => {
    if (held?.id === event.pointerId) {
      const { turning } = held;
      held.at = event.clientX;
      if (turning) {
        const { strip, x, left, scale } = turning;
        strip.scrollLeft = left - (event.clientX - x) * scale;
        const time = event.timeStamp;
        turning.trail = [...turning.trail, { x: event.clientX, time }].filter(mark => time - mark.time <= SPEED_OVER);
      } else if (held.waiting === undefined) show(held.plot, event.clientX, event.pointerType);
      else {
        const across = event.clientX - held.x,
          down = event.clientY - held.y,
          strip = held.plot.closest<HTMLElement>('.chart-pages');
        if (Math.hypot(across, down) < SETS_OFF) return;
        if (!strip || Math.abs(across) <= Math.abs(down)) {
          end();
          return;
        }
        clearTimeout(held.waiting);
        held.waiting = undefined;
        // Snapping would take each step of the way back to a page.
        strip.toggleAttribute('data-sliding', true);
        held.turning = {
          strip,
          x: event.clientX,
          left: strip.scrollLeft,
          scale: 1 / zoomUnder(strip),
          trail: [{ x: event.clientX, time: event.timeStamp }],
        };
      }
      return;
    }
    // A mouse reads the chart just by hovering; a finger or pen only while pressed.
    const plot = event.pointerType === 'mouse' ? plotOf(event.target) : null;
    if (plot) show(plot, event.clientX, event.pointerType);
  });
  // While a finger turns the pages, or holds a chart, nothing else moves with it: not the sheet, nor
  // the page.
  root.addEventListener(
    'touchmove',
    event => {
      if (!held || !event.cancelable) return;
      const touch = event.touches[0],
        early = event.timeStamp - held.down < HOLD;
      // Gone this far before the hold was up, it set off: it isn't holding the chart.
      if (early && touch && Math.hypot(touch.clientX - held.x, touch.clientY - held.y) >= SETS_OFF) held.still = false;
      if (held.turning || (held.still && !early && keeps())) event.preventDefault();
    },
    { passive: false },
  );
  // A finger or pen lifted puts its reading away, whether it tapped, was held still or read along the
  // chart, and one that turned the pages lets them go. A mouse keeps its reading where a press left
  // it, until a press somewhere else.
  root.addEventListener('pointerup', event => {
    if (held?.id !== event.pointerId) return;
    const { kind, turning } = held;
    if (turning) {
      turning.trail = [...turning.trail, { x: event.clientX, time: event.timeStamp }];
      end(event.timeStamp);
      return;
    }
    end();
    if (kind !== 'mouse') clear();
    else for (const chart of shown('[data-scrubbing]')) if (chart instanceof HTMLElement) chart.dataset['kept'] = '';
  });
  // The browser took the press for a scroll of the sheet, so nothing was being read.
  root.addEventListener('pointercancel', event => {
    if (held?.id !== event.pointerId) return;
    end();
    clear();
  });
  // Plain hovering is put away when the mouse leaves the chart, unless a press kept it.
  root.addEventListener('pointerout', event => {
    if (event.pointerType !== 'mouse' || held) return;
    const plot = plotOf(event.target);
    if (!plot || plot.closest('.chart')?.hasAttribute('data-kept')) return;
    if (!(event.relatedTarget instanceof Node && plot.contains(event.relatedTarget))) clear();
  });
  // Pages sliding carry the chart away from under the pointer, and a reading with them.
  root.addEventListener(
    'scroll',
    event => {
      if (event.target instanceof Element && event.target.matches('.chart-pages')) clear();
    },
    { capture: true, passive: true },
  );
  const drop = () => {
    end();
    clear();
  };
  return { clear, drop };
}
