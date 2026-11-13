import { ATLAS_WIDTH, BLANKETS, CLOUD_SPRITES, PLANE_HEIGHT, type CloudKind, spriteRect } from './clouds.ts';
import { type CloudAtlas, type Direction, type Tint, decode } from './cloud-decks.ts';
import { context2d, hash } from '../lib/canvas.ts';
import { linkedProgram } from '../lib/webgl.ts';
import { skyGl } from './sky-gl.ts';

// Clouds drawn on the GPU. The baked maps give each cloud its shape and its light from six
// directions (see clouds.ts); here every pixel works that light out at full precision, and a
// small repeating noise, laid at a fixed size on the screen however far a cloud is stretched,
// eats fine wisps into its thin parts and shades its body, drifting slowly through its own
// depth so the cloud churns as it goes. A dither of under a shade keeps a dark sky's smooth
// greys from falling into steps. One WebGL2 context serves every card: each layer is drawn in
// the canvas's lower-left corner and copied onto the card's own 2D canvas, so moonlight,
// lightning and the order of the layers stay as the 2D drawing has them.

// One cloud to draw, in the CSS pixels of the canvas it goes to.
export interface CloudDraw {
  x: number;
  y: number;
  width: number;
  height: number;
  sprite: number;
  flip: boolean;
  // Where its light comes from ([x, y, z], y up, z toward the viewer) and the light's colour.
  light: Direction;
  sun: Tint;
  ambient: Tint;
  alpha: number;
  // A number of the cloud's own, so no two churn alike.
  seed: number;
  // Where its noise is pinned, if not its own top-left: the copies of a lid share one, so the
  // detail runs on unbroken across their joins.
  anchor?: readonly [x: number, y: number];
}

// How much detail each kind takes, and how much wider than tall its grain is: heaps billow,
// sheets and veils streak along their length.
const DETAIL: Readonly<Record<CloudKind, readonly [strength: number, stretch: number]>> = {
  cumulus: [0.55, 1],
  heap: [0.6, 1],
  nimbus: [0.5, 1.1],
  stratus: [0.5, 1.6],
  patch: [0.5, 1.3],
  altostratus: [0.42, 1.8],
  wispy: [0.38, 1.4],
  cirrus: [0.3, 4],
  cirrostratus: [0.3, 3.5],
  stratusBlanket: [0.45, 2],
  stormBlanket: [0.5, 1.4],
};
// The noise repeats every this many CSS pixels across; its finer octave is half the size, a
// whole number of times smaller so both repeat together.
const PERIOD = 170;
// How far through the noise's depth a cloud drifts each second: one full turn in about 80 s.
const CHURN = 0.0125;
// The noise: a cube this many texels on a side, its lattice this many cells across at the
// coarsest octave, and the octaves summed.
const NOISE = { size: 64, cells: 4, octaves: 3, worleyCells: 4 } as const;

const VERTEX = `#version 300 es
in vec2 a;
uniform vec4 uQuad;   // x, y, width, height in device pixels, y down
uniform vec2 uView;   // the layer's size in device pixels
out vec2 vUv;
out vec2 vPx;
void main() {
  vec2 px = uQuad.xy + a * uQuad.zw;
  vUv = a;
  vPx = px;
  gl_Position = vec4(px.x / uView.x * 2. - 1., 1. - px.y / uView.y * 2., 0., 1.);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DArray;
precision highp sampler3D;
uniform sampler2DArray uMaps;  // light from +x, -x, +y, -y, +z, -z, then coverage
uniform sampler3D uNoise;
uniform vec4 uRect;            // the sprite in the atlas: left, top, width, height, 0 to 1
uniform float uFlip;
uniform vec3 uPlus;            // the light's weights for the +x, +y, +z maps
uniform vec3 uMinus;           // and for -x, -y, -z
uniform vec3 uSun;             // the light's colour times its strength, 0 to 1 a channel
uniform vec3 uAmbient;
uniform float uAlpha;
uniform vec4 uDetail;          // strength, device pixels a noise period, stretch, fine octave on
uniform vec3 uDrift;           // the cloud's top-left in device pixels, and its depth in the noise
in vec2 vUv;
in vec2 vPx;
out vec4 color;

// A map's value, read only from inside this sprite: the next sprite in the atlas begins at its edge.
float layer(vec2 at, float k) {
  vec2 inset = .5 / vec2(textureSize(uMaps, 0).xy);
  return texture(uMaps, vec3(clamp(at, uRect.xy + inset, uRect.xy + uRect.zw - inset), k)).r;
}
float grain(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void main() {
  vec2 at = uRect.xy + vec2(uFlip > .5 ? 1. - vUv.x : vUv.x, vUv.y) * uRect.zw;
  float cover = layer(at, 6.);
  if (cover < .002) discard;
  vec3 plus = vec3(layer(at, 0.), layer(at, 2.), layer(at, 4.)),
    minus = vec3(layer(at, 1.), layer(at, 3.), layer(at, 5.));
  float direct = dot(plus, uPlus) + dot(minus, uMinus),
    mean = (plus.x + plus.y + plus.z + minus.x + minus.y + minus.z) / 6.;
  vec3 lit = min(uSun * direct + uAmbient * mean, vec3(1.));
  // The noise, anchored to the cloud so it travels with it, the same size on screen at any distance.
  vec2 p = (vPx - uDrift.xy) / uDetail.y;
  vec3 q = vec3(p.x / uDetail.z, p.y, uDrift.z);
  float n = texture(uNoise, q).r;
  n = mix(n, .62 * n + .38 * texture(uNoise, q * 2. + vec3(.37, .11, .53)).r, uDetail.w);
  float s = uDetail.x, d = n - .5;
  // Only where the cloud has an edge: how fast its cover changes across a texel of the atlas.
  vec2 texel = 1. / vec2(textureSize(uMaps, 0).xy);
  float across = layer(at + vec2(texel.x, 0.), 6.) - layer(at - vec2(texel.x, 0.), 6.),
    down = layer(at + vec2(0., texel.y), 6.) - layer(at - vec2(0., texel.y), 6.),
    edge = smoothstep(.004, .03, length(vec2(across, down)) * .5);
  // There the noise moves the edge in and out, and the edge is drawn steeper, so a soft rim
  // stretched across many pixels reads as torn wisps rather than blur. Smooth parts stay smooth.
  float torn = clamp(cover + s * 1.4 * d, 0., 1.);
  cover = mix(cover, mix(torn, smoothstep(0., 1., torn), .7), edge);
  lit *= 1. + s * .12 * d;
  float alpha = cover * uAlpha;
  // A triangular dither of a shade either way, in the colour only.
  float dither = (grain(gl_FragCoord.xy) + grain(gl_FragCoord.xy + 17.31) - 1.) / 255.;
  color = vec4(clamp(lit * alpha + dither, 0., alpha), alpha);
}`;

type Uniform =
  | 'uQuad'
  | 'uView'
  | 'uMaps'
  | 'uNoise'
  | 'uRect'
  | 'uFlip'
  | 'uPlus'
  | 'uMinus'
  | 'uSun'
  | 'uAmbient'
  | 'uAlpha'
  | 'uDetail'
  | 'uDrift';
const PLANES = 7;
const COVERAGE = 6;
// Coverage under this many shades is none, as the 2D drawing's mask has it.
const FAINTEST = 2;
const CHANNEL = 255;

const kindOf = (sprite: number): CloudKind =>
  sprite < CLOUD_SPRITES.length
    ? (CLOUD_SPRITES[sprite]?.[0] ?? 'cumulus')
    : (BLANKETS[sprite - CLOUD_SPRITES.length]?.[0] ?? 'stratusBlanket');

// How far the noise runs across, in CSS pixels, before it repeats, for a sprite's kind.
export const noiseRepeat = (sprite: number): number => PERIOD * DETAIL[kindOf(sprite)][1];

// The six maps' weights for light from `light`: each axis's positive and negative share,
// squared, so they sum to one. A mirrored cloud takes its light from the other side.
export function lightWeights(light: Direction, flip: boolean): [plus: number[], minus: number[]] {
  const [x, y, z] = light,
    length = Math.hypot(x, y, z) || 1,
    along = [(flip ? -x : x) / length, y / length, z / length];
  return [along.map(share => Math.max(share, 0) ** 2), along.map(share => Math.max(-share, 0) ** 2)];
}

// A repeating noise in a cube of `size` texels: billowed value noise over four octaves, with
// inverted cell noise for rounded puffs, its values spread to fill 0 to 1 about a middle of
// one half. Built a slice at a time between frames.
export async function noiseCube(size: number, yieldNow: () => Promise<void>): Promise<Uint8Array> {
  const values = new Float32Array(size ** 3),
    octaves = Array.from({ length: NOISE.octaves }, (_, octave) => octaveOf(octave, size)),
    cells = NOISE.worleyCells,
    points = new Float64Array(cells ** 3 * 3),
    around = Int32Array.from({ length: cells + 2 }, (_, i) => wrap(i - 1, cells));
  for (let i = 0; i < cells ** 3; i++) {
    points[i * 3] = hash(i, 101);
    points[i * 3 + 1] = hash(i, 202);
    points[i * 3 + 2] = hash(i, 303);
  }
  for (let z = 0; z < size; z++) {
    noiseSlice(z, size, octaves, { points, around }, values);
    if (z % 8 === 7) await yieldNow();
  }
  let sum = 0,
    squares = 0;
  for (const v of values) {
    sum += v;
    squares += v * v;
  }
  const mean = sum / values.length,
    spread = Math.sqrt(Math.max(1e-6, squares / values.length - mean * mean)),
    out = new Uint8Array(values.length);
  // About two and a half deviations either side fill the range.
  for (const [i, v] of values.entries())
    out[i] = Math.round(Math.min(1, Math.max(0, 0.5 + (v - mean) / (spread * 5))) * CHANNEL);
  return out;
}
const wrap = (v: number, n: number) => ((v % n) + n) % n,
  smooth = (t: number) => t * t * (3 - 2 * t),
  lerp = (a: number, b: number, t: number) => a + (b - a) * t;
// An octave of value noise, `n` cells across: its lattice hashed once, and for each texel
// coordinate (the same along x, y and z) the cells either side and the eased weight between.
interface Octave {
  n: number;
  lattice: Float64Array;
  low: Int32Array;
  high: Int32Array;
  weight: Float64Array;
}
function octaveOf(octave: number, size: number): Octave {
  const n = NOISE.cells * 2 ** octave,
    scale = n / size,
    lattice = new Float64Array(n ** 3),
    low = new Int32Array(size),
    high = new Int32Array(size),
    weight = new Float64Array(size);
  for (let z = 0; z < n; z++)
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) lattice[(z * n + y) * n + x] = hash(x + y * n + octave * 7919, z);
  for (let c = 0; c < size; c++) {
    const p = c * scale,
      cell = Math.floor(p);
    low[c] = wrap(cell, n);
    high[c] = wrap(cell + 1, n);
    weight[c] = smooth(p - cell);
  }
  return { n, lattice, low, high, weight };
}
function valueAt(octave: Octave, x: number, y: number, z: number): number {
  const { n, lattice, low, high, weight } = octave,
    x0 = low[x] ?? 0,
    x1 = high[x] ?? 0,
    y0 = (low[y] ?? 0) * n,
    y1 = (high[y] ?? 0) * n,
    z0 = (low[z] ?? 0) * n * n,
    z1 = (high[z] ?? 0) * n * n,
    fx = weight[x] ?? 0,
    fy = weight[y] ?? 0;
  return lerp(
    lerp(
      lerp(lattice[z0 + y0 + x0] ?? 0, lattice[z0 + y0 + x1] ?? 0, fx),
      lerp(lattice[z0 + y1 + x0] ?? 0, lattice[z0 + y1 + x1] ?? 0, fx),
      fy,
    ),
    lerp(
      lerp(lattice[z1 + y0 + x0] ?? 0, lattice[z1 + y0 + x1] ?? 0, fx),
      lerp(lattice[z1 + y1 + x0] ?? 0, lattice[z1 + y1 + x1] ?? 0, fx),
      fy,
    ),
    weight[z] ?? 0,
  );
}
// One slice of the cube, at depth `z`. The nearest cell point is found by squared distance and
// then measured, so each texel comes out as measuring every neighbour would have it.
function noiseSlice(
  z: number,
  size: number,
  octaves: readonly Octave[],
  { points, around }: { points: Float64Array; around: Int32Array },
  values: Float32Array,
) {
  const cells = NOISE.worleyCells,
    s = cells / size,
    pz = z * s,
    cz = Math.floor(pz);
  for (let y = 0; y < size; y++) {
    const py = y * s,
      cy = Math.floor(py);
    for (let x = 0; x < size; x++) {
      let billow = 0,
        weight = 0.5,
        total = 0;
      for (const octave of octaves) {
        billow += Math.abs(valueAt(octave, x, y, z) * 2 - 1) * weight;
        total += weight;
        weight *= 0.5;
      }
      const px = x * s,
        cx = Math.floor(px);
      let nearest = Infinity,
        ax = 0,
        ay = 0,
        az = 0;
      for (let dz = -1; dz <= 1; dz++) {
        const gz = cz + dz,
          kz = (around[gz + 1] ?? 0) * cells * cells;
        for (let dy = -1; dy <= 1; dy++) {
          const gy = cy + dy,
            ky = kz + (around[gy + 1] ?? 0) * cells;
          for (let dx = -1; dx <= 1; dx++) {
            const gx = cx + dx,
              k = (ky + (around[gx + 1] ?? 0)) * 3,
              ex = gx + (points[k] ?? 0) - px,
              ey = gy + (points[k + 1] ?? 0) - py,
              ez = gz + (points[k + 2] ?? 0) - pz,
              squared = ex * ex + ey * ey + ez * ez;
            if (squared < nearest) {
              nearest = squared;
              ax = ex;
              ay = ey;
              az = ez;
            }
          }
        }
      }
      const puff = 1 - Math.min(1, 9, Math.hypot(ax, ay, az));
      values[(z * size + y) * size + x] = 0.55 * puff + 0.45 * (1 - billow / total);
    }
  }
}

interface Gl {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  shape: WebGLVertexArrayObject;
  corners: WebGLBuffer;
  u: Record<Uniform, WebGLUniformLocation | null>;
  maps: WebGLTexture;
  noise: WebGLTexture;
}

// The painter, once its maps and noise are on the GPU. `feather` eases a blanket's outline as
// the 2D drawing does (see scene.ts), so the copies of an overcast lid meet as they did.
export class CloudPainter {
  // A GPU the browser emulates in software draws clouds slower than the 2D drawing does, and
  // takes the page's time to do it, so the browser is asked for none (tests of the GPU path,
  // which run on one, allow it).
  static software = false;
  // The sky's shared canvas (see sky-gl.ts), which the clouds draw on and copy straight out of.
  readonly canvas: HTMLCanvasElement;
  ready: Promise<boolean>;
  lost = false;
  private state: Gl | null = null;
  constructor(atlas: CloudAtlas, feather: (image: HTMLCanvasElement) => HTMLCanvasElement) {
    const sky = skyGl(CloudPainter.software);
    this.canvas = sky?.canvas ?? document.createElement('canvas');
    this.canvas.addEventListener('webglcontextlost', () => {
      this.lost = true;
      this.state = null;
    });
    this.ready = sky ? this.build(sky.gl, atlas, feather).catch(() => false) : Promise.resolve(false);
  }
  get drawing() {
    return Boolean(this.state) && !this.lost;
  }
  private async build(
    gl: WebGL2RenderingContext,
    atlas: CloudAtlas,
    feather: (image: HTMLCanvasElement) => HTMLCanvasElement,
  ): Promise<boolean> {
    if (atlas.urls.length !== PLANES) return false;
    const yieldNow = () => new Promise<void>(resolve => setTimeout(resolve, 0));
    const program = linkedProgram(gl, 'cloud', VERTEX, FRAGMENT),
      shape = gl.createVertexArray(),
      corners = gl.createBuffer();
    gl.useProgram(program);
    gl.bindVertexArray(shape);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(program, 'a');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    const at = (name: Uniform) => gl.getUniformLocation(program, name),
      uniforms: Record<Uniform, WebGLUniformLocation | null> = {
        uQuad: at('uQuad'),
        uView: at('uView'),
        uMaps: at('uMaps'),
        uNoise: at('uNoise'),
        uRect: at('uRect'),
        uFlip: at('uFlip'),
        uPlus: at('uPlus'),
        uMinus: at('uMinus'),
        uSun: at('uSun'),
        uAmbient: at('uAmbient'),
        uAlpha: at('uAlpha'),
        uDetail: at('uDetail'),
        uDrift: at('uDrift'),
      };
    // The seven planes, one byte a pixel, a layer each. A light map goes up as it was decoded, its
    // red channel taken by the browser; only the coverage is read off the decoded atlas, to drop
    // its faintest shades and ease the blankets' outlines first.
    const width = ATLAS_WIDTH,
      plane = PLANE_HEIGHT;
    // A GPU too small to hold a map in one texture is left to the 2D drawing.
    if (Math.max(width, plane) > gl.getParameter(gl.MAX_TEXTURE_SIZE)) return false;
    const maps = gl.createTexture(),
      levels = Math.floor(Math.log2(Math.max(width, plane))) + 1;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, maps);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.R8, width, plane, PLANES);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // Taken up again after each pause, as the moon may have drawn on the context in between.
    const toMaps = () => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, maps);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    };
    for (const [k, url] of atlas.urls.entries()) {
      const map = await decode(url);
      toMaps();
      if (k !== COVERAGE && map.width === width && map.height === plane)
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, k, width, plane, 1, gl.RED, gl.UNSIGNED_BYTE, map);
      else {
        const bytes = await redOf(map, width, plane, yieldNow);
        if (k === COVERAGE) {
          for (let i = 0; i < bytes.length; i++) if ((bytes[i] ?? 0) < FAINTEST) bytes[i] = 0;
          await featherBlankets(bytes, width, feather, yieldNow);
        }
        toMaps();
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, k, width, plane, 1, gl.RED, gl.UNSIGNED_BYTE, bytes);
      }
      map.close();
      await yieldNow();
    }
    toMaps();
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const noise = gl.createTexture(),
      cube = await noiseCube(NOISE.size, yieldNow);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, noise);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, NOISE.size, NOISE.size, NOISE.size, 0, gl.RED, gl.UNSIGNED_BYTE, cube);
    for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R])
      gl.texParameteri(gl.TEXTURE_3D, wrap, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.useProgram(program);
    gl.uniform1i(uniforms.uMaps, 0);
    gl.uniform1i(uniforms.uNoise, 1);
    if (gl.isContextLost()) return false;
    this.state = { gl, program, shape, corners, u: uniforms, maps, noise };
    return true;
  }
  // Draws `clouds`, in order, onto `target` at its own size and transform; false if it
  // can't, and the caller draws them in 2D. `time` is in seconds; `fine` adds the finer octave.
  paint(target: CanvasRenderingContext2D, clouds: readonly CloudDraw[], time: number, fine = true): boolean {
    const state = this.state;
    if (!state || this.lost) return false;
    const { gl, u } = state,
      ratio = target.getTransform().a || 1,
      { width, height } = target.canvas;
    if (!width || !height) return true;
    const canvas = this.canvas;
    if (canvas.width < width || canvas.height < height) {
      canvas.width = Math.max(canvas.width, width);
      canvas.height = Math.max(canvas.height, height);
    }
    // All it draws with, as the moon may have drawn on the context since.
    gl.useProgram(state.program);
    gl.bindVertexArray(state.shape);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, state.maps);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, state.noise);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(u.uView, width, height);
    for (const cloud of clouds) {
      if (cloud.alpha < 0.004) continue;
      const rect = spriteRect(cloud.sprite),
        [strength, stretch] = DETAIL[kindOf(cloud.sprite)],
        [plus, minus] = lightWeights(cloud.light, cloud.flip),
        [sr, sg, sb, si] = cloud.sun,
        [ar, ag, ab, ai] = cloud.ambient,
        x = cloud.x * ratio,
        y = cloud.y * ratio,
        [pinX, pinY] = cloud.anchor ?? [cloud.x, cloud.y];
      gl.uniform4f(u.uQuad, x, y, cloud.width * ratio, cloud.height * ratio);
      gl.uniform4f(
        u.uRect,
        rect.left / ATLAS_WIDTH,
        rect.top / PLANE_HEIGHT,
        rect.width / ATLAS_WIDTH,
        rect.height / PLANE_HEIGHT,
      );
      gl.uniform1f(u.uFlip, cloud.flip ? 1 : 0);
      gl.uniform3f(u.uPlus, plus[0] ?? 0, plus[1] ?? 0, plus[2] ?? 0);
      gl.uniform3f(u.uMinus, minus[0] ?? 0, minus[1] ?? 0, minus[2] ?? 0);
      gl.uniform3f(u.uSun, (sr * si) / CHANNEL, (sg * si) / CHANNEL, (sb * si) / CHANNEL);
      gl.uniform3f(u.uAmbient, (ar * ai) / CHANNEL, (ag * ai) / CHANNEL, (ab * ai) / CHANNEL);
      gl.uniform1f(u.uAlpha, Math.min(1, cloud.alpha));
      gl.uniform4f(u.uDetail, strength, PERIOD * ratio, stretch, fine ? 1 : 0);
      gl.uniform3f(u.uDrift, pinX * ratio, pinY * ratio, cloud.seed + time * CHURN);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = 1;
    target.globalCompositeOperation = 'source-over';
    target.drawImage(canvas, 0, canvas.height - height, width, height, 0, 0, width, height);
    target.restore();
    return true;
  }
  // Frees the GPU's copies at once, as when the page is done with its clouds. The context stays,
  // as the moon draws on it too.
  dispose() {
    const state = this.state;
    this.state = null;
    if (!state) return;
    const { gl } = state;
    gl.deleteTexture(state.maps);
    gl.deleteTexture(state.noise);
    gl.deleteVertexArray(state.shape);
    gl.deleteBuffer(state.corners);
    gl.deleteProgram(state.program);
  }
}

// A decoded map's red channel at `width` by `height`, a byte a pixel, read a band of rows at a
// time between frames.
const BAND_ROWS = 512;
async function redOf(
  map: ImageBitmap,
  width: number,
  height: number,
  yieldNow: () => Promise<void>,
): Promise<Uint8Array> {
  const scratch = document.createElement('canvas');
  scratch.width = width;
  scratch.height = height;
  const read = context2d(scratch, { willReadFrequently: true });
  read.drawImage(map, 0, 0, width, height);
  const bytes = new Uint8Array(width * height);
  for (let top = 0; top < height; top += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, height - top),
      { data } = read.getImageData(0, top, width, rows),
      start = top * width;
    for (let i = 0; i < rows * width; i++) bytes[start + i] = data[i * 4] ?? 0;
    await yieldNow();
  }
  scratch.width = scratch.height = 0;
  return bytes;
}

// Each blanket's coverage with its outline eased (see feathered in scene.ts), written back
// into the coverage plane, so a lid drawn here meets its copies as the 2D one does. One
// blanket at a time, between frames.
async function featherBlankets(
  coverage: Uint8Array,
  width: number,
  feather: (image: HTMLCanvasElement) => HTMLCanvasElement,
  yieldNow: () => Promise<void>,
) {
  for (let b = 0; b < BLANKETS.length; b++) {
    await yieldNow();
    const { left, top, width: w, height: h } = spriteRect(CLOUD_SPRITES.length + b),
      image = document.createElement('canvas');
    image.width = w;
    image.height = h;
    const c = context2d(image),
      pixels = c.createImageData(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const q = (y * w + x) * 4;
        pixels.data[q] = pixels.data[q + 1] = pixels.data[q + 2] = CHANNEL;
        pixels.data[q + 3] = coverage[(top + y) * width + left + x] ?? 0;
      }
    c.putImageData(pixels, 0, 0);
    const eased = context2d(feather(image), { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) coverage[(top + y) * width + left + x] = eased[(y * w + x) * 4 + 3] ?? 0;
  }
}

// One painter for the page, built from the atlas's maps; null while it builds, if WebGL2 isn't
// there, or after its context was lost twice. Once it can draw, the 2D maps are let go; if it
// can't, they are decoded for the 2D drawing.
let shared: { atlas: CloudAtlas; painter: CloudPainter } | undefined,
  losses = 0;
const GIVE_UP = 2;
export function cloudPainter(
  atlas: CloudAtlas | undefined,
  feather: (image: HTMLCanvasElement) => HTMLCanvasElement,
): CloudPainter | null {
  if (!atlas) return null;
  if (shared && shared.atlas !== atlas) {
    shared.painter.dispose();
    shared = undefined;
  }
  if (shared?.painter.lost) {
    losses++;
    shared = undefined;
    atlas.restore();
  }
  if (!shared && losses < GIVE_UP) {
    const painter = new CloudPainter(atlas, feather);
    shared = { atlas, painter };
    void painter.ready.then(ok => {
      if (shared?.painter !== painter) return;
      if (ok) {
        atlas.release();
        atlas.drawable();
      } else atlas.restore();
    });
  }
  return shared?.painter.drawing ? shared.painter : null;
}
// Drops the shared painter, as tests between skies need.
export function resetCloudPainter() {
  shared?.painter.dispose();
  shared = undefined;
  losses = 0;
}
