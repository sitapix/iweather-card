import { finite } from '../lib/values.ts';
import { context2d, hash } from '../lib/canvas.ts';
import { effectImage } from './effect-art.ts';

// Rain on the glass: still beads and running drops over the blurred background, each a tiny
// lens (refraction) with a highlight, at one of three densities ("tiers").
// Each drop shows the sky behind it flipped and shrunk, as a water lens does,
// with a dark lower rim and a bright upper highlight. Still beads appear and
// evaporate; a few run down the panel, leaving smaller beads behind.

// A glass panel, in CSS px.
export interface Panel {
  x: number;
  y: number;
  width: number;
  height: number;
  radius?: number;
}
export interface DropLook {
  scale: number;
  refraction: number;
  highlight: number;
  opacity: number;
  still: number;
  moving: number;
  stillTime: number;
}
// Parameters per tier: scale, refraction, highlight, layer opacity, still and moving density, and the
// still beads' time multiplier. Drops keep their size across tiers; only how many
// sit and how many run changes.
export const DROP_TIERS: Readonly<Record<number, DropLook>> = {
  1: { scale: 1.2, refraction: 8, highlight: 0.75, opacity: 0.35, still: 0.6, moving: 0.25, stillTime: 2.15 },
  2: { scale: 1.18, refraction: 8, highlight: 0.75, opacity: 0.35, still: 0.85, moving: 0.65, stillTime: 2.15 },
  3: { scale: 1.16, refraction: 8, highlight: 0.75, opacity: 0.35, still: 0.95, moving: 0.95, stillTime: 2.15 },
};
// Frost: crystal scale, overlay and additive layer opacity, and the additive
// layer's mask (strength at the top and bottom edges, and how much it applies).
export const FROST_LOOK: Readonly<{
  scale: number;
  overlay: number;
  additive: number;
  maskTop: number;
  maskBottom: number;
  maskAmount: number;
}> = { scale: 7, overlay: 0.15, additive: 0.07, maskTop: 1, maskBottom: 0.4, maskAmount: 0.73 };
// In this canvas: still beads per 10,000 px² at full density, running drops per
// 10,000 px² at full moving density, and bead radius in px at scale 1.
const BEADS = 5.5,
  RUNNERS = 0.55,
  RADIUS: readonly [number, number] = [1.4, 3.3];
export interface Tier {
  density: number;
  running: number;
  size: readonly [low: number, high: number];
  look: DropLook;
}
export const TIERS: Readonly<Record<number, Tier>> = Object.fromEntries(
  Object.entries(DROP_TIERS).map(([tier, a]): [string, Tier] => [
    tier,
    {
      density: BEADS * a.still + RUNNERS * a.moving,
      running: (RUNNERS * a.moving) / (BEADS * a.still + RUNNERS * a.moving),
      size: [RADIUS[0] * a.scale, RADIUS[1] * a.scale],
      look: a,
    },
  ]),
);
// The tier is fixed per condition, not by how hard it rains: drizzle and wintry mix get the lightest,
// rain, showers, sleet and ordinary storms the middle, heavy rain and big storms the
// heaviest. Hail, isolated storms, fog, haze and dust get none.
const DROP_KINDS: Readonly<Record<string, 1 | 2 | 3>> = {
  drizzle: 1,
  freezingDrizzle: 1,
  wintryMix: 1,
  rain: 2,
  sunShowers: 2,
  sleet: 2,
  freezingRain: 2,
  thunderstorms: 2,
  scatteredThunderstorms: 2,
  heavyRain: 3,
  strongStorms: 3,
  tropicalStorm: 3,
  hurricane: 3,
};
export const dropletTier = (kind: string): 0 | 1 | 2 | 3 => DROP_KINDS[kind] ?? 0;

// Drops for one panel rect at a moment in time: each bead has its own lifetime,
// so the glass slowly refreshes; running drops accelerate down and wrap.
// A bead on the glass; a running drop also has its trail's length (0–1).
export type Drop = { x: number; y: number; r: number; alpha: number } & (
  | { running: true; trail: number }
  | { running?: never; trail?: never }
);
export function dropletsFor(rect: Panel, index: number, tier: number, time: number): Drop[] {
  const t = TIERS[tier];
  if (!t) return [];
  const count = Math.round(((rect.width * rect.height) / 10000) * t.density),
    drops: Drop[] = [];
  for (let i = 0; i < count; i++) {
    const r = (n: number) => hash(index * 7919 + i, n),
      size = t.size[0] + (t.size[1] - t.size[0]) * r(1) ** 2;
    if (r(2) < t.running) {
      // Runs for a few seconds out of every period, from a random start near the top.
      const period = 7000 + r(3) * 9000,
        age = (time + r(4) * period) % period,
        run = Math.min(1, age / 2600);
      const x = rect.x + r(5) * rect.width,
        y = rect.y + r(6) * rect.height * 0.4 + run * run * rect.height * 0.9;
      if (y < rect.y + rect.height - size)
        drops.push({ x: x + Math.sin(age / 300 + i) * 1.2, y, r: size * 1.25, alpha: 1, running: true, trail: run });
      continue;
    }
    // Still beads: fade in, sit, then evaporate, slowed by the tier's time multiplier.
    const life = (4500 + r(7) * 7000) * t.look.stillTime,
      age = (time + r(8) * life) % life,
      fade = Math.min(1, age / 900, (life - age) / 1800);
    drops.push({ x: rect.x + r(9) * rect.width, y: rect.y + r(10) * rect.height, r: size, alpha: Math.max(0, fade) });
  }
  return drops;
}

// Paints drops for every panel onto `ctx` (in CSS pixels). `sky` is the scene canvas
// behind the panels, `skyScale` its device-pixel ratio; `clip` rounds each panel.
export function paintDroplets(
  ctx: CanvasRenderingContext2D,
  panels: readonly Panel[],
  tier: number,
  time: number,
  sky: HTMLCanvasElement | null | undefined,
  skyScale = 1,
): void {
  const look = DROP_TIERS[tier];
  panels.forEach((rect, index) => {
    const drops = dropletsFor(rect, index, tier, time);
    if (!drops.length || !look) return;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, rect.radius ?? 0);
    ctx.clip();
    for (const drop of drops) {
      if (drop.alpha < 0.02) continue;
      const { x, y, r } = drop;
      ctx.globalAlpha = drop.alpha;
      // Running drops leave a short wet trail.
      if (drop.running && drop.trail > 0.05) {
        const trail = ctx.createLinearGradient(x, y - r * 10 * drop.trail, x, y);
        trail.addColorStop(0, '#ffffff00');
        trail.addColorStop(1, '#ffffff22');
        ctx.fillStyle = trail;
        ctx.fillRect(x - r * 0.45, y - r * 10 * drop.trail, r * 0.9, r * 10 * drop.trail);
      }
      // A faint shadow where the bead sits on the glass.
      ctx.fillStyle = '#0a14281c';
      ctx.beginPath();
      ctx.ellipse(x + r * 0.15, y + r * 0.35, r * 1.05, r * (drop.running ? 1.2 : 1.02), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (drop.running ? 1.15 : 1), 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = '#ffffff10';
      ctx.fillRect(x - r, y - r * 1.2, r * 2, r * 2.4);
      // The lens: a wider patch of sky, flipped and shrunk into the bead. The
      // refraction strength (8) sets how far it reaches; the layer opacity, how much shows.
      const reach = (r * look.refraction) / 2,
        sx = (x - reach) * skyScale,
        sy = (y - reach) * skyScale;
      if (
        sky &&
        sx >= 0 &&
        sy >= 0 &&
        sx + reach * 2 * skyScale <= sky.width &&
        sy + reach * 2 * skyScale <= sky.height
      ) {
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(1, -1);
        ctx.globalAlpha = drop.alpha * Math.min(1, look.opacity * 2.6);
        ctx.drawImage(sky, sx, sy, reach * 2 * skyScale, reach * 2 * skyScale, -r, -r * 1.15, r * 2, r * 2.3);
        ctx.restore();
      } else {
        ctx.fillStyle = '#ffffff1f';
        ctx.fillRect(x - r, y - r * 1.2, r * 2, r * 2.4);
      }
      ctx.globalAlpha = drop.alpha;
      // Shaded lower rim and a soft shadow side, then the highlight up and to the left.
      const rim = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.2, x, y, r * 1.1);
      rim.addColorStop(0, '#ffffff00');
      rim.addColorStop(0.62, '#00000000');
      rim.addColorStop(1, '#0a1a308c');
      ctx.fillStyle = rim;
      ctx.fillRect(x - r * 1.2, y - r * 1.4, r * 2.4, r * 2.8);
      ctx.restore();
      ctx.globalAlpha = drop.alpha * look.highlight;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(x - r * 0.32, y - r * 0.42, r * 0.24, r * 0.17, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = drop.alpha;
      // Light gathered by the lens at its lower edge.
      ctx.fillStyle = '#ffffff2e';
      ctx.beginPath();
      ctx.ellipse(x + r * 0.1, y + r * 0.55, r * 0.5, r * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
  ctx.globalAlpha = 1;
}

// Frost: starburst ice crystals (four variants) laid over the glass in two layers, one overlaid and one added as a glow,
// gathered toward each panel's top and bottom edges by the additive mask.
// Frost shows below 20 °F (rounded) in snow, or in calm and cloudy skies between
// 5 and 8 in the morning, local time. Rain, storms and everything else never frost.
export const FROST_KINDS: ReadonlySet<string> = new Set([
  'snow',
  'heavySnow',
  'flurries',
  'sunFlurries',
  'blizzard',
  'blowingSnow',
]);
const MORNING_FROST = /^(clear|mostlyClear|frigid|windy|breezy|(partly|mostly)?[cC]loudy.*)$/;
export const frostEffect = (kind: string | undefined, celsius: number | undefined, hour: number): boolean => {
  const cold = finite(celsius) && Math.round((celsius * 9) / 5 + 32) < 20;
  return (
    cold && ((kind !== undefined && FROST_KINDS.has(kind)) || (MORNING_FROST.test(kind ?? '') && hour >= 5 && hour < 9))
  );
};

// One crystal: arms of fern-like ice from a dense core, drawn once per variant.
function crystal(seed: number, size = 160): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = context2d(canvas),
    centre = size / 2,
    random = (n: number) => hash(seed * 31 + n, 7);
  c.lineCap = 'round';
  let n = 0;
  const branch = (x: number, y: number, angle: number, length: number, depth: number) => {
    let px = x,
      py = y;
    const steps = Math.max(3, Math.round(length / 4));
    for (let i = 1; i <= steps; i++) {
      const wander = (random(n++) - 0.5) * 0.5,
        nx = px + (Math.cos(angle + wander) * length) / steps,
        ny = py + (Math.sin(angle + wander) * length) / steps;
      c.globalAlpha = (0.55 * (1 - (i / steps) * 0.6)) / (depth + 1);
      c.lineWidth = Math.max(0.35, 1.1 - depth * 0.35);
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(nx, ny);
      c.stroke();
      // Side shoots at about 60°, shorter at every level.
      if (depth < 3 && random(n++) < 0.55)
        branch(
          nx,
          ny,
          angle + (random(n++) < 0.5 ? 1 : -1) * (0.9 + random(n++) * 0.3),
          length * (0.32 + random(n++) * 0.2) * (1 - (i / steps) * 0.5),
          depth + 1,
        );
      px = nx;
      py = ny;
    }
  };
  c.strokeStyle = '#f4f8ff';
  const arms = 7 + Math.floor(random(1) * 4);
  for (let a = 0; a < arms; a++)
    branch(centre, centre, (a / arms) * Math.PI * 2 + random(a + 10) * 0.4, size * (0.3 + random(a + 20) * 0.17), 0);
  // The dense, frosted core.
  const core = c.createRadialGradient(centre, centre, 0, centre, centre, size * 0.16);
  core.addColorStop(0, '#ffffff66');
  core.addColorStop(1, '#ffffff00');
  c.globalAlpha = 1;
  c.fillStyle = core;
  c.fillRect(0, 0, size, size);
  // Fine rime speckle.
  for (let i = 0; i < 260; i++) {
    const r = Math.sqrt(random(i + 400)) * size * 0.42,
      t = random(i + 800) * Math.PI * 2;
    c.globalAlpha = 0.25 + random(i + 1200) * 0.35;
    c.fillStyle = '#ffffff';
    c.fillRect(centre + Math.cos(t) * r, centre + Math.sin(t) * r, 0.8, 0.8);
  }
  return canvas;
}
let crystals: HTMLCanvasElement[] | null = null;
// Crystals for one panel, seeded: most of them near the top and bottom edges.
// Crystals tile at scale 7 (about seven across the glass); the additive
// mask is strongest at the top (1.0) and weaker at the bottom (0.4).
export interface FrostPiece {
  x: number;
  y: number;
  size: number;
  angle: number;
  variant: number;
  mask: number;
}
export function frostFor(rect: Panel, index: number): FrostPiece[] {
  const size = Math.max(36, (rect.width / FROST_LOOK.scale) * 1.6),
    count = Math.round(((rect.width * rect.height) / (size * size)) * 1.8),
    out: FrostPiece[] = [];
  for (let i = 0; i < count; i++) {
    const r = (n: number) => hash(index * 6151 + i, n + 40),
      edge = r(1) ** 2 * 0.45,
      top = r(3) < FROST_LOOK.maskTop / (FROST_LOOK.maskTop + FROST_LOOK.maskBottom);
    const v = top ? edge : 1 - edge,
      mask = (top ? FROST_LOOK.maskTop : FROST_LOOK.maskBottom) * (1 - edge / 0.45);
    out.push({
      x: rect.x + r(2) * rect.width,
      y: rect.y + v * rect.height,
      size: size * (0.6 + r(4) * 0.8),
      angle: r(5) * Math.PI * 2,
      variant: Math.floor(r(6) * 4),
      mask: 1 - FROST_LOOK.maskAmount + FROST_LOOK.maskAmount * mask,
    });
  }
  return out;
}
export function paintFrost(ctx: CanvasRenderingContext2D, panels: readonly Panel[], strength = 1): void {
  const sheet = effectImage('frost');
  if (!sheet) crystals ??= [1, 2, 3, 4].map(seed => crystal(seed));
  panels.forEach((rect, index) => {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, rect.radius ?? 0);
    ctx.clip();
    // A faint white rime along the edges, as the additive mask's top and bottom bands.
    const rime = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.height);
    rime.addColorStop(0, '#ffffff1f');
    rime.addColorStop(0.22, '#ffffff00');
    rime.addColorStop(0.78, '#ffffff00');
    rime.addColorStop(1, '#ffffff26');
    ctx.globalAlpha = strength;
    ctx.fillStyle = rime;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    // Two layers: an overlay at 15% and an additive glow at 7%, the glow masked.
    // The crystals are drawn thin, so both carry a fixed gain.
    for (const [mode, layer, masked] of [
      ['source-over', FROST_LOOK.overlay * (sheet ? 1 : 2), false],
      ['lighter', FROST_LOOK.additive * (sheet ? 1 : 3), true],
    ] as const) {
      ctx.globalCompositeOperation = mode;
      for (const piece of frostFor(rect, index)) {
        ctx.save();
        ctx.translate(piece.x, piece.y);
        ctx.rotate(piece.angle);
        ctx.globalAlpha = Math.min(1, layer * (masked ? piece.mask : 0.5 + piece.mask * 0.5) * strength);
        const half = piece.size / 2;
        if (sheet) {
          const tile = sheet.naturalWidth / 2;
          ctx.drawImage(
            sheet,
            (piece.variant % 2) * tile,
            Math.floor(piece.variant / 2) * tile,
            tile,
            tile,
            -half,
            -half,
            piece.size,
            piece.size,
          );
        } else {
          const image = crystals?.[piece.variant];
          if (image) ctx.drawImage(image, -half, -half, piece.size, piece.size);
        }
        ctx.restore();
      }
    }
    ctx.restore();
  });
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// Snow landing on the panels: a share of the flakes that reach a panel's top edge leave a
// soft clump on it, which lingers and melts away. Drawn in front of the glass, so the
// panels' blur never smears it.
export interface SettleLook {
  // Clumps landing per 100 px of edge each second, their size as a share of the card's
  // width, and how long each lasts in ms.
  rate: number;
  size: readonly [min: number, max: number];
  life: readonly [min: number, max: number];
}
// From how many flakes fall in each kind and the chance one leaves a clump: steady snow
// keeps about two or three specks per 100 px of edge. Blowing snow lands far more often,
// and each clump is soon blown away.
export const SNOW_SETTLE: Readonly<Record<string, SettleLook>> = {
  flurries: { rate: 0.2, size: [0.0065, 0.015], life: [1500, 4000] },
  snow: { rate: 0.95, size: [0.0075, 0.0187], life: [1500, 3800] },
  heavySnow: { rate: 2, size: [0.0065, 0.015], life: [1500, 3480] },
  blowingSnow: { rate: 8.8, size: [0.0075, 0.0168], life: [500, 800] },
  blizzard: { rate: 12, size: [0.0065, 0.015], life: [400, 700] },
};
// Share of a life spent appearing, and melting at the end.
const GROW = 0.08,
  MELT = 0.45;
// Eight soft clump shapes, drawn once: a few overlapping blurred blobs each.
let clumps: HTMLCanvasElement[] | undefined;
function clumpSprites(): HTMLCanvasElement[] {
  if (clumps) return clumps;
  clumps = Array.from({ length: 8 }, (_, variant) => {
    const canvas = document.createElement('canvas'),
      size = 48;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    for (let blob = 0; blob < 5; blob++) {
      const x = size * (0.3 + hash(variant * 13 + blob, 1) * 0.4),
        y = size * (0.42 + hash(variant * 13 + blob, 2) * 0.22),
        r = size * (0.16 + hash(variant * 13 + blob, 3) * 0.12),
        soft = ctx.createRadialGradient(x, y, 0, x, y, r);
      soft.addColorStop(0, '#ffffffe6');
      soft.addColorStop(0.55, '#ffffff99');
      soft.addColorStop(1, '#ffffff00');
      ctx.fillStyle = soft;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    return canvas;
  });
  return clumps;
}
// `fade` eases the clumps in and out as the weather changes; `viewWidth` is the card's width.
export function paintSettledSnow(
  ctx: CanvasRenderingContext2D,
  panels: readonly Panel[],
  look: SettleLook,
  fade: number,
  time: number,
  viewWidth: number,
): void {
  if (fade <= 0) return;
  const sprites = clumpSprites(),
    meanLife = (look.life[0] + look.life[1]) / 2000;
  // Snow only settles along the top row of panels; the rows below stay clear.
  const top = Math.min(...panels.map(rect => rect.y));
  panels.forEach((rect, index) => {
    if (rect.y > top + 4) return;
    const inset = Math.min(rect.radius ?? 0, rect.width / 2),
      span = rect.width - inset * 2,
      // Each slot lands a clump, lets it melt, and waits about half a life before the next.
      slots = Math.round((span / 100) * look.rate * meanLife * 1.5 * Math.min(1, fade));
    for (let slot = 0; slot < slots; slot++) {
      const seed = index * 997 + slot,
        life = look.life[0] + hash(seed, 1) * (look.life[1] - look.life[0]),
        period = life * (1.2 + hash(seed, 2) * 0.6),
        shifted = time + hash(seed, 3) * period,
        cycle = Math.floor(shifted / period),
        age = (shifted - cycle * period) / life;
      if (age >= 1) continue;
      const x = rect.x + inset + hash(seed * 31 + cycle, 4) * span,
        size = (look.size[0] + hash(seed + cycle, 5) * (look.size[1] - look.size[0])) * viewWidth,
        sprite = sprites[Math.floor(hash(seed + cycle, 6) * sprites.length)],
        alpha = Math.min(1, age / GROW) * Math.min(1, (1 - age) / MELT),
        // Melting shrinks the clump into the edge.
        shrink = age > 1 - MELT ? 1 - ((age - (1 - MELT)) / MELT) * 0.45 : 1,
        w = size * shrink;
      if (!sprite || alpha <= 0) continue;
      // A faint speck resting just above the edge.
      ctx.globalAlpha = alpha * 0.8;
      ctx.drawImage(sprite, x - w / 2, rect.y - w * 0.8 - 1, w, w);
    }
  });
  ctx.globalAlpha = 1;
}
