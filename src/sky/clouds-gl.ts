import { cloudAtlasWidth, cloudAtlasHeight, spriteRect } from './clouds.ts';
import { type CloudAtlas, type Direction, type Tint, decode, lightWeights } from './cloud-decks.ts';
import { context2d } from '../lib/canvas.ts';
import { linkedProgram } from '../lib/webgl.ts';
import { skyGl } from './sky-gl.ts';

// Signed light maps and an opacity mask draw into the shared sky context.
export interface CloudDraw {
  x: number;
  y: number;
  width: number;
  height: number;
  sprite: number;
  flip: boolean;
  light: Direction;
  sun: Tint;
  ambient: Tint;
  fill?: Tint;
  opacity?: number;
  alpha: number;
}

const VERTEX = `#version 300 es
in vec2 a;
uniform vec4 uQuad;   // x, y, width, height in device pixels, y down
uniform vec2 uView;   // the layer's size in device pixels
out vec2 vUv;
void main() {
  vec2 px = uQuad.xy + a * uQuad.zw;
  vUv = a;
  gl_Position = vec4(px.x / uView.x * 2. - 1., 1. - px.y / uView.y * 2., 0., 1.);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uMaps;
uniform vec4 uRect;
uniform float uFlip;
uniform vec3 uPlus;
uniform vec3 uMinus;
uniform vec3 uSun;
uniform vec3 uFill;
uniform vec3 uAmbient;
uniform float uOpacity;
uniform float uAlpha;
in vec2 vUv;
out vec4 color;
float layer(vec2 at, float k) {
  vec2 inset = .5 / vec2(textureSize(uMaps, 0).xy);
  return texture(uMaps, vec3(clamp(at, uRect.xy + inset, uRect.xy + uRect.zw - inset), k)).r;
}
void main() {
  vec2 at = uRect.xy + vec2(uFlip > .5 ? 1. - vUv.x : vUv.x, vUv.y) * uRect.zw;
  float cover = layer(at, 6.);
  vec3 plus = vec3(layer(at, 0.), layer(at, 2.), layer(at, 4.));
  vec3 minus = vec3(layer(at, 1.), layer(at, 3.), layer(at, 5.));
  float direct = dot(plus, uPlus) + dot(minus, uMinus);
  float opposite = dot(plus, uMinus) + dot(minus, uPlus);
  vec3 pigment = uSun * direct + uFill * opposite + uAmbient;
  float alpha = cover * uOpacity * uAlpha;
  color = vec4(clamp(pigment * cover * uAlpha, 0., alpha), alpha);
}`;
type Uniform =
  | 'uQuad'
  | 'uView'
  | 'uMaps'
  | 'uRect'
  | 'uFlip'
  | 'uPlus'
  | 'uMinus'
  | 'uSun'
  | 'uFill'
  | 'uAmbient'
  | 'uOpacity'
  | 'uAlpha';
const PLANES = 7;
const CHANNEL = 255;
export { lightWeights } from './cloud-decks.ts';

interface Gl {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  shape: WebGLVertexArrayObject;
  corners: WebGLBuffer;
  u: Record<Uniform, WebGLUniformLocation | null>;
  maps: WebGLTexture;
}

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
  constructor(atlas: CloudAtlas) {
    const sky = skyGl(CloudPainter.software);
    this.canvas = sky?.canvas ?? document.createElement('canvas');
    this.canvas.addEventListener('webglcontextlost', () => {
      this.lost = true;
      this.state = null;
    });
    this.ready = sky ? this.build(sky.gl, atlas).catch(() => false) : Promise.resolve(false);
  }
  get drawing() {
    return Boolean(this.state) && !this.lost;
  }
  private async build(gl: WebGL2RenderingContext, atlas: CloudAtlas): Promise<boolean> {
    if (atlas.urls.length !== PLANES) return false;
    const yieldNow = () => new Promise<void>(resolve => setTimeout(resolve, 0));
    const width = cloudAtlasWidth(),
      plane = cloudAtlasHeight();
    if (Math.max(width, plane) > gl.getParameter(gl.MAX_TEXTURE_SIZE)) return false;
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
        uRect: at('uRect'),
        uFlip: at('uFlip'),
        uPlus: at('uPlus'),
        uMinus: at('uMinus'),
        uSun: at('uSun'),
        uAmbient: at('uAmbient'),
        uFill: at('uFill'),
        uOpacity: at('uOpacity'),
        uAlpha: at('uAlpha'),
      };
    // The seven planes keep the decoded data channels, including their faintest opacity.
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
      try {
        if (map.width === width && map.height === plane) {
          gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, k, width, plane, 1, gl.RED, gl.UNSIGNED_BYTE, map);
        } else {
          const bytes = await redOf(map, width, plane, yieldNow);
          toMaps();
          gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, k, width, plane, 1, gl.RED, gl.UNSIGNED_BYTE, bytes);
        }
      } finally {
        map.close();
      }
      await yieldNow();
    }
    toMaps();
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.useProgram(program);
    gl.uniform1i(uniforms.uMaps, 0);
    if (gl.isContextLost()) return false;
    this.state = { gl, program, shape, corners, u: uniforms, maps };
    return true;
  }
  // Draws `clouds`, in order, onto `target` at its own size and transform; false if it
  // can't, and the caller draws the same material in 2D.
  paint(target: CanvasRenderingContext2D, clouds: readonly CloudDraw[]): boolean {
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
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(u.uView, width, height);
    for (const cloud of clouds) {
      if (cloud.alpha <= 0 || cloud.opacity === 0) continue;
      const rect = spriteRect(cloud.sprite),
        [plus, minus] = lightWeights(cloud.light, cloud.flip),
        [sr, sg, sb, si] = cloud.sun,
        [ar, ag, ab, ai] = cloud.ambient,
        [fr, fg, fb, fi] = cloud.fill ?? [0, 0, 0, 0],
        x = cloud.x * ratio,
        y = cloud.y * ratio;
      gl.uniform4f(u.uQuad, x, y, cloud.width * ratio, cloud.height * ratio);
      gl.uniform4f(
        u.uRect,
        rect.left / cloudAtlasWidth(),
        rect.top / cloudAtlasHeight(),
        rect.width / cloudAtlasWidth(),
        rect.height / cloudAtlasHeight(),
      );
      gl.uniform1f(u.uFlip, cloud.flip ? 1 : 0);
      gl.uniform3f(u.uPlus, plus[0] ?? 0, plus[1] ?? 0, plus[2] ?? 0);
      gl.uniform3f(u.uMinus, minus[0] ?? 0, minus[1] ?? 0, minus[2] ?? 0);
      gl.uniform3f(u.uSun, (sr * si) / CHANNEL, (sg * si) / CHANNEL, (sb * si) / CHANNEL);
      gl.uniform3f(u.uAmbient, (ar * ai) / CHANNEL, (ag * ai) / CHANNEL, (ab * ai) / CHANNEL);
      gl.uniform3f(u.uFill, (fr * fi) / CHANNEL, (fg * fi) / CHANNEL, (fb * fi) / CHANNEL);
      gl.uniform1f(u.uOpacity, Math.min(1, Math.max(0, cloud.opacity ?? 1)));
      gl.uniform1f(u.uAlpha, Math.min(1, Math.max(0, cloud.alpha)));
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

let shared: { atlas: CloudAtlas; painter: CloudPainter } | undefined;
let losses = 0;
const GIVE_UP = 2;
export function cloudPainter(atlas: CloudAtlas | undefined): CloudPainter | null {
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
    const painter = new CloudPainter(atlas);
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
