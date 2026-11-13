import { context2d } from '../lib/canvas.ts';

// Rasterize each opacity band's original paths on small, full-resolution tiles.
// Overlapping streaks stay in one stroke, and integer pixel copies join the tiles.
// This bounds the work a canvas backend must finish before the glass samples the sky.
const TILE = 256,
  EDGE = 1,
  SURFACE = TILE + EDGE * 2;

export class RainPath {
  private readonly paths = new Map<number, Path2D>();
  private readonly columns: number;
  private readonly rows: number;
  private readonly pad: number;
  private readonly matrix: DOMMatrix;
  private readonly lineWidth: number;
  constructor(matrix: DOMMatrix, width: number, height: number, lineWidth: number) {
    this.matrix = matrix;
    this.lineWidth = lineWidth;
    this.columns = Math.ceil(width / TILE);
    this.rows = Math.ceil(height / TILE);
    // Include caps and antialiasing under a scaled or skewed transform.
    this.pad =
      lineWidth * Math.max(Math.abs(matrix.a) + Math.abs(matrix.c), Math.abs(matrix.b) + Math.abs(matrix.d)) + EDGE;
  }
  line(ax: number, ay: number, bx: number, by: number): void {
    const m = this.matrix,
      x0 = m.a * ax + m.c * ay + m.e,
      y0 = m.b * ax + m.d * ay + m.f,
      x1 = m.a * bx + m.c * by + m.e,
      y1 = m.b * bx + m.d * by + m.f,
      left = Math.max(0, Math.floor((Math.min(x0, x1) - this.pad) / TILE)),
      top = Math.max(0, Math.floor((Math.min(y0, y1) - this.pad) / TILE)),
      right = Math.min(this.columns - 1, Math.floor((Math.max(x0, x1) + this.pad) / TILE)),
      bottom = Math.min(this.rows - 1, Math.floor((Math.max(y0, y1) + this.pad) / TILE));
    for (let row = top; row <= bottom; row++)
      for (let col = left; col <= right; col++) {
        const key = row * this.columns + col;
        let path = this.paths.get(key);
        if (!path) {
          path = new Path2D();
          this.paths.set(key, path);
        }
        path.moveTo(ax, ay);
        path.lineTo(bx, by);
      }
  }
  stroke(ctx: CanvasRenderingContext2D, image: HTMLCanvasElement): void {
    if (!this.paths.size) return;
    if (image.width !== SURFACE || image.height !== SURFACE) {
      image.width = SURFACE;
      image.height = SURFACE;
    }
    const pen = context2d(image),
      m = this.matrix;
    pen.lineWidth = this.lineWidth;
    pen.lineCap = ctx.lineCap;
    pen.strokeStyle = ctx.strokeStyle;
    pen.globalAlpha = ctx.globalAlpha;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    for (const [key, path] of this.paths) {
      const x = (key % this.columns) * TILE,
        y = Math.floor(key / this.columns) * TILE;
      pen.setTransform(1, 0, 0, 1, 0, 0);
      pen.clearRect(0, 0, SURFACE, SURFACE);
      pen.setTransform(m.a, m.b, m.c, m.d, m.e - x + EDGE, m.f - y + EDGE);
      pen.stroke(path);
      ctx.drawImage(image, EDGE, EDGE, TILE, TILE, x, y, TILE, TILE);
    }
    ctx.restore();
  }
}
