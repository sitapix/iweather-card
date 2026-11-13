import { vi } from 'vitest';

// These tests measure what a page lays out, so they set the type it is laid out in: a machine's own
// sans-serif would decide whether they pass. Arial and Liberation Sans have the same widths.
document.documentElement.style.setProperty('--ha-font-family-body', '"Liberation Sans",Arial');

// `vi.waitFor` gives up after a second on what it last saw, without looking again, and a busy machine
// can hold a page still for longer, so a wait could fail just before what it waits for happens. A
// longer one retries nothing: what it waits for still has to happen, so it hides no race.
const PATIENCE = 10_000,
  { waitFor } = vi;
vi.waitFor = <T>(callback: () => T | Promise<T>, options: Parameters<typeof waitFor>[1] = PATIENCE) =>
  waitFor(callback, options);

// No test reaches a service beyond the page's own server, whatever it forgets to stub: such a request
// fails as it would offline; data and blob URLs are the test's own. A test that wants an answer stubs fetch, and unstubbing comes back here.
const { fetch: local } = globalThis;
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  const outside = url.protocol.startsWith('http') && url.origin !== location.origin;
  return outside ? Promise.reject(new TypeError(`Offline: ${url.href}`)) : local(input, init);
};
