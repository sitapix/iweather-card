import { afterEach, expect, test, vi } from 'vitest';
import { FORECAST_LABEL_STEP, RADAR_LABEL_STEP, RadarPreview, radarWhen } from '../src/map/radar-preview.ts';

const MINUTE = 60_000,
  HOUR = 60 * MINUTE;
const frames = [0, 1, 2].map(step => ({ time: step * 10 * MINUTE, url: `https://radar.invalid/${step}` }));
const shown = () => document.querySelector<HTMLElement>('[data-on]')?.dataset['frame'];
const opacity = (frame: number) =>
  Number(document.querySelector<HTMLElement>(`[data-frame="${frame}"]`)?.style.opacity ?? Number.NaN);
const canvas = () => {
  const last = document.createElement('canvas');
  document.body.replaceChildren(last);
  return last;
};
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

test('the playhead holds on now, then crosses a gap a second, blending the two frames either side, and goes round', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  const paint = vi.fn().mockResolvedValue(true),
    preview = new RadarPreview(canvas(), frames, RADAR_LABEL_STEP, paint, () => true, null);
  await vi.advanceTimersByTimeAsync(0);
  expect(shown()).toBe('0');
  await vi.advanceTimersByTimeAsync(1900);
  expect(shown()).toBe('0');
  expect(opacity(0)).toBe(1);
  // A quarter of the way to the next frame, a quarter of it shows.
  await vi.advanceTimersByTimeAsync(350);
  expect(opacity(0)).toBeCloseTo(0.75, 1);
  expect(opacity(1)).toBeCloseTo(0.25, 1);
  await vi.advanceTimersByTimeAsync(500);
  expect(shown()).toBe('1');
  await vi.advanceTimersByTimeAsync(1000);
  expect(shown()).toBe('2');
  // Past the last frame, round again from now.
  await vi.advanceTimersByTimeAsync(400);
  expect(shown()).toBe('0');
  expect(paint).toHaveBeenCalledTimes(3);
  preview.stop();
  expect(vi.getTimerCount()).toBe(0);
});

test('a frame still to come is passed over, its neighbours blending across it, and joins once painted', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  let finish = (_painted: boolean) => {};
  const pending = new Promise<boolean>(resolve => {
      finish = resolve;
    }),
    preview = new RadarPreview(
      canvas(),
      frames,
      RADAR_LABEL_STEP,
      (_canvas, frame) => (frame.time === frames[1]?.time ? pending : Promise.resolve(true)),
      () => true,
      null,
    );
  await vi.advanceTimersByTimeAsync(2500);
  expect(opacity(1)).toBe(0);
  expect(opacity(0)).toBeCloseTo(0.5, 1);
  expect(opacity(2)).toBeCloseTo(0.5, 1);
  finish(true);
  // The next time round, it shows in its place: past the hold and most of the way to it.
  await vi.advanceTimersByTimeAsync(1500 + 2000 + 700);
  expect(shown()).toBe('1');
  preview.stop();
});

test('a hidden or disabled preview rests on now and sets off again when active', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  let active = true;
  const preview = new RadarPreview(
    canvas(),
    frames,
    RADAR_LABEL_STEP,
    () => Promise.resolve(true),
    () => active,
    null,
  );
  await vi.advanceTimersByTimeAsync(2600);
  expect(shown()).toBe('1');
  active = false;
  preview.update();
  expect(shown()).toBe('0');
  expect(opacity(0)).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
  active = true;
  preview.update();
  await vi.advanceTimersByTimeAsync(2600);
  expect(shown()).toBe('1');
  active = false;
  await vi.advanceTimersByTimeAsync(100);
  expect(shown()).toBe('0');
  expect(vi.getTimerCount()).toBe(0);
  preview.stop();
});

test('stopped previews ignore late paints and a lone painted frame never starts a loop', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  let finish = (_painted: boolean) => {};
  const pending = new Promise<boolean>(resolve => {
      finish = resolve;
    }),
    paint = vi.fn((_canvas: HTMLCanvasElement, _frame: (typeof frames)[number], _signal: AbortSignal) => pending),
    preview = new RadarPreview(canvas(), frames, RADAR_LABEL_STEP, paint, () => true, null);
  preview.stop();
  expect(paint.mock.calls.every(([, , signal]) => signal.aborted)).toBe(true);
  finish(true);
  await Promise.resolve();
  expect(vi.getTimerCount()).toBe(0);
  const one = new RadarPreview(
    canvas(),
    frames,
    RADAR_LABEL_STEP,
    (_canvas, frame) => Promise.resolve(frame.time === 0),
    () => true,
    null,
  );
  await Promise.resolve();
  expect(shown()).toBe('0');
  expect(vi.getTimerCount()).toBe(0);
  one.stop();
});

test('the corner says where the playhead is from now, five minutes at a time, as it moves', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  const now = Date.now(),
    ahead = [-5, 15, 35].map(minutes => ({ time: now + minutes * MINUTE, url: `https://radar.invalid/${minutes}` })),
    label = document.createElement('span'),
    said = new Set<string>(),
    preview = new RadarPreview(
      canvas(),
      ahead,
      RADAR_LABEL_STEP,
      () => Promise.resolve(true),
      () => true,
      label,
    );
  await vi.advanceTimersByTimeAsync(0);
  expect(label.textContent).toBe('Now');
  for (let ms = 0; ms < 3950; ms += 50) {
    await vi.advanceTimersByTimeAsync(50);
    said.add(label.textContent);
  }
  expect([...said]).toEqual([
    'Now',
    'In 5 minutes',
    'In 10 minutes',
    'In 15 minutes',
    'In 20 minutes',
    'In 25 minutes',
    'In 30 minutes',
    'In 35 minutes',
  ]);
  preview.stop();
});

test('to five minutes within the hour, then whole hours, and never before now', () => {
  const now = Date.now();
  expect(radarWhen(now + 54 * MINUTE, now, RADAR_LABEL_STEP)).toBe('In 55 minutes');
  expect(radarWhen(now + 12 * MINUTE, now, RADAR_LABEL_STEP)).toBe('In 10 minutes');
  expect(radarWhen(now + 2 * MINUTE, now, RADAR_LABEL_STEP)).toBe('Now');
  expect(radarWhen(now - 40 * MINUTE, now, RADAR_LABEL_STEP)).toBe('Now');
  expect(radarWhen(now - 20 * MINUTE, now, FORECAST_LABEL_STEP)).toBe('Now');
  expect(radarWhen(now + 40 * MINUTE, now, FORECAST_LABEL_STEP)).toBe('In 1 hour');
  expect(radarWhen(now + 10 * HOUR + 40 * MINUTE, now, FORECAST_LABEL_STEP)).toBe('In 11 hours');
});
