import { MINUTE } from '../lib/time.ts';

// RainViewer answers 500 tile requests a minute from one address, no more than 300 of them at once,
// and past that refuses every request for a minute. Every screen in a home shares an address, so a
// card keeps to half of that, and all the cards on a page share these turns. (Its answers say how
// many that address has used, but not in a way a page is let read.)
const PER_MINUTE = 250;
const TOO_MANY = 429;
// Each tile comes with leave to keep it for two days, so one that has come is the browser's to give
// again without asking, and spends no turn. The latest so many are remembered.
const KEPT = 1000;
const kept = new Set<string>();
function remember(url: string) {
  kept.delete(url);
  kept.add(url);
  const [oldest] = kept;
  if (kept.size > KEPT && oldest !== undefined) kept.delete(oldest);
}
let sent: number[] = [];
let heldUntil = 0;
let last: Promise<void> = Promise.resolve();

const wait = (span: number) => new Promise(done => setTimeout(done, span));
async function take(signal: AbortSignal | null | undefined): Promise<void> {
  // A tile no longer wanted, as a map moved on, spends no turn.
  while (!signal?.aborted) {
    const now = Date.now();
    sent = sent.filter(time => now - time < MINUTE);
    const [oldest] = sent,
      next = Math.max(heldUntil, sent.length < PER_MINUTE || oldest === undefined ? now : oldest + MINUTE);
    if (next <= now) {
      sent.push(now);
      return;
    }
    await wait(next - now);
  }
}
// Resolves when a tile may be asked for, in the order they were wanted.
export function tileTurn(signal?: AbortSignal | null): Promise<void> {
  last = last.then(() => take(signal));
  return last;
}
// Notes a refusal, which holds every tile back until the service answers again.
export function tileAnswered(response: Pick<Response, 'status'>) {
  if (response.status === TOO_MANY) heldUntil = Date.now() + MINUTE;
}
// A tile asked for in its turn. An answer the page isn't let read holds every tile back as a refusal
// does: a refusal sent without the headers that let a page see it fails just as a lost connection
// does, and either way asking again at once does no good.
export async function pacedFetch(url: string, signal?: AbortSignal | null): Promise<Response> {
  if (!kept.has(url)) await tileTurn(signal);
  try {
    const response = await fetch(url, { signal: signal ?? null });
    tileAnswered(response);
    if (response.ok) remember(url);
    return response;
  } catch (error) {
    if (!signal?.aborted) heldUntil = Date.now() + MINUTE;
    throw error;
  }
}
