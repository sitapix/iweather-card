import { clamp } from '../lib/values.ts';
import type { Parts } from './parts.ts';
import type { CardConfig } from './config.ts';
// A full page given less height than it needs, in a panel view or a set height, scrolls in
// place: its hero collapses into a band pinned at the top, and each panel passes under it.

// The pinned band holds its first line 90 px down once settled, with 34 px below the place name
// and brief reading, making the band 186 px tall. A shorter hero keeps only as much top space as
// its expanded text allows. A line over the place name adds 13.75 px, less than it takes up, so
// the words sit closer to the band's foot.
const BAND = { top: 90, bottom: 34, line: 13.75 } as const;
// Collapsing, the lines of the conditions fade in turn from the foot up, each as the panels come up
// to it, and the brief reading comes in after them: by how far the page has scrolled, in the
// page's own pixels. A hero too short to take that long takes the same steps in what it has.
const FADES: Readonly<Record<string, readonly [from: number, to: number]>> = {
  '.range': [22.5, 53.75],
  '.stale': [22.5, 53.75],
  '.condition': [52.5, 83.75],
  '.temperature': [81.25, 133.75],
};
const BRIEF_FADE = [133.75, 186.25] as const;
// Once the band is pinned, the place name and brief reading rise a little further, by two-fifths
// of the brief reading's height, over as much scrolling.
const SETTLE = 0.4;
// Past the pin, the hourly panel's headings give way to each other, by how far it has gone under
// the band, in the page's own pixels: the large one goes first, and the small one comes in clear of it.
const LARGE_HEADING = [6.25, 12.5] as const;
const SMALL_HEADING = [13.75, 20] as const;

// An animation along the page and the keyframes it runs (see animate).
interface Running {
  animation: Animation;
  keyframes: string;
}
// A panel of a page that scrolls in place, laid out with the page at its top: where it sits
// in the page, the band its header keeps (`head`) when the rest slides under it, the lifts its
// header's light stands on, where the rest `starts` under the header, the body holding the rest,
// the window round it (see the styles) and where it sits in the panel. `state` is whether it was
// under the band when last scrolled.
interface ScrollPanel {
  panel: HTMLElement;
  top: number;
  height: number;
  header: HTMLElement | null;
  lifts: Element[];
  glass: HTMLElement | null;
  head: number;
  starts: number;
  body: HTMLElement | null;
  window: HTMLElement | null;
  bodyTop: number;
  // The hourly panel's headings, each with the lift its light stands on.
  headings: { large: readonly Element[]; small: readonly Element[] } | null;
  state: string;
}
interface ScrollLayout {
  // The hero's height at rest, the band it keeps once collapsed, how far its text rises as it
  // collapses (`lift`) and after (`settle`), and how far the page scrolls.
  hero: number;
  pinned: number;
  lift: number;
  settle: number;
  range: number;
  panels: ScrollPanel[];
}
// WebKit draws each part the page moves as a layer of its own, and lets go of a layer's picture
// while every place its animation can take it lies off screen: flung into view, a header came in
// blank until it was drawn again. So the headers, their lights and each body also stand
// a hundredth of a pixel toward the viewer, which a flat page doesn't show. That step is past what
// WebKit works out, so it keeps their layers drawn wherever they are.
const KEPT_DEPTH = 0.01;
const KEPT_DRAWN = `translateZ(${KEPT_DEPTH}px)`;
// What WebKit also draws as a layer of its own without the page moving it: whatever lies over a
// light (see addedLight), as its list of layers shows. That takes the step alone, toward the viewer
// and a hair further along the page, which moves nothing.
const OVER_LIGHT =
  '.added > .words, :is(.compass, .gauge) > :not(.lift), .day > :is(.day-icon, .day-low, .range-track, .day-high)';
const STILL: Keyframe[] = [{ translate: `0 0 ${KEPT_DEPTH}px` }, { translate: `0 0 ${KEPT_DEPTH * 2}px` }];
// Only WebKit needs that step, and only there do these parts take it. Firefox draws them without it,
// and given one inside another along a scroll timeline, it left the inner ones undrawn outside a
// middle stretch of the outer: the daily list lost its first and last rows and every day's high.
// Chrome draws them without it too, and works out the style of every part a scroll timeline moves
// again at each frame of the scroll, so there they only cost.
const stillKept = () => {
  const agent = navigator.userAgent;
  return agent.includes('AppleWebKit/') && !/(Chrome|Chromium)\//.test(agent);
};
// A header's row, from `box`, its box in the page: the box less its padding, which only gives a
// finger room around what is in it (see the hourly panel's header in the styles).
function rowOf(header: Element, box: DOMRect): { top: number; height: number } {
  const style = getComputedStyle(header),
    own = Number.parseFloat(style.zoom) || 1,
    above = Number.parseFloat(style.paddingTop) * own;
  return { top: box.top + above, height: box.height - above - Number.parseFloat(style.paddingBottom) * own };
}
// Where a scrolling page's keyframes go, for `stops` where its look changes pace: each stop
// that it reaches.
function scrollPoints(stops: number[], { range }: ScrollLayout): number[] {
  return [...new Set([0, range, ...stops])].filter(top => top >= 0 && top <= range).sort((a, b) => a - b);
}
// How far under the pinned band a panel has gone with the page scrolled by `top`: how much of
// its top the glass gives up (`cut`), how much of the header and glass still shows (`fade`),
// and the line in the panel above which the rest is hidden (`under`). The header and glass hold
// at the band to the panel's foot: once all but the band they keep has passed under it, they
// fade where they are as the rest goes, never rising past the band.
function panelCut(item: ScrollPanel, { hero, pinned }: ScrollLayout, top: number) {
  const pin = Math.max(pinned, hero - top),
    depth = pin - (item.top - top),
    travel = item.height - item.head,
    cut = clamp(depth, 0, item.height),
    fade = item.head ? clamp(1 - (depth - travel) / item.head) : 1;
  // The rest goes under where it started below the header, that line easing down to the band's
  // foot so that the header ends up with as much space below it as above.
  return { cut, fade, under: cut + Math.min(item.head, item.starts + cut) };
}
// How much of the hourly panel's headings show, with the panel `past` under the band.
const headingShown = ([from, to]: readonly [number, number], past: number) => clamp((past - from) / (to - from));
// Where the page shows as a panel changes pace (see scrollPoints): where the hero is done
// collapsing, and where the panel meets the band, its hidden line reaches the band's foot and the
// top of its body, its fade begins, its foot passes the band, and its headings change over.
function cutStops(item: ScrollPanel, { hero, pinned }: ScrollLayout): number[] {
  const travel = item.height - item.head,
    knee = Math.max(0, item.head - item.starts),
    // How far under the band the panel has gone when the hidden line reaches `line`.
    reach = (line: number) => (line - item.head >= knee ? line - item.head : (line - item.starts) / 2),
    depths = [
      0,
      knee,
      travel,
      travel + item.head,
      reach(item.bodyTop),
      ...(item.headings ? [...LARGE_HEADING, ...SMALL_HEADING] : []),
    ];
  return [hero - pinned, ...depths.map(depth => depth + item.top - pinned)];
}

// What the scrolling page reads from the card, and sets on it.
interface ScrollHost extends Pick<HTMLElement, 'toggleAttribute'> {
  readonly root: ShadowRoot;
  readonly parts: Parts;
  readonly config: CardConfig | undefined;
  readonly animating: boolean;
  measureZoom(): number;
  box(node: Element, zoom?: number): DOMRect;
  paint(): void;
  remeasure(): void;
}
export class PageScroll {
  readonly card: ScrollHost;
  // Where everything sits with the page at its top, until the next render or resize.
  layout: ScrollLayout | null = null;
  frame = 0;
  // How far the page is scrolled, and where its pinned band ends (see apply).
  at = { top: 0, pin: 0 };
  // The cut on the drops and frost (see apply).
  cut = '';
  // The page's animations along its scroll, each by what it moves and its pseudo-element, with the
  // keyframes it runs; the timeline they follow, or none where they are stepped to each scroll by
  // hand (see animate).
  animations: { running: Map<Element, Map<string, Running>>; timeline: ScrollTimeline | null } = {
    running: new Map(),
    timeline: null,
  };
  constructor(card: ScrollHost) {
    this.card = card;
  }
  // Whether the page scrolls in place (see sync).
  scrolls(): boolean {
    return this.card.parts.weather.dataset['scroll'] === 'true';
  }
  // A page given less height than it needs (in a panel view, or a set height) scrolls in place.
  sync() {
    const { card } = this,
      weather = card.parts.weather,
      scroller = card.parts.content,
      scrolls = card.config?.weather_layout === 'page' && scroller.scrollHeight > scroller.clientHeight + 1;
    if (scrolls !== this.scrolls()) {
      weather.dataset['scroll'] = String(scrolls);
      card.toggleAttribute('data-scroll', scrolls);
      card.remeasure();
      if (!scrolls) {
        // Back to a page that grows: everything moved or cut while scrolling goes back.
        this.stopAnimations();
        for (const panel of card.root.querySelectorAll('[data-cut]')) panel.removeAttribute('data-cut');
        weather.style.removeProperty('--band');
        for (const canvas of [card.parts.droplets, card.parts.frost]) canvas.style.removeProperty('clip-path');
        this.cut = '';
        this.at = { top: 0, pin: 0 };
      }
      this.layout = null;
    }
    if (scrolls) this.apply();
  }
  queue() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.sync();
    });
  }
  cancel() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
  // Where the hero and each panel of a scrolling page sit with the page at its top, measured
  // once until the next render or resize, so that scrolling only moves and cuts them.
  measure(): ScrollLayout {
    if (this.layout) return this.layout;
    // Measured at rest, the animations held still by the styles for the moment (data-measuring)
    // and let go before anything is drawn. Cancelled and started again, they went missing from a
    // frame or more in WebKit, and the conditions stood over the panels.
    const { weather } = this.card.parts;
    weather.toggleAttribute('data-measuring', true);
    try {
      this.layout = this.atRest();
    } finally {
      weather.toggleAttribute('data-measuring', false);
    }
    this.animate(this.layout);
    return this.layout;
  }
  atRest(): ScrollLayout {
    const { card } = this,
      zoom = card.measureZoom(),
      scroller = card.parts.content,
      origin = card.box(card.parts.weather, zoom).top - scroller.scrollTop,
      { hero, current, home, location, brief } = card.parts;
    // Collapsed, the place name rises to the top of the band, under the line over it if there is
    // one, with the brief reading under it, a little lower than where it settles (see SETTLE).
    const place = location.hidden !== false ? 0 : location.offsetHeight,
      over = home.offsetHeight > 0,
      under = location.offsetTop + place,
      settle = brief.offsetHeight * SETTLE;
    // Where the page runs up behind the phone's status bar, the band hangs from under it.
    const clear = Number.parseFloat(getComputedStyle(hero).scrollMarginTop) || 0,
      height = hero.offsetHeight,
      start = current.offsetTop + (over ? home : location).offsetTop - clear - settle,
      top = Math.min(BAND.top, Math.max(0, start)),
      pinned = Math.min(height, clear + top + BAND.bottom + place + brief.offsetHeight + (over ? BAND.line : 0)),
      lift = Math.max(0, start - top);
    hero.style.setProperty('--brief-top', `${under}px`);
    // The page scrolls in a box from the band down, whose edge cuts whatever would show over the
    // band (see the styles). Panels are measured against the card.
    card.parts.weather.style.setProperty('--band', `${pinned}px`);
    const panels = [...card.root.querySelectorAll<HTMLElement>('.alert,.next-hour,.forecast,.daily,.tile')].flatMap(
      (panel): ScrollPanel[] => {
        if (!panel.offsetHeight) return [];
        // A panel's header is the row over its content (a tile's or an alert's title, the hourly
        // panel's heading and switch); the band it keeps is that row with as much space below as above.
        // The rest is its body; the daily list, with no header, is all body.
        const inner = panel.querySelector<HTMLElement>(':scope > .forecast-content, :scope > .tile-content') ?? panel,
          header = inner.querySelector<HTMLElement>(':scope > header, :scope > .forecast-header'),
          frame = inner.querySelector<HTMLElement>(':scope > .body-window'),
          body = frame?.querySelector<HTMLElement>(':scope > :is(.panel-body, .daily-content)') ?? null,
          box = card.box(panel, zoom),
          title = header ? rowOf(header, card.box(header, zoom)) : null,
          above = title ? title.top - box.top : 0;
        const lifts = [...inner.querySelectorAll(':scope > .lift')],
          hourly = panel === card.parts.forecast;
        const tops = [...(body?.children ?? [])].flatMap(node =>
          node instanceof HTMLElement && node.offsetHeight ? [card.box(node, zoom).top - box.top] : [],
        );
        return [
          {
            panel,
            top: box.top - origin,
            height: box.height,
            header,
            lifts: hourly ? [] : lifts,
            glass: panel.querySelector<HTMLElement>(':scope > .glass'),
            head: title ? above * 2 + title.height : 0,
            starts: header ? Math.min(...tops) : 0,
            body,
            window: frame,
            bodyTop: frame ? card.box(frame, zoom).top - box.top : 0,
            headings: hourly
              ? {
                  large: [card.parts.headings, ...lifts.slice(0, 1)],
                  small: [card.parts.pinnedHeading, ...lifts.slice(1)],
                }
              : null,
            state: '',
          },
        ];
      },
    );
    return {
      hero: height,
      pinned,
      lift,
      settle,
      range: scroller.scrollHeight - scroller.clientHeight,
      panels,
    };
  }
  // The hero is a window that slides up with the panels until it is the band, its text sliding
  // back down in it to rise only a little, the conditions fading in turn and the brief reading
  // coming in.
  // Each panel's glass slides down in its window to keep its rounded top at the band, the window
  // (the panel's shape) clipping it at its foot; its header holds at the band. Once the panel's
  // foot comes up to them, both fade there, the window following the band down so that the band
  // stays whole. The rest is cut from the top: the body's window slides down to the hidden line
  // while the body slides back up in it. These run as animations along the page's scroll, which the browser moves with the page as it scrolls it; set from the scroll
  // handler instead, they trail the page by a frame and shake. Without scroll timelines they are
  // stepped to each scroll (see apply).
  animate(layout: ScrollLayout) {
    const { parts } = this.card,
      timeline =
        this.animations.timeline ??
        ('ScrollTimeline' in window ? new ScrollTimeline({ source: parts.content, axis: 'block' }) : null),
      was = this.animations.running,
      running = new Map<Element, Map<string, Running>>(),
      moved = new Set<Element>(),
      // Whether parts nothing moves still take the step that keeps them drawn (see STILL).
      kept = timeline !== null && stillKept();
    // A transform is drawn at its element's own zoom, so moving something with one of its own as far
    // as the page takes less. Each held part's zoom is read before anything below is set: read
    // after the page's animations change, it has the browser work the whole card's style out again.
    const zooms = new Map<Element, number>(),
      zoomOf = (node: Element) => {
        let zoom = zooms.get(node);
        if (zoom === undefined) {
          zoom = Number.parseFloat(getComputedStyle(node).zoom) || 1;
          zooms.set(node, zoom);
        }
        return zoom;
      },
      // A held header or light moved down by `px` of the page.
      holdAt = (node: Element, px: number) => `translateY(${px / zoomOf(node)}px) ${KEPT_DRAWN}`;
    for (const item of layout.panels)
      for (const node of [item.header, ...item.lifts, ...(item.headings?.large ?? []), ...(item.headings?.small ?? [])])
        if (node) zoomOf(node);
    // What already runs goes on running, its keyframes changed only where they differ: started again,
    // an animation goes missing for a frame or more in WebKit. A part asked for twice, as the daily
    // list is both what holds its panel and its body, keeps the one.
    const animate = (node: Element, frames: Keyframe[], pseudoElement: string | null = null) => {
      // An animation that changes nothing is left out: Chrome keeps one off the compositor, and
      // whatever moves inside it then trails the page by a frame.
      const look = (frame: Keyframe) => JSON.stringify({ ...frame, offset: null });
      if (frames.every(frame => look(frame) === look(frames[0] ?? {}))) return;
      moved.add(node);
      const key = pseudoElement ?? '',
        keyframes = JSON.stringify(frames),
        before = running.get(node)?.get(key) ?? was.get(node)?.get(key);
      was.get(node)?.delete(key);
      if (before && before.keyframes !== keyframes && before.animation.effect instanceof KeyframeEffect)
        before.animation.effect.setKeyframes(frames);
      const animation =
        before?.animation ??
        node.animate(
          frames,
          timeline ? { timeline, fill: 'both', pseudoElement } : { duration: 1, fill: 'both', pseudoElement },
        );
      if (!before && !timeline) animation.pause();
      const byPseudo = running.get(node) ?? new Map<string, Running>();
      byPseudo.set(key, { animation, keyframes });
      running.set(node, byPseudo);
    };
    // Keyframes where the page's look changes pace (see scrollPoints), each taken from how the page
    // shows there.
    const along = <T>(stops: number[], look: (top: number) => T) =>
      scrollPoints(stops, layout).map(top => ({ offset: layout.range ? top / layout.range : 0, ...look(top) }));
    const { hero, pinned, lift, settle } = layout,
      fold = Math.max(0, hero - pinned),
      collapse = (top: number) => (fold ? clamp(top / fold) : 1),
      band = [fold, fold + settle],
      pace = Math.min(1, (fold + settle) / BRIEF_FADE[1]);
    // How far a fade over these points of the scroll has gone with the page at `top`.
    const faded = ([from, to]: readonly [number, number], top: number) =>
      clamp((top - from * pace) / ((to - from) * pace || 1));
    animate(
      parts.hero,
      along(band, top => ({ transform: `translateY(${-Math.min(top, fold)}px)` })),
    );
    // Pinned, its text rises a little further, the brief reading coming in as it does.
    animate(
      parts.current,
      along(band, top => ({
        transform: `translateY(${Math.min(top, fold) - collapse(top) * lift - (settle ? clamp((top - fold) / settle) : 1) * settle}px)`,
      })),
    );
    // The conditions fade before the brief reading comes in where they were.
    for (const [line, fade] of Object.entries(FADES)) {
      const node = parts.current.querySelector(line);
      if (node)
        animate(
          node,
          along(
            fade.map(stop => stop * pace),
            top => ({ opacity: 1 - faded(fade, top) }),
          ),
        );
    }
    const brief = along(
      BRIEF_FADE.map(stop => stop * pace),
      top => ({ opacity: faded(BRIEF_FADE, top) }),
    );
    for (const node of [parts.brief, ...parts.briefLight.children]) animate(node, brief);
    for (const item of layout.panels) {
      const states = along(cutStops(item, layout), top => panelCut(item, layout, top));
      // A panel that never reaches the band is left where it is, its header and content only kept
      // drawn (see STILL), with what holds them both where it has one.
      if (!states.some(({ cut, fade }) => cut > 0 || fade < 1)) {
        if (!kept) continue;
        const holder = item.panel.querySelector(
          ':scope > :is(.tile-content, .forecast-content), :scope > .body-window > .daily-content',
        );
        for (const node of [holder, item.header, item.body]) if (node) animate(node, STILL);
        continue;
      }
      const slide = (under: number) => Math.max(0, under - item.bodyTop),
        held = (node: Element) =>
          states.map(({ offset, cut, fade }) => ({
            offset,
            transform: holdAt(node, cut),
            opacity: fade,
          })),
        // How far the glass's window has followed the band past the panel's foot.
        past = (cut: number) => Math.max(0, cut + item.head - item.height);
      if (item.glass) {
        animate(
          item.glass,
          states.map(({ offset, cut }) => ({ offset, transform: `translateY(${past(cut)}px)` })),
        );
        animate(
          item.glass,
          states.map(({ offset, cut, fade }) => ({
            offset,
            transform: `translateY(${cut - past(cut)}px)`,
            opacity: fade,
          })),
          '::before',
        );
      }
      for (const node of [item.header, ...item.lifts]) if (node) animate(node, held(node));
      // The hourly panel's headings give way past the pin, with the switch left between them.
      // A heading fades in the header, and the lift beside it fades as it does.
      const swap = (nodes: readonly Element[], shown: (cut: number) => number) => {
        for (const node of nodes) {
          const lift = node.classList.contains('lift');
          animate(
            node,
            states.map(({ offset, cut, fade }) => ({
              offset,
              opacity: shown(cut) * (lift ? fade : 1),
              ...(lift ? { transform: holdAt(node, cut) } : {}),
            })),
          );
        }
      };
      if (item.headings) {
        swap(item.headings.large, cut => 1 - headingShown(LARGE_HEADING, cut));
        swap(item.headings.small, cut => headingShown(SMALL_HEADING, cut));
      }
      if (!item.window || !item.body) continue;
      animate(
        item.window,
        states.map(({ offset, under }) => ({ offset, transform: `translateY(${slide(under)}px)` })),
      );
      animate(
        item.body,
        states.map(({ offset, under }) => ({ offset, transform: `translateY(${-slide(under)}px) ${KEPT_DRAWN}` })),
      );
    }
    // Kept drawn along a scroll timeline only, which WebKit, the one that lets go of the pictures, has;
    // and not in Firefox (see stillKept).
    if (kept) {
      for (const item of layout.panels)
        for (const node of item.panel.querySelectorAll(OVER_LIGHT)) if (!moved.has(node)) animate(node, STILL);
      // The page's foot is a layer of its own too.
      animate(parts.credit, STILL);
    }
    // What no longer runs is let go: what it moved has gone, or no longer moves.
    for (const byPseudo of was.values()) for (const { animation } of byPseudo.values()) animation.cancel();
    this.animations = { running, timeline };
  }
  // Every animation the page runs (see animate).
  runningAnimations(): Animation[] {
    return [...this.animations.running.values()].flatMap(byPseudo => [...byPseudo.values()].map(run => run.animation));
  }
  stopAnimations() {
    for (const animation of this.runningAnimations()) animation.cancel();
    this.animations = { running: new Map(), timeline: null };
  }
  // A scrolling page: the hero collapses into a band pinned at the top, and each panel passes
  // under it (see animate).
  apply() {
    const { card } = this,
      scroller = card.parts.content,
      top = scroller.scrollTop;
    // A page that has grown or shrunk is measured again.
    if (this.layout && this.layout.range !== scroller.scrollHeight - scroller.clientHeight) this.layout = null;
    const layout = this.measure(),
      { hero, pinned, range } = layout,
      pin = Math.max(pinned, hero - top);
    if (!this.animations.timeline)
      for (const animation of this.runningAnimations()) animation.currentTime = range ? top / range : 0;
    // The panels under the band are marked, for whoever looks.
    for (const item of layout.panels) {
      const { cut, fade } = panelCut(item, layout, top),
        state = String(cut > 0 || fade < 1);
      if (state === item.state) continue;
      item.state = state;
      item.panel.toggleAttribute('data-cut', state === 'true');
    }
    // Drops and frost on the glass go under the band with the panels. Once it is pinned, the edge
    // of the box the page scrolls in cuts them there; until then the band's foot holds at the first
    // panel's top as the hero collapses, so they are cut along that one line. Cut along the band's
    // foot at each frame instead, they were drawn again at each frame, with the page around them.
    const cut = top > 0 ? `inset(${Math.max(0, hero - pinned)}px 0 0 0)` : '';
    if (cut !== this.cut) for (const canvas of [card.parts.droplets, card.parts.frost]) canvas.style.clipPath = cut;
    this.cut = cut;
    const moved = top !== this.at.top || pin !== this.at.pin;
    this.at = { top, pin };
    // A still sky is drawn again to follow the panels; a running one does so each frame.
    if (moved && !card.animating) card.paint();
  }
}
