import styles from './iweather-card.css?inline';
import {
  EVENTS,
  SUN_ENTITY,
  fireEvent,
  inDomain,
  type EntityState,
  type HomeAssistant,
} from './card/home-assistant.ts';
import { CARD_TAG, CARD_TYPE, EDITOR_TAG, normalizeConfig, type CardConfig } from './card/config.ts';
import { bindPresses, type Press } from './card/actions.ts';
import { ForecastSources, WeatherForecast } from './weather/forecast.ts';
import { READING_OPTIONS, withSensors } from './weather/sources.ts';
import {
  AUTO,
  UNIT_KIND_NAMES,
  UNIT_KINDS,
  convertForecast,
  convertForecastBetween,
  convertState,
} from './weather/units.ts';
import { pickUnit, withPickedUnits } from './card/unit-choices.ts';
import type { UnitsHost } from './sheets/options.ts';
import { OPEN_METEO_UNITS } from './weather/open-meteo.ts';
import { haptic } from './lib/haptics.ts';
import { animationDeadline } from './lib/animation.ts';
import { safely } from './lib/safely.ts';
import { STRATEGY, WeatherDashboardStrategy } from './card/strategy.ts';
import { suggestWeatherEntity } from './card/weather-entity.ts';
import { WeatherScene } from './sky/scene.ts';
import { skyWindowClass } from './sky/presets.ts';
import { listTextScale } from './sky/cloud-camera.ts';
import type { WindowClass } from './sky/presets-data.ts';
import type { Panel } from './sky/droplets.ts';
import { CloudAtlas } from './sky/cloud-decks.ts';
import { CLOUD_MAPS } from './sky/cloud-maps.ts';
import { loadEffectArt } from './sky/effect-art.ts';
import { weatherText, type TextKey, type WeatherText } from './weather/i18n.ts';
import { loadWords, phrase, say } from './weather/words.ts';
import { TILE_CARDS, opensSheet, tileEntities, tileMarkup, tileOrder } from './cards/index.ts';
import { RANK } from './cards/card.ts';
import { isTile, type TileId } from './cards/ids.ts';
import { mapView } from './map/view.ts';
import { lightTitle, tileText } from './cards/shared/tile.ts';
import { LINE_MIDDLE, WORDS, addedLight } from './cards/shared/light.ts';
import { esc, PERCENT } from './lib/html.ts';
import type { TileContext } from './cards/shared/context.ts';
import { drawMoon, loadSkyMoon, skyMoon } from './sky/moon.ts';
import { pressMotion } from './lib/press.ts';
import { targetOf, setText } from './lib/dom.ts';
import { bindForecastSwitch, placeThumb } from './cards/forecast/switch.ts';
import { MapViews } from './map/views.ts';
import { AlertPanel } from './cards/alerts/panel.ts';
import { NextHourPanel } from './cards/next-hour/panel.ts';
import { DetailSheets } from './sheets/sheets.ts';
import { PageScroll } from './card/page-scroll.ts';
import { EditPreview } from './card/edit-preview.ts';
import type { EditedPart } from './card/editing.ts';
import { GLASS, PanelGlass } from './card/panel-glass.ts';
import { WeatherRecords } from './card/records.ts';
import { MODE_SHEET, MODE_TEXT, isMode, type Mode } from './cards/forecast/rows.ts';
import { weatherAvailable } from './weather/conditions.ts';
import { forecastTypes, todayRange, dateKey, namedDays } from './weather/forecast-items.ts';
import { finite } from './lib/values.ts';
import { isRecord } from './lib/values.ts';
import { clockFormat, dateFormat } from './lib/formats.ts';
import { HOUR, MINUTE } from './lib/time.ts';
import { ForecastPanel } from './cards/forecast/panel.ts';
import { type Update, workOut } from './card/update.ts';
import { type Parts, type Geometry, cardMarkup, partsOf, NARROW } from './card/parts.ts';
import { PAGE_COLUMNS, type PageFit, pageFit } from './card/page-grid.ts';

// How long a tile is held before it opens without being let go: the map sooner (see press).
const HOLD = { tile: 1100, map: 350 } as const;
// The pinned reading stands either side of a bar, 11 px off it. The bar, larger than the words,
// is raised 0.8 px so it stands centred on their line rather than hanging below it.
const BRIEF_BAR = { gap: 11, rise: 0.8 } as const;
// Lit clouds kept for every animating sky: a cloudy one draws some 80 a frame.
const ATLAS = { least: 160, perSky: 100 } as const;
// What pressing the hourly panel leaves to itself, rather than opening today.
const FORECAST_CONTROLS = '.modes,.retry,.hours-arrow';
// A card wider than tall by this much takes the landscape sky.
const LANDSCAPE = 1.3;
// A night sky with at least this share of its stars showing reads as clear (see the compact card's styles).
const STARRY = 0.5;
// The full layout's daily list spans a grid row for every 3.4 days, two at least.
const DAYS_PER_ROW = 3.4;
const MIN_DAILY_ROWS = 2;
// A scrolling page paints the sky to the screen's height, and at least 220px past the hero.
const SKY_BELOW_HERO = 220;
// A panel that starts past the first 30% of the card sits beside the conditions, not under.
const BESIDE = 0.3;
// Masonry heights, in its 50px rows.
const CARD_ROWS = { page: 16, expanded: 14, compact: 4, strip: 1, other: 6 } as const;
// A sections dashboard's size for the card in its 12 columns, and how small it may be made:
// from a strip one row tall to the whole section, and as narrow as a quarter of it. The card
// lays itself out for whatever size it is given (see the CSS); the full layout grows with its
// tiles, so it leaves the rows to the card.
const GRID = {
  page: { columns: 12, min_columns: 6, rows: 'auto' },
  compact: { columns: 12, min_columns: 6, rows: 3, min_rows: 2 },
  strip: { columns: 12, min_columns: 3, rows: 1, min_rows: 1 },
  other: { columns: 12, rows: 6, min_columns: 3, min_rows: 1 },
} as const;
// Columns of today's sections grid in each of the grid's before Home Assistant 2024.11.
const OLD_GRID_COLUMN = 3;
// Each card's own id, for the ids its markup gives charts.
let cardCount = 0;
// One animation clock for every card on the page: frames are drawn together, in step
// with the display, and each card only as often as its sky needs.
// The browser pauses it on hidden tabs.
interface Clock {
  cards: Map<IWeatherCard, number>;
  frame: number;
  run: (now: number) => void;
  add: (card: IWeatherCard) => void;
  remove: (card: IWeatherCard) => void;
  fit: () => void;
}
const clock: Clock = {
  cards: new Map(),
  frame: 0,
  run(now) {
    clock.frame = 0;
    for (const [card, due] of clock.cards) {
      const next = animationDeadline(now, due, card.scene.frameInterval);
      if (next !== undefined) {
        clock.cards.set(card, next);
        card.paint(now);
      }
    }
    if (clock.cards.size) clock.frame = requestAnimationFrame(clock.run);
  },
  add(card) {
    clock.cards.set(card, 0);
    clock.fit();
    if (!clock.frame) clock.frame = requestAnimationFrame(clock.run);
  },
  remove(card) {
    clock.cards.delete(card);
    clock.fit();
  },
  // Room in the lit-cloud cache for every animating sky, so they don't evict each other.
  fit() {
    if (WeatherScene.atlas) WeatherScene.atlas.limit = Math.max(ATLAS.least, clock.cards.size * ATLAS.perSky);
  },
};

// The card's styles, parsed once and shared by every card on the page (the dashboard
// editor builds a new preview card at each change). Browsers without shared
// stylesheets get a style element of their own.
let sheet: CSSStyleSheet | null | undefined;
function adoptStyles(root: ShadowRoot): string {
  if (sheet === undefined)
    try {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(styles);
      root.adoptedStyleSheets = [sheet];
    } catch {
      sheet = null;
    }
  else if (sheet) root.adoptedStyleSheets = [sheet];
  return sheet ? '' : `<style>${styles}</style>`;
}

// Shorter than this, an expanded card's full-size hero and forecast don't both fit.
const SHORT = 320;
// Data an integration hasn't written for this long is shown as stale. Most write hourly or
// more often, and Home Assistant notes each write even when nothing changed.
const STALE = 3 * HOUR;
// How long after a minute turns the card draws again, so its clock has turned too.
const PAST_THE_MINUTE = 100;

// Whether two of Home Assistant's objects hold the same fields, each the very same value, leaving
// out the states (the card compares only those it reads).
function sameApartFromStates<T extends HomeAssistant>(old: T, value: T): boolean {
  if (old === value) return true;
  let before = 0;
  for (const key in old) {
    if (!Object.hasOwn(old, key)) continue;
    if (!Object.prototype.propertyIsEnumerable.call(value, key) || (key !== 'states' && old[key] !== value[key]))
      return false;
    before++;
  }
  return before === Object.keys(value).length;
}

// Whether an entity's state came back as it was with a new time of change: it went through another
// in between, as one the integration takes down and makes again does.
function madeAgain(before: EntityState | undefined, after: EntityState | undefined): boolean {
  return (
    before !== undefined &&
    after !== undefined &&
    before.state === after.state &&
    before.last_changed !== undefined &&
    after.last_changed !== undefined &&
    before.last_changed !== after.last_changed
  );
}

// A tile of the full layout, around its markup; one with a sheet is a button that opens it.
function tileElement(id: TileId, html: string, rank: number, ctx: TileContext, wideAt: string): HTMLElement {
  const tile = document.createElement('section');
  tile.className = 'tile';
  tile.dataset['tile'] = id;
  tile.dataset['rank'] = String(rank);
  tile.dataset['wide'] = String(TILE_CARDS[id].wide === true);
  if (wideAt) tile.dataset['wideAt'] = wideAt;
  if (opensSheet(id, ctx)) {
    tile.dataset['detail'] = '';
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
  }
  const content = document.createElement('div'),
    frame = document.createElement('div'),
    body = document.createElement('div');
  content.className = 'tile-content';
  frame.className = 'body-window';
  body.className = 'panel-body';
  content.innerHTML = html;
  body.append(...[...content.childNodes].filter(node => !(node instanceof HTMLElement && node.localName === 'header')));
  frame.append(body);
  content.append(frame);
  lightTitle(content, `${ctx.id}-${id}`);
  tile.insertAdjacentHTML('afterbegin', '<i class="glass" aria-hidden="true"></i>');
  tile.append(content);
  tile.setAttribute('aria-label', tileText(html));
  return tile;
}
export class IWeatherCard extends HTMLElement {
  readonly root: ShadowRoot;
  readonly parts: Parts;
  readonly scene: WeatherScene;
  readonly forecasts: ForecastSources;
  readonly nowcast: WeatherForecast;
  // The card's settings as it follows them, with the units picked on this device (see unit-choices.ts).
  config: CardConfig | undefined;
  // Its settings as the dashboard gives them.
  private _settings: CardConfig | undefined;
  mode: Mode | undefined;
  private _rawHass: HomeAssistant | undefined;
  private _units: { raw: HomeAssistant; config: CardConfig | undefined; value: HomeAssistant } | undefined;
  visible = true;
  animating = false;
  private _wide: boolean | undefined;
  private _windowClass: WindowClass | undefined;
  // Too narrow for the forecast's switch (see NARROW): the forecast shows conditions.
  private _narrow: boolean | undefined;
  // Shorter than an expanded card needs (see SHORT).
  private _short: boolean | undefined;
  // Home Assistant's place for the card: 'grid' in a sections dashboard, 'panel' alone in a
  // panel view, unset in a masonry one.
  private _layout: string | undefined;
  private _autoRows = false;
  private _configKey: string | undefined;
  private _resize: ResizeObserver | undefined;
  private _intersection: IntersectionObserver | undefined;
  motion: MediaQueryList | undefined;
  // The screen's colour scheme, which the maps follow where Home Assistant doesn't say its theme.
  scheme: MediaQueryList | undefined;
  private _timer: number | undefined;
  private _leaving: number | undefined;
  private _geometry: Geometry | null = null;
  private _paintPending = false;
  // Set while sync runs: a forecast stream started again there tells of it at once, and sync draws
  // the card itself once it has the rest, so the stream's word draws nothing (see sync).
  private _syncing = false;
  private readonly _moons = new WeakSet<HTMLCanvasElement>();
  // The sheets a tile, a day or a panel opens.
  readonly sheets: DetailSheets = new DetailSheets(this);
  // The map tile's map and the large one.
  readonly maps: MapViews = new MapViews(this);
  // What lies on the glass panels.
  readonly glass: PanelGlass = new PanelGlass(this);
  // What the card asks for beyond its forecast.
  readonly records: WeatherRecords = new WeatherRecords(this);
  // The hourly panel and the daily list, and the panels at the head of the page.
  readonly forecastPanel: ForecastPanel = new ForecastPanel(this);
  readonly alertPanel: AlertPanel;
  readonly nextHourPanel: NextHourPanel;
  // The page scrolling in place, where it does.
  readonly pageScroll: PageScroll = new PageScroll(this);
  // In the dashboard editor's preview, the part of the card being edited (see EditPreview).
  private readonly _editPreview = new EditPreview(this);
  // How much the full page is zoomed on screen by its size setting (see measureZoom).
  zoom = 1;
  private readonly _onScroll = () => this.pageScroll.queue();
  private _language: string | undefined;
  text: WeatherText | undefined;
  private _labelled: WeatherText | undefined;
  // What the card last worked out (see workOut).
  update: Update | undefined;
  private _tilesKey: string | undefined;
  // Each tile as last drawn, and what it was drawn from (see drawTiles).
  private _tiles = new Map<TileId, { key: string; element: HTMLElement }>();
  private _brief: string | undefined;
  private _id: string | undefined;
  // Each minute, just after it turns, so "Now" and the hours move on as the clock does, a sleep or a
  // slowed timer putting it right again; out of sight, the card waits to be seen.
  private _tick() {
    this._timer = window.setTimeout(
      () => {
        this._tick();
        if (this.inSight) this.render();
      },
      MINUTE - (Date.now() % MINUTE) + PAST_THE_MINUTE,
    );
  }
  private readonly _onKey = () => this.removeAttribute('data-pointer');
  private readonly _onVisibility = () => {
    this.followPage();
    this.render();
    this.syncEffects();
  };
  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
    this.root.innerHTML = `${adoptStyles(this.root)}${cardMarkup()}`;
    this.parts = partsOf(this.root);
    this.alertPanel = new AlertPanel(this.parts.alert);
    this.nextHourPanel = new NextHourPanel(this.parts.nextHour);
    this.scene = new WeatherScene(this.parts.sky);
    // The cloud sprite atlas decodes once for every card; the sky repaints when it is ready.
    // The GPU takes the maps itself, so they are decoded for the 2D drawing only if it can't.
    WeatherScene.atlas ??= new CloudAtlas(CLOUD_MAPS, { now: !WeatherScene.gpuClouds });
    // The moon's photograph, given to the scene as the cloud atlas is.
    WeatherScene.moon ??= { load: loadSkyMoon, sprite: skyMoon };
    void WeatherScene.atlas.ready.then(() => this.paint());
    // A browser can drop what a canvas holds, as on a wall tablet whose screen sleeps, and hand it
    // back blank: the layers kept for it went too.
    this.parts.sky.addEventListener('contextrestored', () => {
      this.scene.release();
      this.glass.release();
      this.paint();
    });
    // Forecasts arrive in the entity's units and are converted to the card's.
    // Forecasts in the card's units; a second entity's, and Open-Meteo's, are first brought into the
    // card entity's units.
    this.forecasts = new ForecastSources(
      () => {
        if (!this._syncing) this.render();
      },
      (list, source, type) => {
        const own = this.rawState(this.config?.entity)?.attributes;
        if (source === 'open_meteo') return convertForecastBetween(list, OPEN_METEO_UNITS, own, this.config);
        // Days stamped at midnight fall on the date they name (see namedDays).
        const days = type === 'daily' ? namedDays(list, this.timeZone) : list;
        return source === 'extra'
          ? convertForecastBetween(days, this.rawState(this.config?.forecast_entity)?.attributes, own, this.config)
          : convertForecast(days, own, this.config);
      },
    );
    // A nowcast weather entity for next-hour precipitation streams its own forecast.
    this.nowcast = new WeatherForecast(() => {
      if (!this._syncing) this.render();
    });
    for (const node of [this.parts.current, this.parts.credit])
      bindPresses(
        node,
        () => this.config ?? {},
        press => this.pressed(press),
      );
    bindForecastSwitch(this);
    this.bindPanels();
    // A pointer puts focus rings away, including when a closing sheet restores focus to its tile.
    this.root.addEventListener('pointerdown', () => this.toggleAttribute('data-pointer', true), true);
  }
  // What the panels answer: a press opens what each shows in a sheet, and the hourly strip pages.
  bindPanels() {
    // An alert opens the alerts' sheet on it; the next hour's panel, its own sheet. On the page both
    // are pressed and held as tiles are (see press).
    const openAlert = (button: HTMLElement | null) => {
      if (!button) return;
      haptic(this, 'light');
      this.sheets.open('alerts', button, undefined, button.dataset['index']);
    };
    // With the toolbar hidden, the page keeps the way to Home Assistant's menu (see .page-menu).
    this.parts.menu.addEventListener('click', () => fireEvent(this, EVENTS.toggleMenu, {}));
    this.parts.alert.addEventListener('click', event => openAlert(targetOf(event, 'button[data-index]')));
    pressMotion(this.parts.alert, '.weather[data-layout=page] .alert button[data-index]', {
      scaled: '.alert',
      hold: () => HOLD.tile,
      open: openAlert,
    });
    const openNextHour = () => {
      if (!this.update?.nextHour.data) return;
      haptic(this, 'light');
      this.sheets.open('next_hour', this.parts.nextHour);
    };
    this.parts.nextHour.addEventListener('click', openNextHour);
    this.parts.nextHour.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openNextHour();
    });
    pressMotion(this.parts.nextHour, '.weather[data-layout=page] .next-hour', {
      hold: () => HOLD.tile,
      open: openNextHour,
    });
    this.parts.retry.addEventListener('click', () => {
      this.forecasts.stop();
      this.sync();
    });
    this.parts.hours.addEventListener('scroll', () => this.forecastPanel.fade(), { passive: true });
    for (const [arrow, forward] of [
      [this.parts.pageBack, false],
      [this.parts.pageNext, true],
    ] as const)
      arrow.addEventListener('pointerdown', event => {
        if (event.button === 0) this.forecastPanel.page(forward);
      });
    const openTile = (tile: HTMLElement | null, event?: Event) => {
      const id = tile?.dataset['tile'],
        ctx = this.update?.ctx;
      if (tile && isTile(id) && ctx) {
        event?.preventDefault();
        haptic(this, 'light');
        const { id: sheet, day, variant } = TILE_CARDS[id].opens(ctx);
        this.sheets.open(sheet, tile, day, variant);
      }
    };
    this.parts.tiles.addEventListener('click', event => openTile(targetOf(event, '.tile[data-detail]'), event));
    // Tiles, and the hourly forecast as a tile of the page, shrink while pressed, and open when held
    // (see press).
    pressMotion(this.parts.tiles, '.tile[data-detail]', {
      hold: tile => (tile instanceof HTMLElement && tile.dataset['tile'] === 'map' ? HOLD.map : HOLD.tile),
      open: openTile,
    });
    // Each day row opens the sheet of the view showing on its own day; the hourly panel, on today,
    // as one card.
    const openDay = (event: Event) => {
      const row = targetOf(event, '.day[data-key]');
      if (row && this.update) {
        event.preventDefault();
        haptic(this, 'light');
        this.sheets.open(MODE_SHEET[this.update.strip.mode], row, row.dataset['key']);
      }
    };
    const list = this.parts.dailyList;
    list.addEventListener('click', openDay);
    // A day pressed lights up (see the styles) and, on the page, its whole list shrinks under a finger
    // as a tile does; clicked with a mouse, it holds still. A mouse pressed on a day and dragged off
    // it selects nothing on the way, whatever it passes over.
    pressMotion(list, '.weather[data-layout=page] .day[data-key]', { scaled: '.daily', touchOnly: true });
    list.addEventListener('mousedown', event => {
      if (event.target instanceof Element && event.target.closest('.day[data-key]')) event.preventDefault();
    });
    list.addEventListener('keydown', event => {
      if (
        (event.key === 'Enter' || event.key === ' ') &&
        event.target instanceof Element &&
        event.target.matches('.day')
      )
        openDay(event);
    });
    const openToday = (event?: Event) => {
      const panel = this.parts.forecast,
        target = event?.target;
      if (
        (target instanceof Element && target.closest(FORECAST_CONTROLS)) ||
        !this.update?.ctx ||
        panel.dataset['detail'] === undefined
      )
        return;
      event?.preventDefault();
      haptic(this, 'light');
      this.sheets.open(MODE_SHEET[this.update.strip.mode], panel, dateKey(Date.now(), this.update.ctx.timeZone));
    };
    this.parts.forecast.addEventListener('click', openToday);
    // The arrows press the whole panel too, but holding them never opens its sheet.
    pressMotion(this.parts.forecast, '.weather[data-layout=page] :is(.forecast[data-detail],.hours-arrow)', {
      scaled: '.forecast',
      ignore: '.modes,.retry',
      hold: pressed => (pressed.matches('.hours-arrow') ? null : HOLD.tile),
      open: () => openToday(),
    });
    this.parts.hours.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') openToday(event);
    });
    this.parts.tiles.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') openTile(targetOf(event, '.tile[data-detail]'), event);
    });
  }
  // What the settings say a press on the conditions does; a tap with none set opens the entity.
  pressed(press: Press) {
    const config = this.config;
    if (!config) return;
    const { tap_action: tap, hold_action: hold, double_tap_action: doubleTap } = config;
    if (press === 'tap' && !tap) this.moreInfo(config.entity);
    else if ({ tap, hold, double_tap: doubleTap }[press]?.action !== 'none')
      fireEvent(this, EVENTS.action, {
        config: { entity: config.entity, tap_action: tap, hold_action: hold, double_tap_action: doubleTap },
        action: press,
      });
  }
  // Home Assistant's dialog for an entity.
  moreInfo(entityId: string | undefined) {
    if (entityId) fireEvent(this, EVENTS.moreInfo, { entityId });
  }
  get inSight(): boolean {
    return this.visible && !document.hidden;
  }
  // The configured time zone, else Home Assistant's; unset leaves the browser's own.
  // The card's own zone where it sets one; else the one the user's profile picks, their device's or
  // Home Assistant's.
  get timeZone(): string | undefined {
    if (this.config?.time_zone) return this.config.time_zone;
    if (this._rawHass?.locale?.time_zone === 'local') return Intl.DateTimeFormat().resolvedOptions().timeZone;
    return this._rawHass?.config?.time_zone || undefined;
  }
  get layout(): string | undefined {
    return this._layout;
  }
  set layout(value: string | undefined) {
    this._layout = value;
    this.fitGrid();
  }
  // In a sections dashboard with rows set, the grid gives the card its height, whatever
  // it is; elsewhere nothing does, and the card keeps a height of its own. A panel view
  // gives the card the screen, which the page layout fills (see the styles).
  fitGrid() {
    this.toggleAttribute('data-grid', this._layout === 'grid' && !this._autoRows);
    this.toggleAttribute('data-panel', this._layout === 'panel');
  }
  // Home Assistant's own state of an entity, before sensors and units are applied.
  rawState(id: string | undefined): EntityState | undefined {
    return id === undefined ? undefined : this._rawHass?.states[id];
  }
  setConfig(config: unknown) {
    // Rows set to 'auto' leave the card's height to the card, as masonry views do.
    const grid = isRecord(config) ? config['grid_options'] : undefined;
    this._autoRows = isRecord(grid) && grid['rows'] === 'auto';
    this.fitGrid();
    const key = JSON.stringify(config);
    if (this._configKey === key) return;
    const normalized = normalizeConfig(config);
    this._configKey = key;
    this._settings = normalized;
    this.applyConfig(withPickedUnits(normalized));
  }
  // The units its readings are shown in, as a sheet's options show and pick them.
  readonly units: UnitsHost = {
    setting: kind => this.config?.[kind] ?? AUTO,
    own: kind => {
      const unit = this.rawState(this.config?.entity)?.attributes[UNIT_KINDS[kind].attribute];
      return typeof unit === 'string' ? unit : undefined;
    },
    pick: (kind, unit) => {
      const settings = this._settings;
      if (!settings || this.config?.[kind] === unit) return;
      pickUnit(kind, unit, settings[kind]);
      this.sheets.unitsPicked();
      this.applyConfig(withPickedUnits(settings));
      void this.sheets.history.loadHistory();
    },
  };
  applyConfig(next: CardConfig) {
    // Automatic leaves the view unpicked, so the strip opens on Conditions until someone picks one.
    if (this.config?.weather_mode !== next.weather_mode || this.config.entity !== next.entity)
      this.mode = next.weather_mode === 'auto' ? undefined : next.weather_mode;
    const units = UNIT_KIND_NAMES.some(name => this.config?.[name] !== next[name]),
      zone = this.config?.time_zone !== next.time_zone,
      repaint = this.config?.low_power !== next.low_power || this.config.weather_scene !== next.weather_scene;
    this.config = next;
    this.parts.weather.style.setProperty('--top-padding', String(next.top_padding / PERCENT));
    this.scene.lowPower = next.low_power;
    // New display units, or a new zone to date the days in: read the forecasts already held again.
    // (The entity's readings follow the new config the next time they are read; see readHass.)
    if (this._rawHass && (units || zone)) this.forecasts.refresh();
    this.sync();
    if (repaint) this.paint();
  }
  // Home Assistant's state as the card reads it (see withUnits), built on first read
  // after a change rather than on every update: Home Assistant hands every card each
  // state change in the house, and most are for entities the card never looks at.
  get readHass(): HomeAssistant | undefined {
    const raw = this._rawHass;
    if (!raw) return undefined;
    if (this._units?.raw !== raw || this._units.config !== this.config)
      this._units = { raw, config: this.config, value: this.withUnits(raw) };
    return this._units.value;
  }
  // Home Assistant's state with the weather entity's readings filled in from any
  // configured sensors, then in the card's display units.
  withUnits(value: HomeAssistant): HomeAssistant {
    value = withSensors(value, this.config);
    const entity = this.config?.entity,
      state = entity === undefined ? undefined : value.states[entity];
    if (entity === undefined || !state) return value;
    const converted = convertState(state, this.config);
    return converted === state ? value : { ...value, states: { ...value.states, [entity]: converted } };
  }
  set hass(value: HomeAssistant) {
    const old = this._rawHass,
      zone = this.timeZone;
    this._rawHass = value;
    // The days already held are dated again in a new zone (see namedDays).
    if (old && zone !== this.timeZone) this.forecasts.refresh();
    // Home Assistant's own states of everything the card reads, and everything else it hands over:
    // unchanged, so are the readings made from them. Home Assistant replaces only the fields that
    // changed, and a list of the ones that matter kept missing some, such as the formatters, which
    // come on their own once the translations have loaded.
    const ids = [
      this.config?.entity,
      this.config?.air_quality_entity,
      this.config?.next_hour_entity,
      this.config?.forecast_entity,
      this.config?.condition_entity,
      this.config?.zone,
      ...(this.config?.alert_entities ?? []),
      ...READING_OPTIONS.map(option => this.config?.[option]),
      ...(this.config ? tileEntities(this.config, value) : []),
      SUN_ENTITY,
    ].filter((id): id is string => Boolean(id));
    if (old && ids.every(id => old.states[id] === value.states[id]) && sameApartFromStates(old, value)) return;
    this.sync();
    // An entity back in the state it was in, changed since: it has been somewhere else, perhaps made
    // anew by its integration reloading, which the page can miss when both come close together.
    for (const id of [this.config?.entity, this.config?.forecast_entity])
      if (id !== undefined && madeAgain(old?.states[id], value.states[id])) this.forecasts.renew(id);
  }
  connectedCallback() {
    window.clearTimeout(this._leaving);
    // WebKit doesn't apply a sheet adopted before the card joined the page until something else
    // makes it look again, and a card laid out without one measures tens of thousands of px tall.
    if (sheet) this.root.adoptedStyleSheets = [sheet];
    this._resize = new ResizeObserver(() => {
      this.fitHero();
      this._geometry = null;
      placeThumb(this.parts);
      // A sky wider than tall takes the landscape decks, lower and broader. A page's sky is a whole
      // window's, which keeps the regular decks, its clouds across the top, however wide the window.
      const box = this.parts.sceneRoot.getBoundingClientRect(),
        wide = this.config?.weather_layout !== 'page' && box.width > box.height * LANDSCAPE;
      const { width, height } = this.box(this, this.measureZoom()),
        narrow = width < NARROW,
        short = height < SHORT,
        windowClass =
          width > 0 && height > 0 ? skyWindowClass(width, height, Math.max(screen.width, screen.height)) : undefined;
      if (
        wide !== this._wide ||
        narrow !== this._narrow ||
        short !== this._short ||
        windowClass !== this._windowClass
      ) {
        this._wide = wide;
        this._windowClass = windowClass;
        this._narrow = narrow;
        this._short = short;
        this.render();
      }
      // Marks drawn across the strip go by where its columns are.
      if (this.forecastPanel.moved()) this.render();
      this.pageScroll.layout = null;
      this.pageScroll.sync();
      this.paint();
      this.forecastPanel.fade();
      this.drawMoons();
      // On the next frame: drawing the maps lays the page out again, and WebKit's grid comes out a
      // little different each time, which would be a resize in the middle of this one.
      requestAnimationFrame(() => this.syncEffects());
    });
    this._resize.observe(this);
    this._resize.observe(this.parts.content);
    this._resize.observe(this.parts.current);
    // A page that grows past the card's height starts to scroll in place.
    this._resize.observe(this.parts.sceneRoot);
    this.parts.content.addEventListener('scroll', this._onScroll, { passive: true });
    // Panels appearing or moving change where the open sky is.
    this._resize.observe(this.parts.forecast);
    this._resize.observe(this.parts.daily);
    this._intersection = new IntersectionObserver(entries => {
      // A quick move can queue both visible and hidden entries before one delivery.
      const entry = entries.at(-1),
        returning = entry?.isIntersecting && !this.visible;
      if (entry) this.visible = entry.isIntersecting;
      if (returning) this.render();
      this.syncEffects();
    });
    this._intersection.observe(this);
    this.motion = matchMedia('(prefers-reduced-motion: reduce)');
    this.motion.addEventListener('change', this._onVisibility);
    this.scheme = matchMedia('(prefers-color-scheme: dark)');
    this.scheme.addEventListener('change', this._onVisibility);
    // Tab can enter the card from elsewhere on the dashboard.
    document.addEventListener('keydown', this._onKey, true);
    document.addEventListener('visibilitychange', this._onVisibility);
    this._tick();
    this.followPage();
    this.sync();
    this._editPreview.connect();
  }
  disconnectedCallback() {
    this._editPreview.disconnect();
    this._resize?.disconnect();
    this.parts.content.removeEventListener('scroll', this._onScroll);
    this.pageScroll.cancel();
    this._intersection?.disconnect();
    this.motion?.removeEventListener('change', this._onVisibility);
    this.scheme?.removeEventListener('change', this._onVisibility);
    document.removeEventListener('keydown', this._onKey, true);
    document.removeEventListener('visibilitychange', this._onVisibility);
    window.clearTimeout(this._timer);
    // Open sheets go with the card, and with them the window listeners that place them: a modal
    // dialog doesn't outlive being moved.
    this.sheets.detail?.dialog.close();
    this.sheets.dock?.dialog.close();
    clock.remove(this);
    this.animating = false;
    // Home Assistant takes a card down and puts it straight back when it moves it on the page, so
    // what would have to be built again waits to see that it has really gone.
    this._leaving = window.setTimeout(() => {
      this.maps.invalidateRadar();
      this.maps.dropStills();
      this.scene.release();
      this.glass.release();
      this.forecasts.stop();
      this.nowcast.stop();
    });
  }
  // Forecasts stop coming while the page is hidden (see WeatherForecast.suspend).
  followPage() {
    for (const stream of [this.forecasts, this.nowcast])
      if (document.hidden) stream.suspend();
      else stream.resume();
  }
  sync() {
    const config = this.config;
    if (!config) return;
    const state = this.readHass?.states[config.entity];
    // The card entity's forecasts, and forecast_entity's: for the types the first lacks and
    // to fill the details it leaves out.
    const own = weatherAvailable(state) ? forecastTypes(state.attributes.supported_features ?? 0, config) : [];
    const second = config.forecast_entity === undefined ? undefined : this.readHass?.states[config.forecast_entity];
    const borrowed =
      second && weatherAvailable(second) ? forecastTypes(second.attributes.supported_features ?? 0, config) : [];
    // Started again, the streams tell of it at once; it is drawn once, below, with all the rest.
    this._syncing = true;
    try {
      if (this.isConnected)
        this.forecasts.update(this.readHass?.connection, config.entity, own, config.forecast_entity, borrowed);
      const nowcast = config.next_hour_entity;
      if (this.isConnected && inDomain(nowcast, 'weather') && config.weather_layout === 'page')
        this.nowcast.update(this.readHass?.connection, nowcast, ['hourly']);
      else this.nowcast.stop();
    } finally {
      this._syncing = false;
    }
    // A card off the page draws once, so it comes onto the page drawn, with nothing left to change in
    // front of the reader. After that, as one a visibility condition hides, it draws and fetches
    // nothing until it is back (see connectedCallback).
    if (!this.isConnected && this.update) return;
    void this.records.loadClimate();
    void this.records.loadRecentRain();
    this.render();
    this.syncEffects();
  }
  // The card's text in a language, kept while the language holds.
  localize(locale: string | undefined): WeatherText {
    if (this._language === locale && this.text) return this.text;
    this.text = weatherText(locale || 'en');
    // The sentences come in beside the card, and redraw what is already showing.
    void loadWords(locale).then(changed => {
      if (!changed) return;
      this._labelled = undefined;
      this.redrawTiles(true);
    });
    this._language = locale;
    return this.text;
  }
  // The names its parts carry, drawn again when the language changes.
  drawLabels(t: WeatherText) {
    if (this._labelled === t) return;
    this._labelled = t;
    const { parts } = this,
      label = (node: HTMLElement, key: TextKey, attribute = 'aria-label') => node.setAttribute(attribute, t(key));
    label(parts.weather, 'weather');
    label(parts.forecast, 'forecast');
    label(parts.modes, 'forecast_display');
    label(parts.daily, 'daily_forecast');
    label(parts.dailyList, 'daily_ranges');
    label(parts.current, 'weather_details', 'title');
    parts.menu.setAttribute('aria-label', say('Menu'));
    // Showing, the next hour's panel is named for what it says (see NextHourPanel).
    if (parts.nextHour.hidden !== false) parts.nextHour.setAttribute('aria-label', say('Next-hour precipitation'));
    for (const button of parts.modeButtons) {
      const mode = button.dataset['mode'],
        text = t(isMode(mode) ? MODE_TEXT[mode] : 'conditions');
      button.setAttribute('aria-label', text);
      button.title = text;
    }
    parts.retry.textContent = t('retry');
  }
  render() {
    const config = this.config;
    if (!config) return;
    // Panels may appear, move or resize; measure again on the next frame.
    this._geometry = null;
    this.pageScroll.layout = null;
    this.pageScroll.queue();
    this._id ??= `card${++cardCount}`;
    const id = this._id,
      now = Date.now();
    // Out of sight, nothing is asked for; coming back draws again, which asks for what is due.
    void this.records.loadSupplement(now);
    if (this.inSight) {
      void this.records.loadAirSupply(now);
      void this.records.loadNwsAlerts(now);
      void this.records.loadMinutes(now);
      void this.records.loadSoFar(now);
    }
    const update = safely(() =>
      workOut({
        config,
        hass: this.readHass,
        data: this.forecasts.data,
        supplied: this.forecasts.supplement !== undefined,
        supplementAt: this.forecasts.supplement?.raw.at,
        quarters: this.forecasts.supplement?.raw.quarters,
        quartersComing: !this.records.supplementSettled,
        awaited: this.records.supplementAwaited,
        nowcast: this.nowcast.data.hourly?.forecast,
        timeZone: this.timeZone,
        prefersDark: this.scheme?.matches ?? false,
        text: locale => this.localize(locale),
        mode: this.mode,
        narrow: Boolean(this._narrow),
        id,
        records: this.records,
        now,
      }),
    );
    if (!update) return;
    this.update = update;
    // Each part drawn apart, so one that fails leaves the rest, and itself as last drawn.
    safely(() => this.drawLabels(update.t));
    safely(() => this.drawConditions(update));
    safely(() => this.forecastPanel.drawHeading(update));
    safely(() => this.forecastPanel.drawSummary(update));
    safely(() => this.alertPanel.draw(update));
    safely(() => this.nextHourPanel.draw(update));
    safely(() => this.forecastPanel.drawMeasure(update));
    safely(() => this.forecastPanel.drawStatus(update));
    this.parts.weather.dataset['daily'] = String(config.show_daily && update.days.length > 0);
    this.dataset['layout'] = config.weather_layout;
    // An expanded card the dashboard has made short lays out as an automatic one, which fits
    // its forecast to the height; elsewhere it scrolls, as it always has.
    this.parts.weather.dataset['layout'] =
      config.weather_layout === 'expanded' && this._short && this.hasAttribute('data-grid')
        ? 'auto'
        : config.weather_layout;
    safely(() => this.drawTiles(update));
    safely(() => this.forecastPanel.drawDaily(update));
    safely(() => this.forecastPanel.drawHours(update));
    safely(() => this.drawScene(update));
    this.fitHero();
  }
  // The conditions over the sky, and the rest that follows the entity alone.
  drawConditions({ config, state, attrs, available, locale, timeZone, now, t, fmt, ctx, ...rest }: Update) {
    const { daily, days, conditionText: condition, feltText, homeName: home, placeName: place, atHome } = rest,
      { parts } = this;
    const name = place || config.name || attrs.friendly_name || t('weather');
    const temperature = available && finite(attrs.temperature) ? `${fmt(attrs.temperature)}°` : '—';
    setText(parts.location, name);
    parts.location.hidden = !config.show_name;
    // Home Assistant's name for its home heads a small card's conditions (see the CSS), and the
    // page's over a town or city set for home, unless it says what the place name under it does.
    setText(parts.home, home);
    parts.home.hidden =
      !config.show_name ||
      !home ||
      home.toLocaleLowerCase(locale) === name.trim().toLocaleLowerCase(locale) ||
      (config.weather_layout === 'page' && !(place && atHome));
    // A city tile puts its context below the place, with the local clock away from home.
    parts.compactMeta.hidden = config.weather_layout !== 'compact' || !config.show_name;
    setText(
      parts.placeContext,
      atHome ? t('my_location') : clockFormat({ locale, timeZone, hour12: rest.hour12 }).format(now),
    );
    setText(parts.placeHomeName, home);
    parts.placeHome.hidden = !atHome || !home;
    setText(parts.temperature, temperature);
    // Feeling far from the temperature, the page's hero says so in place of the sky.
    setText(parts.condition, (config.weather_layout === 'page' && feltText) || condition);
    // The reading a pinned band shows, in one line of added light (see WORDS).
    const brief = addedLight(ctx.id, [
      {
        name: 'brief',
        shapes: `<text x="50%" y="50%" ${LINE_MIDDLE}><tspan>${esc(temperature)}</tspan>${condition ? `<tspan class="bar" dx="${BRIEF_BAR.gap}" dy="${-BRIEF_BAR.rise}">|</tspan><tspan dx="${BRIEF_BAR.gap}" dy="${BRIEF_BAR.rise}">${esc(condition)}</tspan>` : ''}</text>`,
        ...WORDS.brief,
      },
    ]);
    if (this._brief !== brief.marks) {
      this._brief = brief.marks;
      parts.brief.innerHTML = `<svg>${brief.marks}</svg>`;
      parts.briefLight.innerHTML = brief.lifts;
    }
    // Data the integration hasn't written in hours is shown as such, with when it last did. The
    // frontend isn't told last_reported, so often only last_updated is there to go on.
    const written = Math.max(
        ...[state?.last_reported, state?.last_updated].map(time => Date.parse(time ?? '')).filter(Number.isFinite),
      ),
      stale = available && Number.isFinite(written) && now - written > STALE;
    parts.stale.hidden = !stale;
    if (stale)
      setText(
        parts.stale,
        t('last_updated').replace(
          '{time}',
          dateFormat(locale, {
            ...(dateKey(written, timeZone) === dateKey(now, timeZone) ? {} : { weekday: 'short' }),
            hour: 'numeric',
            minute: '2-digit',
            timeZone,
            hour12: rest.hour12,
          }).format(written),
        ),
      );
    // The page closes on one small button: where the weather is for, over each source as its
    // integration words it, a line each. It opens what the conditions do. Open-Meteo's credit stands
    // under it as a link of its own, as its licence asks beside anything it gave.
    const { credits } = rest,
      sources = credits.named.join('\n');
    parts.credit.hidden = config.weather_layout !== 'page';
    setText(parts.creditName, t('weather_for').replace('{place}', (atHome && home) || name));
    setText(parts.creditSource, sources);
    parts.creditSource.hidden = !sources;
    parts.creditSupplement.hidden = !credits.openMeteo;
    parts.current.title = [
      sources,
      !config.tap_action || config.tap_action.action === 'more-info' ? t('open_details') : '',
    ]
      .filter(Boolean)
      .join('\n');
    parts.current.setAttribute(
      'aria-label',
      `${name}, ${available ? `${fmt(attrs.temperature)} ${attrs.temperature_unit ?? say('degrees')}, ${condition}` : t('unavailable')}`,
    );
    const { high, low } = days.find(day => day.today) ?? todayRange(daily?.forecast ?? [], now, timeZone);
    setText(
      parts.range,
      [finite(high) ? `${t('high_label')}${fmt(high)}°` : '', finite(low) ? `${t('low_label')}${fmt(low)}°` : '']
        .filter(Boolean)
        .join('  '),
    );
    parts.range.hidden = !config.show_high_low || !available;
    parts.weather.dataset['available'] = String(available);
    parts.weather.dataset['night'] = String(rest.night);
    const forecast = config.show_forecast && config.weather_layout !== 'compact' && config.weather_layout !== 'strip';
    parts.weather.dataset['forecast'] = String(forecast);
    parts.weather.dataset['scene'] = String(config.weather_scene);
    parts.forecast.hidden = !forecast;
  }
  // The sky. A running animation fades between scenes; still renders cut straight over.
  drawScene({ inputs, config, ctx }: Update) {
    const sceneKey = this.scene.key,
      tile = config.weather_layout === 'compact' || config.weather_layout === 'strip';
    this.scene.prepare(
      { ...inputs, tile, windowClass: this._windowClass },
      {
        animate: this.animating,
        wide: this._wide ?? false,
        textScale: tile ? listTextScale(parseFloat(getComputedStyle(document.documentElement).fontSize)) : 1,
        location: JSON.stringify([config.entity, config.zone, ctx.latitude, ctx.longitude]),
      },
    );
    const preset = this.scene.preset,
      background = this.scene.background;
    if (preset) {
      const art = [
        preset.wind ? 'wind' : undefined,
        preset.look.layers.includes('nearParticles') ? 'near' : undefined,
        preset.snow || preset.sleet || preset.hail ? 'falling' : undefined,
        preset.rain ? 'rain' : undefined,
        preset.fog ? 'noise' : undefined,
        preset.fringe ? 'fringe' : undefined,
      ] as const;
      const requests = art.flatMap(kind => (kind && loadEffectArt(kind)) ?? []);
      if (requests.length)
        void Promise.all(requests).then(loaded => {
          if (loaded.some(Boolean)) this.paint();
        });
    }
    if (this.scene.key !== sceneKey && preset && background) {
      // Panels take their tint from the sky.
      const weather = this.parts.weather;
      // Panels carry no tint: the material blurs and saturates what is behind them and
      // pulls its luminance 40% toward the middle, so dark skies give lighter panels and
      // bright skies darker ones.
      // The material carries no tint of its own: the luminance curve alone sets the panels.
      weather.style.setProperty('--panel-bg', 'transparent');
      background.colors.forEach((color, index) => {
        weather.style.setProperty(`--sky-${index}`, color);
      });
      weather.style.setProperty('--sky-stop', String(background.middleStop));
      weather.dataset['starry'] = String(preset.stars >= STARRY);
      this.paint();
      this.syncEffects();
    }
  }
  // Detail tiles, in the configured order, below the forecast in the full layout.
  drawTiles({ config, now, days, awaited, ctx, alerts, alertsLead, nextHour }: Update) {
    const container = this.parts.tiles,
      page = config.weather_layout === 'page';
    this.toggleAttribute('data-page', page);
    if (page) this.dataset['size'] = config.size;
    else delete this.dataset['size'];
    // A tall daily list spans enough rows for its days; the grid's tiers place it. It takes the room
    // of the days on their way from the start, so that their coming moves only its own rows, not
    // the page around it as it is first read.
    const listed = awaited ? Math.max(days.length, config.forecast_days) : days.length,
      dailyRows = Math.max(MIN_DAILY_ROWS, Math.ceil(listed / DAYS_PER_ROW));
    this.parts.weather.style.setProperty('--daily-rows', page ? String(dailyRows) : '');
    const { records } = this;
    if (page) {
      void records.loadEarlier(now);
      void records.loadRecent(now);
      void records.loadAirYesterday(now);
      void this.maps.loadRadar(now);
      // Drawing the wind map asks for its wind, again once it is an hour old (see MapViews.loadGrid).
      if (mapView(ctx)?.kind === 'wind') this.maps.draw();
    }
    if (!page) {
      // Off the page, no tiles, going by what is drawn: a redraw asked for on the way out (as the
      // air from Open-Meteo asks when the page goes) has already forgotten what the last draw was.
      if (container.firstElementChild !== null || this._tiles.size > 0) {
        this._tilesKey = '';
        this._tiles.clear();
        container.replaceChildren();
      }
      this.sheets.renderAll();
      return;
    }
    // Tiles change by the minute at most: the sun dot, UV advice and moonrise.
    const tiles = tileOrder(config.tiles, ctx).flatMap(({ id, rank }) => {
      const html = tileMarkup(id, ctx);
      return html ? [[id, html, rank] as const] : [];
    });
    // Air quality that matters opens the page with the alerts and next-hour panel. How that and
    // the rest fill the grid sets the block's place and which tiles stand two wide.
    const weather = this.parts.weather,
      ids = tiles.map(([id]) => id),
      set = tiles.filter(([id]) => id !== 'map' && !TILE_CARDS[id].widens),
      leading = set.filter(([, , rank]) => rank === RANK.first),
      fits = PAGE_COLUMNS.map((columns): [number, PageFit] => [
        columns,
        pageFit(columns, {
          leading: leading.length + Number(alerts.length > 0 && alertsLead) + Number(Boolean(nextHour.data)),
          cells:
            set.reduce((cells, [id]) => cells + (TILE_CARDS[id].wide ? 2 : 1), 0) -
            leading.length * 2 +
            (alerts.length > 0 && !alertsLead ? 2 : 0),
          flexible: ids.filter(id => TILE_CARDS[id].widens),
          hourly: config.show_forecast,
          listRows: config.show_daily && days.length > 0 ? dailyRows : 0,
          map: ids.includes('map'),
        }),
      ]);
    for (const [columns, { top, mapRows }] of fits) {
      weather.style.setProperty(`--top${columns}`, String(top));
      weather.style.setProperty(`--map${columns}`, String(mapRows));
    }
    weather.dataset['elevated'] = String(tiles.filter(([, , rank]) => rank === RANK.raised).length);
    const wideAt = (id: TileId) =>
        fits
          .filter(([, { wide }]) => wide.includes(id))
          .map(([columns]) => columns)
          .join(' '),
      redrawnBy = tiles.map(([id]) => TILE_CARDS[id].redrawnBy?.(ctx)),
      key = JSON.stringify([
        tiles,
        redrawnBy,
        ids.map(wideAt),
        ctx.hourly.length > 0,
        alertsLead,
        Boolean(nextHour.data),
      ]);
    this.sheets.renderAll();
    if (key === this._tilesKey) return;
    this._tilesKey = key;
    // A tile drawn from the same as last time stays as it is, so that one tile changing leaves
    // the others alone: the map's streaks, scattered afresh each time it is drawn, among them.
    const kept = this._tiles,
      focused = this.root.activeElement,
      focusedId = tiles.find(
        ([id]) =>
          focused instanceof HTMLElement && focused.parentElement === container && focused.dataset['tile'] === id,
      )?.[0];
    this._tiles = new Map(
      tiles.map(([id, html, rank], index) => {
        const tileKey = JSON.stringify([html, rank, redrawnBy[index], wideAt(id), opensSheet(id, ctx)]),
          was = kept.get(id);
        return [
          id,
          { key: tileKey, element: was?.key === tileKey ? was.element : tileElement(id, html, rank, ctx, wideAt(id)) },
        ];
      }),
    );
    // The tiles that go are taken out first, so that those staying are never moved: a move would
    // take them out of the page and back.
    const elements = [...this._tiles.values()].map(({ element }) => element),
      shown = new Set<Element>(elements);
    for (const old of container.querySelectorAll(':scope > *')) if (!shown.has(old)) old.remove();
    elements.forEach((element, index) => {
      const at = container.children[index];
      if (at !== element) container.insertBefore(element, at ?? null);
    });
    const replacement = focusedId && this._tiles.get(focusedId)?.element;
    if (replacement && replacement.tabIndex >= 0 && this.root.activeElement !== replacement)
      replacement.focus({ preventScroll: true });
    this.drawMoons();
    this.maps.draw();
  }
  drawMoons() {
    for (const canvas of this.root.querySelectorAll('.moon-disc'))
      if (canvas instanceof HTMLCanvasElement) {
        // Drawn once, a moon stays as it is, so one handed back blank is drawn again (see the sky's).
        if (!this._moons.has(canvas)) {
          this._moons.add(canvas);
          canvas.addEventListener('contextrestored', () => {
            delete canvas.dataset['drawn'];
            this.drawMoons();
          });
        }
        requestAnimationFrame(() => {
          void drawMoon(
            canvas,
            Number(canvas.dataset['phase']),
            Number(canvas.dataset['turn']) || 0,
            canvas.closest('.tile') ? 'tile' : canvas.closest('.moon-grid') ? 'calendar' : 'sheet',
          );
        });
      }
  }
  // What has come in shows on the tiles: each is looked at again, and drawn again where what it
  // shows has changed. `all` draws every one again, as when the words come in a new language,
  // which reach into what the map draws after its markup.
  redrawTiles(all = false) {
    this._tilesKey = '';
    if (all) this._tiles.clear();
    this.render();
  }
  // The summary can gain a home label or a stale reading, and uses larger type on a phone.
  // Measure its natural height so top padding never cuts into those lines.
  fitHero() {
    if (this.config?.weather_layout !== 'page' || !this.isConnected) return;
    const { current, home, weather } = this.parts,
      over = home.offsetHeight;
    // The optional home label hangs above the place without pushing the panels down.
    for (const [name, value] of [
      ['--current-height', `${current.offsetHeight - over}px`],
      ['--home-height', `${over}px`],
    ] as const)
      if (weather.style.getPropertyValue(name) !== value) weather.style.setProperty(name, value);
  }

  // Everything is to be measured again, on the next frame.
  remeasure() {
    this._geometry = null;
  }
  // Where everything sits, measured once and kept until the card resizes or
  // re-renders: measuring layout every animation frame forced a fresh layout each time.
  geometry(): Geometry {
    if (this._geometry) return this._geometry;
    // Measured against the card: a scrolling page's box starts at the band (see PageScroll).
    const zoom = this.measureZoom(),
      scroller = this.parts.content,
      content = this.box(this.parts.weather, zoom),
      { width } = content,
      page = this.config?.weather_layout === 'page',
      scrolls = this.pageScroll.scrolls();
    // The sky fills the window behind the scrolling panels, so the full layout paints
    // one screenful of it (at least the hero and a little more); a longer page continues
    // in the sky's horizon colour.
    const heroHeight = this.parts.hero.offsetHeight,
      height = page
        ? Math.min(content.height, Math.max(heroHeight + SKY_BELOW_HERO, (window.innerHeight || 0) / zoom))
        : content.height;
    // Panels beside the conditions narrow the open sky; panels below shorten it. A page that
    // scrolls in place keeps them where they sit in the page (see paint).
    const origin = scrolls
        ? new DOMRect(content.x, content.y - scroller.scrollTop, content.width, content.height)
        : content,
      root = this.box(this.parts.sceneRoot, zoom),
      covered: Panel[] = [],
      edges: Panel[] = [],
      panes: Geometry['panes'] = [],
      open = { x: 0, y: 0, width, height };
    for (const panel of this.root.querySelectorAll<HTMLElement>(GLASS)) {
      const box = this.box(panel, zoom);
      if (!box.width || !box.height) continue;
      const rect = {
        x: box.left - root.left,
        y: box.top - root.top,
        width: box.width,
        height: box.height,
        radius: parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 0,
      };
      panes.push({ panel, rect });
      const edge = { ...rect, x: box.left - origin.left, y: box.top - origin.top };
      edges.push(edge);
      if (panel === this.parts.forecast || panel === this.parts.daily) covered.push(edge);
    }
    if (page) open.height = heroHeight;
    else
      for (const rect of covered) {
        if (rect.x > width * BESIDE) open.width = Math.min(open.width, rect.x);
        else open.height = Math.min(open.height, rect.y);
      }
    // Collapsing, a scrolling page's conditions only move and fade, so they are taken where
    // they rest: the sky behind them holds still.
    const current = this.parts.current,
      box = scrolls ? null : this.box(current, zoom),
      text = box
        ? { x: box.left - content.left, y: box.top - content.top, width: box.width, height: box.height }
        : { x: current.offsetLeft, y: current.offsetTop, width: current.offsetWidth, height: current.offsetHeight };
    this.parts.sky.style.height = page ? `${height}px` : '';
    this.parts.weather.style.setProperty('--sky-h', page ? `${height}px` : '100%');
    const geometry = {
      width,
      height,
      text,
      open,
      covered,
      edges,
      panes,
      glass: panes.map(({ rect }) => rect),
      root: { width: root.width, height: root.height },
    };
    this._geometry = geometry;
    return geometry;
  }
  // How much the full page is zoomed on screen (see the size setting): its width there over its
  // width in its own pixels.
  measureZoom(): number {
    const width = parseFloat(getComputedStyle(this).width);
    this.zoom = width ? this.getBoundingClientRect().width / width : 1;
    return this.zoom;
  }
  // A box measured on screen, in the page's own pixels, which its layout and canvases use.
  box(node: Element, zoom = this.zoom): DOMRect {
    const rect = node.getBoundingClientRect();
    return zoom === 1 ? rect : new DOMRect(rect.x / zoom, rect.y / zoom, rect.width / zoom, rect.height / zoom);
  }
  // One-off repaints (a new state, a resize) take the clock's time while animating:
  // phase 0 means a still frame, which settles everything at once and would cut short
  // the crossfade after a condition change and the build-up of rain, stars and moon.
  paint(phase = this.animating ? performance.now() : 0) {
    if (!this.isConnected || !this.config?.weather_scene || !this.scene.key) return;
    // A resize or weather update can ask for a frame after the sky has gone offscreen.
    this._paintPending = !this.inSight;
    if (this._paintPending) return;
    const { width, height, open, covered, edges, text } = this.geometry();
    if (!width || !height) return;
    // Scrolled, the panels show over the still sky where they are now, cut at the pinned band;
    // rain splashes only on tops still below it (or on its line, to within a pixel).
    const { top, pin } = this.pageScroll.at,
      scrolled = this.pageScroll.scrolls(),
      shown = scrolled
        ? covered.flatMap(panel => {
            const from = Math.max(panel.y - top, pin),
              to = panel.y + panel.height - top;
            return to > from ? [{ ...panel, y: from, height: to - from }] : [];
          })
        : covered;
    // Refraction can use the completed sky from the previous animation frame.
    // Copying it immediately after painting forces Firefox to finish that frame's
    // queued canvas work synchronously. First, resized and still frames need the
    // new sky immediately; only an established animated rain surface goes first.
    const dpr = (window.devicePixelRatio || 1) * this.zoom,
      sky = this.parts.sky,
      glassFirst =
        !this.scene.hasGPUSky &&
        this.config.glass_refraction &&
        phase !== 0 &&
        this.animating &&
        this.glass.hasRain &&
        sky.width === Math.round(width * Math.min(dpr, 2)) &&
        sky.height === Math.round(height * Math.min(dpr, 2));
    if (glassFirst) this.glass.paint(phase);
    this.scene.paint(width, height, dpr, phase, {
      open,
      covered: shown,
      edges: scrolled
        ? edges.flatMap(panel => (panel.y - top >= pin - 1 ? [{ ...panel, y: panel.y - top }] : []))
        : edges,
      text,
      scroll: scrolled ? top : 0,
    });
    if (!glassFirst) this.glass.paint(phase);
  }
  syncEffects() {
    const wasAnimating = this.animating;
    clock.remove(this);
    this.animating = false;
    if (!this.isConnected || !this.config) return;
    this.maps.draw();
    const detail = this.sheets.detail,
      fullMap = detail?.id === 'map' && detail.dialog.open && detail.dialog.hasAttribute('data-full'),
      visible = this.visible && !document.hidden;
    if (!this.config.weather_scene || this.config.low_power) this.glass.clearDrops();
    // A sky out of sight lets go of its largest layers until it is drawn again.
    if (!visible) {
      this.scene.release();
      this.glass.release();
    }
    if (visible && !fullMap && this.config.weather_scene && this.config.weather_animation && !this.motion?.matches) {
      // Precipitation and lightning need smooth motion; calm skies only drift.
      clock.add(this);
      this.animating = true;
    } else if (visible && (wasAnimating || this._paintPending)) this.paint();
  }
  // The element showing a part of the card, when it is showing (see EditPreview). The tiles as a
  // whole are where they begin: their box lays out its tiles but has none of its own.
  partElement(part: EditedPart): HTMLElement | null {
    const { parts } = this;
    const fixed: Partial<Record<EditedPart, HTMLElement>> = {
      conditions: parts.current,
      forecast: parts.forecast,
      daily: parts.daily,
      alerts: parts.alert,
      next_hour: parts.nextHour,
    };
    const element =
      fixed[part] ?? parts.tiles.querySelector<HTMLElement>(part === 'tiles' ? '[data-tile]' : `[data-tile="${part}"]`);
    return element === null || element.hidden !== false || element.offsetHeight === 0 ? null : element;
  }
  // Home Assistant card interface.
  static async getConfigElement(): Promise<HTMLElement> {
    await import('./card/editor.ts');
    return document.createElement(EDITOR_TAG);
  }
  // The card the picker starts from: a weather entity not yet on the dashboard, then one that is
  // (neither list holds an unavailable one), then any Home Assistant knows of, and within each
  // the one that supplies the most forecasts.
  static getStubConfig(
    hass?: HomeAssistant,
    entities: readonly string[] = [],
    entitiesFallback: readonly string[] = [],
  ): { type: string; entity: string; weather_layout: 'page' } {
    return { type: CARD_TYPE, entity: suggestWeatherEntity(hass, entities, entitiesFallback), weather_layout: 'page' };
  }
  // The full layout grows with its tiles, so it leaves the sections grid's rows alone.
  getCardSize(): number {
    const layout = this.config?.weather_layout;
    return layout === 'page' || layout === 'expanded' || layout === 'compact' || layout === 'strip'
      ? CARD_ROWS[layout]
      : CARD_ROWS.other;
  }
  // A sections dashboard's size for the card (see GRID).
  getGridOptions(): { columns: number; min_columns: number; rows: number | 'auto'; min_rows?: number } {
    const layout = this.config?.weather_layout;
    return { ...(layout === 'page' || layout === 'compact' || layout === 'strip' ? GRID[layout] : GRID.other) };
  }
  // The same, for sections dashboards before Home Assistant 2024.11, whose grid had a column for every
  // three of today's. A height of its own is left out, for the card's own height.
  getLayoutOptions(): { grid_columns: number; grid_min_columns: number; grid_rows?: number; grid_min_rows?: number } {
    const { columns, min_columns, rows, min_rows } = this.getGridOptions();
    return {
      grid_columns: columns / OLD_GRID_COLUMN,
      grid_min_columns: min_columns / OLD_GRID_COLUMN,
      ...(rows === 'auto' ? {} : { grid_rows: rows }),
      ...(min_rows === undefined ? {} : { grid_min_rows: min_rows }),
    };
  }
}

declare global {
  interface HTMLElementTagNameMap {
    [CARD_TAG]: IWeatherCard;
  }
}
const loaded = { version: __CARD_VERSION__, from: import.meta.url };
if (!customElements.get(CARD_TAG)) {
  customElements.define(CARD_TAG, IWeatherCard);
  window.iWeatherLoaded = loaded;
  // Which build a dashboard is running, for anyone reporting a fault.
  console.info(`iWeather ${__CARD_VERSION__}`);
} else {
  // A second copy of the card's file, from another address, as an old one left in place beside an
  // installed one is: the first stays, so the dashboard may run an older build without a sign.
  const first = window.iWeatherLoaded;
  if (first && first.from !== loaded.from)
    console.warn(
      `iWeather ${loaded.version} from ${loaded.from} was not used: ${first.version} from ${first.from} came first. ` +
        'The dashboard resources list the card twice.',
    );
}
// A dashboard of the weather alone, among the community dashboards a new dashboard can start from.
if (!customElements.get(`ll-strategy-dashboard-${STRATEGY}`))
  customElements.define(`ll-strategy-dashboard-${STRATEGY}`, WeatherDashboardStrategy);
window.customStrategies ??= [];
if (!window.customStrategies.some(strategy => strategy.type === STRATEGY))
  window.customStrategies.push({
    type: STRATEGY,
    strategyType: 'dashboard',
    name: 'iWeather',
    get description() {
      return say('Forecast with live scenery, hourly conditions, precipitation and wind, and a 10-day outlook.');
    },
    documentationURL: 'https://github.com/sitapix/iweather-card#readme',
  });
// The layouts the card picker offers for a weather entity, each shown on it: the full page, the
// forecast card and the compact tile.
const SUGGESTED: readonly { label: string; layout?: 'page' | 'compact' }[] = [
  { label: phrase('Full page'), layout: 'page' },
  { label: phrase('Forecast') },
  { label: phrase('Compact'), layout: 'compact' },
];
window.customCards ??= [];
if (!window.customCards.some(card => card.type === CARD_TAG))
  window.customCards.push({
    type: CARD_TAG,
    name: 'iWeather',
    // Read each time a picker lists it, so it can come in the page's language.
    get description() {
      return say('Forecast with live scenery, hourly conditions, precipitation and wind, and a 10-day outlook.');
    },
    preview: true,
    documentationURL: 'https://github.com/sitapix/iweather-card#readme',
    // Offered when picking a card for a weather entity, and for nothing else, with labels in the
    // page's language.
    getEntitySuggestion: (_hass, entity) =>
      inDomain(entity, 'weather')
        ? SUGGESTED.map(({ label, layout }) => ({
            label: say(label),
            config: { type: CARD_TYPE, entity, ...(layout === undefined ? {} : { weather_layout: layout }) },
          }))
        : null,
  });
