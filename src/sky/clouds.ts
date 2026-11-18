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
// Packed balls: 1 at the middle of each cell's ball, falling to 0 where neighbours meet, so summed
// over sizes it is rounded heads with sharp creases between them, as a heap's surface is.
function cells3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  let nearest = 1;
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx,
          cy = iy + dy,
          cz = iz + dz,
          px = cx + hash(cx + seed, cy, cz) - x,
          py = cy + hash(cx, cy + seed, cz + 5) - y,
          pz = cz + hash(cx + 9, cy, cz + seed) - z,
          distance = px * px + py * py + pz * pz;
        if (distance < nearest) nearest = distance;
      }
  return 1 - Math.sqrt(nearest);
}
const heads3 = (x: number, y: number, z: number, seed: number, sizes: readonly number[], weights: readonly number[]) =>
  sizes.reduce((sum, size, i) => sum + cells3(x * size, y * size, z * size, seed + i * 13) * (weights[i] ?? 0), 0);
export const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

// A cloud's density at a point in the unit box (x, y across the sprite, y down; z depth).
type Field = (x: number, y: number, z: number) => number;
export type CloudKind =
  | 'cumulus'
  | 'stratusBlanket'
  | 'stormBlanket'
  | 'altoBlanket'
  | 'cirrusBlanket'
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
  ['heap', 5],
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
// Overcast blankets, stratus, cumulonimbus and a thin broken altostratus: a band
// of cloud across the top of the sky, fading out below. Wider than the singles, they
// sit below them in the atlas, side by side.
export const BLANKETS: readonly (readonly [
  kind: 'stratusBlanket' | 'stormBlanket' | 'altoBlanket' | 'cirrusBlanket',
  seed: number,
])[] = [
  ['stratusBlanket', 1],
  ['stormBlanket', 2],
  ['altoBlanket', 3],
  ['cirrusBlanket', 4],
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
  kind === 'cirrusBlanket'
    ? 12
    : kind === 'altoBlanket'
      ? 24
      : kind.endsWith('Blanket')
        ? 96
        : kind === 'isolatedStorm'
          ? 48
          : kind === 'cirrus'
            ? 16
            : kind === 'wispy'
              ? 20
              : 32;
// How each kind takes light: `extinction` (how dense it is to light), `spread` (how
// far scattered light carries, softening shadows) and `scatter` (the share of light
// that scatters on rather than being shadowed), and `albedo` (how much of the light
// that reaches it the cloud gives back), and `sharpen` (see sharpened), and `occlusion`, how
// far the cloud crowded around a point cuts the light reaching it from every side, over a `reach`
// (a share of the sprite): creases between billows and the hollows under them go dark even in
// light from the front, and `thin`, how bright the thinnest parts are beside the dense ones, as a
// thin wisp gives back less of the light that crosses it, and `diffuse`, how far (a share of the
// sprite) light spreads sideways inside the cloud, so a lump's shadow below it is soft, not a streak. Heaps are dense and shadow themselves sharply, storm heaps grey all
// through; thin kinds glow through.
interface Optics {
  extinction?: number;
  spread?: number;
  scatter?: number;
  albedo?: number;
  sharpen?: number;
  occlusion?: number;
  reach?: number;
  thin?: number;
  diffuse?: number;
  // How far in from its outline (a share of the sprite's height) the cloud thins toward nothing:
  // a heap's edge against the sky is a soft fall into haze, never a line.
  feather?: number;
  // The height (a share of the sprite's, from its top) below which the outline is left untufted.
  mist?: number;
  // How far the far side of the cloud sits below the near side (a share of the sprite's height),
  // as it does to an eye under the cloud looking up: the underside shows, and light from the
  // viewer's side or from behind crosses the cloud level, at that slant to the eye.
  pitch?: number;
  // How many times deeper the cloud is to light from the viewer's side and from behind than its
  // box is: a heap is as deep as it is wide, and its box only as deep as it is tall.
  deep?: number;
  // A blanket's cover is painted over it rather than left to its density: whole down to the first
  // of these (shares of the sprite's height) and gone by the second, the same from side to side,
  // so its lower edge is one soft fall and its lumps show only in how they take the light.
  ramp?: readonly [from: number, to: number];
  // A deck lets the sun through in some stretches and stands thick and dark in others: how much
  // brighter and darker those are than the deck as a whole, and how many cross one height.
  breaks?: readonly [amount: number, across: number];
}
const OPTICS: Readonly<Partial<Record<CloudKind, Optics>>> = {
  cirrostratus: { extinction: 24.4, spread: 0.94, scatter: 0, deep: 3.8 },
  cirrus: { extinction: 19, spread: 0.16, scatter: 0.22, thin: 0.43, deep: 1.7 },
  stratusBlanket: {
    extinction: 49,
    spread: 0.14,
    scatter: 0.2,
    albedo: 0.74,
    thin: 0.48,
    deep: 1.9,
    pitch: 0.8,
    sharpen: 4,
    ramp: [0.32, 0.82],
    breaks: [0.6, 1.6],
  },
  stormBlanket: {
    extinction: 18.7,
    spread: 0.2,
    scatter: 0.14,
    albedo: 0.95,
    thin: 0.56,
    deep: 4.6,
    pitch: 0.3,
    ramp: [0.15, 0.68],
    feather: 0.04,
    mist: 0.5,
  },
  cirrusBlanket: { extinction: 8, spread: 0.1, scatter: 0, albedo: 0.92, ramp: [0.8, 0.96] },
  altoBlanket: { extinction: 25.5, spread: 0.1, scatter: 0.34, thin: 0.6, deep: 1.7, albedo: 0.82, ramp: [0.15, 0.62] },
  heap: { extinction: 18.7, spread: 0.2, scatter: 0.2, albedo: 0.8, thin: 0.56, deep: 4.6, pitch: 0.3 },
  stratus: {
    extinction: 18.3,
    spread: 0.28,
    scatter: 0.2,
    thin: 0.75,
    deep: 2.4,
    pitch: 0.2,
    feather: 0.05,
    mist: 0.8,
  },
  isolatedStorm: { extinction: 19, spread: 0.88, scatter: 0.29, albedo: 1 },
  wispy: { extinction: 5, spread: 0.9, scatter: 0.45 },
  altostratus: { extinction: 11, spread: 0.18, scatter: 0.3, albedo: 0.82, thin: 0.6, deep: 1.4, pitch: 0.2 },
  cumulus: { extinction: 12.2, spread: 0.44, scatter: 0.3, thin: 0.47, deep: 1.75, pitch: 0.25 },
  nimbus: { extinction: 5.7, spread: 0.27, scatter: 0, thin: 0.7, deep: 3.8, pitch: 0.2, feather: 0.05, mist: 0.8 },
};

// How much slower than the rest the scattered share of light dies away inside a cloud.
const TAIL = 0.2;
// A point on axes turned 35° about the vertical, then 25° about the new horizontal.
const TURN = { a: (35 * Math.PI) / 180, b: (25 * Math.PI) / 180 } as const;
const turned = (x: number, y: number, z: number): readonly [number, number, number] => {
  const ca = Math.cos(TURN.a),
    sa = Math.sin(TURN.a),
    cb = Math.cos(TURN.b),
    sb = Math.sin(TURN.b),
    x1 = x * ca - z * sa,
    z1 = x * sa + z * ca;
  return [x1, y * cb - z1 * sb, y * sb + z1 * cb];
};
// The singles' width in their own heights, and the size of stratus fragments and their tears.
const WIDE = SPRITE_WIDTH / SPRITE_HEIGHT;
const FRAGMENTS = { pieces: 4, erode: 9 } as const;
// Altostratus cloudlets: the noise's cells across (a share of the sprite's width, then its
// height), where they are cut and how sharply, and their lumps' size and depth.
const ALTO = { wide: 1, cells: [7, 15], cut: 0.59, edge: 8, sizes: [18, 22], lumps: 0.35 } as const;
// A cumulus: an ellipsoid cut flat at its base, its surface pushed out and in by
// billows at three sizes, rounded on top with creases between, so it reads as heaped cauliflower.
// `width`, `height` and `depth` are its half-sizes in the sprite's heights.
const DOME = {
  base: 0.88,
  float: 0.55,
  lumps: 0.8,
  lobes: 0.8,
  lobeSize: 2.2,
  outward: 0.15,
  soft: 0.2,
  floor: 0.05,
  warp: 0.1,
  flat: 0.12,
  middle: 0.5,
  tear: [9, 24],
  fine: 0.35,
  sizes: [3.5, 8, 18],
  weights: [0.7, 0.25, 0.05],
} as const;
interface DomeShape {
  width: number;
  height: number;
  depth: number;
  // How far the billows push the surface (the default DOME.lumps), how small they are (1 as for a
  // cumulus), whether the base is cut flat, and how dense it is (1 for a full heap).
  lumps?: number;
  thick?: number;
  scale?: number;
  flat?: boolean;
  // How wide the surface's fall from full to nothing is (the default DOME.soft), and how far fine
  // turbulence tears it into wisps.
  soft?: number;
  fray?: number;
  // How far the large lobes push the outline about (the default DOME.lobes).
  lobes?: number;
}
function domeField(
  seed: number,
  {
    width,
    height,
    depth,
    lumps: push = DOME.lumps,
    scale = 1,
    flat = true,
    thick = 1,
    soft = DOME.soft,
    fray = 0,
    lobes = DOME.lobes,
  }: DomeShape,
): Field {
  const aspect = SPRITE_WIDTH / SPRITE_HEIGHT,
    cx = aspect / 2 + (hash(seed, 1, 5) - 0.5) * 0.1;
  return (x, y, z) => {
    const X = x * aspect,
      wx = X + (fbm3(X * 3, y * 3, z * 3, seed + 11, 3) - 0.5) * DOME.warp,
      wy = y + (fbm3(X * 3 + 7, y * 3, z * 3, seed + 12, 3) - 0.5) * DOME.warp;
    // Widest part way up, then cut flat at the base.
    // Lobes as large as the cloud is tall make each one lopsided rather than a loaf.
    const shell =
      1 -
      Math.hypot(
        (wx - cx) / width,
        (wy - (flat ? DOME.base - height * DOME.middle : DOME.float)) / height,
        (z - 0.5) / depth,
      ) +
      (fbm3(wx * DOME.lobeSize, wy * DOME.lobeSize, z * DOME.lobeSize, seed + 90, 2) - 0.5) * lobes;
    if (shell < -push - fray) return 0;
    // Sampled on axes turned away from the screen's, as the noise's lattice leaves creases along
    // its own axes that a billow sharpens into straight lines.
    const [tx, ty, tz] = turned(wx, wy, z),
      lumps =
        billow(tx * DOME.sizes[0] * scale, ty * DOME.sizes[0] * scale, tz * DOME.sizes[0] * scale, seed, 2) *
          DOME.weights[0] +
        billow(tx * DOME.sizes[1] * scale, ty * DOME.sizes[1] * scale, tz * DOME.sizes[1] * scale, seed + 50, 2) *
          DOME.weights[1] +
        billow(tx * DOME.sizes[2] * scale, ty * DOME.sizes[2] * scale, tz * DOME.sizes[2] * scale, seed + 60, 2) *
          DOME.weights[2];
    // Near the base the lumps die away, so the underside is flat.
    // Billows push in further than out, so none breaks away from the cloud as a speck of its own.
    const mass = shell + Math.min(lumps - 0.45, DOME.outward) * push * (flat ? clamp((DOME.base - wy) / DOME.flat) : 1),
      // Torn at two sizes, the finer one a third as deep: wisps at the rim, and a grain inside.
      tear = fray
        ? (fbm3(tx * DOME.tear[0], ty * DOME.tear[0], tz * DOME.tear[0], seed + 95, 3) -
            0.5 +
            (fbm3(tx * DOME.tear[1], ty * DOME.tear[1], tz * DOME.tear[1], seed + 96, 3) - 0.5) * DOME.fine) *
          fray
        : 0,
      solid = clamp((mass + tear) / soft + 0.5),
      floor = flat
        ? clamp((DOME.base + (fbm3(wx * 6, z * 4, 0, seed + 80, 3) - 0.5) * 0.06 - y) / DOME.floor + 0.5)
        : 1,
      inner = 0.6 + 0.6 * fbm3(wx * 10, wy * 10, z * 10, seed + 70, 3);
    return solid * solid * (3 - 2 * solid) * floor * inner * thick;
  };
}

// A cumulus as it stands in the sky: rounded heads of different heights rising from one base, each
// a ball whose surface billows, joined smoothly where they meet. The heads are brightest and
// firmest at their tops; toward the base the cloud thins into haze rather than ending on a line, and
// its rim is torn into wisps. Sizes are in the sprite's heights.
// The cirrus blanket's strands: how many groups and strands, how far a group's strands scatter
// across and up, their lengths and widths as shares of the sprite, and how steeply they rise.
const CIRRUS = {
  groups: 12,
  strands: 320,
  spread: [0.2, 0.16],
  length: [0.03, 0.12],
  width: [0.0015, 0.006],
  rise: [0.3, 1.1],
  comb: 0.7,
} as const;
// The altostratus blanket's patches: how many cross one height and stand in one, how much of the
// sheet is open, how soft their edges are, the grain within them and how dense they are.
const PATCHES = { across: 9, up: 24, open: 0.52, edge: 0.3, grain: 30, dense: 0.28 } as const;
const HEADS = {
  // Where the base lies, how far above it a head's middle may stand (in its own radii), and how
  // large a head is: its least radius, how much more it may have, and how much the middle ones gain.
  base: 0.76,
  rise: [0.35, 1.25],
  radius: [0.11, 0.13],
  crown: 0.35,
  // How much wider than tall a head is: a heap spreads sideways more than it stands.
  wide: 1.4,
  // How far the heads spread across the sprite and in depth, and how smoothly they join.
  across: [0.16, 0.84],
  deep: 0.24,
  join: 6,
  // The base: a flat body under them all (half-sizes across, up and deep).
  body: [0.5, 0.1, 0.28],
  // The billows on the surface (their sizes, weights and how far they push), the tears at the rim,
  // and how wide the surface's fall from full to nothing is.
  sizes: [5, 11, 24],
  weights: [0.62, 0.26, 0.12],
  push: 0.85,
  // Smaller heads budding from each one's upper sides: how many, how large beside it, and how far out.
  buds: 2,
  bud: [0.45, 0.25],
  out: 0.8,
  // The tears run longer across than up, so the rim trails off in wisps.
  tear: [6, 18],
  streak: 1,
  fray: 0.5,
  soft: 0.42,
  // Where the cloud has thinned to nothing below the base, over how far, and how thin its lower
  // part is beside its top.
  floor: 0.93,
  fade: 0.16,
  haze: 0.55,
  warp: 0.3,
  // How unevenly the cloud's underside ends.
  ragged: 0.45,
  // The height the cloud is enlarged about, and how far its heads are churned.
  centre: 0.6,
  churn: 0.03,
  // The fine turbulence that wears the surface away: how many of its swirls cross one height, and
  // how much of the surface's fall it can take, so the rim ends in fibres rather than on a line.
  wear: [26, 0.55],
  // The fall is narrow along some stretches of the rim and wide along others (its least and most,
  // as shares of `soft`, over swirls this many to a height): firm heads here, trailing wisps there.
  loose: [0.45, 2.2, 2.5],
} as const;
// The puffs adrift beside a heap: how many, their radii, how far out from its middle they lie (in
// its half-widths), how far above its base, how thin they are beside it and how much
// softer their surface is, and how much more worn.
const STRAYS = {
  count: 8,
  radius: [0.035, 0.065],
  out: [0.55, 1.05],
  rise: [0.12, 0.45],
  thin: 0.7,
  soft: 1,
  worn: 2,
} as const;
// `zoom` is how much larger than that the cloud is drawn, so it fills its sprite, and `soft` how
// wide the surface's fall from full to nothing is.
interface HeadsShape {
  thick: number;
  heads: number;
  zoom?: number;
  soft?: number;
  wide?: number;
  rise?: number;
  // For a row of towers rather than one heap: how wide the picture is in its heights, the share of
  // that the heads spread across, where their base lies, and how large they are beside a heap's.
  span?: number;
  across?: readonly [from: number, to: number];
  base?: number;
  size?: number;
  // How much larger than a heap's its billows are.
  billow?: number;
  // How far fine turbulence wears the surface (the default HEADS.wear's).
  wear?: number;
  // How smoothly the heads join (the default HEADS.join): less, and they run into one mass.
  join?: number;
}
function headsField(
  seed: number,
  {
    thick,
    heads,
    zoom = 1,
    soft = HEADS.soft,
    wide = HEADS.wide,
    rise: tall = 1,
    span = WIDE,
    across = HEADS.across,
    base = HEADS.base,
    size = 1,
    billow = 1,
    wear = HEADS.wear[1],
    join = HEADS.join,
  }: HeadsShape,
): Field {
  const aspect = span,
    floor = base + HEADS.floor - HEADS.base,
    reach = ((across[1] - across[0]) * aspect) / 2,
    count = heads + Math.floor(hash(seed, 0, 31) * HEADS.rise.length),
    sizes = HEADS.sizes.map(each => each / billow),
    roots = Array.from({ length: count }, (_, i) => {
      // One heap is tallest at its middle; a rank of towers is as tall anywhere along it.
      const middle = span === WIDE ? Math.sin((Math.PI * (i + 0.5)) / count) : 0.55 + 0.45 * hash(seed, i, 39),
        r =
          (HEADS.radius[0] + HEADS.radius[1] * hash(seed, i, 33)) * (1 - HEADS.crown / 2 + HEADS.crown * middle) * size,
        x = aspect * (across[0] + ((across[1] - across[0]) * (i + 0.2 + 0.6 * hash(seed, i, 32))) / count),
        rise = (HEADS.rise[0] + (HEADS.rise[1] - HEADS.rise[0]) * hash(seed, i, 34) * middle) * tall;
      return [x, base - r * rise, 0.5 + (hash(seed, i, 35) - 0.5) * HEADS.deep, r] as const;
    });
  const balls = roots.flatMap(([x, y, z, r], i) => [
    [x, y, z, r] as const,
    ...Array.from({ length: HEADS.buds }, (_, bud) => {
      const turn = Math.PI * hash(seed, i * HEADS.buds + bud, 36),
        size = r * (HEADS.bud[0] + HEADS.bud[1] * hash(seed, i * HEADS.buds + bud, 37));
      return [
        x + Math.cos(turn) * r * HEADS.out,
        y - Math.sin(turn) * r * HEADS.out,
        z + (hash(seed, i * HEADS.buds + bud, 38) - 0.5) * r,
        size,
      ] as const;
    }),
  ]);
  // Small puffs adrift beside the heap, apart from it or half joined to its flanks.
  const strays = Array.from({ length: STRAYS.count }, (_, i) => {
    const r = (STRAYS.radius[0] + (STRAYS.radius[1] - STRAYS.radius[0]) * hash(seed, i, 51)) * size,
      side = hash(seed, i, 52) < 0.5 ? -1 : 1,
      out = STRAYS.out[0] + (STRAYS.out[1] - STRAYS.out[0]) * hash(seed, i, 53);
    return [
      aspect / 2 + side * reach * out,
      base - STRAYS.rise[0] - (STRAYS.rise[1] - STRAYS.rise[0]) * hash(seed, i, 54),
      0.5 + (hash(seed, i, 55) - 0.5) * HEADS.deep,
      r,
    ] as const;
  });
  return (sx, sy, z) => {
    // Drawn larger about the sprite's middle.
    const x = 0.5 + (sx - 0.5) / zoom,
      y = HEADS.centre + (sy - HEADS.centre) / zoom;
    if (y > floor) return 0;
    const X = x * aspect,
      wx = X + (fbm3(X * 3, y * 3, z * 3, seed + 11, 3) - 0.5) * HEADS.warp,
      wy = y + (fbm3(X * 3 + 7, y * 3, z * 3, seed + 12, 3) - 0.5) * HEADS.warp;
    // How far inside the nearest surface, the heads and the body joined as one.
    let sum = Math.exp(
      join *
        (1 -
          Math.hypot(
            (wx - aspect / 2) / (span === WIDE ? HEADS.body[0] : reach),
            (wy - base) / HEADS.body[1],
            (z - 0.5) / HEADS.body[2],
          )),
    );
    for (const [bx, by, bz, r] of balls)
      sum += Math.exp(join * (1 - Math.hypot((wx - bx) / wide, wy - by, z - bz) / r));
    let adrift = 0;
    for (const [bx, by, bz, r] of strays)
      adrift += Math.exp(join * (1 - Math.hypot((wx - bx) / wide, wy - by, z - bz) / r));
    const inside = Math.log(sum) / join,
      apart = adrift > 0 ? Math.log(adrift) / join : -Infinity;
    if (Math.max(inside, apart) < -HEADS.push - HEADS.fray) return 0;
    // The heads are churned a little, so their creases wander rather than run in clean arcs.
    const churn = (fbm3(X * 7, y * 7, z * 7, seed + 97, 3) - 0.5) * HEADS.churn,
      // The lumps and tears keep their own shapes: laid on the warped outline they are drawn out
      // into strands, and the heap looks combed.
      [tx, ty, tz] = turned(X + churn, y - churn, z + churn),
      lumps = heads3(tx, ty, tz, seed, sizes, HEADS.weights),
      tear =
        (fbm3(tx * HEADS.tear[0] * HEADS.streak, ty * HEADS.tear[0], tz * HEADS.tear[0], seed + 95, 3) -
          0.5 +
          (fbm3(tx * HEADS.tear[1] * HEADS.streak, ty * HEADS.tear[1], tz * HEADS.tear[1], seed + 96, 3) - 0.5) / 2) *
        HEADS.fray,
      rough = (lumps - 0.45) * HEADS.push + tear,
      worn = (fbm3(tx * HEADS.wear[0], ty * HEADS.wear[0], tz * HEADS.wear[0], seed + 98, 4) - 0.5) * wear,
      fall =
        soft *
        (HEADS.loose[0] +
          (HEADS.loose[1] - HEADS.loose[0]) *
            fade(clamp(fbm3(X * HEADS.loose[2], y * HEADS.loose[2], z * HEADS.loose[2], seed + 99, 2) * 2 - 0.5))),
      solid = Math.max(
        clamp((inside + rough + worn) / fall + 0.5),
        clamp((apart + rough + worn * STRAYS.worn) / (fall * STRAYS.soft) + 0.5) * STRAYS.thin,
      ),
      // Thinner the lower it is, and gone by the floor.
      low = clamp((floor - y - HEADS.ragged * fbm3(wx * 4, z * 3, 0, seed + 80, 3)) / HEADS.fade),
      body = HEADS.haze + (1 - HEADS.haze) * clamp((base - wy) / HEADS.fade),
      inner = 0.7 + 0.5 * fbm3(X * 14, y * 14, z * 14, seed + 70, 3);
    return solid * solid * (3 - 2 * solid) * low * low * body * inner * thick;
  };
}

// A layer of cloud seen from under it: a sheet lying level, far deeper than it is thick, whose
// underside hangs in rounded lumps. The sprite's pitch (see Optics) lays it across the picture, its
// near part at the top and its far part at the bottom, as a ceiling of cloud lies to an eye below.
interface DeckShape {
  // How far the sheet reaches away from the eye, in the sprite's heights, and the height of its top.
  far: number;
  top: number;
  // How thick it is where it is thickest, and how much of that is the lumps under it.
  thick: number;
  lumps: number;
  // The size of its large masses (how many cross one height), how much of the sky they leave
  // open (0 none) and how soft their edges are.
  size: number;
  open: number;
  edge: number;
  // The sizes and weights of the lumps, how wide the fall at its underside is, and how dense it is.
  sizes: readonly number[];
  weights: readonly number[];
  soft: number;
  dense: number;
}
function deckField(seed: number, span: number, shape: DeckShape): Field {
  const { far, top, thick, lumps, size, open, edge, sizes, weights, soft, dense } = shape;
  return (x, y, z) => {
    if (y < top - soft) return 0;
    const X = x * span,
      Z = z * far,
      wx = X + (fbm3(X * 1.5, Z * 1.5, 0, seed + 11, 3) - 0.5) * 0.5,
      wz = Z + (fbm3(X * 1.5 + 7, Z * 1.5, 0, seed + 12, 3) - 0.5) * 0.5,
      mass = clamp((fbm3(wx * size, wz * size, 3, seed + 3, 4) - open) / edge + 0.5);
    if (mass <= 0) return 0;
    // The lumps keep their own shapes, off the warped masses (see headsField).
    const [tx, ty, tz] = turned(X, y * 2, Z),
      hang = top + thick * mass * (1 - lumps + lumps * heads3(tx, ty, tz, seed, sizes, weights));
    return (
      clamp((hang - y) / soft) *
      clamp((y - top) / soft + 1) *
      mass *
      (0.7 + 0.6 * fbm3(X * 9, y * 9, Z * 9, seed + 70, 3)) *
      dense
    );
  };
}

// Density at a point in the unit box (x, y across the sprite, y down; z depth).
// One shape per kind of cloud.
export const KINDS: Readonly<Record<CloudKind, (seed: number) => Field>> = {
  // Heaps: an irregular mass whose outline comes
  // from noise rather than spheres, churned by warped billows at three scales so it
  // breaks into lumps and torn, smoky wisps, and shadows itself in fine detail.
  cumulus: seed => headsField(seed, { thick: seed % 2 ? 0.7 : 1, heads: seed % 2 ? 3 : 4, zoom: 1.2, soft: 0.4 }),
  // Stratus blanket: an unbroken grey ceiling, its underside heaped in lumps of every size.
  stratusBlanket: seed =>
    deckField(seed, BLANKET_WIDTH / BLANKET_HEIGHT, {
      far: 3,
      top: 0.36,
      thick: 0.3,
      lumps: 0.9,
      size: 2,
      open: 0.3,
      edge: 0.3,
      sizes: [3, 7, 15, 30],
      weights: [0.4, 0.3, 0.2, 0.1],
      soft: 0.03,
      dense: 1,
    }),
  // Cumulonimbus blanket: a rank of towers standing shoulder to shoulder, their heads running off
  // the top and their bases lost in haze.
  stormBlanket: seed =>
    headsField(seed + 300, {
      thick: 3,
      heads: 7,
      soft: 0.5,
      wide: 1.15,
      rise: 1.5,
      billow: 1.7,
      wear: 0,
      join: 4,
      span: BLANKET_WIDTH / BLANKET_HEIGHT,
      across: [-0.2, 1.03],
      base: 0.6,
      size: 1.4,
    }),
  // Altostratus blanket: a thin sheet broken into small soft patches, a little wider than tall, with
  // open sky between them.
  altoBlanket: seed => (x, y, z) => {
    const X = (x * BLANKET_WIDTH) / BLANKET_HEIGHT,
      [tx, ty, tz] = turned(X * PATCHES.across, y * PATCHES.up, z * 2),
      patch = clamp((fbm3(tx, ty, tz, seed + 3, 4) - PATCHES.open) / PATCHES.edge + 0.5);
    if (patch <= 0) return 0;
    const grain = clamp(fbm3(X * PATCHES.grain, y * PATCHES.grain, z * 6, seed + 70, 3) * 3 - 0.7);
    return patch * patch * grain * Math.exp(-(((z - 0.5) / 0.2) ** 2)) * PATCHES.dense;
  },
  // Cirrus blanket: sparse brushed strands in loose groups over the whole of a clear sky, each
  // short, fine and rising to one side.
  cirrusBlanket(seed) {
    const random = (i: number, salt: number) => hash(seed, i, salt),
      groups = Array.from({ length: CIRRUS.groups }, (_, i) => [random(i, 41), 0.08 + random(i, 42) * 0.74] as const),
      strands = Array.from({ length: CIRRUS.strands }, (_, i) => {
        const [gx, gy] = groups[i % CIRRUS.groups] ?? [0.5, 0.5],
          length = CIRRUS.length[0] + random(i, 43) * (CIRRUS.length[1] - CIRRUS.length[0]),
          start = gx + (random(i, 44) - 0.5) * CIRRUS.spread[0] - length / 2;
        return [
          start,
          start + length,
          gy + (random(i, 45) - 0.5) * CIRRUS.spread[1],
          CIRRUS.width[0] + random(i, 46) ** 2 * (CIRRUS.width[1] - CIRRUS.width[0]),
          0.35 + random(i, 47) * 0.65,
          CIRRUS.rise[0] +
            random(i % CIRRUS.groups, 48) * (CIRRUS.rise[1] - CIRRUS.rise[0]) +
            (random(i, 49) - 0.5) * 0.2,
        ] as const;
      });
    return (x, y, z) => {
      let value = 0;
      for (const [from, to, y0, width, strength, rise] of strands) {
        if (x < from || x > to) continue;
        const t = (x - from) / (to - from),
          taper = Math.sin(t * Math.PI) ** 0.7,
          centre = y0 - (x - (from + to) / 2) * rise + (fbm3(x * 9, y0 * 7, 0, seed + 3, 3) - 0.5) * 0.03,
          across = Math.exp(-(((y - centre) / (width * (0.35 + taper))) ** 2));
        if (across < 0.01) continue;
        value += across * clamp(fbm3(x * 12, y0 * 9, 0, seed + 5, 4) * 2.4 - 0.6) * strength * taper;
      }
      if (value <= 0) return 0;
      const comb = 0.3 + 0.7 * fbm3(x * 6, (y + x * CIRRUS.comb) * 160, 0, seed + 9, 3);
      return clamp(value * comb * 1.6) * Math.exp(-(((z - 0.5) / 0.25) ** 2)) * 0.35;
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
  heap: seed => headsField(seed + 200, { thick: 3, heads: 5, zoom: 1.22, soft: 0.5, wide: 1.25, rise: 1.5 }),
  // Thin feathery strands on a rising diagonal, broken along their length.
  cirrus(seed) {
    // Each strand: start, end, height, width and strength; tapered at both ends.
    const random = (i: number) => hash(seed, i, 11),
      strands = Array.from(
        { length: 12 + Math.floor(random(0) * 8) },
        (_, i): readonly [number, number, number, number, number] => {
          const start = random(i + 1) * 0.85,
            length = 0.06 + random(i + 3) * 0.2;
          return [
            start,
            Math.min(0.98, start + length),
            0.2 + random(i + 5) * 0.6,
            0.004 + random(i + 7) ** 2 * 0.016,
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
        const centre = y0 - (x - 0.5) * 0.75 + (t * t - t) * 0.03 + (fbm3(x * 4, y0 * 7, 0, seed + 3, 3) - 0.5) * 0.06;
        const across = Math.exp(-(((y - centre) / (width * (0.4 + taper))) ** 2)),
          along = clamp(fbm3(x * 14, y0 * 9, z, seed + 5, 4) * 4 - 1.7);
        value += across * along * strength * taper;
      }
      // Fine fibres combed along the strands: sparse, crisp filaments.
      const depth = Math.exp(-(((z - 0.5) / 0.22) ** 2)),
        comb = 0.25 + 0.75 * fbm3(x * 3, (y + x * 0.75) * 90, z * 4, seed + 9, 3);
      return clamp(value * comb * depth * 1.4) * 0.3;
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
      return puffs * mottle * clamp(area * 2) * 0.25;
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
      const wx = x + (fbm3(x * 3, y * 3, z * 3, seed + 21, 3) - 0.5) * 0.08,
        [tx, ty, tz] = turned(wx * ALTO.wide, tilt, z);
      // Cloudlets: peaks of a squashed noise, cut off so they stand apart.
      const lets = clamp((fbm3(tx * ALTO.cells[0], ty * ALTO.cells[1], tz * 4, seed + 33, 4) - ALTO.cut) * ALTO.edge),
        groups = clamp((fbm3(x * 2.6, y * 2.6, z * 2, seed + 5, 3) - 0.4) * 4);
      const lumps = 1 - billow(tx * ALTO.sizes[0], ty * ALTO.sizes[1], tz * 10, seed, 3) * ALTO.lumps,
        haze = fbm3(x * 4, tilt * 9, z * 3, seed + 9, 3) * 0.02;
      return (lets * lets * lumps * groups * 3.5 + haze * groups) * band ** 0.6;
    };
  },
  // Cirrostratus: a few brushed patches of fibrous streaks,
  // fanning along a diagonal and fraying at their ends, high behind everything.
  cirrostratus(seed) {
    return (x, y, z) => {
      const veil = clamp(1 - Math.hypot((x - 0.5) / 0.46, (y - 0.5 + (x - 0.5) * 0.3) / 0.36));
      if (veil <= 0) return 0;
      const along = y + x * 0.3 + (fbm3(x * 2, y * 2, 0, seed + 3, 3) - 0.5) * 0.12,
        patches = clamp((fbm3(...turned(x * 3.4, y * 2.6, z * 2), seed + 21, 4) - 0.56) * 6);
      const strands = fbm3(x * 2, along * 14, z * 3, seed, 4),
        fine = fbm3(x * 3, along * 70, z * 6, seed + 7, 3);
      return (
        clamp((strands - 0.3) * 3) *
        (0.3 + 0.7 * fine) *
        (0.5 + 0.7 * billow(...turned(x * 9, y * 6, z * 4), seed + 40, 3)) *
        patches *
        clamp(veil * 2) *
        Math.exp(-(((z - 0.5) / 0.25) ** 2)) *
        1.1
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
      // Fragments: peaks of mid-scale noise, torn by finer billows, as round across as they are tall
      // and on turned axes, so they puff rather than streak.
      const [tx, ty, tz] = turned(wx * WIDE, wy, z),
        pieces = fbm3(tx * FRAGMENTS.pieces, ty * FRAGMENTS.pieces, tz * 4, seed + 33, 4) - 0.52 + band * 0.1,
        erode =
          billow(tx * FRAGMENTS.erode, ty * FRAGMENTS.erode, tz * 9, seed, 3) * 0.6 +
          billow(tx * FRAGMENTS.erode * 2.2, ty * FRAGMENTS.erode * 2.2, tz * 16, seed + 60, 2) * 0.4;
      const inner = 0.3 + 1.3 * fbm3(tx * 12, ty * 12, tz * 12, seed + 70, 3) ** 1.4;
      return clamp((pieces - erode * 0.22 + 0.02) * 7) ** 1.3 * inner * clamp(band * 3);
    };
  },

  // Nimbostratus: ragged grey heaps, broken all over by billows and with no flat base.
  nimbus: seed => domeField(seed + 300, { width: 0.75, height: 0.3, depth: 0.32, lumps: 1.7, scale: 1.3, flat: false }),
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
// The density around each point: the field averaged over a box `reach` of the unit box across in
// every direction, a running sum along each axis in turn.
function crowded(
  field: Float32Array,
  width: number,
  height: number,
  depth: number,
  reach: number,
): Float32Array<ArrayBuffer> {
  const out = Float32Array.from(field),
    scratch = new Float32Array(Math.max(width, height, depth));
  const pass = (
    count: number,
    radius: number,
    at: (i: number) => number,
    lines: number,
    line: (l: number) => number,
  ) => {
    if (radius < 1) return;
    for (let l = 0; l < lines; l++) {
      const start = line(l);
      for (let i = 0; i < count; i++) scratch[i] = out[start + at(i)] ?? 0;
      let sum = 0;
      for (let i = -radius; i <= radius; i++) sum += scratch[Math.min(count - 1, Math.max(0, i))] ?? 0;
      for (let i = 0; i < count; i++) {
        out[start + at(i)] = sum / (radius * 2 + 1);
        sum += (scratch[Math.min(count - 1, i + radius + 1)] ?? 0) - (scratch[Math.max(0, i - radius)] ?? 0);
      }
    }
  };
  const plane = width * height;
  pass(
    width,
    Math.round(reach * width),
    i => i,
    height * depth,
    l => l * width,
  );
  pass(
    height,
    Math.round(reach * height),
    i => i * width,
    width * depth,
    l => Math.floor(l / width) * plane + (l % width),
  );
  pass(
    depth,
    Math.round(reach * depth),
    i => i * plane,
    plane,
    l => l,
  );
  return out;
}

// A cloud's density in every cell of its box, `depth` cells deep, front first.
// The share of a blanket's width over which its right side gives way to its left side's lead-in.
const LAP = 0.14;
export function cloudField(
  kind: CloudKind,
  seed: number,
  width: number,
  height: number,
  depth = 32,
): Float32Array<ArrayBuffer> {
  // Every sprite fades to nothing before its edges, whatever its kind, so no
  // border can show where sprites overlap the sky.
  // Blankets run edge to edge, side by side as they drift, and their tops run off the top of the
  // card, so only their bottoms fade.
  const wide = BLANKETS.some(([name]) => name === kind),
    shape = KINDS[kind](seed),
    border = (x: number, y: number) =>
      kind === 'isolatedStorm'
        ? 1
        : wide
          ? clamp((1 - y) / 0.06)
          : clamp(Math.min(x, 1 - x) / 0.04) * clamp(Math.min(y, 1 - y) / 0.06);
  const field = new Float32Array(width * height * depth),
    pitch = OPTICS[kind]?.pitch ?? 0;
  for (let z = 0; z < depth; z++)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const u = (x + 0.5) / width,
          v = (y + 0.5) / height,
          w = (z + 0.5) / depth;
        // A blanket's right side turns into what lies left of its left side, so the next copy
        // carries on from it without a join.
        const lap = wide ? fade(clamp((u - 1 + LAP) / LAP)) : 0,
          here = shape(u, v - pitch * (w - 0.5), w);
        field[(z * height + y) * width + x] =
          (lap > 0 ? here + (shape(u - 1, v - pitch * (w - 0.5), w) - here) * lap : here) * border(u, v);
      }
  return field;
}

// How far in from a free sprite's sides, and from its top and bottom, its cover fades out, as shares
// of its width and height.
// Thins a sprite's cover toward its outline: the cover is averaged over `radius` cells either way,
// three times over. Along an edge that average is about a half, and the cover there is cut to
// nearly nothing; it is whole again where the average is, a radius or so inside. So the outline
// is a fall as wide as the radius, drawn in from where the cloud's own edge was.
const OUTLINE = { gone: 0.44, whole: 0.7, least: 0.1 } as const;
// The outline is uneven: the fall is pushed in and out by tufts (how many cross one height, at two
// sizes, and the second's share), by `reach` of the fall's own width, so the edge ends in small
// puffs and wisps with gaps between them rather than along one smooth line.
// Past the tufts a thin veil of cloud (`veil` of full cover) trails a little further out.
const TUFTS = { sizes: [8, 24, 70], fine: 0.55, fray: 0.22, reach: 1.3, veil: 0.3, trail: 0.2 } as const;
// Over how much of the sprite's height above `mist` the tufts come in.
const MIST_FALL = 0.15;
function softenOutline(
  maps: Float32Array,
  width: number,
  height: number,
  radius: number,
  seed: number,
  mist: number,
): void {
  let cover = new Float32Array(width * height),
    next = new Float32Array(width * height);
  for (let p = 0; p < cover.length; p++) cover[p] = maps[p * 7 + 6] ?? 0;
  const span = radius * 2 + 1;
  for (let pass = 0; pass < 3; pass++) {
    for (const [lines, cells, step, stride] of [
      [height, width, 1, width],
      [width, height, width, 1],
    ] as const) {
      for (let line = 0; line < lines; line++) {
        let sum = 0;
        const at = (i: number) => cover[line * stride + Math.min(cells - 1, Math.max(0, i)) * step] ?? 0;
        for (let i = -radius; i <= radius; i++) sum += at(i);
        for (let i = 0; i < cells; i++) {
          next[line * stride + i * step] = sum / span;
          sum += at(i + radius + 1) - at(i - radius);
        }
      }
      [cover, next] = [next, cover];
    }
  }
  // A puff smaller than the fall would average to nothing and be lost, so the average is taken
  // against the most it reaches nearby: a small puff keeps its middle and a large mass its inside.
  let most = cover.slice();
  for (const [lines, cells, step, stride] of [
    [height, width, 1, width],
    [width, height, width, 1],
  ] as const) {
    for (let line = 0; line < lines; line++)
      for (let i = 0; i < cells; i++) {
        let top = 0;
        for (let k = Math.max(0, i - radius * 2); k <= Math.min(cells - 1, i + radius * 2); k++)
          top = Math.max(top, most[line * stride + k * step] ?? 0);
        next[line * stride + i * step] = top;
      }
    [most, next] = [next, most];
  }
  for (let p = 0; p < cover.length; p++) {
    const x = (p % width) / height,
      y = Math.floor(p / width) / height,
      inside = (cover[p] ?? 0) / Math.max(most[p] ?? 0, OUTLINE.least),
      // Rounded bumps (the first two sizes folded about their middle) with fine fray over them.
      bump = (size: number, add: number) => Math.abs(fbm3(x * size, y * size, 0, seed + add, 4) - 0.5) * 2 - 0.3,
      tuft =
        bump(TUFTS.sizes[0], 61) +
        bump(TUFTS.sizes[1], 62) * TUFTS.fine +
        (fbm3(x * TUFTS.sizes[2], y * TUFTS.sizes[2], 0, seed + 63, 3) - 0.5) * TUFTS.fray,
      // The tufts move the edge only: deep inside the cloud stays whole.
      edge = inside + tuft * TUFTS.reach * 2 * (1 - inside);
    const whole = fade(clamp((edge - OUTLINE.gone) / (OUTLINE.whole - OUTLINE.gone))),
      veil = fade(clamp((edge - OUTLINE.gone + TUFTS.trail) / (OUTLINE.whole - OUTLINE.gone)));
    // Toward its base the cloud keeps its own soft fall: tufts there hang under it as dark crumbs.
    const tufted = clamp((mist - y) / MIST_FALL);
    maps[p * 7 + 6] = (maps[p * 7 + 6] ?? 0) * (1 + (whole + (veil - whole) * TUFTS.veil - 1) * tufted);
  }
}
// A blanket's copies lie side by side, and light from one side reaches its two ends differently.
// Over LAP of its width at each end, every map is drawn toward the mean of the two ends on that
// row, so one copy's end meets the next one's start at the same value.
function joinEnds(maps: Float32Array, width: number, height: number): void {
  const band = Math.round(width * LAP);
  for (let y = 0; y < height; y++)
    for (let k = 0; k < 7; k++) {
      const at = (x: number) => (y * width + x) * 7 + k,
        first = maps[at(0)] ?? 0,
        last = maps[at(width - 1)] ?? 0;
      for (let x = 0; x < band; x++) {
        const share = fade(1 - x / band) / 2;
        maps[at(x)] = (maps[at(x)] ?? 0) + (last - first) * share;
        maps[at(width - 1 - x)] = (maps[at(width - 1 - x)] ?? 0) + (first - last) * share;
      }
    }
}
// How much taller than wide a deck's bright and dark stretches are sampled, and how sharply one
// gives way to the next.
const BREAK_FLAT = 2;
const BREAK_EDGE = 5;
// How much of a blanket's height stands for the cloud above the picture.
const LEAD = 0.04;
const RIM = { side: 0.09, end: 0.12 } as const;
export function bakeCloud(
  kind: CloudKind,
  seed: number,
  width: number,
  height: number,
  depth = 32,
  field = cloudField(kind, seed, width, height, depth),
): BakedSprite {
  const optics: Optics = OPTICS[kind] ?? {},
    {
      extinction = 6,
      spread = 0.85,
      scatter = 0.35,
      albedo = 1,
      sharpen = 0,
      occlusion = 0,
      reach = 0.04,
      thin = 1,
      diffuse = 0,
      deep = 1,
      ramp,
      pitch = 0,
      breaks,
      feather = 0,
      mist = 1,
    } = optics;
  const n = width * height * depth;
  // A sprite that stands alone thins to nothing toward its edges, however dense the cloud there:
  // a thick cloud's cover is whole a few cells in from where its density starts, and drawn several
  // times its size that reads as a straight cut.
  const free = kind !== 'isolatedStorm' && !BLANKETS.some(([name]) => name === kind);
  const wide = BLANKETS.some(([name]) => name === kind);
  const index = (x: number, y: number, z: number) => (z * height + y) * width + x;
  // Optical depth per step, in the sprite's heights, so its thickness is the same at any resolution.
  // A cell is as deep to light across as it is up and down, though the sprite is wider than tall.
  const dx = extinction / height,
    dy = extinction / height,
    dz = extinction / depth;
  // Light travels further into the cloud than the eye sees: multiple scattering.
  // Transmittance toward each light: x+ (light from the right), x−, y+ (from above), y−, z+ (from the viewer's side), z− (from behind).
  const light = Array.from({ length: 6 }, () => new Float32Array(n)),
    crowd = occlusion ? crowded(field, width, height, depth, reach) : null;
  const lit = (tau: number, i: number) =>
    (Math.exp(-tau) * (1 - scatter) + Math.exp(-tau * TAIL) * scatter) *
    (crowd ? Math.exp(-occlusion * (crowd[i] ?? 0)) : 1);
  type Pair = readonly [number, number];
  const sweep = (
    target: Float32Array | undefined,
    outer: readonly Pair[],
    along: (start: Pair) => number[],
    scale: number,
    lead = 0,
  ) => {
    if (!target) return;
    for (const start of outer) {
      const cells = along(start);
      // A blanket goes on above the picture: its light from above has already crossed as much
      // cloud as lies in the first rows it meets here.
      let tau = 0;
      for (let k = 0; k < lead; k++) tau += (field[cells[k] ?? 0] ?? 0) * scale * spread;
      for (const i of cells) {
        target[i] = lit(tau, i);
        tau += (field[i] ?? 0) * scale * spread;
      }
    }
  };
  const rows: Pair[] = [],
    columns: Pair[] = [];
  for (let z = 0; z < depth; z++) for (let y = 0; y < height; y++) rows.push([y, z]);
  for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) columns.push([x, z]);
  const range = (count: number, reverse: boolean, map: (i: number) => number) => {
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(map(reverse ? count - 1 - i : i));
    return out;
  };
  sweep(light[0], rows, ([y, z]) => range(width, true, x => index(x, y, z)), dx);
  sweep(light[1], rows, ([y, z]) => range(width, false, x => index(x, y, z)), dx);
  sweep(
    light[2],
    columns,
    ([x, z]) => range(height, false, y => index(x, y, z)),
    dy,
    free ? 0 : Math.round(height * LEAD),
  );
  sweep(light[3], columns, ([x, z]) => range(height, true, y => index(x, y, z)), dy);
  // Light from the viewer's side and from behind crosses the cloud a layer of depth at a time. Level
  // light climbs the sprite as it goes deeper, by the pitch, so what each layer has crossed is
  // carried up or down a part of a row between one layer and the next.
  const through = (target: Float32Array | undefined, reverse: boolean, scale: number) => {
    if (!target) return;
    const plane = width * height,
      rise = ((reverse ? -pitch : pitch) * height) / depth,
      whole = Math.floor(rise),
      part = rise - whole;
    let crossed = new Float32Array(plane),
      next = new Float32Array(plane);
    for (let step = 0; step < depth; step++) {
      const z = reverse ? depth - 1 - step : step;
      for (let p = 0; p < plane; p++) {
        const i = z * plane + p;
        target[i] = lit(crossed[p] ?? 0, i);
        crossed[p] = (crossed[p] ?? 0) + (field[i] ?? 0) * scale * spread;
      }
      if (rise === 0) continue;
      for (let y = 0; y < height; y++) {
        const from = y - whole;
        for (let x = 0; x < width; x++)
          next[y * width + x] =
            (from >= 0 && from < height ? (crossed[from * width + x] ?? 0) * (1 - part) : 0) +
            (from >= 1 && from <= height ? (crossed[(from - 1) * width + x] ?? 0) * part : 0);
      }
      [crossed, next] = [next, crossed];
    }
  };
  through(light[4], false, dz * deep);
  through(light[5], true, dz * deep);
  // Three box blurs in turn come close to a smooth one: one alone leaves square-edged blocks.
  if (diffuse)
    for (const [k, field] of light.entries()) {
      let soft = field;
      for (let pass = 0; pass < 3; pass++) soft = crowded(soft, width, height, depth, diffuse / 2);
      light[k] = soft;
    }
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
      const faint = thin + (1 - thin) * alpha;
      // Wider than tall, as stretches of a deck seen from under it lie.
      const lift = breaks
        ? 1 +
          breaks[0] *
            clamp(
              (fbm3((x / height) * breaks[1], (y / height) * breaks[1] * BREAK_FLAT, 0, seed + 61, 4) - 0.5) *
                BREAK_EDGE,
              -1,
              1,
            )
        : 1;
      for (let k = 0; k < 6; k++)
        maps[p + k] = alpha > 0.001 ? clamp(((sums[k] ?? 0) / alpha) * albedo * faint * lift) : 0;
      const u = (x + 0.5) / width,
        v = (y + 0.5) / height,
        rim = free ? fade(clamp(Math.min(u, 1 - u) / RIM.side)) * fade(clamp(Math.min(v, 1 - v) / RIM.end)) : 1;
      maps[p + 6] = (ramp ? alpha * (1 - fade(clamp((v - ramp[0]) / (ramp[1] - ramp[0])))) : alpha) * rim;
    }
  if (feather) softenOutline(maps, width, height, Math.max(1, Math.round(feather * height)), seed, mist);
  const drawn = sharpen ? sharpened(maps, width, height, sharpen) : maps;
  if (wide) joinEnds(drawn, width, height);
  return { kind, seed, width, height, maps: drawn };
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
