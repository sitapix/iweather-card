import { drawRadarCoverage } from './coverage.ts';
import { FORECAST_LABEL_STEP, RADAR_LABEL_STEP, RadarPreview } from './radar-preview.ts';
import { carry, type Drift, measureDrift, STILL } from './radar-drift.ts';
import { clamp } from '../lib/values.ts';
// The map views: the map tile's, and the large one in its sheet. For each, what it shows and
// where it looks, the data asked for it, and everything that moves on it.
import type { CardConfig, MapLayerKind } from '../card/config.ts';
import type { HomeAssistant } from '../card/home-assistant.ts';
import { clockFormat, dateFormat } from '../lib/formats.ts';
import { esc, percent } from '../lib/html.ts';
import { GlassSwitch } from '../lib/glass-switch.ts';
import { haptic } from '../lib/haptics.ts';
import { HOUR, MINUTE, SECOND } from '../lib/time.ts';
import {
  covers,
  gridAt,
  openMeteoAir,
  openMeteoWind,
  radarFrames,
  rainSlot,
  rainTimeline,
  steadyWind,
  WIND_HOURS,
  windBounds,
  windHour,
  openingZoom,
  type GridSource,
  type MapTile,
  type RadarFrame,
  type ScalarField,
  type WindGrid,
  type WindHours,
} from './sources.ts';
import {
  AQI_US,
  PRECIPITATION,
  RADAR_COLOURS,
  TEMPERATURE_C,
  TEMPERATURE_F,
  drawField,
  fieldImage,
  type Stop,
} from './field.ts';
import {
  GL_STYLE,
  GL_ZOOM_OFFSET,
  gapsInView,
  rainGapsInView,
  groundStill,
  loadMapLibre,
  newMap,
  paintGround,
  pickRadar,
  pickRainSlot,
  radarLoaded,
  showField,
  showRadar,
  showRainSlots,
  stillRadarImage,
  type GlMap,
  type GroundLook,
  type GroundStill,
  type MapStillView,
  PAGE_DRAWN,
} from './gl.ts';
import {
  isLayer,
  mapMarkup,
  radarSky,
  radarTile,
  timelineAt,
  timelineDuration,
  timelineMarkup,
  type RainSpan,
  type Timeline,
} from './markup.ts';
import { bindMapMoves, MOTION, notched, restMotion, showMotion } from './moves.ts';
import { bindPinch } from './pinch.ts';
import { tileTurn } from './pace.ts';
import { finite } from '../lib/values.ts';
import { sceneCondition, conditionLabel } from '../weather/conditions.ts';
import { windDirection } from '../lib/compass.ts';
import { mapView, type MapInputs } from './view.ts';
import { radarReaches } from './radar-reach.ts';
import { windMetersPerSecond } from '../sky/sky.ts';
import { UNITS, convertUnit } from '../weather/units.ts';
import {
  MAP_ZOOMS,
  drawWindMap,
  fitsWind,
  pointOf,
  rainBounds,
  windPointsFor,
  type MapCentre,
  type WindMap,
} from './wind.ts';
import { loadRain, RAIN_MODELS, rainPlans } from './rain-grids.ts';
import {
  HRRR_BOUNDS,
  HRRR_CREDIT,
  nextRadarFrames,
  radarForecast,
  radarTemplate,
  type RadarForecast,
} from './radar-forecast.ts';
import type { Update } from '../card/update.ts';
import type { WeatherText } from '../weather/i18n.ts';
import { phrase, say } from '../weather/words.ts';

// Where only home's wind is known, the wind map draws it within 110 px of home (see the styles).
const HOME_WIND_REACH = 110;
// The large map's timeline plays two frames a second; the radar's frames are ten minutes apart.
// Playing waits where it is until its frames have come (see framesReady), but no longer than 8 s,
// so a tile that won't come doesn't hold it for good.
const WIND_PLAYBACK = 2,
  RADAR_STEP = 10 * MINUTE,
  PLAY_PATIENCE = 8 * SECOND;
// Wind for the large map is asked for once it has rested 400 ms, not for each step of a quick
// zoom; one that failed, again after a minute. The last eight grids are kept.
const WIND_GRIDS = 8,
  MAP_REST = 400;
// The live ground's camera counts as where the layers were drawn within this (degrees, steps).
const GL_SAME = 1e-6;
// How long the live ground's lost context may stay gone, with the page in view, before it is
// replaced by a new map.
export const GL_LOST_WAIT = 2 * SECOND;
// The hour timeline retains ten observations and adds real HRRR frames where available.
const RADAR_FRAMES = 10,
  FORECAST_REFRESH = 10 * MINUTE,
  FORECAST_TIMEOUT = 20 * SECOND;
// The small map's ground: the pictures kept, enough for a light and a dark theme in a few sizes.
const STILLS_KEPT = 6;
// The page is drawn a quarter larger than it stands on screen (PAGE_DRAWN), and the small map a
// step closer by as much, so that it takes in what the large map does at the same zoom.
const PAGE_STEPS = Math.log2(PAGE_DRAWN);
// While the forecast's hours come, the map is drawn again no more often than this (ms).
const RAIN_REDRAW = 400;
// How often the wind is asked for again. The radar follows its configured interval.
const REFRESH = { wind: HOUR } as const;
// The large map's pin (see MapViews.pin). Its card lies beside the pin, on the left where it
// would run past the map's edge, and opens a map 12 steps in.
export type MapPin = 'open' | 'small' | 'card';
const MAP_CARD = { reach: 280, zoom: 12 } as const;
// The wind timeline's times stay 6 px apart.
const MARK_GAP = 6;
// Without the live map, the forecast's precipitation is drawn again four times a quarter hour.
const FALLBACK_STEPS = 4;
// A grid of readings `at` a fractional place among `fields`, blended from the two either side.
function fieldAt(fields: readonly ScalarField[], at: number): ScalarField | undefined {
  const from = Math.floor(at),
    a = fields[from],
    b = fields[Math.min(fields.length - 1, from + 1)],
    share = at - from;
  return a && b && share > 0
    ? { ...a, values: a.values.map((value, i) => value + ((b.values[i] ?? value) - value) * share) }
    : a;
}

// The small map plays one of two loops, by the rain's outlook (see rainOutlook). While it is falling,
// the radar's latest frame and those after it (see AHEAD), each a step further on at the rain's drift.
// Otherwise the forecast's precipitation, TILE_HOURS of it an hour a picture from the hour now.
const TILE_HOURS = 12,
  // A forecast hour shows at this opacity at most, as the large map's field does (see the styles).
  HOUR_PEAK = 0.9;
interface HourFrame {
  time: number;
  field: ScalarField;
}
// The radar's latest frame carried `ahead` steps on by the rain's drift (see radar-drift.ts).
interface AheadFrame {
  time: number;
  ahead: number;
}
type TileFrame = RadarFrame | HourFrame | AheadFrame;
// A frame every ten minutes from the latest, as many as reach fifty minutes past now: the latest
// comes some minutes late, so it can take one more.
const AHEAD = { step: 10 * MINUTE, reach: 50 * MINUTE } as const;
function hoursFromNow(hours: WindHours, now: number): HourFrame[] {
  const fields = hours.precipitation ?? [],
    slot = hours.slot ?? HOUR,
    at = hours.times.findIndex(end => end > now);
  if (at < 0) return [];
  return hours.times.slice(at, at + TILE_HOURS).flatMap((end, step) => {
    const field = fields[at + step];
    return field ? [{ time: end - slot, field }] : [];
  });
}

interface Radar {
  at: number;
  frames: RadarFrame[];
  failed?: boolean;
}
// What a view's streaks are drawn for (see startStreaks).
interface Streaks {
  centre: MapCentre;
  width: number;
  height: number;
  large: boolean;
  home: { x: number; y: number };
  across: WindHours | null;
  animate: boolean;
}
// The large map as it was, kept under the new one until its tiles have come (or 2 s), so a move
// or zoom never shows a gap: only its tiles, still where the motion left them; over the live
// ground, if there is one.
function holdMap(view: HTMLElement, before: HTMLElement) {
  before.classList.add('map-old');
  before.removeAttribute('data-eased');
  const live = view.querySelector(':scope > .map-gl');
  if (live) live.after(before);
  else view.prepend(before);
  const ground = [...view.querySelectorAll<HTMLImageElement>(':scope > .map-pan:not(.map-old) .radar-layer img[src]')];
  void Promise.race([
    Promise.allSettled(ground.map(image => image.decode())),
    new Promise(done => window.setTimeout(done, MOTION.hold)),
  ]).then(() => before.remove());
}
const letGo = ({ ground, names }: GroundStill) => {
  URL.revokeObjectURL(ground);
  URL.revokeObjectURL(names);
};
// A small map's radar frame: its tiles in the forecast's colours, drawn twice over into one canvas
// for a sharp picture. A tile that doesn't come is left out.
const RADAR_SHARP = 2,
  RADAR_TILE = 256;
async function paintRadar(
  canvas: HTMLCanvasElement,
  tiles: readonly MapTile[],
  url: (tile: MapTile) => string,
  night: boolean,
  signal?: AbortSignal,
) {
  const context = canvas.getContext('2d');
  const painted = await Promise.allSettled(
    tiles.map(async tile => {
      const picture = await createImageBitmap(await stillRadarImage(url(tile), night, signal)),
        size = RADAR_TILE * RADAR_SHARP;
      try {
        signal?.throwIfAborted();
        context?.drawImage(picture, tile.left * RADAR_SHARP, tile.top * RADAR_SHARP, size, size);
      } finally {
        picture.close();
      }
    }),
  );
  return painted.some(tile => tile.status === 'fulfilled');
}
// What paints a small map's one frame into a canvas, which then says which tiles it holds. The
// picture reaches a few of its pixels past the map's edges, where the map cuts it off: its blur
// (see the styles) would otherwise draw in the clear beyond its edges, and a light map would show
// through as a pale rim all round.
const RADAR_RING = 4;
function radarPainter(centre: MapCentre, width: number, height: number, look: GroundLook) {
  const sky = radarSky(centre, width, height, RADAR_RING),
    tilesOf = (frame: RadarFrame) => `${look}|${sky.tiles.map(radarTile(frame)).join()}`;
  return {
    tilesOf,
    paint: (canvas: HTMLCanvasElement, frame: RadarFrame, signal?: AbortSignal) => {
      canvas.width = Math.round((width / sky.grow + 2 * RADAR_RING) * RADAR_SHARP);
      canvas.height = Math.round((height / sky.grow + 2 * RADAR_RING) * RADAR_SHARP);
      Object.assign(canvas.style, {
        left: `${-RADAR_RING}px`,
        top: `${-RADAR_RING}px`,
        width: `calc(100% + ${2 * RADAR_RING}px)`,
        height: `calc(100% + ${2 * RADAR_RING}px)`,
      });
      canvas.dataset['tiles'] = tilesOf(frame);
      return paintRadar(canvas, sky.tiles, radarTile(frame), look === 'night', signal);
    },
  };
}
// A later radar frame for a small map, which stays as it is: the last frame is kept until the new
// one is painted (or 2 s), then the two cross over.
function crossRadar(last: HTMLElement, at: number, paint: (canvas: HTMLCanvasElement) => Promise<unknown>) {
  const coming = document.createElement('canvas');
  coming.className = 'radar-layer frame';
  last.dataset['frame'] = String(at);
  const painted = paint(coming);
  last.after(coming);
  void Promise.race([painted, new Promise(done => window.setTimeout(done, MOTION.hold))]).then(() => {
    coming.dataset['frame'] = last.dataset['frame'] ?? '';
    coming.toggleAttribute('data-on', true);
    delete last.dataset['frame'];
    last.removeAttribute('data-on');
    window.setTimeout(() => last.remove(), MOTION.ease);
  });
}
// A large map's radar frame on the card's own tiles, its pictures held back till first shown (see
// mapMarkup), asked for, each in its turn.
function loadFrame(frame: Element) {
  for (const image of frame.querySelectorAll<HTMLImageElement>('img[data-src]')) {
    const address = image.dataset['src'] ?? '';
    delete image.dataset['src'];
    void tileTurn().then(() => {
      image.src = address;
    });
  }
}
// The timeline's times, spaced evenly: all of them where they fit, or else every second, third
// and so on, on from the first hour. "Now" keeps its place and any it would touch give way.
function fitWindMarks(marks: HTMLElement) {
  const spans = [...marks.children].filter(child => child instanceof HTMLElement),
    now = spans.find(span => 'now' in span.dataset),
    times = spans.filter(span => span !== now);
  for (const span of spans) span.hidden = false;
  const left = (span: HTMLElement) => span.offsetLeft,
    right = (span: HTMLElement) => span.offsetLeft + span.offsetWidth,
    clear = (a: HTMLElement, b: HTMLElement) => right(a) + MARK_GAP <= left(b) || left(a) >= right(b) + MARK_GAP,
    hour = Math.max(
      0,
      times.findIndex(span => span.querySelector('.period')),
    ),
    every = (stride: number) => times.filter((_, i) => (i - hour) % stride === 0),
    fits = (kept: readonly HTMLElement[]) =>
      kept.every((span, i) => {
        const next = kept[i + 1];
        return !next || clear(span, next);
      });
  let stride = 1;
  while (stride < times.length && !fits(every(stride))) stride += 1;
  const kept = new Set(every(stride)),
    shown = times.map(span => ({
      span,
      on: kept.has(span) && right(span) <= marks.clientWidth + MARK_GAP && (!now || clear(span, now)),
    }));
  for (const { span, on } of shown) span.hidden = !on;
}

// What the map views read from the card, and ask of it.
export interface MapHost extends EventTarget {
  readonly root: ShadowRoot;
  readonly isConnected: boolean;
  readonly config: CardConfig | undefined;
  readonly readHass: HomeAssistant | undefined;
  readonly update: Update | undefined;
  readonly text: WeatherText | undefined;
  readonly motion: MediaQueryList | undefined;
  readonly visible: boolean;
  readonly zoom: number;
  // Its sheet, drawn again for what is chosen in it.
  readonly sheets: { renderMap(): HTMLElement | undefined };
}
export class MapViews {
  readonly card: MapHost;
  radar: Radar | undefined;
  private radarAsked: AbortController | undefined;
  private readonly coverageAsked = new Map<HTMLElement, AbortController>();
  shortForecast: { at: number; data: RadarForecast | null } | undefined;
  private forecastAsked: AbortController | undefined;
  // The wind across the map views from Open-Meteo, grid by grid (see loadGrid), and the
  // forecast's precipitation grids whose hours are still coming.
  winds: WindGrid[] = [];
  readonly rainComing = new WeakSet<WindGrid>();
  // Where the large map looks once moved or zoomed; undefined, home as it opened.
  centre: MapCentre | undefined;
  // The layer chosen for the large map; undefined, the one that matters most (see mapKind).
  layer: MapLayerKind | undefined;
  // The zoom it opened at (see opensAt), and whether its timeline has yet to start by itself.
  opens: number | undefined;
  starts = false;
  // Its pin: large as it opens, small once the map is tapped, large with its card once the pin is.
  pin: MapPin = 'open';
  // The span its precipitation timeline covers, and the switch between them.
  rainSpan: RainSpan = '1h';
  // Whether the radar reaches home, where known (see radarReaches), for which place, and when last
  // asked: where it doesn't, the large map opens on the 12-hour forecast, as the radar would show
  // nothing there. Not known, it is asked again as the radar is, no more often than its interval.
  homeReach: { place: string; reaches: boolean | undefined; at: number } = { place: '', reaches: undefined, at: 0 };
  readonly spans = new GlassSwitch('[data-span]', option => this.chooseSpan(option.dataset['span']));
  // Whether it is being drawn where a move has just brought it (see move).
  arrived = false;
  // What each map view was last drawn from: all of it, and without the frames and the grid.
  drawn = new WeakMap<HTMLElement, { key: string; as: string; across: boolean; hours: WindHours | null | undefined }>();
  // Its live ground once MapLibre has loaded (see startGl): the map and its element, kept across
  // redraws; whether loading it has failed; the view the layers over it were drawn for; and
  // whether the camera is being set from here, or is going back home.
  gl: { map: GlMap; container: HTMLElement } | undefined;
  glPending: MapViews['gl'];
  glRequest: object | undefined;
  glLoading = false;
  glFailed = false;
  // Whether this opening's live ground has been replaced once already, after losing its context.
  glReplaced = false;
  glDrawn: MapCentre | undefined;
  glQuiet = false;
  glHome = false;
  // The colour field last shown in it.
  glField: ScalarField | undefined;
  // The large wind map's timeline: the time it shows (undefined: now), its playback while it
  // plays, and the maps drawn, to draw again for another hour while held still.
  timelineTime: number | undefined;
  timelinePlay = 0;
  // Whether its bar is being dragged.
  timelineScrub = false;
  windMaps: { canvas: HTMLCanvasElement; map: WindMap }[] = [];
  radarFrame = -1;
  private readonly radarPreviews = new Map<HTMLElement, RadarPreview<TileFrame>>();
  // The small map's pictures of its ground, by look and view (see drawStill); null where none could
  // be drawn; and the one being drawn.
  stills = new Map<string, GroundStill | null>();
  stillDrawing = false;
  // The picture last shown, which a view drawn afresh takes up until its own comes.
  lastStill: GroundStill | undefined;
  constructor(card: MapHost) {
    this.card = card;
  }
  // What a map view shows: the large map, the layer chosen in it; a sheet's own small map, the kind
  // it was drawn for; the tile, the one that matters most now.
  inputsOf(view: HTMLElement): MapInputs | undefined {
    const ctx = this.card.update?.ctx,
      kind = view.dataset['kind'] ?? '',
      layer = view.classList.contains('large')
        ? this.layer
        : view.closest('dialog') && isLayer(kind)
          ? kind
          : undefined;
    return ctx ? mapView(ctx, layer)?.inputs : undefined;
  }
  // The large map on show. A closed sheet keeps the markup of the last map it showed.
  largeView() {
    return this.card.root.querySelector<HTMLElement>('dialog[open] .radar.large');
  }
  // A sheet that showed the map has closed: the map's state goes with it.
  reset() {
    this.playTimeline(false);
    this.timelineTime = undefined;
    this.centre = undefined;
    this.layer = undefined;
    this.starts = false;
    this.rainSpan = '1h';
    for (const [view, asked] of this.coverageAsked)
      if (view.classList.contains('large')) {
        asked.abort();
        this.coverageAsked.delete(view);
      }
    this.forecastAsked?.abort();
    this.forecastAsked = undefined;
    this.stopGl();
  }
  // A map belongs to the sheet as soon as it is created, including while its style loads.
  stopGl() {
    this.glRequest = undefined;
    this.glLoading = false;
    for (const ground of [this.gl, this.glPending]) {
      ground?.map.remove();
      ground?.container.remove();
    }
    this.gl = undefined;
    this.glPending = undefined;
    this.glField = undefined;
  }
  // The map opens anew each time, not on a sheet that already shows it (see opensAt).
  opening() {
    this.glReplaced = false;
    this.opens = undefined;
    this.pin = 'open';
    if (this.homeReach.reaches === false) this.rainSpan = '12h';
  }
  // Finds out, once per place, whether the radar reaches home (see homeReach).
  async checkReach() {
    const { update, config } = this.card,
      ctx = update?.ctx,
      inputs = ctx ? mapView(ctx)?.inputs : undefined,
      now = Date.now();
    if (!config || !inputs || !finite(inputs.latitude) || !finite(inputs.longitude)) return;
    const place = `${inputs.latitude},${inputs.longitude}`,
      { homeReach } = this,
      again = config.radar_refresh_minutes * MINUTE;
    if (homeReach.place === place && (homeReach.reaches !== undefined || now - homeReach.at < again)) return;
    this.homeReach = { place, reaches: undefined, at: now };
    const reaches = await radarReaches(inputs.latitude, inputs.longitude);
    if (this.homeReach.place === place) this.homeReach = { place, reaches, at: now };
  }
  // Invalidates an unfinished request when radar is disabled or the card leaves the page.
  invalidateRadar() {
    for (const [view, preview] of this.radarPreviews) {
      preview.stop();
      this.drawn.delete(view);
    }
    this.radarPreviews.clear();
    this.radarAsked?.abort();
    for (const asked of this.coverageAsked.values()) asked.abort();
    this.coverageAsked.clear();
    this.radarAsked = undefined;
    this.forecastAsked?.abort();
    this.forecastAsked = undefined;
  }
  // Radar frames follow the configured interval while the page is in sight. Rendering checks
  // once a minute; visibility changes also check, so an overdue refresh needn't wait for it.
  // And, once per place, whether the radar reaches home.
  async loadRadar(now: number) {
    const { card } = this,
      config = card.config,
      enabled = () => card.isConnected && card.config?.map === 'rainviewer' && card.config.weather_layout === 'page',
      visible = () => card.visible && !document.hidden;
    if (!config || !enabled()) {
      this.invalidateRadar();
      return;
    }
    if (visible()) void this.checkReach();
    if (!visible() || this.radarAsked || (this.radar && now - this.radar.at < config.radar_refresh_minutes * MINUTE))
      return;
    const radar: Radar = { at: now, frames: this.radar?.frames ?? [] },
      asked = new AbortController();
    this.radarAsked = asked;
    try {
      radar.frames = (await radarFrames(url => fetch(url, { signal: asked.signal }))).slice(-RADAR_FRAMES);
    } catch {
      radar.failed = true;
    }
    if (this.radarAsked !== asked) return;
    this.radarAsked = undefined;
    if (!enabled()) return;
    this.radar = radar;
    if (visible()) this.draw();
  }
  // The short forecast is confined to IEM's raster and HRRR's model domain. A view outside
  // either stays on observed radar; the 12-hour view retains its worldwide forecast sources. The
  // large map takes it on its hour's timeline, live; a small map in its own loop, where it plays.
  forecastCovers(view: HTMLElement): boolean {
    const config = this.card.config;
    if (
      !config ||
      config.map_tile_url ||
      config.map !== 'rainviewer' ||
      this.inputsOf(view)?.kind !== 'precipitation' ||
      !view.classList.contains('large') ||
      !this.gl ||
      this.rainSpan !== '1h'
    )
      return false;
    const bounds = rainBounds(this.centreOf(view), view.clientWidth, view.clientHeight);
    return covers(HRRR_BOUNDS, bounds) && RAIN_MODELS.some(model => model.id === 'hrrr' && model.covers(bounds));
  }
  // Whether a small map's radar plays by itself (see RadarPreview).
  previews(config: CardConfig): boolean {
    return config.map_precipitation_animation && config.weather_animation && !this.card.motion?.matches;
  }
  shortFrames(view: HTMLElement): RadarFrame[] {
    return this.forecastCovers(view)
      ? nextRadarFrames(this.shortForecast?.data, this.radar?.frames ?? [], Date.now()).filter(
          frame => frame.time <= (this.shortForecast?.at ?? 0) + HOUR,
        )
      : [];
  }
  async loadShortForecast(now: number) {
    const views = [...this.card.root.querySelectorAll<HTMLElement>('.radar')];
    if (
      !views.some(view => this.forecastCovers(view)) ||
      this.forecastAsked ||
      (this.shortForecast && now - this.shortForecast.at < FORECAST_REFRESH)
    )
      return;
    const asked = new AbortController();
    this.forecastAsked = asked;
    const timeout = setTimeout(() => asked.abort(), FORECAST_TIMEOUT);
    let data: RadarForecast | null = null;
    try {
      data = await radarForecast(now, url => fetch(url, { signal: asked.signal }));
    } catch {
    } finally {
      clearTimeout(timeout);
    }
    if (this.forecastAsked !== asked) return;
    this.forecastAsked = undefined;
    // A failed refresh can retain a still-fresh run; nextRadarFrames independently rejects its age.
    this.shortForecast = { at: now, data: data ?? this.shortForecast?.data ?? null };
    if (this.card.isConnected && this.card.visible && !document.hidden) this.draw();
  }
  // One unavailable model tile invalidates the forecast, rather than showing an old observation
  // under a future timestamp. Retry metadata on its normal interval, never on every animation tick.
  private readonly forecastFailed = () => {
    this.shortForecast = { at: Date.now(), data: null };
    this.draw();
  };
  // Open-Meteo's wind for a map view, with the online map, unless a grid asked for within the
  // hour fits it (see fitsWind): over the small map at first, then wherever the large map
  // comes to rest, with room to move in (see windPointsFor). The view is drawn again once it
  // comes. The forecast's precipitation comes from a forecast model instead (see rainPlan),
  // drawn again with each hour that comes.
  async loadGrid(centre: MapCentre, width: number, height: number, large: boolean, source: GridSource) {
    const fresh = () =>
      this.card.config?.map !== 'rainviewer' ||
      !this.card.isConnected ||
      !this.card.visible ||
      document.hidden ||
      (large && !this.largeView()) ||
      this.winds.some(
        grid => grid.source === source && Date.now() - grid.at < REFRESH.wind && fitsWind(grid, centre, width, height),
      );
    if (fresh()) return;
    if (large) {
      const asked = this.centre;
      await new Promise(settled => setTimeout(settled, MAP_REST));
      if (this.centre !== asked || fresh()) return;
    }
    const now = Date.now();
    if (source === 'rain') {
      // The forecast's precipitation, each hour drawn as it comes, the hour now first, from the
      // finest model that answers (see loadRain).
      const plans = rainPlans(rainBounds(centre, width, height)),
        plan = plans[0];
      if (!plan) return;
      const grid: WindGrid = {
        source,
        at: now,
        bounds: windBounds(plan.points),
        step: plan.points.step,
        hours: null,
        model: plan.model.id,
      };
      this.winds = [...this.winds.slice(1 - WIND_GRIDS), grid];
      this.rainComing.add(grid);
      // The first hour is drawn at once; those after it a few at a time, as each draw remakes
      // every view.
      let waiting = false;
      try {
        const got = await loadRain(plans, now, (hours, used) => {
          const first = grid.hours === null;
          Object.assign(grid, {
            hours,
            model: used.model.id,
            step: used.points.step,
            bounds: windBounds(used.points),
          });
          if (first) this.draw();
          else if (!waiting) {
            waiting = true;
            setTimeout(() => {
              waiting = false;
              this.draw();
            }, RAIN_REDRAW);
          }
        });
        grid.hours = got?.hours ?? null;
      } catch {}
      this.rainComing.delete(grid);
      if (!grid.hours) grid.at = now - REFRESH.wind + MINUTE;
      this.draw();
      return;
    }
    const points = windPointsFor(centre, width, height, large),
      grid: WindGrid = { source, at: now, bounds: windBounds(points), step: points.step, hours: null };
    this.winds = [...this.winds.slice(1 - WIND_GRIDS), grid];
    try {
      grid.hours = await (source === 'air' ? openMeteoAir(points) : openMeteoWind(points));
    } catch {
      grid.at = now - REFRESH.wind + MINUTE;
    }
    this.draw();
  }
  // The wind a map view shows: the latest grid that fits it; while that loads, the latest with
  // the view's middle on it.
  windGrid(view: HTMLElement, source: GridSource = 'forecast'): WindGrid | undefined {
    const centre = this.centreOf(view),
      { latitude, longitude } = centre,
      loaded = this.winds.filter(grid => grid.source === source && grid.hours !== null);
    return (
      loaded.findLast(grid => fitsWind(grid, centre, view.clientWidth, view.clientHeight)) ??
      loaded.findLast(grid =>
        covers(grid.bounds, { north: latitude, south: latitude, west: longitude, east: longitude }),
      )
    );
  }
  // The zoom the large map opens at, worked out as it does and kept until it next does: a new
  // layer or a change in the weather leaves it where it is.
  opensAt(): number {
    if (this.opens !== undefined) return this.opens;
    const { update, motion, config } = this.card,
      ctx = update?.ctx,
      zoom = this.zoomOf((ctx && mapView(ctx, this.layer)?.kind) ?? 'precipitation');
    this.opens = zoom;
    this.starts = Boolean(config?.weather_animation) && !motion?.matches;
    return zoom;
  }
  // How far out a layer looks with the weather as it is now (see openingZoom).
  zoomOf(kind: MapLayerKind): number {
    const ctx = this.card.update?.ctx;
    return openingZoom(kind, ctx ? { hourly: ctx.hourly, now: ctx.now, outlook: ctx.rainOutlook } : {});
  }
  // Where a map view looks: home, as far out as its layer and the weather call for (the large map
  // as it opened), or wherever the large map was moved to. A sheet's own map of the wind stands at
  // the screen's scale rather than the page's, and takes in the region the wind's large map opens on.
  centreOf(view: HTMLElement): MapCentre {
    const large = view.classList.contains('large'),
      inputs = this.inputsOf(view),
      kind = inputs?.kind ?? 'precipitation',
      sheetWind = kind === 'wind' && !large && view.closest('dialog') !== null;
    return (
      (large ? this.centre : undefined) ?? {
        latitude: inputs?.latitude ?? Number.NaN,
        longitude: inputs?.longitude ?? Number.NaN,
        zoom: large
          ? this.opensAt()
          : sheetWind
            ? this.zoomOf(kind)
            : Math.min(this.zoomOf(kind), MAP_ZOOMS.small) + PAGE_STEPS,
      }
    );
  }
  // The large map's live ground: MapLibre over OpenFreeMap's tiles (see weather-map-gl), its
  // element kept across redraws (see draw). As its camera moves, the layers over it follow
  // as one motion, and once it rests they are drawn again for where it came to.
  async startGl() {
    if (this.glLoading || this.glFailed || this.gl) return;
    this.glLoading = true;
    const request = {};
    this.glRequest = request;
    const maplibre = await loadMapLibre(this.card.root),
      view = this.largeView();
    if (this.glRequest !== request) return;
    if (!maplibre || !view || !this.card.isConnected) {
      this.glFailed = !maplibre;
      this.glLoading = false;
      return;
    }
    const container = document.createElement('div'),
      centre = this.centreOf(view);
    container.className = 'map-gl';
    view.prepend(container);
    const map = newMap(maplibre, {
      container,
      style: GL_STYLE,
      center: [centre.longitude, centre.latitude],
      zoom: centre.zoom - GL_ZOOM_OFFSET,
      minZoom: MAP_ZOOMS.least - GL_ZOOM_OFFSET,
      maxZoom: MAP_ZOOMS.most - GL_ZOOM_OFFSET,
      attributionControl: false,
      keyboard: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    if (!map) {
      container.remove();
      this.glFailed = true;
      this.glLoading = false;
      return;
    }
    this.glPending = { map, container };
    // Browsers keep only so many WebGL contexts, taking the oldest when a page asks for another, and
    // may take a hidden page's. One given back MapLibre draws again. One still gone a moment after
    // the page is in view is replaced by a new map; if that loses its own too, the card's own tiles
    // stand in for the live ground.
    let lostWait: number | undefined;
    const replace = () => {
      if (this.glRequest !== request) return;
      const again = this.glReplaced;
      this.stopGl();
      this.glReplaced = true;
      this.glFailed = again;
      void this.startGl();
      const shown = this.largeView();
      if (shown) this.drawn.delete(shown);
      this.draw();
    };
    const waitInView = () => {
      window.clearTimeout(lostWait);
      lostWait = window.setTimeout(replace, GL_LOST_WAIT);
    };
    const forget = () => {
      window.clearTimeout(lostWait);
      document.removeEventListener('visibilitychange', waitInView);
    };
    map.on('webglcontextlost', () => {
      if (document.hidden) document.addEventListener('visibilitychange', waitInView, { once: true });
      else waitInView();
    });
    map.on('webglcontextrestored', forget);
    map.on('remove', forget);
    // Its own pinch stays on for the styles it gives the ground, which keep the page from zooming
    // under two fingers, but never sees them: the card's pinch takes them first (see bindPinch).
    map.touchZoomRotate.disableRotation();
    map.on('idle', () => {
      this.showRadarFrame();
      this.showGapNote();
    });
    map.on('move', () => {
      const shown = this.largeView(),
        drawn = this.glDrawn;
      if (this.glQuiet || !shown || !drawn) return;
      const at = map.project([drawn.longitude, drawn.latitude]);
      showMotion(
        shown,
        {
          dx: at.x - shown.clientWidth / 2,
          dy: at.y - shown.clientHeight / 2,
          scale: 2 ** (map.getZoom() + GL_ZOOM_OFFSET - drawn.zoom),
        },
        false,
      );
    });
    // A trackpad's two fingers move the ground as they go, and it is drawn again once they rest;
    // a pinch zooms it as far as the fingers spread, held from being drawn again until it lets go
    // (see bindPinch), and a mouse wheel's notches zoom it the ground's own way.
    let panning = 0;
    map.on('remove', () => window.clearTimeout(panning));
    const settle = () => {
      const shown = this.largeView(),
        drawn = this.glDrawn;
      if (this.glQuiet || !shown) return;
      const { lng, lat } = map.getCenter(),
        zoom = map.getZoom() + GL_ZOOM_OFFSET,
        home = this.glHome;
      this.glHome = false;
      if (home) this.move(undefined);
      else if (
        !drawn ||
        Math.abs(lat - drawn.latitude) + Math.abs(lng - drawn.longitude) > GL_SAME ||
        Math.abs(zoom - drawn.zoom) > GL_SAME
      )
        this.move({ latitude: lat, longitude: lng, zoom });
      // Where it began, as after a resize: nothing to draw again, and the motion is let go.
      else restMotion(shown);
    };
    const pinch = bindPinch(
      container,
      map,
      { least: MAP_ZOOMS.least - GL_ZOOM_OFFSET, most: MAP_ZOOMS.most - GL_ZOOM_OFFSET },
      settle,
    );
    map.on('moveend', () => {
      if (!panning && !pinch.held) settle();
    });
    container.addEventListener(
      'wheel',
      event => {
        if (event.ctrlKey || notched(event)) return;
        event.preventDefault();
        event.stopPropagation();
        window.clearTimeout(panning);
        panning = window.setTimeout(() => {
          panning = 0;
          settle();
        }, MOTION.rest);
        // In the map's own px, which the card's zoom scales.
        const ratio = container.getBoundingClientRect().width / container.clientWidth || 1;
        map.panBy([event.deltaX / ratio, event.deltaY / ratio], { animate: false });
      },
      { capture: true, passive: false },
    );
    // It takes over once its style and first tiles have come, the card's own tiles in front till
    // then; if the sheet has closed meanwhile, it goes.
    map.on('load', () => {
      if (this.glRequest !== request) return;
      this.glLoading = false;
      const shown = this.largeView();
      if (!shown || !this.card.isConnected) {
        this.stopGl();
        return;
      }
      this.glPending = undefined;
      this.gl = { map, container };
      this.drawn.delete(shown);
      this.draw();
    });
  }
  // A colour field in the live ground, made into an image only when it is a new one.
  showGlField(map: GlMap, field: ScalarField | undefined, stops: readonly Stop[]) {
    if (field === this.glField) return;
    this.glField = field;
    showField(map, field ? fieldImage(field, stops) : null);
  }
  // Moves the large map to `centre`, or back home, and draws it there. Drawn again, its layer is a
  // new one; left as it was, where a motion ended where it began, the motion is let go.
  move(centre: MapCentre | undefined) {
    const view = this.largeView();
    view?.removeAttribute('data-dragging');
    this.centre = centre;
    this.arrived = true;
    this.draw();
    this.arrived = false;
    if (view) restMotion(view);
  }
  // A layer chosen for the large map, drawn in its sheet, which keeps the focus on the menu's
  // button.
  showLayer(layer: MapLayerKind) {
    const { card } = this;
    this.playTimeline(false);
    this.timelineTime = undefined;
    this.layer = layer;
    card.sheets.renderMap()?.querySelector<HTMLElement>('[data-layers]')?.focus();
  }
  // Home's wind hour by hour from the forecast, where only home's is known: the hours of the
  // timeline the forecast has, or else the reading now.
  homeWind(speed: number, bearing: number, unit: string): WindHours | null {
    const now = Date.now(),
      hours = (this.card.update?.ctx.hourly ?? []).filter(
        entry =>
          entry.time > now - (WIND_HOURS.before + 1) * HOUR &&
          entry.time <= now + WIND_HOURS.after * HOUR &&
          finite(entry.wind_speed) &&
          finite(entry.wind_bearing),
      );
    if (hours.length > 1)
      return {
        times: hours.map(entry => entry.time),
        fields: hours.map(entry =>
          steadyWind(windMetersPerSecond(entry.wind_speed ?? 0, unit), Number(entry.wind_bearing)),
        ),
      };
    return finite(speed) && finite(bearing)
      ? { times: [now], fields: [steadyWind(windMetersPerSecond(speed, unit), bearing)] }
      : null;
  }
  // Shows the large map's pin as it is now, and its card with what the weather is now.
  setPin(view: HTMLElement, pin: MapPin) {
    this.pin = pin;
    view.dataset['pin'] = pin;
    const { update, config } = this.card,
      ctx = update?.ctx,
      conditionName = update?.named ?? conditionLabel,
      card = view.querySelector<HTMLElement>('.map-card'),
      inputs = this.inputsOf(view);
    if (!card || !ctx || !inputs) return;
    card.hidden = pin !== 'card';
    if (card.hidden) return;
    const { latitude, longitude, condition, low, high } = inputs,
      home = Number(card.parentElement?.dataset['x']),
      place = ctx.placeName || config?.name || ctx.attrs.friendly_name || say('Home'),
      time = clockFormat(ctx).format(Date.now()),
      temperature = ctx.attrs.temperature,
      degrees = (value: string) => (value === '' ? '' : `${Math.round(Number(value))}°`);
    card.dataset['side'] = home + MAP_CARD.reach > view.clientWidth ? 'left' : 'right';
    card.innerHTML = `<div class="map-card-top"><div><b>${esc(place)}</b><time>${esc(time)}</time></div><strong>${finite(temperature) ? `${Math.round(temperature)}°` : ''}</strong></div><div class="map-card-now"><span>${esc(conditionName(condition))}</span><span>${say('H:{high} L:{low}', { high: degrees(high), low: degrees(low) })}</span></div><a href="https://www.openstreetmap.org/?mlat=${latitude}&amp;mlon=${longitude}#map=${MAP_CARD.zoom}/${latitude}/${longitude}" target="_blank" rel="noreferrer">${say('Open in Maps…')}</a>`;
  }
  // The large map's timeline, where it has one: the wind's hours; for precipitation, over the
  // last two hours the radar's frames, ten minutes apart, or over the next 12 hours the
  // forecast's, hour by hour over its quarters (see rainSpan).
  timelineOf(view: HTMLElement): Timeline | null {
    if (!view.classList.contains('large')) return null;
    const kind = this.inputsOf(view)?.kind;
    if (kind === 'wind') {
      const hours = this.windHoursOf(view);
      return hours && { times: hours.times, step: HOUR, title: phrase('Wind Speed'), clock: false, span: undefined };
    }
    if (kind !== 'precipitation' || this.card.config?.map !== 'rainviewer') return null;
    if (this.rainSpan === '12h')
      return this.windGrid(view, 'rain')?.hours
        ? { times: rainTimeline(Date.now()), step: HOUR, title: phrase('Forecast'), clock: false, span: '12h' }
        : null;
    const frames = this.radar?.frames ?? [],
      ahead = this.shortFrames(view);
    return frames.length > 1
      ? {
          times: [...frames, ...ahead].map(frame => frame.time),
          step: RADAR_STEP,
          title: phrase('Forecast'),
          clock: true,
          span: '1h',
        }
      : null;
  }
  // Shows the timeline's time: the bar filled to it, its day (and time) named, the streaks drawn
  // again for it while they are held still, and the radar's frame or the forecast's hour for it.
  syncWindTime() {
    const ctx = this.card.update?.ctx;
    for (const timeline of this.card.root.querySelectorAll<HTMLElement>('.wind-time')) {
      const view = timeline.closest<HTMLElement>('.radar'),
        shown = view && this.timelineOf(view);
      if (!view || !shown || !ctx) continue;
      const time = this.timelineTime ?? Date.now(),
        at = timelineAt(shown, time),
        first = shown.times[0] ?? time;
      timeline.style.setProperty('--done', percent(clamp((time - first) / timelineDuration(shown))));
      if (shown.span === '1h') {
        const forecast = time > (this.radar?.frames.at(-1)?.time ?? Infinity) && this.shortFrames(view).length > 0;
        view.toggleAttribute('data-forecast', forecast);
      }
      const track = timeline.querySelector('.wind-track');
      track?.setAttribute('aria-valuenow', String(Math.round(at)));
      const day = timeline.querySelector('.wind-when span');
      if (day)
        day.textContent = dateFormat(
          ctx.locale,
          shown.clock
            ? { weekday: 'long', hour: 'numeric', minute: '2-digit', timeZone: ctx.timeZone, hour12: ctx.hour12 }
            : { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: ctx.timeZone },
        ).format(shown.times[Math.round(at)] ?? time);
      timeline.querySelector('.wind-play')?.setAttribute('aria-label', this.timelinePlay ? say('Pause') : say('Play'));
      timeline.toggleAttribute('data-playing', Boolean(this.timelinePlay));
      if (shown.span === '12h') this.drawRainAt(view, time);
    }
    this.windMaps = this.windMaps.filter(({ canvas }) => canvas.isConnected);
    for (const { canvas, map } of this.windMaps) if (canvas.closest('.large')) map.update();
    this.showRadarFrame();
    this.showGapNote();
  }
  // The forecast's precipitation over the large map at `time`, blended between its quarters: live,
  // on the GPU (see rain-gl); on the card's own tiles, in a canvas drawn again only when it has
  // moved on by a quarter of a quarter.
  drawRainAt(view: HTMLElement, time: number) {
    const hours = this.windGrid(view, 'rain')?.hours,
      live = this.gl?.map;
    if (!hours) return;
    const at = rainSlot(hours, time);
    if (live) {
      pickRainSlot(live, at);
      return;
    }
    const canvas = view.querySelector(':scope > .map-pan:not(.map-old) .map-field'),
      slot = Math.round(at * FALLBACK_STEPS),
      step = String(slot),
      // Paint the same quarter-step used by the cache, so seeking to an exact hour cannot keep
      // a nearby blend that happened to round to the same step.
      field = fieldAt(hours.precipitation ?? [], slot / FALLBACK_STEPS);
    if (!(canvas instanceof HTMLCanvasElement) || !field || canvas.dataset['slot'] === step) return;
    canvas.dataset['slot'] = step;
    drawField(
      canvas,
      field,
      { ...this.centreOf(view), width: view.clientWidth, height: view.clientHeight },
      PRECIPITATION,
      view.querySelector<HTMLCanvasElement>(':scope > .map-pan:not(.map-old) .map-coverage') ?? undefined,
    );
  }
  // The hours a wind map view shows (see draw).
  windHoursOf(view: HTMLElement): WindHours | null {
    const { kind = '', speed = '', bearing = '', unit = '' } = this.inputsOf(view) ?? {};
    if (kind !== 'wind') return null;
    const online = this.card.config?.map === 'rainviewer' ? (this.windGrid(view)?.hours ?? null) : null;
    return online ?? (speed !== '' && bearing !== '' ? this.homeWind(Number(speed), Number(bearing), unit) : null);
  }
  // Its precipitation timeline turned to a span, from its start.
  chooseSpan(span: string | undefined) {
    if (span !== '1h' && span !== '12h') return;
    haptic(this.card, 'selection');
    this.playTimeline(false);
    this.timelineTime = undefined;
    this.rainSpan = span;
    this.draw();
    this.largeView()?.querySelector<HTMLElement>(`[data-span="${span}"]`)?.focus();
  }
  // The timeline's controls: the play button, the span switch, and the bar, dragged or stepped
  // with the arrow keys.
  bindTimeline(view: HTMLElement, timeline: Timeline) {
    const { card } = this,
      track = view.querySelector<HTMLElement>('.wind-track'),
      marks = view.querySelector<HTMLElement>('.wind-marks'),
      { times } = timeline,
      first = times[0],
      last = times.length - 1;
    if (marks) fitWindMarks(marks);
    view.querySelector('.wind-play')?.addEventListener('click', () => {
      haptic(card, 'light');
      this.playTimeline(!this.timelinePlay);
    });
    const spans = view.querySelector<HTMLElement>('.map-span');
    if (spans) this.spans.attach(spans);
    if (!track || first === undefined) return;
    const seek = (event: PointerEvent) => {
      const box = track.getBoundingClientRect();
      this.timelineTime = Math.min(
        times[last] ?? first,
        first + clamp((event.clientX - box.left) / box.width) * timelineDuration(timeline),
      );
      this.syncWindTime();
    };
    track.addEventListener('pointerdown', event => {
      this.playTimeline(false);
      this.timelineScrub = true;
      track.setPointerCapture(event.pointerId);
      seek(event);
    });
    track.addEventListener('pointermove', event => {
      if (track.hasPointerCapture(event.pointerId)) seek(event);
    });
    const release = () => {
      this.timelineScrub = false;
    };
    track.addEventListener('pointerup', release);
    track.addEventListener('pointercancel', release);
    track.addEventListener('keydown', event => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (!step) return;
      event.preventDefault();
      this.playTimeline(false);
      const at = Math.round(timelineAt(timeline, this.timelineTime ?? Date.now())) + step;
      this.timelineTime = times[Math.min(last, Math.max(0, at))] ?? first;
      this.syncWindTime();
    });
    this.syncWindTime();
    // Precipitation's plays by itself as the map opens, once it has come.
    if (this.starts) {
      this.starts = false;
      if (timeline.span) this.playTimeline(true);
    }
    this.showGapNote();
  }
  // The unavailable note follows the displayed source, including the fallback canvas.
  showGapNote() {
    const map = this.gl?.map,
      view = this.largeView(),
      note = view?.querySelector<HTMLElement>('.map-gaps');
    if (!note || !view) return;
    const gaps = map
      ? this.rainSpan === '12h'
        ? rainGapsInView(map)
        : !view.hasAttribute('data-forecast') && gapsInView(map)
      : view.querySelector<HTMLElement>(':scope > .map-pan:not(.map-old) .map-coverage')?.dataset['gaps'] === 'true';
    note.hidden = !gaps;
  }
  // Plays the timeline at two frames a second, round and round, until paused or the sheet closes:
  // the timeline as it is at each step, as frames are added to it while it plays. Where its frames
  // haven't all come, it waits where it is till they have (see PLAY_PATIENCE).
  playTimeline(play: boolean) {
    cancelAnimationFrame(this.timelinePlay);
    this.timelinePlay = 0;
    if (play) {
      const view = this.largeView();
      if (!view || (this.timelineOf(view)?.times.length ?? 0) === 0) return;
      let last = 0,
        waited = 0;
      const step = (now: number) => {
        const shown = this.largeView(),
          timeline = shown ? this.timelineOf(shown) : null,
          first = timeline?.times[0];
        if (!shown || !timeline || first === undefined) {
          this.playTimeline(false);
          return;
        }
        const since = last ? now - last : 0,
          ready = this.framesReady(shown, timeline);
        last = now;
        waited = ready ? 0 : waited + since;
        this.timelinePlay = requestAnimationFrame(step);
        if (ready || waited >= PLAY_PATIENCE) {
          // To the end of the last frame's part of the bar, then from the start again.
          const end = first + timelineDuration(timeline),
            next = (this.timelineTime ?? Date.now()) + (since / SECOND) * WIND_PLAYBACK * timeline.step;
          this.timelineTime = next >= end || next < first ? first : next;
        }
        this.syncWindTime();
      };
      this.timelinePlay = requestAnimationFrame(step);
    }
    this.syncWindTime();
  }
  // Whether every frame of a timeline has come, so playing it shows each in turn: the forecast's
  // once all its hours have; the radar's on the live map once each frame has over the view, and
  // not while the live map is on its way, the card's own tiles being let go then; on those tiles
  // without it, once every frame's pictures have, all asked for at once.
  framesReady(view: HTMLElement, timeline: Timeline): boolean {
    if (timeline.span === '12h') {
      const grid = this.windGrid(view, 'rain');
      return !grid || !this.rainComing.has(grid);
    }
    if (timeline.span !== '1h') return true;
    if (this.gl && view.hasAttribute('data-gl')) return radarLoaded(this.gl.map);
    if (this.glLoading) return false;
    const frames = [...view.querySelectorAll('[data-frame]')];
    for (const frame of frames) loadFrame(frame);
    return frames.every(frame =>
      [...frame.querySelectorAll('img')].every(image => image.hasAttribute('src') && image.complete),
    );
  }
  // The streaks over a view drawn with the wind at each place, or near home where only home's is
  // known (`across` says which).
  startStreaks(view: HTMLElement, canvas: HTMLCanvasElement, wind: WindHours, look: Streaks) {
    const { centre, width, height, large, home, across, animate } = look,
      map = drawWindMap(
        canvas,
        wind,
        {
          ...centre,
          width,
          height,
          // The card's zoom, which the large map's sheet, over the page, doesn't take.
          scale: (window.devicePixelRatio || 1) * (large ? 1 : this.card.zoom),
          reach: across ? undefined : HOME_WIND_REACH,
          home,
        },
        {
          // With animation, always; large, also while its timeline plays or is dragged.
          moving: () => animate || (large && (this.timelinePlay !== 0 || this.timelineScrub)),
          // Not while the map moves, hiding them (see the styles).
          active: () =>
            this.card.visible &&
            !document.hidden &&
            !canvas.closest('.map-old') &&
            (!large || this.largeView() === view) &&
            !view.hasAttribute('data-dragging'),
          hour: () => windHour(wind, (large ? this.timelineTime : undefined) ?? Date.now()),
          // Where a move has just brought the large map, its streaks grow back from nothing.
          fresh: large && this.arrived,
        },
      );
    // A small map's are drawn over with each of its redraws, and nothing else lets them go.
    this.windMaps = [...this.windMaps.filter(each => each.canvas.isConnected), { canvas, map }];
  }
  // The live ground goes back under the layers, its camera set to where they were drawn for
  // unless it is already there.
  placeGround(view: HTMLElement, gl: NonNullable<MapViews['gl']>, centre: MapCentre) {
    // Quiet, as resizing and setting its camera report moves of their own.
    view.prepend(gl.container);
    this.glDrawn = centre;
    this.glQuiet = true;
    gl.map.resize();
    gl.map.setMaxZoom(MAP_ZOOMS.most - GL_ZOOM_OFFSET);
    const at = gl.map.getCenter();
    if (
      Math.abs(at.lat - centre.latitude) + Math.abs(at.lng - centre.longitude) > GL_SAME ||
      Math.abs(gl.map.getZoom() + GL_ZOOM_OFFSET - centre.zoom) > GL_SAME
    )
      gl.map.jumpTo({ center: [centre.longitude, centre.latitude], zoom: centre.zoom - GL_ZOOM_OFFSET });
    this.glQuiet = false;
  }
  dropStill(key: string) {
    const kept = this.stills.get(key);
    this.stills.delete(key);
    if (kept) letGo(kept);
    if (kept === this.lastStill) this.lastStill = undefined;
  }
  dropStills() {
    for (const key of this.stills.keys()) this.dropStill(key);
  }
  // The picture of a small map's ground for a look and view (see drawStill): undefined while one is
  // on its way, null where none could be drawn.
  stillFor(view: MapStillView, look: GroundLook): GroundStill | null | undefined {
    const { latitude, longitude, zoom, width, height, pixelRatio } = view,
      key = `${look}|${width}x${height}|${pixelRatio}|${latitude},${longitude},${zoom}`,
      still = this.stills.get(key);
    if (still === undefined) void this.drawStill(key, view, look);
    return still;
  }
  // Draws the small map's ground for a look and view, one at a time, keeping the last few, and
  // fills the view again once it has it. Until then the ground it had stays.
  async drawStill(key: string, view: MapStillView, look: GroundLook) {
    const { card } = this;
    if (this.stillDrawing || !card.visible || document.hidden) return;
    this.stillDrawing = true;
    const still = await groundStill(card.root, view, look);
    this.stillDrawing = false;
    // The card went while it was being drawn, and nothing would let it go.
    if (!card.isConnected) {
      if (still) letGo(still);
      return;
    }
    this.stills.set(key, still);
    for (const old of this.stills.keys()) {
      if (this.stills.size <= STILLS_KEPT) break;
      this.dropStill(old);
    }
    for (const view of card.root.querySelectorAll<HTMLElement>('.radar:not(.large)')) this.drawn.delete(view);
    this.draw();
  }
  // The temperature or AQI across a map view this hour, or the forecast's precipitation over the
  // large map's 12 hours.
  fieldOf(kind: string, hours: WindHours | null | undefined, rainHours: boolean): ScalarField | undefined {
    if (kind === 'temperature') return hours?.temperature?.[Math.round(windHour(hours, Date.now()))];
    if (kind === 'air_quality') return hours?.aqi?.[0];
    return rainHours && hours
      ? fieldAt(hours.precipitation ?? [], rainSlot(hours, this.timelineTime ?? Date.now()))
      : undefined;
  }
  // Fills one map view for its kind (see mapView), unless it is being moved or nothing about it
  // has changed.
  drawView(view: HTMLElement, config: CardConfig, allFrames: RadarFrame[]) {
    const width = view.clientWidth,
      height = view.clientHeight;
    if (!width || !height) return;
    const inputs = this.inputsOf(view);
    if (!inputs) return;
    const { latitude, longitude, kind, badge, tint, bearing, unit, low, high, condition, temperatureUnit } = inputs,
      { dark, pinName } = inputs,
      radar = kind === 'precipitation' && config.map === 'rainviewer';
    // Being dragged, the large map moves with the pointer and is drawn again once let go.
    const large = view.classList.contains('large'),
      centre = this.centreOf(view),
      moved = large && this.centre !== undefined;
    if (view.hasAttribute('data-dragging')) return;
    // Large, with the online map and no tiles of the user's own, the ground is drawn live once
    // MapLibre has loaded (see startGl); the card's own tiles until then, or without it.
    const live = large && config.map === 'rainviewer' && !config.map_tile_url;
    if (live && !this.gl) void this.startGl();
    // Small, the radar plays by itself where set to (see RadarPreview): its next hour while rain is
    // falling where the short forecast covers the place, and otherwise the forecast's hours.
    const gl = live ? this.gl : undefined,
      preview = !large && radar && this.previews(config),
      ahead = radar && gl ? this.shortFrames(view) : [],
      outlook = this.card.update?.ctx.rainOutlook,
      // Undecided, it rests on the radar now until the minute forecast comes.
      radarLoop = preview && outlook === 'now',
      hoursLoop = preview && outlook !== undefined && !radarLoop,
      frames = radar ? [...allFrames, ...ahead] : [];
    // With the online map, wind and temperature come from a forecast grid over the view, the
    // AQI from one of the air (see loadGrid).
    // A small map playing the forecast's hours takes its precipitation too.
    const rainHours = large && radar && this.rainSpan === '12h',
      source: GridSource = kind === 'air_quality' ? 'air' : rainHours || hoursLoop ? 'rain' : 'forecast',
      gridded =
        config.map === 'rainviewer' &&
        (kind === 'wind' || kind === 'temperature' || kind === 'air_quality' || rainHours || hoursLoop);
    if (gridded) void this.loadGrid(centre, width, height, large, source);
    // The wind across the map when the online map has it; else home's, drawn near home only.
    const { card } = this,
      sun = card.update?.sun,
      grid = gridded ? this.windGrid(view, source) : undefined,
      across = kind === 'wind' ? (grid?.hours ?? null) : null,
      wind = this.windHoursOf(view),
      // The streaks move once the map is opened, and on the card only if set to.
      animate = config.weather_animation && !card.motion?.matches && (large || config.map_wind_animation);
    // Everything drawn from; the frames and the wind's grid can change without touching what's
    // under them.
    const drawnAs = JSON.stringify({
        source: config.map,
        tiles: config.map_tile_url,
        overlay: config.map_layers?.[kind],
        live: Boolean(gl),
        animate,
        preview,
        rainHours,
        size: [Math.round(width), Math.round(height)],
        inputs,
        sun: sun?.state,
        moved,
        centre,
      }),
      key = `${drawnAs}|${frames.map(frame => frame.url).join()}|${grid ? [grid.at, grid.bounds.north, grid.bounds.west, grid.step].join() : ''}`,
      was = this.drawn.get(view);
    // Hours arrive as new snapshots within the same grid. Keeping only its location and request
    // time in the cache would leave the live renderer bound to the first hour for the whole loop.
    if (was?.key === key && was.hours === grid?.hours) return;
    // Only the wind across the map is new: the streaks carry on with it as they are.
    const flowing = this.windMaps.find(
      ({ canvas }) => canvas.isConnected && canvas.closest('.map-pan:not(.map-old)')?.parentElement === view,
    );
    const same = was?.as === drawnAs;
    this.drawn.set(view, { key, as: drawnAs, across: Boolean(across), hours: grid?.hours });
    if (across && flowing && same && was.across) {
      flowing.map.retarget(across);
      return;
    }
    // Home's place on the map, which the pin, the wash of colour and the streaks follow.
    const home = pointOf(centre, width, height, latitude, longitude),
      // The temperature or AQI across the map, in its scale's colours, this hour; for these the
      // base map is pale, and the colours multiply into it (see the styles).
      // The weather's icon in the precipitation pin, the night's after dark, whatever the theme.
      { night } = sceneCondition({ state: condition }, sun),
      stops = kind === 'air_quality' ? AQI_US : temperatureUnit === UNITS.celsius ? TEMPERATURE_C : TEMPERATURE_F,
      field = this.fieldOf(kind, grid?.hours, rainHours);
    // The ground's look follows the theme, not the sky: dark on a dark theme, even on a sunny
    // afternoon. The wind's is its own, greyer on a map that fills the screen. On a light theme,
    // temperature and the AQI's stay pale under their colours, the small map's from the start, so
    // it needs drawing once. A sheet's own map is drawn closer (see groundStill).
    const sheetMap = !large && view.closest('dialog') !== null,
      look: GroundLook =
        kind === 'wind'
          ? large && view.closest('[data-full]')
            ? 'windFull'
            : sheetMap
              ? 'windSheet'
              : 'wind'
          : sheetMap
            ? 'sheet'
            : dark
              ? 'night'
              : (field || !large) && kind !== 'precipitation'
                ? 'field'
                : 'pale';
    // Small, with the online map and no tiles of the user's own, the ground is a picture, once
    // drawn (see drawStill); OpenStreetMap's tiles where it can't be.
    const pictured = !large && config.map === 'rainviewer' && !config.map_tile_url,
      pixelRatio = (window.devicePixelRatio || 1) * card.zoom,
      wanted = pictured ? this.stillFor({ ...centre, width, height, pixelRatio }, look) : null;
    // A new ground is on its way: what's shown stays until it comes.
    if (wanted === undefined && view.querySelector('.map-still')) {
      this.drawn.delete(view);
      return;
    }
    // The tiles replaced meanwhile, this view has nothing shown: it takes up the last.
    const still = wanted === undefined ? this.lastStill : wanted;
    if (still) this.lastStill = still;
    // A small map's one frame, painted into a canvas.
    const held = large ? null : view.querySelector<HTMLCanvasElement>('canvas.radar-layer.frame[data-on]'),
      newest = frames[this.radarFrame],
      { paint, tilesOf } = radarPainter(centre, width, height, look);
    // Only the radar has a later frame: the small map stays as it is, and that comes in over it.
    if (same && held && newest && !preview) {
      crossRadar(held, this.radarFrame, canvas => paint(canvas, newest));
      return;
    }
    // Large, the timeline: the wind's, or precipitation's (see timelineOf).
    const timeline = large ? this.timelineOf(view) : null,
      streaks = wind
        ? `<canvas class="wind-streaks"${across ? '' : ` data-near style="--reach:${HOME_WIND_REACH}px"`}${large && this.arrived ? ' data-arriving' : ''}></canvas>`
        : '';
    // Where the AQI has no reading of its own, the pin takes home's from the field.
    const homeAqi =
      kind === 'air_quality' && badge === '' && field ? gridAt(field, field.values, latitude, longitude) : Number.NaN;
    const before = large ? view.querySelector<HTMLElement>(':scope > .map-pan:not(.map-old)') : null,
      // Large, the radar's frame its timeline shows; only that one's tiles load at first.
      shownFrame = timeline?.span === '1h' ? Math.round(timelineAt(timeline, this.timelineTime ?? Date.now())) : -1;
    this.radarPreviews.get(view)?.stop();
    this.radarPreviews.delete(view);
    view.innerHTML = mapMarkup({
      config,
      width,
      height,
      large,
      centre,
      moved,
      home,
      kind,
      badge,
      tint,
      pinName,
      // The wind's pin names where it blows from and its unit too, where the map is large.
      pin:
        kind === 'wind'
          ? `<small>${esc(windDirection(bearing === '' ? undefined : Number(bearing), card.text?.compass))}</small>${badge}<small>${esc(unit)}</small>`
          : badge,
      live: Boolean(gl),
      pictured,
      still,
      radar,
      rainHours,
      frames,
      shownFrame,
      latestFrame: this.radarFrame,
      field: Boolean(field),
      streaks,
      overlay: config.map_layers?.[kind],
      shown: finite(homeAqi) ? String(Math.round(homeAqi)) : badge,
      reading: badge === '' ? Number.NaN : Number(badge),
      low: low === '' ? Number.NaN : Number(low),
      high: high === '' ? Number.NaN : Number(high),
      stops,
      celsius: value => convertUnit('temperature_unit', value, temperatureUnit, UNITS.celsius),
      condition,
      night,
      unit,
      windWord: card.text?.('wind') ?? 'Wind',
      // Live, the radar's frames come in the forecast's colours; on the card's own tiles, in the
      // radar's own.
      colours: kind === 'precipitation' ? (rainHours || !radar || gl ? PRECIPITATION : RADAR_COLOURS) : stops,
      timeline: timeline ? timelineMarkup(timeline, card.update?.ctx, card.text?.now ?? 'Now') : '',
      dataCredit: [
        ...new Set([
          ahead.length > 0 ? HRRR_CREDIT : '',
          grid?.hours && (rainHours || hoursLoop)
            ? (RAIN_MODELS.find(model => model.id === grid.model)?.credit ?? 'Open-Meteo')
            : '',
        ]),
      ]
        .filter(Boolean)
        .join(' · '),
      failed: Boolean(this.radar?.failed),
    });
    if (large) this.setPin(view, this.pin);
    // The frame it had carries over, as long as it is the frame and place it is now.
    const frameCanvas = large ? null : view.querySelector('canvas.radar-layer.frame'),
      hours = hoursLoop && grid?.hours ? hoursFromNow(grid.hours, Date.now()) : [],
      // The radar frame before the latest, to see how far the rain moves in a step.
      previous = frames[this.radarFrame - 1];
    let drift: Promise<Drift> | undefined;
    if (frameCanvas instanceof HTMLCanvasElement && newest) {
      if (preview)
        this.radarPreviews.set(
          view,
          // Never before now: the radar's latest frame carried on by the rain's drift while it falls,
          // or else the forecast's hours, each drawn as a field over the map rather than in the
          // radar's own layer, which then stays hidden.
          new RadarPreview<TileFrame>(
            hours.length > 0 ? null : frameCanvas,
            hours.length > 0
              ? hours
              : radarLoop
                ? [
                    newest,
                    ...Array.from(
                      { length: Math.ceil((Date.now() + AHEAD.reach - newest.time) / AHEAD.step) },
                      (_, step) => ({
                        time: newest.time + (step + 1) * AHEAD.step,
                        ahead: step + 1,
                      }),
                    ),
                  ]
                : [newest],
            hours.length > 0 ? FORECAST_LABEL_STEP : RADAR_LABEL_STEP,
            (canvas, frame, signal) => {
              if ('field' in frame) {
                drawField(canvas, frame.field, { ...centre, width, height }, PRECIPITATION);
                return Promise.resolve(true);
              }
              if (!('ahead' in frame)) return paint(canvas, frame, signal);
              drift ??= previous ? measureDrift(paint, previous, newest, signal) : Promise.resolve(STILL);
              return Promise.all([paint(canvas, newest, signal), drift]).then(([painted, moved]) => {
                if (painted) carry(canvas, moved.x * frame.ahead, moved.y * frame.ahead);
                return painted;
              });
            },
            () =>
              Boolean(
                card.isConnected &&
                  card.visible &&
                  !document.hidden &&
                  view.isConnected &&
                  card.config &&
                  this.previews(card.config),
              ),
            view.querySelector<HTMLElement>('.map-when'),
            (canvas, frame) => {
              if ('field' in frame) {
                canvas.className = 'map-field map-hour';
                canvas.dataset['kind'] = 'precipitation';
                canvas.dataset['peak'] = String(HOUR_PEAK);
                frameCanvas.parentElement?.after(canvas);
              } else {
                canvas.className = 'radar-layer frame';
                frameCanvas.before(canvas);
              }
            },
          ),
        );
      else if (held?.dataset['tiles'] === tilesOf(newest)) frameCanvas.replaceWith(held);
      else void paint(frameCanvas, newest);
    }
    const painted = view.querySelector('.map-field'),
      coverage = view.querySelector<HTMLCanvasElement>('.map-coverage') ?? undefined;
    this.coverageAsked.get(view)?.abort();
    this.coverageAsked.delete(view);
    if (field && painted instanceof HTMLCanvasElement)
      drawField(
        painted,
        field,
        { ...centre, width, height },
        rainHours ? PRECIPITATION : stops,
        rainHours ? coverage : undefined,
      );
    if (coverage && !rainHours && frames.length) {
      const asked = new AbortController(),
        sky = radarSky(centre, width, height);
      this.coverageAsked.set(view, asked);
      void drawRadarCoverage(coverage, sky.tiles, sky.grow, width, height, asked.signal).finally(() => {
        if (this.coverageAsked.get(view) === asked) this.coverageAsked.delete(view);
        if (!asked.signal.aborted) this.showGapNote();
      });
    }
    const canvas = view.querySelector('.wind-streaks');
    if (wind && canvas instanceof HTMLCanvasElement)
      this.startStreaks(view, canvas, wind, { centre, width, height, large, home, across, animate });
    if (timeline) this.bindTimeline(view, timeline);
    view.toggleAttribute('data-gl', Boolean(gl));
    view.toggleAttribute('data-night', look === 'night' || look === 'sheet');
    // The wind's ground is blue on either theme, but its small pin follows the theme.
    view.toggleAttribute('data-dark', dark);
    view.toggleAttribute('data-still', Boolean(still));
    if (gl) {
      this.placeGround(view, gl, centre);
      // Its look for the layer and the theme, and in it, the colour field and the radar's frames.
      paintGround(gl.map, look);
      this.showGlField(gl.map, rainHours ? undefined : field, stops);
      showRadar(
        gl.map,
        radar && !rainHours ? frames.map(radarTemplate) : [],
        shownFrame,
        look === 'night',
        allFrames.length,
        this.forecastFailed,
      );
      showRainSlots(gl.map, rainHours ? (grid?.hours?.precipitation ?? []) : []);
      if (rainHours && grid?.hours) pickRainSlot(gl.map, rainSlot(grid.hours, this.timelineTime ?? Date.now()));
    }
    // Put back under the new map only once that is drawn, so its canvases aren't found first.
    if (before) holdMap(view, before);
    if (large) bindMapMoves(view, this);
  }
  // Fills each map view for its kind (see mapView): dark base tiles; for precipitation, the radar,
  // a layer per frame on the large map for its timeline and on the card while its preview plays;
  // otherwise the latest observation; any configured overlay; a wash of the temperature or AQI
  // colour; streaks with the wind at each place (see drawWindMap); and a reading badge on home.
  draw() {
    const { card } = this,
      config = card.config;
    if (!config) return;
    for (const [view, preview] of this.radarPreviews)
      if (!view.isConnected) {
        preview.stop();
        this.radarPreviews.delete(view);
      } else preview.update();
    void this.loadRadar(Date.now());
    if (!this.largeView() || config.map !== 'rainviewer' || config.map_tile_url) this.stopGl();
    if (!card.isConnected || !card.visible || document.hidden) {
      this.playTimeline(false);
      return;
    }
    void this.loadShortForecast(Date.now());
    const allFrames = this.radar?.frames ?? [],
      latest = allFrames.findLastIndex(frame => frame.time <= Date.now());
    // The frame it is now, not any still to come.
    this.radarFrame = latest < 0 ? allFrames.length - 1 : latest;
    for (const view of card.root.querySelectorAll('.radar'))
      if (view instanceof HTMLElement) this.drawView(view, config, allFrames);
    this.windMaps = this.windMaps.filter(({ canvas }) => canvas.isConnected);
    for (const { map } of this.windMaps) map.update();
    this.showRadarFrame();
  }
  // Shows each view's frame: the one its timeline is at on the large map, otherwise the latest.
  showRadarFrame() {
    if (!this.radar || this.radar.frames.length === 0) return;
    for (const view of this.card.root.querySelectorAll('.radar')) {
      if (view instanceof HTMLElement && this.radarPreviews.has(view)) continue;
      const timeline = view instanceof HTMLElement ? this.timelineOf(view) : null,
        at = timeline?.span === '1h' ? timelineAt(timeline, this.timelineTime ?? Date.now()) : this.radarFrame,
        shown = Math.round(at);
      if (this.gl && view.hasAttribute('data-gl') && timeline?.span === '1h') {
        const ready = pickRadar(this.gl.map, at, this.timelinePlay !== 0);
        view.setAttribute('aria-busy', String(!ready));
      }
      for (const layer of view.querySelectorAll('[data-frame]'))
        if (layer instanceof HTMLElement) {
          const on = Number(layer.dataset['frame']) === shown;
          layer.toggleAttribute('data-on', on);
          if (on) loadFrame(layer);
        }
    }
  }
}
