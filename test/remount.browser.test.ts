import { afterEach, expect, test, vi } from 'vitest';
import '../src/iweather-card.ts';
import type { HomeAssistant } from '../src/card/home-assistant.ts';
import { MINUTE } from '../src/lib/time.ts';

// Home Assistant takes a card down and puts it back each time it moves it on the page, and each time
// the dashboard's editor opens or closes, so whatever a card starts when it joins the page it must
// end when it leaves, or a wall screen running for days gathers copies.
const TIMES = 20,
  // Animation frames watched for the clock's requests.
  FRAMES = 6;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const hass: HomeAssistant = {
  states: {
    'weather.home': {
      entity_id: 'weather.home',
      state: 'rainy',
      attributes: { temperature: 12, humidity: 90, precipitation_unit: 'mm' },
    },
  },
};

// What the card holds open, counted as it stands.
function holdings() {
  const listening = new Map<string, number>(),
    key = (target: EventTarget, type: string) => `${target.constructor.name} ${type}`,
    added = vi.spyOn(EventTarget.prototype, 'addEventListener'),
    removed = vi.spyOn(EventTarget.prototype, 'removeEventListener'),
    observed = [vi.spyOn(ResizeObserver.prototype, 'observe'), vi.spyOn(IntersectionObserver.prototype, 'observe')],
    released = [
      vi.spyOn(ResizeObserver.prototype, 'disconnect'),
      vi.spyOn(IntersectionObserver.prototype, 'disconnect'),
    ],
    contexts = vi.spyOn(HTMLCanvasElement.prototype, 'getContext'),
    frames = vi.spyOn(window, 'requestAnimationFrame');
  return () => {
    listening.clear();
    // The page's and the screen's own listeners, which outlive a card that doesn't let go of them.
    for (const [spy, step] of [
      [added, 1],
      [removed, -1],
    ] as const)
      for (const [index, [type]] of spy.mock.calls.entries()) {
        const target = spy.mock.contexts[index];
        if (target instanceof EventTarget && (target === document || target instanceof MediaQueryList))
          listening.set(key(target, type), (listening.get(key(target, type)) ?? 0) + step);
      }
    const live = new Set(observed.flatMap(spy => spy.mock.contexts));
    for (const spy of released) for (const observer of spy.mock.contexts) live.delete(observer);
    return {
      listening: Object.fromEntries([...listening].filter(([, count]) => count !== 0)),
      observers: live.size,
      webgl: contexts.mock.calls.filter(([kind]) => kind.startsWith('webgl')).length,
      clockFrames: () => frames.mock.calls.filter(([run]) => run.name === 'run').length,
    };
  };
}

async function frames(count: number) {
  for (let i = 0; i < count; i += 1) await new Promise(requestAnimationFrame);
}

test('a card moved twenty times, or taken down and put back, holds no more than once', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  const counted = holdings(),
    card = document.createElement('iweather-card'),
    [here, there] = [document.createElement('div'), document.createElement('div')];
  document.body.append(here, there);
  card.setConfig({ entity: 'weather.home', local_only: true });
  card.hass = hass;
  here.append(card);
  await frames(FRAMES);
  const once = counted();
  // Moved, as a dashboard rearranging its cards does.
  for (let i = 0; i < TIMES; i += 1) (i % 2 ? here : there).append(card);
  await frames(FRAMES);
  const moved = counted();
  // Taken down for good each time, and put back.
  for (let i = 0; i < TIMES; i += 1) {
    card.remove();
    vi.advanceTimersByTime(0);
    here.append(card);
  }
  await frames(FRAMES);
  const returned = counted();
  const held = ({ listening, observers, webgl }: typeof once) => ({ listening, observers, webgl });
  expect({ moved: held(moved), returned: held(returned) }).toEqual({ moved: held(once), returned: held(once) });
  // One animation loop, asking for one frame at a time.
  const before = returned.clockFrames();
  await frames(FRAMES);
  expect(returned.clockFrames() - before).toBeLessThanOrEqual(FRAMES + 1);
});

test('a card moved twenty times keeps one minute tick', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(Date.UTC(2026, 10, 11, 12, 0, 30));
  const card = document.createElement('iweather-card'),
    [here, there] = [document.createElement('div'), document.createElement('div')];
  document.body.append(here, there);
  // Without the sky, nothing else waits on a timer.
  card.setConfig({ entity: 'weather.home', local_only: true, weather_scene: false });
  card.hass = hass;
  here.append(card);
  for (let i = 0; i < TIMES; i += 1) (i % 2 ? here : there).append(card);
  const render = vi.spyOn(card, 'render');
  vi.advanceTimersByTime(MINUTE);
  expect(render).toHaveBeenCalledOnce();
});
