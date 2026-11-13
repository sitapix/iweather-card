import { afterEach, expect, test, vi } from 'vitest';
import { page as frame } from 'vitest/browser';
import '../src/iweather-card.ts';
import type { ForecastSubscription, HomeAssistant } from '../src/card/home-assistant.ts';
import type { IWeatherCard } from '../src/iweather-card.ts';
import { sunEvents } from '../src/sky/sun.ts';

// The sheets with an order of their own: sun, moon and air quality, as the styles draw them.
// Lengths are the sheet's own px, which a standard card draws at .8. The sun's day and night are
// a Saturday in St. Louis at 2 PM and at 1 AM.
const ZOOM = 0.8,
  HOUR = 3_600_000,
  AT_NIGHT = Date.parse('2026-10-31T06:01:00Z'),
  BY_DAY = Date.parse('2026-10-31T19:00:00Z'),
  PLACE = { latitude: 38.63, longitude: -90.2 };
const hassWith = (extra: Partial<HomeAssistant> = {}): HomeAssistant => {
  const now = Date.now(),
    hourly = Array.from({ length: 48 }, (_, i) => ({
      datetime: new Date(now + i * HOUR).toISOString(),
      temperature: 60,
      condition: 'cloudy',
      wind_speed: 4,
    })),
    daily = Array.from({ length: 10 }, (_, i) => ({
      datetime: new Date(now + i * 24 * HOUR).toISOString(),
      temperature: 66,
      templow: 50,
      condition: 'cloudy',
    }));
  return {
    states: {
      'weather.home': {
        entity_id: 'weather.home',
        state: 'cloudy',
        attributes: { temperature: 62, temperature_unit: '°F', friendly_name: 'St. Louis', supported_features: 3 },
      },
      'sun.sun': {
        entity_id: 'sun.sun',
        state: 'above_horizon',
        attributes: {
          next_rising: new Date(now + 18 * HOUR).toISOString(),
          next_setting: new Date(now + 6 * HOUR).toISOString(),
          next_noon: new Date(now + 2 * HOUR).toISOString(),
        },
      },
      ...extra.states,
    },
    entities: extra.entities ?? {},
    locale: { language: 'en', time_format: '12' },
    config: { location_name: 'Home', time_zone: 'America/Chicago', ...PLACE },
    connection: {
      subscribeMessage(callback: (message: unknown) => void, message: ForecastSubscription) {
        queueMicrotask(() => {
          callback({ forecast: message.forecast_type === 'hourly' ? hourly : daily });
        });
        return Promise.resolve(() => undefined);
      },
    },
  };
};
async function page(now: number, extra: Partial<HomeAssistant> = {}, config: object = {}): Promise<IWeatherCard> {
  vi.useFakeTimers({ toFake: ['Date'], now });
  const card = document.createElement('iweather-card');
  card.style.cssText = 'display:block;width:1100px';
  card.setConfig({
    type: 'custom:iweather-card',
    entity: 'weather.home',
    weather_layout: 'page',
    open_meteo_forecast: false,
    weather_animation: false,
    map: 'none',
    ...config,
  });
  card.hass = hassWith(extra);
  document.body.replaceChildren(card);
  await vi.waitFor(() => {
    expect(card.root.querySelector('.tile[data-tile=moon]')).toBeTruthy();
  });
  return card;
}
function part(card: IWeatherCard, selector: string): HTMLElement {
  const node = card.root.querySelector(`dialog[open] ${selector}`);
  if (!(node instanceof HTMLElement)) throw new Error(`No ${selector}.`);
  return node;
}
const svgPart = (card: IWeatherCard, selector: string): Element => {
  const node = card.root.querySelector(`dialog[open] ${selector}`);
  if (!node) throw new Error(`No ${selector}.`);
  return node;
};
function open(card: IWeatherCard, tile: string) {
  const pressed = card.root.querySelector<HTMLElement>(`.tile[data-tile=${tile}]`);
  if (!pressed) throw new Error(`No ${tile} tile.`);
  pressed.scrollIntoView({ block: 'center' });
  pressed.click();
  for (const animation of part(card, '.sheet').getAnimations()) animation.finish();
}
const box = (card: IWeatherCard, selector: string) => part(card, selector).getBoundingClientRect();
const across = (card: IWeatherCard, selector: string) => box(card, selector).width / ZOOM;
const down = (card: IWeatherCard, selector: string) => box(card, selector).height / ZOOM;
const look = (card: IWeatherCard, selector: string, pseudo?: string) => getComputedStyle(part(card, selector), pseudo);

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

test('at rest the sun’s reading is at the left, its day period smaller than its digits', async () => {
  const card = await page(AT_NIGHT);
  open(card, 'sun');
  expect(part(card, '.sheet>header h2').textContent).toBe('Sunrise');
  expect(box(card, '.detail-headline').left).toBeCloseTo(box(card, '.sun-chart').left, 1);
  const digits = look(card, '.detail-headline'),
    period = look(card, '.detail-headline small'),
    sub = look(card, '.detail-sub');
  expect([digits.fontSize, digits.fontWeight]).toEqual(['32.5px', '500']);
  expect([period.fontSize, period.fontWeight]).toEqual(['25px', '500']);
  expect([sub.fontSize, sub.fontWeight, sub.color]).toEqual(['13.75px', '500', 'rgba(255, 255, 255, 0.55)']);
  // Nothing but the time and the daylight.
  expect(part(card, '.detail-time').textContent).toBe('');
  card.remove();
});

test('the sun’s chart is read at any minute, and a finger ticks only as it passes into another hour', async () => {
  const card = await page(AT_NIGHT, {}, { haptics: 'all' });
  open(card, 'sun');
  const plot = part(card, '.chart-plot'),
    { left, top, width } = plot.getBoundingClientRect(),
    finger = { pointerType: 'touch', pointerId: 3, isPrimary: true },
    // A pointer over the minute of the day, of the 24 hours the chart spans.
    at = (minute: number, type = 'pointermove', more: PointerEventInit = {}) =>
      plot.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          composed: true,
          pointerType: 'mouse',
          clientX: left + (width * minute) / (24 * 60),
          clientY: top + 20,
          ...more,
        }),
      ),
    time = () => part(card, '.detail-headline').textContent;
  at(12 * 60 + 7);
  expect(time()).toBe('12:07PM');
  at(12 * 60 + 9);
  expect(time()).toBe('12:09PM');
  at(12 * 60 + 9, 'pointerout');
  let ticks = 0;
  card.addEventListener('haptic', () => ticks++);
  plot.setPointerCapture = () => undefined;
  at(10 * 60 + 30, 'pointerdown', finger);
  for (let minute = 10 * 60 + 32; minute <= 15 * 60 + 30; minute += 2) at(minute, 'pointermove', finger);
  expect(time()).toBe('3:30PM');
  // One as it lands, and one at each of 11, 12, 1, 2 and 3.
  expect(ticks).toBe(6);
  at(15 * 60 + 30, 'pointerup', finger);
  card.remove();
});

test('read, the sun’s reading shows the phase and time over the line, and goes back after', async () => {
  const card = await page(AT_NIGHT);
  open(card, 'sun');
  const plot = part(card, '.chart-plot'),
    { left, top, width } = plot.getBoundingClientRect(),
    resting = part(card, '.detail-headline').textContent;
  plot.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      pointerType: 'mouse',
      clientX: left + width / 2,
      clientY: top + 20,
    }),
  );
  expect(part(card, '.detail-time').textContent).toBe('Day');
  expect(part(card, '.detail-headline').textContent).toMatch(/^12:0\dPM$/);
  expect(part(card, '.detail-sub').textContent).toMatch(/^Sunset: 6HR/);
  const reading = part(card, '.detail-reading');
  expect('scrubbing' in reading.dataset).toBe(true);
  const middle = box(card, '.detail-headline');
  expect(middle.left + middle.width / 2).toBeCloseTo(left + width / 2, 0);
  plot.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }));
  expect(part(card, '.detail-headline').textContent).toBe(resting);
  expect(part(card, '.detail-time').textContent).toBe('');
  card.remove();
});

test('the sun’s chart is framed whole, its horizon a little past half way down', async () => {
  const card = await page(AT_NIGHT);
  open(card, 'sun');
  expect(across(card, '.sun-chart')).toBeCloseTo(375, 0);
  expect(down(card, '.sun-chart')).toBeCloseTo(300, 0);
  expect(down(card, '.chart-plot')).toBeCloseTo(266.25, 0);
  const frame = look(card, '.sun-chart', '::before');
  expect(frame.borderTopLeftRadius).toBe('10px');
  // Rows follow what the chart's own frame leaves.
  const chart = box(card, '.sun-chart'),
    plot = box(card, '.chart-plot');
  expect((box(card, '.sun-rows').top - chart.bottom) / ZOOM).toBeCloseTo(12.5, 0);
  const horizon = svgPart(card, '.horizon').getBoundingClientRect(),
    style = getComputedStyle(svgPart(card, '.horizon'));
  expect((horizon.top - plot.top) / ZOOM).toBeCloseTo(139, 0);
  expect(style.stroke).toBe('rgb(80, 80, 95)');
  expect(style.strokeWidth).toBe('3.75px');
  const curve = getComputedStyle(svgPart(card, '.sun-curve'));
  expect([curve.strokeWidth, curve.strokeLinecap]).toEqual(['5px', 'butt']);
  expect(across(card, '.sun-twilight')).toBeCloseTo(5, 1);
  card.remove();
});

test('the sun’s sky is the cloud’s, at half by night with a ringed dark sun, and at four fifths by day with a bright one', async () => {
  const night = await page(AT_NIGHT);
  open(night, 'sun');
  expect(look(night, '.sun-sky').backgroundImage).toContain('linear-gradient');
  expect(look(night, '.sun-sky').opacity).toBe('0.5');
  expect(down(night, '.sun-sky')).toBeCloseTo(138.8, 0);
  expect(look(night, '.sun-marker[data-side=night]').getPropertyValue('--night-sun')).toBe(
    '#363636 9.75px,#fff 10.25px 11px,#fff0 11.5px',
  );
  // The tile's Sun under the horizon is solid black with no ring, whatever lies behind it.
  const tileSun = night.root.querySelector('.tile[data-tile=sun] .sun-night');
  if (!tileSun) throw new Error('No tile sun.');
  expect(getComputedStyle(tileSun).backgroundImage).toContain('rgb(0, 0, 0) 6.07px');
  expect(getComputedStyle(tileSun).backgroundImage).not.toContain('rgb(255, 255, 255)');
  night.remove();
  vi.useRealTimers();
  const day = await page(BY_DAY);
  open(day, 'sun');
  expect(part(day, '.sheet>header h2').textContent).toBe('Sunset');
  expect(look(day, '.sun-sky').backgroundImage).toContain('linear-gradient');
  expect(look(day, '.sun-sky').opacity).toBe('0.8');
  expect(look(day, '.sun-marker[data-side=day]').backgroundImage).toContain('radial-gradient');
  expect(look(day, '.sun-marker[data-side=day]').getPropertyValue('--day-sun')).toContain('#fff 11.75px');
  day.remove();
});

// Still on screen: `node`'s box the same two frames running, as on a busy page the sheet may still
// be settling when it is first looked at.
const still = (node: Element) =>
  vi.waitFor(
    async () => {
      const before = node.getBoundingClientRect();
      await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
      const after = node.getBoundingClientRect();
      expect([after.x, after.y, after.width, after.height]).toEqual([before.x, before.y, before.width, before.height]);
    },
    { timeout: 5000 },
  );
// As the Sun sets it is drawn in two parts, cut at the horizon: the day's white disc above the
// line and the night's dark one below it, ringed in white.
test('a sun crossing the horizon is white above the line and dark below it', async () => {
  const sunset = sunEvents(BY_DAY, PLACE.latitude, PLACE.longitude).sunset;
  if (sunset === null) throw new Error('No sunset.');
  const card = await page(sunset);
  open(card, 'sun');
  const plot = part(card, '.chart-plot');
  await still(plot);
  const marker = part(card, '.sun-marker[data-side=day]'),
    at = (name: string) => Number.parseFloat(marker.style.getPropertyValue(name)),
    shot = await frame.screenshot({ element: plot, base64: true, save: false }),
    image = new Image();
  image.src = `data:image/png;base64,${shot}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas.');
  context.drawImage(image, 0, 0);
  // From the plot's box on screen to the shot's pixels, at the Sun's place across.
  const box = plot.getBoundingClientRect(),
    scale = image.width / box.width,
    x = at('--x') * box.width * scale,
    horizon = (at('--h') / 100) * box.height * scale,
    grey = (offset: number) => context.getImageData(Math.round(x), Math.round(horizon + offset * scale), 1, 1).data[0];
  // Four px either side of the line, clear of its stroke and inside both discs.
  expect(grey(-4)).toBeGreaterThan(240);
  expect(grey(4)).toBeLessThan(120);
  card.remove();
});

test('from the foot, the sun’s lines add their light a px wide, its dots add grey, and its hours are dimmer', async () => {
  const card = await page(BY_DAY, {}, { sheet_style: 'sheet' });
  open(card, 'sun');
  expect(getComputedStyle(svgPart(card, '.sun-grid')).mixBlendMode).toBe('plus-lighter');
  const grid = getComputedStyle(svgPart(card, '.sun-grid .grid'));
  expect([grid.stroke, grid.strokeWidth]).toEqual(['rgb(37, 37, 38)', '1px']);
  const hour = look(card, '.chart-hour');
  expect(hour.mixBlendMode).toBe('plus-lighter');
  expect(Number.parseFloat(hour.width)).toBeCloseTo(1, 1);
  expect(hour.backgroundImage).toContain('2px');
  expect(look(card, '.chart-hour[data-last]').backgroundColor).toBe('rgb(37, 37, 38)');
  expect(['0', '1', '2'].map(step => look(card, `.sun-twilight[data-step="${step}"]`).backgroundColor)).toEqual([
    'rgb(128, 128, 128)',
    'rgb(89, 89, 89)',
    'rgb(51, 51, 51)',
  ]);
  expect(look(card, '.sun-twilight').mixBlendMode).toBe('plus-lighter');
  for (const label of card.root.querySelectorAll('dialog[open] .sun-chart .chart-x span'))
    expect(getComputedStyle(label).color).toBe('rgba(235, 235, 245, 0.68)');
  const frame = look(card, '.sun-chart', '::before');
  expect(look(card, '.sun-marker[data-side=day]').getPropertyValue('--day-sun')).toContain('#fff 9.4px');
  expect(look(card, '.sun-marker[data-side=night]').getPropertyValue('--night-sun')).toContain('#363636 7.75px');
  // Half a px, which a screen of whole device pixels may round up.
  expect(Number.parseFloat(frame.borderTopWidth)).toBeLessThan(1);
  expect([frame.borderTopColor, frame.borderBottomWidth]).toEqual(['rgba(255, 255, 255, 0.14)', '0px']);
  card.remove();
});

test('a month’s daylight is a cyan bar in a dark capsule', async () => {
  const card = await page(AT_NIGHT);
  open(card, 'sun');
  expect(look(card, '.sun-span').backgroundColor).toBe('rgba(0, 0, 0, 0.2)');
  expect(look(card, '.sun-span i').backgroundColor).toBe('rgb(60, 211, 254)');
  expect(look(card, '.sun-span').borderRadius).toBe('2.5px');
  card.remove();
});

test('the moon’s strip has a day in 84, the marker on the hour now is in', async () => {
  const card = await page(AT_NIGHT);
  open(card, 'moon');
  const scroller = part(card, '.moon-scroll');
  expect(scroller.scrollLeft).toBeCloseTo(Number(scroller.dataset['origin']), 0);
  const days = [...card.root.querySelectorAll<HTMLElement>('dialog[open] .moon-track span')],
    today = days.findIndex(day => day.dataset['today'] !== undefined),
    [first, second] = days.slice(today - 2).map(day => parseFloat(day.style.left));
  expect((second ?? 0) - (first ?? 0)).toBeCloseTo(84, 1);
  const ticks = getComputedStyle(svgPart(card, '.moon-ticks')),
    midnight = getComputedStyle(svgPart(card, '.moon-ticks [data-midnight]'));
  expect(parseFloat(ticks.height)).toBeCloseTo(25.6, 1);
  expect([ticks.strokeWidth, ticks.strokeLinecap]).toEqual(['2px', 'round']);
  expect(ticks.stroke).toBe('rgba(128, 128, 128, 0.5)');
  expect(midnight.stroke).toBe('rgb(255, 255, 255)');
  const marker = svgPart(card, '.moon-marker');
  expect(marker.getBoundingClientRect().width / ZOOM).toBeCloseTo(12.5, 1);
  expect(getComputedStyle(marker).fill).toBe('rgb(60, 211, 254)');
  const label = look(card, '.moon-track span'),
    named = look(card, '.moon-track [data-today]');
  expect([label.fontSize, label.fontWeight, label.color]).toEqual(['13.75px', '400', 'rgb(255, 255, 255)']);
  expect([named.fontSize, named.fontWeight, named.color]).toEqual(['13.75px', '600', 'rgb(255, 255, 255)']);
  card.remove();
});

test('a dot keeps now’s place on the moon’s strip once the marker has moved off it', async () => {
  const card = await page(AT_NIGHT);
  open(card, 'moon');
  const origin = Number(part(card, '.moon-scroll').dataset['origin']);
  expect(part(card, '.moon-here').hidden).toBe(true);
  part(card, '.moon-scroll').scrollLeft = origin + 21;
  await vi.waitFor(() => {
    expect(part(card, '.moon-here').hidden).toBe(false);
  });
  expect(across(card, '.moon-here')).toBeCloseTo(4, 1);
  expect(look(card, '.moon-here').backgroundColor).toBe('rgb(60, 211, 254)');
  const dot = box(card, '.moon-here'),
    timeline = box(card, '.moon-timeline');
  // 21 px is six hours, and now has gone that way off the marker.
  expect((timeline.left + timeline.width / 2 - (dot.left + dot.width / 2)) / ZOOM).toBeCloseTo(21, 0);
  part(card, '.moon-scroll').scrollLeft = origin;
  await vi.waitFor(() => {
    expect(part(card, '.moon-here').hidden).toBe(true);
  });
  card.remove();
});

test('the moon’s calendar has columns 53.75 apart and rows 55, with the date strip’s chevrons', async () => {
  const card = await page(AT_NIGHT);
  open(card, 'moon');
  const days = [...card.root.querySelectorAll<HTMLElement>('dialog[open] .moon-grid button')],
    [first, second] = days,
    eighth = days[7];
  if (!first || !second || !eighth) throw new Error('No days.');
  const at = (day: HTMLElement) => day.getBoundingClientRect();
  expect((at(second).left - at(first).left) / ZOOM).toBeCloseTo(53.75, 1);
  expect((at(eighth).top - at(first).top) / ZOOM).toBeCloseTo(55, 1);
  // Each day's moon is 25 across, its top 3.75 under the number's line.
  const moon = first.querySelector('canvas'),
    number = first.querySelector('b');
  if (!moon || !number) throw new Error('No moon.');
  expect(at(moon).width / ZOOM).toBeCloseTo(25, 1);
  expect((at(moon).top - at(number).bottom) / ZOOM).toBeCloseTo(3.75, 1);
  const chevron = part(card, '.moon-month button'),
    arrow = chevron.querySelector('svg');
  expect(getComputedStyle(chevron).color).toBe('rgba(255, 255, 255, 0.85)');
  expect(arrow?.getBoundingClientRect().width).toBeCloseTo(7.5 * ZOOM, 1);
  expect(arrow?.getBoundingClientRect().height).toBeCloseTo(13.75 * ZOOM, 1);
  // Weekends read second to the days between them, and today is cyan.
  expect(getComputedStyle(first.querySelector('b') ?? first).color).toBe('rgba(255, 255, 255, 0.85)');
  expect(look(card, '.moon-grid>:nth-child(7) b').color).toBe('rgba(255, 255, 255, 0.55)');
  expect(look(card, '.moon-grid [aria-current] b').color).toBe('rgb(60, 211, 254)');
  card.remove();
});

test('a press on the moon’s strip shows no ring, and a keyboard’s goes round the timeline', async () => {
  const card = await page(AT_NIGHT);
  open(card, 'moon');
  const scroller = part(card, '.moon-scroll');
  expect(look(card, '.moon-scroll').outlineStyle).toBe('none');
  scroller.focus();
  expect(getComputedStyle(scroller).outlineStyle).toBe('none');
  card.remove();
});

test('a sheet that takes over from the moon’s within a frame of its opening leaves it be', async () => {
  const faults: unknown[] = [],
    note = (event: ErrorEvent) => {
      faults.push(event.error);
      event.preventDefault();
    };
  addEventListener('error', note);
  const card = await page(AT_NIGHT);
  open(card, 'moon');
  // The strip has scrolled, so its moon is due to be drawn in the coming frame, by which time the
  // sheet holds something else.
  part(card, '.moon-scroll').scrollLeft += 35;
  part(card, '.moon-scroll').dispatchEvent(new Event('scroll'));
  card.sheets.open('uv', part(card, '.sheet'));
  expect(card.root.querySelector('dialog[open] .moon-hero')).toBe(null);
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  removeEventListener('error', note);
  expect(faults).toEqual([]);
  card.remove();
});

const AIR: Partial<HomeAssistant> = {
  states: {
    'sensor.aqi': {
      entity_id: 'sensor.aqi',
      state: '63',
      attributes: { device_class: 'aqi', attribution: 'Data from a sample station' },
    },
    'sensor.pm25': {
      entity_id: 'sensor.pm25',
      state: '15',
      attributes: { device_class: 'pm25', unit_of_measurement: 'µg/m³' },
    },
    'sensor.ozone': {
      entity_id: 'sensor.ozone',
      state: '26',
      attributes: { device_class: 'ozone', unit_of_measurement: 'ppb' },
    },
  },
  entities: {
    'sensor.aqi': { device_id: 'air' },
    'sensor.pm25': { device_id: 'air' },
    'sensor.ozone': { device_id: 'air' },
  },
};

test('air quality reads its level alone, with smaller headings and closer rows', async () => {
  const card = await page(AT_NIGHT, AIR, { air_quality_entity: 'sensor.aqi' });
  open(card, 'air_quality');
  const level = look(card, '.detail-headline'),
    heading = look(card, '.detail-compare h3');
  expect(part(card, '.detail-headline').textContent).toBe('Moderate');
  expect([level.fontSize, level.fontWeight]).toEqual(['21.25px', '600']);
  expect([heading.fontSize, heading.fontWeight]).toEqual(['18.75px', '600']);
  const [first, second] = card.root.querySelectorAll('dialog[open] .sheet-rows>div');
  if (!first || !second) throw new Error('No rows.');
  expect((second.getBoundingClientRect().top - first.getBoundingClientRect().top) / ZOOM).toBeCloseTo(36.25, 1);
  // A rule stays centred between them.
  expect(parseFloat(getComputedStyle(second, '::before').top)).toBeCloseTo(-(16.25 + 1.25) / 2, 1);
  // The digits of a pollutant sit low and small.
  const digit = look(card, '.sheet-rows sub');
  expect(parseFloat(digit.fontSize)).toBeLessThan(parseFloat(look(card, '.sheet-rows dt').fontSize) * 0.7);
  expect(look(card, '.detail-source p').fontSize).toBe('12.5px');
  // Under the sentence, the whole width.
  expect(across(card, '.scale')).toBeCloseTo(375, 0);
  expect(box(card, '.scale').top).toBeGreaterThan(box(card, '.detail-text').bottom);
  card.remove();
});

test('from the foot, air quality’s headings and the name of its reading are 17 px semibold, in line with each other', async () => {
  const card = await page(AT_NIGHT, AIR, { air_quality_entity: 'sensor.aqi', sheet_style: 'sheet' });
  open(card, 'air_quality');
  const level = look(card, '.sheet>.detail-headline'),
    heading = look(card, '.detail-compare h3');
  expect([level.fontSize, level.fontWeight, level.lineHeight]).toEqual(['17px', '600', '22px']);
  expect([heading.fontSize, heading.fontWeight, heading.lineHeight]).toEqual(['17px', '600', '22px']);
  expect(look(card, '.sheet>.detail-sub').fontSize).toBe('12px');
  // The name's words start where the headings' do.
  const words = (selector: string) => {
    const range = document.createRange();
    range.selectNodeContents(part(card, selector));
    return range.getBoundingClientRect().left;
  };
  expect(words('.sheet>.detail-headline')).toBeCloseTo(words('.detail-compare h3'), 0);
  // Its scale is 4 px thick, and the dot on it as thick.
  const thick = (selector: string) =>
    box(card, selector).height / (box(card, '.sheet').width / part(card, '.sheet').offsetWidth);
  expect(thick('.scale')).toBeCloseTo(4, 1);
  expect(thick('.scale i')).toBeCloseTo(4, 1);
  card.remove();
});

test('the calendar’s moons are white light, a full one bright and a new one a faint disc', async () => {
  const card = await page(AT_NIGHT);
  open(card, 'moon');
  const day = (phase: string) => part(card, `.moon-grid canvas[data-phase="${phase}"]`);
  const full = day('0.5000'),
    dark = day('0.0000');
  await vi.waitFor(() => {
    expect(full.dataset['drawn']).toMatch(/:calendar$/u);
    expect(dark.dataset['drawn']).toMatch(/:calendar$/u);
  });
  // Every pixel is white, as much of it as the photograph's tone, so the glass shows through
  // as a screen would let it. Mean tones across the disc, of 255.
  const tones = (canvas: HTMLElement) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('No canvas.');
    const { data } = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height) ?? { data: [] },
      alphas: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      if (!(data[i + 3] ?? 0)) continue;
      expect([data[i], data[i + 1], data[i + 2]]).toEqual([255, 255, 255]);
      alphas.push(data[i + 3] ?? 0);
    }
    return alphas.reduce((sum, alpha) => sum + alpha, 0) / alphas.length;
  };
  expect(tones(full)).toBeGreaterThan(110);
  expect(tones(dark)).toBeGreaterThan(5);
  expect(tones(dark)).toBeLessThan(25);
  card.remove();
});

test('the moon is drawn at the size it ends up, though the sheet opens from next to nothing', async () => {
  const card = await page(AT_NIGHT);
  card.root.querySelector<HTMLElement>('.tile[data-tile=moon]')?.click();
  const disc = part(card, '.moon-disc');
  await vi.waitFor(() => {
    expect(disc.dataset['drawn']).toBeTruthy();
  });
  expect(part(card, '.sheet').getAnimations().length).toBeGreaterThan(0);
  expect(disc instanceof HTMLCanvasElement ? disc.width : 0).toBe(
    Math.round(disc.offsetWidth * disc.currentCSSZoom * devicePixelRatio),
  );
  card.remove();
});

test('the moon tile’s title lifts the symbol’s dark part on its own, as faintly as it is drawn', async () => {
  const card = await page(AT_NIGHT),
    tile = card.root.querySelector('.tile[data-tile=moon]');
  if (!tile) throw new Error('No moon tile.');
  const lifts = [...tile.querySelectorAll<HTMLElement>('.tile-content > .lift')],
    clips = [...tile.querySelectorAll('header .title clipPath')],
    marks = [...tile.querySelectorAll('header .title > g')];
  expect(lifts.map(lift => lift.style.getPropertyValue('--lift'))).toEqual(['1.333', '1.067']);
  expect(marks.map(mark => mark.getAttribute('fill-opacity'))).toEqual(['0.250', '0.063']);
  // The title's clip holds the words and the disc with the dark part cut from it; the other, the
  // dark part, at full strength, as a clip knows nothing of opacity.
  const [title, dark] = clips;
  expect(title?.querySelectorAll('text')).toHaveLength(1);
  expect(title?.querySelectorAll('path')).toHaveLength(1);
  expect(dark?.querySelectorAll('path')).toHaveLength(1);
  expect(dark?.querySelector('[opacity]')).toBeNull();
  const disc = title?.querySelector('path')?.getAttribute('d') ?? '',
    cut = dark?.querySelector('path')?.getAttribute('d') ?? '';
  expect(cut).not.toBe('');
  expect(disc.endsWith(cut)).toBe(true);
  // Both stand where the title is.
  expect(lifts[1]?.getBoundingClientRect().toJSON()).toEqual(lifts[0]?.getBoundingClientRect().toJSON());
  card.remove();
});
