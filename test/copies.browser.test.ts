import { afterEach, expect, test, vi } from 'vitest';
import '../src/iweather-card.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

test('a second copy of the card’s file from another address says which build stayed, and changes nothing', async () => {
  const first = customElements.get('iweather-card'),
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(window.iWeatherLoaded?.from).toMatch(/iweather-card\.ts/u);
  // A path held in a variable, so Vite loads the file again under another address.
  const copy = '../src/iweather-card.ts?left-in-place';
  await import(/* @vite-ignore */ copy);
  expect(customElements.get('iweather-card')).toBe(first);
  expect(warn).toHaveBeenCalledOnce();
  expect(String(warn.mock.calls[0]?.[0])).toMatch(/left-in-place.*was not used.*came first/u);
});
