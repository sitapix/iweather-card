import { afterEach, beforeEach, expect, test, vi } from 'vitest';

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

test('switching from a translated language to English requests a redraw', async () => {
  const { useWords, say, loadWords } = await import('../src/weather/words.ts');
  useWords('de', { Wind: 'Wind auf Deutsch' });
  expect(await loadWords('en')).toBe(true);
  expect(say('Wind')).toBe('Wind');
});

test('multiple cards share a pending language request and all redraw after it arrives', async () => {
  const { loadWords, say } = await import('../src/weather/words.ts'),
    fetcher = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ Wind: 'Vent' }))));
  vi.stubGlobal('fetch', fetcher);
  expect(await Promise.all([loadWords('fr'), loadWords('fr')])).toEqual([true, true]);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(say('Wind')).toBe('Vent');
});

test('an older language response cannot overwrite a newer language selection', async () => {
  const { loadWords, say } = await import('../src/weather/words.ts');
  let finish: (response: Response) => void = () => undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>(resolve => {
          finish = resolve;
        }),
    ),
  );
  const pending = loadWords('fr');
  await loadWords('en');
  finish(new Response(JSON.stringify({ Wind: 'Vent' })));
  expect(await pending).toBe(false);
  expect(say('Wind')).toBe('Wind');
});

test('a failed new language also replaces the old translation with English', async () => {
  const { useWords, say, loadWords } = await import('../src/weather/words.ts');
  useWords('de', { Wind: 'Alter Text' });
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Offline'))),
  );
  expect(await loadWords('fr')).toBe(true);
  expect(say('Wind')).toBe('Wind');
});
