import { context2d } from '../lib/canvas.ts';
import { linkedOrNull } from '../lib/webgl.ts';
import { skyGl } from './sky-gl.ts';

// The tile and sheet moons, drawn on the GPU: a sphere wrapped in the near side's
// colour and lit by the sun through its surface normals (scripts/moon-relief.py), so
// crater rims catch the light and their far walls fall dark along the terminator, as
// they do through a telescope. The sky's hidden WebGL2 canvas (see sky-gl.ts) draws every moon,
// each copied onto its own canvas, so a page holds one GPU context for its clouds and moons.
// The shading is the CPU renderer's (weather-moon.ts) with the light's incidence taken
// from the surface rather than the smooth sphere; without WebGL2 that renderer draws them.

// The tile's moon is screened over the tile, as moonlight adds to the sky: a grey image screened
// over anything is that much white laid over it, so it needs no blend mode, which couldn't see the
// glass anyway. How much white: `base` at the near side's mean tone, `slope` for each step of its
// tone, and the unlit side `ghost` of that, fading into it softly across the incidence
// `from`..`to`. Shared with the CPU renderer.
export const TILE_NIGHT = { ghost: 0.18, from: -0.12, to: 0.26 } as const;
export const TILE_LIGHT = { base: 0.37, slope: 0.9, mean: 0.349 } as const;
// The sheet's photograph: its floor lifts the moon's shadows, so it fades out over this incidence,
// or the last of the day side stands flat against the night beside the terminator. And past the
// full moon's brightest days the whole face dims, by `rate` for each share of it gone below `full`:
// a half moon is about three quarters as bright as a full one, surface for surface.
export const SHEET_FLOOR = { tone: 0.181, from: -0.03, to: 0.2 } as const;
export const SHEET_DIM = { full: 0.85, rate: 0.6 } as const;
export const sheetDim = (lit: number): number => Math.min(1, 1 - SHEET_DIM.rate * (SHEET_DIM.full - lit));
// The prints a moon is drawn as. The sheet's is a photograph whose unlit side is near black, and
// the tile's is described above. The calendar's is screened over the sheet like the tile's, white
// as much as its tone, and lit as a rough ball rather than the sheet's flat full moon. In linear
// light, its tone is `gain` times the map's to the power `gamma`, under light that is `share`
// Minnaert (exponent `k`: it darkens into the terminator and a little toward the rim) and the rest
// Lommel–Seeliger, with `night` of earthshine on the unlit side, and its relief leans `relief`.
// It is worked out `samples` times as finely each way and averaged, so craters along the terminator
// soften it into a ragged gradient, and a crescent's rim stays bright and grainy.
export type MoonPrint = 'sheet' | 'tile' | 'calendar';
export const CALENDAR_LIGHT = {
  gain: 1.69,
  gamma: 2.1,
  share: 0.76,
  k: 1.5,
  night: 0.011,
  relief: 0.69,
  samples: 4,
} as const;
// A number as a GLSL float literal, to three decimals: finer than any constant here is tuned.
const GLSL_DIGITS = 3;
const glsl = (value: number) => value.toFixed(GLSL_DIGITS);

const VERTEX = `#version 300 es
void main() {
  gl_Position = vec4(float(gl_VertexID & 1) * 2.0 - 1.0, float(gl_VertexID >> 1) * 2.0 - 1.0, 0.0, 1.0);
}`;
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D surface;
uniform float size;
uniform vec2 sun;
uniform vec2 turn;
uniform float strength;
uniform bool bright;
uniform bool screened;
out vec4 color;
const float PI = 3.14159265;
float ramp(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
// The surface's normal where the sphere's own, with y up, is up (at longitude lon and latitude
// lat), leaning by the map's slopes gb times lean.
vec3 relief(vec3 up, float lon, float lat, vec2 gb, float lean) {
  // Seen edge-on at the limb the relief is foreshortened to noise, so it fades out there.
  vec2 slope = (gb * 2.0 - 1.0) * lean * ramp(0.0, 0.3, up.z);
  vec3 east = vec3(cos(lon), 0.0, -sin(lon));
  vec3 north = vec3(-sin(lat) * sin(lon), cos(lat), -sin(lat) * cos(lon));
  vec3 normal = normalize(up * sqrt(max(0.0, 1.0 - dot(slope, slope))) + east * slope.x + north * slope.y);
  // A slope the eye can see faces it at least a little: near the limb one leaning away would
  // be shaded as night even with the sun behind the viewer.
  return normalize(normal + vec3(0.0, 0.0, max(0.0, 0.12 - normal.z)));
}
float encode(float v) {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * pow(v, 1.0 / 2.4) - 0.055;
}
const int SAMPLES = ${CALENDAR_LIGHT.samples};
// The calendar's light at p on the disc (-1..1, y down), for a disc fine samples across.
// A point past the rim is read at the rim, so the samples beside it still have a map to read.
float calendarLight(vec2 p, float fine) {
  float r = length(p), edge = clamp((1.0 - r) * fine / 2.0 + 0.5, 0.0, 1.0);
  vec2 at = p / max(r, 1.0), q = vec2(turn.x * at.x + turn.y * at.y, -turn.y * at.x + turn.x * at.y);
  vec3 up = vec3(q.x, -q.y, sqrt(max(0.0, 1.0 - dot(q, q))));
  float lon = atan(up.x, up.z), lat = asin(clamp(up.y, -1.0, 1.0));
  vec2 uv = vec2(lon / PI + 0.5, acos(clamp(up.y, -1.0, 1.0)) / PI);
  // Read as finely as the samples are spaced, not as the pixels are.
  vec4 map = textureGrad(surface, uv, dFdx(uv) / float(SAMPLES), dFdy(uv) / float(SAMPLES));
  vec3 normal = relief(up, lon, lat, map.gb, ${glsl(CALENDAR_LIGHT.relief)});
  float lit = max(0.0, dot(normal, vec3(sun.x, 0.0, sun.y))), mu = max(normal.z, 0.02);
  float k = ${glsl(CALENDAR_LIGHT.k)}, share = ${glsl(CALENDAR_LIGHT.share)};
  float light = ${glsl(CALENDAR_LIGHT.gain)} * pow(map.r, ${glsl(CALENDAR_LIGHT.gamma)})
    * (share * pow(lit, k) * pow(mu, k - 1.0) + (1.0 - share) * 2.0 * lit / (lit + mu) + ${glsl(CALENDAR_LIGHT.night)});
  return encode(min(1.0, light)) * edge;
}
void main() {
  if (screened) {
    float sum = 0.0;
    for (int i = 0; i < SAMPLES; i++)
      for (int j = 0; j < SAMPLES; j++) {
        vec2 at = gl_FragCoord.xy + (vec2(float(i), float(j)) + 0.5) / float(SAMPLES) - 0.5;
        sum += calendarLight(vec2(at.x, size - at.y) / size * 2.0 - 1.0, size * float(SAMPLES));
      }
    float light = sum / float(SAMPLES * SAMPLES);
    color = vec4(vec3(light), light);
    return;
  }
  // The pixel's centre on the disc, -1..1 with y down, as the CPU renderer lays it out.
  vec2 p = vec2(gl_FragCoord.x, size - gl_FragCoord.y) / size * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0 + 1.0 / size) {
    color = vec4(0.0);
    return;
  }
  float edge = clamp((1.0 - r) * size / 2.0 + 0.5, 0.0, 1.0);
  // Turned clockwise: each pixel shows the point the turn carried there.
  vec2 q = vec2(turn.x * p.x + turn.y * p.y, -turn.y * p.x + turn.x * p.y);
  float z = sqrt(max(0.0, 1.0 - dot(q, q)));
  // The sphere's normal with y up, its longitude and latitude, and the map there.
  vec3 up = vec3(q.x, -q.y, z);
  float lon = atan(up.x, up.z), lat = asin(clamp(up.y, -1.0, 1.0));
  vec4 map = texture(surface, vec2(lon / PI + 0.5, acos(clamp(up.y, -1.0, 1.0)) / PI));
  vec3 normal = relief(up, lon, lat, map.gb, strength);
  float incidence = dot(normal, vec3(sun.x, 0.0, sun.y)), lit = max(0.0, incidence);
  float value, alpha;
  if (bright) {
    float tone = clamp(${glsl(TILE_LIGHT.base)} + (map.r - ${glsl(TILE_LIGHT.mean)}) * ${glsl(TILE_LIGHT.slope)}, 0.0, 1.0);
    float light = tone * (0.96 + 0.04 * sqrt(z)) * (0.8 + 0.2 * ramp(0.0, 0.25, incidence))
      * mix(${glsl(TILE_NIGHT.ghost)}, 1.0, ramp(${glsl(TILE_NIGHT.from)}, ${glsl(TILE_NIGHT.to)}, incidence)) * edge;
    color = vec4(vec3(light), light);
    return;
  } else {
    float tone = clamp((80.0 + (map.r - 0.29) * 299.0) / 255.0, 0.0, 1.0);
    // Lommel–Seeliger on the surface's own slope: with the sun behind the viewer every slope
    // shines alike, so the full moon looks flat, and the relief stands out toward the terminator.
    float shade = min(1.0, 2.0 * lit / (lit + max(normal.z, 0.0) + 0.001)) * (0.6 + 0.4 * z);
    float day = ${glsl(SHEET_FLOOR.tone)} * ramp(${glsl(SHEET_FLOOR.from)}, ${glsl(SHEET_FLOOR.to)}, incidence)
      + 1.036 * pow(tone * shade * (0.55 + 0.45 * ramp(0.0, 0.3, incidence)), 1.25);
    day *= min(1.0, 1.0 - ${glsl(SHEET_DIM.rate)} * (${glsl(SHEET_DIM.full)} - (1.0 + sun.y) / 2.0));
    float night = 0.144 * max(0.0, tone - 0.13);
    value = night + (day - night) * ramp(-0.03, 0.04, incidence);
    alpha = edge;
  }
  color = vec4(min(vec3(1.0), value * vec3(0.98, 1.0, 1.02)) * alpha, alpha);
}`;
// How far the baked normals lean, where 1 is as baked (relief already exaggerated threefold).
const STRENGTH = 1.4;
// The canvas is covered by one square, drawn as a strip of two triangles: its four corners
// (the vertex shader places each from its index).
const CORNERS = 4;

interface Gpu {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  program: WebGLProgram;
  relief: WebGLTexture;
  at: Record<'size' | 'sun' | 'turn' | 'strength' | 'bright' | 'screened', WebGLUniformLocation | null>;
}
let gpu: Promise<Gpu | null> | undefined;

function setUp(): Promise<Gpu | null> {
  gpu ??= new Promise(resolve => {
    const sky = skyGl(true),
      program = sky && linkedOrNull(sky.gl, 'moon', VERTEX, FRAGMENT);
    if (!sky || !program) {
      resolve(null);
      return;
    }
    const { canvas, gl } = sky;
    // A lost context (the GPU reset, or the page holding too many) is set up afresh on the next draw.
    canvas.addEventListener('webglcontextlost', () => {
      gpu = undefined;
    });
    // Decoded away from the page's thread, and as stored: the channels are data, not colours, so
    // no colour management on the way in.
    const upload = (image: ImageBitmap) => {
      const relief = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, relief);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB8, gl.RGB, gl.UNSIGNED_BYTE, image);
      image.close();
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const at = (name: string) => gl.getUniformLocation(program, name);
      resolve({
        gl,
        canvas,
        program,
        relief,
        at: {
          size: at('size'),
          sun: at('sun'),
          turn: at('turn'),
          strength: at('strength'),
          bright: at('bright'),
          screened: at('screened'),
        },
      });
    };
    fetch(new URL('../../assets/moon-relief.avif', import.meta.url).href)
      .then(async response => {
        if (!response.ok) throw new Error('The moon relief did not come.');
        return createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      })
      .then(upload)
      .catch(() => resolve(null));
  });
  return gpu;
}

// Draws the moon filling `target` (`size` pixels square, already sized) at `phase` (0 new,
// .5 full), turned `turn` radians clockwise, as `print`. False when there is no GPU to draw with.
export async function drawMoonGpu(
  target: HTMLCanvasElement,
  size: number,
  phase: number,
  turn: number,
  print: MoonPrint,
): Promise<boolean> {
  const set = await setUp();
  if (!set || set.gl.isContextLost()) return false;
  const { gl, canvas, at } = set,
    angle = 2 * Math.PI * phase;
  // All it draws with, as the clouds draw on the context too; in its foot corner, so the canvas only
  // ever grows.
  if (canvas.width < size || canvas.height < size) {
    canvas.width = Math.max(canvas.width, size);
    canvas.height = Math.max(canvas.height, size);
  }
  gl.useProgram(set.program);
  gl.bindVertexArray(null);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, set.relief);
  gl.disable(gl.BLEND);
  gl.viewport(0, 0, size, size);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.uniform1f(at.size, size);
  // The sun behind the moon at new, behind the viewer at full: lit from the right while waxing.
  gl.uniform2f(at.sun, Math.sin(angle), -Math.cos(angle));
  gl.uniform2f(at.turn, Math.cos(turn), Math.sin(turn));
  gl.uniform1f(at.strength, STRENGTH);
  gl.uniform1i(at.bright, print === 'tile' ? 1 : 0);
  gl.uniform1i(at.screened, print === 'calendar' ? 1 : 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, CORNERS);
  const ctx = context2d(target);
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(canvas, 0, canvas.height - size, size, size, 0, 0, size, size);
  return true;
}
