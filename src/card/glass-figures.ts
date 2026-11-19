import { linkedProgram } from '../lib/webgl.ts';
import { context2d } from '../lib/canvas.ts';
import type { GlassStrength } from './config.ts';

// The home view's temperature as glass in the shape of its figures: the sky behind each figure is
// bent by a bevelled height field built from the figure itself, lifted toward white, and lit along
// its rim. It is drawn over the words it stands for, which stay in the page for whoever can't see
// it, and which show as they are wherever WebGL isn't to be had.
const VERTEX = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_position.x * 0.5 + 0.5, 0.5 - a_position.y * 0.5);
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;
const FRAGMENT = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_background;
uniform sampler2D u_shape;
uniform vec2 u_texel;
uniform vec2 u_origin;
uniform vec2 u_size;
uniform vec2 u_backgroundSize;
uniform float u_bevel;
uniform float u_span;
uniform float u_refraction;
uniform float u_lift;
uniform float u_rim;

vec3 backdrop(vec2 px) {
  return texture2D(u_background, clamp((u_origin + px) / u_backgroundSize, 0.0, 1.0)).rgb;
}

float tall(vec2 texels) {
  return texture2D(u_shape, v_uv + texels * u_texel).g;
}
// The rise of the height per texel, across span texels either way.
vec2 rise(float span) {
  return vec2(tall(vec2(span, 0.0)) - tall(vec2(-span, 0.0)), tall(vec2(0.0, span)) - tall(vec2(0.0, -span))) / span;
}

void main() {
  vec4 shape = texture2D(u_shape, v_uv);
  float mask = shape.r;
  if (mask < 0.004) { gl_FragColor = vec4(0.0); return; }
  // The green channel is the figure blurred by the bevel's width: half at the rim, 1 deep inside.
  // It holds 256 levels, and a slope taken between neighbouring texels shows each step of them as
  // a crease: it is taken across a span of texels, at two widths, and the height from five taps.
  float height = (shape.g * 2.0 + tall(vec2(u_span, 0.0)) + tall(vec2(-u_span, 0.0)) + tall(vec2(0.0, u_span)) + tall(vec2(0.0, -u_span))) / 6.0;
  vec2 slope = (rise(u_span) + rise(u_span * 2.0)) * 0.5 * u_bevel * 0.5;
  // Rounded like a drop, not cut like a bevel: steep at the rim and level across the middle.
  float inward = 1.0 - clamp(height * 2.0 - 1.0, 0.0, 1.0);
  slope *= mix(1.0, clamp(inward / sqrt(max(1.0 - inward * inward, 0.03)), 0.0, 2.4), 0.6);
  float edge = clamp(length(slope), 0.0, 1.0);
  vec2 px = v_uv * u_size;
  // Thick glass bends the sky toward the rim, red and blue each a little differently.
  vec2 bend = slope * u_refraction * (1.0 - height * 0.6);
  vec3 color = vec3(backdrop(px - bend * 1.06).r, backdrop(px - bend).g, backdrop(px - bend * 0.94).b);
  // A clear body that still reads from across a room: fuller in colour, then lifted toward white.
  float grey = dot(color, vec3(0.299, 0.587, 0.114));
  color = mix(vec3(grey), color, 1.25);
  color = mix(color, vec3(1.0), u_lift + 0.04 * height);
  // A bright rim from a light at the upper left, and a softer one opposite it.
  vec2 light = normalize(vec2(-0.6, -0.8));
  float facing = dot(normalize(slope + 1e-5), light);
  color += vec3(1.0) * u_rim * pow(edge, 1.6) * (0.5 * max(facing, 0.0) + 0.18 * max(-facing, 0.0));
  gl_FragColor = vec4(clamp(color, 0.0, 1.0) * mask, mask);
}`;
// The canvas reaches a bevel and a half past the figures, and the height field is the figures
// blurred by .55 of the bevel. Past two device pixels to one there is nothing more to see.
// The slope is taken across `span` of the bevel, and never less than `least` texels.
const GLASS = { pad: 1.5, blur: 0.55, sharpest: 2, span: 0.22, least: 1.5 } as const;
// What the strength set changes: the bevel as a share of the figures' size, how many bevels the sky
// bends by, how bright the rim is lit, and how far the body is lifted toward white. The lift is
// what reads from across a room, over a dark sky most of all; clear glass gives nearly all of it
// up, and is read by its deeper bend and brighter rim alone.
const STRENGTHS: Readonly<Record<GlassStrength, { bevel: number; refraction: number; rim: number; lift: number }>> = {
  subtle: { bevel: 0.04, refraction: 1, rim: 0.65, lift: 0.24 },
  standard: { bevel: 0.06, refraction: 1.6, rim: 1, lift: 0.2 },
  strong: { bevel: 0.085, refraction: 2.4, rim: 1.4, lift: 0.2 },
  clear: { bevel: 0.085, refraction: 3, rim: 1.7, lift: 0.03 },
};
const CORNERS = 4,
  RGBA = 4,
  GREEN = 1,
  ALPHA = 3,
  OPAQUE = 255;
const UNIFORMS = [
  'u_background',
  'u_shape',
  'u_texel',
  'u_origin',
  'u_size',
  'u_backgroundSize',
  'u_bevel',
  'u_span',
  'u_refraction',
  'u_lift',
  'u_rim',
] as const;

export class GlassFigures {
  private readonly gl: WebGLRenderingContext;
  private readonly at: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private readonly background: WebGLTexture;
  private readonly figures: WebGLTexture;
  private readonly mask = document.createElement('canvas');
  private readonly soft = document.createElement('canvas');
  private key = '';
  private size: { width: number; height: number; bevel: number } | undefined;
  // The context has gone, and the figures with it.
  lost = false;
  private readonly canvas: HTMLCanvasElement;
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) throw new Error('WebGL is unavailable.');
    this.gl = gl;
    const program = linkedProgram(gl, 'glass figures', VERTEX, FRAGMENT, ['a_position']);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.at = {
      u_background: gl.getUniformLocation(program, 'u_background'),
      u_shape: gl.getUniformLocation(program, 'u_shape'),
      u_texel: gl.getUniformLocation(program, 'u_texel'),
      u_origin: gl.getUniformLocation(program, 'u_origin'),
      u_size: gl.getUniformLocation(program, 'u_size'),
      u_backgroundSize: gl.getUniformLocation(program, 'u_backgroundSize'),
      u_bevel: gl.getUniformLocation(program, 'u_bevel'),
      u_span: gl.getUniformLocation(program, 'u_span'),
      u_refraction: gl.getUniformLocation(program, 'u_refraction'),
      u_lift: gl.getUniformLocation(program, 'u_lift'),
      u_rim: gl.getUniformLocation(program, 'u_rim'),
    };
    this.background = this.texture();
    this.figures = this.texture();
    gl.uniform1i(this.at.u_background, 0);
    gl.uniform1i(this.at.u_shape, 1);
    canvas.addEventListener('webglcontextlost', () => {
      this.lost = true;
    });
  }
  private texture(): WebGLTexture {
    const { gl } = this,
      texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    for (const key of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, key, gl.CLAMP_TO_EDGE);
    for (const key of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, key, gl.LINEAR);
    return texture;
  }
  // Shapes the glass to the words `figures` shows, laid over them in the box that holds them both.
  // Costly, so only when the words, their type, their place or the strength change, which it says.
  shape(figures: HTMLElement, strength: GlassStrength, fontsLoaded: boolean) {
    const text = figures.textContent,
      style = getComputedStyle(figures),
      font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
      type = parseFloat(style.fontSize),
      dpr = Math.min(window.devicePixelRatio || 1, GLASS.sharpest),
      key = JSON.stringify([
        text,
        font,
        style.letterSpacing,
        figures.offsetLeft,
        figures.offsetTop,
        figures.offsetWidth,
        figures.offsetHeight,
        dpr,
        strength,
      ]);
    if ((!fontsLoaded && key === this.key) || !type || !figures.offsetWidth) return false;
    this.key = key;
    const { gl, canvas, mask, soft } = this,
      cut = STRENGTHS[strength],
      bevel = type * cut.bevel,
      pad = bevel * GLASS.pad,
      width = figures.offsetWidth + pad * 2,
      height = figures.offsetHeight + pad * 2,
      w = Math.max(1, Math.round(width * dpr)),
      h = Math.max(1, Math.round(height * dpr));
    canvas.style.left = `${figures.offsetLeft - pad}px`;
    canvas.style.top = `${figures.offsetTop - pad}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    for (const target of [canvas, mask, soft]) {
      target.width = w;
      target.height = h;
    }
    // The figures stand on the line the page sets them on: the middle of their box, by the font's
    // own rise and fall.
    const draw = (context: CanvasRenderingContext2D) => {
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.font = font;
      context.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
      context.textBaseline = 'alphabetic';
      const { fontBoundingBoxAscent: rise, fontBoundingBoxDescent: fall } = context.measureText(text);
      context.fillText(text, pad, pad + (figures.offsetHeight + rise - fall) / 2);
      context.setTransform(1, 0, 0, 1, 0, 0);
    };
    // Red: the crisp figures. Green: the same blurred, a cheap height field for the bevel.
    const blurred = context2d(soft, { willReadFrequently: true });
    blurred.clearRect(0, 0, w, h);
    blurred.filter = `blur(${bevel * GLASS.blur * dpr}px)`;
    blurred.fillStyle = '#fff';
    draw(blurred);
    const crisp = context2d(mask, { willReadFrequently: true });
    crisp.fillStyle = '#000';
    crisp.fillRect(0, 0, w, h);
    crisp.globalCompositeOperation = 'lighter';
    crisp.fillStyle = '#f00';
    draw(crisp);
    crisp.globalCompositeOperation = 'source-over';
    const shape = crisp.getImageData(0, 0, w, h),
      heights = blurred.getImageData(0, 0, w, h);
    for (let index = 0; index < shape.data.length; index += RGBA) {
      shape.data[index + GREEN] = heights.data[index + ALPHA] ?? 0;
      shape.data[index + ALPHA] = OPAQUE;
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.figures);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, shape);
    gl.uniform2f(this.at.u_texel, 1 / w, 1 / h);
    gl.uniform2f(this.at.u_size, width, height);
    gl.uniform1f(this.at.u_bevel, bevel * dpr);
    gl.uniform1f(this.at.u_span, Math.max(GLASS.least, bevel * dpr * GLASS.span));
    gl.uniform1f(this.at.u_refraction, bevel * cut.refraction);
    gl.uniform1f(this.at.u_rim, cut.rim);
    gl.uniform1f(this.at.u_lift, cut.lift);
    gl.viewport(0, 0, w, h);
    this.size = { width, height, bevel };
    return true;
  }
  // Bends the sky as it is now, which is cheap enough for every frame of it.
  paint(sky: HTMLCanvasElement) {
    const { gl, canvas, size } = this;
    if (!size || this.lost || !sky.width || !sky.height) return;
    const own = canvas.getBoundingClientRect(),
      behind = sky.getBoundingClientRect();
    if (!behind.width || !own.width) return;
    // The page may be scaled: both boxes are, alike, so what one is of the other isn't.
    const scale = size.width / own.width;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.background);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sky);
    gl.uniform2f(this.at.u_origin, (own.left - behind.left) * scale, (own.top - behind.top) * scale);
    gl.uniform2f(this.at.u_backgroundSize, behind.width * scale, behind.height * scale);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, CORNERS);
  }
}
