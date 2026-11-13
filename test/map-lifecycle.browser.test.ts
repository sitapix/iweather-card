import { afterEach, expect, test, vi } from 'vitest';
import { normalizeConfig } from '../src/card/config.ts';
import type * as MapGl from '../src/map/gl.ts';
import { newMap } from '../src/map/gl.ts';
import { steadyWind } from '../src/map/sources.ts';
import type { MapInputs } from '../src/map/view.ts';
import { GL_LOST_WAIT, MapViews, type MapHost } from '../src/map/views.ts';
import { drawWindMap } from '../src/map/wind.ts';

vi.mock('../src/map/gl.ts', async original => {
  const actual = await original<typeof MapGl>();
  return {
    ...actual,
    newMap: vi.fn((...args: Parameters<typeof actual.newMap>) =>
      actual.newMap(args[0], {
        ...args[1],
        style: `data:application/json,${encodeURIComponent(JSON.stringify({ version: 8, sources: {}, layers: [] }))}`,
      }),
    ),
  };
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const wind = { times: [0], fields: [steadyWind(5, 90)] };
const centre = { latitude: 0, longitude: 0, zoom: 4 };

function mapHost() {
  const element = document.createElement('div'),
    root = element.attachShadow({ mode: 'open' });
  document.body.append(element);
  root.innerHTML = '<dialog open><div class="radar large"></div></dialog>';
  const host = Object.assign(element, {
    root,
    config: normalizeConfig({ type: 'custom:iweather-card', entity: 'weather.home', map: 'rainviewer' }),
    readHass: undefined,
    update: undefined,
    text: undefined,
    motion: undefined,
    visible: true,
    zoom: 1,
    sheets: { renderMap: () => undefined },
  }) satisfies MapHost;
  return { host, maps: new MapViews(host) };
}

test('wind animation stops requesting frames while inactive and resumes on update', () => {
  const canvas = document.createElement('canvas'),
    frames: FrameRequestCallback[] = [],
    requested = vi.fn((callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('requestAnimationFrame', requested);
  document.body.append(canvas);
  let active = true;
  const map = drawWindMap(
    canvas,
    wind,
    { ...centre, width: 100, height: 100, scale: 1 },
    { moving: () => true, active: () => active, hour: () => 0 },
  );
  expect(frames).toHaveLength(1);
  active = false;
  frames.shift()?.(100);
  expect(frames).toHaveLength(0);
  map.update();
  expect(frames).toHaveLength(0);
  active = true;
  map.update();
  map.update();
  expect(frames).toHaveLength(1);
});

test('closing a map stops its retained wind canvas from requesting frames', () => {
  const { host, maps } = mapHost(),
    view = maps.largeView(),
    canvas = document.createElement('canvas'),
    frames: FrameRequestCallback[] = [];
  if (!view) throw new Error('No map view.');
  view.append(canvas);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  maps.startStreaks(view, canvas, wind, {
    centre,
    width: 100,
    height: 100,
    large: true,
    home: { x: 50, y: 50 },
    across: wind,
    animate: true,
  });
  expect(frames).toHaveLength(1);
  host.root.querySelector('dialog')?.close();
  maps.reset();
  frames.shift()?.(100);
  expect(canvas.isConnected).toBe(true);
  expect(frames).toHaveLength(0);
});

test('closing a map releases its live ground before the style finishes loading', async () => {
  const { maps } = mapHost();
  vi.spyOn(maps, 'centreOf').mockReturnValue(centre);
  vi.spyOn(maps, 'draw').mockImplementation(() => {});
  await maps.startGl();
  const pending = maps.glPending;
  expect(pending).toBeDefined();
  if (!pending) throw new Error('No pending map.');
  const remove = vi.spyOn(pending.map, 'remove');
  maps.reset();
  expect(remove).toHaveBeenCalledOnce();
  expect(pending.container.isConnected).toBe(false);
  expect(maps.glPending).toBeUndefined();
  expect(maps.glLoading).toBe(false);
});

// Takes the map's WebGL context away for good, as a browser does when a page holds too many.
function loseContext(map: MapGl.GlMap) {
  const lost = map.getCanvas().getContext('webgl2')?.getExtension('WEBGL_lose_context');
  if (!lost) throw new Error('No way to lose the context.');
  lost.loseContext();
}

test('a live ground whose context stays lost is let go, and a new map asked for', async () => {
  const { maps } = mapHost();
  vi.spyOn(maps, 'centreOf').mockReturnValue(centre);
  vi.spyOn(maps, 'draw').mockImplementation(() => {});
  vi.mocked(newMap).mockClear();
  await maps.startGl();
  const first = maps.glPending?.map;
  if (!first) throw new Error('No pending map.');
  const removed = vi.spyOn(first, 'remove');
  loseContext(first);
  await vi.waitFor(() => expect(newMap).toHaveBeenCalledTimes(2), { timeout: GL_LOST_WAIT * 2 });
  expect(removed).toHaveBeenCalledOnce();
});

test('a replacement that loses its context too gives way to the card tiles', async () => {
  const { maps } = mapHost();
  vi.spyOn(maps, 'centreOf').mockReturnValue(centre);
  vi.spyOn(maps, 'draw').mockImplementation(() => {});
  vi.mocked(newMap).mockClear();
  maps.glReplaced = true;
  await maps.startGl();
  const map = maps.glPending?.map;
  if (!map) throw new Error('No pending map.');
  loseContext(map);
  await vi.waitFor(() => expect(maps.glFailed).toBe(true), { timeout: GL_LOST_WAIT * 2 });
  expect(newMap).toHaveBeenCalledOnce();
  expect(maps.glPending).toBeUndefined();
});

test('closing a map while its library is loading prevents a late map from being created', async () => {
  const { maps } = mapHost();
  vi.mocked(newMap).mockClear();
  const pending = maps.startGl();
  maps.reset();
  await pending;
  expect(newMap).not.toHaveBeenCalled();
  expect(maps.glLoading).toBe(false);
});

test('a hidden map does not ask for grids, including a move that is still settling', async () => {
  const { host, maps } = mapHost(),
    fetch = vi.fn().mockRejectedValue(new Error('No request expected.'));
  vi.stubGlobal('fetch', fetch);
  host.visible = false;
  await maps.loadGrid(centre, 100, 100, false, 'forecast');
  expect(fetch).not.toHaveBeenCalled();
  host.visible = true;
  const loading = maps.loadGrid(centre, 100, 100, true, 'forecast');
  host.root.querySelector('dialog')?.close();
  await loading;
  expect(fetch).not.toHaveBeenCalled();
});

function localMap(kind: MapInputs['kind']) {
  const { host, maps } = mapHost(),
    view = maps.largeView();
  if (!view) throw new Error('No map view.');
  view.style.cssText = 'width:300px;height:200px';
  host.config = normalizeConfig({ type: 'custom:iweather-card', entity: 'weather.home', map: 'local' });
  const inputs: MapInputs = {
    latitude: 0,
    longitude: 0,
    kind,
    badge: '20',
    tint: '',
    bearing: '90',
    speed: '5',
    unit: 'm/s',
    low: '',
    high: '',
    condition: 'sunny',
    temperatureUnit: '°C',
    dark: false,
    pinName: '',
  };
  vi.spyOn(maps, 'inputsOf').mockReturnValue(inputs);
  return { host, maps, view, inputs };
}

test('changing animation preferences replaces the wind drawing with a still one', () => {
  const { host, maps, view } = localMap('wind');
  vi.spyOn(maps, 'windHoursOf').mockReturnValue(wind);
  maps.drawView(view, host.config, []);
  const animated = view.querySelector('canvas.wind-streaks');
  expect(animated).not.toBeNull();
  host.config = { ...host.config, weather_animation: false };
  maps.drawView(view, host.config, []);
  const still = view.querySelector('.map-pan:not(.map-old) canvas.wind-streaks');
  expect(still).not.toBeNull();
  expect(still).not.toBe(animated);
});

test('missing daily temperatures do not turn into zeroes on the map pin', () => {
  const { host, maps, view, inputs } = localMap('temperature');
  maps.drawView(view, host.config, []);
  expect(view.querySelector('.map-ring')).toBeNull();
  expect(view.querySelector('.map-badge')?.textContent).toBe('20');
  inputs.low = '0';
  inputs.high = '20';
  maps.drawView(view, host.config, []);
  expect(view.querySelector('.map-ring')).not.toBeNull();
  expect(view.querySelector('.map-badge small')?.textContent).toBe('020');
});

test('tile URL quotes and ampersands remain part of the URL rather than attributes', () => {
  const { host, maps, view } = localMap('temperature'),
    ending = '?label=" data-injected="yes&part=2';
  host.config = { ...host.config, map_tile_url: `https://tiles.invalid/{z}/{x}/{y}.png${ending}` };
  maps.drawView(view, host.config, []);
  const images = [...view.querySelectorAll('.radar-layer.base img')];
  expect(images.length).toBeGreaterThan(0);
  for (const image of images) {
    expect(image.hasAttribute('data-injected')).toBe(false);
    expect(image.getAttribute('src')).toContain(ending);
  }
});
