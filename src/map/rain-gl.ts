// Rain over the live map, drawn from its readings rather than from pictures of them: the radar's
// reflectivity, tile by tile, or the forecast's precipitation on its grid, each frame a texture of
// readings on the GPU. Between two frames the readings blend and only then take their colours, so
// rain grows, fades and moves on as it goes, rather than one picture showing through the next; and
// between texels they are smoothed, so their edges stay round however far the map is zoomed past
// them: the radar's through a curve that keeps each reading where it was taken (Catmull-Rom), its
// texels being finer than the rain; the forecast's points, far coarser than the showers they
// stand for, through a softer one (a cubic B-spline), so that rain at one point alone is a round
// patch rather than a square. Future radar frames come from a forecast model; the renderer never
// moves an observation beyond its timestamp to manufacture a forecast.
import { tilePoint, type ScalarField } from './sources.ts';
import { scaleColour, RADAR_NONE, type Stop } from './field.ts';
import { fieldGaps } from './coverage.ts';
import { linkedOrNull } from '../lib/webgl.ts';

// The most stops a scale has, and a reading's colour between two of them blended from both.
const STOPS = 12;
const VERTEX = `#version 300 es
uniform mat4 matrix;
out vec2 place;
void main() {
  place = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  gl_Position = matrix * vec4(place, 0.0, 1.0);
}`;
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D from;
uniform sampler2D to;
uniform float share;
uniform vec2 size;
uniform bool grid;
uniform float soften;
uniform bvec2 forecast;
uniform float modelScale;
uniform vec4 rows;
uniform vec3 columns;
uniform float pixelRatio;
uniform vec2 reading;
uniform float values[${STOPS}];
uniform vec4 colours[${STOPS}];
uniform int count;
uniform float opacity;
in vec2 place;
out vec4 color;
const float PI = 3.14159265;
// A texture's reading at a place in texels, smoothed through the sixteen around it: Catmull-Rom
// in nine bilinear samples, or the B-spline in four.
float sharp(sampler2D data, vec2 at) {
  vec2 middle = floor(at - 0.5) + 0.5, f = at - middle;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 a = (middle - 1.0) / size, b = (middle + w2 / w12) / size, c = (middle + 2.0) / size;
  return (texture(data, vec2(a.x, a.y)).r * w0.x + texture(data, vec2(b.x, a.y)).r * w12.x + texture(data, vec2(c.x, a.y)).r * w3.x) * w0.y
    + (texture(data, vec2(a.x, b.y)).r * w0.x + texture(data, vec2(b.x, b.y)).r * w12.x + texture(data, vec2(c.x, b.y)).r * w3.x) * w12.y
    + (texture(data, vec2(a.x, c.y)).r * w0.x + texture(data, vec2(b.x, c.y)).r * w12.x + texture(data, vec2(c.x, c.y)).r * w3.x) * w3.y;
}
float soft(sampler2D data, vec2 at, float level) {
  float step = exp2(level);
  at /= step;
  vec2 dimensions = size / step;
  vec2 middle = floor(at - 0.5) + 0.5, f = at - middle, g = 1.0 - f;
  vec2 w0 = g * g * g / 6.0, w3 = f * f * f / 6.0;
  vec2 w1 = (4.0 - 6.0 * f * f + 3.0 * f * f * f) / 6.0, w2 = 1.0 - w0 - w1 - w3;
  vec2 near = w0 + w1, far = w2 + w3;
  vec2 a = (middle - 1.0 + w1 / near) / dimensions, b = (middle + 1.0 + w3 / far) / dimensions;
  return (textureLod(data, vec2(a.x, a.y), level).r * near.x + textureLod(data, vec2(b.x, a.y), level).r * far.x) * near.y
    + (textureLod(data, vec2(a.x, b.y), level).r * near.x + textureLod(data, vec2(b.x, b.y), level).r * far.x) * far.y;
}
float smoothed(sampler2D data, vec2 at, bool model) {
  if (model) {
    // The forecast's cells cover kilometres, even when its PNG repeats each reading over many
    // pixels. Average the readings at that scale, then reconstruct rounded edges. Two mip levels
    // blend continuously with latitude; the same ground keeps its appearance when panned.
    float latitudeScale = cosh(PI * (1.0 - 2.0 * mix(rows.x, rows.y, place.y)));
    float level = clamp(log2(max(2.0, modelScale * latitudeScale)), 1.0, 8.0);
    float lower = floor(level);
    return mix(soft(data, at, lower), soft(data, at, lower + 1.0), fract(level));
  }
  return soften <= 0.0 ? sharp(data, at) : soften >= 1.0 ? soft(data, at, 0.0) : mix(sharp(data, at), soft(data, at, 0.0), soften);
}
vec4 tint(float value) {
  if (value <= values[0]) return colours[0];
  for (int i = 1; i < count; i++)
    if (value <= values[i]) return mix(colours[i - 1], colours[i], (value - values[i - 1]) / (values[i] - values[i - 1]));
  return colours[count - 1];
}
void main() {
  // On a grid, its points are a step of degrees apart, its rows even in latitude, not in the map's
  // own projection: each pixel's latitude says which row it lies on.
  vec2 at;
  if (grid) {
    float latitude = degrees(atan(sinh(PI * (1.0 - 2.0 * mix(rows.x, rows.y, place.y)))));
    at = vec2((mix(columns.x, columns.y, place.x) - columns.z) / rows.w, (rows.z - latitude) / rows.w) + 0.5;
    // Valid zero rain stays clear. Missing readings and places beyond this grid are unknown.
    bool outside = any(lessThan(at, vec2(0.5))) || any(greaterThan(at, size - 0.5));
    float valid = share == 0.0 ? texture(from, at / size).g
      : min(texture(from, at / size).g, texture(to, at / size).g);
    if (outside || valid < 0.999) {
      float stripe = 1.0 - smoothstep(1.5, 2.5, mod((gl_FragCoord.x - gl_FragCoord.y) / pixelRatio, 8.0));
      color = vec4(0.0, 0.0, 0.0, stripe * 0.22);
      return;
    }
  } else at = place * size;
  vec4 tinted = tint(mix(smoothed(from, at, forecast.x), smoothed(to, at, forecast.y), share) * reading.x + reading.y);
  color = vec4(tinted.rgb * tinted.a, tinted.a) * opacity;
}`;
const UNIFORMS = [
  'matrix',
  'from',
  'to',
  'share',
  'size',
  'grid',
  'soften',
  'forecast',
  'modelScale',
  'rows',
  'columns',
  'pixelRatio',
  'reading',
  'values',
  'colours',
  'count',
  'opacity',
] as const;
type Uniform = (typeof UNIFORMS)[number];

// A quad is drawn as a strip of two triangles: its four corners (the vertex shader places each).
const CORNERS = 4;
// A mat4's side, and the byte a channel's reading is stored in.
const MAT = 4,
  BYTE = 255;
// The radar's texels are finer than its rain, but stretched far past them they show the blocks its
// readings come in: from half a zoom past its deepest, the sharp curve gives way to the soft, all
// of the way two zooms further in.
const SOFTEN = { from: 0.5, over: 2 } as const;
// Both frames lie at 90%.
const OPACITY = 0.9;
// The map's tiles are 512 px; the radar's come no deeper than zoom 7.
const TILE = 512,
  DEEPEST = 7;
// Reconstruct at half an HRRR cell: enough to round its edges while retaining small storm cores.
// The first mip also removes the 256-to-512 PNG duplication used to decode the forecast palette.
const MODEL_SMOOTH_METRES = 1500,
  EARTH_METRES = 40_075_017;
// At most so many tiles are asked for at once, nearest the middle of the view first, and one that
// failed is asked for again after half a minute, then twice as long after each failure up to ten
// minutes, so a screen left offline keeps trying without asking all day. Held still, tiles come for the frame shown and
// the three after it, round the loop, so the radar's tiles, at most 500 a minute for a home,
// aren't spent on frames that may never be shown; playing, for every frame, as each will be.
const ASKED = 8,
  RETRY = 30_000,
  RETRY_LONGEST = 600_000,
  AHEAD = 3;
// How long a tile that has just failed waits before it is asked for again, after the wait it last had.
export const failedWait = (before: number | undefined): number =>
  before === undefined ? RETRY : Math.min(before * 2, RETRY_LONGEST);
// Web Mercator ends here.
const POLE = 85.0511,
  HALF_TURN = 180,
  FULL_TURN = 360;

// What the layer needs of the map.
export interface RainMap {
  getCanvas(): HTMLCanvasElement;
  getZoom(): number;
  getBounds(): { getNorth(): number; getSouth(): number; getEast(): number; getWest(): number };
  getCenter(): { lng: number; lat: number };
  triggerRepaint(): void;
}
// A radar tile's readings, a byte a pixel, 512 by 512 (see radarLevels); null where none came.
export type RadarLoad = (url: string, signal: AbortSignal) => Promise<Uint8Array | null>;
// What MapLibre hands a custom layer as it draws.
interface DrawInput {
  modelViewProjectionMatrix: ArrayLike<number>;
}

// A radar frame's readings over the tiles in view, at one zoom: each tile's own, one rough from
// another zoom's until its own come, part of one, or none yet. A frame is whole once none of its
// tiles is only part there or not at all.
type Held = 'own' | 'rough' | 'part' | 'none';
const whole = (held: Held) => held === 'own' || held === 'rough';
interface Mosaic {
  z: number;
  x: number;
  y: number;
  cols: number;
  rows: number;
  texture: WebGLTexture;
  held: Held[];
  mipmapped: boolean;
}
interface Range {
  z: number;
  x: number;
  y: number;
  cols: number;
  rows: number;
}
const sameRange = (a: Range, b: Range) =>
  a.z === b.z && a.x === b.x && a.y === b.y && a.cols === b.cols && a.rows === b.rows;
const tileUrl = (template: string, z: number, x: number, y: number) =>
  template
    .replace('{z}', String(z))
    .replace('{x}', String(((x % 2 ** z) + 2 ** z) % 2 ** z))
    .replace('{y}', String(y));
const mercatorY = (latitude: number) => {
  const phi = (Math.max(-POLE, Math.min(POLE, latitude)) * Math.PI) / HALF_TURN;
  return (1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2;
};

interface Gpu {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  shapes: WebGLVertexArrayObject;
  read: WebGLFramebuffer;
  write: WebGLFramebuffer;
  at: Record<Uniform, WebGLUniformLocation | null>;
  largest: number;
}
function setUp(gl: WebGL2RenderingContext): Gpu | null {
  const program = linkedOrNull(gl, 'rain map', VERTEX, FRAGMENT);
  if (!program) return null;
  const at = Object.fromEntries(
    UNIFORMS.map(name => [
      name,
      gl.getUniformLocation(program, name === 'values' || name === 'colours' ? `${name}[0]` : name),
    ]),
  );
  const largest: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  return {
    gl,
    program,
    shapes: gl.createVertexArray(),
    read: gl.createFramebuffer(),
    write: gl.createFramebuffer(),
    at: {
      matrix: at['matrix'] ?? null,
      from: at['from'] ?? null,
      to: at['to'] ?? null,
      share: at['share'] ?? null,
      size: at['size'] ?? null,
      grid: at['grid'] ?? null,
      soften: at['soften'] ?? null,
      forecast: at['forecast'] ?? null,
      modelScale: at['modelScale'] ?? null,
      rows: at['rows'] ?? null,
      columns: at['columns'] ?? null,
      pixelRatio: at['pixelRatio'] ?? null,
      reading: at['reading'] ?? null,
      values: at['values'] ?? null,
      colours: at['colours'] ?? null,
      count: at['count'] ?? null,
      opacity: at['opacity'] ?? null,
    },
    largest: typeof largest === 'number' ? largest : TILE,
  };
}
// Readings, smoothly sampled: radar in red; grids with a separate validity channel in green.
function readings(gl: WebGL2RenderingContext, width: number, height: number, half: Float32Array | null) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  if (half) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, width, height, 0, gl.RG, gl.FLOAT, half);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}
// The map's matrix, which takes its world's pixels, made to take a quad's corners from 0 to 1: a
// quad at `x`, `y` and `width` by `height` across, in Web Mercator (0 to 1 over the world). Worked
// out here in doubles, so that deep in, far from the world's corner, the quad doesn't wobble.
function placed(
  matrix: ArrayLike<number>,
  world: number,
  quad: { x: number; y: number; width: number; height: number },
) {
  const column = (i: number) => Array.from({ length: MAT }, (_, k) => matrix[i * MAT + k] ?? 0),
    [across, down, deep, origin] = [column(0), column(1), column(2), column(MAT - 1)];
  return Float32Array.from([
    ...across.map(value => value * quad.width * world),
    ...down.map(value => value * quad.height * world),
    ...deep,
    ...origin.map((value, k) => value + ((across[k] ?? 0) * quad.x + (down[k] ?? 0) * quad.y) * world),
  ]);
}

// A scale's stops as the shader's values and straight colours (0 to 1); readings past the last
// take its colour.
function scaleOf(stops: readonly Stop[]) {
  const kept = stops.slice(0, STOPS);
  return {
    count: kept.length,
    values: Float32Array.from({ length: STOPS }, (_, i) => kept[Math.min(i, kept.length - 1)]?.value ?? 0),
    colours: Float32Array.from({ length: STOPS * MAT }, (_, i) => {
      const stop = kept[Math.min(Math.floor(i / MAT), kept.length - 1)];
      return stop ? (scaleColour(kept, stop.value)[i % MAT] ?? 0) / BYTE : 0;
    }),
  };
}

export class RainLayer {
  readonly id: string;
  readonly type = 'custom';
  readonly renderingMode = '2d';
  private readonly map: RainMap;
  private readonly load: RadarLoad;
  private gpu: Gpu | null | undefined;
  private scale = scaleOf([]);
  // What it shows: the radar's frames, as tile addresses; or the forecast's, a grid each.
  private radar: string[] = [];
  private grid: readonly ScalarField[] = [];
  private gridTextures: WebGLTexture[] = [];
  private gridDrawn: readonly ScalarField[] = [];
  // Where among the frames it is: between two, by how far from the first.
  private at = 0;
  // Each radar frame's readings in view, by its address; those that went, to let go of.
  private readonly mosaics = new Map<string, Mosaic>();
  private dropped: WebGLTexture[] = [];
  // Tiles come, not yet in a frame's readings; those asked for; those that failed, and when.
  private readonly come = new Map<string, Uint8Array | null>();
  private readonly asked = new Map<string, AbortController>();
  private readonly failed = new Map<string, { at: number; wait: number }>();
  private removed = false;
  // Forecast frames may not fall back to an earlier observation when their tiles are missing.
  private forecastFrom = Infinity;
  // Whether its timeline plays (see AHEAD).
  private playing = false;
  constructor(id: string, map: RainMap, load: RadarLoad) {
    this.id = id;
    this.map = map;
    this.load = load;
    // A context lost and given back is the same context with nothing in it: all of it is made again.
    map.getCanvas().addEventListener('webglcontextrestored', () => {
      this.gpu = undefined;
      this.mosaics.clear();
      this.dropped = [];
      this.gridTextures = [];
      this.gridDrawn = [];
    });
  }
  // Observed and forecast frames by tile address, in `stops`. Empty hides them, keeping tiles
  // for when they return; frames that have gone are let go.
  showRadar(templates: readonly string[], stops: readonly Stop[], forecastFrom = Infinity) {
    this.grid = [];
    this.scale = scaleOf(stops);
    this.radar = [...templates];
    this.forecastFrom = forecastFrom;
    if (templates.length)
      for (const [template, mosaic] of this.mosaics)
        if (!templates.includes(template)) {
          this.dropped.push(mosaic.texture);
          this.mosaics.delete(template);
        }
    this.map.triggerRepaint();
  }
  // The forecast's frames, each a grid of readings on the same points, in `stops`.
  showGrid(fields: readonly ScalarField[], stops: readonly Stop[]) {
    this.showRadar([], stops);
    this.grid = fields;
  }
  // Where among the frames to show: a fractional index, between two blended.
  showAt(at: number) {
    if (at === this.at) return;
    this.at = at;
    this.map.triggerRepaint();
  }
  // Its timeline playing, or held still (see AHEAD).
  play(playing: boolean) {
    if (playing === this.playing) return;
    this.playing = playing;
    this.map.triggerRepaint();
  }
  // Whether every frame has come whole over the view, so that playing them shows each in turn.
  // The forecast's grids are whole as soon as they are shown.
  loaded(): boolean {
    return this.radar.every(template => this.mosaics.get(template)?.held.every(whole) === true);
  }
  readyAt(at: number): boolean {
    if (at <= this.forecastFrom - 1) return true;
    const shown = Math.min(this.radar.length - 1, Math.max(0, at)),
      has = (i: number) => this.mosaics.get(this.radar[i] ?? '')?.held.every(whole) === true;
    return has(Math.floor(shown)) && has(Math.ceil(shown));
  }
  // Coverage follows the two frames actually being blended, including holes in a model grid.
  gaps(): boolean {
    const [from, to, share] = this.pair(this.grid.length, () => true),
      bounds = this.map.getBounds(),
      view = { north: bounds.getNorth(), south: bounds.getSouth(), west: bounds.getWest(), east: bounds.getEast() };
    return fieldGaps(this.grid[from], view) || (share > 0 && fieldGaps(this.grid[to], view));
  }
  onRemove() {
    this.removed = true;
    for (const asked of this.asked.values()) asked.abort();
    this.asked.clear();
  }
  // Before the map is drawn: the textures made ready, for which this may draw into them.
  prerender(gl: WebGL2RenderingContext) {
    if (this.gpu?.gl !== gl) {
      this.gpu = setUp(gl);
      this.mosaics.clear();
      this.gridDrawn = [];
    }
    const { gpu } = this;
    if (!gpu) return;
    for (const texture of this.dropped) gl.deleteTexture(texture);
    this.dropped = [];
    if (this.grid !== this.gridDrawn) this.makeGrid(gpu);
    if (this.radar.length) this.makeRadar(gpu);
  }
  render(gl: WebGL2RenderingContext, input: DrawInput) {
    const { gpu } = this;
    if (gpu?.gl !== gl) return;
    const world = TILE * 2 ** this.map.getZoom();
    if (this.grid.length) {
      const [from, to, share] = this.pair(this.grid.length, () => true),
        field = this.grid[0],
        a = this.gridTextures[from],
        b = this.gridTextures[to];
      if (!field || !a || !b) return;
      const bounds = this.map.getBounds(),
        west = bounds.getWest(),
        east = bounds.getEast(),
        top = mercatorY(bounds.getNorth()),
        bottom = mercatorY(bounds.getSouth());
      this.draw(gpu, input, world, {
        quad: {
          x: (west + HALF_TURN) / FULL_TURN,
          y: top,
          width: (east - west) / FULL_TURN,
          height: bottom - top,
        },
        textures: [a, b],
        share,
        size: [field.cols, field.rows],
        rows: [top, bottom, field.north, field.step],
        columns: [west, east, field.west],
        reading: [1, 0],
        soften: 1,
        forecast: [false, false],
        modelScale: 0,
      });
      return;
    }
    const mosaics = this.radar.map(template => this.mosaics.get(template));
    if (!this.readyAt(this.at)) return;
    const [from, to, share] = this.pair(this.radar.length, i => mosaics[i]?.held.every(whole) === true),
      a = mosaics[from],
      b = mosaics[to];
    if (!a || !b || !a.held.some(held => held !== 'none')) return;
    const across = 2 ** a.z;
    this.draw(gpu, input, world, {
      quad: { x: a.x / across, y: a.y / across, width: a.cols / across, height: a.rows / across },
      textures: [a.texture, b.texture],
      share,
      size: [a.cols * TILE, a.rows * TILE],
      rows: [a.y / across, (a.y + a.rows) / across, 0, 0],
      columns: [0, 0, 0],
      reading: [BYTE, RADAR_NONE],
      soften: Math.min(1, Math.max(0, (this.map.getZoom() - a.z - SOFTEN.from) / SOFTEN.over)),
      forecast: [from >= this.forecastFrom, to >= this.forecastFrom],
      modelScale: (MODEL_SMOOTH_METRES * TILE * across) / EARTH_METRES,
    });
  }
  // The two frames to blend and how far between them: those `at` falls between, where both are
  // whole; else the one of them that is, or else the nearest that is; or else, the first as far
  // as it has come.
  private pair(count: number, whole: (i: number) => boolean): [from: number, to: number, share: number] {
    const at = Math.min(count - 1, Math.max(0, this.at)),
      from = Math.floor(at),
      to = Math.min(count - 1, from + 1);
    if (whole(from) && whole(to)) return [from, to, at - from];
    if (whole(from)) return [from, from, 0];
    if (whole(to)) return [to, to, 0];
    for (let reach = 1; reach < count; reach++)
      for (const i of [from - reach, to + reach]) if (i >= 0 && i < count && whole(i)) return [i, i, 0];
    return [from, from, 0];
  }
  private draw(
    gpu: Gpu,
    input: DrawInput,
    world: number,
    look: {
      quad: { x: number; y: number; width: number; height: number };
      textures: [WebGLTexture, WebGLTexture];
      share: number;
      soften: number;
      forecast: [boolean, boolean];
      modelScale: number;
      size: [number, number];
      rows: [number, number, number, number];
      columns: [number, number, number];
      reading: [number, number];
    },
  ) {
    const { gl, at } = gpu;
    gl.useProgram(gpu.program);
    gl.bindVertexArray(gpu.shapes);
    look.textures.forEach((texture, unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    });
    gl.uniformMatrix4fv(at.matrix, false, placed(input.modelViewProjectionMatrix, world, look.quad));
    gl.uniform1i(at.from, 0);
    gl.uniform1i(at.to, 1);
    gl.uniform1f(at.share, look.share);
    gl.uniform1f(at.soften, look.soften);
    gl.uniform2i(at.forecast, Number(look.forecast[0]), Number(look.forecast[1]));
    gl.uniform1f(at.modelScale, look.modelScale);
    gl.uniform2f(at.size, ...look.size);
    gl.uniform1i(at.grid, this.grid.length ? 1 : 0);
    gl.uniform4f(at.rows, ...look.rows);
    gl.uniform3f(at.columns, ...look.columns);
    const canvas = this.map.getCanvas();
    gl.uniform1f(at.pixelRatio, canvas.width / Math.max(1, canvas.clientWidth));
    gl.uniform2f(at.reading, ...look.reading);
    gl.uniform1fv(at.values, this.scale.values);
    gl.uniform4fv(at.colours, this.scale.colours);
    gl.uniform1i(at.count, Math.max(1, this.scale.count));
    gl.uniform1f(at.opacity, OPACITY);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, CORNERS);
    gl.bindVertexArray(null);
  }
  // The forecast's grids as textures, all of them at once: they are small.
  private makeGrid({ gl }: Gpu) {
    for (const texture of this.gridTextures) gl.deleteTexture(texture);
    this.gridTextures = this.grid.map(field =>
      readings(
        gl,
        field.cols,
        field.rows,
        Float32Array.from({ length: field.values.length * 2 }, (_, i) => {
          const value = field.values[Math.floor(i / 2)] ?? Number.NaN;
          return Number.isFinite(value) ? (i % 2 ? 1 : value) : 0;
        }),
      ),
    );
    this.gridDrawn = this.grid;
  }
  // The tiles a view takes in at the zoom the map's own would be, no deeper than the radar's, and
  // shallower where they wouldn't fit in a texture.
  private range(largest: number): Range | undefined {
    const bounds = this.map.getBounds();
    for (let z = Math.min(DEEPEST, Math.max(0, Math.round(this.map.getZoom()))); z >= 0; z--) {
      const from = tilePoint(bounds.getNorth(), bounds.getWest(), z),
        to = tilePoint(bounds.getSouth(), bounds.getEast(), z),
        x = Math.floor(from.x),
        y = Math.max(0, Math.floor(from.y)),
        cols = Math.floor(to.x) - x + 1,
        rows = Math.min(2 ** z - 1, Math.floor(to.y)) - y + 1;
      if (!(cols > 0 && rows > 0)) return undefined;
      if (cols * TILE <= largest && rows * TILE <= largest) return { z, x, y, cols, rows };
    }
    return undefined;
  }
  // Each frame's readings over the tiles in view: taken over from what it held before, where that
  // reaches (roughly, from another zoom); filled with each tile as it comes; and the tiles still
  // wanted asked for, frame by frame from the one shown and those after it (see AHEAD), nearest
  // the middle first.
  private makeRadar(gpu: Gpu) {
    const range = this.range(gpu.largest);
    if (!range) return;
    for (const template of this.radar) {
      const was = this.mosaics.get(template);
      if (!was || !sameRange(was, range)) this.mosaics.set(template, this.remake(gpu, range, was));
    }
    const { gl } = gpu,
      shown = Math.min(this.radar.length - 1, Math.max(0, Math.floor(this.at))),
      order = Array.from(
        { length: this.playing ? this.radar.length : Math.min(this.radar.length, AHEAD + 1) },
        (_, k) => this.radar[(shown + k) % this.radar.length] ?? '',
      ),
      middle = this.map.getCenter(),
      centre = tilePoint(middle.lat, middle.lng, range.z),
      tiles = Array.from({ length: range.cols * range.rows }, (_, i) => i).sort((i, j) => {
        const off = (k: number) =>
          Math.hypot(
            range.x + (k % range.cols) + 1 / 2 - centre.x,
            range.y + Math.floor(k / range.cols) + 1 / 2 - centre.y,
          );
        return off(i) - off(j);
      });
    // Any frame's tiles that have come go into its readings. One the view has moved off isn't
    // waited for.
    const urlOf = (template: string, i: number) =>
        tileUrl(template, range.z, range.x + (i % range.cols), range.y + Math.floor(i / range.cols)),
      inView = new Set<string>();
    for (const [frame, template] of this.radar.entries()) {
      const mosaic = this.mosaics.get(template);
      if (!mosaic) continue;
      mosaic.held.forEach((held, i) => {
        if (held === 'own') return;
        const url = urlOf(template, i);
        inView.add(url);
        if (!this.come.has(url)) return;
        const readings = this.come.get(url) ?? new Uint8Array(TILE * TILE);
        this.come.delete(url);
        gl.bindTexture(gl.TEXTURE_2D, mosaic.texture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          (i % range.cols) * TILE,
          Math.floor(i / range.cols) * TILE,
          TILE,
          TILE,
          gl.RED,
          gl.UNSIGNED_BYTE,
          readings,
        );
        mosaic.held[i] = 'own';
        mosaic.mipmapped = false;
      });
      // Once per changed forecast mosaic, across tile joins. Repaints and timeline scrubbing
      // reuse these averages; observed radar keeps its existing texture and interpolation.
      if (frame >= this.forecastFrom && !mosaic.mipmapped) {
        gl.bindTexture(gl.TEXTURE_2D, mosaic.texture);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
        mosaic.mipmapped = true;
      }
    }
    for (const [url, asked] of this.asked)
      if (!inView.has(url)) {
        asked.abort();
        this.asked.delete(url);
      }
    for (const url of this.come.keys()) if (!inView.has(url)) this.come.delete(url);
    // Only the frames to come are asked for: frame by frame from the one shown, nearest the middle
    // first.
    let room = ASKED - this.asked.size;
    for (const template of order)
      for (const i of tiles) {
        if (room <= 0) return;
        const url = urlOf(template, i),
          failed = this.failed.get(url);
        if (
          this.mosaics.get(template)?.held[i] === 'own' ||
          this.come.has(url) ||
          this.asked.has(url) ||
          (failed !== undefined && Date.now() - failed.at < failed.wait)
        )
          continue;
        room -= 1;
        void this.ask(url);
      }
  }
  private async ask(url: string) {
    const asked = new AbortController();
    this.asked.set(url, asked);
    try {
      const readings = await this.load(url, asked.signal);
      if (asked.signal.aborted || this.removed) return;
      this.come.set(url, readings);
      this.failed.delete(url);
      this.map.triggerRepaint();
    } catch {
      if (asked.signal.aborted || this.removed) return;
      const wait = failedWait(this.failed.get(url)?.wait);
      this.failed.set(url, { at: Date.now(), wait });
      // Asked for again once its wait is up, even if nothing else draws the map before then.
      setTimeout(() => {
        if (!this.removed) this.map.triggerRepaint();
      }, wait);
    } finally {
      if (this.asked.get(url) === asked) this.asked.delete(url);
    }
  }
  // A frame's readings over a new range of tiles, taken over from those it held where they reach:
  // as they were at the same zoom, and stretched or shrunk from another, rough until the tile's own
  // come.
  private remake(gpu: Gpu, range: Range, was: Mosaic | undefined): Mosaic {
    const { gl } = gpu,
      texture = readings(gl, range.cols * TILE, range.rows * TILE, null),
      held: Held[] = Array.from({ length: range.cols * range.rows }, () => 'none');
    if (was) {
      // Both in the new range's texels.
      const scale = 2 ** (range.z - was.z),
        left = Math.max(0, (was.x * scale - range.x) * TILE),
        top = Math.max(0, (was.y * scale - range.y) * TILE),
        right = Math.min(range.cols, (was.x + was.cols) * scale - range.x) * TILE,
        bottom = Math.min(range.rows, (was.y + was.rows) * scale - range.y) * TILE;
      if (right > left && bottom > top) {
        const back = (value: number, origin: number, from: number) => (value / TILE + origin) / scale - from;
        // A copy is cut to the scissor's box, which the map may have left set.
        gl.disable(gl.SCISSOR_TEST);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, gpu.read);
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, was.texture, 0);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, gpu.write);
        gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.blitFramebuffer(
          Math.round(back(left, range.x, was.x) * TILE),
          Math.round(back(top, range.y, was.y) * TILE),
          Math.round(back(right, range.x, was.x) * TILE),
          Math.round(back(bottom, range.y, was.y) * TILE),
          left,
          top,
          right,
          bottom,
          gl.COLOR_BUFFER_BIT,
          scale === 1 ? gl.NEAREST : gl.LINEAR,
        );
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
        gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
        // A tile is held where all of it came over from tiles that were whole: as they were at the
        // same zoom, rough from another; and in part where some of it came over with anything in it.
        const before = (col: number, row: number): Held =>
          col >= was.x && col < was.x + was.cols && row >= was.y && row < was.y + was.rows
            ? (was.held[(row - was.y) * was.cols + col - was.x] ?? 'none')
            : 'none';
        held.forEach((_, i) => {
          const col = i % range.cols,
            row = Math.floor(i / range.cols);
          if ((col + 1) * TILE <= left || col * TILE >= right || (row + 1) * TILE <= top || row * TILE >= bottom)
            return;
          const x = (range.x + col) / scale,
            y = (range.y + row) / scale,
            reach = Math.max(1, 1 / scale),
            from: Held[] = [];
          for (let j = 0; j < reach; j++)
            for (let k = 0; k < reach; k++) from.push(before(Math.floor(x) + j, Math.floor(y) + k));
          if (from.every(source => source === 'none')) return;
          held[i] = !from.every(whole) ? 'part' : scale === 1 ? (from[0] ?? 'none') : 'rough';
        });
      }
      this.dropped.push(was.texture);
    }
    return { ...range, texture, held, mipmapped: false };
  }
}
