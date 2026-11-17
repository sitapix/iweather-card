import { afterEach, expect, test, vi } from 'vitest';
import type { Connection, HomeAssistant } from '../src/card/home-assistant.ts';
import { keepAnswer, keptAnswer } from '../src/lib/asking.ts';
import { askHistory } from '../src/weather/history.ts';

afterEach(() => vi.unstubAllGlobals());

function storage() {
  const items = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
  });
  return items;
}

test('returning to a place keeps its original timestamp, including a reply saved before the upgrade', () => {
  const items = storage(),
    read = (url: string) => keptAnswer('weather', url, (at, body) => [at, body]);
  items.set('weather', JSON.stringify({ url: 'A', at: 1, body: 'sun' }));
  expect(read('A')).toEqual([1, 'sun']);
  keepAnswer('weather', 'B', 2, 'rain');
  expect(read('A')).toEqual([1, 'sun']);
  for (const place of ['C', 'D', 'B', 'E']) keepAnswer('weather', place, 3, place);
  expect(read('A')).toBeNull();
  expect(read('B')).toEqual([3, 'B']);
  for (const place of ['C', 'D', 'E']) expect(read(place)).toEqual([3, place]);
  expect(items.size).toBe(5);
});

test('a damaged index or a slot overwritten by another tab recovers on the next write', () => {
  const items = storage(),
    read = (url: string) => keptAnswer('weather', url, (_at, body) => body);
  items.set('weather', 'incomplete');
  items.set('weather-places', 'incomplete');
  keepAnswer('weather', 'A', 1, 'sun');
  expect(read('A')).toBe('sun');
  items.set('weather', JSON.stringify({ url: 'B', at: 2, body: 'rain' }));
  expect(read('A')).toBeNull();
  keepAnswer('weather', 'A', 3, 'clear');
  expect(read('A')).toBe('clear');
});

test('recorder requests share only the exact pending query on the same connection and can retry a failure', async () => {
  const connection: Connection = { subscribeMessage: () => Promise.resolve(() => {}) },
    callWS = vi.fn<NonNullable<HomeAssistant['callWS']>>().mockResolvedValue({}),
    hass = { states: {}, connection, callWS },
    anotherCard = { ...hass },
    entity = ['weather.home'];
  callWS.mockRejectedValueOnce(new Error('recorder offline'));
  const first = askHistory(hass, entity, true, 0, 1);
  expect(askHistory(anotherCard, [...entity], true, 0, 1)).toBe(first);
  await Promise.all([
    askHistory(anotherCard, entity, false, 0, 1),
    askHistory(anotherCard, entity, true, 0, 2),
    askHistory(anotherCard, ['weather.other'], true, 0, 1),
    askHistory({ ...hass, connection: { ...connection } }, entity, true, 0, 1),
    expect(first).rejects.toThrow('recorder offline'),
  ]);
  expect(callWS).toHaveBeenCalledTimes(5);
  await expect(askHistory(hass, entity, true, 0, 1)).resolves.toEqual({});
  expect(callWS).toHaveBeenCalledTimes(6);
});
