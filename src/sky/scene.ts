import {
  BOLT_POINTS,
  cloudFlash,
  lightningBolt,
  moonPhase,
  scenePreset,
  skyMoonPhase,
  skyMoonTint,
  type BoltLine,
  type Point,
  type SceneInputs,
  type ScenePreset,
} from './sky.ts';
import { clamp } from './clouds.ts';
import { cloudCamera } from './cloud-camera.ts';
import {
  DECK_COUNT,
  FRAME,
  cloudPicks,
  cloudPosition,
  frameUnit,
  frameY,
  deckClouds,
  type CloudAtlas,
  type DeckCloud,
  type Direction,
  type Tint,
} from './cloud-decks.ts';
import { spriteSize } from './clouds.ts';
import { type CloudDraw, cloudPainter, type CloudPainter } from './clouds-gl.ts';
import { solarHour as estimateHour, skyGradientFor, sunPathAt, type SunPosition } from './presets.ts';
import { RainPath } from './rain-path.ts';
import { effectImage } from './effect-art.ts';
import { sharedGlass, type GlassRain } from './glass-gl.ts';
import { FAR_BANDS, FAR_PIECES, type RainSky } from './rain-gpu.ts';
import type { RainFall, SkyKind } from './presets-data.ts';
import { finite } from '../lib/values.ts';
import { alphaHex, colorAlpha, context2d, hash, mix, rgb } from '../lib/canvas.ts';

// These dense rain fields benefit from bounded raster surfaces. The other fields
// retain their single paths; tiling the sideways storm streaks adds upload work.
const TILED_RAIN: ReadonlySet<SkyKind> = new Set(['rain', 'heavyRain', 'freezingRain']);

// Value noise that wraps every `period` cells horizontally, so drifting cloud
// layers can tile without a seam.
function noise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy,
    sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy);
  const a = ((ix % period) + period) % period,
    b = (a + 1) % period,
    h = (i: number, j: number) => hash(i + seed, j + seed * 7);
  return (h(a, iy) * (1 - sx) + h(b, iy) * sx) * (1 - sy) + (h(a, iy + 1) * (1 - sx) + h(b, iy + 1) * sx) * sy;
}
function fbm(x: number, y: number, period: number, seed: number, octaves = 6): number {
  let value = 0,
    weight = 0.54;
  for (let octave = 0; octave < octaves; octave++) {
    value += noise(x, y, period, seed) * weight;
    x *= 2;
    y = y * 2 + 11;
    period *= 2;
    weight *= 0.48;
  }
  return value;
}
// A sky's gradient colours, top to bottom.
const stops = (colors: readonly string[]): RGBStops => {
  const [top, middle, bottom] = colors;
  if (top === undefined || middle === undefined || bottom === undefined)
    throw new Error('A sky gradient needs three colours.');
  return [top, middle, bottom];
};
type RGBStops = readonly [top: string, middle: string, bottom: string];
interface SceneGradient {
  colors: RGBStops;
  middleStop: number;
}
function sceneGradient(preset: ScenePreset, tile: boolean): SceneGradient {
  if (!tile) return { colors: stops(preset.sky), middleStop: preset.skyStop };
  const [top, middle, bottom, middleStop] = skyGradientFor(preset.kind, preset.elevation, preset.rising, true);
  return { colors: [top, middle, bottom], middleStop };
}
// Flare ghosts: position along sun→centre, radius (share of the short side),
// shape, tint and opacity.
// The condition-change window lasts 0.8 seconds. Falling particle counts ease separately.
const FADE = 800,
  RAMP = 500;
type GhostKind = 'disc' | 'iris' | 'etched' | 'chromatic';
// Ghosts are round, soft and nearly colourless.
const FLARE_GHOSTS: readonly (readonly [t: number, size: number, kind: GhostKind, color: string, alpha: number])[] = [
  [0.55, 0.045, 'disc', '#e4f2ff', 0.1],
  [0.78, 0.024, 'disc', '#fff0dc', 0.13],
  [1.04, 0.07, 'disc', '#dcecff', 0.07],
  [1.2, 0.016, 'etched', '#ffffff', 0.16],
  [1.42, 0.04, 'disc', '#efe6ff', 0.09],
  [1.72, 0.1, 'etched', '#e6f6ff', 0.06],
  [1.98, 0.032, 'disc', '#fff0e0', 0.1],
];
// The chromatic glow's blobs: centre, radius and gradient, in shares of its sprite.
const CHROMATIC = [
  [0.3, 0.5, 0.3, ['#9fd0ff', '#5a7dff00']],
  [0.45, 0.5, 0.26, ['#ffffff', '#c9a4ff00']],
  [0.62, 0.5, 0.32, ['#f08bff', '#a24dff00']],
  [0.82, 0.5, 0.22, ['#c86bff', '#7a4dff00']],
] as const;

// These quads use half-size coordinates. Each original texture pixel spans
// 0.02 scene units at scale one, making a 1560-pixel blanket 31.2 units wide.
const CLOUD_PIXEL = 0.02;
// Tint and illumination for one deck of cloud sprites.
interface Tints {
  opacity: number;
  direction: Direction;
  sun: Tint;
  fill: Tint;
  ambient: Tint;
}
type Decks = readonly (readonly DeckCloud[] | null)[];
interface Blanket {
  sprite: number;
  tints: Tints;
  z: number;
  size: number;
  rise: number;
  drift: number;
}
// The look fading out after a condition change; `start` is set by the first frame that sees it.
interface Outgoing {
  sky: readonly string[];
  skyStop: number;
  decks: Decks;
  tints: readonly Tints[];
  blanket: Blanket | null;
  blanketAlpha: number;
  start: number | null | undefined;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
// A glass panel over the scene, with its corner radius.
export interface Panel extends Rect {
  radius?: number;
}
interface Glow {
  x: number;
  y: number;
}
interface MoonPoint extends Glow {
  r: number;
  lit: number;
  tone: string;
}
interface SunPoint extends Glow {
  r: number;
  clear: number;
}
interface Twinkler {
  x: number;
  y: number;
  size: number;
  alpha: number;
  color: string;
  seed: number;
  bright: boolean;
  // A bright star's twinkle: how fast its wave turns, in radians a second, and how much light it
  // adds at the wave's middle (twice that at its top).
  pace: number;
  lift: number;
  // How fast its flash wave turns, in radians a second, and where that wave starts.
  quick: number;
  flash: number;
}
type Level =
  | 'rain'
  | 'snow'
  | 'dust'
  | 'sleet'
  | 'hail'
  | 'wind'
  | 'stars'
  | 'fog'
  | 'fringe'
  | 'sun'
  | 'moon'
  | 'flare';
// How far each appearing or vanishing part of the scene has eased in, 0 to its target.
export type Levels = Record<Level, number>;
export const LEVELS: readonly Level[] = [
  'rain',
  'snow',
  'dust',
  'sleet',
  'hail',
  'wind',
  'stars',
  'fog',
  'fringe',
  'sun',
  'moon',
  'flare',
];
interface Strike {
  bolt: BoltLine[];
  // How far through the bolt's life (0–1, past 1 once it has gone).
  age: number;
  screen: number;
}
// A drop keeps its launch, direction, size and light for its whole fall. Only its
// age changes each frame; rebuild it when that slot spawns the next drop.
interface RainDrop {
  lag: number;
  cycle: number;
  dx: number;
  dy: number;
  turn: number;
  x: number;
  y: number;
  projection: number;
  speed: number;
  reach: number;
  size: number;
  tintShare: number;
  frame: number;
}
interface RainField {
  fall: RainFall;
  width: number;
  height: number;
  angle: number;
  drops: RainDrop[];
}
// The moon's photograph, supplied by the card: `load` fetches it, `sprite` draws a
// phase of it `size` pixels across (null until it has loaded).
export interface MoonHooks {
  load: () => Promise<boolean>;
  sprite: (size: number, phase: number, warm: number, tint?: string) => HTMLCanvasElement | null;
}
export interface PaintOptions {
  open?: Rect;
  covered?: readonly Panel[];
  // Every glass panel, for rain to splash on their tops (`covered` without).
  edges?: readonly Panel[];
  // The current conditions' text, which the moon never sits behind.
  text?: Rect;
  // How far the page has scrolled over the sky, in its pixels: the clouds rise by shares of it.
  scroll?: number;
}

// Blurs `canvas` in place as a Gaussian of deviation `sigma` pixels would, by three box
// blurs across and three down, the approximation the filter-effects spec gives, with
// transparency beyond the edges. Canvas filters (`ctx.filter`) blur the same way, but
// Safari ignores them and drew every blurred shape sharp. The pixels are blurred
// premultiplied, so a transparent neighbour adds no colour to an edge.
function blur(canvas: HTMLCanvasElement, sigma: number): void {
  const { width, height } = canvas,
    d = Math.floor((sigma * 3 * Math.sqrt(2 * Math.PI)) / 4 + 0.5);
  if (d < 2 || !width || !height) return;
  // Each box as its reach behind and ahead of the pixel: an odd `d` gives three centred
  // boxes of d; an even one two of d, half a pixel off centre either way, and one of d + 1.
  const half = Math.floor(d / 2),
    boxes: readonly (readonly [behind: number, ahead: number])[] =
      d % 2
        ? [
            [half, half],
            [half, half],
            [half, half],
          ]
        : [
            [half, half - 1],
            [half - 1, half],
            [half, half],
          ];
  const ctx = context2d(canvas),
    image = ctx.getImageData(0, 0, width, height),
    data = image.data,
    size = width * height;
  let from = new Float32Array(size * 4),
    to = new Float32Array(size * 4);
  for (let i = 0; i < size * 4; i += 4) {
    const alpha = (data[i + 3] ?? 0) / 255;
    from[i] = (data[i] ?? 0) * alpha;
    from[i + 1] = (data[i + 1] ?? 0) * alpha;
    from[i + 2] = (data[i + 2] ?? 0) * alpha;
    from[i + 3] = data[i + 3] ?? 0;
  }
  // `lines` runs of `length` pixels, each starting `next` pixels after the last, its
  // pixels `step` apart: a running sum slides along each run.
  const pass = (lines: number, length: number, next: number, step: number, behind: number, ahead: number) => {
    const span = behind + ahead + 1,
      stride = step * 4;
    for (let line = 0; line < lines; line++)
      for (let channel = 0; channel < 4; channel++) {
        const start = line * next * 4 + channel;
        let sum = 0;
        for (let k = 0; k <= Math.min(ahead, length - 1); k++) sum += from[start + k * stride] ?? 0;
        for (let k = 0; k < length; k++) {
          to[start + k * stride] = sum / span;
          if (k + ahead + 1 < length) sum += from[start + (k + ahead + 1) * stride] ?? 0;
          if (k - behind >= 0) sum -= from[start + (k - behind) * stride] ?? 0;
        }
      }
    [from, to] = [to, from];
  };
  for (const [behind, ahead] of boxes) pass(height, width, width, 1, behind, ahead);
  for (const [behind, ahead] of boxes) pass(width, height, 1, width, behind, ahead);
  for (let i = 0; i < size * 4; i += 4) {
    const alpha = from[i + 3] ?? 0,
      unit = alpha > 0 ? 255 / alpha : 0;
    data[i] = (from[i] ?? 0) * unit;
    data[i + 1] = (from[i + 1] ?? 0) * unit;
    data[i + 2] = (from[i + 2] ?? 0) * unit;
    data[i + 3] = alpha;
  }
  ctx.putImageData(image, 0, 0);
}
// Whether the browser applies canvas filters: Safari takes `ctx.filter` and draws as if it
// were 'none'. Tested once, on a dot blurred onto its neighbours.
let filtering: boolean | undefined;
function canvasFilters(): boolean {
  if (filtering === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 9;
    const c = canvas.getContext('2d');
    if (c) {
      c.filter = 'blur(2px)';
      c.fillStyle = '#fff';
      c.fillRect(4, 4, 1, 1);
    }
    filtering = Boolean(c && (c.getImageData(2, 4, 1, 1).data[3] ?? 0) > 0);
  }
  return filtering;
}
// Draws `shapes` onto an empty `canvas`, in its context's transform and state, blurred
// `sigma` pixels of the canvas. Where canvas filters work, each shape is blurred as it
// lands; elsewhere the shapes are drawn sharp and the canvas blurred once (see blur), which
// differs only by a shade where blurred shapes overlap.
function drawBlurred(
  canvas: HTMLCanvasElement,
  sigma: number,
  shapes: readonly ((ctx: CanvasRenderingContext2D) => void)[],
): void {
  const ctx = context2d(canvas),
    native = canvasFilters();
  ctx.save();
  if (native) ctx.filter = `blur(${sigma}px)`;
  for (const shape of shapes) shape(ctx);
  ctx.restore();
  if (!native) blur(canvas, sigma);
}
// What the low power setting gives up, for a screen that runs all day on little: 20 frames a
// second at most, a third of the fall, and a sky of a million pixels however large the screen.
const LOW_POWER = { frame: 50, fall: 0.35, pixels: 1_000_000 } as const;
// A bright star is a soft dot in a tint of its own, this many times its size across its radius,
// and its twinkle the same dot in white.
const STAR_REACH = 1.55;
// That dot's opacity from its centre out, as [share of its radius, opacity]: nearly full at its
// centre, half at 45% of the radius, gone by 90%.
const STAR_DOT: readonly (readonly [number, number])[] = [
  [0, 0.98],
  [0.125, 0.95],
  [0.25, 0.84],
  [0.375, 0.65],
  [0.45, 0.5],
  [0.5, 0.4],
  [0.625, 0.19],
  [0.75, 0.06],
  [0.875, 0.01],
  [1, 0],
];
// Bright stars' tints, picked at random along white, blue, warm and pink, as [share, [r, g, b]],
// in sixteen steps.
const STAR_TINTS: readonly (readonly [number, readonly [number, number, number]])[] = [
  [0, [1, 1, 1]],
  [0.386, [0.43, 0.71, 1]],
  [0.67, [0.77, 0.69, 0.4]],
  [1, [1, 0.52, 0.53]],
];
const TINT_STEPS = 16;
// The glow a star flashes into: this many times a bright star's size across its radius. Its
// opacity from the centre out, as [share of its radius, opacity], falls away smoothly and has no
// faint flat tail, so a flash lights the sky close around the star without showing a disc of
// light with an edge. It is drawn GLOW_FLASH times the star's `lift` at a full flash.
const GLOW_REACH = 12;
const GLOW_FLASH = 0.9;
// A star flashes while a quick wave of its own, at 0.7-1.6 turns a second, plus FLASH_SWELL of
// its slow wave (0 to 2) passes FLASH_FROM, and is fully lit FLASH_EDGE past that: about once a
// second for a third of one, but only for the few seconds its slow wave stands highest.
const FLASH_TURNS: readonly [number, number] = [0.7, 1.6];
const FLASH_SWELL = 0.89;
const FLASH_FROM = 1.98;
const FLASH_EDGE = 0.5;
const STAR_GLOW: readonly (readonly [number, number])[] = [
  [0, 0.4],
  [0.1, 0.371],
  [0.2, 0.297],
  [0.3, 0.205],
  [0.4, 0.122],
  [0.5, 0.062],
  [0.6, 0.027],
  [0.7, 0.011],
  [0.8, 0.003],
  [0.9, 0.001],
  [1, 0],
];
// The tint `share` of the way along STAR_TINTS, to the nearest step, as #rrggbb.
function starTint(share: number): string {
  const at = Math.round(share * TINT_STEPS) / TINT_STEPS,
    upper = Math.max(
      1,
      STAR_TINTS.findIndex(([stop]) => stop >= at),
    ),
    high = STAR_TINTS[upper],
    low = STAR_TINTS[upper - 1];
  if (!high || !low) return '#ffffff';
  const t = (at - low[0]) / (high[0] - low[0]);
  return `#${low[1]
    .map((v, i) =>
      Math.round(clamp(v + ((high[1][i] ?? v) - v) * t) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}
// Haze, fog and smoke are a few vast, faint clouds lit flat. Stretched that far, their soft edges
// fall in steps of a single shade, which a dark sky shows as rings. A fixed grain of a shade or two
// either way, laid over in overlay, breaks the steps up and is too fine to see as grain.
const GRAINED: ReadonlySet<SkyKind> = new Set(['haze', 'foggy', 'smoky']);
const GRAIN = { size: 128, depth: 4 } as const;
// Four repeats per strip keep image drawing cheap without caching a second full sky.
const GRAIN_STRIP = GRAIN.size * 4;
// As the page scrolls over the still sky, each deck rises by this share of the scroll, the back
// least and the front most, so the sky has depth; the lid rises with the back deck.
const PARALLAX = [0.03, 0.05, 0.08, 0.12] as const;
// Gradients that run straight down (the sky and fog) are drawn once into a strip
// this many device pixels wide and copied across the canvas (see WeatherScene.bands).
// The browser dithers a gradient in a pattern that repeats every 8 pixels, so the copies
// line up with it.
const STRIP = 64;
// The sky's faint mottling is drawn at this many pixels to the CSS pixel (see paintNoise).
const NOISE = 0.5;
// The sun's rays are drawn at this share of the canvas's resolution: they are blurred
// across many pixels, so a finer layer would only cost more (see paintRays).
const RAYS = 0.25;
// The box around a slice of a circle, from angle `from` to `to`: the centre, the arc's
// ends, and wherever the arc passes straight right, down, left or up.
function sectorBox(x: number, y: number, radius: number, from: number, to: number): Rect {
  const quarter = Math.PI / 2,
    xs = [x, x + Math.cos(from) * radius, x + Math.cos(to) * radius],
    ys = [y, y + Math.sin(from) * radius, y + Math.sin(to) * radius];
  for (let k = Math.ceil(from / quarter); k * quarter <= to; k++) {
    xs.push(x + Math.cos(k * quarter) * radius);
    ys.push(y + Math.sin(k * quarter) * radius);
  }
  const left = Math.min(...xs),
    top = Math.min(...ys);
  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

// The sun's place and size, which the moon keeps clear of.
interface SunSpot extends Glow {
  r: number;
}
// How far the sun's glow reaches, in its radii: a moon inside it is too thin to see by day.
const SUN_GLOW = 4;
// The moon's unlit side is the sky showing through until the stars come out: it darkens into a
// disc from the end of civil twilight, the sun 6° down, to full night at 18° down.
const MOON_DISC = { from: -6, to: -18 } as const;
// The sun's spike ball shows only while the sun is more than 9° up, coming in over the next degree.
const SPIKES = { from: 9, to: 10 } as const;
// A body's share of the way across the card from its place on the sky arc (`along`: the
// arc's x, 0 where it rises, 1 where it sets, past either end just after rising and before
// setting), at `spread`: the sun's arc spans the middle half of the card, rising a quarter
// of the way in.
export const SUN_ARC = 0.5;
export const arcX = (along: number, spread = SUN_ARC): number => 0.5 + (along - 0.5) * spread;
// The sun may sit this share of the card's width above its top edge, cut off, its glow
// still spilling in.
const SUN_ABOVE = 0.05;
// The sun keeps this many of its radii between its centre and the conditions' text: its
// core, then as much open sky, so the brightest of its bloom stays off the words.
export const SUN_CLEAR = 2;
// Altitude supplies the height, with a shallow arc under the middle of the track.
export const moonHeight = (degrees: number, across = 0.5): number => {
  const arc = 30 * Math.sin(Math.PI * across) ** 4,
    elevation = clamp(Math.max(degrees, arc) / 45);
  return 0.5 - (0.4 + 0.45 * elevation) * 0.5;
};
// The moon keeps its own rise-to-set path. The centre gap leaves the heading readable.
export const moonAcross = (progress: number): number => {
  const share = clamp(progress);
  return 0.1 + 0.5 * share + (share > 0.5 ? 0.3 : 0);
};
// Where the moon sits on a card `width` × `height`: `across` is its share of the card's
// width (on its arc, see arcX; without a location, a fixed spot), and its altitude in
// `degrees` sets its height (see moonHeight), never below the middle of the card or the
// open sky `sky`. Both are shares of the card itself, so a card of any shape shows it.
// A disc `r` across that would sit behind the conditions' `text` moves beside them, on its
// own side if there is room in the open sky there, else the other; with room on neither it
// rises clear of them, cut off by the top if need be. One in the `sun`'s glow rises off
// the card. It never moves down.
export function moonPlace(
  width: number,
  height: number,
  sky: Rect,
  text: Rect | undefined,
  degrees: number,
  across: number | null,
  r: number,
  sun?: SunSpot,
): Glow {
  let x = width * (across ?? 0.75),
    y = Math.min(height * moonHeight(degrees, across ?? 0.75), Math.max(sky.y + sky.height, height * 0.5) - r);
  if (text && x + r > text.x && x - r < text.x + text.width && y + r > text.y && y - r < text.y + text.height) {
    const left = text.x - r * 1.4,
      right = text.x + text.width + r * 1.4,
      sides = x < text.x + text.width / 2 ? [left, right] : [right, left],
      side = sides.find(at => at - r >= sky.x && at + r <= sky.x + sky.width);
    if (side === undefined) y = text.y - r * 1.2;
    else x = side;
  }
  if (sun && Math.hypot(x - sun.x, y - sun.y) < sun.r * SUN_GLOW + r) y = Math.min(y, -r * 2);
  return { x, y };
}

// A falling particle's x, wrapped on a loop 8px wider than the canvas each side, so it
// leaves fully before it comes back.
const wrapX = (x: number, width: number): number => {
  const loop = width + 16;
  return (((x % loop) + loop) % loop) - 8;
};

// Distant particles share a path; their two lighting endpoints supply its mean color and opacity.
function particleTint([start, end]: readonly [string, string]): string {
  return mix(start, end, 0.5) + alphaHex((colorAlpha(start) + colorAlpha(end)) / 2);
}

// Frame rectangles in the falling-particle sheet: origin, tile size, columns and rows.
const FALLING_SPRITES = {
  sleet: [0, 0, 92, 320, 4, 1],
  nearSnow: [0, 320, 60, 60, 4, 2],
  farSnow: [0, 440, 60, 60, 4, 2],
  hail: [240, 320, 52, 52, 3, 3],
} as const;
type FallingSprite = keyof typeof FALLING_SPRITES;
const FALL_TILE = 64;
// Each sampled color gets a set of foreground streak shapes in the sprite strip.
const RAIN_FRAMES = 4;
const RAIN_TINTS = 16;

interface TintedSheet {
  color: string;
  canvas: HTMLCanvasElement;
}
function tintSheet(image: HTMLImageElement, color: string, previous?: TintedSheet): TintedSheet {
  if (previous?.color === color) return previous;
  const canvas = previous?.canvas ?? document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const pen = context2d(canvas);
  pen.drawImage(image, 0, 0);
  pen.globalCompositeOperation = 'source-in';
  pen.fillStyle = color;
  pen.fillRect(0, 0, canvas.width, canvas.height);
  return { color, canvas };
}

export class WeatherScene {
  // The cloud atlas and the moon's photograph, shared by every card's scene.
  static atlas: CloudAtlas | undefined;
  static moon: MoonHooks | undefined;
  // Whether clouds go to the GPU where it can take them (see clouds-gl.ts); tests of the 2D
  // drawing turn it off.
  static gpuClouds = true;
  // Sprites every card's sky draws alike, made once for the page: star halos, lens-flare
  // ghosts, and the mottling and fringe puffs.
  static starSprites = new Map<string, HTMLCanvasElement>();
  static ghosts = new Map<string, HTMLCanvasElement>();
  static sprites: Partial<Record<'grain', HTMLCanvasElement>> = {};
  private static airMasks: Partial<
    Record<'noise' | 'fringe', { image: HTMLImageElement | undefined; canvas: HTMLCanvasElement }>
  > = {};
  readonly canvas: HTMLCanvasElement | null;
  wide = false;
  lowPower = false;
  preset: ScenePreset | undefined;
  background: SceneGradient | undefined;
  private tile = false;
  private textScale = 1;
  private location: string | undefined;
  // The preset with its appearing and vanishing values eased (see advance).
  live: ScenePreset | undefined;
  key: string | undefined;
  lightKey: string | undefined;
  decks: Decks | undefined;
  tints: readonly Tints[] = [];
  blanket: Blanket | null = null;
  outgoing: Outgoing | null = null;
  private artworkKey = '';
  private artworkSeed = 1;
  cloudLight = '#ffffff';
  levels: Levels | undefined;
  lastPhase: number | undefined;
  ramping = false;
  stars: HTMLCanvasElement | null = null;
  starsKey: string | undefined;
  haze: HTMLCanvasElement | undefined;
  twinklers: Twinkler[] = [];
  moonPoint: MoonPoint | undefined;
  sunPoint: SunPoint | undefined;
  sunPath: SunPosition | undefined;
  clouds: HTMLCanvasElement | undefined;
  flickerLayer: HTMLCanvasElement | undefined;
  private streak: { canvas: HTMLCanvasElement; key: string; cellWidth: number; frames: number } | undefined;
  private windSheet: TintedSheet | undefined;
  private nearSheet: TintedSheet | undefined;
  private fallingSheets: Partial<Record<FallingSprite, TintedSheet>> = {};
  // Drops keep the last rainy scene's motion, tint and emission rates while they thin out.
  private rainPreset: ScenePreset | undefined;
  rainFields: Partial<Record<'front' | 'back', RainField>> = {};
  farRain: HTMLCanvasElement | undefined;
  rainTile: HTMLCanvasElement | undefined;
  private rainRenderer: GlassRain | null = null;
  private gpuSky: RainSky | null = null;
  get hasGPUSky(): boolean {
    return this.canvas !== null && Boolean(this.rainRenderer?.hasSky(this.canvas));
  }
  noise: HTMLCanvasElement | undefined;
  grainStrip: HTMLCanvasElement | undefined;
  ring: { size: number; canvas: HTMLCanvasElement } | undefined;
  private airTints: Partial<
    Record<'noise' | 'fringe', { mask: HTMLCanvasElement; key: string; tiles: Map<string, HTMLCanvasElement> }>
  > = {};
  // The latest strike (its number and when it fell) and its bolt, by strike and reach.
  strikeClock: { index: number; at: number; last: number } | undefined;
  private stormStart: number | undefined;
  bolt: { key: string; lines: BoltLine[] } | undefined;
  // Layers that hold still between frames, drawn once and copied (see bands, paintGlow and
  // enlarge). The glow and the star layers are the canvas's size, so they are let go unused.
  strips = new Map<string, { key: string; canvas: HTMLCanvasElement }>();
  glow: { key: string; canvas: HTMLCanvasElement } | undefined;
  spikes: { key: string; image: HTMLCanvasElement; reach: number } | undefined;
  beams:
    | { key: string; sprites: { image: HTMLCanvasElement; x: number; y: number }[]; layer: HTMLCanvasElement }
    | undefined;
  enlarged = new Map<'haze' | 'field', { source: HTMLCanvasElement; key: string; canvas: HTMLCanvasElement }>();
  // Without a canvas the scene still prepares and eases; it cannot paint.
  constructor(canvas: HTMLCanvasElement | null) {
    this.canvas = canvas;
  }
  // Lets go of the layers kept between frames at the canvas's own resolution, for a sky
  // that won't be drawn for a while (off screen, or off the page). Each is drawn again when
  // it is next needed; the star field, slower to build and at CSS pixels, stays.
  release(): void {
    if (this.canvas) this.rainRenderer?.releaseSky(this.canvas);
    this.gpuSky = null;
    this.glow = undefined;
    this.enlarged.clear();
    this.clouds = undefined;
    this.flickerLayer = undefined;
    this.beams = undefined;
    this.rainFields = {};
    this.farRain = undefined;
    this.rainTile = undefined;
    this.grainStrip = undefined;
  }
  // Lighting changes only retint; the cloud textures are baked ahead of time.
  // With `animate`, the outgoing sky, clouds and blanket are kept so paint()
  // can fade them out after a condition change.
  prepare(
    inputs: SceneInputs,
    {
      animate = false,
      wide = false,
      location,
      textScale = 1,
    }: { animate?: boolean; wide?: boolean; location?: string; textScale?: number } = {},
  ): void {
    this.wide = wide;
    const preset = scenePreset({
        ...inputs,
        windowClass: inputs.windowClass ?? (wide ? 'landscapeRegular' : 'compact'),
      }),
      previous = this.preset,
      tile = inputs.tile ?? false,
      samePresentation = this.tile === tile && previous?.windowClass === preset.windowClass,
      changed = previous?.kind !== preset.kind || previous.condition !== preset.condition || this.location !== location,
      background = this.background;
    this.tile = tile;
    this.textScale = textScale;
    this.location = location;
    this.background = sceneGradient(preset, tile);
    const lightKey = JSON.stringify([
      wide,
      tile,
      location,
      preset.windowClass,
      preset.condition,
      preset.kind,
      preset.night,
      preset.clouds,
      preset.light,
      preset.sky,
    ]);
    this.key = JSON.stringify([
      lightKey,
      textScale,
      preset.condition,
      preset.moon,
      preset.moonAltitude,
      preset.moonTilt,
      inputs.moonPhase,
      preset.solarHour,
      preset.moonHour,
      preset.wind,
      preset.windAngle,
      preset.effectKind,
      preset.temperature,
      preset.cloudSpeed,
    ]);
    if (!preset.lightning || previous?.kind !== preset.kind || !samePresentation) {
      this.stormStart = undefined;
      this.strikeClock = undefined;
      this.bolt = undefined;
    }
    this.preset = preset;
    if (!preset.rain && (!animate || !samePresentation) && this.levels) this.levels.rain = 0;
    if (preset.rain) this.rainPreset = preset;
    else if ((this.levels?.rain ?? 0) === 0) this.rainPreset = undefined;
    if (!this.rainPreset) {
      this.rainFields = {};
      this.farRain = undefined;
    }
    if (!this.rainPreset || !TILED_RAIN.has(this.rainPreset.kind)) this.rainTile = undefined;
    if (!GRAINED.has(preset.kind)) this.grainStrip = undefined;
    // The moon's photograph loads before the moon is due, so it never pops in.
    if (preset.moon) void WeatherScene.moon?.load();
    if (!animate || !samePresentation) this.outgoing = null;
    if (this.lightKey === lightKey) return;
    this.lightKey = lightKey;
    // Another change during the same 0.8-second transition uses the remaining time.
    if (animate && changed && samePresentation && background && this.decks && this.outgoing === null)
      this.outgoing = {
        sky: background.colors,
        skyStop: background.middleStop,
        decks: this.decks,
        tints: this.tints,
        blanket: this.blanket,
        blanketAlpha: previous.blanket,
        start: null,
      };
    const L = preset.light;
    this.cloudLight = L.ambient;
    const artworkKey = JSON.stringify([
      location,
      ...preset.look.decks.map(deck => (deck ? [deck[6], deck[10]] : null)),
      preset.look.blanket ? [preset.look.blanket[3], preset.look.blanket[7]] : null,
    ]);
    if (artworkKey !== this.artworkKey) {
      this.artworkKey = artworkKey;
      this.artworkSeed = Math.floor(Math.random() * 0x7fffffff);
    }
    this.decks = deckClouds(preset.look.decks, this.artworkSeed);
    const tint = (index: number, lighting: boolean): Tints => {
      const color = rgb(L.clouds[index] ?? '#ffffff'),
        alpha = L.cloudAlpha[index] ?? 1,
        gain = 0.6 * (L.brightness[index] ?? 1) * alpha;
      const light = (tone: string, intensity: number): Tint => {
        const [r, g, b] = rgb(tone);
        return [(r * color[0]) / 255, (g * color[1]) / 255, (b * color[2]) / 255, gain * intensity];
      };
      return {
        direction: L.direction,
        sun: light(L.sun, lighting ? L.sunIntensity / 1000 : 0),
        fill: light(L.fill, lighting ? L.fillIntensity / 1000 : 0),
        ambient: light(lighting ? L.ambient : '#ffffff', lighting ? L.ambientIntensity : 1),
        opacity: alpha * alpha,
      };
    };
    this.tints = preset.look.decks.map((deck, i) => tint(i, deck?.[9] ?? false));
    const blanket = preset.look.blanket;
    if (blanket) {
      const [, size, rise, art, drift, offsetZ, , variants] = blanket;
      this.blanket = {
        sprite: cloudPicks(art, variants, 1, this.artworkSeed)[0] ?? 0,
        tints: tint(4, blanket[6]),
        size,
        rise,
        z: -125 + offsetZ,
        drift,
      };
    } else {
      this.blanket = null;
    }
    this.stars = null;
  }
  // Frame rates by kind of sky (48 fps falling or storming, 30 clouds and fog, 25
  // clear); at 10 fps a drifting deck visibly stepped. Transitions get every frame. Stars
  // only twinkle, so they need less; a sky with nothing moving barely needs repainting.
  get frameInterval(): number {
    return Math.max(this.skyInterval, this.lowPower ? LOW_POWER.frame : 0);
  }
  private get skyInterval(): number {
    const p = this.live ?? this.preset;
    if (!p) return 100;
    // Mid-transition every frame; otherwise the frame rate for the kind of sky.
    if (this.outgoing || this.ramping) return 16;
    return 1000 / p.fps;
  }
  private get fallShare(): number {
    return this.lowPower ? LOW_POWER.fall : 1;
  }
  fadeProgress(phase = this.lastPhase): number {
    const out = this.outgoing;
    if (!out) return 1;
    out.start ??= phase;
    return clamp(((phase ?? NaN) - (out.start ?? NaN)) / FADE);
  }
  // Values that appear or vanish ease toward the new preset instead of cutting:
  // rain builds from a few drops, stars come out, the moon fades in. A still
  // frame (phase 0, as with Reduce Motion) settles everything at once.
  advance(phase: number): Levels {
    const p = this.preset,
      last = this.lastPhase ?? 0,
      dt = phase && last ? Math.min(500, phase - last) : Infinity;
    this.lastPhase = phase;
    if (!p) throw new Error('The scene has no preset to advance toward.');
    const targets: Levels = {
      rain: p.rain,
      snow: p.snow,
      dust: p.dust,
      sleet: p.sleet,
      hail: p.hail,
      wind: p.wind,
      stars: p.stars,
      fog: p.fog,
      fringe: p.fringe,
      sun: p.sun ? 1 : 0,
      moon: p.moon ? 1 : 0,
      flare: p.flare ? 1 : 0,
    };
    this.levels ??= { ...targets };
    const levels = this.levels,
      k = dt === Infinity ? 1 : 1 - Math.exp(-dt / RAMP);
    this.ramping = false;
    for (const key of LEVELS) {
      const target = targets[key],
        from = levels[key];
      let value = from + (target - from) * k;
      if (Math.abs(target - value) < 0.01 * Math.max(1, target, from)) value = target;
      else this.ramping = true;
      levels[key] = value;
    }
    if (!levels.rain && this.rainPreset) {
      this.rainPreset = undefined;
      this.rainFields = {};
    }
    if (!phase) this.outgoing = null;
    if (this.outgoing && this.fadeProgress(phase) >= 1) this.outgoing = null;
    this.live = {
      ...p,
      rain: levels.rain,
      snow: levels.snow,
      dust: levels.dust,
      sleet: levels.sleet,
      hail: levels.hail,
      wind: levels.wind,
      stars: levels.stars,
      fog: levels.fog,
      fringe: levels.fringe,
    };
    return levels;
  }
  // `open` is the clear sky (x, y, width, height) for the sun and moon; `covered`
  // lists glass panels (with corner `radius`), whose refraction would smear
  // stars into streaks; rain splashes on the tops of `edges`.
  paint(
    width: number,
    height: number,
    dpr = 1,
    phase = 0,
    { open = { x: 0, y: 0, width, height }, covered = [], edges = covered, text, scroll = 0 }: PaintOptions = {},
  ): void {
    if (!this.preset) return;
    const canvas = this.canvas;
    if (!canvas) throw new Error('The scene has no canvas to paint.');
    let ctx = canvas.getContext('2d');
    const fade = this.advance(phase),
      p = this.live;
    let ratio = Math.min(dpr, this.lowPower ? Math.min(1, Math.sqrt(LOW_POWER.pixels / (width * height))) : 2);
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    if (!p) return;
    const out = this.outgoing,
      t = out ? this.fadeProgress(phase) : 1,
      ease = t * t * (3 - 2 * t);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      this.stars = null;
    }
    // Under half a device pixel either way, there is nothing to draw on.
    if (!canvas.width || !canvas.height) return;
    if (phase && p.rain > 0.5 && !GRAINED.has(this.preset.kind)) {
      this.rainRenderer = sharedGlass();
      this.gpuSky = this.rainRenderer?.beginSky(canvas, ratio) ?? null;
      if (this.gpuSky) {
        this.farRain = undefined;
        this.rainTile = undefined;
        ctx = context2d(this.gpuSky.background);
        ratio = this.gpuSky.backgroundScale;
      }
    } else {
      this.rainRenderer?.releaseSky(canvas);
      this.gpuSky = null;
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const background = this.background ?? sceneGradient(p, this.tile),
      [top, middle, bottom] = background.colors;
    this.bands(ctx, 'sky', 0, height, [
      [0, top],
      [background.middleStop, middle],
      [1, bottom],
    ]);
    if (out) {
      const [oldTop, oldMiddle, oldBottom] = stops(out.sky),
        old = ctx.createLinearGradient(0, 0, 0, height);
      old.addColorStop(0, oldTop);
      old.addColorStop(out.skyStop, oldMiddle);
      old.addColorStop(1, oldBottom);
      ctx.globalAlpha = 1 - ease;
      ctx.fillStyle = old;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
    }
    if (p.fog > 0.005) this.paintNoise(ctx, width, height, phase);
    if (p.stars > 0.005) {
      this.paintStars(ctx, width, height, phase, covered);
      if (phase && p.stars > 0.5 && p.look.layers.includes('shootingStar'))
        this.paintShootingStar(ctx, width, height, phase, covered);
    } else this.enlarged.clear();
    const sun = fade.sun > 0.005 ? this.sunSpot(width, height, text) : undefined;
    if (!sun) this.glow = undefined;
    if (fade.moon > 0.005) {
      ctx.globalAlpha = fade.moon;
      this.paintMoon(ctx, width, height, open, text, sun);
      ctx.globalAlpha = 1;
    }
    if (sun) this.paintSun(ctx, width, height, phase, sun, fade.sun);
    if (p.lightning && phase && (this.stormStart === undefined || phase < this.stormStart)) this.stormStart = phase;
    const stormTime = phase - (this.stormStart ?? phase),
      strike = p.lightning && phase ? this.strike(stormTime) : null,
      flicker = p.cloudFlash && phase ? this.cloudFlicker(ctx, stormTime, width, height) : null;
    const painter = this.painter();
    const lid = (blanket: Blanket, alpha: number, on = ctx) => {
      const atlas = WeatherScene.atlas;
      if (alpha <= 0.005 || (!painter && !atlas?.loaded)) return;
      const camera = cloudCamera(p, width, height, this.tile, this.textScale),
        depth = camera.z - blanket.z;
      if (depth <= 1) return;
      const projection = camera.focalPixels / depth;
      const size = spriteSize(blanket.sprite);
      const fit = Math.max(0.3 * blanket.size, width / projection / 2 / 15.6);
      const w = size.width * CLOUD_PIXEL * fit * projection,
        h = size.height * CLOUD_PIXEL * fit * projection;
      const worldY = Math.max(7.9 + blanket.rise, camera.y + camera.centerY / projection + 0.5);
      // The blanket is pinned by its top edge. Individual cloud sprites use a centered pivot.
      const y = camera.centerY - (worldY - camera.y) * projection + h * 0.005 - scroll * PARALLAX[0];
      const travel = (((phase / 1000) * blanket.drift) % 1) * w;
      const origin = camera.centerX - w / 2 - travel;
      const draws: CloudDraw[] = [];
      for (let x = origin - w; x < width + w; x += w) {
        const draw: CloudDraw = {
          sprite: blanket.sprite,
          x,
          y,
          width: w,
          height: h,
          flip: false,
          light: blanket.tints.direction,
          sun: blanket.tints.sun,
          ambient: blanket.tints.ambient,
          fill: blanket.tints.fill,
          opacity: blanket.tints.opacity,
          alpha,
        };
        draws.push(draw);
      }
      if (painter?.paint(on, draws)) return;
      const image = atlas?.lit(
        blanket.sprite,
        false,
        blanket.tints.direction,
        blanket.tints.sun,
        blanket.tints.ambient,
        blanket.tints.fill,
        blanket.tints.opacity,
      );
      if (!image) return;
      on.globalAlpha = alpha;
      for (const draw of draws) on.drawImage(image, draw.x, draw.y, draw.width, draw.height);
      on.globalAlpha = 1;
    };
    if (out?.blanket) lid(out.blanket, out.blanketAlpha * (1 - ease));
    if (this.blanket) lid(this.blanket, p.blanket * ease);
    // A flicker behind the clouds lights the blanket where it hangs: the blanket again, on its
    // own layer, gives the shape the light adds to (see addFlicker).
    if (flicker && (out?.blanket || this.blanket)) {
      const layer = this.cloudCanvas(width, height, Math.min(ratio, 1));
      if (out?.blanket) lid(out.blanket, out.blanketAlpha * (1 - ease), layer);
      if (this.blanket) lid(this.blanket, p.blanket * ease, layer);
      this.addFlicker(ctx, layer, flicker, width, height);
    }
    const falling = p.rain + p.snow + p.dust + p.sleet + p.hail > 0.5;
    if (!falling || !p.rain) {
      this.farRain = undefined;
      this.rainTile = undefined;
    }
    // Clouds draw to their own canvas at one pixel per CSS pixel: the sprites are
    // soft and stretched several times over, so a sharper canvas adds no detail, only
    // fill. Under the moon, that canvas also lets moonlight brighten only the cloud
    // near it.
    const moonlit = p.light.moonIntensity > 0 && fade.moon > 0.005 ? this.moonPoint : undefined,
      layered = Boolean(moonlit) || Boolean(flicker) || ratio > 1,
      target = layered ? this.cloudCanvas(width, height, Math.min(ratio, 1)) : ctx;
    let drawn = false;
    // On the GPU, each run of decks is gathered and drawn at once, before the layer is used.
    const queue: CloudDraw[] | undefined = painter ? [] : undefined;
    const flush = () => {
      if (painter && queue && queue.length > 0) painter.paint(target, queue.splice(0));
      if (!layered || !drawn) return;
      drawn = false;
      if (moonlit) this.paintMoonlight(target, moonlit, fade.moon);
      ctx.drawImage(target.canvas, 0, 0, width, height);
      if (flicker) this.addFlicker(ctx, target, flicker, width, height);
      target.clearRect(0, 0, width, height);
    };
    // Outgoing clouds keep drifting as they fade.
    for (let index = 0; index < DECK_COUNT; index++) {
      const lift = scroll * (PARALLAX[index] ?? 0);
      if (index === 2 && falling) {
        flush();
        this.paintPrecipitation(ctx, width, height, phase, 'back');
      }
      if (out) {
        const deck = out.decks[index],
          tints = out.tints[index];
        if (deck && tints) {
          this.paintDeck(target, width, height, phase, deck, tints, 1 - ease, queue, lift);
          drawn = true;
        }
      }
      const deck = this.decks?.[index],
        tints = this.tints[index];
      if (deck && tints) {
        this.paintDeck(target, width, height, phase, deck, tints, ease, queue, lift);
        drawn = true;
      }
    }
    flush();
    if (GRAINED.has(this.preset.kind)) this.paintGrain(ctx);
    if (p.fringe > 0.005) this.paintFringe(ctx, width, height, phase);
    if (falling) {
      this.paintPrecipitation(ctx, width, height, phase, 'front');
      this.paintImpacts(ctx, width, height, phase, edges);
    }
    if (p.wind > 0.005) this.paintWind(ctx, width, height, phase);
    if (p.look.layers.includes('nearParticles')) this.paintNearParticles(ctx, width, height, phase);
    if (strike) this.paintBolt(ctx, width, height, strike);
    if (p.fog > 0.005) this.paintFog(ctx, height);
    if (fade.sun > 0.005 && fade.flare > 0.005) this.paintFlare(ctx, width, height, phase, fade.sun * fade.flare);
    // A strike's flash whitens everything, the bolt included.
    if (strike && strike.screen > 0) {
      ctx.fillStyle = `rgba(255,255,255,${strike.screen})`;
      ctx.fillRect(0, 0, width, height);
    }
    this.gpuSky?.finish(canvas, this.gpuSky.background);
    this.gpuSky = null;
    // List text sits above a 7% black scrim over the completed weather picture.
    if (this.tile) {
      const surface = context2d(canvas);
      surface.save();
      surface.setTransform(1, 0, 0, 1, 0, 0);
      surface.globalAlpha = 0.07;
      surface.fillStyle = '#000000';
      surface.fillRect(0, 0, canvas.width, canvas.height);
      surface.restore();
    }
    // A still frame is likely the last for a while, so the canvas-sized layers go with it.
    if (!phase) {
      this.glow = undefined;
      this.enlarged.clear();
      this.grainStrip = undefined;
      this.farRain = undefined;
      this.rainTile = undefined;
    }
  }
  // Fills the canvas with a gradient running straight down from `from` to `to` (in the
  // transform's units) through `colors` at their offsets, at the context's alpha. It is
  // drawn once into a strip STRIP device pixels wide and copied across: copying costs
  // a tenth of filling the gradient again where the canvas is drawn without a GPU, and
  // gives the same pixels to within rounding. The strip carries the alpha, so the
  // copies add no rounding of their own.
  bands(
    ctx: CanvasRenderingContext2D,
    name: string,
    from: number,
    to: number,
    colors: readonly (readonly [offset: number, color: string])[],
  ): void {
    const canvas = ctx.canvas,
      matrix = ctx.getTransform(),
      alpha = ctx.globalAlpha,
      key = JSON.stringify([from, to, colors, alpha, canvas.height, matrix.toString()]);
    let strip = this.strips.get(name);
    if (strip?.key !== key) {
      // Redrawn in place: fog fading in changes the alpha, and so the key, every frame.
      const image = strip?.canvas ?? document.createElement('canvas');
      image.width = STRIP;
      image.height = canvas.height;
      const c = context2d(image),
        gradient = c.createLinearGradient(0, from, 0, to);
      for (const [offset, color] of colors) gradient.addColorStop(offset, color);
      c.setTransform(matrix);
      c.globalAlpha = alpha;
      c.fillStyle = gradient;
      c.fillRect(0, 0, STRIP / matrix.a, canvas.height / matrix.d);
      strip = { key, canvas: image };
      this.strips.set(name, strip);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    for (let x = 0; x < canvas.width; x += STRIP) ctx.drawImage(strip.canvas, x, 0);
    ctx.restore();
  }
  // Two star populations: a dense field of faint points and a few bright,
  // coloured stars with halos, over a faint Milky Way haze. Density scales with area. Twinkling stars are drawn
  // each frame; the rest are baked with the haze into a tile that wraps
  // horizontally, so the field can drift.
  paintStars(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    phase: number,
    covered: readonly Panel[],
  ): void {
    const counts = this.preset?.look.stars ?? [3500, 100, 1000, 0.04],
      key = `${Math.round(width)}x${Math.round(height)}:${counts.join(',')}`;
    if (!this.stars || this.starsKey !== key) {
      const canvas = document.createElement('canvas');
      this.stars = canvas;
      canvas.width = Math.round(width);
      canvas.height = Math.round(height);
      this.starsKey = key;
      const c = context2d(canvas),
        colors = ['#ffffff', '#fff0d8', '#dbe6ff', '#ffe2c4', '#cfdcff'],
        color = (index: number) => colors[index] ?? '#ffffff';
      // The band sweeps down across the sky and back, one wave per tile width,
      // so the wrapped tile has no seam; `across` is distance from its centre.
      const centre = (x: number) => 0.42 + 0.3 * Math.sin((x / width) * Math.PI * 2 + 0.6),
        across = (x: number, y: number) => y / height - centre(x);
      const haze = c.createImageData(Math.ceil(width / 4), Math.ceil(height / 4));
      for (let y = 0; y < haze.height; y++)
        for (let x = 0; x < haze.width; x++) {
          // Star clouds at 4% opacity: a hint of the Milky Way, no more.
          const d = across(x * 4, y * 4),
            n = fbm(((x * 4) / width) * 5, ((y * 4) / height) * 4, 5, 29, 5),
            a =
              Math.exp(-((d / 0.15) ** 2)) *
              (0.35 + clamp((n - 0.3) * 2) * 0.65) *
              (counts[2] > 0 ? counts[3] * 2.25 : 0),
            q = (y * haze.width + x) * 4;
          haze.data[q] = 190 + n * 40;
          haze.data[q + 1] = 196 + n * 30;
          haze.data[q + 2] = 235;
          haze.data[q + 3] = a * 255;
        }
      // The haze is its own layer: it is smooth enough to show through the glass.
      const hazeCanvas = document.createElement('canvas');
      this.haze = hazeCanvas;
      hazeCanvas.width = haze.width;
      hazeCanvas.height = haze.height;
      context2d(hazeCanvas).putImageData(haze, 0, 0);
      // Density: 3,500 faint stars and 100–200 bright ones to a phone screen.
      const area = clamp((width * height) / (393 * 852), 0, 2),
        faint = Math.round(Math.min(7000, counts[0] * area)),
        twinklers: Twinkler[] = [];
      for (let i = 0; i < faint; i++) {
        let x = hash(i, 17) * width,
          y = hash(i, 34) * height;
        // A third of the faint stars crowd into the band.
        if (i % 3 === 0) {
          x = hash(i, 35) * width;
          y = (centre(x) + (hash(i, 36) + hash(i, 37) - 1) * 0.14) * height;
        }
        if (y < 0 || y > height) continue;
        // The faint field barely clears the sky's own tone; what reads as stars are the bright ones.
        const m = hash(i, 58),
          size = 0.6 + m * 0.7,
          alpha = 0.05 + m * 0.12;
        // The brighter faint stars twinkle, as many as 320; dimmer ones stay put,
        // since a dip in a barely visible point goes unseen.
        if (m > 0.45 && hash(i, 59) < 0.45 && twinklers.length < 320) {
          twinklers.push({
            x,
            y,
            size: size + 0.3,
            alpha: 0.12 + m * 0.16,
            color: color(i % 5),
            seed: hash(i, 60),
            bright: false,
            pace: 0,
            lift: 0,
            quick: 0,
            flash: 0,
          });
          continue;
        }
        c.globalAlpha = alpha;
        c.fillStyle = color(i % 5);
        c.fillRect(x, y, size, size);
      }
      // Bright stars: about 60 to every 100,000 pt of sky, each a soft dot some 1-2 pt across in
      // a tint of its own.
      const count = Math.round(Math.min(400, counts[1] * area));
      for (let i = 0; i < count; i++) {
        const m = hash(i, 158);
        twinklers.push({
          x: hash(i, 117) * width,
          y: hash(i, 134) * height,
          size: 0.65 + m * 0.75,
          alpha: 0.85 + m * 0.15,
          color: starTint(hash(i, 197)),
          seed: hash(i, 193),
          bright: true,
          pace: 0.8 + hash(i, 194) * 0.2,
          lift: hash(i, 196) < 1 / 30 ? 0 : 0.375 * (0.65 + hash(i, 195) * 0.35),
          quick: Math.PI * 2 * (FLASH_TURNS[0] + hash(i, 198) * (FLASH_TURNS[1] - FLASH_TURNS[0])),
          flash: Math.PI * (2 * hash(i, 199) - 1),
        });
      }
      c.globalAlpha = 1;
      this.twinklers = twinklers;
    }
    const p = this.live,
      stars = this.stars,
      haze = this.haze;
    if (!p || !haze) return;
    // The field drifts left about 0.26% of the
    // view width per second (2 pt/s in a 760 pt window).
    const drift = phase ? ((phase / 1000) * width * 0.0026) % width : 0,
      wrap = (x: number) => (((x - drift) % width) + width) % width;
    // The haze and the field are enlarged smoothly once, at the canvas's resolution, and
    // the enlargements copied: enlarging them every frame cost most of a night's frame
    // where the canvas is drawn without a GPU. The haze is smooth enough to move by whole
    // device pixels. The field glides, copied at its fraction of a pixel with plain
    // smoothing, which keeps its stars' size, brightness and shimmer.
    const scale = ctx.getTransform().a,
      shift = Math.round(drift * scale),
      across = Math.round(width * scale);
    ctx.save();
    ctx.globalAlpha = p.stars;
    // The twinkling stars' sprites too are drawn smoothly.
    ctx.imageSmoothingQuality = 'high';
    const enlargedHaze = this.enlarge(ctx, 'haze', haze, width, height);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(enlargedHaze, -shift, 0);
    ctx.drawImage(enlargedHaze, across - shift, 0);
    ctx.restore();
    // Stars stay out from behind glass panels, whose refraction would smear
    // them into streaks. The cut-out follows each panel's rounded outline, so no
    // edge of it shows through the glass.
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    for (const rect of covered) {
      ctx.roundRect(rect.x - 6, rect.y - 6, rect.width + 12, rect.height + 12, (rect.radius ?? 0) + 6);
    }
    ctx.clip('evenodd');
    ctx.save();
    const field = this.enlarge(ctx, 'field', stars, width, height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(field, -drift * scale, 0);
    ctx.drawImage(field, (width - drift) * scale, 0);
    ctx.restore();
    // A faint star dims and recovers in a smooth wave of about 5.5-8.5 s, down to 25%. A bright
    // star never dims below its own tint: white light is added over it in a wave of its own,
    // turning 0.8-1 radians a second (a 6.3-7.9 s cycle) from its own point in the cycle, from
    // none up to twice its `lift`, so at the top of its wave the star turns whiter and brighter.
    // For the few seconds it stands there it also flashes into a close glow and out again, about
    // once a second (see FLASH_FROM): each flash lights within a tenth of a second, holds a moment
    // and goes as fast, and at the bottom of its wave the star has no glow at all. The waves are
    // out of step, so the stars brighten and flash one at a time; one bright star in thirty holds
    // steady at its tint. The light is added once every star is drawn.
    const lights: { x: number; y: number; r: number; glow: number; added: number; flash: number }[] = [],
      seconds = phase / 1000;
    for (const star of this.twinklers) {
      const x = wrap(star.x);
      if (star.bright) {
        const r = star.size * STAR_REACH,
          wave = phase && star.lift ? 1 + Math.sin(Math.PI * (2 * star.seed - 1) + seconds * star.pace) : 0,
          edge = wave
            ? clamp((Math.sin(star.flash + seconds * star.quick) + FLASH_SWELL * wave - FLASH_FROM) / FLASH_EDGE)
            : 0,
          added = p.stars * star.lift * wave,
          flash = p.stars * star.lift * GLOW_FLASH * edge * edge * (3 - 2 * edge);
        ctx.globalAlpha = p.stars * star.alpha;
        ctx.drawImage(this.starSprite(star.color), x - r, star.y - r, r * 2, r * 2);
        if (added > 0.005) lights.push({ x, y: star.y, r, glow: star.size * GLOW_REACH, added, flash });
      } else {
        const period = 5500 + star.seed * 3000,
          level = phase ? 1 - 0.75 * (0.5 - 0.5 * Math.cos(Math.PI * 2 * (phase / period + star.seed * 7.3))) : 1;
        ctx.globalAlpha = p.stars * star.alpha * level;
        ctx.fillStyle = star.color;
        ctx.fillRect(x, star.y, star.size, star.size);
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    const twinkle = this.starSprite('#ffffff'),
      glow = WeatherScene.glowSprite();
    // Light beyond an image's own full strength is the image drawn again.
    const add = (image: HTMLCanvasElement, x: number, y: number, r: number, amount: number) => {
      for (let left = amount; left > 0.005; left -= 1) {
        ctx.globalAlpha = Math.min(1, left);
        ctx.drawImage(image, x - r, y - r, r * 2, r * 2);
      }
    };
    for (const light of lights) {
      add(twinkle, light.x, light.y, light.r, light.added);
      add(glow, light.x, light.y, light.glow, light.flash);
    }
    ctx.restore();
  }
  // The star `layer` ('haze' or 'field', drawn from `source`) enlarged to the card's
  // `width` × `height` in the context's transform, smoothly, at the canvas's resolution.
  enlarge(
    ctx: CanvasRenderingContext2D,
    layer: 'haze' | 'field',
    source: HTMLCanvasElement,
    width: number,
    height: number,
  ): HTMLCanvasElement {
    const canvas = ctx.canvas,
      matrix = ctx.getTransform(),
      key = `${canvas.width}x${canvas.height}:${matrix.toString()}`;
    let enlarged = this.enlarged.get(layer);
    if (enlarged?.source !== source || enlarged.key !== key) {
      const image = document.createElement('canvas');
      image.width = canvas.width;
      image.height = canvas.height;
      const c = context2d(image);
      c.setTransform(matrix);
      c.imageSmoothingQuality = 'high';
      c.drawImage(source, 0, 0, width, height);
      enlarged = { source, key, canvas: image };
      this.enlarged.set(layer, enlarged);
    }
    return enlarged.canvas;
  }
  // The white glow a twinkle spreads into (see STAR_GLOW), made once for the page.
  static glowSprite(): HTMLCanvasElement {
    const sprites = WeatherScene.starSprites;
    let canvas = sprites.get('glow');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = 64;
      const c = context2d(canvas),
        dot = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      for (const [at, alpha] of STAR_GLOW) dot.addColorStop(at, `rgb(255 255 255 / ${alpha})`);
      c.fillStyle = dot;
      c.fillRect(0, 0, 64, 64);
      sprites.set('glow', canvas);
    }
    return canvas;
  }
  // A bright star: a soft dot in `color` (see STAR_DOT), cached per colour.
  starSprite(color: string): HTMLCanvasElement {
    const sprites = WeatherScene.starSprites;
    let canvas = sprites.get(color);
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      const c = context2d(canvas),
        dot = c.createRadialGradient(16, 16, 0, 16, 16, 16);
      for (const [at, alpha] of STAR_DOT)
        dot.addColorStop(
          at,
          `${color}${Math.round(alpha * 255)
            .toString(16)
            .padStart(2, '0')}`,
        );
      c.fillStyle = dot;
      c.fillRect(0, 0, 32, 32);
      sprites.set(color, canvas);
    }
    return canvas;
  }
  // At most one streak per eleven-second
  // window, seeded so every frame agrees, starting in open sky.
  paintShootingStar(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    phase: number,
    covered: readonly Panel[],
  ): void {
    const period = 11000,
      window = Math.floor(phase / period),
      age = phase - window * period - hash(window, 71) * period * 0.7,
      duration = 850;
    if (hash(window, 72) < 0.45 || age < 0 || age > duration) return;
    const x0 = width * (0.2 + hash(window, 73) * 0.75),
      y0 = height * (0.04 + hash(window, 74) * 0.3);
    if (covered.some(rect => x0 > rect.x && x0 < rect.x + rect.width && y0 > rect.y && y0 < rect.y + rect.height))
      return;
    const angle = Math.PI * (0.72 + hash(window, 75) * 0.12),
      travel = Math.min(width, height) * (0.35 + hash(window, 76) * 0.2),
      progress = age / duration;
    const eased = 1 - (1 - progress) ** 2,
      head: Point = [x0 + Math.cos(angle) * travel * eased, y0 + Math.sin(angle) * travel * eased];
    const tail = travel * 0.32 * (1 - progress * 0.4),
      end: Point = [head[0] - Math.cos(angle) * tail, head[1] - Math.sin(angle) * tail],
      fade = progress < 0.15 ? progress / 0.15 : 1 - (progress - 0.15) / 0.85;
    const streak = ctx.createLinearGradient(end[0], end[1], head[0], head[1]);
    streak.addColorStop(0, 'rgba(255,255,255,0)');
    streak.addColorStop(1, `rgba(255,255,255,${0.85 * fade})`);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = streak;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(end[0], end[1]);
    ctx.lineTo(head[0], head[1]);
    ctx.stroke();
    ctx.fillStyle = `rgba(255,255,255,${fade})`;
    ctx.beginPath();
    ctx.arc(head[0], head[1], 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // The moon is about 5.4% of the card's longer side across.
  paintMoon(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    sky: Rect,
    text?: Rect,
    sun?: SunSpot,
    phase = this.preset?.moonPhase ?? moonPhase(),
    radius = clamp(Math.max(width, height) * 0.027, 12, 48),
  ): void {
    const p = this.preset;
    if (!p) return;
    // The horizon tint fades through 10°, while the disk reaches its high-altitude size at 30°.
    const degrees = p.moonAltitude ?? 45,
      warm = Math.round(clamp(1 - degrees / 10) * 100) / 100,
      [high, low] = p.look.moonScale,
      scale = low + (high - low) * clamp(degrees / 30),
      r = radius * (scale / 23.65);
    // A missing lunar track leaves a stable position with its measured altitude.
    const hour = p.moonHour,
      across = finite(hour) ? moonAcross((hour - 6) / 12) : null;
    const { x, y } = moonPlace(width, height, sky, text, degrees, across, r, sun);
    // The sprite is drawn north up, lit from the right while waxing and the left while
    // waning; with a location it turns with the Moon's axis as seen from there.
    const step = p.moonPicture ?? skyMoonPhase(phase),
      tilt = p.moonTilt;
    const lit = (1 - Math.cos(phase * Math.PI * 2)) / 2,
      tone = skyMoonTint(p.light.moonColor, p.light.moonHorizon, warm);
    this.moonPoint = { x, y, r, lit, tone };
    // The phase photograph is screened over the moon's own colour:
    // its black unlit side comes out as a solid disc in that colour, hiding the stars
    // behind it, and the lit side and halo brighten whatever is under them.
    const sprite = WeatherScene.moon?.sprite(Math.round(r * 2 * Math.min(devicePixelRatio || 1, 2)), step, warm, tone);
    if (!sprite) return;
    const [top, middle, bottom] = stops(p.sky),
      t = clamp(y / height),
      stop = p.skyStop;
    const behind = mix(
      t < stop ? mix(top, middle, t / stop) : mix(middle, bottom, (t - stop) / (1 - stop)),
      '#000000',
      0.3,
    );
    // By day and through twilight the moon is only its lit side: the dark limb shows the sky
    // through. As night falls the disc darkens in (MOON_DISC) to hide the stars, its edge as
    // soft as the moon's own.
    const dark = clamp((p.elevation - MOON_DISC.from) / (MOON_DISC.to - MOON_DISC.from));
    ctx.save();
    if (p.night && dark > 0) {
      const [br, bg, bb] = rgb(behind),
        disc = ctx.createRadialGradient(x, y, r * 0.95, x, y, r),
        alpha = ctx.globalAlpha;
      disc.addColorStop(0, behind);
      disc.addColorStop(1, `rgba(${br},${bg},${bb},0)`);
      ctx.fillStyle = disc;
      ctx.globalAlpha = alpha * dark;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = alpha;
    } else if (!p.night) ctx.globalAlpha *= 0.85;
    ctx.translate(x, y);
    if (finite(tilt)) ctx.rotate(tilt);
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(sprite, -r * 2, -r * 2, r * 4, r * 4);
    ctx.restore();
  }
  // The page's GPU painter for clouds, once it is ready; null for the 2D drawing.
  painter(): CloudPainter | null {
    const atlas = WeatherScene.atlas;
    if (WeatherScene.gpuClouds) return cloudPainter(atlas);
    atlas?.restore();
    return null;
  }
  // One deck of cloud sprites, drifting and wrapping. Each cloud is lit from the
  // sun's (or moon's) place relative to it: from the side when far, from behind
  // when near, so clouds by the sun glow at their rims. With no
  // light in view they are lit from above.
  paintDeck(
    target: CanvasRenderingContext2D,
    width: number,
    height: number,
    phase: number,
    clouds: readonly DeckCloud[],
    tints: Tints,
    alpha: number,
    queue?: CloudDraw[],
    lift = 0,
  ): void {
    const p = this.preset,
      atlas = WeatherScene.atlas;
    if (!p || alpha < 0.005 || (!queue && !atlas?.loaded)) return;
    const camera = cloudCamera(p, width, height, this.tile, this.textScale);
    for (const cloud of clouds) {
      const depth = camera.z - cloud.z;
      if (depth <= 1) continue;
      const projection = camera.focalPixels / depth;
      const size = spriteSize(cloud.sprite);
      const w = size.width * CLOUD_PIXEL * cloud.scale * projection,
        h = size.height * CLOUD_PIXEL * cloud.scale * projection;
      const [worldX, fade] = cloudPosition(cloud, phase / 1000);
      const x = camera.centerX + worldX * projection - w / 2,
        y = camera.centerY - (cloud.y - camera.y) * projection - h / 2 - lift;
      if (x + w <= 0 || x >= width || y + h <= 0 || y >= height || fade <= 0) continue;
      const draw: CloudDraw = {
        x,
        y,
        width: w,
        height: h,
        sprite: cloud.sprite,
        flip: false,
        light: tints.direction,
        sun: tints.sun,
        ambient: tints.ambient,
        fill: tints.fill,
        opacity: tints.opacity,
        alpha: alpha * fade,
      };
      if (queue) {
        queue.push(draw);
        continue;
      }
      const image = atlas?.lit(
        cloud.sprite,
        false,
        tints.direction,
        tints.sun,
        tints.ambient,
        tints.fill,
        tints.opacity,
      );
      if (!image) continue;
      target.globalAlpha = draw.alpha;
      target.drawImage(image, x, y, w, h);
    }
    target.globalAlpha = 1;
  }
  // The grain over a flat-lit sky (see GRAIN), in device pixels.
  paintGrain(ctx: CanvasRenderingContext2D): void {
    if (!ctx.canvas.width || !ctx.canvas.height) return;
    let grain = WeatherScene.sprites.grain;
    if (!grain) {
      grain = document.createElement('canvas');
      grain.width = grain.height = GRAIN.size;
      const c = context2d(grain),
        image = c.createImageData(GRAIN.size, GRAIN.size);
      for (let y = 0; y < GRAIN.size; y++)
        for (let x = 0; x < GRAIN.size; x++) {
          const q = (y * GRAIN.size + x) * 4,
            v = 128 + Math.round((hash(x, y) * 2 - 1) * GRAIN.depth);
          image.data[q] = image.data[q + 1] = image.data[q + 2] = v;
          image.data[q + 3] = 255;
        }
      c.putImageData(image, 0, 0);
      WeatherScene.sprites.grain = grain;
    }
    // Firefox's repeated pattern with overlay blending is costly on every frame.
    // Bake a few repeats once, then copy them at the same device-pixel positions.
    const width = Math.min(GRAIN_STRIP, ctx.canvas.width),
      height = ctx.canvas.height;
    let strip = this.grainStrip;
    if (strip?.width !== width || strip.height !== height) {
      strip = document.createElement('canvas');
      strip.width = width;
      strip.height = height;
      const c = context2d(strip),
        pattern = c.createPattern(grain, 'repeat');
      if (!pattern) return;
      c.fillStyle = pattern;
      c.fillRect(0, 0, width, height);
      this.grainStrip = strip;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'overlay';
    for (let x = 0; x < ctx.canvas.width; x += width) ctx.drawImage(strip, x, 0);
    ctx.restore();
  }
  cloudCanvas(width: number, height: number, ratio: number): CanvasRenderingContext2D {
    this.clouds ??= document.createElement('canvas');
    const canvas = this.clouds;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const c = context2d(canvas);
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
    c.clearRect(0, 0, width, height);
    return c;
  }
  // Adds a storm's flickering light (see cloudFlicker) to `ctx` where `clouds`, a cloud layer
  // the canvas's size, has cloud, as much as the cloud is solid; never to the sky between.
  // `clouds` is left as it was. The light is taken on a layer of its own.
  addFlicker(
    ctx: CanvasRenderingContext2D,
    clouds: CanvasRenderingContext2D,
    flicker: CanvasGradient,
    width: number,
    height: number,
  ): void {
    this.flickerLayer ??= document.createElement('canvas');
    const canvas = this.flickerLayer;
    if (canvas.width !== clouds.canvas.width || canvas.height !== clouds.canvas.height) {
      canvas.width = clouds.canvas.width;
      canvas.height = clouds.canvas.height;
    }
    const layer = context2d(canvas);
    layer.setTransform(clouds.getTransform());
    layer.clearRect(0, 0, width, height);
    layer.drawImage(clouds.canvas, 0, 0, width, height);
    layer.globalCompositeOperation = 'source-in';
    layer.fillStyle = flicker;
    layer.fillRect(0, 0, width, height);
    layer.globalCompositeOperation = 'source-over';
    const gpu = this.gpuSky;
    gpu?.layer(ctx);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(canvas, 0, 0, width, height);
    ctx.restore();
    gpu?.layer(ctx, 'lighter');
  }
  // Moonlight silvers cloud within a few moon radii, scaled by the lit fraction.
  paintMoonlight(clouds: CanvasRenderingContext2D, moon: MoonPoint, visible = 1): void {
    const { x, y, r, tone } = moon,
      lit = clamp((this.preset?.light.moonIntensity ?? 0) / 100) * moon.lit * visible,
      [gr, gg, gb] = rgb(tone),
      reach = r * (this.preset?.light.moonRadius ?? 15) * 0.5;
    if (reach <= r || lit <= 0) return;
    const glow = clouds.createRadialGradient(x, y, r, x, y, reach);
    glow.addColorStop(0, `rgba(${gr},${gg},${gb},${0.55 * lit})`);
    glow.addColorStop(0.35, `rgba(${gr},${gg},${gb},${0.2 * lit})`);
    glow.addColorStop(1, `rgba(${gr},${gg},${gb},0)`);
    clouds.globalCompositeOperation = 'source-atop';
    clouds.fillStyle = glow;
    clouds.fillRect(x - reach, y - reach, reach * 2, reach * 2);
    clouds.globalCompositeOperation = 'source-over';
  }
  // The sun is a bloom: a large blown-out white core melting into a wide warm
  // glow, with no hard edge. It rises on the left, crosses high near noon and sets
  // on the right, as seen facing the equator.
  // The sun's path: across the middle of the card from left to right through the day (see
  // arcX), near the top of the frame by noon and lower toward sunrise and sunset. On a card
  // wider than tall the frame's top runs past the card's, so the sun is cut off above, but
  // never by more than SUN_ABOVE: its glow always reaches in. It grows with the longer side.
  // A sun that would come within SUN_CLEAR of the conditions' `text` rises that far clear
  // of them instead, cut off by the top if need be, so the sun never washes them out.
  sunSpot(width: number, height: number, text?: Rect): SunSpot | undefined {
    const p = this.preset;
    if (!p) return undefined;
    const r = Math.max(9, Math.max(width, height) * 0.045),
      path = sunPathAt(p.solarHour ?? estimateHour(0, { elevation: p.elevation, rising: p.rising }), p.windowClass);
    this.sunPath = path;
    const x = width * arcX(path.x),
      room = r * SUN_CLEAR;
    let y = Math.max(frameY(0.03 + path.y, height, frameUnit(width, height)), -width * SUN_ABOVE);
    const above = text && x + room > text.x && x - room < text.x + text.width;
    if (above && y + room > text.y && y - room < text.y + text.height) y = text.y - room;
    return { x, y, r };
  }
  paintSun(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    phase: number,
    sun: SunSpot,
    visible = 1,
  ): void {
    const p = this.preset,
      path = this.sunPath;
    if (!p || !path) return;
    const { x, y, r } = sun;
    const warm = p.golden,
      halo = mix('#fff3e0', '#ffb27a', warm),
      clear = 1 - (p.clouds[2] ?? 0) * 0.7;
    this.sunPoint = { x, y, r, clear };
    ctx.globalAlpha = clear * visible;
    this.paintGlow(ctx, x, y, Math.max(width, height) * 0.85, halo);
    // The bloom breathes very slightly, like exposure settling.
    const bloom = r * 4.6 * (1 + Math.sin(phase / 3700) * 0.015),
      core = ctx.createRadialGradient(x, y, 0, x, y, bloom),
      veil = clear * clear,
      // A stop of the core's rim: `sharp` under a clear sky, or `along` an even slope from the
      // core to the glow under a veiled one.
      rim = (sharp: number, along: number) => sharp * veil + (0.2 * veil + (0.45 - 0.2 * veil) * along) * (1 - veil);
    // A pale core, blown out but for the sky's own tint, fading softly, and all the softer for
    // any cloud across it, as a disc with an edge reads as a lamp behind a veil. It and the spikes are
    // screened, which nears white without reaching it: added, each channel clipped in turn, and
    // where the last one did the sun ended in a hard white edge inside a ring of pure cyan.
    core.addColorStop(0, '#ffffffeb');
    core.addColorStop(0.2 * veil, '#ffffffe0');
    core.addColorStop(rim(0.26, 0.41), `${mix('#ffffff', halo, 0.35)}a0`);
    core.addColorStop(rim(0.34, 0.82), `${halo}60`);
    core.addColorStop(0.45, `${halo}44`);
    core.addColorStop(0.72, `${halo}18`);
    core.addColorStop(1, `${halo}00`);
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = core;
    ctx.fillRect(x - bloom, y - bloom, bloom * 2, bloom * 2);
    // Glare: under a clear sky the light runs on well past the core, a warm white haze fading
    // over half as far again as the bloom, so the sun reads as a glare and never as a disc
    // with an edge. Cloud across the sun takes it away with the core's own sharpness.
    if (veil > 0.005) {
      const reach = bloom * 1.45,
        glare = ctx.createRadialGradient(x, y, 0, x, y, reach),
        tint = mix('#ffffff', halo, 0.5),
        alpha = ctx.globalAlpha;
      glare.addColorStop(0, `${tint}66`);
      glare.addColorStop(0.2, `${tint}54`);
      glare.addColorStop(0.34, `${tint}45`);
      glare.addColorStop(0.42, `${tint}33`);
      glare.addColorStop(0.52, `${tint}26`);
      glare.addColorStop(0.65, `${tint}1c`);
      glare.addColorStop(0.84, `${tint}0d`);
      glare.addColorStop(1, `${tint}00`);
      ctx.globalAlpha = alpha * veil;
      ctx.fillStyle = glare;
      ctx.fillRect(x - reach, y - reach, reach * 2, reach * 2);
      ctx.globalAlpha = alpha;
    }
    // Spike ball: a six-pointed star of thin streaks through the core, turning slowly, once the
    // sun is high enough (SPIKES).
    const spiked = clamp((p.elevation - SPIKES.from) / (SPIKES.to - SPIKES.from));
    if (spiked > 0) {
      const spikes = this.spikeBall(r, halo, ctx.getTransform().a);
      ctx.save();
      ctx.globalAlpha *= spiked;
      ctx.translate(x, y);
      ctx.rotate(0.26 + phase / 90000);
      ctx.drawImage(spikes.image, -spikes.reach, -spikes.reach, spikes.reach * 2, spikes.reach * 2);
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
    // Rays and halo are sized in scene units, so they grow with the frame (see frameUnit).
    const frame = FRAME * frameUnit(width, height);
    if (p.rays) this.paintRays(ctx, frame, phase, x, y, clear * visible);
    // Rainbow halo: its bands sit about a quarter of the frame from the sun.
    if (p.rainbow) {
      ctx.globalAlpha = clear * visible * clamp(p.rainbow[1]) * 0.45 * clamp(path.rainbow / 0.3);
      const ring = Math.round((p.rainbow[0] / FRAME) * frame);
      ctx.drawImage(this.rainbowRing(ring), x - ring, y - ring);
    }
    ctx.globalAlpha = 1;
  }
  // The bloom lifts the whole upper sky toward white, not just the sun's surroundings. It
  // reaches `radius` from the sun at (x, y) and holds still between frames, so it is drawn
  // once at the canvas's resolution, at the context's alpha, and copied.
  paintGlow(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, halo: string): void {
    const canvas = ctx.canvas,
      matrix = ctx.getTransform(),
      alpha = ctx.globalAlpha,
      key = JSON.stringify([x, y, radius, halo, alpha, canvas.width, canvas.height, matrix.toString()]);
    if (this.glow?.key !== key) {
      // Sized afresh, the canvas is also cleared.
      const image = this.glow?.canvas ?? document.createElement('canvas');
      image.width = canvas.width;
      image.height = canvas.height;
      const c = context2d(image),
        glow = c.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, `${halo}a0`);
      glow.addColorStop(0.06, `${halo}60`);
      glow.addColorStop(0.2, `${halo}38`);
      glow.addColorStop(0.5, `${halo}18`);
      glow.addColorStop(1, `${halo}00`);
      c.setTransform(matrix);
      c.globalAlpha = alpha;
      c.fillStyle = glow;
      c.fillRect(0, 0, canvas.width / matrix.a, canvas.height / matrix.d);
      this.glow = { key, canvas: image };
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.glow.canvas, 0, 0);
    ctx.restore();
  }
  // The spike ball of a sun of radius `r`, blurred, at the canvas's resolution (`scale`
  // pixels to the unit), made once to be turned each frame; `reach` is its half-width.
  spikeBall(r: number, halo: string, scale: number): { image: HTMLCanvasElement; reach: number } {
    const key = JSON.stringify([r, halo, scale]);
    if (this.spikes?.key === key) return this.spikes;
    // The blur is `soft` pixels of the canvas, as a canvas filter's would be.
    const spike = r * 3.4,
      soft = Math.max(1, r * 0.05),
      size = Math.ceil(spike * scale + soft * 3) * 2,
      image = document.createElement('canvas');
    image.width = image.height = size;
    const c = context2d(image);
    c.setTransform(scale, 0, 0, scale, size / 2, size / 2);
    c.globalCompositeOperation = 'lighter';
    drawBlurred(image, soft, [
      streaks => {
        for (let i = 0; i < 3; i++) {
          const streak = streaks.createLinearGradient(-spike, 0, spike, 0);
          streak.addColorStop(0, `${halo}00`);
          streak.addColorStop(0.36, `${halo}10`);
          streak.addColorStop(0.5, '#ffffff48');
          streak.addColorStop(0.64, `${halo}10`);
          streak.addColorStop(1, `${halo}00`);
          streaks.fillStyle = streak;
          streaks.beginPath();
          streaks.moveTo(-spike, 0);
          streaks.lineTo(0, -r * 0.09);
          streaks.lineTo(spike, 0);
          streaks.lineTo(0, r * 0.09);
          streaks.closePath();
          streaks.fill();
          streaks.rotate(Math.PI / 3);
        }
      },
    ]);
    this.spikes = { key, image, reach: size / 2 / scale };
    return this.spikes;
  }
  // Sun rays: a few soft beams fanning down from the sun at the preset's
  // angle and spread, as long as the preset says (scene units), swaying slowly.
  // `frame` is the frame's height in pixels.
  paintRays(ctx: CanvasRenderingContext2D, frame: number, phase: number, x: number, y: number, visible: number): void {
    const rays = this.preset?.rays;
    if (!rays) return;
    // The lean comes from the sun's path: 45° toward the middle after sunrise, straight
    // down at noon, -45° before sunset.
    const [, presetColor, count, [shortest, longest], spread] = rays,
      color = this.sunPath?.color ?? presetColor.slice(0, 7),
      rayAlpha = this.sunPath?.alpha ?? colorAlpha(presetColor),
      angle = Math.abs(this.sunPath?.rayAngle ?? 30),
      inward = (this.sunPath?.rayAngle ?? 0) > 0 ? -1 : 1;
    // Soft-edged, as light through haze: the beams are blurred `soft` pixels of the
    // canvas, never cut. Each is blurred once, unswayed, into a sprite centred on the sun at
    // RAYS of the canvas's resolution; each frame turns the sprites by their sway on a layer
    // of that resolution, enlarged onto the sky in one copy.
    const soft = Math.max(6, frame * 0.02),
      canvas = ctx.canvas,
      scale = ctx.getTransform().a,
      k = scale * RAYS,
      key = JSON.stringify([rays, color, angle, inward, frame, scale]);
    if (this.beams?.key !== key) {
      const sprites = [];
      for (let i = 0; i < count; i++) {
        const heading = ((angle + (i - (count - 1) / 2) * spread * 0.45) * inward * Math.PI) / 180,
          length = ((shortest + (longest - shortest) * hash(i, 81)) / FRAME) * frame,
          half = (((spread / 2) * Math.PI) / 180) * (0.55 + hash(i, 82) * 0.3);
        // Measured from straight down, leaning toward the middle of the sky; the blur has
        // faded out three of its deviations past the beam.
        const from = Math.PI / 2 + heading - half,
          to = Math.PI / 2 + heading + half,
          margin = (soft * 3) / scale,
          box = sectorBox(0, 0, length, from, to),
          image = document.createElement('canvas');
        image.width = Math.ceil((box.width + margin * 2) * k);
        image.height = Math.ceil((box.height + margin * 2) * k);
        const c = context2d(image),
          beam = c.createRadialGradient(0, 0, 0, 0, 0, length);
        beam.addColorStop(0, `${color}2a`);
        beam.addColorStop(0.35, `${color}12`);
        beam.addColorStop(1, `${color}00`);
        c.setTransform(k, 0, 0, k, (margin - box.x) * k, (margin - box.y) * k);
        drawBlurred(image, soft * RAYS, [
          sector => {
            sector.fillStyle = beam;
            sector.beginPath();
            sector.moveTo(0, 0);
            sector.arc(0, 0, length, from, to);
            sector.closePath();
            sector.fill();
          },
        ]);
        sprites.push({ image, x: box.x - margin, y: box.y - margin });
      }
      this.beams = { key, sprites, layer: this.beams?.layer ?? document.createElement('canvas') };
    }
    const { sprites, layer } = this.beams,
      w = Math.ceil(canvas.width * RAYS),
      h = Math.ceil(canvas.height * RAYS);
    if (layer.width !== w || layer.height !== h) {
      layer.width = w;
      layer.height = h;
    }
    const c = context2d(layer);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, w, h);
    c.globalCompositeOperation = 'lighter';
    // Only the box the beams can sway through is copied onto the sky: turned 2° at most
    // about the sun, no point moves more than 3.5% of its distance from it.
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const [i, sprite] of sprites.entries()) {
      const sway = Math.sin(phase / 9000 + i * 2.1) * 2,
        width = sprite.image.width / k,
        height = sprite.image.height / k,
        play = Math.hypot(width, height) * 0.035;
      c.setTransform(k, 0, 0, k, x * k, y * k);
      c.rotate((sway * inward * Math.PI) / 180);
      c.drawImage(sprite.image, sprite.x, sprite.y, width, height);
      left = Math.min(left, x + sprite.x - play);
      top = Math.min(top, y + sprite.y - play);
      right = Math.max(right, x + sprite.x + width + play);
      bottom = Math.max(bottom, y + sprite.y + height + play);
    }
    const sx = clamp(Math.floor(left * k), 0, w),
      sy = clamp(Math.floor(top * k), 0, h),
      sw = clamp(Math.ceil(right * k), 0, w) - sx,
      sh = clamp(Math.ceil(bottom * k), 0, h) - sy;
    if (sw <= 0 || sh <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = visible * 0.45 * clamp(rayAlpha / 0.22);
    ctx.drawImage(layer, sx, sy, sw, sh, sx / k, sy / k, sw / k, sh / k);
    ctx.restore();
  }
  // Pastel ring centred on the sun, strongest along its lower edge.
  rainbowRing(radius: number): HTMLCanvasElement {
    const size = Math.round(radius);
    if (this.ring?.size === size) return this.ring.canvas;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size * 2;
    const c = context2d(canvas),
      lineWidth = Math.max(2, size * 0.035);
    drawBlurred(
      canvas,
      Math.max(1, size * 0.02),
      ['#ffc2d8', '#ffeaa8', '#bff5c4', '#b5ecff', '#d6c4ff'].map(
        (color, index) => (band: CanvasRenderingContext2D) => {
          band.lineWidth = lineWidth;
          band.strokeStyle = `${color}66`;
          band.beginPath();
          band.arc(size, size, size * (0.8 + index * 0.035), 0, Math.PI * 2);
          band.stroke();
        },
      ),
    );
    c.globalCompositeOperation = 'destination-in';
    const mask = c.createLinearGradient(0, 0, 0, size * 2);
    mask.addColorStop(0, '#0000');
    mask.addColorStop(0.45, '#0004');
    mask.addColorStop(1, '#000');
    c.fillStyle = mask;
    c.fillRect(0, 0, size * 2, size * 2);
    this.ring = { size, canvas };
    return canvas;
  }
  // The flare is a chain of faint aperture "ghosts" on the line from the
  // sun through the centre: soft filled discs, some seven-sided like a camera
  // iris, two with an etched rim, plus a chromatic blue-magenta glow.
  paintFlare(ctx: CanvasRenderingContext2D, width: number, height: number, phase: number, visible = 1): void {
    const sun = this.sunPoint,
      p = this.preset,
      canvas = ctx.canvas;
    if (!sun || sun.clear < 0.4 || !p) return;
    this.gpuSky?.layer(ctx);
    const dx = width / 2 - sun.x,
      dy = height / 2 - sun.y,
      strength = ((visible * (sun.clear - 0.4)) / 0.6) * (1 - clamp((p.elevation - 35) / 40) * 0.4),
      unit = Math.min(width, height);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const [gx, gy] = [sun.x + dx * 0.3, sun.y + dy * 0.3],
      glow = this.ghost('chromatic', '#ffffff'),
      length = unit * 0.16;
    ctx.translate(gx, gy);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.globalAlpha = p.ghosts ? 0.16 * strength : 0;
    ctx.drawImage(glow, -length / 2, -length / 4, length, length / 2);
    ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    // The iris follows its own count, reach and breathing along the sun path.
    const ghosts = p.ghosts,
      path = this.sunPath;
    if (ghosts && path) {
      const reach = path.irisLength / 15,
        scale = 1 + (path.irisAmplitude / 100) * Math.sin((phase / 1000) * 2 * Math.PI * path.irisFrequency);
      for (let i = 0; i < path.ghosts; i++) {
        const ghost = FLARE_GHOSTS[i % FLARE_GHOSTS.length];
        if (!ghost) continue;
        const [at, size, kind, color, alpha] = ghost,
          t = (at + Math.floor(i / FLARE_GHOSTS.length) * 0.12) * reach,
          radius = unit * size * scale;
        ctx.save();
        ctx.translate(sun.x + dx * t, sun.y + dy * t);
        ctx.rotate(0.3 + t + phase / 80000);
        ctx.globalAlpha = alpha * strength * clamp(ghosts[0] / 0.15, 0, 1.5);
        ctx.drawImage(this.ghost(kind, color), -radius, -radius, radius * 2, radius * 2);
        ctx.restore();
      }
    }
    ctx.restore();
    this.gpuSky?.layer(ctx, 'screen');
  }
  // Ghost sprites, tinted and cached: 'disc', 'iris' (seven-sided aperture),
  // 'etched' (thin bright rim with faint rings) and the 'chromatic' glow.
  ghost(kind: GhostKind, color: string): HTMLCanvasElement {
    const ghosts = WeatherScene.ghosts;
    const key = `${kind}:${color}`,
      cached = ghosts.get(key);
    if (cached) return cached;
    const size = 128,
      half = size / 2,
      canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const c = context2d(canvas);
    if (kind === 'chromatic') {
      canvas.height = half;
      for (const [x, y, r, [inner, outer]] of CHROMATIC) {
        const g = c.createRadialGradient(x * size, y * half, 0, x * size, y * half, r * size);
        g.addColorStop(0, inner);
        g.addColorStop(1, outer);
        c.fillStyle = g;
        c.fillRect(0, 0, size, half);
      }
    } else {
      const outline = (shape: CanvasRenderingContext2D) => {
        shape.beginPath();
        if (kind === 'iris')
          for (let i = 0; i < 7; i++)
            shape.lineTo(
              half + Math.cos((i / 7) * Math.PI * 2) * half * 0.86,
              half + Math.sin((i / 7) * Math.PI * 2) * half * 0.86,
            );
        else shape.arc(half, half, half * 0.86, 0, Math.PI * 2);
        shape.closePath();
      };
      const shapes = [
        (shape: CanvasRenderingContext2D) => {
          outline(shape);
          const fill = shape.createRadialGradient(half, half, 0, half, half, half * 0.86);
          fill.addColorStop(0, kind === 'etched' ? '#ffffff40' : '#ffffffb0');
          fill.addColorStop(0.8, kind === 'etched' ? '#ffffff50' : '#ffffffc0');
          fill.addColorStop(1, '#ffffffe0');
          shape.fillStyle = fill;
          shape.fill();
        },
      ];
      if (kind === 'etched') {
        shapes.push(shape => {
          outline(shape);
          shape.lineWidth = 2.2;
          shape.strokeStyle = '#ffffff';
          shape.stroke();
        });
        for (let ring = 1; ring < 5; ring++)
          shapes.push(shape => {
            shape.lineWidth = 0.6;
            shape.strokeStyle = '#ffffff40';
            shape.beginPath();
            shape.arc(half, half, (half * 0.86 * ring) / 5, 0, Math.PI * 2);
            shape.stroke();
          });
      }
      drawBlurred(canvas, 1.6, shapes);
      // Fine grain, like dust on a lens element.
      const image = c.getImageData(0, 0, size, size);
      for (let i = 0; i < size * size; i++) {
        const a = i * 4 + 3;
        image.data[a] =
          (image.data[a] ?? 0) *
          (0.82 + fbm(((i % size) / size) * 9, (Math.floor(i / size) / size) * 9, 9, 61, 3) * 0.32);
      }
      c.putImageData(image, 0, 0);
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = color;
      c.fillRect(0, 0, size, size);
    }
    ghosts.set(key, canvas);
    return canvas;
  }
  // The sheets encode coverage in grayscale. Keep their cells as small alpha masks so
  // every card can use the same source while applying its own daylight or moonlight.
  private airMask(kind: 'noise' | 'fringe'): HTMLCanvasElement {
    const image = effectImage(kind),
      cached = WeatherScene.airMasks[kind];
    if (cached && cached.image === image) return cached.canvas;
    const columns = kind === 'noise' ? 2 : 3,
      tile = 128,
      canvas = document.createElement('canvas');
    canvas.width = columns * tile;
    canvas.height = 2 * tile;
    const pen = context2d(canvas);
    if (image) pen.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = pen.getImageData(0, 0, canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++)
      for (let x = 0; x < canvas.width; x++) {
        const i = 4 * (y * canvas.width + x);
        if (image) pixels.data[i + 3] = pixels.data[i] ?? 0;
        else {
          const u = (x % tile) / tile,
            v = (y % tile) / tile,
            frame = Math.floor(x / tile) + Math.floor(y / tile) * columns,
            edge = clamp(1 - 2 * Math.hypot(u - 0.5, v - 0.5)),
            n = fbm(u * 4, v * 4, 4, (kind === 'noise' ? 83 : 97) + frame, 5);
          pixels.data[i + 3] = 255 * (kind === 'noise' ? edge * (0.35 + n * 0.65) : edge * clamp((n - 0.45) * 1.5));
        }
        pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
      }
    pen.putImageData(pixels, 0, 0);
    WeatherScene.airMasks[kind] = { image, canvas };
    return canvas;
  }
  private airSprite(kind: 'noise' | 'fringe', frame: number, color: string, key: string): HTMLCanvasElement {
    const mask = this.airMask(kind);
    let cache = this.airTints[kind];
    if (!cache || cache.mask !== mask || cache.key !== key)
      cache = this.airTints[kind] = { mask, key, tiles: new Map() };
    const tileKey = `${frame}${color}`,
      existing = cache.tiles.get(tileKey);
    if (existing) return existing;
    const columns = kind === 'noise' ? 2 : 3,
      tile = mask.width / columns,
      canvas = document.createElement('canvas');
    canvas.width = canvas.height = tile;
    const pen = context2d(canvas);
    pen.drawImage(mask, (frame % columns) * tile, Math.floor(frame / columns) * tile, tile, tile, 0, 0, tile, tile);
    pen.globalCompositeOperation = 'source-in';
    pen.fillStyle = color;
    pen.fillRect(0, 0, tile, tile);
    cache.tiles.set(tileKey, canvas);
    return canvas;
  }
  // A continuous emitter. Launches are spaced by the rate and each retains its
  // chosen size, rotation, texture frame and tint until the end of its life.
  paintNoise(ctx: CanvasRenderingContext2D, width: number, height: number, phase: number): void {
    const p = this.live;
    if (!p?.look.layers.includes('fog') || p.fog <= 0) return;
    const field = p.look.noise,
      rate = field.count,
      life = field.life,
      [start, end] = p.light.air.noise,
      startAlpha = colorAlpha(start),
      endAlpha = colorAlpha(end);
    if (rate <= 0 || life <= 0 || Math.max(startAlpha, endAlpha) <= 0) return;
    const unit = frameUnit(width, height),
      seconds = phase / 1000,
      head = Math.floor(seconds * rate),
      angle = this.slant(phase),
      dx = Math.sin(angle),
      dy = Math.cos(angle),
      extent = Math.ceil(life * rate),
      w = Math.ceil(width * NOISE),
      h = Math.ceil(height * NOISE),
      key = start + end;
    this.noise ??= document.createElement('canvas');
    const layer = this.noise;
    if (layer.width !== w || layer.height !== h) {
      layer.width = w;
      layer.height = h;
    }
    const c = context2d(layer);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, w, h);
    for (let slot = 0; slot < extent; slot++) {
      const id = head - slot,
        age = seconds - id / rate;
      if (age >= life) continue;
      const size = (field.size[0] + hash(id, 41) * (field.size[1] - field.size[0])) * unit,
        launch = (hash(id, 42) - 0.5) * (width + size),
        distance = age * field.speed * unit - (height + size) / 2,
        x = width / 2 + launch * dy + distance * dx,
        y = height / 2 - launch * dx + distance * dy;
      if (x < -size || x > width + size || y < -size || y > height + size) continue;
      const fraction = hash(id, 43),
        // Sixteen RGB samples keep a slowly changing light's small sprite cache bounded.
        color = mix(start, end, Math.round(fraction * 15) / 15),
        frame = Math.floor(hash(id, 44) * 4),
        turn =
          hash(id, 45) * 2 * Math.PI +
          (age * (field.spin[0] + hash(id, 46) * (field.spin[1] - field.spin[0])) * Math.PI) / 180;
      c.setTransform(NOISE, 0, 0, NOISE, x * NOISE, y * NOISE);
      c.rotate(turn);
      c.globalAlpha = p.fog * (startAlpha + (endAlpha - startAlpha) * fraction);
      c.drawImage(this.airSprite('noise', frame, color, key), -size / 2, -size / 2, size, size);
    }
    ctx.drawImage(layer, 0, 0, width, height);
  }
  // The fringe is one persistent burst. The particles wrap through the emitter,
  // turn and pulse in size while the light track controls their material.
  paintFringe(ctx: CanvasRenderingContext2D, width: number, height: number, phase: number): void {
    const p = this.live;
    if (!p?.look.layers.includes('fringe') || p.fringe <= 0) return;
    const field = p.look.fringe,
      color = p.light.air.fringe,
      alpha = colorAlpha(color) * p.fringe;
    if (!alpha || field.count <= 0) return;
    const camera = cloudCamera(p, width, height, this.tile, this.textScale),
      seconds = phase / 1000,
      [spreadX, spreadY, spreadZ] = field.emitter;
    ctx.save();
    ctx.globalAlpha = alpha;
    for (let id = 0; id < field.count; id++) {
      const phaseAtBirth = hash(id, 51) * 2 * Math.PI,
        radius = field.size + field.amplitude * Math.sin(phaseAtBirth + seconds * field.frequency),
        depth = (hash(id, 52) - 0.5) * spreadZ,
        project = camera.focalPixels / Math.max(1, camera.z - depth),
        size = radius * project,
        span = Math.max(2 * spreadX, width / project + 2 * field.size),
        offset = ((id + 0.5) / field.count) * span - seconds * field.speed,
        x = camera.centerX + ((((offset % span) + span) % span) - span / 2) * project,
        y = camera.centerY - (field.y + (hash(id, 53) - 0.5) * spreadY - camera.y) * project;
      if (x < -size || x > width + size || y < -size || y > height + size) continue;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(phaseAtBirth + (seconds * field.spin * Math.PI) / 180);
      ctx.drawImage(this.airSprite('fringe', id % 6, color.slice(0, 7), color), -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    ctx.restore();
  }
  // Gusts swing the fall angle slowly.
  slant(phase: number): number {
    const p = this.live;
    if (!p) return 0;
    const [amount, speed] = p.look.rainFall.sway;
    return p.windAngle - (amount * Math.sin((speed * phase) / 1000) * Math.PI) / 180;
  }
  paintWind(ctx: CanvasRenderingContext2D, width: number, height: number, phase: number): void {
    const p = this.live;
    if (!p || p.wind <= 0.005) return;
    const wind = p.look.wind,
      unit = frameUnit(width, height),
      seconds = phase / 1000,
      meanSize = (wind.size[0] + wind.size[1]) / 2,
      lifetime = meanSize / Math.max(0.1, wind.speed * 0.1),
      count = Math.min(48, Math.ceil(wind.rate * lifetime * this.fallShare)),
      image = effectImage('wind');
    if (image) this.windSheet = tintSheet(image, wind.color, this.windSheet);
    ctx.save();
    ctx.strokeStyle = wind.color;
    ctx.lineWidth = Math.max(0.6, unit * 0.035);
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const size = wind.size[0] + (wind.size[1] - wind.size[0]) * hash(i, 701),
        life = size / Math.max(0.1, wind.speed * 0.1),
        clock = seconds + hash(i, 702) * life,
        cycle = Math.floor(clock / life),
        age = clock / life - cycle,
        seed = i + cycle * 7919,
        reach = Math.min(width * 0.55, (wind.x[0] + (wind.x[1] - wind.x[0]) * hash(seed, 703)) * size * unit * 0.2),
        x = -reach + age * (width + reach * 2),
        y = hash(seed, 704) * height,
        bend = (wind.y[0] + (wind.y[1] - wind.y[0]) * hash(seed, 705)) * size * unit * 0.2;
      if (image && this.windSheet) {
        const frame = Math.min(39, Math.floor((1 - age) * 40)),
          w = image.naturalWidth / 2,
          h = image.naturalHeight / 20;
        ctx.globalAlpha = p.wind;
        ctx.drawImage(
          this.windSheet.canvas,
          (frame % 2) * w,
          Math.floor(frame / 2) * h,
          w,
          h,
          x - reach,
          y - bend / 2,
          reach,
          bend,
        );
        continue;
      }
      ctx.globalAlpha = p.wind * 0.2 * Math.sin(age * Math.PI) ** 2;
      ctx.beginPath();
      ctx.moveTo(x - reach, y);
      ctx.bezierCurveTo(x - reach * 0.65, y - bend, x - reach * 0.3, y + bend, x, y);
      ctx.stroke();
    }
    ctx.restore();
  }
  // Rotate and tint each frame once; particles only copy the resulting small tile.
  private fallingSprite(kind: FallingSprite, tint: string, angle = 0): HTMLCanvasElement | undefined {
    const image = effectImage('falling');
    if (!image) return undefined;
    const cached = this.fallingSheets[kind],
      key = `${tint}:${angle.toFixed(3)}`;
    if (cached?.color === key) return cached.canvas;
    const [x, y, w, h, cols, rows] = FALLING_SPRITES[kind],
      canvas = cached?.canvas ?? document.createElement('canvas'),
      longest = Math.max(w, h),
      shownW = (FALL_TILE * w) / longest,
      shownH = (FALL_TILE * h) / longest;
    canvas.width = cols * rows * FALL_TILE;
    canvas.height = FALL_TILE;
    const pen = context2d(canvas);
    for (let frame = 0; frame < cols * rows; frame++) {
      pen.save();
      pen.translate((frame + 0.5) * FALL_TILE, FALL_TILE / 2);
      pen.rotate(-angle);
      pen.drawImage(
        image,
        x + (frame % cols) * w,
        y + Math.floor(frame / cols) * h,
        w,
        h,
        -shownW / 2,
        -shownH / 2,
        shownW,
        shownH,
      );
      pen.restore();
    }
    pen.globalCompositeOperation = 'source-in';
    pen.fillStyle = tint;
    pen.fillRect(0, 0, canvas.width, canvas.height);
    this.fallingSheets[kind] = { color: key, canvas };
    return canvas;
  }
  paintPrecipitation(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    phase: number,
    depth: 'front' | 'back',
  ): void {
    const p = this.live;
    if (!p) return;
    // The preset counts suit a card of about 500 × 400; a bigger or smaller card gets as many
    // more or fewer, so the fall is equally dense on any card, its drops and flakes the same
    // size. A tiny card keeps a quarter and a huge one stops at four times.
    const front = depth === 'front',
      area = clamp((width * height) / 200000, 0.25, 4),
      scale = (front ? 0.4 : 0.6) * area,
      unit = frameUnit(width, height),
      angle = this.slant(phase),
      dx = Math.sin(angle),
      dy = Math.cos(angle),
      seconds = phase / 1000,
      spriteBudget = this.lowPower ? 96 : 320;
    // The near and far emission rates decide which layer gets the card's particle budget.
    const countFor = (total: number, near: number, far: number): number =>
      Math.round((total * area * this.fallShare * (front ? near : far / 10)) / (near + far / 10 || 1));
    if (p.rain) {
      if (front || this.gpuSky) this.paintRain(ctx, width, height, phase, front);
      else this.paintFarRain(ctx, width, height, phase);
    }
    if (p.sleet) {
      const [near, far] = p.look.sleet,
        count = countFor(p.sleet, near[0], far[0]),
        speed = (front ? near[1] : far[1]) * unit,
        tint = particleTint(p.light.precipitation.sleet[depth]),
        strip = this.fallingSprite('sleet', tint, angle),
        stride = Math.max(1, Math.ceil(count / spriteBudget));
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const seed = front ? i + 11000 : i + 10000,
          length = (front ? 6 : 4) * (0.7 + hash(seed, 6) * 0.6),
          moved = seconds * speed * (0.65 + hash(seed, 3) * 0.35),
          y = ((hash(seed, 2) * (height + length) + moved * dy) % (height + length)) - length,
          x = wrapX(hash(seed, 1) * (width + 16) + moved * dx, width);
        if (strip && i % stride === 0) {
          const tile = Math.floor(hash(seed, 4) * 4) % 4;
          ctx.drawImage(
            strip,
            tile * FALL_TILE,
            0,
            FALL_TILE,
            FALL_TILE,
            x - length / 2,
            y - length / 2,
            length,
            length,
          );
        } else {
          ctx.moveTo(x, y);
          ctx.lineTo(x - length * dx, y - length * dy);
        }
      }
      ctx.strokeStyle = tint;
      ctx.lineWidth = front ? 1.8 : 1.1;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    if (p.snow) {
      const [near, far] = p.look.snow,
        count = countFor(p.snow, near[0], far[0]),
        [, speed, sizes] = front ? near : far,
        tint = particleTint(p.light.precipitation.snow[depth]),
        strip = this.fallingSprite(front ? 'nearSnow' : 'farSnow', tint),
        stride = Math.max(1, Math.ceil(count / spriteBudget));
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const seed = front ? i + 7000 : i + 3000,
          r = Math.max(0.45, unit * (sizes[0] + (sizes[1] - sizes[0]) * hash(seed, 4))),
          moved = seconds * speed * unit * (0.5 + hash(seed, 3) * 0.5),
          y = ((((hash(seed, 2) * (height + 10) + moved * dy) % (height + 10)) + height + 10) % (height + 10)) - 5,
          drift = (noise(phase / 2600 + seed * 0.37, y / 140, 1048576, 5) - 0.5) * (front ? 44 : 26),
          x = wrapX(hash(seed, 1) * (width + 16) + moved * dx + drift, width);
        if (strip && i % stride === 0) {
          const tile = Math.floor(hash(seed, 6) * 8) % 8;
          ctx.drawImage(strip, tile * FALL_TILE, 0, FALL_TILE, FALL_TILE, x - r, y - r, r * 2, r * 2);
        } else {
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
      }
      ctx.fillStyle = tint;
      ctx.fill();
    }
    if (p.dust) {
      // Dust streams across rather than falling: fine grains, the colour of the air they fill.
      const count = Math.round(p.dust * scale),
        speed = front ? 0.16 : 0.1;
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const seed = front ? i + 11000 : i + 10000,
          size = (front ? 1 : 0.6) + hash(seed, 4) * 0.7;
        const x = (hash(seed, 1) * (width + 8) + phase * speed * (0.7 + hash(seed, 3) * 0.6)) % (width + 8);
        const y = (hash(seed, 2) * height + Math.sin(phase / 1400 + seed) * 7 + height) % height;
        ctx.rect(x - 4, y, size * 2.4, size);
      }
      ctx.fillStyle = front ? '#e0c49cb0' : '#d2b48a70';
      ctx.fill();
    }
    if (p.hail) {
      const count = Math.round(p.hail * scale * this.fallShare),
        [, speed, sizes] = p.look.hail,
        tint = particleTint(p.light.precipitation.hail),
        strip = this.fallingSprite('hail', tint),
        stride = Math.max(1, Math.ceil(count / spriteBudget));
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const seed = front ? i + 9000 : i + 8000,
          r = Math.max(0.6, (sizes[0] + hash(seed, 4) * (sizes[1] - sizes[0])) * unit),
          moved = seconds * speed * unit * (0.5 + 0.5 * hash(seed, 3)),
          fall = hash(seed, 2) * (height + 10) + moved * dy,
          lap = Math.floor(fall / (height + 10)),
          y = (fall % (height + 10)) - 5,
          x = wrapX(((i + hash(seed + lap * 7919, 1)) / count) * (width + 16) + moved * dx, width);
        if (strip && i % stride === 0) {
          const tile = Math.floor(hash(seed, 6) * 9) % 9;
          ctx.drawImage(strip, tile * FALL_TILE, 0, FALL_TILE, FALL_TILE, x - r, y - r, r * 2, r * 2);
        } else {
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
      }
      ctx.fillStyle = tint;
      ctx.fill();
    }
  }
  // Keep the distant rain's large, changing paths off the sky canvas: in Firefox they
  // make subsequent sky drawing much slower. This layer uses the same paths and full
  // device-pixel resolution, then copies them back between the same cloud decks. The
  // context's opacity belongs on each stroke, so the final copy uses full opacity.
  paintFarRain(ctx: CanvasRenderingContext2D, width: number, height: number, phase: number): void {
    this.farRain ??= document.createElement('canvas');
    const image = this.farRain;
    if (image.width !== ctx.canvas.width || image.height !== ctx.canvas.height) {
      image.width = ctx.canvas.width;
      image.height = ctx.canvas.height;
    }
    const pen = context2d(image);
    pen.setTransform(1, 0, 0, 1, 0, 0);
    pen.clearRect(0, 0, image.width, image.height);
    pen.setTransform(ctx.getTransform());
    pen.globalAlpha = ctx.globalAlpha;
    pen.lineCap = ctx.lineCap;
    this.paintRain(pen, width, height, phase, false);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(image, 0, 0);
    ctx.restore();
  }
  // Rain as the preset gives it (see RainFall), in scene units on the frame, so it falls the
  // same on any card, only larger or smaller. Each drop slot spawns a drop once every `life`
  // seconds, at a time of its own, from a line across the sky upwind of the frame, and the
  // drop falls straight on at its own speed until its life is out: off the bottom, or
  // partway down for the slow far drops of a short-lived storm. The fall's angle is the
  // preset's, swaying, as it was when the drop set off, leaning right (the card has no wind
  // direction) and further with the wind. The near layer is a few units in front of the
  // frame and the far one 30 behind it, seen from 100 units away, so far drops are smaller,
  // slower and closer together. A streak is as wide as its drop at its head, narrower behind,
  // and about eleven times as long, soft across, brightening over its first 60% and holding
  // to its leading end, where it stops short.
  paintRain(ctx: CanvasRenderingContext2D, width: number, height: number, phase: number, front: boolean): void {
    const preset = this.rainPreset,
      amount = this.live?.rain ?? 0;
    if (!preset || amount === 0) return;
    const fall = preset.look.rainFall;
    const [rate, speed, [thin, thick], , spread] = front ? fall.front : fall.back,
      [start, end] = front ? preset.light.precipitation.rain.front : preset.light.precipitation.rain.back,
      alpha0 = colorAlpha(start),
      alpha1 = colorAlpha(end),
      density = clamp(amount / preset.rain),
      count = Math.round(rate * fall.life * density * this.fallShare),
      unit = frameUnit(width, height),
      seconds = phase / 1000,
      [sway, swaying] = fall.sway,
      slowest = front ? 0.7 : 0.6,
      // Streak lengths as seen: about 2.8 times the drop sizes' own length ranges.
      [shortest, longest] = front ? [3.75 * 2.8, 4.25 * 2.8] : [3.15 * 2.8, 3.75 * 2.8],
      depth = front ? -4.5 : -30,
      sprite = front ? this.rainStreak(start, end) : null,
      // Distant streaks batch by the same random fraction for tint and opacity.
      palette = front
        ? []
        : Array.from({ length: FAR_BANDS }, (_, band) => {
            const share = (band + 0.5) / FAR_BANDS;
            return { rgb: rgb(mix(start, end, share)), alpha: (alpha0 + (alpha1 - alpha0) * share) * 0.33 };
          }),
      bands = FAR_BANDS,
      parts = FAR_PIECES,
      base = ctx.getTransform(),
      baseAlpha = ctx.globalAlpha,
      gpu = this.gpuSky,
      // The large changing paths stall sky export in this engine. Other engines
      // rasterize them efficiently and pay more for the extra tile copies.
      tiled = navigator.userAgent.includes('Firefox/') && TILED_RAIN.has(preset.kind),
      wide = ((thin + thick) / 2) * unit * 0.77,
      paths =
        sprite || gpu
          ? []
          : Array.from({ length: bands * parts.length }, (_, index) => {
              const [, , , swell] = parts[index % parts.length] ?? parts[0];
              return tiled
                ? new RainPath(base, ctx.canvas.width, ctx.canvas.height, Math.max(0.5, wide * swell))
                : new Path2D();
            });
    if (!count || Math.max(alpha0, alpha1) < 0.005) return;
    if (gpu) gpu.layer(ctx);
    if (gpu && !front) {
      for (const [index, batch] of gpu.gpu.batches.entries()) {
        const color = palette[Math.floor(index / parts.length)];
        if (!color) continue;
        const [, , shade] = parts[index % parts.length] ?? parts[0];
        batch.opacity = color.alpha * shade * ctx.globalAlpha;
        batch.tint = [color.rgb[0] / 255, color.rgb[1] / 255, color.rgb[2] / 255];
      }
    }
    const layer = front ? 'front' : 'back';
    let field = this.rainFields[layer];
    if (field?.fall !== fall || field.width !== width || field.height !== height || field.angle !== preset.windAngle) {
      field = { fall, width, height, angle: preset.windAngle, drops: [] };
      this.rainFields[layer] = field;
    }
    ctx.save();
    for (let i = 0; i < count; i++) {
      let cached = field.drops[i];
      const slot = front ? i + 20000 : i,
        lag = cached?.lag ?? hash(slot, 1) * fall.life,
        cycle = Math.floor((seconds + lag) / fall.life),
        age = seconds + lag - cycle * fall.life;
      if (!cached || cached.cycle !== cycle) {
        const drop = slot + cycle * 104729,
          // The same launch time for every frame of this drop's life.
          lean = preset.windAngle - (sway * Math.sin(swaying * (cycle * fall.life - lag)) * Math.PI) / 180,
          turn = lean + ((hash(drop, 2) * 2 - 1) * spread * Math.PI) / 180,
          k = 100 / (100 - depth - (hash(drop, 3) * 2 - 1) * 4),
          across = (hash(drop, 4) * 2 - 1) * 30,
          length = shortest * thin + (longest * thick - shortest * thin) * hash(drop, 6);
        cached = {
          lag,
          cycle,
          dx: Math.sin(turn),
          dy: Math.cos(turn),
          turn,
          x: -fall.offset * Math.sin(lean) + across * Math.cos(lean),
          y: -fall.offset * Math.cos(lean) - across * Math.sin(lean),
          projection: k * unit,
          speed: speed * (slowest + (1 - slowest) * hash(drop, 5)),
          reach: k * unit * length,
          size: (thin + (thick - thin) * hash(drop, 7)) * k * unit,
          tintShare: hash(drop, 8),
          frame: front ? Math.min(RAIN_FRAMES - 1, Math.floor(hash(drop, 9) * RAIN_FRAMES)) : 0,
        };
        field.drops[i] = cached;
      }
      // Head on the card: from the line `offset` upwind of the centre, `across` along it.
      const { dx, dy, turn, reach, size, tintShare } = cached,
        travel = cached.speed * age,
        hx = width / 2 + cached.projection * (cached.x + travel * dx),
        hy = height / 2 + cached.projection * (cached.y + travel * dy),
        tx = hx - dx * reach,
        ty = hy - dy * reach;
      if ((hy < 0 && ty < 0) || (hy > height && ty > height) || (hx < 0 && tx < 0) || (hx > width && tx > width))
        continue;
      if (sprite) {
        const alpha = (alpha0 + (alpha1 - alpha0) * tintShare) * baseAlpha,
          color = Math.round(tintShare * (RAIN_TINTS - 1)),
          cell = color * sprite.frames + (sprite.frames === 1 ? 0 : cached.frame);
        if (gpu) {
          const scale = gpu.scale;
          gpu.gpu.batches[0]?.quad(
            (hx - (dx * reach) / 2) * scale,
            (hy - (dy * reach) / 2) * scale,
            dx,
            dy,
            reach * scale,
            size * scale,
            alpha,
            cell,
          );
          continue;
        }
        // Near drops: the soft streak, turned to the fall, head at the drop.
        ctx.setTransform(base);
        ctx.translate(hx, hy);
        ctx.rotate(-turn);
        ctx.globalAlpha = alpha;
        ctx.drawImage(
          sprite.canvas,
          cell * sprite.cellWidth,
          0,
          sprite.cellWidth,
          sprite.canvas.height,
          -size,
          -reach,
          size * 2,
          reach,
        );
        continue;
      }
      // Far drops, too many for a sprite each: lines in three lengths of rising opacity.
      const band = Math.min(bands - 1, Math.floor(tintShare * bands));
      parts.forEach(([from, to], part) => {
        const path = paths[band * parts.length + part];
        const ax = tx + dx * reach * from,
          ay = ty + dy * reach * from,
          bx = tx + dx * reach * to,
          by = ty + dy * reach * to;
        if (gpu) {
          const batch = gpu.gpu.batches[band * parts.length + part],
            [, , , swell] = parts[part] ?? parts[0],
            scale = gpu.scale;
          if (batch) {
            batch.quad(
              ((ax + bx) / 2) * scale,
              ((ay + by) / 2) * scale,
              dx,
              dy,
              reach * (to - from) * scale,
              (Math.max(0.5, wide * swell) * scale) / 2,
              1,
              ctx.lineCap === 'round',
            );
          }
        } else if (path instanceof RainPath) path.line(ax, ay, bx, by);
        else {
          path?.moveTo(ax, ay);
          path?.lineTo(bx, by);
        }
      });
    }
    ctx.restore();
    if (gpu) {
      gpu.gpu.draw(gpu.color, sprite?.canvas ?? null, sprite ? sprite.frames * RAIN_TINTS : 1);
      return;
    }
    if (sprite) return;
    // Each path shares its width, color and opacity across distant drops.
    ctx.save();
    paths.forEach((path, index) => {
      const color = palette[Math.floor(index / parts.length)];
      if (!color) return;
      const [, , shade, swell] = parts[index % parts.length] ?? parts[0];
      ctx.strokeStyle = `rgba(${color.rgb.join(',')},${color.alpha * shade})`;
      if (path instanceof RainPath) {
        this.rainTile ??= document.createElement('canvas');
        path.stroke(ctx, this.rainTile);
      } else {
        ctx.lineWidth = Math.max(0.5, wide * swell);
        ctx.stroke(path);
      }
    });
    ctx.restore();
  }
  // Bake the tint ramp once per lighting change. The same colored silhouettes feed Canvas and WebGL.
  private rainStreak(start: string, end: string) {
    const art = effectImage('rain'),
      frames = art ? RAIN_FRAMES : 1,
      key = `${start}:${end}:${frames}`;
    if (this.streak?.key === key) return this.streak;
    const mask = document.createElement('canvas');
    mask.width = art?.naturalWidth ?? 32;
    mask.height = art?.naturalHeight ?? 256;
    const pen = context2d(mask);
    if (art) {
      pen.drawImage(art, 0, 0);
    } else {
      // A soft procedural streak for builds without the optional rain artwork.
      const image = pen.createImageData(mask.width, mask.height);
      for (let y = 0; y < mask.height; y++) {
        const t = (y + 0.5) / mask.height,
          along = 0.55 * (t < 0.62 ? (0.9 * t) / 0.62 : t < 0.95 ? 0.9 + (0.1 * (t - 0.62)) / 0.33 : (1 - t) / 0.05),
          taper = t < 0.6 ? 0.6 : Math.min(1, 0.6 + (0.4 * (t - 0.6)) / 0.35);
        for (let x = 0; x < mask.width; x++) {
          const off = (x + 0.5 - mask.width / 2) / ((mask.width / 4) * taper);
          image.data[(y * mask.width + x) * 4 + 3] = Math.round(255 * along * Math.exp(-Math.LN2 * off * off));
        }
      }
      pen.putImageData(image, 0, 0);
    }
    const canvas = document.createElement('canvas');
    canvas.width = mask.width * RAIN_TINTS;
    canvas.height = mask.height;
    const colors = context2d(canvas);
    pen.globalCompositeOperation = 'source-in';
    for (let band = 0; band < RAIN_TINTS; band++) {
      pen.fillStyle = mix(start, end, band / (RAIN_TINTS - 1));
      pen.fillRect(0, 0, mask.width, mask.height);
      colors.drawImage(mask, band * mask.width, 0);
    }
    this.streak = { canvas, key, cellWidth: mask.width / frames, frames };
    return this.streak;
  }
  // Collisions on the panels' top edges (snow settles in front of the glass; see
  // paintSettledSnow). Rain only reaches the edges no other panel shelters: the first row,
  // and any panel with open sky above it. The near rain reaches an edge as often as its
  // share of the rain's 60-unit width, and with the preset's odds a drop that does
  // splashes: three to eight droplets kick up within 70° of straight up at the preset's
  // speed, fall back under gravity (20 units a second each second), and most come to rest
  // on the edge as beads (one in seven is lost), shrinking and fading out over their life.
  // Hail bounces instead. Every hit is seeded by its moment, so each frame agrees.
  paintImpacts(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    phase: number,
    covered: readonly Panel[],
  ): void {
    const p = this.live,
      preset = this.preset;
    if (!p || !preset || !phase) return;
    const open = covered.filter(
      panel =>
        !covered.some(
          other =>
            other !== panel &&
            other.y + other.height <= panel.y + 1 &&
            other.x < panel.x + panel.width &&
            other.x + other.width > panel.x,
        ),
    );
    if (preset.look.collision === 'rain' && (p.rain || p.sleet)) this.paintSplashes(ctx, width, height, phase, open);
    if (preset.look.collision !== 'hail' || !p.hail) return;
    for (const [index, rect] of open.entries()) {
      const inset = Math.min(rect.radius ?? 0, rect.width / 2),
        span = rect.width - inset * 2,
        top = rect.y;
      if (span <= 0) continue;
      const slots = Math.round((span / 9) * clamp(p.hail / 220, 0.25, 1.6));
      for (let slot = 0; slot < slots; slot++) {
        const seed = index * 997 + slot,
          period = 520 + hash(seed, 1) * 900,
          shifted = phase + hash(seed, 2) * period,
          cycle = Math.floor(shifted / period),
          age = shifted - cycle * period;
        if (age >= 520) continue;
        // A pellet bounces up and sideways and fades.
        const x = rect.x + inset + hash(seed * 31 + cycle, 3) * span,
          t = age / 520,
          dx = (hash(seed + cycle, 5) - 0.5) * 22 * t,
          dy = -28 * t + 30 * t * t;
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = '#f2f8ff';
        ctx.beginPath();
        ctx.arc(x + dx, top + dy - 1.5, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  paintSplashes(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    phase: number,
    edges: readonly Panel[],
  ): void {
    const p = this.live,
      look = this.preset?.look;
    if (!p || !look) return;
    const { odds, size, life, speed } = look.splash,
      unit = frameUnit(width, height),
      seconds = phase / 1000,
      density = clamp((p.rain + p.sleet) / ((this.preset?.rain ?? 0) + (this.preset?.sleet ?? 0) || 1)),
      // Hits a second on each pixel of edge.
      rate = (look.rainFall.front[0] * density * odds * this.fallShare) / (60 * unit),
      bin = 0.05,
      bands = 4,
      brightest = 0.49,
      paths = Array.from({ length: bands }, () => new Path2D());
    // A curve through (time, value) keys, as a share of a droplet's life.
    const along = (keys: readonly (readonly [number, number])[], t: number): number => {
      const next = keys.findIndex(([at]) => at > t),
        [t0, v0] = keys[Math.max(0, next - 1)] ?? [0, 0],
        [t1, v1] = keys[next] ?? keys.at(-1) ?? [1, 0];
      return next < 0 ? v1 : v0 + ((v1 - v0) * (t - t0)) / (t1 - t0 || 1);
    };
    for (const [index, rect] of edges.entries()) {
      const inset = Math.min(rect.radius ?? 0, rect.width / 2),
        span = rect.width - inset * 2,
        perBin = rate * span * bin;
      if (span <= 0 || perBin <= 0) continue;
      const seed = Math.round(rect.x * 7 + rect.width * 13) + index * 7919;
      for (let b = Math.floor((seconds - life[1]) / bin); b <= Math.floor(seconds / bin); b++) {
        const hits = Math.floor(perBin) + (hash(b, seed) < perBin % 1 ? 1 : 0);
        for (let h = 0; h < hits; h++) {
          const hit = b * 64 + h + seed * 104729,
            when = (b + hash(hit, 1)) * bin,
            x0 = rect.x + inset + hash(hit, 2) * span,
            drops = 3 + Math.floor(hash(hit, 3) * 6);
          for (let d = 0; d < drops; d++) {
            const drop = hit * 11 + d,
              lifetime = life[0] + (life[1] - life[0]) * hash(drop, 4),
              age = seconds - when;
            if (age < 0 || age > lifetime) continue;
            const v = speed[0] + (speed[1] - speed[0]) * hash(drop, 5),
              tilt = (hash(drop, 6) * (70 * Math.PI)) / 180,
              vx = v * Math.sin(tilt) * Math.cos(hash(drop, 7) * Math.PI * 2),
              vy = v * Math.cos(tilt),
              landed = (2 * vy) / 20;
            let x = x0,
              y = rect.y;
            if (age < landed) {
              x += vx * age * unit;
              y -= (vy * age - 10 * age * age) * unit;
            } else {
              // Back on the edge: one in seven is lost, as is any that misses it.
              x += vx * landed * unit;
              if (hash(drop, 8) < 0.15 || x < rect.x + inset || x > rect.x + inset + span) continue;
            }
            const t = age / lifetime,
              alpha =
                (0.25 + 0.24 * hash(drop, 9)) *
                along(
                  [
                    [0, 0.906],
                    [0.338, 0.754],
                    [0.738, 0.293],
                    [1, 0],
                  ],
                  t,
                ),
              // A droplet is a soft dot; a solid one this size gives off as much light.
              radius =
                0.28 *
                (size[0] + (size[1] - size[0]) * hash(drop, 10)) *
                unit *
                along(
                  [
                    [0, 0.859],
                    [0.445, 0.733],
                    [1, 0.286],
                  ],
                  t,
                );
            const path = paths[Math.min(bands - 1, Math.floor((alpha / brightest) * bands))];
            path?.moveTo(x + radius, y - radius);
            path?.arc(x, y - radius, radius, 0, Math.PI * 2);
          }
        }
      }
    }
    ctx.save();
    paths.forEach((path, band) => {
      ctx.fillStyle = `rgba(255,255,255,${(((band + 0.5) / bands) * brightest).toFixed(3)})`;
      ctx.fill(path);
    });
    ctx.restore();
  }
  // Large, nearby drops and flakes cross the full scene before the glass and screen flash.
  paintNearParticles(ctx: CanvasRenderingContext2D, width: number, height: number, phase: number): void {
    const p = this.live;
    if (!p) return;
    const near = p.look.near,
      unit = frameUnit(width, height),
      total = Math.round(near.rate * near.life * this.fallShare),
      sheet = effectImage('near'),
      frame = Math.max(0, Math.min(7, near.image)),
      [start, end] = p.light.air.near,
      alpha = colorAlpha(start),
      range = colorAlpha(end) - alpha,
      tint = mix(start, end, 0.5),
      t = phase / 1000,
      [strength, frequency] = near.noise;
    if (sheet) this.nearSheet = tintSheet(sheet, tint, this.nearSheet);
    ctx.save();
    ctx.fillStyle = tint;
    for (let i = 0; i < total; i++) {
      const clock = t + hash(i, 81) * near.life,
        lap = Math.floor(clock / near.life),
        age = clock - lap * near.life,
        seed = i + lap * 7919,
        angle = p.windAngle + ((hash(seed, 82) * 2 - 1) * near.spread * Math.PI) / 180,
        dx = Math.sin(angle),
        dy = Math.cos(angle),
        distance =
          age * near.speed * unit * (0.5 + hash(seed, 83) * 0.5) - (Math.abs(dx) * width + Math.abs(dy) * height) / 2,
        across = (hash(seed, 84) - 0.5) * (Math.abs(dy) * width + Math.abs(dx) * height),
        size = Math.max(0.5, (near.size[0] + (near.size[1] - near.size[0]) * hash(seed, 85)) * unit),
        drift = strength * unit * 0.2 * Math.sin(age * frequency + hash(seed, 86) * Math.PI * 2),
        x = width / 2 + distance * dx + (across + drift) * dy,
        y = height / 2 + distance * dy - (across + drift) * dx;
      if (x < -size || y < -size || x > width + size || y > height + size) continue;
      ctx.globalAlpha = alpha + hash(seed, 87) * range;
      if (sheet && this.nearSheet) {
        const w = sheet.naturalWidth / 2,
          h = sheet.naturalHeight / 4,
          spin = near.spin[0] + (near.spin[1] - near.spin[0]) * hash(seed, 88);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle + (spin * age * Math.PI) / 180);
        ctx.drawImage(
          this.nearSheet.canvas,
          (frame % 2) * w,
          Math.floor(frame / 2) * h,
          w,
          h,
          -size / 2,
          -size / 2,
          size,
          size,
        );
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.ellipse(x, y, size * 0.4, size * (frame === 1 ? 1.5 : 0.5), -angle, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  // Lightning: the first strike 1.5 s in, then one every 6–9 seconds (the preset's
  // interval, drawn afresh each time, seeded so every frame agrees). A strike's bolt grows,
  // flashes and fades (its grow, flash and fade times). With the preset's odds it also
  // whitens the whole sky: faintly while the bolt
  // grows, to its full brightness (somewhere in the preset's range) the moment it lands,
  // held while it flashes, then evenly away over the screen flash's own fade.
  strike(phase: number): Strike | null {
    const p = this.preset;
    if (!p) return null;
    const L = p.strikes,
      [low, high] = L.strikeInterval;
    let clock = this.strikeClock;
    if (!clock || clock.last > phase) clock = { index: 0, at: 1500, last: phase };
    for (;;) {
      const next: number = clock.at + (low + (high - low) * hash(clock.index, 1)) * 1000;
      if (next > phase) break;
      clock = { index: clock.index + 1, at: next, last: phase };
    }
    this.strikeClock = clock;
    clock.last = phase;
    const grow = L.growAmount * 1000,
      flash = L.flashAmount * 1000,
      fade = L.fadeAmount * 1000,
      whiten = L.screenFlashFadeLength * 1000,
      age = phase - clock.at;
    if (age < 0 || age > grow + flash + Math.max(fade, whiten)) return null;
    // Bolts reach further out on a wide card than on a tall one.
    const reach = L.reach,
      key = `${clock.index}:${reach}`;
    if (this.bolt?.key !== key)
      this.bolt = {
        key,
        lines: lightningBolt(clock.index * 7919 + 3, {
          reach,
          roughness: L.roughness,
          branches: L.branchCount,
          spread: L.branchSpread,
        }),
      };
    const lines = this.bolt.lines,
      window = clock.index;
    const [dim, bright] = L.screenFlashBrightness,
      peak = hash(window, 4) < L.screenFlashProbability ? dim + (bright - dim) * hash(window, 5) : 0,
      screen =
        age <= grow
          ? 0.05 * peak * (age / grow)
          : age <= grow + flash
            ? peak
            : peak * clamp(1 - (age - grow - flash) / whiten);
    return {
      bolt: lines,
      age: age / (grow + flash + fade),
      screen,
    };
  }
  // The light flickering behind a storm's clouds (see cloudFlash), as a white glow to lay
  // over the clouds alone. It sits far behind them, so it shows nearer the middle of the
  // card than its place in the sky: at 0.45 of its offset (the depth and falloff are
  // estimates). Its brightness follows the flicker and the preset's own strength, as light
  // added to the clouds.
  cloudFlicker(ctx: CanvasRenderingContext2D, phase: number, width: number, height: number): CanvasGradient | null {
    const L = this.preset?.strikes,
      light = L && cloudFlash(phase / 1000, L.cloudFlashProbability);
    if (!L || !light) return null;
    const strength = clamp(light.value / 2) * Math.min(1, L.cloudFlashBrightness / 100000);
    if (strength < 0.005) return null;
    const unit = frameUnit(width, height),
      x = width / 2 + light.x * 0.45 * unit,
      y = height / 2 - light.y * 0.45 * unit,
      glow = ctx.createRadialGradient(x, y, 0, x, y, 18 * unit);
    glow.addColorStop(0, `rgba(255,255,255,${strength})`);
    glow.addColorStop(0.35, `rgba(255,255,255,${strength * 0.55})`);
    glow.addColorStop(0.7, `rgba(255,255,255,${strength * 0.18})`);
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    return glow;
  }
  // The bolt is a plain white ribbon through its points, as wide at each as the strike's
  // time gives it. While it grows, the leader runs down from the top to the foot,
  // tapering to a needle tip, and each branch grows from the channel once the leader has
  // passed it, reaching its tip as the leader lands. Then the whole channel flashes at the
  // preset's flash width, untapered, and thins away to nothing; the branches thin away
  // sooner (see branchFadeAmount). Widths are in scene units, so the bolt grows with the card.
  // The bolt is brighter than white (the preset's glow), which a canvas can't show; on a
  // hairline that light goes into width instead, so the line stays a bright pixel wide to
  // the end of its fade rather than greying out as it thins below one.
  paintBolt(ctx: CanvasRenderingContext2D, width: number, height: number, strike: Strike): void {
    const L = this.preset?.strikes;
    if (!L || strike.age > 1) return;
    const total = L.growAmount + L.flashAmount + L.fadeAmount,
      grown = L.growAmount / total,
      flashed = (L.growAmount + L.flashAmount) / total,
      age = strike.age,
      unit = frameUnit(width, height),
      thick = L.thickness * unit,
      wide = thick * L.flashThickness,
      pixel = 1 / (ctx.getTransform().a || 1),
      shown = (size: number) => (size > 0 ? Math.max(size, Math.min(size * L.glow, pixel)) : 0);
    const widthAt = (index: number, start: number): number => {
      const taper = 1 - index / BOLT_POINTS;
      if (age < grown) return age > grown * (start + (1 - start) * (index / BOLT_POINTS)) ? thick * taper : 0;
      if (!start) return age <= flashed ? wide : wide * (1 - (age - flashed) / (1 - flashed));
      return thick * taper * (1 - clamp((age - grown) / (L.growAmount + L.branchFadeAmount - grown)));
    };
    ctx.save();
    ctx.fillStyle = '#fff';
    for (const { points, start } of strike.bolt) {
      const at = points.map(([x, y]): [number, number] => [width / 2 + x * unit, height / 2 - y * unit]),
        sizes = at.map((_, index) => shown(widthAt(index, start)) / 2);
      if (!sizes.some(Boolean)) continue;
      // Each side of the ribbon, offset square to the line through its neighbours.
      const left: [number, number][] = [],
        right: [number, number][] = [];
      at.forEach(([x, y], index) => {
        const [ax, ay] = at[Math.max(0, index - 1)] ?? [x, y],
          [bx, by] = at[Math.min(at.length - 1, index + 1)] ?? [x, y],
          length = Math.hypot(bx - ax, by - ay) || 1,
          half = sizes[index] ?? 0,
          nx = (-(by - ay) / length) * half,
          ny = ((bx - ax) / length) * half;
        left.push([x + nx, y + ny]);
        right.push([x - nx, y - ny]);
      });
      ctx.beginPath();
      for (const [x, y] of left) ctx.lineTo(x, y);
      for (const [x, y] of right.reverse()) ctx.lineTo(x, y);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  paintFog(ctx: CanvasRenderingContext2D, height: number): void {
    const p = this.preset,
      live = this.live;
    if (!p || !live) return;
    // A soft haze rising from below; no textured strips, whose edges showed as lines.
    // Fog takes the cloud light, so it is pale by day and dim at night.
    const [fr, fg, fb] = rgb(this.cloudLight);
    ctx.globalAlpha = live.fog;
    this.bands(ctx, 'fog', height * 0.45, height, [
      [0, `rgba(${fr},${fg},${fb},0)`],
      [1, `rgba(${fr},${fg},${fb},${p.night ? 0.45 : 0.67})`],
    ]);
    ctx.globalAlpha = 1;
  }
}
