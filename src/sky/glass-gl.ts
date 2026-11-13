import { DROP_TIERS, type Panel } from './droplets.ts';
import { context2d } from '../lib/canvas.ts';
import { linkedProgram } from '../lib/webgl.ts';
import { RainGPU, RainSky } from './rain-gpu.ts';

// Rain on the glass as a WebGL shader. The glass shows the sky blurred; a drop on it is a
// small lens that shows the sky sharp, small and upside down, and the clear strip a running
// drop wipes behind it shows the sky sharp as it is. Two kinds of drop, each in two layers:
// still beads that appear, shrink and evaporate, and drops that run down the pane in fits
// and starts, leaving a wake. Sizes are in CSS px (a drop unit is 500 px over the tier's
// scale, the same on every panel), y up within each panel; densities, refraction, highlight
// and opacity come from the tier.

const VERTEX = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;
const FRAGMENT = `
precision highp float;
uniform vec2 uSize;        // overlay size in CSS px
uniform vec2 uOffset;      // cropped viewport's origin in the full overlay, in GL pixels
uniform float uScale;      // device pixels per CSS px
uniform float uTime;       // seconds
uniform vec4 uDrops;       // grid scale, still density, moving density, still-time multiplier
uniform vec3 uLens;        // refraction, highlight, layer opacity
#ifdef REFRACTION
uniform sampler2D uSharp;  // the sky behind the glass, sharp
uniform sampler2D uBlur;   // the same sky, small and therefore soft, as the glass blurs it
uniform vec2 uSky;        // GPU texture orientation and sky height / overlay height
#endif
uniform vec4 uRects[16];   // panels: x, y, width, height
uniform float uRadii[16];
uniform float uSeeds[16];  // a number of each panel's own, so each has its own drops
uniform int uCount;
uniform vec3 uTone;        // the sky's tone, where no sky is painted behind the glass

float seedNumber(float s) { vec2 p = fract(s * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
float cellNumber(vec2 q) { vec2 p = fract(q * vec2(234.34, 435.345)); p += dot(p, p + 34.23); return fract(p.x * p.y); }

// The sky at a place on the overlay (y down), or its tone where none is painted.
#ifdef REFRACTION
vec3 sky(sampler2D image, vec2 at) {
  if (uSky.x > .5) {
    at.y /= uSky.y;
    if (at.y > 1.) return uTone;
    at.y = 1. - at.y;
  }
  vec4 c = texture2D(image, at);
  return mix(uTone, c.rgb / max(c.a, .001), smoothstep(.05, .6, c.a));
}
#endif
// The panels' material, as their glass filters the sky: contrast .8 and brightness .853
// (.682 c + .085), then saturation 1.7. Matching it, the drops fade into the glass round them.
vec3 material(vec3 c) {
  vec3 m = clamp(.682 * c + .0853, 0., 1.);
  return clamp(mix(vec3(dot(m, vec3(.2126, .7152, .0722))), m, 1.7), 0., 1.);
}

// Still beads, one per cell of a 20-per-unit grid where the cell's number is under the
// density. Each lives a cycle of 1 / (0.08 m) seconds: unseen for its first tenth, then
// there at 94% of its size, shrinking to 46% and fading over its last quarter. Its centre
// sways with the pixel's own place in the cell, which roughens its outline. Returns the
// lens offset (from the bead's centre to the pixel), how much it covers, and its rim weight.
vec4 beads(vec2 uv, float t, float density, float seed) {
  vec2 g = uv * 20., st = fract(g) - .5;
  float n = cellNumber(floor(g) + seedNumber(seed));
  if (fract(n * 43.34) >= density) return vec4(0.);
  float phase = fract(.08 * t + fract(n * 32.25));
  if (phase < .1) return vec4(0.);
  float size = .4 + .6 * mix(1., .1, phase), fade = clamp(4. * (1. - phase), 0., 1.);
  vec4 k = .5 + .5 * fract(n * vec4(54.97, 33.22, 18.69, 14.98));
  float r = .05 + .02 * fract(n * 2874.);
  vec2 c = vec2(
    .9 * (n - .5) + .032 * k.w * sin(15. * k.z * st.y) + .01 * k.x * cos(70. * k.y * st.y),
    .9 * (fract(n * 234.75) - .5) + .027 * k.y * sin(22. * k.x * st.x) + .011 * k.w * cos(70. * k.z * st.x));
  vec2 d = st - clamp(c, r - .42, .42 - r);
  float outer = (r + .08) * size, len = length(d);
  float cover = smoothstep(outer, (r + .04) * size, len) * smoothstep(0., 1., fade);
  float rim = smoothstep(0., outer, len);
  return vec4(cover * .05 / (r + .08) * d, cover, rim >= 1. ? 0. : rim);
}

// Running drops on a grid of cells (0.1 by 0.2 units) that slides down a quarter cell a
// second. Where the cell's number is under the density it carries a drop on a lane of its
// own, wandering a little, that slips down the cell in fits and starts: a teardrop leaving
// a clear strip behind it, narrowing upward with ragged sides, and a row of small beads.
// Returns as beads does.
vec4 runners(vec2 grid, vec2 uv, vec2 across, float t, float density, float seed) {
  vec2 p = vec2(grid.x, grid.y + t * .25), st = fract(p) - .5;
  float sh = seedNumber(seed), n = cellNumber(floor(p) + sh);
  if (fract(n * 434.42) >= density) return vec4(0.);
  float T = t + 6.284 * n, x = .8 * (n - .5), s = sin(10. * uv.y);
  x += .45 * sin(30. * uv.y) * (.4 - abs(x)) * s * s * s * s * s * s;
  float y = -.45 * sin(T + sin(T + .5 * sin(T))) - (st.x - x) * (st.x - x);
  x += .0055 * sin(300. * across.y);
  y += .0015 * sin(250. * across.y);
  vec2 at = (st - vec2(x, y)) / vec2(2., 1.);
  float near = length(at), drop = smoothstep(.05, .03, near);
  vec2 trail = (st - vec2(x, T * .25)) / vec2(2., 1.);
  float r2 = .03 * cellNumber(vec2(n + sh + floor(8. * trail.y))), ty = (fract(8. * trail.y) - .5) / 8.;
  vec2 bead = vec2(trail.x + .002 * sin((r2 + seed + ty) * 150.), ty);
  float beadNear = length(bead);
  float behind = smoothstep(-.05, .05, at.y) * smoothstep(.5, y, st.y);
  float v = p.y - T * .25;
  float side = abs(at.x) + .03 * at.y - .055 - .005 * sin(30. * v + n) - .003 * sin(15. * v + n) - .0015 * sin(85. * v + n);
  float wake = behind * smoothstep(0., 1., -50. * side);
  float rim = smoothstep(0., .05, near), beadRim = smoothstep(0., .03, beadNear);
  return vec4(
    smoothstep(.02 + r2, .01, beadNear) * behind * bead + drop * at,
    wake + drop,
    (rim >= 1. ? 0. : rim) + (beadRim >= 1. || drop > .001 ? 0. : beadRim));
}

float roundedRect(vec2 p, vec4 r, float radius) {
  vec2 q = abs(p - (r.xy + r.zw * .5)) - r.zw * .5 + radius;
  return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - radius;
}

void main() {
  vec2 pixel = gl_FragCoord.xy + uOffset;
  vec2 p = vec2(pixel.x, uSize.y * uScale - pixel.y) / uScale;
  vec4 panel = vec4(0.);
  float seed = -1.;
  for (int i = 0; i < 16; i++) {
    if (i >= uCount) break;
    if (roundedRect(p, uRects[i], uRadii[i]) <= 0.) { panel = uRects[i]; seed = uSeeds[i]; }
  }
  if (seed < 0.) { gl_FragColor = vec4(0.); return; }
  // Within the panel, y up from its bottom edge.
  vec2 up = vec2(p.x - panel.x, panel.y + panel.w - p.y), uv = uDrops.x * up / 500.;
  vec4 m1 = runners(uv * vec2(10., 5.), uv, up / panel.z, uTime, uDrops.z, seed),
    m2 = runners(uv * vec2(10., 5.), uv, up / panel.z, .8 * uTime, uDrops.z, seed + 15.);
  vec4 moving = clamp(1. - m2.z, 0., 1.) * m1 + m2;
  float still = uDrops.w * uTime;
  vec4 s1 = beads(uv, still, uDrops.y, seed), s2 = beads(uv * 1.2, still, uDrops.y, seed + 21.983);
  vec4 bead = (1. - s2.z) * s1 + s2;
  float total = bead.z + moving.z;
  if (total <= 0.) { gl_FragColor = vec4(0.); return; }
  // The glass around the drops, and how dark it is: highlights and shading show more on dark glass.
#ifdef REFRACTION
  vec2 at = p / uSize;
  vec3 base = material(sky(uBlur, at));
  // Through a drop: the sharp sky, shifted against the lens offset, the more toward the
  // bottom of the sky; part through the panels' material, part as it is.
  vec2 offset = bead.xy + moving.xy;
  vec3 sharp = sky(uSharp, at + vec2(-offset.x, offset.y) * uLens.x * (1. + at.y));
  vec3 lens = mix(material(sharp) - 1. / 510., sharp, .35) * total;
  float coverage = total;
#else
  // No image of the sky: only the same drops' light and shade over transparent glass.
  // The scene's tone sets their contrast without a canvas copy or a texture upload.
  vec3 base = material(uTone), lens = vec3(0.);
  float coverage = 0.;
#endif
  float dark = 1. - (max(max(base.r, base.g), base.b) + min(min(base.r, base.g), base.b)) * .5;
  // Light along the lower and left rims, shade along the upper and right.
  float h = uLens.y,
    lit = (3.5 * max(0., -bead.x) + max(0., bead.x) + 6. * max(0., -bead.y)) * bead.w * (.5 * h + dark)
      + (3.5 * max(0., -moving.x) + max(0., moving.x) + 6. * max(0., -moving.y)) * moving.w * (h + dark),
    shade = (.5 * max(0., bead.x) + 2.5 * max(0., bead.y)) * (h + dark)
      + (.5 * max(0., moving.x) + 1.25 * max(0., moving.y)) * (2. * h + dark);
  vec4 drops = (vec4(lens, coverage) + lit - shade) * uLens.z;
  // Laid over the panel's own glass: the glass shows through by 1 - alpha, the drops add
  // their colour. Colour below nothing, where the shade outweighs the lens, can't be held:
  // it darkens the glass instead, by as much as it would darken the glass as estimated here.
  vec3 color = max(drops.rgb, 0.);
  float a = clamp(drops.a + dot(color - drops.rgb, vec3(.2126, .7152, .0722)) / max(dot(base, vec3(.2126, .7152, .0722)), .05), 0., 1.);
  gl_FragColor = vec4(min(color, vec3(a)), a);
}`;

// Browsers allow only a handful of WebGL contexts per page (about 16), so every card
// shares one: it draws its glass there, in the canvas's lower-left corner, and copies
// the result onto its own 2D canvas.
let shared: GlassRain | null | undefined;
export const sharedGlass = (): GlassRain | null => {
  if (shared === undefined) {
    try {
      shared = new GlassRain(document.createElement('canvas'));
      if (!shared.ready) shared = null;
    } catch {
      shared = null;
    }
  }
  return shared;
};

type Uniform =
  | 'uSize'
  | 'uOffset'
  | 'uScale'
  | 'uTime'
  | 'uDrops'
  | 'uLens'
  | 'uSharp'
  | 'uBlur'
  | 'uSky'
  | 'uRects'
  | 'uRadii'
  | 'uSeeds'
  | 'uCount'
  | 'uTone';
// Each card keeps its own sky textures while sharing the shader and staging canvases.
interface SkyTextures {
  sharp: WebGLTexture | null;
  blur: WebGLTexture | null;
  size: string;
  age: number;
  at: number;
}
// The compiled shader and what drawing needs from it.
interface GlassProgram {
  program: WebGLProgram;
  u: Record<Uniform, WebGLUniformLocation | null>;
}
interface Glass {
  gl: WebGLRenderingContext;
  quad: WebGLBuffer | null;
  refracted: GlassProgram;
  plain: GlassProgram | undefined;
  // The sky sharp, and small (as soft as the glass's blur).
  sharp: HTMLCanvasElement;
  blur: HTMLCanvasElement;
  skies: Map<HTMLCanvasElement | null, SkyTextures>;
  // The panels' rects, corner radii and numbers, as the shader takes them; reused every frame.
  rects: Float32Array;
  radii: Float32Array;
  seeds: Float32Array;
}
// The sharp sky is copied at no more than this many pixels across; the soft one at a sixth
// of the card's size, cheap to upload. A panel's number runs to this.
// Copying the sky holds the page up until it has finished drawing. Refresh cached animated skies
// at most eight times a second, and no more often than every third draw on slower devices.
// The drops themselves still move on every frame. Keep only a few cards' textures resident.
const SHARP = 1280,
  SOFT = 6,
  SKY_EVERY = 3,
  SKY_INTERVAL = 0.125,
  SKY_LIMIT = 4,
  SEEDS = 101,
  SEED_X = 7,
  SEED_WIDTH = 13,
  SEED_HEIGHT = 3;
const ORIGIN = { x: 0, y: 0 };

// Both looks share the drop geometry and lighting. Compiling the plain look without
// samplers lets it draw with no sky textures at all, even on a newly created context.
function glassProgram(gl: WebGLRenderingContext, refraction: boolean): GlassProgram {
  const program = linkedProgram(gl, 'glass', VERTEX, `${refraction ? '#define REFRACTION\n' : ''}${FRAGMENT}`, ['a']);
  const at = (name: Uniform) => gl.getUniformLocation(program, name);
  return {
    program,
    u: {
      uSize: at('uSize'),
      uOffset: at('uOffset'),
      uScale: at('uScale'),
      uTime: at('uTime'),
      uDrops: at('uDrops'),
      uLens: at('uLens'),
      uSharp: at('uSharp'),
      uBlur: at('uBlur'),
      uSky: at('uSky'),
      uRects: at('uRects'),
      uRadii: at('uRadii'),
      uSeeds: at('uSeeds'),
      uCount: at('uCount'),
      uTone: at('uTone'),
    },
  };
}

export class GlassRain {
  private glass: Glass | null = null;
  private rain: RainGPU | null | undefined;
  private readonly scenes = new Map<HTMLCanvasElement, RainSky>();
  private readonly nativeRain: boolean;
  constructor(canvas: HTMLCanvasElement) {
    const agent = navigator.userAgent;
    this.nativeRain = agent.includes('AppleWebKit/') && !/(Chrome|Chromium)\//.test(agent);
    const gl = canvas.getContext('webgl', {
      premultipliedAlpha: true,
      alpha: true,
      antialias: false,
      // Keep the native path's existing buffer behavior. Resident sky textures
      // live in framebuffers and do not need the presentation buffer preserved.
      preserveDrawingBuffer: this.nativeRain,
    });
    if (!gl) return;
    // A lost context (a GPU reset, or the page holding too many) is given up: the next
    // draw builds a fresh one, or the canvas beads stand in.
    canvas.addEventListener('webglcontextlost', () => {
      this.glass = null;
      this.scenes.clear();
      this.rain = undefined;
      if (shared === this) shared = undefined;
    });
    const refracted = glassProgram(gl, true),
      quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.glass = {
      gl,
      quad,
      refracted,
      plain: undefined,
      sharp: document.createElement('canvas'),
      blur: document.createElement('canvas'),
      skies: new Map(),
      rects: new Float32Array(64),
      radii: new Float32Array(16),
      seeds: new Float32Array(16),
    };
  }
  get ready() {
    return Boolean(this.glass);
  }
  beginSky(canvas: HTMLCanvasElement, scale: number): RainSky | null {
    // This engine's native rain paths are cheaper than the layered Canvas-to-GL
    // transfers. Keep them while still using the shared animation deadlines.
    if (this.nativeRain) return null;
    const gl = this.glass?.gl;
    if (!gl || gl.isContextLost()) return null;
    if (this.rain === undefined) {
      try {
        const maximum = gl.getExtension('EXT_blend_minmax'),
          instanced = gl.getExtension('ANGLE_instanced_arrays');
        this.rain = maximum && instanced ? new RainGPU(gl, maximum.MAX_EXT, instanced) : null;
      } catch {
        this.rain = null;
      }
    }
    if (!this.rain) return null;
    if (Math.max(canvas.width, canvas.height) > this.rain.limit) {
      this.releaseSky(canvas);
      return null;
    }
    let scene = this.scenes.get(canvas);
    if (
      scene &&
      (scene.color.width !== canvas.width || scene.color.height !== canvas.height || scene.scale !== scale)
    ) {
      this.releaseSky(canvas);
      scene = undefined;
    }
    if (!scene) {
      // Additional visible cards use Canvas until a slot is released. Evicting a
      // live sky here would reallocate every surface on every dashboard frame.
      if (this.scenes.size >= SKY_LIMIT) return null;
      try {
        this.rain.prepare(canvas.width, canvas.height);
        scene = new RainSky(this.rain, canvas.width, canvas.height, scale);
      } catch {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return null;
      }
      this.scenes.set(canvas, scene);
    }
    scene.begin();
    return scene;
  }
  releaseSky(canvas: HTMLCanvasElement): void {
    this.scenes.get(canvas)?.release();
    this.scenes.delete(canvas);
    if (!this.scenes.size) this.rain?.release();
  }
  hasSky(canvas: HTMLCanvasElement): boolean {
    return this.scenes.has(canvas);
  }
  // A hidden, dry or removed card no longer needs GPU copies of its sky.
  release(sky: HTMLCanvasElement | null | undefined): void {
    const glass = this.glass,
      key = sky ?? null,
      textures = glass?.skies.get(key);
    if (!glass || !textures) return;
    glass.gl.deleteTexture(textures.sharp);
    glass.gl.deleteTexture(textures.blur);
    glass.skies.delete(key);
  }
  // `panels`: rects in CSS px; `sky`: the scene canvas; `size`: the overlay's CSS size;
  // `target`: the 2D canvas the drops are copied onto; `offset`: its top-left in
  // the full overlay's device pixels. Cropping leaves sky sampling and drop seeds alone.
  draw(
    panels: readonly Panel[],
    tier: number,
    seconds: number,
    sky: HTMLCanvasElement | null | undefined,
    size: { width: number; height: number },
    scale: number,
    tone: number[] = [0.62, 0.68, 0.78],
    target: HTMLCanvasElement | null = null,
    offset: { x: number; y: number } = ORIGIN,
    refraction = true,
  ): void {
    const glass = this.glass,
      look = DROP_TIERS[tier];
    if (!glass || !look || glass.gl.isContextLost()) return;
    const { gl } = glass;
    let drawing = glass.refracted;
    if (!refraction) {
      glass.plain ??= glassProgram(gl, false);
      drawing = glass.plain;
      this.release(sky);
    }
    const { program, u } = drawing,
      canvas = gl.canvas,
      pw = target?.width ?? canvas.width,
      ph = target?.height ?? canvas.height,
      resident = sky ? this.scenes.get(sky) : undefined;
    // Grown to the largest card seen, never shrunk, so cards of different sizes don't reallocate it.
    if (target && (canvas.width < pw || canvas.height < ph)) {
      canvas.width = Math.max(canvas.width, pw);
      canvas.height = Math.max(canvas.height, ph);
    }
    if (refraction && resident) {
      this.release(sky);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, resident.color.texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, resident.soft.texture);
    } else if (refraction) {
      const key = sky ?? null;
      let textures = glass.skies.get(key);
      if (!textures && glass.skies.size >= SKY_LIMIT) {
        const oldest = glass.skies.entries().next().value;
        if (oldest) {
          glass.skies.delete(oldest[0]);
          textures = oldest[1];
          textures.size = '';
        }
      }
      if (!textures) {
        const texture = () => {
          const result = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, result);
          for (const [k, v] of [
            [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
            [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
            [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
            [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
          ] as const)
            gl.texParameteri(gl.TEXTURE_2D, k, v);
          return result;
        };
        textures = { sharp: texture(), blur: texture(), size: '', age: 0, at: seconds };
      }
      // Reuse the least recently drawn pair at the limit, without reallocating textures when
      // more cards alternate than fit in the cache. Only their uploaded pixels need replacing.
      glass.skies.delete(key);
      glass.skies.set(key, textures);
      // Bind both even on a cache hit: the previous draw may belong to another card.
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, textures.sharp);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, textures.blur);
      // The sky, copied at `share` of the overlay's size into texture `unit`, reaching as far
      // down as it is painted.
      const upload = (image: HTMLCanvasElement, unit: number, share: number) => {
        const w = Math.max(8, Math.round(size.width * share)),
          h = Math.max(8, Math.round(size.height * share));
        if (image.width !== w || image.height !== h) {
          image.width = w;
          image.height = h;
        }
        const c = context2d(image);
        c.clearRect(0, 0, w, h);
        if (sky && sky.width > 0 && sky.height > 0)
          c.drawImage(sky, 0, 0, sky.width, sky.height, 0, 0, w, (h * (sky.height / scale)) / size.height);
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      };
      // Still frames, new sizes and restarted clocks must see the current sky immediately.
      const skyFor = `${size.width} ${size.height} ${scale} ${sky?.width ?? 0} ${sky?.height ?? 0}`;
      if (
        !seconds ||
        textures.size !== skyFor ||
        seconds < textures.at ||
        (++textures.age >= SKY_EVERY && seconds - textures.at >= SKY_INTERVAL)
      ) {
        upload(glass.sharp, 0, Math.min(1, SHARP / Math.max(size.width, size.height)));
        upload(glass.blur, 1, 1 / SOFT);
        textures.size = skyFor;
        textures.age = 0;
        textures.at = seconds;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, glass.quad);
    gl.enableVertexAttribArray(0);
    gl.disableVertexAttribArray(1);
    gl.disableVertexAttribArray(2);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(program);
    gl.viewport(0, 0, pw, ph);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const { rects, radii, seeds } = glass;
    rects.fill(0);
    radii.fill(0);
    panels.slice(0, 16).forEach((rect, i) => {
      rects.set([rect.x, rect.y, rect.width, rect.height], i * 4);
      radii[i] = rect.radius ?? 0;
      // A panel's number follows its place across and its size, which scrolling leaves alone.
      seeds[i] = Math.round(rect.x * SEED_X + rect.width * SEED_WIDTH + rect.height * SEED_HEIGHT) % SEEDS;
    });
    gl.uniform2f(u.uSize, size.width, size.height);
    gl.uniform2f(u.uOffset, offset.x, Math.round(size.height * scale) - offset.y - ph);
    gl.uniform1f(u.uScale, scale);
    // Kept small: a float holds a page's uptime of weeks only to a tenth of a second, and
    // the drops would move in steps. They jump once an hour instead.
    gl.uniform1f(u.uTime, seconds % 3600);
    gl.uniform4f(u.uDrops, look.scale, look.still, look.moving, look.stillTime);
    gl.uniform3f(u.uLens, look.refraction, look.highlight, look.opacity);
    gl.uniform1i(u.uSharp, 0);
    gl.uniform1i(u.uBlur, 1);
    gl.uniform2f(u.uSky, resident ? 1 : 0, resident ? resident.color.height / resident.scale / size.height : 1);
    gl.uniform4fv(u.uRects, rects);
    gl.uniform1fv(u.uRadii, radii);
    gl.uniform1fv(u.uSeeds, seeds);
    gl.uniform1i(u.uCount, Math.min(16, panels.length));
    gl.uniform3fv(u.uTone, tone);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (target) {
      const ctx = context2d(target);
      ctx.clearRect(0, 0, pw, ph);
      ctx.drawImage(canvas, 0, canvas.height - ph, pw, ph, 0, 0, pw, ph);
    }
  }
}
