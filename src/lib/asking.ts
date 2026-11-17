// Asking the services the card reads what Home Assistant doesn't hold: their answers as JSON,
// answers kept in the browser for a page opened again, and requests shared by cards asking at once.
import { finite, isList, isRecord, text } from './values.ts';

// What asks: `fetch`, or a stand-in that answers the same way.
export type Fetcher = (url: string) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

// An answer's JSON, or an error naming the service and the status it answered with.
export const answerOf = (response: Awaited<ReturnType<Fetcher>>, service: string): Promise<unknown> =>
  response.ok ? response.json() : Promise.reject(new Error(`${service} ${response.status ?? ''}`));
export const askJson = async (fetcher: Fetcher, url: string, service: string): Promise<unknown> =>
  answerOf(await fetcher(url), service);

// Four fixed response slots per service, newest write first in a small URL index.
const PLACES = 4;
interface SavedPlace {
  url: string;
  slot: number;
}

const answerFile = (key: string, slot: number) => (slot ? `${key}-${slot}` : key);

function stored(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function places(key: string): SavedPlace[] {
  const index = stored(`${key}-places`);
  if (isList(index))
    return index
      .filter(
        (place: unknown): place is SavedPlace =>
          isRecord(place) &&
          text(place['url']) &&
          finite(place['slot']) &&
          Number.isInteger(place['slot']) &&
          place['slot'] >= 0 &&
          place['slot'] < PLACES,
      )
      .slice(0, PLACES);
  return [];
}

export function keptAnswer<T>(key: string, url: string, read: (at: unknown, body: unknown) => T | null): T | null {
  try {
    const index = places(key),
      place = index.find(entry => entry.url === url);
    if (index.length && !place) return null;
    const saved = stored(answerFile(key, place?.slot ?? 0));
    return isRecord(saved) && saved['url'] === url ? read(saved['at'], saved['body']) : null;
  } catch {
    return null;
  }
}
// The payload retains its URL so a concurrent write from another tab cannot return the wrong place.
export function keepAnswer(key: string, url: string, at: number, body: unknown) {
  try {
    const index = places(key);
    // Older installs kept one reply in the first slot.
    if (!index.length) {
      const previous = stored(key);
      if (isRecord(previous) && text(previous['url'])) index.push({ url: previous['url'], slot: 0 });
    }
    const slot =
      index.find(entry => entry.url === url)?.slot ??
      (index.length < PLACES ? index.length : (index.at(-1)?.slot ?? 0));
    localStorage.setItem(answerFile(key, slot), JSON.stringify({ url, at, body }));
    localStorage.setItem(
      `${key}-places`,
      JSON.stringify([{ url, slot }, ...index.filter(entry => entry.slot !== slot)]),
    );
  } catch {}
}

// Requests by key: one asked again while it is on its way is shared rather than sent twice.
export function sharedRequests<T>(): (key: string, ask: () => Promise<T>) => Promise<T> {
  const asking = new Map<string, Promise<T>>();
  return (key, ask) => {
    const pending = asking.get(key);
    if (pending) return pending;
    const request = ask().finally(() => asking.delete(key));
    asking.set(key, request);
    return request;
  };
}
