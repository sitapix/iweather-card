import { afterEach, expect, test, vi } from 'vitest';
import { normalizeConfig } from '../src/card/config.ts';
import { MINUTE } from '../src/lib/time.ts';
import { MapViews, type MapHost } from '../src/map/views.ts';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const frames = (time = 1) =>
  new Response(JSON.stringify({ host: 'https://radar.invalid', radar: { past: [{ time, path: `/frame/${time}` }] } }));

function radarHost(minutes = 5) {
  const element = document.createElement('div'),
    root = element.attachShadow({ mode: 'open' });
  document.body.append(element);
  const host = Object.assign(element, {
    root,
    config: normalizeConfig({
      type: 'custom:iweather-card',
      entity: 'weather.home',
      weather_layout: 'page',
      map: 'rainviewer',
      radar_refresh_minutes: minutes,
    }),
    readHass: undefined,
    update: undefined,
    text: undefined,
    motion: undefined,
    visible: true,
    zoom: 1,
    sheets: { renderMap: () => undefined },
  }) satisfies MapHost;
  const maps = new MapViews(host),
    fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(frames())),
    drawn = vi.spyOn(maps, 'draw').mockImplementation(() => {});
  vi.stubGlobal('fetch', fetcher);
  return { host, maps, fetcher, drawn };
}

test('radar refresh uses the configured minutes and applies a shorter interval immediately', async () => {
  const { host, maps, fetcher } = radarHost(60),
    now = Date.now();
  await maps.loadRadar(now);
  await maps.loadRadar(now + 59 * MINUTE);
  expect(fetcher).toHaveBeenCalledOnce();
  await maps.loadRadar(now + 60 * MINUTE);
  expect(fetcher).toHaveBeenCalledTimes(2);
  host.config = { ...host.config, radar_refresh_minutes: 1 };
  await maps.loadRadar(now + 61 * MINUTE);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

test('a pending radar request is never duplicated and a hidden completion does not repaint', async () => {
  const { host, maps, fetcher, drawn } = radarHost(1),
    now = Date.now();
  let resolve = (_response: Response) => {};
  fetcher.mockReturnValueOnce(
    new Promise<Response>(done => {
      resolve = done;
    }),
  );
  const pending = maps.loadRadar(now);
  await maps.loadRadar(now + 2 * MINUTE);
  expect(fetcher).toHaveBeenCalledOnce();
  host.visible = false;
  await maps.loadRadar(now + 3 * MINUTE);
  resolve(frames());
  await pending;
  expect(fetcher).toHaveBeenCalledOnce();
  expect(drawn).not.toHaveBeenCalled();
  expect(maps.radar?.frames).toHaveLength(1);
  host.visible = true;
  await maps.loadRadar(now + 3 * MINUTE);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('hidden and non-page maps do not start radar requests', async () => {
  const { host, maps, fetcher } = radarHost(),
    now = Date.now();
  host.visible = false;
  await maps.loadRadar(now);
  host.visible = true;
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  await maps.loadRadar(now);
  expect(fetcher).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  host.config = { ...host.config, weather_layout: 'compact' };
  await maps.loadRadar(now);
  expect(fetcher).not.toHaveBeenCalled();
});

test('invalidating radar aborts its request and a late answer cannot replace a newer one', async () => {
  const { maps, fetcher, drawn } = radarHost(),
    now = Date.now();
  let resolve = (_response: Response) => {};
  fetcher.mockReturnValueOnce(
    new Promise<Response>(done => {
      resolve = done;
    }),
  );
  const pending = maps.loadRadar(now),
    signal = fetcher.mock.calls[0]?.[1]?.signal;
  maps.invalidateRadar();
  expect(signal?.aborted).toBe(true);
  await maps.loadRadar(now);
  expect(drawn).toHaveBeenCalledOnce();
  resolve(frames(2));
  await pending;
  expect(maps.radar?.frames[0]?.time).toBe(1000);
  expect(drawn).toHaveBeenCalledOnce();
});

test('a detached card rejects radar completion without repainting', async () => {
  const { host, maps, fetcher, drawn } = radarHost();
  let resolve = (_response: Response) => {};
  fetcher.mockReturnValueOnce(
    new Promise<Response>(done => {
      resolve = done;
    }),
  );
  const pending = maps.loadRadar(Date.now());
  host.remove();
  resolve(frames());
  await pending;
  expect(maps.radar).toBeUndefined();
  expect(drawn).not.toHaveBeenCalled();
});

test('radar disabled during a request rejects its late completion and starts afresh when enabled', async () => {
  const { host, maps, fetcher, drawn } = radarHost(),
    now = Date.now();
  let resolve = (_response: Response) => {};
  fetcher.mockReturnValueOnce(
    new Promise<Response>(done => {
      resolve = done;
    }),
  );
  const pending = maps.loadRadar(now);
  host.config = { ...host.config, map: 'none' };
  await maps.loadRadar(now);
  resolve(frames(2));
  await pending;
  expect(maps.radar).toBeUndefined();
  expect(drawn).not.toHaveBeenCalled();
  host.config = { ...host.config, map: 'rainviewer' };
  await maps.loadRadar(now);
  expect(maps.radar?.frames[0]?.time).toBe(1000);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('a failed radar refresh retains the last frames and their generation times', async () => {
  const { maps, fetcher } = radarHost(1),
    now = Date.now();
  await maps.loadRadar(now);
  const previous = maps.radar?.frames;
  fetcher.mockRejectedValueOnce(new Error('Offline'));
  await maps.loadRadar(now + MINUTE);
  expect(maps.radar?.frames).toBe(previous);
  expect(maps.radar?.frames[0]?.time).toBe(1000);
  expect(maps.radar?.failed).toBe(true);
  await maps.loadRadar(now + MINUTE);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test('drawing an overdue map on visibility return refreshes without waiting for the minute timer', async () => {
  const { maps, fetcher, drawn } = radarHost(1),
    now = Date.now();
  await maps.loadRadar(now - 2 * MINUTE);
  drawn.mockRestore();
  maps.draw();
  await vi.waitFor(() => {
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
