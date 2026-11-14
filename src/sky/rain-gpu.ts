import { context2d } from '../lib/canvas.ts';
import { linkedProgram } from '../lib/webgl.ts';

// Rain and the completed sky stay in the glass renderer's context. The 2D sky
// contributes layers between the two rain fields; the glass reads the resulting
// texture directly, without exporting the completed rain back into WebGL.
const VERTEX = `
attribute vec2 a;
attribute vec4 placement;
attribute vec4 shape;
uniform vec2 view;
uniform bool near;
varying vec2 at;
varying vec4 form;
varying float footprint;
void main() {
  float pad = near ? 0. : 1.;
  vec2 local = a * vec2(shape.y * .5 + (shape.w > .5 && !near ? shape.x : 0.) + pad, shape.x + pad);
  vec2 px = placement.xy + placement.zw * local.x + vec2(-placement.w, placement.z) * local.y;
  at = near ? (a.yx + 1.) * .5 : local;
  form = shape;
  footprint = abs(placement.z) + abs(placement.w);
  gl_Position = vec4(px.x / view.x * 2. - 1., 1. - px.y / view.y * 2., 0., 1.);
}`;
const RAIN = `
precision highp float;
varying vec2 at;
varying vec4 form;
varying float footprint;
uniform sampler2D image;
uniform bool near;
uniform float columns;
uniform vec3 tint;
float coverage(float x, float halfSize) {
  float pixel = max(footprint, .001);
  return clamp((halfSize - x) / pixel + .5, 0., 1.) - clamp((-halfSize - x) / pixel + .5, 0., 1.);
}
void main() {
  float alpha;
  if (near) {
    gl_FragColor = texture2D(image, vec2((at.x + form.w) / columns, at.y)) * form.z;
    return;
  } else {
    vec2 d = abs(at) - vec2(form.y * .5, form.x);
    float distance = form.w > .5
      ? length(vec2(max(abs(at.x) - form.y * .5, 0.), at.y)) - form.x
      : length(max(d, 0.)) + min(max(d.x, d.y), 0.);
    alpha = form.w > .5 && abs(at.x) > form.y * .5
      ? clamp(.5 - distance / footprint, 0., 1.)
      : coverage(at.y, form.x) * (form.w > .5 ? 1. : coverage(at.x, form.y * .5));
  }
  gl_FragColor = vec4(tint * alpha, alpha);
}`;
const QUAD = `
attribute vec2 a;
varying vec2 at;
void main() { at = (a + 1.) * .5; gl_Position = vec4(a, 0., 1.); }
`;
const COPY = `
precision highp float;
uniform sampler2D image;
uniform float opacity;
uniform vec2 region;
varying vec2 at;
void main() { gl_FragColor = texture2D(image, at * region) * opacity; }
`;
// A far streak, tail to head, in pieces of one width and opacity each, so a layer's far drops
// batch by piece and opacity band: where the piece starts and ends along the streak, its share
// of the streak's opacity and of its width. The light rises evenly over the first 60% and holds
// to the head; the streak is 60% of its width until then, and widens to the head.
export const FAR_PIECES = [
  [0, 0.15, 0.125, 0.6],
  [0.15, 0.3, 0.375, 0.6],
  [0.3, 0.45, 0.625, 0.6],
  [0.45, 0.6, 0.875, 0.6],
  [0.6, 0.8, 1, 0.71],
  [0.8, 0.95, 1, 0.91],
] as const;
export const FAR_BANDS = 4;
const FLOATS = 8,
  INITIAL_QUADS = 256,
  SOFT = 6,
  BANDS = FAR_BANDS * FAR_PIECES.length,
  SHAPE_OFFSET = 4;

// Both programs read the quad's corner, then each streak's placement and shape, at these locations.
const ATTRIBUTES = ['a', 'placement', 'shape'] as const;

export class RainBatch {
  data = new Float32Array(INITIAL_QUADS * FLOATS);
  used = 0;
  opacity = 1;
  tint: readonly [number, number, number] = [1, 1, 1];
  quad(
    x: number,
    y: number,
    dx: number,
    dy: number,
    length: number,
    width: number,
    alpha: number,
    // Far lines pass their rounded-cap flag; near sprites pass their atlas column.
    capOrCell: boolean | number,
  ): void {
    const needed = this.used + FLOATS;
    if (needed > this.data.length) {
      const data = new Float32Array(this.data.length * 2);
      data.set(this.data);
      this.data = data;
    }
    this.data[this.used++] = x;
    this.data[this.used++] = y;
    this.data[this.used++] = dx;
    this.data[this.used++] = dy;
    this.data[this.used++] = width;
    this.data[this.used++] = length;
    this.data[this.used++] = alpha;
    this.data[this.used++] = Number(capOrCell);
  }
}

interface Surface {
  texture: WebGLTexture;
  frame: WebGLFramebuffer;
  width: number;
  height: number;
}

export class RainGPU {
  readonly gl: WebGLRenderingContext;
  readonly limit: number;
  private readonly maximum: number;
  private readonly instanced: ANGLE_instanced_arrays;
  private readonly rain: WebGLProgram;
  private readonly copy: WebGLProgram;
  private readonly rainUniforms: Record<'view' | 'near' | 'image' | 'columns' | 'tint', WebGLUniformLocation | null>;
  private readonly copyUniforms: Record<'image' | 'opacity' | 'region', WebGLUniformLocation | null>;
  private readonly quad: WebGLBuffer | null;
  private readonly vertices: WebGLBuffer | null;
  private mask: Surface | undefined;
  private readonly sprites = new Map<HTMLCanvasElement, WebGLTexture>();
  readonly batches = Array.from({ length: BANDS }, () => new RainBatch());
  constructor(gl: WebGLRenderingContext, maximum: number, instanced: ANGLE_instanced_arrays) {
    this.gl = gl;
    this.maximum = maximum;
    this.instanced = instanced;
    this.rain = linkedProgram(gl, 'rain', VERTEX, RAIN, ATTRIBUTES);
    this.copy = linkedProgram(gl, 'rain copy', QUAD, COPY, ATTRIBUTES);
    const limit: unknown = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.limit = typeof limit === 'number' ? limit : 0;
    this.rainUniforms = {
      view: gl.getUniformLocation(this.rain, 'view'),
      near: gl.getUniformLocation(this.rain, 'near'),
      image: gl.getUniformLocation(this.rain, 'image'),
      tint: gl.getUniformLocation(this.rain, 'tint'),
      columns: gl.getUniformLocation(this.rain, 'columns'),
    };
    this.copyUniforms = {
      image: gl.getUniformLocation(this.copy, 'image'),
      opacity: gl.getUniformLocation(this.copy, 'opacity'),
      region: gl.getUniformLocation(this.copy, 'region'),
    };
    this.quad = gl.createBuffer();
    this.vertices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  }
  surface(width: number, height: number): Surface {
    const gl = this.gl,
      texture = gl.createTexture(),
      frame = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(frame);
      throw new Error('The rain surface is incomplete.');
    }
    return { texture, frame, width, height };
  }
  dispose(surface: Surface): void {
    this.gl.deleteTexture(surface.texture);
    this.gl.deleteFramebuffer(surface.frame);
  }
  release(): void {
    if (this.mask) this.dispose(this.mask);
    this.mask = undefined;
    for (const texture of this.sprites.values()) this.gl.deleteTexture(texture);
    this.sprites.clear();
  }
  prepare(width: number, height: number): void {
    if (!this.mask || this.mask.width < width || this.mask.height < height) {
      const next = this.surface(Math.max(this.mask?.width ?? 0, width), Math.max(this.mask?.height ?? 0, height));
      if (this.mask) this.dispose(this.mask);
      this.mask = next;
    }
  }
  target(surface: Surface | null, width = surface?.width ?? 0, height = surface?.height ?? 0): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, surface?.frame ?? null);
    gl.viewport(0, 0, width, height);
  }
  clear(): void {
    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }
  image(
    texture: WebGLTexture,
    opacity = 1,
    blend: 'source-over' | 'lighter' | 'screen' | 'copy' = 'source-over',
    width = 1,
    height = 1,
  ): void {
    const gl = this.gl;
    gl.useProgram(this.copy);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.disableVertexAttribArray(1);
    gl.disableVertexAttribArray(2);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.copyUniforms.image, 0);
    gl.uniform1f(this.copyUniforms.opacity, opacity);
    gl.uniform2f(this.copyUniforms.region, width, height);
    if (blend !== 'copy') gl.enable(gl.BLEND);
    else gl.disable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(
      gl.ONE,
      blend === 'lighter' ? gl.ONE : blend === 'screen' ? gl.ONE_MINUS_SRC_COLOR : gl.ONE_MINUS_SRC_ALPHA,
    );
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, SHAPE_OFFSET);
  }
  upload(texture: WebGLTexture, canvas: HTMLCanvasElement): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  }
  draw(surface: Surface, sprite: HTMLCanvasElement | null, columns = 1): void {
    const gl = this.gl;
    this.prepare(surface.width, surface.height);
    let texture = sprite ? this.sprites.get(sprite) : undefined;
    if (sprite && !texture) {
      // Four cards can keep GPU skies at once. Reuse each card's strip across frames.
      if (this.sprites.size >= 4) {
        const oldest = this.sprites.entries().next().value;
        if (oldest) {
          gl.deleteTexture(oldest[1]);
          this.sprites.delete(oldest[0]);
        }
      }
      const strip = this.surface(1, 1);
      texture = strip.texture;
      gl.deleteFramebuffer(strip.frame);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sprite);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      this.sprites.set(sprite, texture);
    }
    for (const batch of this.batches) {
      if (!batch.used) continue;
      const target = sprite ? surface : this.mask;
      if (!target) continue;
      this.target(target, surface.width, surface.height);
      if (!sprite) this.clear();
      gl.useProgram(this.rain);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertices);
      gl.bufferData(gl.ARRAY_BUFFER, batch.data.subarray(0, batch.used), gl.STREAM_DRAW);
      for (const [index, offset] of [
        [1, 0],
        [2, SHAPE_OFFSET],
      ] as const) {
        this.instanced.vertexAttribDivisorANGLE(index, 1);
        gl.enableVertexAttribArray(index);
        gl.vertexAttribPointer(
          index,
          SHAPE_OFFSET,
          gl.FLOAT,
          false,
          FLOATS * Float32Array.BYTES_PER_ELEMENT,
          offset * Float32Array.BYTES_PER_ELEMENT,
        );
      }
      gl.uniform2f(this.rainUniforms.view, surface.width, surface.height);
      gl.uniform1i(this.rainUniforms.near, sprite ? 1 : 0);
      gl.uniform1f(this.rainUniforms.columns, columns);
      gl.activeTexture(gl.TEXTURE0);
      // Even the line shader needs a complete sampler on WebGL 1.
      gl.bindTexture(gl.TEXTURE_2D, texture ?? surface.texture);
      gl.uniform1i(this.rainUniforms.image, 0);
      gl.uniform3f(this.rainUniforms.tint, ...batch.tint);
      gl.enable(gl.BLEND);
      gl.blendEquation(sprite ? gl.FUNC_ADD : this.maximum);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.instanced.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, SHAPE_OFFSET, batch.used / FLOATS);
      this.instanced.vertexAttribDivisorANGLE(1, 0);
      this.instanced.vertexAttribDivisorANGLE(2, 0);
      if (!sprite) {
        this.target(surface);
        this.image(
          target.texture,
          batch.opacity,
          'source-over',
          surface.width / target.width,
          surface.height / target.height,
        );
      }
    }
    gl.disableVertexAttribArray(1);
    gl.disableVertexAttribArray(2);
    gl.blendEquation(gl.FUNC_ADD);
    gl.disable(gl.BLEND);
  }
}

export class RainSky {
  readonly gpu: RainGPU;
  readonly scale: number;
  readonly background: HTMLCanvasElement;
  readonly backgroundScale: number;
  readonly color: Surface;
  readonly soft: Surface;
  private readonly staging: Surface;
  constructor(gpu: RainGPU, width: number, height: number, scale: number) {
    this.gpu = gpu;
    this.scale = scale;
    // Cloud decks are already rendered at CSS-pixel resolution. Keep their
    // staging surface at that density; rain and the completed sky stay sharp.
    // This canvas never receives the GPU output that the glass will sample.
    this.backgroundScale = Math.min(1, scale);
    this.background = document.createElement('canvas');
    this.background.width = Math.round((width / scale) * this.backgroundScale);
    this.background.height = Math.round((height / scale) * this.backgroundScale);
    const created: Surface[] = [];
    const allocate = (w: number, h: number) => {
      const surface = gpu.surface(w, h);
      created.push(surface);
      return surface;
    };
    try {
      this.color = allocate(width, height);
      this.staging = allocate(this.background.width, this.background.height);
      this.soft = allocate(
        Math.max(1, Math.round(width / scale / SOFT)),
        Math.max(1, Math.round(height / scale / SOFT)),
      );
    } catch (error) {
      for (const surface of created) gpu.dispose(surface);
      throw error;
    }
  }
  release(): void {
    for (const surface of [this.color, this.soft, this.staging]) this.gpu.dispose(surface);
    this.background.width = this.background.height = 0;
  }
  begin(): void {
    this.gpu.target(this.color);
    this.gpu.clear();
  }
  layer(ctx: CanvasRenderingContext2D, blend: 'source-over' | 'lighter' | 'screen' = 'source-over'): void {
    this.gpu.upload(this.staging.texture, ctx.canvas);
    this.gpu.target(this.color);
    this.gpu.image(this.staging.texture, 1, blend);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
    for (const batch of this.gpu.batches) batch.used = 0;
  }
  finish(canvas: HTMLCanvasElement, background = canvas): void {
    const { gpu, color } = this,
      gl = gpu.gl;
    this.layer(context2d(background));
    gpu.target(this.soft);
    gpu.image(color.texture, 1, 'copy');
    if (gl.canvas.width < color.width) gl.canvas.width = color.width;
    if (gl.canvas.height < color.height) gl.canvas.height = color.height;
    gpu.target(null, color.width, color.height);
    gpu.clear();
    gpu.image(color.texture, 1, 'copy');
    const ctx = context2d(canvas);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(
      gl.canvas,
      0,
      gl.canvas.height - color.height,
      color.width,
      color.height,
      0,
      0,
      color.width,
      color.height,
    );
    ctx.restore();
  }
}
