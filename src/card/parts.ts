import { modeGlyphs } from '../cards/shared/glyphs.ts';
import { child, canvasIn } from '../lib/dom.ts';
import { addedLightAlone, WORDS } from '../cards/shared/light.ts';
import type { Panel } from '../sky/scene.ts';
const PAGE_ARROW = '<svg viewBox="0 0 6.5 23" aria-hidden="true"><path d="M5.1 1.35 1.3 11.5 5.1 21.65"/></svg>';
// The page foot's mark that there is more behind it: an i in a ring.
const INFO =
  '<svg viewBox="0 0 11 11" aria-hidden="true"><circle cx="5.5" cy="5.5" r="5"/><path d="M4.7 4.9h.9v3M4.5 8h2.2"/><circle class="dot" cx="5.5" cy="3.1" r=".6"/></svg>';
// The hourly panel's two headings add their light, each by a lift of its own beside the header:
// the one that gives way, and the one a pinned panel takes (see PageScroll.animate).
const HEADING_LIFTS = addedLightAlone('strip', [
  { name: 'measure', shapes: '', ...WORDS.aside },
  { name: 'pinned', shapes: '', ...WORDS.label },
]).lifts;
// The card's markup, its parts empty.
export const cardMarkup = (): string =>
  `<div class="frame"><section class="weather" aria-label="Weather"><button type="button" class="page-menu"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1 3.25h14M1 8h14M1 12.75h14"/></svg></button><div class="weather-content">
      <div class="scene-root"><canvas class="sky" aria-hidden="true"></canvas><section class="alert" role="alert" hidden></section><section class="next-hour" hidden></section><section class="forecast" aria-label="Forecast"><i class="glass" aria-hidden="true"></i>
        <div class="forecast-content">${HEADING_LIFTS}<div class="forecast-header"><div class="pinned-heading" aria-hidden="true"></div><div class="heading"><strong>Conditions</strong><span class="measure"></span></div>
          <div class="modes" role="group" aria-label="Forecast display"><span class="thumb" aria-hidden="true"></span>${(
            [
              ['conditions', 'Conditions'],
              ['rain', 'Precipitation'],
              ['wind', 'Wind'],
            ] as const
          )
            .map(
              ([mode, label]) =>
                `<button type="button" data-mode="${mode}" aria-label="${label}" title="${label}" aria-pressed="false">${modeGlyphs[mode]}</button>`,
            )
            .join('')}</div>
        </div><div class="body-window"><div class="panel-body"><p class="summary" id="strip-summary"></p><div class="hours" role="list" tabindex="0" aria-label="Hourly forecast" aria-describedby="strip-summary"></div><div class="status" role="status" hidden><span></span><button class="retry" type="button" hidden>Retry</button></div></div></div></div>
        <button class="hours-arrow" type="button" data-edge="start" tabindex="-1" aria-hidden="true">${PAGE_ARROW}</button><button class="hours-arrow" type="button" data-edge="end" tabindex="-1" aria-hidden="true">${PAGE_ARROW}</button>
      </section><section class="daily" aria-label="Daily forecast"><i class="glass" aria-hidden="true"></i><div class="body-window"><div class="daily-content" role="list" tabindex="0" aria-label="Daily temperature ranges"></div></div></section><div class="tiles"></div><button type="button" class="credit" hidden><span class="credit-name"><span></span>${INFO}</span><small></small></button><a class="credit-link" href="https://open-meteo.com/" target="_blank" rel="noreferrer" hidden>Weather data by Open-Meteo.com</a><canvas class="droplets" aria-hidden="true"></canvas><canvas class="frost" aria-hidden="true"></canvas></div><div class="hero"><button type="button" class="current" title="Weather details"><span class="home" hidden></span><span class="location"></span><span class="compact-meta" hidden><span class="place-context"></span><span class="place-home" hidden><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4l4.7 4v6.6H3.3V8zM6.7 10.2v3.4h2.6v-3.4z"/><path class="roof" d="m1.2 7.4 6.8-5.8 6.8 5.8M12.3 2.4v2.8"/></svg><span></span></span></span><span class="reading"><span class="temperature"></span><span class="condition"></span></span><span class="range"></span><span class="stale" hidden></span><span class="brief-light"></span><span class="brief" aria-hidden="true"></span></button></div></div>
    </section></div>`;

// The card's fixed parts, found once in its markup (see the constructor).
export const partsOf = (root: ParentNode) => ({
  weather: child(root, '.weather'),
  menu: child(root, '.page-menu'),
  content: child(root, '.weather-content'),
  sceneRoot: child(root, '.scene-root'),
  alert: child(root, '.alert'),
  nextHour: child(root, '.next-hour'),
  forecast: child(root, '.forecast'),
  heading: child(root, '.heading strong'),
  headings: child(root, '.heading'),
  pinnedHeading: child(root, '.pinned-heading'),
  measure: child(root, '.measure'),
  modes: child(root, '.modes'),
  summary: child(root, '.summary'),
  hours: child(root, '.hours'),
  pageBack: child(root, '.hours-arrow[data-edge=start]'),
  pageNext: child(root, '.hours-arrow[data-edge=end]'),
  status: child(root, '.status'),
  statusText: child(root, '.status span'),
  retry: child(root, '.retry'),
  daily: child(root, '.daily'),
  dailyList: child(root, '.daily-content'),
  tiles: child(root, '.tiles'),
  credit: child(root, '.credit'),
  creditName: child(root, '.credit-name span'),
  creditSource: child(root, '.credit small'),
  creditSupplement: child(root, '.credit-link'),
  hero: child(root, '.hero'),
  current: child(root, '.current'),
  home: child(root, '.home'),
  location: child(root, '.location'),
  compactMeta: child(root, '.compact-meta'),
  placeContext: child(root, '.place-context'),
  placeHome: child(root, '.place-home'),
  placeHomeName: child(root, '.place-home span'),
  temperature: child(root, '.temperature'),
  condition: child(root, '.condition'),
  range: child(root, '.range'),
  stale: child(root, '.stale'),
  brief: child(root, '.brief'),
  briefLight: child(root, '.brief-light'),
  sky: canvasIn(root, '.sky'),
  droplets: canvasIn(root, '.droplets'),
  frost: canvasIn(root, '.frost'),
  // The forecast switch's options: conditions, precipitation and wind.
  modeButtons: [...root.querySelectorAll<HTMLElement>('.modes [data-mode]')],
});
export type Parts = ReturnType<typeof partsOf>;
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Geometry {
  width: number;
  height: number;
  // The current conditions' text, which the moon keeps clear of.
  text: Box;
  open: Box;
  covered: Panel[];
  // Every glass panel, where `covered` is, for rain to splash on their tops.
  edges: Panel[];
  // The same panels measured from the scene root, where their canvases are drawn.
  glass: Panel[];
  panes: { panel: HTMLElement; rect: Panel }[];
  root: { width: number; height: number };
}
// Narrower than this (in px), a card has no room for the forecast's switch or its strip of
// hours side by side: its forecast shows conditions, as a list (see the CSS).
export const NARROW = 200;
