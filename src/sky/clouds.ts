import { CLOUD_ART } from './cloud-art.ts';
import type { CloudArt } from './presets-data.ts';

// Cloud sprites: each cloud is a small volume of density, baked into six-way
// lighting maps (how lit every pixel is by light from +x, −x, +y, −y, +z and −z)
// plus alpha. Relighting then needs no further volume work: a pixel's light for
// any sun direction is the six maps weighted by the squares of that direction's
// components. The daylight storm bake adds separate crest exposure and diffuse sky light.

const hash = (x: number, y: number, z: number) => {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1440662683);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
};
const fade = (t: number) => t * t * (3 - 2 * t);
function noise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z),
    fx = fade(x - ix),
    fy = fade(y - iy),
    fz = fade(z - iz);
  const h = (a: number, b: number, c: number) => hash(a + seed, b + seed * 3, c + seed * 7);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return lerp(
    lerp(lerp(h(ix, iy, iz), h(ix + 1, iy, iz), fx), lerp(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), fx), fy),
    lerp(
      lerp(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), fx),
      lerp(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), fx),
      fy,
    ),
    fz,
  );
}
// Every noise sums one octave finer than its shape asks for: the sprites are baked large enough
// to hold it, and it is the detail a cloud stretched across a screen would otherwise lack.
const FINER = 1;
function fbm3(x: number, y: number, z: number, seed: number, octaves: number): number {
  let value = 0,
    weight = 0.5,
    total = 0;
  for (let i = 0; i < octaves + FINER; i++) {
    value += noise3(x, y, z, seed + i * 17) * weight;
    total += weight;
    x *= 2.03;
    y *= 2.03;
    z *= 2.03;
    weight *= 0.5;
  }
  return value / total;
}
// Billowy noise: folded so puffs have rounded tops, as cumulus edges do.
const billow = (x: number, y: number, z: number, seed: number, octaves: number) => {
  let value = 0,
    weight = 0.5,
    total = 0;
  for (let i = 0; i < octaves + FINER; i++) {
    value += Math.abs(noise3(x, y, z, seed + i * 31) * 2 - 1) * weight;
    total += weight;
    x *= 2.1;
    y *= 2.1;
    z *= 2.1;
    weight *= 0.52;
  }
  return value / total;
};
export const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

// A cloud's density at a point in the unit box (x, y across the sprite, y down; z depth).
type Field = (x: number, y: number, z: number) => number;
export type CloudKind =
  | 'cumulus'
  | 'stratusBlanket'
  | 'stormBlanket'
  | 'isolatedStorm'
  | 'heap'
  | 'cirrus'
  | 'wispy'
  | 'altostratus'
  | 'cirrostratus'
  | 'patch'
  | 'stratus'
  | 'nimbus';
export type Sprite = readonly [kind: CloudKind, seed: number];

// The baked library, in atlas order: kind and seed. Seeds were picked by eye
// for well-formed heaps. Every sprite is SPRITE_WIDTH × SPRITE_HEIGHT.
export const CLOUD_SPRITES: readonly Sprite[] = [
  ['cumulus', 2],
  ['cumulus', 6],
  ['cumulus', 7],
  ['cumulus', 11],
  ['cirrus', 3],
  ['cirrus', 8],
  ['cirrus', 14],
  ['wispy', 4],
  ['wispy', 9],
  ['stratus', 5],
  ['stratus', 10],
  ['nimbus', 6],
  ['nimbus', 12],
  ['heap', 3],
  ['heap', 9],
  ['altostratus', 1],
  ['altostratus', 4],
  ['altostratus', 7],
  ['altostratus', 9],
  ['cirrostratus', 2],
  ['cirrostratus', 6],
  ['cirrostratus', 11],
  ['isolatedStorm', 5],
];
export const SPRITE_WIDTH = 768,
  SPRITE_HEIGHT = 336,
  ATLAS_COLUMNS = 4;
// Overcast blankets, stratus and cumulonimbus: a band
// of cloud across the top of the sky, fading out below. Wider than the singles, they
// sit below them in the atlas, side by side.
export const BLANKETS: readonly (readonly [kind: 'stratusBlanket' | 'stormBlanket', seed: number])[] = [
  ['stratusBlanket', 1],
  ['stormBlanket', 2],
];
export const BLANKET_WIDTH = 1536,
  BLANKET_HEIGHT = 672;
const SINGLE_ROWS = Math.ceil(CLOUD_SPRITES.length / ATLAS_COLUMNS);
// One plane of the atlas: the singles' grid, then the blankets two to a row.
export const ATLAS_WIDTH = SPRITE_WIDTH * ATLAS_COLUMNS,
  PLANE_HEIGHT = SINGLE_ROWS * SPRITE_HEIGHT + Math.ceil(BLANKETS.length / 2) * BLANKET_HEIGHT;
// Where sprite `index` sits in a plane: singles first, then the blankets.
export interface SpriteRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
function bakedRect(index: number): SpriteRect {
  if (index < CLOUD_SPRITES.length)
    return {
      left: (index % ATLAS_COLUMNS) * SPRITE_WIDTH,
      top: Math.floor(index / ATLAS_COLUMNS) * SPRITE_HEIGHT,
      width: SPRITE_WIDTH,
      height: SPRITE_HEIGHT,
    };
  const b = index - CLOUD_SPRITES.length;
  return {
    left: (b % 2) * BLANKET_WIDTH,
    top: SINGLE_ROWS * SPRITE_HEIGHT + Math.floor(b / 2) * BLANKET_HEIGHT,
    width: BLANKET_WIDTH,
    height: BLANKET_HEIGHT,
  };
}

const packed = typeof __CLOUD_ATLAS__ === 'undefined' ? undefined : __CLOUD_ATLAS__;
const bakedSlots = [...CLOUD_SPRITES, ...BLANKETS];
const artSlots = new Map<string, number[]>();
const slots: { width: number; height: number; proxy: number; blanket: boolean }[] = [];
for (const [name, group] of Object.entries(CLOUD_ART)) {
  const matching = bakedSlots.flatMap(([kind], index) => (kind === group.proxy ? [index] : []));
  const ids = group.sizes.map(([width, height], variant) => {
    const index = bakedSlots.length + slots.length;
    slots.push({ width, height, proxy: matching[variant % matching.length] ?? 0, blanket: name.includes('Blanket') });
    return index;
  });
  artSlots.set(name, ids);
}

export const cloudSlots = (art: CloudArt): readonly number[] => artSlots.get(art) ?? [];
export const cloudAtlasWidth = (): number => packed?.width ?? ATLAS_WIDTH;
export const cloudAtlasHeight = (): number => packed?.height ?? PLANE_HEIGHT;
export const cloudIsBlanket = (index: number): boolean =>
  slots[index - bakedSlots.length]?.blanket ?? (index >= CLOUD_SPRITES.length && index < bakedSlots.length);
export function spriteSize(index: number): { width: number; height: number } {
  return slots[index - bakedSlots.length] ?? bakedRect(index);
}
export function spriteRect(index: number): SpriteRect {
  const logical = index - bakedSlots.length;
  const rect = packed?.rects[logical];
  if (rect) {
    const [left, top, width, height] = rect;
    return { left, top, width, height };
  }
  return bakedRect(slots[logical]?.proxy ?? index);
}
// More slices resolve the narrow overhangs and their shadows in the storm bank.
export const spriteDepth = (kind: string): number =>
  kind === 'isolatedStorm' ? 48 : kind === 'cirrus' ? 16 : kind === 'wispy' ? 20 : 32;
// How each kind takes light: `extinction` (how dense it is to light), `spread` (how
// far scattered light carries, softening shadows) and `scatter` (the share of light
// that scatters on rather than being shadowed), and `albedo` (how much of the light
// that reaches it the cloud gives back), and `sharpen` (see sharpened). Heaps are dense
// and shadow themselves sharply, storm heaps grey all through; thin kinds glow through.
interface Optics {
  extinction?: number;
  spread?: number;
  scatter?: number;
  albedo?: number;
  sharpen?: number;
}
const OPTICS: Readonly<Partial<Record<CloudKind, Optics>>> = {
  stratusBlanket: { extinction: 45, spread: 0.45, scatter: 0.14, albedo: 0.82 },
  stormBlanket: { extinction: 60, spread: 0.6, scatter: 0.09, albedo: 0.8, sharpen: 2 },
  isolatedStorm: { extinction: 19, spread: 0.88, scatter: 0.29, albedo: 1 },
  heap: { extinction: 70, spread: 0.4, scatter: 0.08, albedo: 0.62, sharpen: 3 },
  stratus: { extinction: 18, spread: 0.55, scatter: 0.22 },
  wispy: { extinction: 5, spread: 0.9, scatter: 0.45 },
  altostratus: { extinction: 20, spread: 0.55, scatter: 0.22 },
  cumulus: { extinction: 22, spread: 0.55, scatter: 0.2, sharpen: 3 },
  nimbus: { extinction: 30, spread: 0.5, scatter: 0.18 },
};

// A heap's density: an ellipsoid of radii `rx`, `ry`, its outline thrown about by
// noise of strength `amp`, with `body` setting how solid its interior is. Drawn at
// 1/1.3 scale so torn edges stay inside the sprite.
function heapField(seed: number, { rx, ry, amp, body }: { rx: number; ry: number; amp: number; body: number }): Field {
  const cx = 0.5 + (hash(seed, 1, 5) - 0.5) * 0.06;
  return (sx, sy, z) => {
    const x = 0.5 + (sx - 0.5) * 1.3,
      y = 0.52 + (sy - 0.52) * 1.3;
    const wx = x + (fbm3(x * 3, y * 3, z * 3, seed + 11, 3) - 0.5) * 0.16,
      wy = y + (fbm3(x * 3 + 7, y * 3, z * 3, seed + 12, 3) - 0.5) * 0.14;
    const mass =
      1 -
      Math.hypot((x - cx) / rx, (y - 0.54) / ry, (z - 0.5) / 0.5) +
      (fbm3(wx * 2.4, wy * 2.4, z * 2.4, seed + 3, 4) - 0.5) * amp -
      // Kept clear of the sprite's edges, so no lobe is cut off.
      Math.max(0, Math.abs(sx - 0.5) - 0.42) * 12 -
      Math.max(0, Math.abs(sy - 0.5) - 0.4) * 12;
    if (mass < -0.45) return 0;
    // The outline is torn by the broader billows only; the finest churn works inside.
    const edge = clamp(1 - mass * 3),
      erode =
        billow(wx * 6, wy * 6, z * 6, seed, 3) * 0.55 +
        billow(wx * 13, wy * 13, z * 13, seed + 50, 3) * 0.35 +
        billow(wx * 30, wy * 30, z * 30, seed + 60, 2) * 0.1 * (1 - edge);
    const inner = 0.2 + 1.6 * fbm3(wx * 20, wy * 20, z * 20, seed + 70, 3) ** 1.5,
      thin = body + (1.3 - body) * fbm3(x * 3, y * 3, z * 3, seed + 80, 2);
    // Near the outline the churn wins, tearing it into wisps.
    return clamp((mass - erode * (0.5 + 0.4 * edge) + 0.22) * 2) ** 1.2 * inner * thin;
  };
}

// A puff of cloud: a sphere at x, y, z in units of the sprite's height, and its radius.
type Puff = readonly [x: number, y: number, z: number, radius: number];
// The storm blanket's towers, the height of their bases (from the top), and the spacing of the
// shelf's puffs; then each puff's children, and how many generations of them.
const STORM = {
  towers: 10,
  domePuffs: 10,
  base: 0.42,
  shelf: 0.09,
  children: 5,
  generations: 2,
  merge: 14,
  skirt: 0.86,
} as const;
// Puffs heaped on puffs: each generation smaller and set over the upper and outer side of the one
// before, so a crown is rounded bulges on bulges with creases between them.
function heaped(roots: readonly Puff[], random: () => number): Puff[] {
  const all = [...roots];
  let parents = roots;
  for (let generation = 0; generation < STORM.generations; generation++) {
    const born: Puff[] = [];
    for (const [px, py, pz, r] of parents)
      for (let c = 0; c < STORM.children; c++) {
        // Over the upper side (y runs down), leaning well out to the sides and to the front and back.
        const across = random() * 2 - 1,
          up = -(0.1 + random() * 0.6),
          deep = random() * 2 - 1,
          length = Math.hypot(across, up, deep);
        born.push([
          px + (across / length) * r * 0.85,
          py + (up / length) * r * 0.85,
          pz + (deep / length) * r * 0.5,
          r * (0.38 + random() * 0.2),
        ]);
      }
    all.push(...born);
    parents = born;
  }
  return all;
}
// The puffs a point could be in: each is filed under every cell of a grid it reaches, across a
// width `span` that wraps, so a point looks only at its own cell's.
const PUFF_CELL = 0.05;
function puffGrid(puffs: readonly Puff[], span: number): (x: number, y: number) => readonly Puff[] {
  const columns = Math.ceil(span / PUFF_CELL),
    cells = new Map<number, Puff[]>(),
    key = (column: number, row: number) => (((column % columns) + columns) % columns) * columns * 4 + row + columns * 2;
  for (const puff of puffs) {
    const [x, y, , r] = puff;
    for (let column = Math.floor((x - r) / PUFF_CELL); column <= Math.floor((x + r) / PUFF_CELL); column++)
      for (let row = Math.floor((y - r) / PUFF_CELL); row <= Math.floor((y + r) / PUFF_CELL); row++) {
        const at = key(column, row),
          list = cells.get(at);
        if (list) list.push(puff);
        else cells.set(at, [puff]);
      }
  }
  return (x, y) => cells.get(key(Math.floor(x / PUFF_CELL), Math.floor(y / PUFF_CELL))) ?? [];
}

// Density at a point in the unit box (x, y across the sprite, y down; z depth).
// One shape per kind of cloud.
export const KINDS: Readonly<Record<CloudKind, (seed: number) => Field>> = {
  // Heaps: an irregular mass whose outline comes
  // from noise rather than spheres, churned by warped billows at three scales so it
  // breaks into lumps and torn, smoky wisps, and shadows itself in fine detail.
  cumulus: seed => heapField(seed, { rx: 0.4, ry: 0.3, amp: 3.2, body: 0.5 }),
  // Stratus blanket: a dense, turbulent grey lid across the top, its lower
  // edge ragged, churned throughout so it shadows itself in creases.
  stratusBlanket(seed) {
    return (x, y, z) => {
      const X = (x * BLANKET_WIDTH) / BLANKET_HEIGHT,
        wx = X + (fbm3(X * 1.5, y * 1.5, z * 2, seed + 11, 3) - 0.5) * 0.3,
        wy = y + (fbm3(X * 1.5 + 7, y * 1.5, z * 2, seed + 12, 3) - 0.5) * 0.15;
      const cover = clamp((0.5 - y) / 0.28 + (fbm3(wx * 1.4, wy * 2, z * 2, seed + 3, 3) - 0.5) * 1.6);
      if (cover <= 0) return 0;
      // Lumps: dense peaks of noise at two scales, cut sharply so creases fall between.
      const lumps =
        Math.max(fbm3(wx * 3, wy * 5, z * 1.2, seed + 33, 4), fbm3(wx * 6, wy * 9, z * 1.5, seed + 34, 3) * 0.92) -
        0.52 +
        cover * 0.16;
      const erode = billow(wx * 12, wy * 14, z * 10, seed, 3),
        inner = 0.35 + 1.2 * fbm3(wx * 14, wy * 14, z * 12, seed + 70, 3) ** 1.3;
      return (
        clamp((lumps - erode * 0.15 + 0.02) * 6) ** 1.2 * inner * clamp(cover * 2) * clamp(1 - Math.abs(z - 0.5) / 0.22)
      );
    };
  },
  // Cumulonimbus blanket: towers crowded along the top edge, a front row and a back row of mixed
  // widths, wrapping so the blanket tiles. Their crowns are heaped billows, small ones on large,
  // with sky between some of them; a shelf joins their bases, and under it the cloud thins into
  // a ragged skirt of haze rather than ending on a flat base.
  stormBlanket(seed) {
    const span = BLANKET_WIDTH / BLANKET_HEIGHT;
    let drawn = 0;
    const random = () => hash(seed, drawn++, 23);
    // Each tower a dome of large puffs, broad at its base and narrowing to its crown, a front row
    // and a back row; puffs along the base at uneven heights join them.
    const roots: Puff[] = [];
    for (let k = 0; k < STORM.towers; k++) {
      const centre = ((k + random() * 0.8) / STORM.towers) * span,
        half = 0.13 + random() * 0.08,
        crown = (k % 2 ? 0.07 : 0.12) + random() * 0.12,
        deep = k % 2 ? 0.38 : 0.6;
      // Spread evenly from the base to the crown, more of them low down, and the dome round: as
      // wide as an ellipse is at each height.
      for (let p = 0; p < STORM.domePuffs; p++) {
        const rise = ((p + random()) / STORM.domePuffs) ** 1.3,
          at = STORM.base - rise * (STORM.base - crown),
          width = half * Math.sqrt(1 - rise * rise * 0.85);
        roots.push([
          centre + (random() * 2 - 1) * width,
          at,
          deep + (random() - 0.5) * 0.16,
          (0.06 + random() * 0.05) * (1 - rise * 0.35),
        ]);
      }
    }
    for (let at = 0; at < span; at += STORM.shelf)
      roots.push([
        at + random() * STORM.shelf,
        STORM.base + random() * 0.08,
        0.3 + random() * 0.4,
        0.07 + random() * 0.05,
      ]);
    const near = puffGrid(heaped(roots, random), span);
    return (x, y, z) => {
      const X = x * span,
        wx = X + (fbm3(X * 4, y * 4, z * 4, seed + 11, 3) - 0.5) * 0.06,
        wy = y + (fbm3(X * 4 + 7, y * 4, z * 4, seed + 12, 3) - 0.5) * 0.05;
      // The skirt: soft patches of thin cloud hanging under the base, fading out as they go down,
      // in front of the towers so the gaps between them don't light it in shafts.
      const skirt =
        clamp((0.82 - y) / 0.3) *
        clamp((y - STORM.base + 0.06) / 0.1) *
        clamp((fbm3(wx * 2.5, wy * 5, z * 3, seed + 90, 4) - 0.38) * 2.5) *
        0.5 *
        clamp(1 - Math.abs(z - STORM.skirt) / 0.12);
      // The puffs merge where they meet, so bulges run into each other without a crease.
      let merged = 0;
      for (const [px, py, pz, r] of near(wx, wy)) {
        const dx = ((((wx - px) % span) + span * 1.5) % span) - span / 2;
        merged += Math.exp((1 - Math.hypot(dx, wy - py, z - pz) / r) * STORM.merge);
      }
      const mass = merged > 0 ? Math.log(merged) / STORM.merge : -1;
      if (mass < -0.35) return skirt;
      // The rims soften and fray; inside, the puffs are dense, a little uneven.
      const fray = billow(wx * 30, wy * 30, z * 24, seed + 60, 2) * 0.3 * clamp(1 - mass * 3),
        inner = 0.45 + 0.9 * fbm3(wx * 14, wy * 14, z * 14, seed + 70, 3);
      return clamp((mass - fray + 0.12) * 2.6) ** 1.3 * inner + skirt;
    };
  },
  // A dense head curls over the viewer and overlaps the distant ceiling. Two low
  // banks break through the haze ahead of it.
  isolatedStorm(seed) {
    const span = SPRITE_WIDTH / SPRITE_HEIGHT;
    return (x, y, z) => {
      if (y > 0.9 || z < 0.04 || z > 0.97) return 0;
      const X = x * span,
        wx = X + (fbm3(X * 3.1, y * 3.6, z * 2.2, seed + 11, 3) - 0.5) * 0.17,
        wy = y + (fbm3(X * 3.6 + 7, y * 4, z * 2.5, seed + 12, 3) - 0.5) * 0.13,
        fold = fbm3(wx * 5.5, wy * 6.5, z * 3.1, seed + 4, 3) - 0.5,
        curl = billow(wx * 13, wy * 16, z * 9, seed + 31, 3) - 0.32,
        fleck = fbm3(wx * 28 + wy * 3, wy * 32, z * 8, seed + 51, 3) - 0.5;
      const swell = 0.45 * fold - 0.27 * curl + 0.1 * fleck,
        left = Math.exp(-(((x - 0.849) / 0.22) ** 2)),
        right = Math.exp(-(((x - 0.26) / 0.19) ** 2));
      // The forward face moves in depth with the swell. Light from above has to pass
      // through the overhanging shoulders before it reaches the hollow under each one.
      const body =
          1 -
          ((wx - span * 0.852) / 0.54) ** 2 -
          ((wy - (0.305 - (x - 0.845) * 0.46)) / 0.206) ** 2 -
          ((z - 0.48 - fold * 0.2) / 0.31) ** 2 +
          swell * 2.1,
        roll =
          1 -
          ((wx - span * 0.807) / 0.31) ** 2 -
          ((wy - (0.213 - (x - 0.845) * 0.43)) / 0.107) ** 2 -
          ((z - 0.31) / 0.22) ** 2 +
          swell * 2.5,
        head = clamp(Math.max(body, roll) / 0.27) * clamp((0.58 - wy) / 0.32) ** 2.2;
      const trail =
          Math.exp(-(((wy - 0.37 - (0.84 - x) * 0.4) / 0.15) ** 2)) *
          Math.exp(-(((z - 0.66) / 0.12) ** 2)) *
          Math.max(left, right * 0.37),
        upper = Math.exp(-(((x - 0.66) / 0.088) ** 2)),
        ceilingBase = 0.22 + right * 0.13 + upper * 0.075 + fold * 0.31 - curl * 0.1,
        ceiling = clamp((ceilingBase - wy) / 0.14) * clamp(1 - Math.abs(z - 0.7 + swell * 0.3) / 0.23),
        cells = clamp((fold + 0.16 - curl * 0.25) * 3);
      const banks = Math.max(Math.exp(-(((x - 0.819) / 0.12) ** 2)), Math.exp(-(((x - 0.27) / 0.112) ** 2)) * 0.91),
        bankSide = Math.exp(-(((x - 0.902) / 0.082) ** 2)),
        bankTop = 0.7 - Math.max(banks * 0.263, bankSide * 0.165),
        bankDepth = clamp(1 - Math.abs(z - 0.22 - swell * 0.55) / 0.14),
        bank = clamp((wy - bankTop + swell * 0.39) / 0.032) * clamp((0.815 - wy) / 0.265) ** 2;
      return (
        (head * (0.68 + 0.46 * cells) +
          ceiling * (0.025 + cells * (0.09 + (right + upper) * 0.38)) +
          trail * (0.14 + 0.26 * cells) +
          bank * Math.max(banks, bankSide * 0.72) * bankDepth * (0.095 + cells * 0.32) * (0.1 + 0.38 * left)) *
        clamp((0.9 - y) / 0.1)
      );
    };
  },
  // Large cumulus: broad, dense heaps that shadow themselves deeply, with
  // grey tops and dark undersides; the darkest are storm heaps.
  heap: seed => heapField(seed + 200, { rx: 0.5, ry: 0.28, amp: 3, body: 0.9 }),
  // Thin feathery strands on a rising diagonal, broken along their length.
  cirrus(seed) {
    // Each strand: start, end, height, width and strength; tapered at both ends.
    const random = (i: number) => hash(seed, i, 11),
      strands = Array.from(
        { length: 6 + Math.floor(random(0) * 5) },
        (_, i): readonly [number, number, number, number, number] => {
          const start = random(i + 1) * 0.5,
            length = 0.3 + random(i + 3) * 0.55;
          return [
            start,
            Math.min(0.98, start + length),
            0.2 + random(i + 5) * 0.6,
            0.006 + random(i + 7) ** 2 * 0.03,
            0.4 + random(i + 13) * 0.6,
          ];
        },
      );
    return (x, y, z) => {
      let value = 0;
      for (const [from, to, y0, width, strength] of strands) {
        if (x < from || x > to) continue;
        const t = (x - from) / (to - from),
          taper = Math.sin(t * Math.PI) ** 0.7;
        const centre = y0 - (x - 0.5) * 0.75 + (t * t - t) * 0.14 + (fbm3(x * 4, y0 * 7, 0, seed + 3, 3) - 0.5) * 0.06;
        const across = Math.exp(-(((y - centre) / (width * (0.4 + taper))) ** 2)),
          along = clamp(fbm3(x * 6, y0 * 9, z, seed + 5, 4) * 3 - 1.05);
        value += across * along * strength * taper;
      }
      // Fine fibres combed along the strands: sparse, crisp filaments.
      const depth = Math.exp(-(((z - 0.5) / 0.22) ** 2)),
        comb = 0.25 + 0.75 * fbm3(x * 3, (y + x * 0.75) * 90, z * 4, seed + 9, 3);
      return clamp(value * comb * depth * 1.4) * 0.6;
    };
  },
  // Wisps: a loose cluster of faint, mottled puffs,
  // translucent throughout, with no hard edge and no bright core.
  wispy(seed) {
    return (x, y, z) => {
      const area = clamp(
        1 -
          Math.hypot((x - 0.5) / 0.48, (y - 0.5) / 0.42, (z - 0.5) / 0.45) +
          (fbm3(x * 2, y * 2, z * 2, seed + 4, 3) - 0.5) * 1.4,
      );
      if (area <= 0) return 0;
      const puffs = clamp((fbm3(x * 5, y * 6, z * 4, seed, 4) - 0.5) * 4),
        mottle = 0.4 + 0.9 * fbm3(x * 16, y * 16, z * 10, seed + 70, 3);
      return puffs * mottle * clamp(area * 2) * 0.35;
    };
  },
  // Altostratus: a field of many small, bright cloudlets
  // and flecks, gathered in loose groups across a wide band, with a faint haze
  // between them. Each cloudlet is wider than tall and lumpy enough to catch light
  // on its top.
  altostratus(seed) {
    return (x, y, z) => {
      const tilt = y - 0.55 + (x - 0.5) * 0.18,
        band = clamp(
          1 -
            Math.hypot((x - 0.5) / 0.48, tilt / 0.34, (z - 0.5) / 0.4) +
            (fbm3(x * 2, y * 2, z * 2, seed + 2, 3) - 0.5) * 1.2,
        );
      if (band <= 0) return 0;
      const wx = x + (fbm3(x * 3, y * 3, z * 3, seed + 21, 3) - 0.5) * 0.08;
      // Cloudlets: peaks of a squashed noise, cut off sharply so they stand apart.
      const lets = clamp((fbm3(wx * 9, tilt * 20, z * 4, seed + 33, 4) - 0.56) * 7),
        groups = clamp((fbm3(x * 2.6, y * 2.6, z * 2, seed + 5, 3) - 0.48) * 4);
      const lumps = 1 - billow(wx * 26, y * 34, z * 10, seed, 3) * 0.7,
        haze = fbm3(x * 4, tilt * 9, z * 3, seed + 9, 3) * 0.025;
      return (lets * lets * lumps * groups * 1.8 + haze * groups) * band ** 0.6;
    };
  },
  // Cirrostratus: a few brushed patches of fibrous streaks,
  // fanning along a diagonal and fraying at their ends, high behind everything.
  cirrostratus(seed) {
    return (x, y, z) => {
      const veil = clamp(1 - Math.hypot((x - 0.5) / 0.5, (y - 0.5 + (x - 0.5) * 0.3) / 0.4));
      if (veil <= 0) return 0;
      const along = y + x * 0.3 + (fbm3(x * 2, y * 2, 0, seed + 3, 3) - 0.5) * 0.12,
        patches = clamp((fbm3(x * 2.4, y * 2.4, z * 2, seed + 21, 3) - 0.43) * 4);
      const strands = fbm3(x * 2, along * 14, z * 3, seed, 4),
        fine = fbm3(x * 3, along * 70, z * 6, seed + 7, 3);
      return (
        clamp((strands - 0.4) * 3) *
        (0.3 + 0.7 * fine) *
        patches *
        clamp(veil * 2) *
        Math.exp(-(((z - 0.5) / 0.25) ** 2)) *
        0.95
      );
    };
  },
  // Broken stratocumulus: a flattened, lumpy clump with a ragged outline. Many of
  // them, small, tile an overcast or drizzly sky.
  patch(seed) {
    return (x, y, z) => {
      const warp = (fbm3(x * 3, y * 3, z * 2, seed + 21, 3) - 0.5) * 0.5;
      const outline = clamp(
        1 - Math.hypot((x - 0.5) / 0.44, (y - 0.55) / 0.3 + warp * 0.6, (z - 0.5) / 0.4) - warp * 0.4,
      );
      if (outline <= 0) return 0;
      const lumps = billow(x * 7, y * 7, z * 7, seed, 4) * 0.6 + billow(x * 16, y * 16, z * 16, seed + 50, 3) * 0.4;
      return clamp((outline * 1.6 - lumps * 0.55) * 2.6) * (0.5 + fbm3(x * 12, y * 12, z * 12, seed + 70, 3));
    };
  },
  // Stratus: torn fragments strung along a slanting band,
  // each a ragged, lumpy clump that catches the light, with clear sky between.
  stratus(seed) {
    return (x, y, z) => {
      const tilt = y - 0.55 + (x - 0.5) * 0.25,
        band = clamp(
          1 -
            Math.hypot((x - 0.5) / 0.47, tilt / 0.26, (z - 0.5) / 0.45) +
            (fbm3(x * 2, y * 2, z * 2, seed + 2, 3) - 0.5) * 1.2,
        );
      if (band <= 0) return 0;
      const wx = x + (fbm3(x * 4, y * 4, z * 4, seed + 11, 3) - 0.5) * 0.1,
        wy = y + (fbm3(x * 4 + 7, y * 4, z * 4, seed + 12, 3) - 0.5) * 0.1;
      // Fragments: peaks of mid-scale noise, torn by finer billows.
      const pieces = fbm3(wx * 7, wy * 10, z * 4, seed + 33, 4) - 0.56 + band * 0.1,
        erode = billow(wx * 14, wy * 16, z * 10, seed, 3) * 0.6 + billow(wx * 32, wy * 34, z * 16, seed + 60, 2) * 0.4;
      const inner = 0.3 + 1.3 * fbm3(wx * 20, wy * 20, z * 16, seed + 70, 3) ** 1.4;
      return clamp((pieces - erode * 0.22 + 0.02) * 7) ** 1.3 * inner * clamp(band * 3);
    };
  },

  // Nimbostratus: a few dense, bright cauliflower clumps
  // clustered along a band, some joined and some apart, each lumpy all over.
  nimbus(seed) {
    return (x, y, z) => {
      const tilt = y - 0.52 + (x - 0.5) * 0.15,
        band = clamp(
          1 -
            Math.hypot((x - 0.5) / 0.44, tilt / 0.4, (z - 0.5) / 0.45) +
            (fbm3(x * 2, y * 2, z * 2, seed + 2, 3) - 0.5) * 0.9,
        );
      if (band <= 0) return 0;
      const wx = x + (fbm3(x * 4, y * 4, z * 4, seed + 11, 3) - 0.5) * 0.08,
        wy = y + (fbm3(x * 4 + 7, y * 4, z * 4, seed + 12, 3) - 0.5) * 0.08;
      // Clumps: peaks of broad noise, wide apart, then churned into cauliflower.
      const clumps = fbm3(wx * 5, wy * 4, z * 3, seed + 33, 4) - 0.53 + band * 0.22,
        erode = billow(wx * 9, wy * 9, z * 9, seed, 3) * 0.6 + billow(wx * 22, wy * 22, z * 16, seed + 60, 2) * 0.4;
      const inner = 0.35 + 1.2 * fbm3(wx * 18, wy * 18, z * 14, seed + 70, 3) ** 1.3;
      return clamp((clumps - erode * 0.32 + 0.1) * 5) ** 1.2 * inner * clamp(band * 3);
    };
  },
};

// A sprite's blur for sharpening: binomial, because a square one leaves a grain along the axes.
const BLUR = [1, 4, 6, 4, 1];
const BLUR_REACH = 2;
const BLUR_TOTAL = 16;
// The seven maps with their fine detail pushed `amount` times further from its surroundings.
// Drawn, a sprite is stretched several times over and many of them overlap, and what they
// lose is this detail, so it goes in stronger. Crisp heaps need it; soft kinds don't.
export function sharpened(maps: Float32Array, width: number, height: number, amount: number): Float32Array {
  const out = new Float32Array(maps.length),
    across = new Float32Array(width * height);
  const blurred = (at: (offset: number) => number) =>
    BLUR.reduce((total, weight, i) => total + at(i - BLUR_REACH) * weight, 0) / BLUR_TOTAL;
  for (let k = 0; k < 7; k++) {
    const value = (x: number, y: number) => maps[(y * width + x) * 7 + k] ?? 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        across[y * width + x] = blurred(i => value(Math.min(width - 1, Math.max(0, x + i)), y));
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const soft = blurred(i => across[Math.min(height - 1, Math.max(0, y + i)) * width + x] ?? 0);
        out[(y * width + x) * 7 + k] = clamp(value(x, y) + amount * (value(x, y) - soft));
      }
  }
  return out;
}

// Bakes one sprite: width × height pixels, `depth` samples deep. Light from each
// axis direction is attenuated by a running sum of density along that axis, so
// the whole bake is a few linear sweeps over the volume.
export interface BakedSprite {
  kind: CloudKind;
  seed: number;
  width: number;
  height: number;
  maps: Float32Array;
}
export function bakeCloud(kind: CloudKind, seed: number, width: number, height: number, depth = 32): BakedSprite {
  const optics: Optics = OPTICS[kind] ?? {},
    { extinction = 6, spread = 0.85, scatter = 0.35, albedo = 1, sharpen = 0 } = optics;
  // Every sprite fades to nothing before its edges, whatever its kind, so no
  // border can show where sprites overlap the sky.
  // Blankets run edge to edge, side by side as they drift, so only their top and
  // bottom fade.
  const wide = BLANKETS.some(([name]) => name === kind),
    shape = KINDS[kind](seed),
    border = (x: number, y: number) =>
      kind === 'isolatedStorm' ? 1 : (wide ? 1 : clamp(Math.min(x, 1 - x) / 0.04)) * clamp(Math.min(y, 1 - y) / 0.06);
  const density = (x: number, y: number, z: number) => shape(x, y, z) * border(x, y),
    n = width * height * depth,
    field = new Float32Array(n);
  const index = (x: number, y: number, z: number) => (z * height + y) * width + x;
  for (let z = 0; z < depth; z++)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        field[index(x, y, z)] = density((x + 0.5) / width, (y + 0.5) / height, (z + 0.5) / depth);
  // Optical depth per step, normalised so a sprite's thickness feels the same at any resolution.
  const dx = extinction / width,
    dy = extinction / height,
    dz = extinction / depth;
  // Light travels further into the cloud than the eye sees: multiple scattering.
  // Transmittance toward each light: x+ (light from the right), x−, y+ (from above), y−, z+ (from the viewer's side), z− (from behind).
  const light = Array.from({ length: 6 }, () => new Float32Array(n));
  type Pair = readonly [number, number];
  const sweep = (
    target: Float32Array | undefined,
    outer: readonly Pair[],
    along: (start: Pair) => number[],
    scale: number,
  ) => {
    if (!target) return;
    for (const start of outer) {
      let tau = 0;
      for (const i of along(start)) {
        target[i] = Math.exp(-tau) * (1 - scatter) + Math.exp(-tau * 0.2) * scatter;
        tau += (field[i] ?? 0) * scale * spread;
      }
    }
  };
  const rows: Pair[] = [],
    columns: Pair[] = [],
    pillars: Pair[] = [];
  for (let z = 0; z < depth; z++) for (let y = 0; y < height; y++) rows.push([y, z]);
  for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) columns.push([x, z]);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pillars.push([x, y]);
  const range = (count: number, reverse: boolean, map: (i: number) => number) => {
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(map(reverse ? count - 1 - i : i));
    return out;
  };
  sweep(light[0], rows, ([y, z]) => range(width, true, x => index(x, y, z)), dx);
  sweep(light[1], rows, ([y, z]) => range(width, false, x => index(x, y, z)), dx);
  sweep(light[2], columns, ([x, z]) => range(height, false, y => index(x, y, z)), dy);
  sweep(light[3], columns, ([x, z]) => range(height, true, y => index(x, y, z)), dy);
  sweep(light[4], pillars, ([x, y]) => range(depth, false, z => index(x, y, z)), dz);
  sweep(light[5], pillars, ([x, y]) => range(depth, true, z => index(x, y, z)), dz);
  // Integrate toward the viewer (front at z = 0): each map is the light that
  // reaches the eye, and alpha is the coverage.
  const maps = new Float32Array(width * height * 7);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let view = 1;
      const sums = [0, 0, 0, 0, 0, 0];
      for (let z = 0; z < depth && view > 0.004; z++) {
        const i = index(x, y, z),
          d = field[i] ?? 0;
        if (!d) continue;
        const absorbed = view * (1 - Math.exp(-d * dz));
        for (let k = 0; k < 6; k++) sums[k] = (sums[k] ?? 0) + absorbed * (light[k]?.[i] ?? 0);
        view *= Math.exp(-d * dz);
      }
      const p = (y * width + x) * 7,
        alpha = 1 - view;
      for (let k = 0; k < 6; k++) maps[p + k] = alpha > 0.001 ? ((sums[k] ?? 0) / alpha) * albedo : 0;
      maps[p + 6] = alpha;
    }
  return { kind, seed, width, height, maps: sharpen ? sharpened(maps, width, height, sharpen) : maps };
}

// Light for a sun direction: the six maps weighted by the squares of the direction's positive
// and negative parts, over an ambient term (the average of all six, so shaded
// sides still read as cloud). `light` is [x, y, z] with y up and z toward the viewer.
type Rgb = readonly [red: number, green: number, blue: number];
export interface Relighting {
  sun?: Rgb;
  ambient?: Rgb;
  sunIntensity?: number;
  ambientIntensity?: number;
  alpha?: number;
}
export function relight(
  sprite: Pick<BakedSprite, 'width' | 'height' | 'maps'>,
  [lx, ly, lz]: readonly [x: number, y: number, z: number],
  {
    sun = [255, 250, 240],
    ambient = [150, 170, 200],
    sunIntensity = 1,
    ambientIntensity = 0.55,
    alpha = 1,
  }: Relighting = {},
): Uint8ClampedArray {
  const { width, height, maps } = sprite,
    out = new Uint8ClampedArray(width * height * 4);
  const length = Math.hypot(lx, ly, lz) || 1,
    w = [lx, ly, lz].flatMap(share => [Math.max(share, 0) ** 2, Math.max(-share, 0) ** 2].map(v => v / length ** 2));
  for (let i = 0, p = 0; i < width * height; i++, p += 7) {
    const a = maps[p + 6] ?? 0;
    if (a < 0.003) continue;
    let direct = 0,
      mean = 0;
    for (let k = 0; k < 6; k++) {
      const value = maps[p + k] ?? 0;
      direct += value * (w[k] ?? 0);
      mean += value;
    }
    direct *= sunIntensity;
    mean = (mean / 6) * ambientIntensity;
    const q = i * 4;
    for (let c = 0; c < 3; c++) out[q + c] = Math.min(255, (sun[c] ?? 0) * direct + (ambient[c] ?? 0) * mean);
    out[q + 3] = a * alpha * 255;
  }
  return out;
}
