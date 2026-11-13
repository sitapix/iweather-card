import { afterEach, expect, test, vi } from 'vitest';
import { RadarPreview, radarWhen } from '../src/map/radar-preview.ts';

const frames = [0, 1, 2].map(time => ({ time, url: `https://radar.invalid/${time}` }));
const shown = () => document.querySelector<HTMLElement>('[data-on]')?.dataset['frame'];
const canvas = () => {
  const last = document.createElement('canvas');
  document.body.replaceChildren(last);
  return last;
};
const MINUTE = 60_000;
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

test('the preview paints each observation once, holds the frame now twice as long, and loops on its own', async () => {
  vi.useFakeTimers();
  const paint = vi.fn().mockResolvedValue(true),
    preview = new RadarPreview(canvas(), frames, 2, paint, () => true, null);
  await Promise.resolve();
  expect(shown()).toBe('2');
  await vi.advanceTimersByTimeAsync(1000);
  expect(shown()).toBe('2');
  await vi.advanceTimersByTimeAsync(1000);
  expect(shown()).toBe('0');
  await vi.advanceTimersByTimeAsync(1000);
  expect(shown()).toBe('1');
  await vi.advanceTimersByTimeAsync(1000);
  expect(shown()).toBe('2');
  expect(paint).toHaveBeenCalledTimes(3);
  preview.stop();
  expect(vi.getTimerCount()).toBe(0);
});

test('missing observations are skipped and a late observation joins playback when ready', async () => {
  vi.useFakeTimers();
  let finish = (_painted: boolean) => {};
  const pending = new Promise<boolean>(resolve => {
      finish = resolve;
    }),
    preview = new RadarPreview(
      canvas(),
      frames,
      2,
      (_canvas, frame) => (frame.time === 0 ? pending : Promise.resolve(true)),
      () => true,
      null,
    );
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(2000);
  expect(shown()).toBe('1');
  finish(true);
  await vi.advanceTimersByTimeAsync(3000);
  expect(shown()).toBe('0');
  preview.stop();
});

test('a hidden or disabled preview shows the frame now and resumes when active', async () => {
  vi.useFakeTimers();
  let active = true;
  const preview = new RadarPreview(
    canvas(),
    frames,
    2,
    () => Promise.resolve(true),
    () => active,
    null,
  );
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(2000);
  expect(shown()).toBe('0');
  active = false;
  preview.update();
  expect(shown()).toBe('2');
  expect(vi.getTimerCount()).toBe(0);
  active = true;
  preview.update();
  await vi.advanceTimersByTimeAsync(2000);
  expect(shown()).toBe('0');
  active = false;
  await vi.advanceTimersByTimeAsync(1000);
  expect(shown()).toBe('2');
  expect(vi.getTimerCount()).toBe(0);
  preview.stop();
});

test('stopped previews ignore late paints and a lone available observation never starts a loop', async () => {
  vi.useFakeTimers();
  let finish = (_painted: boolean) => {};
  const pending = new Promise<boolean>(resolve => {
      finish = resolve;
    }),
    paint = vi.fn((_canvas: HTMLCanvasElement, _frame: (typeof frames)[number], _signal: AbortSignal) => pending),
    preview = new RadarPreview(canvas(), frames, 2, paint, () => true, null);
  preview.stop();
  expect(paint.mock.calls.every(([, , signal]) => signal.aborted)).toBe(true);
  finish(true);
  await Promise.resolve();
  expect(vi.getTimerCount()).toBe(0);
  const one = new RadarPreview(
    canvas(),
    frames,
    2,
    (_canvas, frame) => Promise.resolve(frame.time === 2),
    () => true,
    null,
  );
  await Promise.resolve();
  expect(shown()).toBe('2');
  expect(vi.getTimerCount()).toBe(0);
  one.stop();
});

test('with a forecast the preview plays on from now into the hour ahead, its corner saying when', async () => {
  vi.useFakeTimers();
  const now = Date.now(),
    ahead = [-5, 15, 30].map(minutes => ({ time: now + minutes * MINUTE, url: `https://radar.invalid/${minutes}` })),
    label = document.createElement('span'),
    preview = new RadarPreview(
      canvas(),
      ahead,
      0,
      () => Promise.resolve(true),
      () => true,
      label,
    );
  await Promise.resolve();
  expect([shown(), label.textContent]).toEqual(['0', 'Now']);
  await vi.advanceTimersByTimeAsync(2000);
  expect([shown(), label.textContent]).toEqual(['1', 'In 15 minutes']);
  await vi.advanceTimersByTimeAsync(1000);
  expect([shown(), label.textContent]).toEqual(['2', 'In 30 minutes']);
  await vi.advanceTimersByTimeAsync(1000);
  expect([shown(), label.textContent]).toEqual(['0', 'Now']);
  preview.stop();
});

test('a frame says how far it is from now, to five minutes, and the frame now says Now', () => {
  const now = Date.now();
  expect(radarWhen(now - 40 * MINUTE - 20_000, now, false)).toBe('40 minutes ago');
  expect(radarWhen(now + 54 * MINUTE, now, false)).toBe('In 55 minutes');
  expect(radarWhen(now - 12 * MINUTE, now, true)).toBe('Now');
  expect(radarWhen(now + MINUTE, now, false)).toBe('Now');
});
