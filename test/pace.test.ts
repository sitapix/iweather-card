import assert from 'node:assert/strict';
import { afterEach, beforeEach, test, vi } from 'vitest';
import type * as Pace from '../src/map/pace.ts';

// Every card on a page shares the turns, so each test starts them afresh.
let tileTurn: typeof Pace.tileTurn;
let tileAnswered: typeof Pace.tileAnswered;
let pacedFetch: typeof Pace.pacedFetch;
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  ({ tileTurn, tileAnswered, pacedFetch } = await import('../src/map/pace.ts'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('a page keeps to 250 tiles a minute, and the rest wait their turn in order', async () => {
  const done: number[] = [];
  for (let i = 0; i < 251; i += 1)
    void tileTurn().then(() => {
      done.push(i);
    });
  await vi.advanceTimersByTimeAsync(59_999);
  assert.equal(done.length, 250);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(done.length, 251);
  assert.deepEqual(
    done,
    done.toSorted((a, b) => a - b),
  );
});

test('a refusal holds every tile back for a minute', async () => {
  await tileTurn();
  tileAnswered({ status: 429 });
  let turned = false;
  void tileTurn().then(() => {
    turned = true;
  });
  await vi.advanceTimersByTimeAsync(59_999);
  assert.equal(turned, false);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(turned, true);
});

test('any other answer holds nothing back', async () => {
  tileAnswered({ status: 404 });
  let turned = false;
  void tileTurn().then(() => {
    turned = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(turned, true);
});

test('a tile no longer wanted spends no turn', async () => {
  const away = new AbortController();
  away.abort();
  for (let i = 0; i < 300; i += 1) void tileTurn(away.signal);
  await vi.advanceTimersByTimeAsync(0);
  let turned = false;
  void tileTurn().then(() => {
    turned = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(turned, true);
});

test('an answer the page is not let read holds every tile back as a refusal does', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
  await assert.rejects(pacedFetch('https://tiles.example/1.png'), TypeError);
  let turned = false;
  void tileTurn().then(() => {
    turned = true;
  });
  await vi.advanceTimersByTimeAsync(59_999);
  assert.equal(turned, false);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(turned, true);
});

test('a tile let go on the way holds nothing back', async () => {
  const away = new AbortController();
  vi.stubGlobal('fetch', () => {
    away.abort();
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  });
  await assert.rejects(pacedFetch('https://tiles.example/1.png', away.signal));
  let turned = false;
  void tileTurn().then(() => {
    turned = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(turned, true);
});

test('a tile that has come once is the browser’s to give again, and waits for no turn', async () => {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 200 })));
  await pacedFetch('https://tiles.example/1.png');
  tileAnswered({ status: 429 });
  let again = false,
    fresh = false;
  void pacedFetch('https://tiles.example/1.png').then(() => {
    again = true;
  });
  void pacedFetch('https://tiles.example/2.png').then(() => {
    fresh = true;
  });
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(again, true);
  assert.equal(fresh, false);
});
