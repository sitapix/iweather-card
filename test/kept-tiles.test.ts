import { afterEach, expect, test, vi } from 'vitest';
import { DAY, HOUR, MINUTE } from '../src/lib/time.ts';

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

test.each(['blocked', 'timeout'])('a %s open can recover and a late connection cannot displace it', async failure => {
  vi.useFakeTimers();
  const close = vi.fn(),
    bytes = new ArrayBuffer(3),
    get = () => {
      const read = { result: { at: Date.now(), bytes }, onsuccess: () => {} };
      void Promise.resolve().then(() => read.onsuccess());
      return read;
    },
    request = () => ({
      result: { close, transaction: () => ({ objectStore: () => ({ get }) }) },
      onblocked: () => {},
      onsuccess: () => {},
    }),
    first = request(),
    second = request(),
    open = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
  vi.stubGlobal('indexedDB', { open });
  const { keptTile, STORE_WAIT } = await import('../src/map/kept-tiles.ts');
  const pending = keptTile('tile');
  if (failure === 'blocked') first.onblocked();
  else await vi.advanceTimersByTimeAsync(STORE_WAIT);
  await expect(pending).resolves.toBeUndefined();
  await expect(keptTile('tile')).resolves.toBeUndefined();
  expect(open).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(MINUTE);
  const recovered = keptTile('tile');
  second.onsuccess();
  await expect(recovered).resolves.toBe(bytes);
  first.onsuccess();
  expect(close).toHaveBeenCalledOnce();
  await expect(keptTile('tile')).resolves.toBe(bytes);
  expect(open).toHaveBeenCalledTimes(2);
});

test('a dashboard left open prunes expired keys in bounded batches while the store is in use', async () => {
  vi.useFakeTimers();
  const upperBound = vi.fn(),
    remove = vi.fn(),
    put = vi.fn(),
    scan = vi.fn(() => {
      let key = 0;
      const cursor = {
        result: {
          primaryKey: key,
          continue: () => {
            cursor.result.primaryKey = ++key;
            cursor.onsuccess();
          },
        },
        onsuccess: () => {},
      };
      void Promise.resolve().then(() => cursor.onsuccess());
      return cursor;
    }),
    store = {
      index: () => ({ openKeyCursor: scan }),
      delete: remove,
      put,
      get: () => {
        const read = { result: undefined, onsuccess: () => {} };
        void Promise.resolve().then(() => read.onsuccess());
        return read;
      },
    },
    open = { result: { transaction: () => ({ objectStore: () => store }) }, onsuccess: () => {} };
  vi.stubGlobal('IDBKeyRange', { upperBound });
  vi.stubGlobal('indexedDB', { open: () => open });
  const { keepTile, keptTile } = await import('../src/map/kept-tiles.ts');
  const bytes = new ArrayBuffer(1),
    first = keepTile('a', bytes);
  open.onsuccess();
  await first;
  expect(scan).toHaveBeenCalledTimes(2);
  expect(remove).toHaveBeenCalledTimes(2 * 128);
  expect(upperBound).toHaveBeenCalledWith(Date.now() - DAY, true);
  await keepTile('b', bytes);
  expect(scan).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(HOUR);
  await keptTile('c');
  expect(scan).toHaveBeenCalledTimes(4);
  expect(remove).toHaveBeenCalledTimes(4 * 128);
  expect(put).toHaveBeenCalledTimes(2);
});
