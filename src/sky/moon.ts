import { CHANNEL_MAX, context2d } from '../lib/canvas.ts';
import {
  CALENDAR_LIGHT,
  type MoonPrint,
  SHEET_FLOOR,
  TILE_LIGHT,
  TILE_NIGHT,
  drawMoonGpu,
  sheetDim,
} from './moon-gpu.ts';

// Pixels are four bytes, RGBA; a texel's brightness weighs its channels as the eye does.
const RGBA = 4;
const LUMA = [0.3, 0.59, 0.11] as const;
// Sky moons kept, one per size, phase step and warmth in use.
const SPRITES_KEPT = 8;
// The sheet moon's unlit side, as a share of white: the photograph's tone above `black`, at
// `gain` (maria about 7, highlands about 24 of 255), and the incidence over which day gives way to it.
const NIGHT = { gain: 0.144, black: 0.13, from: -0.13, to: 0.1 } as const;
// The sky moon is seen through the air, softer than the tile's photograph: its surface's
// contrast cut to `contrast` about the disc's mean tone, blurred by `blur` of its width (a
// Gaussian's deviation), and a touch cooler, lavender rather than grey (measured on a full
// moon 118 px across: surface detail and broad contrast within 2%).
const SKY_SOFT = { contrast: 0.7, blur: 0.0076 } as const;

// The Moon's near side from NASA's CGI Moon Kit (Lunar Reconnaissance Orbiter
// imagery, public domain), with its elevation's hill-shade baked in so crater rims
// catch the light (scripts/moon-texture.py), drawn as a lit sphere: each pixel of the disc is
// mapped back to its latitude and longitude and shaded by where the sun is in
// the lunar cycle, so the terminator falls where it does in the sky. Rendered as a
// neutral grey photograph whose unlit side is black,
// with a soft halo that grows with the lit fraction, made to be added onto the sky.
// The texture's pixels, once loaded.
interface Surface {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
let source: Promise<Surface> | undefined,
  map: Surface | null = null;
function surface(): Promise<Surface> {
  source ??= new Promise<Surface>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = context2d(canvas);
      ctx.drawImage(image, 0, 0);
      map = {
        width: canvas.width,
        height: canvas.height,
        data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      };
      resolve(map);
    };
    image.onerror = reject;
    image.src = new URL('../../assets/moon-near-side.avif', import.meta.url).href;
  });
  return source;
}
export const loadMoon = (): Promise<boolean> =>
  surface().then(
    () => true,
    () => false,
  );
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Paints the moon onto `ctx`: a disc `size` pixels across, centred in a square
// `size * frame` across, so a halo has room around it. Phase: 0 new, .25 first
// quarter, .5 full, .75 last quarter. `turn` (radians, clockwise) turns the whole lit
// moon from north up, a half turn south of the equator, where the Moon appears upside
// down. `warm` (0–1) tints it toward the horizon's orange.
// With `photo`, it is drawn as the tile and sheet moons: a solid photograph at
// full contrast (maria about 80, highlands about 195 of 255), darkening toward the terminator into
// a near-black night side, so the whole disc shows. It is opaque, so it needs no blend mode over the glass.
// `bright` is the tile's moon: white light over the tile rather than a photograph on it, so it
// takes the sky's colour, whose unlit side stays as a faint ghost (TILE_LIGHT and TILE_NIGHT, in
// sky/moon-gpu.ts).
// `soft` draws it as the sky's moon (see SKY_SOFT).
interface MoonLook {
  turn?: number;
  frame?: number;
  halo?: number;
  warm?: number;
  photo?: boolean;
  bright?: boolean;
  soft?: boolean;
}
// The mean tone of the near side as seen on the disc, sampled on a grid across it.
let meanAlbedo: number | undefined;
function discMean(sample: (u: number, v: number) => number): number {
  if (meanAlbedo !== undefined) return meanAlbedo;
  const steps = 48;
  let sum = 0,
    count = 0;
  for (let j = 0; j < steps; j++)
    for (let k = 0; k < steps; k++) {
      const x = ((k + 0.5) / steps) * 2 - 1,
        y = ((j + 0.5) / steps) * 2 - 1,
        z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
      if (x * x + y * y >= 1) continue;
      sum += sample(Math.atan2(x, z) / Math.PI + 0.5, Math.acos(Math.max(-1, Math.min(1, -y))) / Math.PI);
      count++;
    }
  meanAlbedo = count ? sum / count : 0.5;
  return meanAlbedo;
}
// Blurs an opaque image's colour in place, as a Gaussian of deviation `sigma` pixels would.
function soften(image: ImageData, sigma: number): void {
  const reach = Math.ceil(sigma * 3);
  if (reach < 1) return;
  const raw = Array.from({ length: reach * 2 + 1 }, (_, k) => Math.exp(-((k - reach) ** 2) / (2 * sigma * sigma))),
    total = raw.reduce((a, b) => a + b, 0),
    weights = raw.map(w => w / total);
  const { width, height, data } = image,
    across = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        weights.forEach((w, k) => {
          const at = Math.min(width - 1, Math.max(0, x + k - reach));
          sum += w * (data[(y * width + at) * RGBA + c] ?? 0);
        });
        across[(y * width + x) * 3 + c] = sum;
      }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        weights.forEach((w, k) => {
          const at = Math.min(height - 1, Math.max(0, y + k - reach));
          sum += w * (across[(at * width + x) * 3 + c] ?? 0);
        });
        data[(y * width + x) * RGBA + c] = sum;
      }
}
// The texture's brightness at (u, v), bilinear, so it never shows as blocks when the disc is drawn larger.
function bilinear(pixels: Surface): (u: number, v: number) => number {
  return (u, v) => {
    const x = Math.min(pixels.width - 1.001, Math.max(0, u * pixels.width - 0.5)),
      y = Math.min(pixels.height - 1.001, Math.max(0, v * pixels.height - 0.5));
    const x0 = Math.floor(x),
      y0 = Math.floor(y),
      fx = x - x0,
      fy = y - y0;
    const at = (cx: number, cy: number) => {
      const i = (cy * pixels.width + cx) * RGBA,
        data = pixels.data,
        [red, green, blue] = LUMA;
      return ((data[i] ?? 0) * red + (data[i + 1] ?? 0) * green + (data[i + 2] ?? 0) * blue) / CHANNEL_MAX;
    };
    return (
      (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
      (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
    );
  };
}
// Linear light as a screen shows it (sRGB).
const encode = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
// The calendar's moon, lit as sky/moon-gpu.ts lights it (CALENDAR_LIGHT) but on the smooth sphere,
// the near side's tone standing in for the relief map's: white, as much as its light.
function calendarMoon(ctx: CanvasRenderingContext2D, pixels: Surface, size: number, phase: number, turn: number): void {
  const { gain, gamma, share, k, night, samples } = CALENDAR_LIGHT,
    out = ctx.createImageData(size, size),
    sample = bilinear(pixels),
    angle = 2 * Math.PI * phase,
    sx = Math.sin(angle),
    sz = -Math.cos(angle),
    turnCos = Math.cos(turn),
    turnSin = Math.sin(turn),
    fine = size * samples;
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      let sum = 0;
      for (let row = 0; row < samples; row++)
        for (let column = 0; column < samples; column++) {
          const x = ((px + (column + 0.5) / samples) / size) * 2 - 1,
            y = ((py + (row + 0.5) / samples) / size) * 2 - 1,
            r = Math.hypot(x, y),
            edge = Math.max(0, Math.min(1, ((1 - r) * fine) / 2 + 0.5));
          if (!edge) continue;
          const qx = (turnCos * x + turnSin * y) / Math.max(r, 1),
            qy = (turnCos * y - turnSin * x) / Math.max(r, 1),
            z = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy));
          const albedo = sample(Math.atan2(qx, z) / Math.PI + 0.5, Math.acos(Math.max(-1, Math.min(1, -qy))) / Math.PI),
            lit = Math.max(0, qx * sx + z * sz),
            mu = Math.max(z, 0.02);
          const light =
            gain * albedo ** gamma * (share * lit ** k * mu ** (k - 1) + ((1 - share) * 2 * lit) / (lit + mu) + night);
          sum += encode(Math.min(1, light)) * edge;
        }
      const i = (py * size + px) * RGBA;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = CHANNEL_MAX;
      out.data[i + 3] = (sum / (samples * samples)) * CHANNEL_MAX;
    }
  ctx.putImageData(out, 0, 0);
}
function render(
  ctx: CanvasRenderingContext2D,
  pixels: Surface,
  size: number,
  phase: number,
  { turn = 0, frame = 1, halo = 0, warm = 0, photo = false, bright = false, soft = false }: MoonLook = {},
): void {
  const full = Math.round(size * frame),
    out = ctx.createImageData(full, full),
    angle = 2 * Math.PI * phase,
    margin = (full - size) / 2,
    turnCos = Math.cos(turn),
    turnSin = Math.sin(turn);
  // Sun direction in view space: behind the Moon at new moon, behind the viewer at full.
  const sx = Math.sin(angle),
    sz = -Math.cos(angle),
    lit = (1 - Math.cos(angle)) / 2;
  const tint = soft
    ? ([1 + 0.02 * warm, 1.005 - 0.105 * warm, 1.075 - 0.405 * warm] as const)
    : ([0.98 + 0.04 * warm, 1 - 0.1 * warm, 1.02 - 0.35 * warm] as const);
  const sample = bilinear(pixels);
  const mean = soft ? discMean(sample) : 0;
  for (let py = 0; py < full; py++)
    for (let px = 0; px < full; px++) {
      let x = ((px - margin + 0.5) / size) * 2 - 1,
        y = ((py - margin + 0.5) / size) * 2 - 1;
      const r = Math.hypot(x, y),
        i = (py * full + px) * RGBA;
      if (r > 1 + 1 / size) {
        // The halo: a faint glow from the limb, as wide again as the disc,
        // strongest beside the lit side.
        if (!halo || !lit) continue;
        const toward = r ? (x * sx) / r : 0,
          glow = halo * lit * Math.exp(-(r - 1) * 4.2) * (0.55 + 0.45 * Math.max(0, toward + (1 - Math.abs(sx))));
        const a = Math.min(1, glow);
        out.data[i] = 222 * a * tint[0];
        out.data[i + 1] = 226 * a * tint[1];
        out.data[i + 2] = 232 * a * tint[2];
        out.data[i + 3] = 255;
        continue;
      }
      // Turned clockwise: each pixel shows the point the turn carried there.
      [x, y] = [turnCos * x + turnSin * y, turnCos * y - turnSin * x];
      const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
      // The texture spans longitudes -90° to 90° and latitudes 90° to -90°.
      const raw = sample(Math.atan2(x, z) / Math.PI + 0.5, Math.acos(Math.max(-1, Math.min(1, -y))) / Math.PI),
        albedo = soft ? mean + SKY_SOFT.contrast * (raw - mean) : raw;
      // Lommel-Seeliger: a full moon stays nearly as bright to its limb, darkening a
      // little at the very edge; the terminator is a soft gradient, and the unlit side is
      // black. A gibbous moon should read almost full and bright (about 180 of 255 over a
      // night sky), so the terminator is wide and the maria lifted.
      const incidence = x * sx + z * sz,
        day = smooth(-0.16, 0.1, incidence),
        cos = Math.max(0, incidence);
      const shade =
        day *
        Math.min(1, (2 * cos) / (cos + z + 0.001) + 0.2) *
        (0.8 + 0.2 * smooth(0, 0.3, incidence)) *
        (0.88 + 0.12 * Math.sqrt(z));
      const value = Math.min(1, 0.3 + 0.85 * albedo) * shade * 255,
        edge = Math.max(0, Math.min(1, ((1 - r) * size) / 2 + 0.5));
      if (photo) {
        // The texture's 5th–95th percentiles (.29–.675) onto the photograph's tones; Lommel-Seeliger
        // without the sky moon's lift, and dusk shading into the terminator.
        const tone = Math.max(
            0,
            Math.min(
              1,
              bright
                ? TILE_LIGHT.base + (albedo - TILE_LIGHT.mean) * TILE_LIGHT.slope
                : (80 + (albedo - 0.29) * 299) / 255,
            ),
          ),
          relief = bright ? 0.96 + 0.04 * Math.sqrt(z) : Math.min(1, (2 * cos) / (cos + z + 0.001)) * (0.6 + 0.4 * z);
        // The tile's small print is lit almost flat and barely darkens toward the terminator;
        // the sheet's photograph does both.
        // The sheet's photograph darkens toward its rim and its terminator; lifted onto the
        // tones the sheet moon spans: a curve fitted to its 5th–95th percentiles
        // (80, 104, 126, 158, 197 of 255).
        const shaded = bright
          ? tone * relief * (0.8 + 0.2 * smooth(0, 0.25, incidence)) * 255
          : 255 *
            sheetDim(lit) *
            (SHEET_FLOOR.tone * smooth(SHEET_FLOOR.from, SHEET_FLOOR.to, incidence) +
              1.036 * (tone * relief * (0.55 + 0.45 * smooth(0, 0.3, incidence))) ** 1.25);
        if (bright) {
          out.data[i] = out.data[i + 1] = out.data[i + 2] = CHANNEL_MAX;
          out.data[i + 3] =
            shaded *
            (TILE_NIGHT.ghost + (1 - TILE_NIGHT.ghost) * smooth(TILE_NIGHT.from, TILE_NIGHT.to, incidence)) *
            edge;
          continue;
        }
        // The sheet's moon keeps its night side: a near-black disc (about 5–24 of 255) that
        // still shows the maria faintly, with the lit side fading into it at the terminator.
        const night = 255 * NIGHT.gain * Math.max(0, tone - NIGHT.black),
          value = night + (shaded - night) * smooth(NIGHT.from, NIGHT.to, incidence);
        out.data[i] = value * tint[0];
        out.data[i + 1] = value * tint[1];
        out.data[i + 2] = value * tint[2];
        out.data[i + 3] = 255 * edge;
        continue;
      }
      out.data[i] = value * tint[0] * edge;
      out.data[i + 1] = value * tint[1] * edge;
      out.data[i + 2] = value * tint[2] * edge;
      out.data[i + 3] = 255;
    }
  if (soft) {
    // Opaque black where nothing is lit (the sprite is screened, so black adds nothing), then blurred.
    for (let i = RGBA - 1; i < out.data.length; i += RGBA) out.data[i] = CHANNEL_MAX;
    soften(out, SKY_SOFT.blur * size);
  }
  ctx.putImageData(out, 0, 0);
}

// The moon for the sky: a square canvas twice the disc's width (the halo fills the
// rest), black where nothing is lit, to be screened over the sky. Soft (see
// SKY_SOFT), with a faint halo: at full, about 30 of 255 over the sky a tenth of a radius
// out, 14 at three tenths. Returns null until the texture has loaded; cached per size,
// phase step and warmth.
const sprites = new Map<string, HTMLCanvasElement>();
export function skyMoon(size: number, phase: number, warm = 0): HTMLCanvasElement | null {
  if (!map) {
    surface().catch(() => {});
    return null;
  }
  const key = `${size}:${phase}:${warm}`,
    cached = sprites.get(key);
  // Kept most recently used last, so the least used goes first and other skies keep theirs.
  if (cached) {
    sprites.delete(key);
    sprites.set(key, cached);
    return cached;
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.round(size * 2);
  render(context2d(canvas), map, size, phase, { frame: 2, halo: 0.22, warm, soft: true });
  sprites.set(key, canvas);
  const [oldest] = sprites.keys();
  if (sprites.size > SPRITES_KEPT && oldest !== undefined) sprites.delete(oldest);
  return canvas;
}

// The moon for the tile, the sheet and its calendar: its disc filling `canvas`, as a photograph
// (see `photo` above) printed as `print`, turned `turn` radians clockwise. Lit on the GPU where
// there is one (sky/moon-gpu.ts), here otherwise.
export async function drawMoon(
  canvas: HTMLCanvasElement,
  phase: number,
  turn = 0,
  print: MoonPrint = 'sheet',
): Promise<void> {
  // As large as it shows on screen, zoomed or not. Its layout says so, where its box on screen
  // wouldn't: a sheet opens from next to nothing, and a moon drawn at that size would stay blurred.
  // A browser too old to report its zoom has none to report.
  const zoom = 'currentCSSZoom' in canvas ? canvas.currentCSSZoom : 1,
    size = Math.round(Math.min(canvas.offsetWidth, canvas.offsetHeight) * zoom * (window.devicePixelRatio || 1));
  const key = `${size}:${phase.toFixed(3)}:${turn.toFixed(3)}:${print}`;
  if (!size || canvas.dataset['drawn'] === key) return;
  canvas.dataset['drawn'] = key;
  // Sizing a canvas clears it, so only when the size changes: until the new moon is drawn,
  // the last one stays.
  if (canvas.width !== size || canvas.height !== size) canvas.width = canvas.height = size;
  if (await drawMoonGpu(canvas, size, phase, turn, print)) return;
  const pixels = await surface().catch(() => null);
  if (!pixels) return;
  if (print === 'calendar') calendarMoon(context2d(canvas), pixels, size, phase, turn);
  else render(context2d(canvas), pixels, size, phase, { turn, photo: true, bright: print === 'tile' });
}
