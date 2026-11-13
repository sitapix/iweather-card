import { afterEach, expect, test, vi } from 'vitest';

// A request that never answers unless told to, as a hung store leaves it.
type Silent = { onblocked?: () => void };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

test('a store that never opens is passed over rather than waited on', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('indexedDB', { open: () => ({}) });
  const { keptTile, STORE_WAIT } = await import('../src/map/kept-tiles.ts');
  let found: ArrayBuffer | undefined | 'waiting' = 'waiting';
  void keptTile('https://tiles.example/a.png').then(bytes => {
    found = bytes;
  });
  await vi.advanceTimersByTimeAsync(STORE_WAIT);
  expect(found).toBeUndefined();
});

test('a store held up by another tab is passed over at once', async () => {
  const request: Silent = {};
  vi.stubGlobal('indexedDB', { open: () => request });
  const { keptTile } = await import('../src/map/kept-tiles.ts');
  const found = keptTile('https://tiles.example/a.png');
  request.onblocked?.();
  await expect(found).resolves.toBeUndefined();
});
