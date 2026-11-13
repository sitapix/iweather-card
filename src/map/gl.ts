// The large map's ground drawn live with WebGL from vector tiles, so it zooms smoothly at any
// level with its names upright and sharp: MapLibre GL, loaded once from beside the card's own file
// when the large map first opens (it is about as large as the card, which doesn't carry it), over
// OpenFreeMap's tiles (OpenStreetMap's data, free, with no key). Its zooms count 512 px tiles,
// one step less than the card's 256 px ones. Without WebGL, or offline, the card's own tiles
// stay.
import { tilePoint, type ScalarField } from './sources.ts';
import { PRECIPITATION, RADAR, RADAR_STILL, RADAR_STILL_NIGHT, radarLevels, radarRecolour } from './field.ts';
import { RainLayer } from './rain-gl.ts';
import { forecastLevels, forecastRecolour, isForecastTile } from './radar-forecast.ts';
import { pacedFetch } from './pace.ts';
import { say } from '../weather/words.ts';
import { SECOND } from '../lib/time.ts';
import { coverageTile } from '../lib/services.ts';

const mapLibre = (file: string) => new URL(file, import.meta.url).href;
export const GL_STYLE = 'https://tiles.openfreemap.org/styles/positron';
export const GL_ZOOM_OFFSET = 1;
// The page is drawn a quarter larger than it stands on screen (see map/views.ts).
export const PAGE_DRAWN = 1.25;
export const GL_CREDIT = '© OpenFreeMap · © OpenMapTiles · © OpenStreetMap contributors',
  GL_CREDIT_SHORT = '© OpenStreetMap · OpenMapTiles · OpenFreeMap';

// The few parts of MapLibre the card uses (its own types don't build under the card's module
// settings). Places are [longitude, latitude].
type Place = [longitude: number, latitude: number];
// A map image's corners, from its north-west clockwise.
export type Corners = [Place, Place, Place, Place];
interface GlLayer {
  id: string;
  type: string;
}
export interface GlMap {
  on(
    event: 'load' | 'movestart' | 'move' | 'moveend' | 'idle' | 'remove' | 'webglcontextlost' | 'webglcontextrestored',
    listener: () => void,
  ): unknown;
  once(event: 'load' | 'idle', listener: () => void): unknown;
  getCanvas(): HTMLCanvasElement;
  unproject(point: [x: number, y: number]): { lng: number; lat: number };
  getStyle(): { layers: GlLayer[] };
  getLayer(id: string): object | undefined;
  addLayer(layer: object, before?: string): unknown;
  removeLayer(id: string): unknown;
  moveLayer(id: string, before?: string): unknown;
  getSource(id: string): object | undefined;
  addSource(id: string, source: object): unknown;
  removeSource(id: string): unknown;
  getPaintProperty(layer: string, name: string): unknown;
  setPaintProperty(layer: string, name: string, value: unknown): unknown;
  getFilter(layer: string): unknown;
  setFilter(layer: string, filter: unknown): unknown;
  setLayerZoomRange(layer: string, least: number, most: number): unknown;
  getLayoutProperty(layer: string, name: string): unknown;
  setLayoutProperty(layer: string, name: string, value: unknown): unknown;
  hasImage(id: string): boolean;
  addImage(id: string, image: ImageData, options: { pixelRatio: number }): unknown;
  getCenter(): { lng: number; lat: number };
  getBounds(): { getNorth(): number; getSouth(): number; getEast(): number; getWest(): number };
  getZoom(): number;
  triggerRepaint(): void;
  project(place: Place): { x: number; y: number };
  jumpTo(camera: { center: Place; zoom: number }): unknown;
  easeTo(camera: {
    center?: Place;
    zoom?: number;
    around?: Place;
    duration?: number;
    easing?: (progress: number) => number;
  }): unknown;
  stop(): unknown;
  panBy(offset: [x: number, y: number], options?: { animate: boolean }): unknown;
  setMaxZoom(zoom: number): unknown;
  resize(): unknown;
  remove(): void;
  touchZoomRotate: { disableRotation(): void };
}
export interface GlOptions {
  container: HTMLElement;
  // MapLibre's own words: what its map is called to a screen reader.
  locale?: Readonly<Record<string, string>>;
  style: string;
  center: Place;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  attributionControl: false;
  keyboard: false;
  dragRotate: false;
  pitchWithRotate: false;
  touchPitch: false;
}
// A map drawn once and let go (see groundStill).
interface GlStillOptions {
  container: HTMLElement;
  locale?: Readonly<Record<string, string>>;
  style: string;
  center: Place;
  zoom: number;
  interactive: false;
  attributionControl: false;
  fadeDuration: 0;
  trackResize: false;
  pixelRatio: number;
  canvasContextAttributes: { preserveDrawingBuffer: true };
}
export interface MapStillView {
  latitude: number;
  longitude: number;
  zoom: number;
  width: number;
  height: number;
  pixelRatio: number;
}
type TileLoader = (request: { url: string }, abort: AbortController) => Promise<{ data: ImageBitmap }>;
export interface MapLibre {
  Map: new (options: GlOptions | GlStillOptions) => GlMap;
  addProtocol(scheme: string, load: TileLoader): void;
}
const isMapLibre = (value: unknown): value is MapLibre =>
  typeof value === 'object' &&
  value !== null &&
  'Map' in value &&
  typeof value.Map === 'function' &&
  'addProtocol' in value &&
  typeof value.addProtocol === 'function';
// Asked once, on a context let go at once rather than left to count against the page's.
const webGl = () => {
  const gl =
    document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
  gl?.getExtension('WEBGL_lose_context')?.loseContext();
  return Boolean(gl);
};

let loading: Promise<MapLibre | null> | undefined;
// MapLibre, its styles put in `root` (they don't reach into a shadow root from the page).
export function loadMapLibre(root: ShadowRoot): Promise<MapLibre | null> {
  if (!root.querySelector('link[data-maplibre]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = mapLibre(__MAPLIBRE__.style);
    link.dataset['maplibre'] = '';
    root.append(link);
  }
  loading ??= webGl()
    ? import(/* @vite-ignore */ mapLibre(__MAPLIBRE__.script)).then(
        (module: unknown) => {
          if (!isMapLibre(module)) return null;
          module.addProtocol(GAP_SCHEME, gapTile);
          return module;
        },
        () => null,
      )
    : Promise.resolve(null);
  return loading;
}

// A map, or none where a browser that offers WebGL then refuses it a context.
export function newMap(maplibre: MapLibre, options: GlOptions | GlStillOptions): GlMap | null {
  try {
    return new maplibre.Map({ ...options, locale: { 'Map.Title': say('Map') } });
  } catch {
    return null;
  }
}

// The radar's tiles: 512 px, no deeper than zoom 7. The large map reads them as readings (see
// rain-gl), the small map as pictures in its own colours.
const RADAR_DEEPEST = 7,
  RADAR_TILE = 512,
  FORECAST_TILE = 256,
  FORECAST_WAIT = 20 * SECOND,
  recolourStill = { day: radarRecolour(RADAR_STILL), night: radarRecolour(RADAR_STILL_NIGHT) },
  recolourForecast = { day: forecastRecolour(RADAR_STILL), night: forecastRecolour(RADAR_STILL_NIGHT) };
// A tile for a small map, the radar's or the short forecast's, in its own colours (see RADAR_STILL).
export const stillRadarImage = async (url: string, night: boolean, signal: AbortSignal | null = null) => {
  const image = await radarImage(url, signal);
  (isForecastTile(url) ? recolourForecast : recolourStill)[night ? 'night' : 'day'](image.data);
  return image;
};
// A tile's readings for the large map, a byte a pixel (see radarLevels); none from a tile of
// another size.
async function radarReadings(url: string, signal: AbortSignal) {
  const forecast = isForecastTile(url),
    image = await radarImage(url, signal, forecast ? RADAR_TILE : undefined);
  if (image.width !== RADAR_TILE || image.height !== RADAR_TILE) throw new Error('Unexpected radar tile size');
  return forecast ? forecastLevels(image.data) : radarLevels(image.data);
}
async function radarImage(url: string, signal: AbortSignal | null, size?: number) {
  const forecast = isForecastTile(url),
    timed = forecast ? new AbortController() : undefined,
    cancel = () => timed?.abort(),
    timeout = timed ? setTimeout(cancel, FORECAST_WAIT) : undefined;
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  let blob: Blob;
  try {
    const response = timed ? await fetch(url, { signal: timed.signal }) : await pacedFetch(url, signal);
    if (!response.ok) throw new Error(`Radar tile: ${response.status}`);
    blob = await response.blob();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
  const decoded = await createImageBitmap(blob);
  if (forecast && (decoded.width !== FORECAST_TILE || decoded.height !== FORECAST_TILE)) {
    decoded.close();
    throw new Error('Unexpected HRRR tile size');
  }
  const canvas = new OffscreenCanvas(size ?? decoded.width, size ?? decoded.height),
    context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Radar tile: no 2D canvas');
  context.imageSmoothingEnabled = false;
  context.drawImage(decoded, 0, 0, canvas.width, canvas.height);
  decoded.close();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

// Where the radar doesn't reach, faint diagonal stripes, as its coverage tiles (black where it has
// none) cut out of a tile of them: a whole number across, so they carry on from tile to tile, at
// twice the tile's size so they stay fine. Which tiles have any is kept, for gapsInView.
const GAP_SCHEME = 'card-gaps',
  GAPS = 'radar-gaps',
  GAP_URL = coverageTile('{z}', '{x}', '{y}').replace('https://', `${GAP_SCHEME}://`),
  GAP_TILE = 1024,
  GAP_LINES = 82,
  GAP_LINE = { width: 4.5, colour: 'rgba(0,0,0,0.22)', dayOpacity: 0.8 },
  GAP_SAMPLE = 32,
  RGBA = 4;
const gapTiles = new Set<string>();
let gapStripes: OffscreenCanvas | undefined;
function stripes() {
  if (gapStripes) return gapStripes;
  const canvas = new OffscreenCanvas(GAP_TILE, GAP_TILE),
    context = canvas.getContext('2d');
  if (!context) throw new Error('Radar coverage: no 2D canvas');
  const apart = GAP_TILE / GAP_LINES;
  context.strokeStyle = GAP_LINE.colour;
  context.lineWidth = GAP_LINE.width;
  context.beginPath();
  for (let line = -GAP_LINES; line <= GAP_LINES; line += 1) {
    context.moveTo(line * apart, GAP_TILE);
    context.lineTo(line * apart + GAP_TILE, 0);
  }
  context.stroke();
  gapStripes = canvas;
  return canvas;
}
async function gapTile({ url }: { url: string }, abort: AbortController) {
  const response = await pacedFetch(url.replace(`${GAP_SCHEME}://`, 'https://'), abort.signal);
  if (!response.ok) throw new Error(`Radar coverage: ${response.status}`);
  const decoded = await createImageBitmap(await response.blob()),
    canvas = new OffscreenCanvas(GAP_TILE, GAP_TILE),
    context = canvas.getContext('2d'),
    sample = new OffscreenCanvas(GAP_SAMPLE, GAP_SAMPLE).getContext('2d', { willReadFrequently: true });
  if (!context || !sample) throw new Error('Radar coverage: no 2D canvas');
  sample.drawImage(decoded, 0, 0, GAP_SAMPLE, GAP_SAMPLE);
  const place = /\/(\d+\/\d+\/\d+)\/0\/0_0/u.exec(url)?.[1] ?? '';
  if (sample.getImageData(0, 0, GAP_SAMPLE, GAP_SAMPLE).data.some((value, i) => i % RGBA === RGBA - 1 && value > 0))
    gapTiles.add(place);
  context.drawImage(decoded, 0, 0, GAP_TILE, GAP_TILE);
  decoded.close();
  context.globalCompositeOperation = 'source-in';
  context.drawImage(stripes(), 0, 0);
  return { data: await createImageBitmap(canvas) };
}
// Whether the view takes in somewhere the radar doesn't reach, by the tiles shown so far.
export function gapsInView(map: GlMap) {
  const bounds = map.getBounds(),
    zoom = Math.min(RADAR_DEEPEST, Math.max(0, Math.round(map.getZoom()))),
    size = 2 ** zoom,
    from = tilePoint(bounds.getNorth(), bounds.getWest(), zoom),
    to = tilePoint(bounds.getSouth(), bounds.getEast(), zoom);
  for (let x = Math.floor(from.x); x <= Math.floor(to.x); x += 1)
    for (let y = Math.max(0, Math.floor(from.y)); y <= Math.min(size - 1, Math.floor(to.y)); y += 1)
      if (gapTiles.has(`${zoom}/${((x % size) + size) % size}/${y}`)) return true;
  return false;
}

// The ground in each layer's look, with roads and rail as single hairlines (their outlines clear,
// or they double; motorways a little wider), and no road names or shields but on the pale one.
// For precipitation, pale: white,
// with water the palest blue, roads warm light grey and borders dotted grey. Under the
// temperature and AQI, white, roads as faint dark lines over the colours, borders a little
// stronger. For wind, one deep blue for land and water, roads and borders as faint light lines,
// every shore of sea and lake a soft pale line, so the land keeps its shape though it shares the
// water's colour, and places in white over a dark halo; full screen, the same in a deeper blue. For a dark
// theme, night: dark grey, water a shade lighter,
// rivers and borders lighter lines, roads all but gone, places in white, states and countries in
// light grey. A sheet's own small map is night's on either theme, as the sheet is dark on both,
// or the wind's blue for the wind, with its places' dots filled and more of them named (see
// groundStill). What it changes is kept, to put back; a colour it leaves out stays the style's.
export type GroundLook = 'pale' | 'field' | 'wind' | 'windFull' | 'night' | 'sheet' | 'windSheet';
// The looks whose places' dots are filled, and those of a sheet's own map, drawn closer.
const FILLED_DOTS: ReadonlySet<GroundLook> = new Set(['pale', 'field', 'sheet', 'windSheet']),
  SHEET_LOOKS: ReadonlySet<GroundLook> = new Set(['sheet', 'windSheet']);
const CLEAR = 'rgba(0,0,0,0)';
const ROAD_WIDTHS = {
  motorway: ['interpolate', ['exponential', 1.4], ['zoom'], 5, 0.6, 8, 1, 12, 2],
  other: ['interpolate', ['exponential', 1.4], ['zoom'], 5, 0.4, 8, 0.7, 12, 1.5],
};
// Shores: the outline of the tiles' water, drawn over it as a soft line 2 px wide.
const COAST = { id: 'coast', source: 'openmaptiles', layer: 'water', width: 2, blur: 1.5 } as const;
interface Ground {
  land?: string;
  water?: string;
  cover?: string;
  river?: string;
  // Shores, where a look draws them.
  coast?: string;
  line: string;
  border: string;
  text?: string;
  waterText?: string;
  // States' and countries' names.
  areaText?: string;
  halo?: string;
  placeHalo?: string;
  roadNames: boolean;
}
const WIND: Ground = {
  land: '#207ab3',
  water: '#207ab3',
  coast: 'rgba(190,225,250,0.3)',
  cover: 'rgba(255,255,255,0.03)',
  line: CLEAR,
  border: 'rgba(255,255,255,0.4)',
  text: '#ffffff',
  waterText: '#cfe0f2',
  halo: 'rgba(8,36,74,0.55)',
  roadNames: false,
};
const NIGHT: Ground = {
  land: '#4c4e52',
  water: '#535559',
  cover: CLEAR,
  river: '#5e6064',
  line: 'rgba(255,255,255,0.06)',
  border: '#66686d',
  text: '#ffffff',
  waterText: '#a9adb3',
  areaText: '#d1d1c8',
  halo: 'rgba(0,0,0,0.35)',
  roadNames: false,
};
export const GROUNDS: Record<GroundLook, Ground> = {
  pale: {
    land: '#ffffff',
    water: '#f5faff',
    cover: CLEAR,
    river: '#e2ebf3',
    line: '#e4e2da',
    border: '#c2c2c2',
    roadNames: true,
  },
  field: {
    land: '#ffffff',
    cover: CLEAR,
    line: 'rgba(40,40,30,0.13)',
    border: 'rgba(40,40,30,0.35)',
    placeHalo: 'rgba(255,255,255,0.3)',
    roadNames: false,
  },
  wind: WIND,
  windFull: { ...WIND, land: '#0e78b2', water: '#0e78b2' },
  night: NIGHT,
  sheet: NIGHT,
  windSheet: WIND,
};

// Places named in bold beside a dot, at every zoom: the dot at the start of the name's baseline, or
// at its end, or under or over it, wherever the name fits. The larger the place, the larger its name
// and dot. The dot is dark, or a white ring on the wind's blue and the night's grey; a sheet's own
// map fills it.
const PLACE_FONT = ['Noto Sans Bold'];
const PLACES: Record<string, { text: unknown[]; dot: number }> = {
  label_village: { text: ['interpolate', ['linear'], ['zoom'], 8, 9.5, 13, 11.5], dot: 0.5 },
  label_town: { text: ['interpolate', ['linear'], ['zoom'], 8, 10, 13, 12], dot: 0.55 },
  label_city: { text: ['interpolate', ['linear'], ['zoom'], 4, 11.5, 8, 12, 13, 14], dot: 0.7 },
  label_city_capital: { text: ['interpolate', ['linear'], ['zoom'], 4, 11.5, 8, 12.5, 13, 15], dot: 0.7 },
};
// Where a name may sit, in ems from its dot, in order of choice. Names keep to one line.
const PLACE_SPOTS = [
  'bottom-left',
  [0.3, 0.38],
  'bottom-right',
  [-0.3, 0.38],
  'top-left',
  [0.3, -0.2],
  'top-right',
  [-0.3, -0.2],
];
const PLACE_WIDTH = 20;
// Zoomed out, only the larger cities are named, by the ranks the map's tiles give them, and
// countries not until the widest of all, which leaves the view to the weather.
const CITIES = ['label_city', 'label_city_capital'],
  COUNTRIES = ['label_country_1', 'label_country_2', 'label_country_3'],
  ALL_RANKS = 99,
  CITY_RANKS = ['step', ['zoom'], 2, 4, 3, 5, 4, 6, ALL_RANKS],
  COUNTRIES_BELOW = 3,
  COUNTRIES_FROM = 0;
// A place goes by one name, in Latin letters where it has them, not that over its local script.
const NAMED = /^(label|water)/,
  ONE_NAME = ['coalesce', ['get', 'name:latin'], ['get', 'name']];
// A dot is a dark ring round white, or a white ring with the ground showing through it.
const DOT = { size: 20, ratio: 2, radius: 6 } as const;
const DOTS = {
  dark: { id: 'place-dot-dark', fill: '#ffffff', ring: '#000000', width: 3 },
  light: { id: 'place-dot-light', fill: CLEAR, ring: '#ffffff', width: 3 },
} as const;
function placeDot(fill: string, ring: string, width: number) {
  const canvas = document.createElement('canvas');
  canvas.width = DOT.size;
  canvas.height = DOT.size;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.beginPath();
  context.arc(DOT.size / 2, DOT.size / 2, DOT.radius, 0, Math.PI * 2);
  context.fillStyle = fill;
  context.fill();
  context.lineWidth = width;
  context.strokeStyle = ring;
  context.stroke();
  return context.getImageData(0, 0, DOT.size, DOT.size);
}
const placesSet = new WeakSet<GlMap>();
function setPlaces(map: GlMap) {
  if (placesSet.has(map)) return;
  placesSet.add(map);
  for (const { id, fill, ring, width } of Object.values(DOTS)) {
    const dot = map.hasImage(id) ? null : placeDot(fill, ring, width);
    if (dot) map.addImage(id, dot, { pixelRatio: DOT.ratio });
  }
  for (const [id, { text, dot }] of Object.entries(PLACES)) {
    if (!map.getLayer(id)) continue;
    map.setLayoutProperty(id, 'text-font', PLACE_FONT);
    map.setLayoutProperty(id, 'text-size', text);
    map.setLayoutProperty(id, 'text-anchor', undefined);
    map.setLayoutProperty(id, 'text-offset', undefined);
    map.setLayoutProperty(id, 'text-variable-anchor-offset', PLACE_SPOTS);
    map.setLayoutProperty(id, 'text-justify', 'auto');
    map.setLayoutProperty(id, 'text-max-width', PLACE_WIDTH);
    map.setLayoutProperty(id, 'icon-size', dot);
  }
  for (const { id, type } of map.getStyle().layers)
    if (type === 'symbol' && NAMED.test(id)) map.setLayoutProperty(id, 'text-field', ONE_NAME);
  for (const id of CITIES)
    if (map.getLayer(id))
      map.setFilter(id, ['all', map.getFilter(id), ['<=', ['coalesce', ['get', 'rank'], ALL_RANKS], CITY_RANKS]]);
  for (const id of COUNTRIES) if (map.getLayer(id)) map.setLayerZoomRange(id, COUNTRIES_FROM, COUNTRIES_BELOW);
}

// The shore line, added once over the water, hidden by the looks that draw none.
function addCoast(map: GlMap) {
  if (map.getLayer(COAST.id) || !map.getSource(COAST.source)) return;
  const layers = map.getStyle().layers,
    above = layers[layers.findIndex(({ id }) => id === COAST.layer) + 1]?.id;
  map.addLayer(
    {
      id: COAST.id,
      type: 'line',
      source: COAST.source,
      'source-layer': COAST.layer,
      filter: ['match', ['geometry-type'], ['MultiPolygon', 'Polygon'], true, false],
      layout: { visibility: 'none' },
      paint: { 'line-color': CLEAR, 'line-width': COAST.width, 'line-blur': COAST.blur },
    },
    above,
  );
}

const groundKept = new WeakMap<GlMap, Map<string, unknown>>(),
  groundNow = new WeakMap<GlMap, GroundLook>();
export function paintGround(map: GlMap, look: GroundLook) {
  setPlaces(map);
  addCoast(map);
  if (groundNow.get(map) === look) return;
  groundNow.set(map, look);
  const kept = groundKept.get(map) ?? new Map<string, unknown>();
  groundKept.set(map, kept);
  // Sets a property for the look, or, with none for it, puts back the style's own.
  const set = (layer: string, kind: 'paint' | 'layout', name: string, value: unknown) => {
    const key = `${layer}|${kind}|${name}`;
    if (!kept.has(key))
      kept.set(key, kind === 'paint' ? map.getPaintProperty(layer, name) : map.getLayoutProperty(layer, name));
    const to = value ?? kept.get(key);
    if (kind === 'paint') map.setPaintProperty(layer, name, to);
    else map.setLayoutProperty(layer, name, to);
  };
  const ground = GROUNDS[look];
  for (const { id, type } of map.getStyle().layers) {
    const border = id.startsWith('boundary'),
      road = id.startsWith('highway') || id.startsWith('road'),
      // A road's outline, drawn under its fill.
      casing = id.includes('casing');
    if (id === COAST.id) {
      set(id, 'layout', 'visibility', ground.coast === undefined ? 'none' : 'visible');
      set(id, 'paint', 'line-color', ground.coast ?? CLEAR);
    } else if (type === 'background') set(id, 'paint', 'background-color', ground.land);
    else if (type === 'fill') set(id, 'paint', 'fill-color', id === 'water' ? ground.water : ground.cover);
    else if (type === 'line') {
      set(
        id,
        'paint',
        'line-color',
        casing ? CLEAR : border ? ground.border : id === 'waterway' ? (ground.river ?? ground.line) : ground.line,
      );
      if (road || id.startsWith('tunnel'))
        set(id, 'paint', 'line-width', id.includes('motorway') ? ROAD_WIDTHS.motorway : ROAD_WIDTHS.other);
    } else if (type === 'symbol') {
      const place = id in PLACES;
      set(id, 'layout', 'visibility', road && !ground.roadNames ? 'none' : undefined);
      set(
        id,
        'paint',
        'text-color',
        id.startsWith('water')
          ? (ground.waterText ?? ground.text)
          : id.startsWith('label_state') || id.startsWith('label_country')
            ? (ground.areaText ?? ground.text)
            : ground.text,
      );
      set(id, 'paint', 'text-halo-color', place ? (ground.placeHalo ?? ground.halo) : ground.halo);
      if (place) map.setLayoutProperty(id, 'icon-image', FILLED_DOTS.has(look) ? DOTS.dark.id : DOTS.light.id);
    }
  }
}

// The first layer of a type, to put others under: the colour fields go under the first line (over
// land and water, under roads, borders and names), the radar under the first names.
const firstOf = (map: GlMap, type: string) => map.getStyle().layers.find(layer => layer.type === type)?.id;
const hasImage = (value: unknown): value is { updateImage(image: { url: string; coordinates: Corners }): unknown } =>
  typeof value === 'object' && value !== null && 'updateImage' in value && typeof value.updateImage === 'function';

// A colour field as an image stretched over its corners, or none, at 70%, as pale as the ground
// shows it.
const FIELD = 'field';
const FIELD_OPACITY = 0.7;
export function showField(map: GlMap, image: { url: string; corners: Corners } | null) {
  const source = map.getSource(FIELD);
  if (!image) {
    if (map.getLayer(FIELD)) map.removeLayer(FIELD);
    if (source) map.removeSource(FIELD);
    return;
  }
  if (hasImage(source)) source.updateImage({ url: image.url, coordinates: image.corners });
  else map.addSource(FIELD, { type: 'image', url: image.url, coordinates: image.corners });
  if (!map.getLayer(FIELD))
    map.addLayer(
      {
        id: FIELD,
        type: 'raster',
        source: FIELD,
        paint: { 'raster-opacity': FIELD_OPACITY, 'raster-fade-duration': 0 },
      },
      firstOf(map, 'line'),
    );
}

// The radar's frames, and the forecast's quarter hours over the next 12, as rain drawn from its
// readings (see rain-gl): the radar under the names, the forecast under the first line, as the
// colour fields lie. None, to take them away.
const RAIN = { radar: 'rain-radar', forecast: 'rain-forecast' } as const;
const rainLayers = new WeakMap<
  GlMap,
  { radar: RainLayer; forecast: RainLayer; failed?: (() => void) | undefined; forecastFrom?: number }
>();
function rainOf(map: GlMap) {
  let layers = rainLayers.get(map);
  if (!layers) {
    layers = {
      radar: new RainLayer(RAIN.radar, map, async (url, signal) => {
        try {
          return await radarReadings(url, signal);
        } catch (error) {
          if (isForecastTile(url) && !signal.aborted) rainLayers.get(map)?.failed?.();
          throw error;
        }
      }),
      forecast: new RainLayer(RAIN.forecast, map, radarReadings),
    };
    map.addLayer(layers.radar, firstOf(map, 'symbol'));
    map.addLayer(layers.forecast, firstOf(map, 'line'));
    rainLayers.set(map, layers);
    // Tiles on their way stop coming once the map has gone.
    const { radar, forecast } = layers;
    map.on('remove', () => {
      radar.onRemove();
      forecast.onRemove();
    });
  }
  return layers;
}
export function showRadar(
  map: GlMap,
  frames: readonly string[],
  shown: number,
  night: boolean,
  forecastFrom = Infinity,
  failed?: () => void,
) {
  if (!map.getLayer(GAPS)) {
    map.addSource(GAPS, { type: 'raster', tiles: [GAP_URL], tileSize: RADAR_TILE, maxzoom: RADAR_DEEPEST });
    map.addLayer({ id: GAPS, type: 'raster', source: GAPS }, firstOf(map, 'symbol'));
  }
  map.setLayoutProperty(GAPS, 'visibility', frames.length ? 'visible' : 'none');
  // Dark hatching marks missing observations on either ground colour.
  map.setPaintProperty(GAPS, 'raster-opacity', night ? 1 : GAP_LINE.dayOpacity);
  const layers = rainOf(map),
    { radar } = layers;
  layers.failed = failed;
  layers.forecastFrom = forecastFrom;
  radar.showRadar(frames, RADAR, forecastFrom);
  radar.showAt(shown);
}
// Shows the radar at `at`, a place among the frames set by showRadar: between two, their readings
// blended by how far it is from the first. Playing, every frame's tiles are asked for at once.
export function pickRadar(map: GlMap, at: number, playing = false) {
  const radar = rainLayers.get(map)?.radar;
  radar?.showAt(at);
  radar?.play(playing);
  // Coverage stripes describe observations, not the model's forecast domain.
  const visibility = at > (rainLayers.get(map)?.forecastFrom ?? Infinity) - 1 ? 'none' : 'visible';
  if (map.getLayer(GAPS) && map.getLayoutProperty(GAPS, 'visibility') !== visibility)
    map.setLayoutProperty(GAPS, 'visibility', visibility);
  return radar?.readyAt(at) ?? false;
}
// Whether every radar frame has come over the view (see RainLayer.loaded).
export const radarLoaded = (map: GlMap) => rainLayers.get(map)?.radar.loaded() ?? false;
// The forecast's precipitation, a grid for each of its quarter hours; and the place among them to
// show, as for the radar.
export function showRainSlots(map: GlMap, fields: readonly ScalarField[]) {
  if (!fields.length && !rainLayers.has(map)) return;
  rainOf(map).forecast.showGrid(fields, PRECIPITATION);
}
export const rainGapsInView = (map: GlMap) => rainLayers.get(map)?.forecast.gaps() ?? false;
export function pickRainSlot(map: GlMap, at: number) {
  rainLayers.get(map)?.forecast.showAt(at);
}

// A small map's ground and its names, as pictures of a map drawn once and let go: the names apart,
// to go over the radar, and nothing drawn again until the view changes. None, without MapLibre or
// if the map doesn't settle in 10 s.
export interface GroundStill {
  ground: string;
  names: string;
}
const STILL_WAIT = 10_000;
// Room kept clear of names: around home, for the pin and its name under it; along the foot, for
// the credit; and from a region's scale in, a hairline just outside the top and sides, so a name
// that would run past them moves to another side of its dot, or gives way, rather than being cut.
const STILL_CLEAR = { pin: { width: 72, height: 54, down: 9 }, foot: { height: 28 }, edge: 2 } as const;
// Names drawn over the top: an empty mark, placed before all others, makes them give way.
function keepClear(map: GlMap, id: string, [longitude, latitude]: Place, width: number, height: number, down = 0) {
  map.addImage(id, new ImageData(width, height), { pixelRatio: 1 });
  map.addSource(id, {
    type: 'geojson',
    data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [longitude, latitude] } },
  });
  map.addLayer({
    id,
    type: 'symbol',
    source: id,
    layout: { 'icon-image': id, 'icon-allow-overlap': true, 'icon-offset': [0, down] },
  });
}
// States and provinces as they're written short, where the map's tiles name them in full.
const SHORT_STATES: Readonly<Record<string, string>> = {
  Alabama: 'AL',
  Alaska: 'AK',
  Arizona: 'AZ',
  Arkansas: 'AR',
  California: 'CA',
  Colorado: 'CO',
  Connecticut: 'CT',
  Delaware: 'DE',
  Florida: 'FL',
  Georgia: 'GA',
  Hawaii: 'HI',
  Idaho: 'ID',
  Illinois: 'IL',
  Indiana: 'IN',
  Iowa: 'IA',
  Kansas: 'KS',
  Kentucky: 'KY',
  Louisiana: 'LA',
  Maine: 'ME',
  Maryland: 'MD',
  Massachusetts: 'MA',
  Michigan: 'MI',
  Minnesota: 'MN',
  Mississippi: 'MS',
  Missouri: 'MO',
  Montana: 'MT',
  Nebraska: 'NE',
  Nevada: 'NV',
  'New Hampshire': 'NH',
  'New Jersey': 'NJ',
  'New Mexico': 'NM',
  'New York': 'NY',
  'North Carolina': 'NC',
  'North Dakota': 'ND',
  Ohio: 'OH',
  Oklahoma: 'OK',
  Oregon: 'OR',
  Pennsylvania: 'PA',
  'Rhode Island': 'RI',
  'South Carolina': 'SC',
  'South Dakota': 'SD',
  Tennessee: 'TN',
  Texas: 'TX',
  Utah: 'UT',
  Vermont: 'VT',
  Virginia: 'VA',
  Washington: 'WA',
  'West Virginia': 'WV',
  Wisconsin: 'WI',
  Wyoming: 'WY',
  Alberta: 'AB',
  'British Columbia': 'BC',
  Manitoba: 'MB',
  'New Brunswick': 'NB',
  'Newfoundland and Labrador': 'NL',
  'Nova Scotia': 'NS',
  Ontario: 'ON',
  'Prince Edward Island': 'PE',
  Quebec: 'QC',
  Saskatchewan: 'SK',
};
const STATES = Object.entries(SHORT_STATES).flat(),
  STATE_NAMES = Object.keys(SHORT_STATES);
// A small map names more than the large one does at its zoom, for it can't be moved in closer:
// every state's border and short name, the largest countries, and the larger cities, the largest
// in larger type and first to find room; a small state capital gives way to a city. From a
// region's scale in (5 on the live map's scale), it names every city its tiles carry, as they
// carry fewer the further out they look, with less room kept round each, and each state by its
// whole name in capitals, spaced a little and a little quieter than the cities.
const STILL_LAYERS = { most: 24, states: 'label_state', borders: 'boundary_3' } as const,
  STILL_CITIES = {
    ranks: 4,
    large: 2,
    stateCapital: 4,
    type: { large: 15, small: 12.5 },
    room: { far: 22, region: 8 },
  } as const,
  STILL_STATE_TYPE = 10.5,
  STILL_COUNTRY_TYPE = 13,
  STILL_REGION = 5,
  STILL_STATE_NAMED = { type: 12, spacing: 0.05, opacity: 0.8, anchors: ['center', 'left', 'right'] } as const;
function nameMore(map: GlMap) {
  const region = map.getZoom() >= STILL_REGION,
    [largest, ...others] = COUNTRIES;
  for (const id of [STILL_LAYERS.states, STILL_LAYERS.borders, largest])
    if (id && map.getLayer(id)) map.setLayerZoomRange(id, 0, STILL_LAYERS.most);
  // Its state lines are unbroken, for they are few at this size.
  if (map.getLayer(STILL_LAYERS.borders)) map.setPaintProperty(STILL_LAYERS.borders, 'line-dasharray', null);
  if (map.getLayer(STILL_LAYERS.states)) {
    map.setLayoutProperty(
      STILL_LAYERS.states,
      'text-field',
      region
        ? ['match', ['get', 'name:en'], STATE_NAMES, ['upcase', ['get', 'name:en']], '']
        : ['match', ['get', 'name:en'], ...STATES, ''],
    );
    map.setLayoutProperty(STILL_LAYERS.states, 'text-size', region ? STILL_STATE_NAMED.type : STILL_STATE_TYPE);
    map.setLayoutProperty(STILL_LAYERS.states, 'text-font', PLACE_FONT);
    map.setLayoutProperty(STILL_LAYERS.states, 'text-letter-spacing', region ? STILL_STATE_NAMED.spacing : 0);
    // Placed before the cities, which find room around them; centred on its place, or beside it
    // where that would run past an edge.
    if (region) {
      map.setPaintProperty(STILL_LAYERS.states, 'text-opacity', STILL_STATE_NAMED.opacity);
      map.setLayoutProperty(STILL_LAYERS.states, 'text-variable-anchor', STILL_STATE_NAMED.anchors);
      map.moveLayer(STILL_LAYERS.states);
    }
  }
  for (const id of others) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
  if (largest && map.getLayer(largest)) {
    map.setLayoutProperty(largest, 'text-font', PLACE_FONT);
    map.setLayoutProperty(largest, 'text-size', STILL_COUNTRY_TYPE);
    map.setLayoutProperty(largest, 'text-transform', 'uppercase');
    map.setLayoutProperty(largest, 'text-max-width', PLACE_WIDTH);
  }
  for (const id of CITIES) {
    if (!map.getLayer(id)) continue;
    const city = ['==', ['get', 'class'], 'city'],
      capital = [id === 'label_city' ? '!=' : '==', ['get', 'capital'], 2];
    map.setFilter(
      id,
      region
        ? ['all', city, capital]
        : [
            'all',
            city,
            capital,
            ['<=', ['coalesce', ['get', 'rank'], ALL_RANKS], STILL_CITIES.ranks],
            [
              'any',
              ['<', ['coalesce', ['get', 'rank'], ALL_RANKS], STILL_CITIES.ranks],
              ['!=', ['get', 'capital'], STILL_CITIES.stateCapital],
            ],
          ],
    );
    map.setLayoutProperty(id, 'text-size', [
      'step',
      ['get', 'rank'],
      STILL_CITIES.type.large,
      STILL_CITIES.large + 1,
      STILL_CITIES.type.small,
    ]);
    map.setLayoutProperty(id, 'symbol-sort-key', ['get', 'rank']);
    map.setLayoutProperty(id, 'icon-padding', region ? STILL_CITIES.room.region : STILL_CITIES.room.far);
  }
}
// A sheet's own map is drawn a zoom closer on a canvas twice as wide and tall, and shown at half
// that, so it shows the same ground at the same scale but names the towns and villages the closer
// zoom's tiles carry; its suburbs and hamlets stay unnamed. Everything drawn on it is twice the
// size to come out as it would at its own zoom.
const CLOSER = 2,
  // Each kind of layer's sizes, by where in its style they are set: asked of a layer without them,
  // MapLibre throws.
  SIZES: Readonly<Record<string, { layout: readonly string[]; paint: readonly string[] }>> = {
    symbol: {
      layout: ['text-size', 'icon-size', 'icon-padding', 'text-padding'],
      paint: ['text-halo-width', 'text-halo-blur'],
    },
    line: { layout: [], paint: ['line-width'] },
  },
  OTHER_PLACES = 'label_other';
// A size `by` times as large: a number, the values an interpolation or step gives (every second
// item of its list from the first value's place on), numbers in a list, or anything else
// multiplied.
const FIRST_VALUE: Readonly<Record<string, number>> = { interpolate: 4, step: 2 };
const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);
export function enlarged(value: unknown, by: number): unknown {
  if (typeof value === 'number') return value * by;
  if (!isList(value)) return value;
  const [op] = value,
    first = typeof op === 'string' ? FIRST_VALUE[op] : undefined;
  if (first !== undefined)
    return value.map((each, i) => (i >= first && (i - first) % 2 === 0 ? enlarged(each, by) : each));
  if (value.every(each => typeof each === 'number'))
    return value.map(each => (typeof each === 'number' ? each * by : each));
  return ['*', by, value];
}
function drawnCloser(map: GlMap, by: number) {
  for (const { id, type } of map.getStyle().layers) {
    const sizes = SIZES[type];
    if (!sizes) continue;
    for (const name of sizes.layout) {
      const now = map.getLayoutProperty(id, name);
      if (now !== undefined) map.setLayoutProperty(id, name, enlarged(now, by));
    }
    for (const name of sizes.paint) {
      const now = map.getPaintProperty(id, name);
      if (now !== undefined) map.setPaintProperty(id, name, enlarged(now, by));
    }
  }
  if (map.getLayer(OTHER_PLACES)) map.setLayoutProperty(OTHER_PLACES, 'visibility', 'none');
}
const settled = (map: GlMap) => new Promise<void>(done => map.once('idle', done));
const pictureOf = (map: GlMap) =>
  new Promise<string>((done, failed) => {
    map.getCanvas().toBlob(blob => {
      if (blob) done(URL.createObjectURL(blob));
      else failed(new Error('Map still: no picture'));
    });
  });
export async function groundStill(
  root: ShadowRoot,
  { latitude, longitude, zoom, width, height, pixelRatio }: MapStillView,
  look: GroundLook,
): Promise<GroundStill | null> {
  const maplibre = await loadMapLibre(root);
  if (!maplibre) return null;
  const by = SHEET_LOOKS.has(look) ? CLOSER : 1,
    // The wind's own sheet map stands at the screen's scale, so what is drawn on it is as much
    // smaller as the page is drawn larger.
    sized = look === 'windSheet' ? by / PAGE_DRAWN : by,
    across = width * by,
    down = height * by;
  const container = document.createElement('div');
  container.style.cssText = `position:fixed;left:0;top:0;width:${across}px;height:${down}px;visibility:hidden;pointer-events:none`;
  root.append(container);
  const map = newMap(maplibre, {
    container,
    style: GL_STYLE,
    center: [longitude, latitude],
    zoom: zoom - GL_ZOOM_OFFSET + Math.log2(by),
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
    trackResize: false,
    pixelRatio: pixelRatio / by,
    canvasContextAttributes: { preserveDrawingBuffer: true },
  });
  if (!map) {
    container.remove();
    return null;
  }
  // The first picture, let go if the second never comes.
  let first: string | undefined;
  const show = (layers: readonly GlLayer[], visibility: string) => {
    for (const { id } of layers) map.setLayoutProperty(id, 'visibility', visibility);
  };
  const draw = async () => {
    await new Promise<void>(done => map.once('load', done));
    paintGround(map, look);
    nameMore(map);
    if (by > 1) drawnCloser(map, sized);
    const { pin, foot } = STILL_CLEAR,
      under = map.unproject([across / 2, down - (foot.height * by) / 2]);
    keepClear(map, 'still-pin', [longitude, latitude], pin.width * by, pin.height * by, pin.down * by);
    keepClear(map, 'still-foot', [under.lng, under.lat], Math.round(across), foot.height * by);
    if (map.getZoom() >= STILL_REGION) {
      const edge = STILL_CLEAR.edge * by,
        bands: [string, number, number, number, number][] = [
          ['still-top', across / 2, -edge / 2, Math.round(across), edge],
          ['still-left', -edge / 2, down / 2, edge, Math.round(down)],
          ['still-right', across + edge / 2, down / 2, edge, Math.round(down)],
        ];
      for (const [id, x, y, wide, tall] of bands) {
        const at = map.unproject([x, y]);
        keepClear(map, id, [at.lng, at.lat], wide, tall);
      }
    }
    const { layers } = map.getStyle(),
      seen = (each: GlLayer) => map.getLayoutProperty(each.id, 'visibility') !== 'none',
      names = layers.filter(each => each.type === 'symbol' && seen(each)),
      rest = layers.filter(each => each.type !== 'symbol' && seen(each));
    show(names, 'none');
    await settled(map);
    const ground = await pictureOf(map);
    first = ground;
    show(rest, 'none');
    show(names, 'visible');
    await settled(map);
    return { ground, names: await pictureOf(map) };
  };
  const still = await Promise.race([
    draw().catch(() => null),
    new Promise<null>(done => window.setTimeout(done, STILL_WAIT, null)),
  ]);
  map.remove();
  container.remove();
  if (!still && first) URL.revokeObjectURL(first);
  return still;
}
