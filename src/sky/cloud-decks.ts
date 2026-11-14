import { type SpriteRect, cloudSlots, cloudAtlasWidth, cloudAtlasHeight, spriteRect } from './clouds.ts';
import type { CloudArt, CloudFamily, Range } from './presets-data.ts';
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
export type CloudDeck = readonly [
  family: CloudFamily,
  count: number,
  scale: Range,
  height: number,
  velocity: Range,
  emitter?: readonly [number, number, number],
  art?: CloudArt,
  offsetZ?: number,
  seed?: number,
  useLighting?: boolean,
  variants?: number,
];
export interface DeckCloud {
  family: CloudFamily;
  sprite: number;
  x: number;
  y: number;
  z: number;
  extent: number;
  scale: number;
  speed: number;
}
export type Tint = readonly [red: number, green: number, blue: number, intensity: number];
export type Direction = readonly [x: number, y: number, z: number];
const SLOTS = 6;
const CENTERS = [
  [20, -100],
  [15, -50],
  [10, 0],
  [1.5, 50],
] as const;
const FAMILY_ART: Record<CloudFamily, CloudArt> = {
  altostratus: 'Altostratus_SingleL',
  cirrostratus: 'Cirrostratus_SingleL',
  cirrus: 'Cirrus_SingleL',
  cumulus: 'Cumulus_SingleL',
  nimbus: 'Nimbostratus_SingleL',
  stratus: 'Stratus_SingleL',
  wispy: 'Wispy_Single',
};
const lerp = ([lo, hi]: Range, t: number) => lo + (hi - lo) * t;

function variation(id: number, add: number): number {
  const h = (Math.imul(id, 0x2c9277b5) + add) >>> 0,
    mixed = Math.imul((h >>> ((h >>> 28) + 4)) ^ h, 0x108ef2d9);
  return (((mixed >>> 31) ^ (mixed >>> 9)) & 0x7fffff) / 0x800000;
}
export function cloudPicks(art: CloudArt, variants: number | undefined, count: number, seed: number): number[] {
  const pool = cloudSlots(art).slice(0, variants),
    picks: number[] = [];
  let draw = 0;
  while (picks.length < count && pool.length) {
    const batch = [...pool];
    for (let i = 0; i < batch.length && picks.length < count; i++) {
      const j = Math.min(batch.length - 1, i + Math.floor(hash(seed, ++draw) * (batch.length - i)));
      const picked = batch[j] ?? 0;
      batch[j] = batch[i] ?? picked;
      picks.push(picked);
    }
  }
  return picks;
}
export function deckClouds(decks: readonly (CloudDeck | null)[], artworkSeed = 1): (DeckCloud[] | null)[] {
  return decks.map((deck, index) => {
    if (!deck) return null;
    const [
      family,
      count,
      scale,
      height,
      velocity,
      [extent, spreadY, spreadZ] = [24, 4, 0],
      art = FAMILY_ART[family],
      offsetZ = 0,
      particleSeed = 0,
      ,
      variants,
    ] = deck;
    const [centerY, centerZ] = CENTERS[index] ?? [0, 0],
      sprites = cloudPicks(art, variants, Math.min(count, SLOTS), artworkSeed + index),
      bin = count ? (2 * extent) / count : 0,
      clouds: DeckCloud[] = [];
    for (let slot = 0; slot < SLOTS; slot++) {
      const particles = Math.floor(count / SLOTS) + (slot < count % SLOTS ? 1 : 0);
      for (let n = 0; n < particles; n++) {
        const id = clouds.length,
          key = id + particleSeed,
          u = variation(key, 0x0c988061),
          jitter = variation(key, 0xf6e3a528),
          // The two middle emitters set a uniform random size before their init graph
          // captures it. The outer emitters capture the particle's default size of one.
          // This seeded draw represents the emitter's separate random stream.
          initialScale = index === 1 || index === 2 ? hash(key, 31) : 1;
        clouds.push({
          family,
          sprite: sprites[slot] ?? 0,
          extent,
          x: -extent + (id + 0.5 + 0.5 * jitter) * bin,
          y: centerY + height + (hash(key, 23) - 0.5) * spreadY,
          z: centerZ + offsetZ + (hash(key, 29) - 0.5) * spreadZ,
          scale: initialScale * lerp(scale, u),
          speed: lerp(velocity, u),
        });
      }
    }
    return clouds;
  });
}
export function cloudPosition(cloud: DeckCloud, seconds: number): [x: number, fade: number] {
  const { extent } = cloud;
  if (extent <= 0) return [0, 0];
  const track = cloud.x - seconds * cloud.speed,
    span = 2 * extent;
  const x = track >= -extent && track <= extent ? track : ((((track + extent) % span) + span) % span) - extent;
  return [x, Math.min(1, (extent - Math.abs(x)) / (0.075 * extent))];
}

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
  COVERAGE = 6;
interface Planes {
  maps: readonly Uint8ClampedArray[];
  width: number;
}
const scaled = ({ left, top, width, height }: SpriteRect): SpriteRect => ({
  left: Math.round(left * FALLBACK_SCALE),
  top: Math.round(top * FALLBACK_SCALE),
  width: Math.max(1, Math.round((left + width) * FALLBACK_SCALE) - Math.round(left * FALLBACK_SCALE)),
  height: Math.max(1, Math.round((top + height) * FALLBACK_SCALE) - Math.round(top * FALLBACK_SCALE)),
});
export function lightWeights(light: Direction, flip = false): [plus: number[], minus: number[]] {
  const [x, y, z] = light,
    length = Math.hypot(x, y, z) || 1,
    along = [(flip ? -x : x) / length, y / length, z / length];
  return [along.map(v => Math.max(v, 0) ** 2), along.map(v => Math.max(-v, 0) ** 2)];
}
// The same signed-axis response and ambient term serve GPU and cached 2D drawing.
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
      const width = Math.round(cloudAtlasWidth() * FALLBACK_SCALE),
        height = Math.round(cloudAtlasHeight() * FALLBACK_SCALE),
        source = document.createElement('canvas'),
        maps: Uint8ClampedArray[] = [];
      source.width = width;
      source.height = height;
      const read = context2d(source, { willReadFrequently: true });
      for (const url of this.urls) {
        const map = await decode(url);
        read.clearRect(0, 0, width, height);
        read.drawImage(map, 0, 0, width, height);
        map.close();
        const pixels = read.getImageData(0, 0, width, height).data,
          values = new Uint8ClampedArray(width * height);
        for (let i = 0; i < values.length; i++) values[i] = pixels[i * 4] ?? 0;
        maps.push(values);
      }
      source.width = source.height = 0;
      if (this.released) return false;
      this.planes = { maps, width };
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
  lit(
    sprite: number,
    flip: boolean,
    light: Direction,
    sun: Tint,
    ambient: Tint,
    fill: Tint = [0, 0, 0, 0],
    opacity = 1,
  ): HTMLCanvasElement | null {
    const planes = this.planes;
    if (!planes) return null;
    const [plus, minus] = lightWeights(light, flip),
      key = JSON.stringify([sprite, flip, plus, minus, sun, ambient, fill, opacity]),
      cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const rect = scaled(spriteRect(sprite)),
      canvas = document.createElement('canvas');
    canvas.width = rect.width;
    canvas.height = rect.height;
    const output = context2d(canvas),
      image = output.createImageData(rect.width, rect.height);
    for (let y = 0; y < rect.height; y++) {
      for (let x = 0; x < rect.width; x++) {
        const at = (rect.top + y) * planes.width + rect.left + (flip ? rect.width - 1 - x : x),
          coverage = (planes.maps[COVERAGE]?.[at] ?? 0) / 255;
        let direct = 0,
          opposite = 0;
        for (let axis = 0; axis < 3; axis++) {
          const positive = (planes.maps[axis * 2]?.[at] ?? 0) / 255,
            negative = (planes.maps[axis * 2 + 1]?.[at] ?? 0) / 255;
          direct += positive * (plus[axis] ?? 0) + negative * (minus[axis] ?? 0);
          opposite += positive * (minus[axis] ?? 0) + negative * (plus[axis] ?? 0);
        }
        const pixel = (y * rect.width + x) * 4;
        for (let channel = 0; channel < 3; channel++) {
          const lightValue =
            (sun[channel] ?? 0) * sun[3] * direct +
            (fill[channel] ?? 0) * fill[3] * opposite +
            (ambient[channel] ?? 0) * ambient[3];
          image.data[pixel + channel] = opacity > 0 ? Math.min(255, lightValue / opacity) : 0;
        }
        image.data[pixel + 3] = coverage * Math.min(1, Math.max(0, opacity)) * 255;
      }
    }
    output.putImageData(image, 0, 0);
    this.cache.set(key, canvas);
    while (this.cache.size > this.limit) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
    return canvas;
  }
}
