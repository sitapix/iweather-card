import {
  ATLAS_WIDTH,
  BLANKETS,
  BLANKET_HEIGHT,
  BLANKET_WIDTH,
  CLOUD_SPRITES,
  PLANE_HEIGHT,
  type SpriteRect,
  spriteRect,
} from './clouds.ts';
import type { CloudFamily, Range } from './presets-data.ts';
import { context2d, hash } from '../lib/canvas.ts';

// Clouds are particles on four decks, back to front. Each preset deck is [family,
// count, scale range, height, velocity range] in scene units: the camera sees a
// frame about 48 units tall, centred on height 0, so a deck at height 23 sits at
// the top of the sky. Clouds here keep those proportions on any card.
export const FRAME = 48;
// Past this many times as wide as tall, a card stops zooming into the frame (see frameUnit).
const WIDEST = 2.5;
// Pixels per scene unit on a card `width` × `height`. The frame is square and spans the
// card's longer side, centred: a tall card crops its sides, a wide one its top and bottom,
// so on a wide card the highest clouds are cut off above and the rest rise and grow with
// the width. A strip wider than WIDEST keeps that zoom, so it still shows the decks' middle.
// Sizes and places share it.
export const frameUnit = (width: number, height: number): number =>
  Math.max(height, Math.min(width, height * WIDEST)) / FRAME;
// Where height `y` of the frame (a share of it, 0 at the top) falls on a card `height` tall.
export const frameY = (y: number, height: number, unit: number): number => height / 2 + (y - 0.5) * FRAME * unit;
export const DECK_COUNT = 4;
// A deck as presets give it. The emitter extent (x, y, z) is optional, and so are `thin`, a share
// of its clouds' opacity, and `tall`, how many times its sprites are drawn taller than baked: the
// bake squeezes a sprite's height, and a sky of soft mottling wants its puffs rounder than that.
export type CloudDeck = readonly [
  family: CloudFamily,
  count: number,
  scale: Range,
  height: number,
  velocity: Range,
  emitter?: readonly [x: number, y: number, z: number],
  thin?: number,
  tall?: number,
];
export interface DeckCloud {
  family: CloudFamily;
  sprite: number;
  x: number;
  y: number;
  scale: number;
  speed: number;
  flip: boolean;
  alpha: number;
  tall: number;
}
// A light colour (0–255 per channel) and its intensity.
export type Tint = readonly [red: number, green: number, blue: number, intensity: number];
export type Direction = readonly [x: number, y: number, z: number];
const lerp = ([a, b]: Range, t: number) => a + (b - a) * t;
const pool = (family: string): number[] => {
  const sprites = CLOUD_SPRITES.map(([name], sprite) => (name === family ? sprite : -1)).filter(sprite => sprite >= 0);
  return sprites.length ? sprites : pool('altostratus');
};
// Where each deck's clouds sit, seeded so a sky looks the same on every load:
// `y` (centre, share of the height), `scale` (width, share of the height) and
// `speed` (scene units per second).
// With `storm`, large cumulus are drawn from the dense heaps rather than the bright
// fair-weather ones.
export function deckClouds(
  decks: readonly (CloudDeck | null)[],
  seed = 1,
  { storm = false } = {},
): (DeckCloud[] | null)[] {
  return decks.map((deck, index) => {
    if (!deck) return null;
    // Each deck's clouds spawn through an emitter volume: its height spreads
    // them up and down, and its depth (toward or away from a camera 100 units off)
    // makes nearer clouds larger and set lower.
    const [family, count, scale, height, velocity, [, spreadY, spreadZ] = [0, 4, 0], thin = 1, tall = 1] = deck,
      sprites = pool(storm && family === 'cumulus' && scale[1] >= 10 ? 'heap' : family);
    return Array.from({ length: count }, (_, i) => {
      const r = (n: number) => hash(seed * 97 + index * 13 + i, n),
        depth = 100 / (100 - (r(8) - 0.5) * spreadZ);
      // Spaced along the deck with a random gap each, so clouds never travel as an even row
      // of pairs; each sits at its own height within the emitter.
      return {
        family,
        sprite: sprites[Math.floor(r(1) * sprites.length)] ?? 0,
        x: (i + r(2) * 0.85) / count,
        y: 0.5 - ((height + (r(3) - 0.5) * Math.max(spreadY, 6)) * depth) / FRAME,
        scale: (lerp(scale, r(4)) * depth) / FRAME,
        speed: lerp(velocity, r(5)),
        flip: r(6) < 0.5,
        // Crowded decks are made of thinner clouds, so gaps survive the overlap.
        alpha: (0.8 + r(7) * 0.2) * Math.min(1, 5 / count) * thin,
        tall,
      };
    });
  });
}

// The atlas index of the blanket for a preset's blanket family: storm heaps for the
// cumulonimbus ('nimbus') blanket, the fullest of the cirrus singles stretched across the sky
// for a cirrus veil, and the stratus lid otherwise. The singles have the blankets' proportions.
const VEIL_SEED = 8;
const VEIL = CLOUD_SPRITES.findIndex(([kind, seed]) => kind === 'cirrus' && seed === VEIL_SEED);
export const blanketSprite = (family: string | undefined): number =>
  family === 'cirrus' && VEIL >= 0
    ? VEIL
    : CLOUD_SPRITES.length +
      Math.max(
        0,
        BLANKETS.findIndex(([name]) => name === (family === 'nimbus' ? 'stormBlanket' : 'stratusBlanket')),
      );

// An image decoded off the main thread: the browser decodes a Blob's bytes in the
// background, where drawing an <img> into a canvas, or making a bitmap of one, decoded
// the atlas on the main thread, some 50 ms as the card loaded.
export async function decode(url: string): Promise<ImageBitmap> {
  return createImageBitmap(await (await fetch(url)).blob());
}
// The 2D drawing takes the maps at this share of their baked size: the GPU's copy takes a byte a
// pixel, and a decoded image four, so at full size the 2D atlas would take four times as much.
export const FALLBACK_SCALE = 0.5;
const MAPS = 7,
  COVERAGE = 6,
  FAINTEST = 2;
// The decoded atlas: the maps stacked at FALLBACK_SCALE, the coverage as alpha, and two
// scratch canvases.
interface Planes {
  source: HTMLCanvasElement;
  mask: HTMLCanvasElement;
  grey: HTMLCanvasElement;
  term: HTMLCanvasElement;
  plane: number;
}
// A sprite's place in the 2D atlas.
const scaled = ({ left, top, width, height }: SpriteRect): SpriteRect => ({
  left: left * FALLBACK_SCALE,
  top: top * FALLBACK_SCALE,
  width: width * FALLBACK_SCALE,
  height: height * FALLBACK_SCALE,
});

// The cloud maps, seven grey images (scripts/clouds.ts), each a grid of every sprite: the light
// from +x, −x, +y, −y, +z and −z, then coverage. The GPU painter copies them itself (see
// clouds-gl.ts); this decodes them for the 2D drawing only when that is needed, and `lit()`
// relights one sprite there, cached by light bucket. `ready` settles once either can draw.
export class CloudAtlas {
  // Lit sprites kept, most recently used last. A sky draws from a few dozen; the
  // card raises the limit when many skies animate at once, or they evict each other.
  cache = new Map<string, HTMLCanvasElement>();
  limit = 160;
  ready: Promise<boolean>;
  readonly urls: readonly string[];
  private planes: Planes | null = null;
  private released: boolean;
  private settle: (drawable: boolean) => void = () => {};
  // `now` decodes the maps for the 2D drawing at once; without it they wait for restore().
  constructor(urls: readonly string[], { now = true } = {}) {
    this.urls = urls;
    this.released = !now;
    this.ready = new Promise(resolve => {
      this.settle = resolve;
    });
    if (now) void this.load().then(this.settle);
  }
  private async load(): Promise<boolean> {
    if (typeof createImageBitmap === 'undefined' || this.urls.length !== MAPS) return false;
    try {
      const width = ATLAS_WIDTH * FALLBACK_SCALE,
        plane = PLANE_HEIGHT * FALLBACK_SCALE,
        source = document.createElement('canvas');
      source.width = width;
      source.height = plane * MAPS;
      const stack = context2d(source);
      for (const [k, url] of this.urls.entries()) {
        const map = await decode(url);
        stack.drawImage(map, 0, k * plane, width, plane);
        map.close();
      }
      // Coverage turned into alpha once, so relighting can mask with it.
      const mask = document.createElement('canvas');
      mask.width = width;
      mask.height = plane;
      const m = context2d(mask, { willReadFrequently: true });
      m.drawImage(source, 0, COVERAGE * plane, width, plane, 0, 0, width, plane);
      const pixels = m.getImageData(0, 0, width, plane),
        D = pixels.data;
      for (let i = 0; i < D.length; i += 4) {
        const value = D[i] ?? 0;
        D[i + 3] = value < FAINTEST ? 0 : value;
        D[i] = D[i + 1] = D[i + 2] = 255;
      }
      m.putImageData(pixels, 0, 0);
      const grey = document.createElement('canvas'),
        term = document.createElement('canvas');
      for (const c of [grey, term]) {
        c.width = BLANKET_WIDTH * FALLBACK_SCALE;
        c.height = BLANKET_HEIGHT * FALLBACK_SCALE;
      }
      if (this.released) return false;
      this.planes = { source, mask, grey, term, plane };
      return true;
    } catch {
      return false;
    }
  }
  get loaded() {
    return Boolean(this.planes);
  }
  // The GPU painter can draw: the 2D maps aren't needed (see clouds-gl.ts).
  drawable() {
    this.settle(true);
  }
  // Lets the 2D maps go once the GPU holds its own copy.
  release() {
    this.planes = null;
    this.released = true;
    this.cache.clear();
  }
  // Decodes the maps for the 2D drawing, when the GPU can't take them or loses them.
  restore() {
    if (!this.released) return;
    this.released = false;
    const loading = this.load();
    void loading.then(this.settle);
    this.ready = loading;
  }
  // `light` is [x, y, z]: y up, z toward the viewer. Directions snap to 16
  // headings and four depths so drifting clouds reuse a handful of images.
  // Two lit images for the nearest cached headings either side of the light, with
  // weights that sum to one, so a drifting cloud's shading never steps.
  litBlend(
    sprite: number,
    flip: boolean,
    light: Direction,
    sun: Tint,
    ambient: Tint,
  ): [image: HTMLCanvasElement, weight: number][] | null {
    const step = Math.PI / 8,
      angle = Math.atan2(light[1], flip ? -light[0] : light[0]) / step,
      low = Math.floor(angle),
      t = angle - low;
    const depth = light[2] * 3,
      dLow = Math.floor(depth),
      u = depth - dLow,
      out: [HTMLCanvasElement, number][] = [];
    for (const [k, wk] of [
      [low, 1 - t],
      [low + 1, t],
    ] as const)
      for (const [d, wd] of [
        [dLow, 1 - u],
        [dLow + 1, u],
      ] as const) {
        if (wk * wd < 0.01) continue;
        const z = Math.max(-1, Math.min(1, d / 3)),
          across = Math.sqrt(Math.max(0, 1 - z * z)),
          a = k * step;
        const image = this.lit(
          sprite,
          flip,
          [Math.cos(a) * across * (flip ? -1 : 1), Math.sin(a) * across, z],
          sun,
          ambient,
        );
        if (!image) return null;
        out.push([image, wk * wd]);
      }
    return out;
  }
  // Each pixel is sun × (the six planes, each weighted by the square of the light's share along
  // its axis, so the weights sum to one and a cloud is lit hard from one side) + ambient × (their
  // mean), masked by coverage. Both sums are linear, so they are built by compositing the planes
  // on the canvas rather than pixel by pixel: a cache miss costs a few draws, and a page full of
  // skies can relight freely.
  lit(sprite: number, flip: boolean, light: Direction, sun: Tint, ambient: Tint): HTMLCanvasElement | null {
    const planes = this.planes;
    if (!planes) return null;
    const heading = Math.round(Math.atan2(light[1], flip ? -light[0] : light[0]) / (Math.PI / 8)),
      depth = Math.round(light[2] * 3);
    const key = `${sprite}:${flip}:${heading}:${depth}:${sun.join(',')}:${ambient.join(',')}`;
    let canvas = this.cache.get(key);
    if (canvas) {
      this.cache.delete(key);
      this.cache.set(key, canvas);
      return canvas;
    }
    const z = depth / 3,
      across = Math.sqrt(Math.max(0, 1 - z * z)),
      angle = (heading * Math.PI) / 8;
    const along = [Math.cos(angle) * across, Math.sin(angle) * across, z],
      w = along.flatMap(share => [Math.max(share, 0) ** 2, Math.max(-share, 0) ** 2]);
    const [sr, sg, sb, si] = sun,
      [ar, ag, ab, ai] = ambient;
    const { left, top, width: sw, height: sh } = scaled(spriteRect(sprite));
    canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const out = context2d(canvas),
      grey = context2d(planes.grey),
      term = context2d(planes.term);
    const mirror = (c: CanvasRenderingContext2D) => c.setTransform(flip ? -1 : 1, 0, 0, 1, flip ? sw : 0, 0);
    // The planes summed with weights that add to one, into `grey`.
    const sum = (weights: readonly number[]) => {
      grey.setTransform(1, 0, 0, 1, 0, 0);
      grey.globalAlpha = 1;
      grey.globalCompositeOperation = 'source-over';
      grey.fillStyle = '#000';
      grey.fillRect(0, 0, sw, sh);
      mirror(grey);
      grey.globalCompositeOperation = 'lighter';
      weights.forEach((weight, k) => {
        if (weight > 0) {
          grey.globalAlpha = weight;
          grey.drawImage(planes.source, left, top + k * planes.plane, sw, sh, 0, 0, sw, sh);
        }
      });
    };
    // `grey` times a colour, added to the output; colours past 255 go in two passes.
    const add = (color: readonly number[]) => {
      for (const part of [color.map(v => Math.min(255, v)), color.map(v => Math.max(0, v - 255))]) {
        if (part.every(v => v < 0.5)) continue;
        term.globalCompositeOperation = 'source-over';
        term.drawImage(planes.grey, 0, 0, sw, sh, 0, 0, sw, sh);
        term.globalCompositeOperation = 'multiply';
        term.fillStyle = `rgb(${part.map(v => Math.round(v)).join(',')})`;
        term.fillRect(0, 0, sw, sh);
        out.drawImage(planes.term, 0, 0, sw, sh, 0, 0, sw, sh);
      }
    };
    out.fillStyle = '#000';
    out.fillRect(0, 0, sw, sh);
    out.globalCompositeOperation = 'lighter';
    sum(w);
    add([sr * si, sg * si, sb * si]);
    sum(w.map(() => 1 / 6));
    add([ar * ai, ag * ai, ab * ai]);
    out.globalCompositeOperation = 'destination-in';
    mirror(out);
    out.drawImage(planes.mask, left, top, sw, sh, 0, 0, sw, sh);
    this.cache.set(key, canvas);
    while (this.cache.size > this.limit) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
    return canvas;
  }
}
