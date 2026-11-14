import { HOUR, MINUTE, SECOND } from '../lib/time.ts';
import { say, sayCount } from '../weather/words.ts';

// The small map's precipitation plays by itself, from now on and never before it: the radar's next
// fifty minutes while precipitation is falling, or else the forecast's hours (see the map's views).
// A playhead runs through their times, holding at the start for NOW_HOLD, then crossing one gap
// between pictures every FRAME_TIME, and round again. The two pictures either side of it blend by how
// far it is between them, so the rain moves on all the while; each is painted once.
const FRAME_TIME = SECOND,
  NOW_HOLD = 2 * SECOND,
  TICK = SECOND / 30;
// The corner says where the playhead is from now, to `step` (5 minutes for the radar, an hour for
// the forecast): "Now", then "In 25 minutes" or "In 3 hours".
export const RADAR_LABEL_STEP = 5 * MINUTE,
  FORECAST_LABEL_STEP = HOUR;
export function radarWhen(time: number, now: number, step: number): string {
  const ahead = Math.round((time - now) / step) * step;
  if (ahead <= 0) return say('Now');
  if (ahead < HOUR) return say('In {minutes} minutes', { minutes: Math.round(ahead / MINUTE) });
  return sayCount('In {count} hour', 'In {count} hours', Math.round(ahead / HOUR));
}
// A picture in the loop, at its time: a radar frame, or an hour of the forecast's precipitation.
export interface PreviewFrame {
  time: number;
}

export class RadarPreview<Frame extends PreviewFrame> {
  private readonly canvases: HTMLCanvasElement[];
  private readonly ready = new Set<number>();
  private readonly active: () => boolean;
  private readonly asked = new AbortController();
  private readonly frames: readonly Frame[];
  private readonly label: HTMLElement | null;
  private readonly step: number;
  private timer = 0;
  private stopped = false;
  // When the playhead last set off from the start, on the page's steady clock, which a change to the
  // time of day doesn't move.
  private began = 0;
  private said = '';

  // `latest`, if given, is the canvas already showing the first frame, the one now. Each other
  // frame's canvas is placed by `mount`, by default beside `latest`. `label` says the playhead's time.
  constructor(
    latest: HTMLCanvasElement | null,
    frames: readonly Frame[],
    step: number,
    paint: (canvas: HTMLCanvasElement, frame: Frame, signal: AbortSignal) => Promise<boolean>,
    active: () => boolean,
    label: HTMLElement | null,
    mount: (canvas: HTMLCanvasElement, frame: Frame) => void = canvas => {
      canvas.className = 'radar-layer frame';
      latest?.before(canvas);
    },
  ) {
    this.active = active;
    this.frames = frames;
    this.label = label;
    this.step = step;
    this.canvases = frames.map((frame, i) => {
      const canvas = (i === 0 ? latest : null) ?? document.createElement('canvas');
      if (canvas !== latest) mount(canvas, frame);
      canvas.dataset['frame'] = String(i);
      // The blend is set frame by frame, so no transition lags behind it.
      canvas.style.transition = 'none';
      void paint(canvas, frame, this.asked.signal).then(painted => {
        if (this.stopped) return;
        if (painted) this.ready.add(i);
        this.update();
      });
      return canvas;
    });
    this.show(0, 0, 0);
  }

  // The playhead `share` of the way from frame `from` to frame `to`, at `time`: those two blend, the
  // one it is nearer is the frame shown, and the corner says its time.
  private show(from: number, to: number, share: number, time = this.frames[from]?.time) {
    for (const [i, canvas] of this.canvases.entries()) {
      const weight = i === from ? 1 - share : i === to ? share : 0;
      canvas.style.opacity = String(weight * Number(canvas.dataset['peak'] ?? 1));
      canvas.toggleAttribute('data-on', i === (share < 1 / 2 ? from : to));
    }
    if (this.label && time !== undefined) {
      const said = radarWhen(time, Date.now(), this.step);
      if (said !== this.said) this.label.textContent = said;
      this.said = said;
    }
  }

  // Where the playhead is `elapsed` ms after setting off, among the frames painted so far.
  private place(elapsed: number) {
    const ready = [...this.ready].sort((a, b) => a - b),
      gaps = ready.length - 1,
      moving = elapsed - NOW_HOLD;
    if (gaps < 1 || moving <= 0) return { from: 0, to: 0, share: 0, time: this.frames[0]?.time };
    const along = Math.min(gaps, moving / FRAME_TIME),
      k = Math.min(gaps - 1, Math.floor(along)),
      from = ready[k] ?? 0,
      to = ready[k + 1] ?? from,
      share = along - k,
      start = this.frames[from]?.time ?? 0,
      end = this.frames[to]?.time ?? start;
    return { from, to, share, time: start + (end - start) * share };
  }

  private tick() {
    this.timer = 0;
    if (this.stopped) return;
    if (!this.active()) {
      this.update();
      return;
    }
    const ready = this.ready.size;
    let elapsed = performance.now() - this.began;
    // Round again once the playhead has reached the last frame.
    if (elapsed > NOW_HOLD + (ready - 1) * FRAME_TIME) {
      this.began = performance.now();
      elapsed = 0;
    }
    const { from, to, share, time } = this.place(elapsed);
    this.show(from, to, share, time);
    this.timer = window.setTimeout(() => this.tick(), TICK);
  }

  update() {
    if (this.stopped) return;
    if (!this.active()) {
      window.clearTimeout(this.timer);
      this.timer = 0;
      this.show(0, 0, 0);
      return;
    }
    if (this.timer || this.ready.size < 2) return;
    this.began = performance.now();
    this.timer = window.setTimeout(() => this.tick(), TICK);
  }

  stop() {
    this.stopped = true;
    this.asked.abort();
    window.clearTimeout(this.timer);
    this.timer = 0;
  }
}
