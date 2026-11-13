import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { pressMotion } from '../src/lib/press.ts';

// A finger rests a moment before what it touches gives; these are well short of it and well past.
const SOON = 50,
  RESTED = 200,
  FAR = 30,
  AT = 50,
  POINTER = 7;
let root: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement('div');
  root.innerHTML = '<div class="tile" style="width:100px;height:100px"></div>';
  document.body.append(root);
  pressMotion(root, '.tile');
});

afterEach(() => {
  root.remove();
  vi.useRealTimers();
});

const tile = () => {
  const found = root.querySelector('.tile');
  if (!(found instanceof HTMLElement)) throw new Error('No tile.');
  return found;
};
const send = (type: string, pointerType: string, y = AT) =>
  tile().dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      isPrimary: true,
      button: 0,
      pointerId: POINTER,
      pointerType,
      clientX: AT,
      clientY: y,
    }),
  );
const moving = () => tile().getAnimations().length;

test('a mouse presses what it is over at once', () => {
  send('pointerdown', 'mouse');
  expect(moving()).toBe(1);
  send('pointerup', 'mouse');
  expect(moving()).toBe(2);
});

test('a finger presses once it has rested, and springs it back when lifted', () => {
  send('pointerdown', 'touch');
  expect(moving()).toBe(0);
  vi.advanceTimersByTime(RESTED);
  expect(moving()).toBe(1);
  send('pointerup', 'touch');
  expect(moving()).toBe(2);
});

test('a finger that sets off to scroll at once moves nothing', () => {
  send('pointerdown', 'touch');
  vi.advanceTimersByTime(SOON);
  send('pointermove', 'touch', AT + FAR);
  vi.advanceTimersByTime(RESTED);
  send('pointerup', 'touch', AT + FAR);
  expect(moving()).toBe(0);
});

test('a touch the browser takes for a scroll moves nothing', () => {
  send('pointerdown', 'touch');
  vi.advanceTimersByTime(SOON);
  send('pointercancel', 'touch');
  vi.advanceTimersByTime(RESTED);
  expect(moving()).toBe(0);
});

test('pressed only by a finger, it holds still under a mouse and gives under a finger', () => {
  root.remove();
  root = document.createElement('div');
  root.innerHTML = '<div class="tile" style="width:100px;height:100px"></div>';
  document.body.append(root);
  pressMotion(root, '.tile', { touchOnly: true });
  send('pointerdown', 'mouse');
  expect(moving()).toBe(0);
  send('pointerup', 'mouse');
  expect(moving()).toBe(0);
  send('pointerdown', 'touch');
  vi.advanceTimersByTime(RESTED);
  expect(moving()).toBe(1);
  send('pointerup', 'touch');
  expect(moving()).toBe(2);
});

test('a quick tap still dips as it lifts', () => {
  send('pointerdown', 'touch');
  vi.advanceTimersByTime(SOON);
  send('pointerup', 'touch');
  expect(moving()).toBe(2);
});
