import { MINUTE, SECOND } from '../lib/time.ts';
import { say } from '../weather/words.ts';
import type { RadarFrame } from './sources.ts';

// The small map's radar plays by itself: from the radar now through the next hour's forecast where
// one covers the place, or else through the radar's last hours up to now. Each picture is painted
// once; changing frames only crossfades their canvases (see the styles), a frame a second, so the
// rain glides rather than jumps, and the frame now stays twice as long, where the loop begins.
const FRAME_TIME = SECOND,
  NOW_HOLD = 2;
// How far from now each frame is, to five minutes, in the corner of the map.
const LABEL_STEP = 5 * MINUTE;
export function radarWhen(time: number, now: number, isNow: boolean): string {
  const minutes = Math.round(Math.abs(time - now) / LABEL_STEP) * (LABEL_STEP / MINUTE);
  if (isNow || minutes === 0) return say('Now');
  return time > now ? say('In {minutes} minutes', { minutes }) : say('{minutes} minutes ago', { minutes });
}

export class RadarPreview {
  private readonly canvases: HTMLCanvasElement[];
  private readonly ready = new Set<number>();
  private readonly active: () => boolean;
  private readonly asked = new AbortController();
  private readonly frames: readonly RadarFrame[];
  private readonly nowAt: number;
  private readonly label: HTMLElement | null;
  private timer = 0;
  private stopped = false;
  private shown = -1;

  // `latest` is the canvas already showing the frame now, `frames[nowAt]`; `label` says the time
  // of the frame shown.
  constructor(
    latest: HTMLCanvasElement,
    frames: readonly RadarFrame[],
    nowAt: number,
    paint: (canvas: HTMLCanvasElement, frame: RadarFrame, signal: AbortSignal) => Promise<boolean>,
    active: () => boolean,
    label: HTMLElement | null,
  ) {
    this.active = active;
    this.frames = frames;
    this.nowAt = nowAt;
    this.label = label;
    this.canvases = frames.map((frame, i) => {
      const canvas = i === nowAt ? latest : document.createElement('canvas');
      canvas.className = 'radar-layer frame';
      canvas.dataset['frame'] = String(i);
      if (canvas !== latest) latest.before(canvas);
      void paint(canvas, frame, this.asked.signal).then(painted => {
        if (this.stopped) return;
        if (painted) this.ready.add(i);
        this.update();
      });
      return canvas;
    });
    this.show(nowAt);
  }

  private show(at: number) {
    this.shown = at;
    for (const [i, canvas] of this.canvases.entries()) canvas.toggleAttribute('data-on', i === at);
    const frame = this.frames[at];
    if (this.label && frame) this.label.textContent = radarWhen(frame.time, Date.now(), at === this.nowAt);
  }

  update() {
    if (this.stopped) return;
    if (!this.active()) {
      window.clearTimeout(this.timer);
      this.timer = 0;
      this.show(this.nowAt);
      return;
    }
    if (this.timer || this.ready.size < 2) return;
    this.timer = window.setTimeout(
      () => {
        this.timer = 0;
        if (this.active())
          for (let step = 1; step <= this.canvases.length; step++) {
            const next = (this.shown + step) % this.canvases.length;
            if (this.ready.has(next)) {
              this.show(next);
              break;
            }
          }
        this.update();
      },
      this.shown === this.nowAt ? FRAME_TIME * NOW_HOLD : FRAME_TIME,
    );
  }

  stop() {
    this.stopped = true;
    this.asked.abort();
    window.clearTimeout(this.timer);
    this.timer = 0;
  }
}
