import { clamp } from '../lib/values.ts';
// What a map view is drawn from, written out: its layers of tiles, its pins, its key, its tools
// and its timeline.
import { MAP_LAYER_KINDS, type CardConfig, type MapLayerKind } from '../card/config.ts';
import { clockFormat } from '../lib/formats.ts';
import { esc, percent } from '../lib/html.ts';
import { rainSlot, tileGrid, type MapTile, type RadarFrame } from './sources.ts';
import { isForecastTile } from './radar-forecast.ts';
import { weatherIcon } from '../weather/icons.ts';
import { airGlyphFor } from '../cards/air-quality/rules.ts';
import { AQI_US, css, ring, scaleColour, scaleKey, type Stop } from './field.ts';
import { GL_CREDIT, GL_CREDIT_SHORT, type GroundStill } from './gl.ts';
import { finite } from '../lib/values.ts';
import type { TileContext } from '../cards/shared/context.ts';
import { MAP_ZOOMS, windKey, type MapCentre } from './wind.ts';
import { phrase, say } from '../weather/words.ts';
import { glyphs } from '../cards/shared/glyphs.ts';
import { glassMenuMarkup } from '../lib/glass-menu.ts';

export const isLayer = (value: string): value is MapLayerKind => MAP_LAYER_KINDS.some(kind => kind === value);
// The large map's layers, in its menu's order, each with its glyph: an umbrella, a thermometer, the
// air's dots and the wind's lines.
const MAP_LAYERS: readonly (readonly [MapLayerKind, string, string])[] = [
  ['precipitation', phrase('Precipitation'), glyphs.map],
  ['temperature', phrase('Temperature'), glyphs.feels_like],
  ['air_quality', phrase('Air Quality'), glyphs.air_quality],
  ['wind', phrase('Wind'), glyphs.wind],
];
// The large map's timeline plays the wind's or the forecast's hours, or the radar's frames ten
// minutes apart. For precipitation it spans the radar's last two hours (1h) or the forecast's
// next 12 hours (12h).
export const RAIN_SPANS = ['1h', '12h'] as const;
export type RainSpan = (typeof RAIN_SPANS)[number];
// A timeline's frames: their times, each one's part of it, its title, and whether its heading
// gives the time of day (or only the day); for precipitation, the span it covers. The title is said
// as it is drawn.
export interface Timeline {
  times: number[];
  step: number;
  title: string;
  clock: boolean;
  span: RainSpan | undefined;
}
// The position among real timestamps: observed radar and forecast frames have different steps.
export const timelineAt = ({ times }: Timeline, time: number) => rainSlot({ times, slot: 0 }, time);
// Leave one final frame's width to hold it at the end of playback.
export const timelineDuration = ({ times, step }: Timeline) => (times.at(-1) ?? 0) - (times[0] ?? 0) + step;
// The large map loads a ring of tiles past its edges, so a drag shows ground, not a gap.
const MAP_RING = 256;
// The large pins' type: the reading 21 px (23 in the precipitation pin's ring-less disc) and the
// low and high 12 px, shrunk to fit when longer: the reading within 44 px inside the ring (50 px
// in the plain disc), the low and high within 34 px between its ends. Bold digits are about
// 0.66 em wide, a degree sign about 0.7 of one.
const PIN_FIT = { reading: 21, rain: 23, range: 12, ring: 44, disc: 50, between: 34, em: 0.66, degree: 0.7 } as const;
// The small pin's reading stands 21.25 px in its disc, smaller when longer, to keep within 29 px.
const SMALL_PIN = { reading: 21.25, room: 29 } as const;
// The skies the large map's precipitation pin goes grey under.
const OVERCAST: ReadonlySet<string> = new Set(['cloudy', 'fog']);

// The radar's tiles for a view: its tiles come no deeper than zoom 7, stretched past it by `grow`.
// With `ring`, the tiles reach that many of their own pixels further out each way.
export function radarSky(centre: MapCentre, width: number, height: number, ring = 0) {
  const zoom = Math.min(Math.round(centre.zoom), MAP_ZOOMS.radar),
    grow = 2 ** (centre.zoom - zoom);
  return {
    grow,
    tiles: tileGrid(centre.latitude, centre.longitude, zoom, width / grow + 2 * ring, height / grow + 2 * ring),
  };
}
// A radar frame's tile, in its own colours.
export const radarTile = (frame: RadarFrame) => (tile: MapTile) =>
  isForecastTile(frame.url)
    ? frame.url.replace('{z}', String(tile.z)).replace('{x}', String(tile.x)).replace('{y}', String(tile.y))
    : `${frame.url}/512/${tile.z}/${tile.x}/${tile.y}/2/1_1.png`;

// The large map's timeline: a play button, the time shown, and a bar of the frames, each an
// equal part of it from its time, filled to the time shown. Between the parts, a tick and the
// time, from the tick on (the hour with its day period; past it, h:mm); "Now" from the time
// it is, and the times clear of it (see fitWindMarks). For precipitation, a switch between
// the radar's last two hours and the forecast's 12. Playing it, or dragging it, sets the
// streaks moving even with animation off.
export function timelineMarkup(
  timeline: Timeline,
  ctx: Pick<TileContext, 'locale' | 'timeZone' | 'hour12'> | undefined,
  nowWord: string,
): string {
  const { times, title, span } = timeline;
  if (!ctx || times.length < 2) return '';
  const count = times.length,
    format = clockFormat(ctx),
    clock = (time: number) => {
      const parts = format.formatToParts(time),
        onHour = parts.some(part => part.type === 'minute' && part.value === '00');
      return parts
        .filter(part =>
          onHour
            ? part.type !== 'minute' && !(part.type === 'literal' && part.value.trim())
            : part.type !== 'dayPeriod',
        )
        .map(part => (part.type === 'dayPeriod' ? `<span class="period">${esc(part.value)}</span>` : esc(part.value)))
        .join('')
        .trim();
    };
  const inner = times.slice(1),
    position = (time: number) => percent(clamp((time - (times[0] ?? time)) / timelineDuration(timeline))),
    ticks = inner.map(time => `<b style="left:${position(time)}"></b>`).join(''),
    marks =
      `<span data-now style="left:${position(Math.min(Date.now(), times.at(-1) ?? Date.now()))}">${esc(nowWord)}</span>` +
      inner.map(time => `<span style="left:${position(time)}">${clock(time)}</span>`).join(''),
    spans = span
      ? `<div class="map-span" role="group" aria-label="${say('Time span')}"><i class="thumb" aria-hidden="true"></i>${RAIN_SPANS.map(each => `<button type="button" data-span="${each}" aria-pressed="${each === span}">${each}</button>`).join('')}</div>`
      : '';
  return `<div class="wind-time"><button type="button" class="wind-play" aria-label="${say('Play')}"><svg viewBox="0 0 16 16" aria-hidden="true"><path class="play" d="M4 2.5v11l9-5.5z"/><path class="pause" d="M4 2.5h3v11H4zM9 2.5h3v11H9z"/></svg></button><div class="wind-when"><b>${esc(say(title))}</b><span></span></div>${spans}<div class="wind-track" role="slider" tabindex="0" aria-label="${say('Time')}" aria-valuemin="0" aria-valuemax="${count - 1}"><i></i>${ticks}</div><div class="wind-marks">${marks}</div>${span ? `<span class="map-gaps" hidden>${say('Precipitation data is unavailable in some areas')}</span>` : ''}</div>`;
}
// Large, the map's tools: zoom out and in; then, with the online map, its layers, and back
// home. The layers button opens a menu of the four, the one shown checked. Its icon is three
// layers, or full screen two filled ones (`stacked`).
function mapTools(zoom: number, moved: boolean, kind: string, layers: boolean): string {
  return `<div class="map-tools"><span class="map-pill"><button type="button" data-zoom="-1" aria-label="${say('Zoom out')}"${zoom <= MAP_ZOOMS.least ? ' disabled' : ''}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10"/></svg></button><button type="button" data-zoom="1" aria-label="${say('Zoom in')}"${zoom >= MAP_ZOOMS.most ? ' disabled' : ''}><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg></button></span><span class="map-pill">${layers ? `<button type="button" data-layers aria-label="${say('Map layers')}" aria-haspopup="menu" aria-expanded="false"><svg viewBox="0 0 16 16" aria-hidden="true"><path class="fill" d="M8 1.6 14.6 5.2 8 8.8 1.4 5.2z"/><path d="M2 8.4 8 11.7l6-3.3M2 11.3 8 14.6l6-3.3"/><path class="fill stacked" d="M8 2.4 13.76 5.6 8 8.8 2.24 5.6zM2.24 11.08 4.32 10 8 11.76 11.68 10 13.76 11.08 8 14.4z"/></svg></button>` : ''}<button type="button" data-home${moved ? '' : ' data-here'} aria-label="${say('Back to home')}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M14.6 1.4 1.4 7.3l5.9 1.4 1.4 5.9z"/></svg></button></span></div>${
    layers
      ? glassMenuMarkup(
          say('Map layers'),
          kind,
          MAP_LAYERS.map(([value, name, glyph]) => ({ value, title: esc(say(name)), glyph })),
          'map-layers',
        )
      : ''
  }`;
}
// Large, a key to the map's colours: its unit or scale over a bar, with marks evenly up it,
// and under it a link to the map's credits.
function mapKey(kind: string, unit: string, windWord: string, colours: readonly Stop[], credits: string): string {
  const scale = kind === 'wind' ? windKey(unit) : null,
    keyed = kind === 'wind' ? null : scaleKey(colours),
    title =
      kind === 'wind'
        ? `${windWord} (${unit})`
        : kind === 'air_quality'
          ? say('AQI (US)')
          : kind === 'temperature'
            ? say('Temperature')
            : say('Precipitation'),
    marks = scale ? scale.marks.map(mark => ({ label: String(mark), at: mark / scale.top })) : (keyed?.marks ?? []);
  return scale || keyed
    ? `<div class="map-key"><b>${esc(title)}</b><span${keyed ? ` style="--bar:${keyed.bar}"` : ''}>${marks.map(mark => `<i style="bottom:${percent(mark.at)}">${esc(say(mark.label))}</i>`).join('')}</span>${credits ? `<div class="map-data"><button type="button" aria-expanded="false">${say('Map Data')}</button><small>${credits}</small></div>` : ''}</div>`
    : '';
}
// The large pin's reading, and what sets it against its scale.
interface PinReading {
  kind: string;
  // The reading as shown, and as a number for the ring.
  shown: string;
  reading: number;
  low: number;
  high: number;
  stops: readonly Stop[];
  celsius: (value: number) => number;
  condition: string;
  night: boolean;
}
// Longer readings (three digits, or below zero) take smaller type, to stay inside the pin.
const sized = (size: number, room: number, chars: number) =>
  `font-size:${Math.min(size, Math.floor((room / (chars * PIN_FIT.em)) * 2) / 2)}px`;
// Large, the pins: for temperature, a ring through the day's low to high with a knob at
// now, and the low and high under the reading in their colours; for the AQI, a ring through
// the whole scale with a knob at the reading; for precipitation, the temperature over the
// weather in a blue disc, a night-blue one after dark.
function largePin({ kind, shown, reading, low, high, stops, celsius, condition, night }: PinReading): string {
  const gauge = (from: number, to: number, value: number, scaleOf: (each: number) => number) => {
    const { gradient, knob } = ring(stops, scaleOf(from), scaleOf(to), scaleOf(value));
    return `style="--ring:${gradient};--ring-from:${css(scaleColour(stops, scaleOf(from)))};--ring-to:${css(scaleColour(stops, scaleOf(to)))};--knob:${knob.toFixed(1)}deg;--knob-colour:${css(scaleColour(stops, scaleOf(value)))}"><i class="map-ring"></i><i class="map-knob"></i>`;
  };
  const degrees = shown.length + PIN_FIT.degree,
    range = [low, high].map(each => String(Math.round(each)));
  return kind === 'temperature' && finite(low) && finite(high)
    ? `<b class="map-badge map-drop" data-kind="temperature" ${gauge(low, high, reading, celsius)}<span style="${sized(PIN_FIT.reading, PIN_FIT.ring, degrees)}">${esc(shown)}<i class="map-deg">°</i></span><small style="${sized(PIN_FIT.range, PIN_FIT.between, range.join('').length)}">${[low, high].map((each, i) => `<em style="color:${css(scaleColour(stops, celsius(each)))}">${range[i] ?? ''}</em>`).join('')}</small></b>`
    : kind === 'air_quality'
      ? `<b class="map-badge map-drop" data-kind="air_quality" ${gauge(0, AQI_US.at(-1)?.value ?? 0, Number(shown), each => each)}<span style="${sized(PIN_FIT.reading, PIN_FIT.ring, shown.length)}">${esc(shown)}</span><small class="map-aqi">${airGlyphFor(Number(shown))}</small></b>`
      : kind === 'precipitation'
        ? `<b class="map-badge map-drop" data-kind="precipitation"${night ? ' data-night' : OVERCAST.has(condition) ? ' data-overcast' : ''}><span style="${sized(PIN_FIT.rain, PIN_FIT.disc, degrees)}">${esc(shown)}<i class="map-deg">°</i></span><small class="map-sky">${weatherIcon(condition, night)}</small></b>`
        : '';
}
// A map view's layers, pins and tools, everything but what is drawn on its canvases.
export interface MapLook extends PinReading {
  config: CardConfig;
  width: number;
  height: number;
  large: boolean;
  centre: MapCentre;
  // Whether the large map has moved from home, and home's place in the view.
  moved: boolean;
  home: { x: number; y: number };
  // The reading on the pin, the colour under the view, the pin's small print, and what it is named.
  badge: string;
  tint: string;
  pin: string;
  pinName: string;
  // The ground is the live one (see MapViews.startGl), so none of the card's own.
  live: boolean;
  // Or a picture of it, on the way (undefined) or none to be had (null): see MapViews.drawStill.
  pictured: boolean;
  still: GroundStill | null | undefined;
  radar: boolean;
  rainHours: boolean;
  frames: readonly RadarFrame[];
  // The frame that loads at first; the others, once shown (see MapViews.showRadarFrame).
  shownFrame: number;
  // The frame a small map holds, painted into a canvas.
  latestFrame: number;
  // A colour field over the map, and the streaks.
  field: boolean;
  streaks: string;
  // The key's title for the wind, and its colours.
  unit: string;
  windWord: string;
  colours: readonly Stop[];
  // The timeline, drawn.
  timeline: string;
  // Who the readings across the map come from, if any, and whether the radar has failed.
  dataCredit: string;
  failed: boolean;
  overlay: string | undefined;
}
export function mapMarkup(look: MapLook): string {
  const { config, width, height, large, centre, moved, home, kind, badge, tint, pin } = look,
    { live, pictured, still, radar, rainHours, frames, shownFrame, latestFrame } = look,
    { field, streaks, overlay, dataCredit, failed } = look;
  // Large, a ring of tiles past the edges for a drag to show, loaded at once: lazily, being
  // clipped, they would wait until let go. Not for the radar, whose every frame is a layer of
  // tiles and whose tiles come at most 500 a minute; for that, moved from home, it holds
  // still on its latest frame.
  // Tiles come at whole zooms: the nearest one's, scaled to the view's own (see the styles'
  // map-tiles), so these work in its px.
  const tileZoom = Math.round(centre.zoom),
    grow = 2 ** (centre.zoom - tileZoom),
    ring = large ? MAP_RING / grow : 0,
    ground = {
      ring,
      tiles: tileGrid(centre.latitude, centre.longitude, tileZoom, width / grow + 2 * ring, height / grow + 2 * ring),
    },
    { grow: skyGrow, tiles: skyTiles } = radarSky(centre, width, height),
    sky = { ring: 0, tiles: skyTiles },
    scaled = (scale: number) =>
      `<div class="map-tiles"${scale === 1 ? '' : ` style="width:${(width / scale).toFixed(1)}px;height:${(height / scale).toFixed(1)}px;scale:${scale}"`}>`;
  // {s}, where a template has it, picks one of a service's hosts: they all start at a.
  const fill = (url: string, tile: MapTile) =>
    url
      .replace('{s}', 'a')
      .replace('{z}', String(tile.z))
      .replace('{x}', String(tile.x))
      .replace('{y}', String(tile.y));
  // A layer of tiles; `later`, its addresses kept until it is shown (see showRadarFrame).
  const layer = ({ ring, tiles }: typeof ground, url: (tile: MapTile) => string, cls = '', later = false) =>
      `<div class="radar-layer ${cls}">${tiles.map(tile => `<img alt=""${cls === 'base osm' ? ' referrerpolicy="strict-origin-when-cross-origin"' : ''}${large ? '' : ' loading="lazy"'} style="left:${tile.left - ring}px;top:${tile.top - ring}px" ${later ? 'data-src' : 'src'}="${esc(url(tile))}">`).join('')}</div>`,
    stillImage = (url: string | undefined) => (url ? `<img class="map-still" alt="" src="${esc(url)}">` : '');
  // Home's place on the map, once the large map has moved from it; the pin, the wash of
  // colour and the streaks near home all follow it.
  const place = moved ? ` style="--x:${home.x.toFixed(1)}px;--y:${home.y.toFixed(1)}px"` : '';
  // OpenStreetMap's standard tiles, darkened in CSS, unless a template is configured.
  const base = config.map_tile_url ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const named = look.pinName ? `<span class="map-home">${esc(look.pinName)}</span>` : '',
    spot = badge === '' ? '' : `<i class="map-spot"></i>${named}`,
    bigPin = !large || look.shown === '' ? '' : largePin(look);
  const credits = [
      live ? GL_CREDIT : still ? GL_CREDIT_SHORT : config.map_tile_url ? '' : '© OpenStreetMap contributors',
      radar ? 'RainViewer' : '',
      dataCredit,
    ]
      .filter(Boolean)
      .join(' · '),
    legend = large ? mapKey(kind, look.unit, look.windWord, look.colours, credits) : '',
    credit = legend ? '' : `<small class="radar-credit">${credits}</small>`;
  return (
    `<div class="map-pan"${place}>` +
    stillImage(still?.ground) +
    scaled(grow) +
    (live || (pictured && still !== null)
      ? ''
      : layer(ground, tile => fill(base, tile), config.map_tile_url ? 'base' : 'base osm')) +
    '</div>' +
    (live || rainHours || !frames.length
      ? ''
      : scaled(skyGrow) +
        frames
          .map((frame, i) =>
            large
              ? layer(sky, radarTile(frame), `frame" data-frame="${i}`, i !== shownFrame)
              : i === latestFrame
                ? `<canvas class="radar-layer frame" data-frame="${i}"></canvas>`
                : '',
          )
          .join('') +
        '</div>') +
    (overlay ? `${scaled(grow)}${layer(ground, tile => fill(overlay, tile), 'overlay')}</div>` : '') +
    (field && !live
      ? `<canvas class="map-field" data-kind="${kind}"></canvas>`
      : tint
        ? `<div class="map-tint" style="--tint:${tint}"></div>`
        : '') +
    (!live && radar ? '<canvas class="map-coverage" aria-hidden="true"></canvas>' : '') +
    stillImage(still?.names) +
    streaks +
    '</div>' +
    `<div class="map-pins"${place} data-x="${home.x}" data-y="${home.y}">` +
    (bigPin
      ? `${bigPin.replace('<b ', `<b role="button" tabindex="0" aria-label="${say('Details')}" `)}${spot}<div class="map-card" hidden></div>`
      : badge !== ''
        ? `<b class="map-badge" data-kind="${kind}" style="--tint:${tint || '#1c2340'}${large ? '' : `;${sized(SMALL_PIN.reading, SMALL_PIN.room, badge.length)}`}">${pin}</b>${spot}`
        : '<i class="radar-dot"></i>') +
    '</div>' +
    legend +
    (large ? mapTools(centre.zoom, moved, kind, config.map === 'rainviewer') : '') +
    look.timeline +
    // Small, the radar's time while it plays stands in the corner just above the credit, however
    // many lines that takes.
    (!large && radar
      ? `<div class="map-foot"><span class="map-when" aria-hidden="true"></span>${credit}</div>`
      : credit) +
    (radar && failed ? `<span class="radar-note">${say('Radar unavailable')}</span>` : '')
  );
}
