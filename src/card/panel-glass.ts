// What lies on the glass panels over the sky: rain beading on them, frost in freezing weather,
// and falling snow settled along their tops.
import { CHANNEL_MAX, context2d, rgb } from '../lib/canvas.ts';
import { SECOND } from '../lib/time.ts';
import {
  dropletTier,
  frostEffect,
  paintDroplets,
  paintFrost,
  paintSettledSnow,
  SNOW_SETTLE,
  type Panel,
} from '../sky/droplets.ts';
import { sharedGlass, type GlassRain } from '../sky/glass-gl.ts';
import { localHour } from '../weather/forecast-items.ts';
import { loadEffectArt } from '../sky/effect-art.ts';
import type { Parts, Geometry } from './parts.ts';
import type { CardConfig } from './config.ts';
import type { WeatherScene } from '../sky/scene.ts';

// The glass panels over the sky.
export const GLASS = '.forecast,.daily,.tile,.alert:not([hidden]),.next-hour:not([hidden])';
// The glass's tone: the sky's middle colour, lifted 15%.
const GLASS_LIFT = 1.15;

// A glass panel's own canvas for the rain on it: just over its glass, under its content.
function panelDrops(panel: HTMLElement): HTMLCanvasElement {
  const found = panel.querySelector(':scope > canvas.drops');
  if (found instanceof HTMLCanvasElement) return found;
  const canvas = document.createElement('canvas');
  canvas.className = 'drops';
  canvas.setAttribute('aria-hidden', 'true');
  const glass = panel.querySelector(':scope > .glass');
  if (glass) glass.after(canvas);
  else panel.prepend(canvas);
  return canvas;
}
const size = (canvas: HTMLCanvasElement, width: number, height: number) => {
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
};
// A canvas's pen for the page's own pixels, the card's whole size wiped clear.
function cleared(canvas: HTMLCanvasElement, dpr: number, { width, height }: { width: number; height: number }) {
  const ctx = context2d(canvas);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}
// The size to draw at: the card's own, and in the canvases' pixels.
interface Sizes {
  dpr: number;
  width: number;
  height: number;
  root: { width: number; height: number };
}

// What the glass reads from the card.
interface GlassHost extends Pick<HTMLElement, 'getBoundingClientRect'> {
  readonly root: ShadowRoot;
  readonly parts: Parts;
  readonly config: CardConfig | undefined;
  readonly scene: WeatherScene;
  readonly timeZone: string | undefined;
  readonly zoom: number;
  geometry(): Geometry;
}
export class PanelGlass {
  private frostRequested = false;
  private renderer: GlassRain | undefined;
  readonly card: GlassHost;
  // Rain on the glass is drawn once for the whole card here, then each panel takes its part
  // into its own canvas, between its glass and its content (see paint).
  drops: HTMLCanvasElement | undefined;
  frostKey: string | undefined;
  constructor(card: GlassHost) {
    this.card = card;
  }
  // A released surface needs a fresh sky when the card comes back into view.
  get hasRain(): boolean {
    return this.renderer !== undefined && dropletTier(this.card.scene.preset?.effectKind ?? '') > 0;
  }
  // Takes the rain off the panels' glass (see paint).
  clearDrops() {
    this.release();
    if (!this.drops) return;
    for (const canvas of this.card.root.querySelectorAll('canvas.drops')) canvas.remove();
    this.drops = undefined;
  }
  release() {
    this.renderer?.release(this.card.parts.sky);
    this.renderer = undefined;
  }
  // Rain beading on the glass panels.
  paint(phase: number) {
    const { card } = this,
      config = card.config;
    if (!config) return;
    // Frost in freezing weather, rain beads otherwise.
    const kind = card.scene.preset?.effectKind,
      scene = config.weather_scene,
      rain = card.parts.droplets,
      flat = card.parts.frost;
    const hour = localHour(Date.now(), card.timeZone);
    const frost = scene && frostEffect(kind, card.scene.preset?.temperature, hour),
      // Low power gives up the drops running down the glass, the costliest thing the panels draw.
      tier = scene && !frost && !config.low_power ? dropletTier(kind ?? '') : 0;
    const glass = tier ? sharedGlass() : null;
    if (!glass) this.clearDrops();
    if (!frost) {
      this.frostKey = '';
      if (flat.width && !(tier && !glass)) size(flat, 0, 0);
    }
    // Falling snow settles on the panels' top edges, in front of the glass, eased in and
    // out with the snowfall itself.
    const settleLook = scene && !tier && kind ? SNOW_SETTLE[kind] : undefined,
      fullSnow = card.scene.preset?.snow ?? 0,
      settle = settleLook && fullSnow ? Math.min(1, (card.scene.live?.snow ?? 0) / fullSnow) : 0;
    if (!tier && !settle && rain.width) size(rain, 0, 0);
    if (!tier && !frost && !settle) return;
    const { root, glass: panels, panes } = card.geometry(),
      dpr = Math.min(window.devicePixelRatio || 1, 2) * card.zoom,
      sizes = { dpr, root, width: Math.round(root.width * dpr), height: Math.round(root.height * dpr) };
    if (settle) {
      size(rain, sizes.width, sizes.height);
      const ctx = cleared(rain, dpr, root);
      if (settleLook) paintSettledSnow(ctx, panels, settleLook, settle, phase || 0, root.width);
    }
    if (!tier && !frost) return;
    if (frost) this.drawFrost(panels, sizes);
    // The droplets run as a shader; without WebGL, the canvas beads stand in. They are part
    // of each panel's glass, so its content stays in front of them.
    else if (glass) {
      if (!settle && rain.width) size(rain, 0, 0);
      this.drawDrops(glass, panes, tier, phase, sizes);
    } else {
      size(flat, sizes.width, sizes.height);
      const sky = card.parts.sky;
      paintDroplets(
        cleared(flat, dpr, root),
        panels,
        tier,
        phase || 0,
        config.glass_refraction ? sky : null,
        sky.width / (sky.clientWidth || 1),
      );
    }
  }
  // Frost holds still, so it is drawn again only when the panels move.
  drawFrost(panels: Panel[], { dpr, width, height, root }: Sizes) {
    if (!this.frostRequested) {
      this.frostRequested = true;
      void loadEffectArt('frost')?.then(loaded => {
        if (loaded && this.card.root.host.isConnected) {
          this.frostKey = '';
          this.paint(0);
        }
      });
    }
    const flat = this.card.parts.frost;
    size(flat, width, height);
    const key = JSON.stringify([panels, width, height]);
    if (this.frostKey === key) return;
    this.frostKey = key;
    paintFrost(cleared(flat, dpr, root), panels);
  }
  drawDrops(
    glass: NonNullable<ReturnType<typeof sharedGlass>>,
    panels: Geometry['panes'],
    tier: number,
    phase: number,
    { dpr, width, height, root }: Sizes,
  ) {
    const { card } = this;
    this.drops ??= document.createElement('canvas');
    const { drops } = this;
    const middle = card.scene.preset?.sky[1] ?? '#000000',
      tone = rgb(middle).map(channel => (channel / CHANNEL_MAX) * GLASS_LIFT);
    // While the rain runs, only the panels on screen get it: the next frame catches any that
    // scroll in. A still frame may be the last for a while, so it reaches them all.
    let shown = panels;
    if (phase) {
      const frame = card.getBoundingClientRect(),
        origin = card.parts.sceneRoot.getBoundingClientRect().top,
        top = (Math.max(0, frame.top) - origin) / card.zoom,
        bottom = (Math.min(window.innerHeight, frame.bottom) - origin) / card.zoom;
      shown = panels.filter(({ rect }) => rect.y + rect.height > top && rect.y < bottom);
    }
    if (!shown.length) {
      this.release();
      return;
    }
    // Only the panels need a rain surface. A tall phone card otherwise shades and
    // copies thousands of empty rows below the visible panels on every frame.
    // Whole panels are retained, including their offscreen parts, so scrolling
    // never reveals a partly cleared pane. Align the crop to device pixels.
    const x = Math.max(0, Math.floor(Math.min(...shown.map(({ rect }) => rect.x * dpr)))),
      y = Math.max(0, Math.floor(Math.min(...shown.map(({ rect }) => rect.y * dpr)))),
      right = Math.min(width, Math.ceil(Math.max(...shown.map(({ rect }) => (rect.x + rect.width) * dpr)))),
      bottomEdge = Math.min(height, Math.ceil(Math.max(...shown.map(({ rect }) => (rect.y + rect.height) * dpr))));
    if (right <= x || bottomEdge <= y) {
      this.release();
      return;
    }
    size(drops, right - x, bottomEdge - y);
    if (this.renderer !== glass) this.release();
    this.renderer = glass;
    glass.draw(
      shown.map(({ rect }) => rect),
      tier,
      (phase || 0) / SECOND,
      card.parts.sky,
      { width: root.width, height: root.height },
      dpr,
      tone,
      drops,
      { x, y },
      card.config?.glass_refraction,
    );
    for (const { panel, rect } of shown) {
      const canvas = panelDrops(panel),
        w = Math.max(1, Math.round(rect.width * dpr)),
        h = Math.max(1, Math.round(rect.height * dpr));
      size(canvas, w, h);
      const ctx = context2d(canvas);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(drops, rect.x * dpr - x, rect.y * dpr - y, rect.width * dpr, rect.height * dpr, 0, 0, w, h);
    }
  }
}
