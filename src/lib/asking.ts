// Asking the services the card reads what Home Assistant doesn't hold: their answers as JSON,
// answers kept in the browser for a page opened again, and requests shared by cards asking at once.
import { isRecord } from './values.ts';

// What asks: `fetch`, or a stand-in that answers the same way.
export type Fetcher = (url: string) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

// An answer's JSON, or an error naming the service and the status it answered with.
export const answerOf = (response: Awaited<ReturnType<Fetcher>>, service: string): Promise<unknown> =>
  response.ok ? response.json() : Promise.reject(new Error(`${service} ${response.status ?? ''}`));
export const askJson = async (fetcher: Fetcher, url: string, service: string): Promise<unknown> =>
  answerOf(await fetcher(url), service);

// The answer kept under `key`, if it was for `url`, read by `read` from when it came and what it
// said; null if there is none, it was for another address, or it can't be read.
export function keptAnswer<T>(key: string, url: string, read: (at: unknown, body: unknown) => T | null): T | null {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    return isRecord(saved) && saved['url'] === url ? read(saved['at'], saved['body']) : null;
  } catch {
    return null;
  }
}
// Keeps an answer under `key`, in place of the last, where the browser lets it.
export function keepAnswer(key: string, url: string, at: number, body: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify({ url, at, body }));
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
