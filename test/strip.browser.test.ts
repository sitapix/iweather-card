import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page as frame } from 'vitest/browser';
import '../src/iweather-card.ts';
import type { ForecastEntry, ForecastSubscription, HomeAssistant } from '../src/card/home-assistant.ts';
import type { IWeatherCard } from '../src/iweather-card.ts';

// The full page's hourly panel on a day with a sunrise in it. Everything here is stylesheet px,
// read with the page's zoom taken back out.
const NOW = Date.UTC(2026, 9, 27, 10, 30),
  HOUR = 3_600_000,
  ZONE = 'America/Chicago',
  RISING = NOW + 2 * HOUR + 12 * 60_000,
  SETTING = NOW + 13 * HOUR,
  ZOOM = 0.8;
const start = Math.floor(NOW / HOUR) * HOUR;
const hoursOf = (count: number, entry: (index: number) => ForecastEntry = () => ({})): ForecastEntry[] =>
  Array.from({ length: count }, (_, i) => ({
    datetime: new Date(start + i * HOUR).toISOString(),
    temperature: 60 + i,
    condition: 'cloudy',
    wind_speed: 4 + (i % 3),
    wind_gust_speed: 12,
    precipitation: 0,
    precipitation_probability: 0,
    ...entry(i),
  }));
const daily: ForecastEntry[] = Array.from({ length: 10 }, (_, i) => ({
  datetime: new Date(NOW + i * 24 * HOUR).toISOString(),
  temperature: 68,
  templow: 50,
  condition: 'cloudy',
  precipitation: 0,
  precipitation_probability: 10,
  wind_gust_speed: 12,
}));
interface Scene {
  hours?: readonly ForecastEntry[];
  days?: readonly ForecastEntry[];
  state?: string;
  sun?: boolean;
  attributes?: Readonly<Record<string, unknown>>;
}
// What sends the hours again, as a new forecast does.
let sendHours: (hours: readonly ForecastEntry[]) => void = () => undefined;
const hassOf = ({
  hours = hoursOf(30),
  days = daily,
  state = 'cloudy',
  sun = true,
  attributes = {},
}: Scene): HomeAssistant => ({
  states: {
    'weather.home': {
      entity_id: 'weather.home',
      state,
      attributes: {
        temperature: 66,
        temperature_unit: '°F',
        wind_speed: 6,
        wind_speed_unit: 'mph',
        precipitation_unit: 'in',
        friendly_name: 'Home',
        supported_features: 3,
        ...attributes,
      },
    },
    ...(sun
      ? {
          'sun.sun': {
            entity_id: 'sun.sun',
            state: 'below_horizon',
            attributes: { next_rising: new Date(RISING).toISOString(), next_setting: new Date(SETTING).toISOString() },
          },
        }
      : {}),
  },
  locale: { language: 'en', time_format: '12' },
  config: { time_zone: ZONE, latitude: 41.9, longitude: -87.6 },
  connection: {
    subscribeMessage(callback: (message: unknown) => void, message: ForecastSubscription) {
      if (message.forecast_type === 'hourly')
        sendHours = forecast => {
          callback({ forecast });
        };
      queueMicrotask(() => {
        callback({ forecast: message.forecast_type === 'hourly' ? hours : days });
      });
      return Promise.resolve(() => undefined);
    },
  },
});
function page(scene: Scene = {}, width = 1310): IWeatherCard {
  const card = document.createElement('iweather-card');
  card.style.cssText = `display:block;width:${width}px`;
  card.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    weather_animation: false,
    open_meteo_forecast: false,
    forecast_days: 10,
  });
  card.hass = hassOf(scene);
  document.body.replaceChildren(card);
  return card;
}
const within = (parent: ParentNode, selector: string) => {
  const found = parent.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`No ${selector}.`);
  return found;
};
const part = (card: IWeatherCard, selector: string) => within(card.root, selector);
const ready = (card: IWeatherCard) =>
  vi.waitFor(() => {
    expect(card.root.querySelector('.hours .hour')).toBeTruthy();
  });
// A view fades into the next (see crossFade): what is read here is the one drawn, once the picture
// of the last has gone.
const show = async (card: IWeatherCard, mode: string) => {
  part(card, `.modes [data-mode=${mode}]`).click();
  await vi.waitFor(() => {
    expect(part(card, '.hours').dataset['mode']).toBe(mode);
    expect(card.root.querySelector('.hours[inert], .daily-content[inert]')).toBeNull();
  });
};
const frames = async (count: number) => {
  for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame);
};
// A line of text's baseline, below the panel's top.
const baseline = (card: IWeatherCard, node: Element) => {
  const probe = document.createElement('span');
  probe.style.cssText = 'display:inline-block;width:0;height:0';
  node.append(probe);
  const at = probe.getBoundingClientRect().bottom;
  probe.remove();
  return (at - part(card, '.forecast').getBoundingClientRect().top) / ZOOM;
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('No network.')));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

test('the sentence is gone from the page, and tells a screen reader what the strip shows', async () => {
  const card = page();
  await ready(card);
  const summary = part(card, '.summary'),
    hours = part(card, '.hours');
  expect(getComputedStyle(summary).display).toBe('none');
  expect(summary.textContent).toMatch(/\.$/);
  expect(hours.getAttribute('aria-describedby')).toBe(summary.id);
  const conditions = summary.textContent;
  await show(card, 'wind');
  await vi.waitFor(() => {
    expect(summary.textContent).not.toBe(conditions);
  });
});

test('every view keeps the panel’s height and the rows of the grid', async () => {
  const card = page({ hours: hoursOf(30, i => ({ precipitation_probability: 40, precipitation: i % 2 ? 0.1 : 0 })) });
  await ready(card);
  for (const mode of ['conditions', 'rain', 'wind']) {
    await show(card, mode);
    const panel = part(card, '.forecast').getBoundingClientRect(),
      column = part(card, '.hour:nth-child(3)'),
      symbol = within(column, '.hour-symbol').getBoundingClientRect();
    expect(panel.height / ZOOM, mode).toBeCloseTo(181.25, 1);
    expect(baseline(card, within(column, '.hour-label')), mode).toBeCloseTo(80, 0);
    expect((symbol.top - panel.top) / ZOOM, mode).toBeCloseTo(89.375, 1);
    expect(symbol.height / ZOOM, mode).toBeCloseTo(51.25, 1);
    if (mode !== 'wind') expect(baseline(card, within(column, '.hour-value')), mode).toBeCloseTo(163.75, 0);
    const value = part(card, '.hour[data-sun] .hour-value');
    if (mode !== 'wind') expect(baseline(card, value), mode).toBeCloseTo(163.75, 0);
  }
});

test('columns stand 65 apart, a sun’s only as wider as its words, and the strip scrolls to its last', async () => {
  const card = page();
  await ready(card);
  const columns = [...card.root.querySelectorAll('.hour')],
    left = (i: number) => (columns[i]?.getBoundingClientRect().left ?? 0) / ZOOM;
  expect(left(2) - left(1)).toBeCloseTo(65, 1);
  const sun = part(card, '.hour[data-sun]').getBoundingClientRect();
  expect(sun.width / ZOOM).toBeGreaterThan(55);
  expect(sun.width / ZOOM).toBeLessThan(68);
  expect(
    (columns[0]?.getBoundingClientRect().left ?? 0) - part(card, '.forecast').getBoundingClientRect().left,
  ).toBeLessThan(1);
  await show(card, 'rain');
  expect(part(card, '.hour[data-sun]').getBoundingClientRect().width / ZOOM, 'small words need no more').toBeCloseTo(
    55,
    1,
  );
});

test('the strip runs out to the panel’s edge, with no fade', async () => {
  const card = page();
  await ready(card);
  await frames(2);
  expect(part(card, '.hours').dataset['fade']).toBe('end');
  expect(getComputedStyle(part(card, '.hours')).maskImage).toBe('none');
});

test('the chance under a symbol goes by the hour’s condition, not the number', async () => {
  const hours = hoursOf(30, i => ({
      condition: i === 2 || i === 3 || i === 4 ? 'rainy' : 'cloudy',
      precipitation_probability: [10, 30, 5, 0][i] ?? 30,
    })),
    // A wet hour with no chance at all.
    missing = hours.map(({ precipitation_probability: chance, ...hour }, i) =>
      i === 4 ? hour : { ...hour, precipitation_probability: chance },
    ),
    card = page({ hours: missing, state: 'cloudy' });
  await ready(card);
  await show(card, 'conditions');
  const under = [...card.root.querySelectorAll('.hour:not([data-sun])')].map(
    hour => hour.querySelector('.hour-chance')?.textContent ?? null,
  );
  expect(under.slice(0, 6)).toEqual([null, null, '5%', '0%', null, null]);
});

test('a day’s chance goes by its condition too', async () => {
  const card = page({
    days: daily.map((day, i) => ({ ...day, condition: i === 2 ? 'rainy' : 'cloudy', precipitation_probability: 30 })),
  });
  await vi.waitFor(() => {
    expect(card.root.querySelectorAll('.day')).toHaveLength(10);
  });
  expect(card.root.querySelectorAll('.day-chance')).toHaveLength(1);
});

// The heading's words, under the panel's title.
const measureWords = (card: IWeatherCard) => part(card, '.measure span').textContent;
test('the heading is worded for what falls, and for the view', async () => {
  const card = page({ days: daily.map(day => ({ ...day, condition: 'snowy' })) });
  await ready(card);
  await show(card, 'rain');
  expect(part(card, '.heading strong').textContent).toBe('Precipitation');
  expect(measureWords(card)).toBe('Intensity • Chance of Snow');
  await show(card, 'wind');
  expect(measureWords(card)).toBe('Speed (mph) • Gusts');
  await show(card, 'conditions');
  expect(measureWords(card)).toBe('Temperature (°F)');
});
for (const [state, kind] of [
  ['hail', 'Hail'],
  ['snowy-rainy', 'Wintry Mix'],
  ['rainy', 'Rain'],
] as const)
  test(`the heading names the chance of ${kind.toLowerCase()} on a ${state} day`, async () => {
    const card = page({ state });
    await ready(card);
    await show(card, 'rain');
    expect(measureWords(card)).toBe(`Intensity • Chance of ${kind}`);
  });
test('with no chance and no gust anywhere, the heading owns up to what’s missing', async () => {
  const bare = hoursOf(30).map(({ precipitation_probability: _chance, wind_gust_speed: _gust, ...hour }) => hour),
    card = page({ hours: bare });
  await ready(card);
  await show(card, 'rain');
  expect(measureWords(card)).toBe('Intensity • Amount (in)');
  expect(part(card, '.hour:nth-child(3) .hour-value').textContent).toBe('0″');
  await show(card, 'wind');
  expect(measureWords(card)).toBe('Speed (mph)');
});

test('the subtitle’s light adds itself to the panel, with no words drawn over it to stand off it', async () => {
  const card = page();
  await ready(card);
  const lift = part(card, '.forecast-content > .lift'),
    words = part(card, '.measure span');
  // White at 55%: what is behind goes from x to x + .55 under contrast(1 / 2.1) brightness(2.1).
  expect(lift.style.getPropertyValue('--add')).toBe('2.100');
  expect(getComputedStyle(lift).backdropFilter).toMatch(/^contrast\(0\.47\d*\) brightness\(2\.1\)$/);
  expect(getComputedStyle(words).color).toBe('rgba(0, 0, 0, 0)');
  for (const drawn of card.root.querySelectorAll('.measure > svg > g, .pinned-heading .title > g'))
    expect(getComputedStyle(drawn).visibility).toBe('hidden');
  expect(lift.style.clipPath).toContain('measure-strip');
  expect(card.root.querySelector('.measure #measure-strip text')?.textContent).toBe('Temperature (°F)');
  const box = lift.getBoundingClientRect(),
    text = part(card, '.measure').getBoundingClientRect();
  expect(box.top).toBeCloseTo(text.top, 0);
  expect(box.left).toBeCloseTo(text.left, 0);
});

test('the pinned heading’s clock adds its light with its words, as one shape', async () => {
  const card = page();
  await ready(card);
  const clip = part(card, '.pinned-heading #pinned-strip');
  expect(clip.querySelector('path')?.getAttribute('transform')).toContain('scale');
  expect(clip.querySelector('text')?.textContent).toBe('Hourly forecast');
  expect(getComputedStyle(part(card, '.pinned-heading svg:not(.title)')).visibility).toBe('hidden');
});

test('a time’s day period stands tight against it, and the switch’s colours take the panel’s', async () => {
  const card = page();
  await ready(card);
  const period = part(card, '.hour:not([data-now]) .period');
  expect(getComputedStyle(period).marginLeft).toBe('0px');
  expect(parseFloat(getComputedStyle(period).fontSize)).toBeCloseTo(11.825);
  const modes = part(card, '.modes'),
    button = part(card, '.modes button');
  // The track's fill is drawn by its `:before`, so the lens can cut it away when held.
  expect(getComputedStyle(modes, '::before').backgroundColor).toBe('rgba(118, 118, 128, 0.24)');
  expect(getComputedStyle(part(card, '.modes .thumb')).backgroundColor).toBe('rgba(255, 255, 255, 0.28)');
  expect(getComputedStyle(button).color).toBe('rgba(255, 255, 255, 0.85)');
});

test('the view shown colours its symbol: the conditions’ sun yellow, the drop blue, the wind not at all', async () => {
  const card = page();
  await ready(card);
  const WHITE = 'rgba(255, 255, 255, 0.85)',
    // The sun's fill and the drop's, as they end.
    fills = () =>
      ['.mode-sun', '.mode-drop'].map(selector => {
        const shape = part(card, `.modes ${selector}`);
        for (const animation of shape.getAnimations()) animation.finish();
        return getComputedStyle(shape).fill;
      });
  expect(fills()).toEqual(['rgb(255, 204, 2)', WHITE]);
  await show(card, 'rain');
  expect(fills()).toEqual([WHITE, 'rgb(0, 192, 232)']);
  await show(card, 'wind');
  expect(fills()).toEqual([WHITE, WHITE]);
  expect(part(card, '.modes [data-mode=wind]').querySelector('.mode-sun, .mode-drop')).toBeNull();
});

// A press on one of the switch's options, its pointer still down.
const pressOn = (option: HTMLElement) => {
  const { left, top, width, height } = option.getBoundingClientRect(),
    at = {
      bubbles: true,
      isPrimary: true,
      pointerId: 1,
      button: 0,
      clientX: left + width / 2,
      clientY: top + height / 2,
    };
  option.dispatchEvent(new PointerEvent('pointerdown', at));
  return () => option.dispatchEvent(new PointerEvent('pointerup', at));
};
// How far the thumb's springs scale it, across and down.
const scaleOf = (thumb: HTMLElement) => {
  const [, across = '', down = ''] = /scale\(([\d.]+),\s*([\d.]+)\)/.exec(thumb.style.transform) ?? [];
  return [parseFloat(across), parseFloat(down)];
};
test('a press held still leaves the switch as it is, and letting go swells its thumb into a lens', async () => {
  const card = page();
  await ready(card);
  const modes = part(card, '.modes'),
    thumb = part(card, '.modes .thumb'),
    wind = part(card, '.modes [data-mode=wind]'),
    letGo = pressOn(wind);
  await frames(3);
  expect(modes.hasAttribute('data-held')).toBe(false);
  expect(scaleOf(thumb)).toEqual([1, 1]);
  expect(wind.getAttribute('aria-pressed')).toBe('false');
  // The lens settles a moment after letting go (see THUMB_SETTLE), which frames on a busy machine
  // can outlast, so that moment waits here until the lens has been seen.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    letGo();
    expect(modes.hasAttribute('data-held')).toBe(true);
    expect(wind.getAttribute('aria-pressed')).toBe('true');
    await frames(3);
    const [across, down] = scaleOf(thumb);
    expect(across).toBeGreaterThan(1);
    expect(down).toBeGreaterThan(1);
  } finally {
    vi.useRealTimers();
  }
});
test('a drag across the switch swells its thumb as it starts', async () => {
  const card = page();
  await ready(card);
  const modes = part(card, '.modes'),
    wind = part(card, '.modes [data-mode=wind]'),
    { left, top, width, height } = wind.getBoundingClientRect(),
    at = (x: number) => ({
      bubbles: true,
      isPrimary: true,
      pointerId: 1,
      button: 0,
      clientX: x,
      clientY: top + height / 2,
    });
  wind.dispatchEvent(new PointerEvent('pointerdown', at(left + width / 2)));
  modes.dispatchEvent(new PointerEvent('pointermove', at(left + width / 2 - 20)));
  await frames(3);
  expect(modes.hasAttribute('data-held')).toBe(true);
  modes.dispatchEvent(new PointerEvent('pointerup', at(left + width / 2 - 20)));
});
test('once its thumb has glided to another option and settled, the switch stops drawing', async () => {
  const card = page();
  await ready(card);
  const modes = part(card, '.modes'),
    wind = part(card, '.modes [data-mode=wind]'),
    realFrame = window.requestAnimationFrame.bind(window);
  pressOn(wind)();
  await vi.waitFor(() => {
    expect(wind.getAttribute('aria-pressed')).toBe('true');
  });
  // From here frames come a sixtieth of a second apart however busy the machine is, handed out here
  // in turn, as the switch moves its springs on by each frame's time. The frame it waits on now
  // comes first, so it asks for its next one here.
  const queued: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => queued.push(callback));
  await new Promise(realFrame);
  await new Promise(realFrame);
  let now = performance.now();
  const step = (count: number) => {
    for (let i = 0; i < count; i++) {
      now += 1000 / 60;
      for (const callback of queued.splice(0)) callback(now);
    }
  };
  // Its hold lets go a moment after the press (see THUMB_SETTLE).
  await new Promise(done => setTimeout(done, 300));
  const writes = vi.spyOn(modes.style, 'setProperty');
  step(30);
  expect(writes, 'it draws the glide').toHaveBeenCalled();
  // Ten seconds on, it draws nothing more: a frame loop left running redraws the switch for good.
  step(600);
  writes.mockClear();
  step(60);
  expect(writes).not.toHaveBeenCalled();
  expect(scaleOf(part(card, '.modes .thumb'))).toEqual([1, 1]);
});
test('a press on the switch’s rim, or a little above it, takes the option nearest it across', async () => {
  const card = page();
  await ready(card);
  const modes = part(card, '.modes'),
    box = modes.getBoundingClientRect();
  for (const [mode, y] of [
    ['wind', box.top + 1],
    ['conditions', box.top - 5],
  ] as const) {
    const option = part(card, `.modes [data-mode=${mode}]`),
      { left, width } = option.getBoundingClientRect(),
      x = left + width / 2,
      hit = card.root.elementFromPoint(x, y);
    expect(hit === modes || (hit instanceof Element && modes.contains(hit) && !hit.closest('[data-mode]'))).toBe(true);
    const at = { bubbles: true, isPrimary: true, pointerId: 1, button: 0, clientX: x, clientY: y };
    hit?.dispatchEvent(new PointerEvent('pointerdown', at));
    hit?.dispatchEvent(new PointerEvent('pointerup', at));
    await vi.waitFor(() => {
      expect(option.getAttribute('aria-pressed')).toBe('true');
    });
  }
});
test('on a phone the switch is flat: its thumb fills its option, a press neither swells nor drags it, and it goes straight to the one chosen', async () => {
  await frame.viewport(390, 844);
  try {
    const card = page({}, 390);
    await ready(card);
    const modes = part(card, '.modes'),
      thumb = part(card, '.modes .thumb'),
      wind = part(card, '.modes [data-mode=wind]');
    expect(getComputedStyle(modes, '::before').backgroundColor).toBe('rgba(0, 0, 0, 0.082)');
    expect(getComputedStyle(thumb).backgroundColor).toBe('rgba(255, 255, 255, 0.08)');
    expect(getComputedStyle(wind).color).toBe('rgb(255, 255, 255)');
    // Its options are a fraction of a px off whole ones, which the thumb keeps to.
    const fills = () => {
      const option = part(card, '.modes [aria-pressed=true]').getBoundingClientRect(),
        box = thumb.getBoundingClientRect();
      for (const side of ['left', 'top', 'width', 'height'] as const) expect(box[side]).toBeCloseTo(option[side], 1);
    };
    fills();
    const letGo = pressOn(wind);
    await frames(3);
    expect(modes.hasAttribute('data-held')).toBe(false);
    expect(scaleOf(thumb)).toEqual([1, 1]);
    letGo();
    await vi.waitFor(() => {
      expect(wind.getAttribute('aria-pressed')).toBe('true');
    });
    // It is there as soon as the option is chosen, with no glide between.
    fills();
    expect(scaleOf(thumb)).toEqual([1, 1]);
    // A press moved along the switch leaves it where it is.
    const { left, top, height } = wind.getBoundingClientRect(),
      along = { bubbles: true, pointerId: 1, clientX: left - height, clientY: top + height / 2 };
    pressOn(wind);
    modes.dispatchEvent(new PointerEvent('pointermove', along));
    await frames(2);
    fills();
    modes.dispatchEvent(new PointerEvent('pointercancel', along));
  } finally {
    await frame.viewport(1280, 900);
  }
});
test('on a phone the heading stands in from the panel’s sides as the switch does, its light kept under its words', async () => {
  await frame.viewport(390, 844);
  try {
    const card = page({}, 390);
    await ready(card);
    const header = getComputedStyle(part(card, '.forecast-header'));
    expect(header.paddingLeft).toBe(header.paddingRight);
    // The strip's first column stands in from the panel's side too.
    const panel = part(card, '.forecast').getBoundingClientRect(),
      first = part(card, '.hour').getBoundingClientRect();
    expect(first.left - panel.left).toBeGreaterThan(5);
    const lift = part(card, '.forecast-content>.lift').getBoundingClientRect(),
      words = part(card, '.measure').getBoundingClientRect();
    expect(lift.left).toBeCloseTo(words.left, 0);
  } finally {
    await frame.viewport(1280, 900);
  }
});

test('on a phone the wind chart is drawn to its size: lower, its hour under way 38.5 px in from the panel’s edge', async () => {
  await frame.viewport(390, 844);
  try {
    const card = page({}, 390);
    await ready(card);
    await show(card, 'wind');
    await frames(2);
    const chart = part(card, '.wind-chart'),
      zoom = card.measureZoom(),
      box = chart.getBoundingClientRect(),
      panel = part(card, '.forecast').getBoundingClientRect(),
      dot = chart.querySelector('circle')?.getBoundingClientRect() ?? new DOMRect();
    expect(box.height / zoom).toBeCloseTo(32.4, 1);
    expect(box.bottom).toBeCloseTo(panel.bottom, 0);
    expect((dot.left + dot.width / 2 - panel.left) / zoom).toBeCloseTo(38.5, 0);
    expect(chart.querySelector('path[stroke="url(#strip-wind)"]')?.getAttribute('stroke-width')).toBe('4.6');
  } finally {
    await frame.viewport(1280, 900);
  }
});

test('on a phone a wind speed stands higher, its baseline 114 px down the panel, and its unit further under it', async () => {
  for (const [width, speed, unit] of [
    [1310, 122.5, 15.625],
    [390, 114.075, 18.3],
  ] as const) {
    await frame.viewport(Math.min(width, 1280), 844);
    try {
      const card = page({}, width);
      await ready(card);
      await show(card, 'wind');
      await frames(2);
      // Each strut ends on its baseline (see the page's wind view).
      const zoom = card.measureZoom(),
        top = part(card, '.forecast').getBoundingClientRect().top,
        number = part(card, '.wind-value b').getBoundingClientRect().bottom,
        words = part(card, '.wind-value small').getBoundingClientRect().bottom;
      expect((number - top) / zoom).toBeCloseTo(speed, 1);
      expect((words - number) / zoom).toBeCloseTo(unit, 1);
    } finally {
      await frame.viewport(1280, 900);
    }
  }
});

test('the header holds the room a finger has over the switch, and the band it keeps still goes by its row', async () => {
  for (const width of [1310, 390]) {
    await frame.viewport(Math.min(width, 1280), 844);
    try {
      const card = page({}, width);
      card.style.height = '600px';
      await ready(card);
      await vi.waitFor(() => {
        expect(part(card, '.weather').dataset['scroll']).toBe('true');
      });
      // Nothing in the header stands out over its top: the room reaches no higher than its padding
      // and the switch's margin.
      const header = getComputedStyle(part(card, '.forecast-header')),
        modes = part(card, '.modes');
      expect(Number.parseFloat(header.paddingTop) + Number.parseFloat(getComputedStyle(modes).marginTop)).toBe(
        -Number.parseFloat(getComputedStyle(modes, '::after').top),
      );
      // The band it keeps is its row, 38.75 px tall, with 13.125 px over it and as much under.
      const panel = card.pageScroll.measure().panels.find(item => item.panel === card.parts.forecast);
      expect(panel?.head).toBeCloseTo(13.125 * 2 + 38.75, 1);
    } finally {
      await frame.viewport(1280, 900);
    }
  }
});

test('the rain view’s rules, tints and words add their light through a lift each', async () => {
  const card = page();
  await ready(card);
  await show(card, 'rain');
  await frames(2);
  const lifts = [...card.root.querySelectorAll('.strip-marks > .lift')];
  expect(lifts).toHaveLength(3);
  for (const lift of lifts) expect(getComputedStyle(lift).backdropFilter).toContain('brightness');
});

test('a bar is dark by night, and a day’s light goes on its tint', async () => {
  const card = page({
    // The strip starts before sunrise, so that its hours go from dark to light.
    hours: hoursOf(30, i => ({ precipitation_probability: 10, precipitation: i === 1 ? 0.5 : 0 })),
  });
  await ready(card);
  await show(card, 'rain');
  await frames(2);
  const bar = part(card, '.hour[data-night=true] .precip-bar'),
    day = part(card, '.hour[data-night=false] .precip-bar');
  expect(getComputedStyle(bar).backgroundColor).toBe('rgba(0, 0, 0, 0.08)');
  expect(getComputedStyle(day).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  const box = day.getBoundingClientRect();
  expect([box.width / ZOOM, box.height / ZOOM, parseFloat(getComputedStyle(day).borderRadius)]).toEqual([
    30, 51.25, 7.5,
  ]);
  const days = card.root.querySelectorAll('.hour[data-night=false]:not([data-sun])').length;
  expect(card.root.querySelectorAll('#tint-strip rect')).toHaveLength(days);
});

test('each kind of precipitation has its colours, and a sun’s column has no bar', async () => {
  const card = page({
    hours: hoursOf(30, i => ({
      precipitation: 0.3,
      precipitation_probability: 60,
      condition: ['rainy', 'snowy', 'snowy-rainy', 'hail', 'cloudy'][i] ?? 'cloudy',
    })),
    state: 'rainy',
  });
  await ready(card);
  await show(card, 'rain');
  const look = (kind: string) => {
    const fill = part(card, `.hour[data-precipitation=${kind}] .precip-bar span`),
      glyph = part(card, `.hour[data-precipitation=${kind}] .falling`);
    return [getComputedStyle(fill).backgroundImage, getComputedStyle(glyph).color];
  };
  expect(look('rain')).toEqual(['linear-gradient(0deg, rgb(60, 211, 254), rgb(74, 174, 246))', 'rgb(60, 211, 254)']);
  expect(look('snow')).toEqual(['linear-gradient(0deg, rgb(255, 255, 255), rgb(209, 209, 214))', 'rgb(255, 255, 255)']);
  expect(look('mixed')).toEqual([
    'linear-gradient(0deg, rgb(139, 137, 247), rgb(109, 124, 255))',
    'rgb(109, 124, 255)',
  ]);
  const sun = part(card, '.hour[data-sun]');
  expect(sun.querySelector('.precip-bar')).toBeNull();
  expect(sun.querySelector('.hour-symbol svg')).toBeTruthy();
  expect(getComputedStyle(within(sun, '.hour-value')).fontWeight).toBe('500');
  expect(within(sun, '.hour-label').textContent).toMatch(/:\d\d/);
});

test('the row under the bars: a glyph and a number above nothing, and no dash for now', async () => {
  const card = page({
    hours: hoursOf(30, i => ({ precipitation_probability: [20, 0, 5][i] ?? 0 })),
  });
  await ready(card);
  await show(card, 'rain');
  await frames(2);
  const [now, next, third] = card.root.querySelectorAll<HTMLElement>('.hour:not([data-sun]) .hour-value');
  expect(now?.textContent).toBe('20%');
  expect(now?.querySelector('.falling svg')).toBeTruthy();
  expect(getComputedStyle(now ?? part(card, '.hours')).color).toBe('rgb(255, 255, 255)');
  // None shows in added light, over the words that hold its place.
  expect(next?.textContent).toBe('0%');
  expect(next?.querySelector('.falling')).toBeNull();
  expect(getComputedStyle(next ?? part(card, '.hours')).color).toBe('rgba(0, 0, 0, 0)');
  expect([...card.root.querySelectorAll('.strip-marks svg > g:last-of-type text')].length).toBeGreaterThan(0);
  expect(third?.textContent).toBe('5%');
  const svg = part(card, '.falling svg').getBoundingClientRect();
  expect(svg.height / ZOOM).toBeCloseTo(10.8, 0);
});

// A trackpad's or wheel's turn over the strip, back past where it starts.
const turn = (hours: HTMLElement, deltaX: number, deltaY = 0) => {
  const event = new WheelEvent('wheel', { deltaX, deltaY, bubbles: true, cancelable: true });
  hours.dispatchEvent(event);
  return event.defaultPrevented;
};
const labels = (card: IWeatherCard) => part(card, '.hours > .strip-labels');
const across = (node: Element) => node.getBoundingClientRect().left;
const reveal = (card: IWeatherCard) => part(card, '.hours').style.getPropertyValue('--reveal');
test('a new view fades in over the strip and the days as the last fades out, its heading at once, and the view showing chosen again only draws', async () => {
  const card = page(),
    pictures = () => card.root.querySelectorAll('.hours[inert], .daily-content[inert]');
  await ready(card);
  await show(card, 'conditions');
  part(card, '.modes [data-mode=rain]').click();
  expect(part(card, '.heading strong').textContent).toBe('Precipitation');
  expect(part(card, '.hours').dataset['mode']).toBe('rain');
  expect(pictures()).toHaveLength(2);
  expect(card.root.querySelector('.hours[inert]')?.getAttribute('data-mode')).toBe('conditions');
  await vi.waitFor(() => {
    expect(pictures()).toHaveLength(0);
  });
  part(card, '.modes [data-mode=rain]').click();
  expect(pictures()).toHaveLength(0);
});
test('the labels are out of sight at rest, and move nothing in the strip', async () => {
  const card = page(),
    place = () =>
      [...card.root.querySelectorAll('.hour')].map(
        hour => hour.getBoundingClientRect().left - across(part(card, '.hours')),
      );
  await ready(card);
  await show(card, 'rain');
  await frames(2);
  const [first, second] = place();
  expect((((second ?? 0) - (first ?? 0)) / ZOOM).toFixed(2)).toBe('65.00');
  expect(getComputedStyle(within(labels(card), 'svg')).opacity).toBe('0');
  expect(getComputedStyle(labels(card)).pointerEvents).toBe('none');
  expect(labels(card).getBoundingClientRect().right).toBeLessThanOrEqual(
    across(part(card, '.forecast')) + 12.5 * ZOOM + 0.01,
  );
  expect(labels(card).getAttribute('aria-hidden')).toBe('true');
  await show(card, 'conditions');
  expect(card.root.querySelector('.strip-labels')).toBeNull();
});
test('pulled past its start, the strip brings the labels in beside the first bar, and goes back', async () => {
  const card = page(),
    hours = () => part(card, '.hours');
  await ready(card);
  await show(card, 'rain');
  await frames(2);
  const rest = across(part(card, '.precip-bar'));
  expect(turn(hours(), -40), 'a turn past the start is the strip’s').toBe(true);
  expect(hours().hasAttribute('data-pulled')).toBe(true);
  expect(Number(reveal(card))).toBeGreaterThan(0);
  expect(Number(reveal(card))).toBeLessThan(1);
  for (let i = 0; i < 12; i++) turn(hours(), -40);
  expect(reveal(card)).toBe('1.000');
  await vi.waitFor(() => {
    const words = labels(card).getBoundingClientRect(),
      bar = part(card, '.precip-bar').getBoundingClientRect();
    expect((words.left - across(part(card, '.forecast'))) / ZOOM).toBeCloseTo(12.5, 0);
    expect(bar.left).toBeGreaterThan(words.right);
    expect(bar.left).toBeGreaterThan(rest);
  });
  expect(hours().scrollLeft).toBe(0);
  await vi.waitFor(() => {
    expect(hours().hasAttribute('data-pulled')).toBe(false);
  });
  expect(reveal(card)).toBe('');
  await vi.waitFor(() => {
    expect(hours().hasAttribute('data-settling')).toBe(false);
    expect(across(part(card, '.precip-bar'))).toBeCloseTo(rest, 0);
  });
  expect(hours().scrollLeft, 'and it hasn’t snapped to where the hours were drawn').toBe(0);
});
test('a finger pulls the strip as a wheel does, and lets go with the page', async () => {
  const card = page(),
    hours = () => part(card, '.hours');
  await ready(card);
  await show(card, 'rain');
  await frames(2);
  const box = hours().getBoundingClientRect(),
    touch = (x: number, y: number) =>
      new Touch({ identifier: 1, target: hours(), clientX: box.left + x, clientY: box.top + y }),
    send = (type: string, x: number, y: number, on = true) => {
      const event = new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: on ? [touch(x, y)] : [],
        changedTouches: [touch(x, y)],
      });
      hours().dispatchEvent(event);
      return event.defaultPrevented;
    };
  send('touchstart', 20, 20);
  expect(send('touchmove', 200, 22), 'along the strip, it is the strip’s').toBe(true);
  expect(reveal(card)).toBe('1.000');
  send('touchend', 200, 22, false);
  expect(hours().hasAttribute('data-pulled')).toBe(false);
  // Down the strip, it is the page's.
  send('touchstart', 20, 20);
  expect(send('touchmove', 24, 60)).toBe(false);
  expect(send('touchmove', 200, 70)).toBe(false);
  expect(reveal(card)).toBe('');
  send('touchend', 200, 70, false);
});
test('only a turn back at the strip’s start, in the precipitation view, pulls it', async () => {
  const card = page(),
    hours = () => part(card, '.hours');
  await ready(card);
  expect(turn(hours(), -40), 'another view').toBe(false);
  await show(card, 'rain');
  expect(turn(hours(), 40), 'on along the strip').toBe(false);
  expect(turn(hours(), -10, 40), 'mostly down the page').toBe(false);
  hours().scrollLeft = 200;
  await vi.waitFor(() => {
    expect(hours().dataset['fade']).toBe('both');
  });
  expect(turn(hours(), -40), 'with some way back to go').toBe(false);
  expect(hours().hasAttribute('data-pulled')).toBe(false);
});
test('the labels speak the card’s language, and a strip without chances names its amounts', async () => {
  const card = page({ hours: hoursOf(30, () => ({ precipitation_probability: undefined })) });
  await ready(card);
  await show(card, 'rain');
  await vi.waitFor(() => {
    expect(labels(card).textContent).toContain('Amount');
  });
  card.hass = { ...hassOf({}), locale: { language: 'de', time_format: '12' } };
  await vi.waitFor(() => {
    expect(labels(card).textContent).toContain('Stark');
  });
});

test('a chance an hour hasn’t got shows nothing, not a dash', async () => {
  const hours = hoursOf(30, i => ({ precipitation_probability: i === 3 ? 40 : 0 })).map(
      ({ precipitation_probability, ...hour }, i) => ({
        ...hour,
        ...(i === 3 ? { precipitation_probability } : {}),
      }),
    ),
    card = page({ hours });
  await ready(card);
  await show(card, 'rain');
  expect(part(card, '.hours').textContent).not.toContain('—');
});

test('bars rise in turn when they appear, and follow a new reading at once', async () => {
  const hours = hoursOf(30, i => ({ precipitation: i < 3 ? 0.4 : 0, precipitation_probability: 60 })),
    card = page({ hours });
  await ready(card);
  await show(card, 'rain');
  // A bar's rise: the animation of its height, apart from the fade the view comes in with, which
  // may still be running when the switch has gone over.
  const timing = (index: number) => {
    const column = [...card.root.querySelectorAll('.hour')][index];
    return column
      ?.querySelector('.precip-bar span')
      ?.getAnimations()
      .find(({ effect }) => effect instanceof KeyframeEffect && effect.getKeyframes().some(frame => 'height' in frame))
      ?.effect?.getTiming();
  };
  expect([timing(0)?.delay, timing(0)?.duration]).toEqual([200, 363]);
  expect(timing(1)?.delay).toBe(230);
  expect(timing(2)?.delay).toBe(260);
  expect(timing(5), 'a dry hour has nothing to raise').toBeUndefined();
  // The same hours with more in one of them: only that bar moves, on its own, with no delay.
  sendHours(hoursOf(30, i => ({ precipitation: i === 1 ? 0.9 : i < 3 ? 0.4 : 0, precipitation_probability: 60 })));
  await vi.waitFor(() => {
    expect(timing(1)?.delay).toBe(0);
  });
  expect(timing(2)).toBeUndefined();
});

test('with motion reduced, a bar is simply there', async () => {
  const card = page({ hours: hoursOf(30, () => ({ precipitation: 0.4, precipitation_probability: 60 })) });
  await ready(card);
  await show(card, 'conditions');
  const reduced = vi.spyOn(MediaQueryList.prototype, 'matches', 'get').mockReturnValue(true);
  await show(card, 'rain');
  expect(part(card, '.precip-bar span').getAnimations()).toEqual([]);
  reduced.mockRestore();
});

test('wind is one chart across the whole strip, and speeds with no arrows', async () => {
  const card = page();
  await ready(card);
  await show(card, 'wind');
  await frames(2);
  const hours = part(card, '.hours'),
    chart = card.root.querySelectorAll('.wind-chart');
  expect(chart).toHaveLength(1);
  const box = chart[0]?.getBoundingClientRect() ?? new DOMRect(),
    panel = part(card, '.forecast').getBoundingClientRect();
  expect(box.width / ZOOM).toBeCloseTo(hours.scrollWidth, -1);
  expect(box.height / ZOOM).toBeCloseTo(38.1, 1);
  expect(box.bottom).toBeCloseTo(panel.bottom, 0);
  expect(hours.scrollWidth, 'it adds nothing to what scrolls').toBeLessThanOrEqual(Math.ceil(box.width / ZOOM) + 1);
  expect(hours.querySelector('.wind-dot')).toBeNull();
  const speed = part(card, '.wind-value b'),
    unit = part(card, '.wind-value small');
  expect([getComputedStyle(speed).fontSize, getComputedStyle(speed).fontWeight]).toEqual(['16.25px', '600']);
  expect([getComputedStyle(unit).fontSize, getComputedStyle(unit).fontWeight]).toEqual(['12.5px', '500']);
  expect(getComputedStyle(unit).color).toBe(getComputedStyle(speed).color);
  const sun = part(card, '.hour[data-sun]');
  expect(sun.querySelector('.hour-symbol svg')).toBeTruthy();
  expect(sun.querySelector('.wind-value')).toBeNull();
});

test('a sun’s label rides on the line, where the chart stops short of it', async () => {
  const card = page();
  await ready(card);
  await show(card, 'wind');
  await frames(2);
  const value = part(card, '.hour[data-sun] .hour-value'),
    style = getComputedStyle(value);
  expect([style.fontSize, style.fontWeight]).toEqual(['13.75px', '500']);
  expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  const hole = card.root.querySelector('#strip-pills path')?.getAttribute('d') ?? '',
    [, x, y] = hole.match(/ZM([\d.]+) ([\d.]+)h/) ?? [],
    box = value.getBoundingClientRect(),
    chart = part(card, '.hours').querySelector('.wind-chart')?.getBoundingClientRect() ?? new DOMRect();
  expect((box.left - chart.left) / ZOOM + 6.4).toBeCloseTo(Number(x), 0);
  expect((box.bottom - chart.top) / ZOOM).toBeCloseTo(Number(y) + 12.8, 0);
});

test('the chart is redrawn for columns that have moved, not for a hair of anything else', async () => {
  const card = page();
  await ready(card);
  await show(card, 'wind');
  await frames(2);
  const drawn = part(card, '.hours').querySelector('.wind-chart');
  card.render();
  expect(part(card, '.hours').querySelector('.wind-chart'), 'a render with nothing new').toBe(drawn);
  expect(card.forecastPanel.moved()).toBe(false);
  part(card, '.hours').style.gap = '20px';
  expect(card.forecastPanel.moved()).toBe(true);
  // A resize that leaves the page's layout as it was still finds the columns gone from under it.
  card.style.width = '1320px';
  await vi.waitFor(() => {
    expect(part(card, '.hours').querySelector('.wind-chart')).not.toBe(drawn);
  });
  expect(card.forecastPanel.moved()).toBe(false);
});

test('a card out of sight draws its marks when it shows', async () => {
  const card = page();
  await ready(card);
  await show(card, 'wind');
  await frames(2);
  card.style.display = 'none';
  card.hass = hassOf({ hours: hoursOf(30, i => ({ wind_speed: 9 + i })) });
  await vi.waitFor(() => {
    expect(card.root.querySelector('.wind-chart')).toBeNull();
  });
  card.style.display = 'block';
  await vi.waitFor(() => {
    expect(card.root.querySelector('.wind-chart')?.getBoundingClientRect().width).toBeGreaterThan(0);
  });
});

test('wind with no wind leaves its columns and rules, with nothing to fall over', async () => {
  const hours = hoursOf(30).map(({ wind_speed: _speed, wind_gust_speed: _gust, ...hour }) => hour),
    card = page({ hours, attributes: { wind_speed: undefined } });
  await ready(card);
  await show(card, 'wind');
  await frames(2);
  expect(part(card, '.wind-chart').querySelector('path[stroke="#ffffff4d"]')).toBeTruthy();
  expect(part(card, '.modes [data-mode=wind]').getAttribute('aria-pressed')).toBe('true');
});

test('without sun.sun a bar’s tint still goes by the sun', async () => {
  const card = page({ sun: false, hours: hoursOf(30, () => ({ precipitation_probability: 10 })) });
  await ready(card);
  await show(card, 'rain');
  const nights = [...card.root.querySelectorAll<HTMLElement>('.hour')].map(hour => hour.dataset['night']);
  // At half past five in Chicago, before the sun: dark, and then light as the day comes.
  expect(nights[0]).toBe('true');
  expect(nights).toContain('false');
  expect(nights.indexOf('false')).toBeGreaterThan(1);
});

test('today’s dot on a day’s wind chart is plain white, with no ring', async () => {
  const card = page();
  await ready(card);
  await show(card, 'wind');
  const dot = await vi.waitFor(() => part(card, '.wind-dot')),
    style = getComputedStyle(dot);
  expect(style.borderTopWidth).toBe('0px');
  expect(style.backgroundColor).toBe('rgb(255, 255, 255)');
  expect(parseFloat(style.width)).toBeCloseTo(7.3, 1);
});

test('pinned, the large heading gives way to the small one, with the switch left out of both', async () => {
  const card = page();
  card.style.height = '600px';
  await ready(card);
  await vi.waitFor(() => {
    expect(part(card, '.weather').dataset['scroll']).toBe('true');
  });
  await frames(2);
  const scroller = part(card, '.weather-content'),
    large = part(card, '.heading'),
    small = part(card, '.pinned-heading'),
    [largeLift, smallLift] = card.root.querySelectorAll<HTMLElement>('.forecast-content > .lift'),
    { hero, pinned } = card.pageScroll.measure(),
    panel = card.pageScroll.measure().panels.find(item => item.panel === card.parts.forecast);
  if (!panel || !largeLift || !smallLift) throw new Error('No panel.');
  expect(panel.top).toBeGreaterThanOrEqual(hero - pinned);
  // Scroll positions land on whole screen pixels, and the page's height on whole px in its own
  // scale, so each ramp is checked from where the page landed, to within a pixel of it.
  const ramp = (value: number) => Math.max(0, Math.min(1, value)),
    within1 = 1 / 6.25;
  for (const asked of [0, 4, 8, 10, 12.5, 14, 16, 18, 21, 40]) {
    scroller.scrollTop = panel.top - pinned + asked;
    await frames(3);
    const past = scroller.scrollTop - (panel.top - pinned);
    expect(Math.abs(Number(getComputedStyle(large).opacity) - ramp((12.5 - past) / 6.25)), `${past}`).toBeLessThan(
      within1,
    );
    expect(Math.abs(Number(getComputedStyle(small).opacity) - ramp((past - 13.75) / 6.25)), `${past}`).toBeLessThan(
      within1,
    );
    expect(Math.min(Number(getComputedStyle(large).opacity), Number(getComputedStyle(small).opacity))).toBe(0);
  }
  // The lifts go with them, and each is carried with the header.
  expect(Number(getComputedStyle(smallLift).opacity)).toBeCloseTo(1, 1);
  expect(Number(getComputedStyle(largeLift).opacity)).toBeCloseTo(0, 1);
  // Scrolled by the browser, these all run on the page's scroll: none is stepped by a script.
  for (const node of [large, small, smallLift, largeLift, part(card, '.forecast-header')])
    expect(node.getAnimations().every(animation => animation.timeline instanceof ScrollTimeline)).toBe(true);
  expect(part(card, '.modes').getAnimations()).toEqual([]);
  // The switch still works there, and the small heading says the same in every view.
  await show(card, 'wind');
  expect(within(small, 'span').textContent).toBe('Hourly forecast');
  expect(getComputedStyle(small).textTransform).toBe('uppercase');
});

test('both headings stay put as the panel goes on under the band', async () => {
  const card = page();
  card.style.height = '600px';
  await ready(card);
  await vi.waitFor(() => {
    expect(part(card, '.weather').dataset['scroll']).toBe('true');
  });
  await frames(2);
  const scroller = part(card, '.weather-content'),
    { pinned, panels } = card.pageScroll.measure(),
    panel = panels.find(item => item.panel === card.parts.forecast);
  if (!panel) throw new Error('No panel.');
  const place = async (past: number) => {
    scroller.scrollTop = panel.top - pinned + past;
    await frames(3);
    return ['.pinned-heading', '.heading', '.modes'].map(selector => part(card, selector).getBoundingClientRect().top);
  };
  const near = await place(25),
    far = await place(70);
  near.forEach((top, index) => {
    expect(far[index]).toBeCloseTo(top, 0);
  });
});
