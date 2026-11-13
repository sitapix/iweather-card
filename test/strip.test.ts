import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  rainLabels,
  rainMarks,
  type StripFrame,
  windChart,
  type WindSeries,
  windSeries,
  windTop,
} from '../src/cards/forecast/strip-chart.ts';
import { hourNight, rainReading, type HourlyRows } from '../src/cards/forecast/rows.ts';
import { forecastItems, withSunEvents, type StripItem } from '../src/weather/forecast-items.ts';
import { PRECIPITATION_GLYPHS } from '../src/weather/icons.ts';
import { weatherText } from '../src/weather/i18n.ts';

const HOUR = 3_600_000,
  NOW = Date.UTC(2026, 9, 31, 5, 16),
  START = Date.UTC(2026, 9, 31, 5),
  HEIGHT = 38.1;
const hour = (at: number, speed: number, gust?: number) => ({
  datetime: new Date(at).toISOString(),
  wind_speed: speed,
  ...(gust === undefined ? {} : { wind_gust_speed: gust }),
});
// Columns of `pitch`, some wider, each with a label on the chart if it's a sun's.
const frameOf = (widths: readonly number[], labels: readonly number[] = [], height = 116.875): StripFrame => {
  let left = 0.625;
  const columns = widths.map((width, index) => {
    const column = {
      left,
      width,
      bar: null,
      value: labels.includes(index) ? { left, top: 0, width: 62, height: 13 } : null,
    };
    left += width + 10;
    return column;
  });
  return { width: left - 10 + 0.625, height, columns };
};
const series = (over: Partial<WindSeries> = {}): WindSeries => ({
  points: [
    { time: START, speed: 4, gust: 12 },
    { time: START + HOUR, speed: 8, gust: 16 },
  ],
  from: START,
  span: 24 * HOUR,
  top: 20,
  now: null,
  unit: 'mph',
  ...over,
});
// The numbers of a path's corners.
const corners = (d: string) =>
  [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map(([, x, y]): [number, number] => [Number(x), Number(y)]);
const lineOf = (chart: string, dashed = false) => {
  const found = chart.match(
    new RegExp(
      `<path d="M([^"]+)" fill="none" stroke="url\\(#strip-wind\\)"[^>]*linejoin="round"${dashed ? ' stroke-dasharray="7.5 7.5"' : ''}/>`,
    ),
  );
  return found?.[1] ?? '';
};

test('a wind chart tops out at the next round number for its unit, and never under its highest reading', () => {
  assert.equal(windTop(14, 'mph'), 15);
  assert.equal(windTop(15, 'mph'), 15);
  assert.equal(windTop(16, 'km/h'), 20);
  assert.equal(windTop(13.2, 'm/s'), 14);
  assert.equal(windTop(14, 'm/s'), 14);
  assert.equal(windTop(4, 'kn'), 5);
  assert.equal(windTop(0, 'mph'), 5, 'a calm day still has a scale');
  assert.equal(windTop(0, 'm/s'), 2);
  assert.equal(windTop(4, 'bft'), 5, 'a force is a step of its own');
  assert.equal(windTop(12, 'Beaufort'), 12);
});

test('the chart runs on the clock, so that a sun column adds width and no hours', () => {
  const twoSuns = frameOf(Array.from({ length: 26 }, () => 55)),
    { chart } = windChart(series(), twoSuns),
    [a, b] = corners(lineOf(chart));
  assert.ok(a && b);
  // Twenty-six columns of 65 for twenty-four hours: 70.4 px an hour, the hour under way 13 px along.
  assert.equal(a[0], 13);
  assert.ok(Math.abs(b[0] - a[0] - 70.4) < 0.1);
});

test('the chart reads up from four under nothing to its top', () => {
  const { chart } = windChart(series(), frameOf(Array.from({ length: 24 }, () => 55))),
    [a] = corners(lineOf(chart)),
    band = chart.match(/<path d="([^"]+)" fill="url\(#strip-gust\)" fill-opacity="\.25"/)?.[1] ?? '';
  assert.equal(a?.[1], Number((HEIGHT * (1 - 8 / 24)).toFixed(2)), '4 of 20 is two thirds of the way down');
  // Between the speed and the gust, not to the floor.
  const [top] = corners(band);
  assert.equal(top?.[1], Number((HEIGHT * (1 - 16 / 24)).toFixed(2)));
  assert.ok(Math.max(...corners(band).map(([, y]) => y)) < HEIGHT);
});

test('without gusts there is no band, and the scale comes from the speed', () => {
  const entries = Array.from({ length: 4 }, (_, i) => hour(START + (i + 1) * HOUR, 8 + i)),
    items = entries.map((entry): StripItem => ({ ...entry, time: Date.parse(entry.datetime) })),
    wind = windSeries('hourly', items, { status: 'ready', forecast: entries }, 'mph', NOW);
  assert.equal(wind.top, 15, 'the top speed, 11, rounds up to a five');
  assert.ok(wind.points.every(point => point.gust === null));
  assert.doesNotMatch(windChart(wind, frameOf([55, 55, 55, 55])).chart, /fill-opacity="\.25"/);
});

test('a strip’s scale is its own hours’, though the line runs on past them', () => {
  const entries = [
      hour(START, 3, 40),
      hour(START + HOUR, 4, 11),
      hour(START + 2 * HOUR, 5, 12),
      hour(START + 3 * HOUR, 6, 90),
    ],
    items = forecastItems(entries, 'hourly', { state: 'cloudy', attributes: { wind_speed: 3 } }, NOW, 3),
    wind = windSeries('hourly', items, { status: 'ready', forecast: entries }, 'mph', NOW);
  assert.equal(wind.top, 40, 'the hour after the strip doesn’t count, and the hour under way does');
  assert.equal(wind.points.at(-1)?.time, START + 3 * HOUR, 'the line goes one hour past the end');
  assert.equal(wind.from, START, 'the hour under way starts the chart');
  assert.equal(wind.span, 3 * HOUR);
});

test('before now the line is dashed and goes back an hour past the strip, or starts at the hour under way without one', () => {
  const entries = [hour(START, 5, 9), hour(START + HOUR, 6, 10), hour(START + 2 * HOUR, 7, 11)],
    earlier = [hour(START - HOUR, 3, 6)],
    state = { state: 'cloudy', attributes: { wind_speed: 4 } },
    items = forecastItems(entries, 'hourly', state, NOW, 3),
    held = windSeries('hourly', items, { status: 'ready', forecast: entries, earlier }, 'mph', NOW),
    frame = frameOf([55, 55, 55]),
    { chart } = windChart(held, frame);
  assert.equal(held.points[0]?.time, START - HOUR);
  assert.equal(held.now, START, 'now stands at the start of the hour under way');
  // The hour under way reads what the card reads now, in place of its forecast.
  assert.deepEqual(
    held.points.filter(point => point.time === START),
    [{ time: START, speed: 4, gust: 9 }],
  );
  // Now is on both, and the dashes run back from it.
  const past = corners(lineOf(chart, true)),
    coming = corners(lineOf(chart));
  assert.equal(past.length, 2);
  assert.deepEqual(past[0], coming[0]);
  assert.match(chart, /<circle r="5" fill="#1c1c1e"\/><circle r="2\.5" fill="#fff"\/>/);
  // Past the hours it has, a forecast from now has nothing to dash.
  const fresh = entries.slice(1),
    from = windSeries(
      'hourly',
      forecastItems(fresh, 'hourly', state, NOW, 2),
      { status: 'ready', forecast: fresh },
      'mph',
      NOW,
    ),
    drawn = windChart(from, frame).chart;
  assert.equal(from.points[0]?.time, START);
  assert.equal(lineOf(drawn, true), '');
  assert.notEqual(lineOf(drawn), '');
});

test('now’s dot stands where the hour under way starts, whatever the minute, reading what the card reads now', () => {
  const entries = [hour(START, 6), hour(START + HOUR, 8), hour(START + 2 * HOUR, 7)],
    state = { state: 'cloudy', attributes: { wind_speed: 4 } },
    frame = frameOf(Array.from({ length: 3 }, () => 55)),
    dotAt = (now: number, over: Partial<StripFrame> = {}) => {
      const wind = windSeries(
          'hourly',
          forecastItems(entries, 'hourly', state, now, 3),
          { status: 'ready', forecast: entries },
          'mph',
          now,
        ),
        [, x, y] = windChart(wind, { ...frame, ...over }).chart.match(/translate\(([\d.]+) ([\d.]+)\)/) ?? [];
      return [Number(x), Number(y)];
    };
  // 4 on a scale from four under nothing to 10.
  assert.deepEqual(dotAt(NOW), [13, Number((HEIGHT * (1 - 8 / 14)).toFixed(2))]);
  assert.deepEqual(dotAt(START + 50 * 60_000), dotAt(NOW), 'later in the hour it stays');
  // On a phone the hour under way starts 38.5 px in.
  assert.equal(dotAt(NOW, { look: 'phone' })[0], 38.5);
});

test('on a phone nothing stands 3.7 px over the foot and the top 32.4, and the line, its dashes, the dot and what lies under it are drawn to its size', () => {
  const entries = [hour(START - HOUR, 2), hour(START, 5), hour(START + HOUR, 10), hour(START + 2 * HOUR, 0)],
    state = { state: 'cloudy', attributes: { wind_speed: 5 } },
    items = forecastItems(entries.slice(1), 'hourly', state, NOW, 3),
    wind = windSeries(
      'hourly',
      items,
      { status: 'ready', forecast: entries.slice(1), earlier: entries.slice(0, 1) },
      'mph',
      NOW,
    ),
    { chart } = windChart(wind, { ...frameOf([55, 55, 55]), look: 'phone' }),
    ys = new Map(corners(lineOf(chart)).map(([x, y]) => [x, y]));
  assert.equal(wind.top, 10);
  assert.match(chart, /style="width:[\d.]+px;height:32\.4px"/);
  // At 0, 3.7 px over the foot; at 10, the top; at 5, halfway between.
  assert.deepEqual([...ys.values()], [Number((32.4 - 3.7 - 28.7 / 2).toFixed(2)), 0, 28.7]);
  assert.match(chart, /stroke-width="4\.6"/);
  assert.notEqual(lineOf(chart.replace('7 7', '7.5 7.5'), true), '', 'dashes of 7 before now');
  assert.match(chart, /<circle r="4\.6" fill="#1c1c1e"\/><circle r="2\.3" fill="#fff"\/>/);
  assert.match(
    chart,
    /fill="url\(#strip-wind\)" fill-opacity="0\.35"\/><path d="[^"]+" fill="#000" fill-opacity="0\.1"\/>/,
  );
  // Elsewhere, as before.
  const wide = windChart(wind, frameOf([55, 55, 55])).chart;
  assert.match(wide, /fill-opacity="0\.2"\/><path d="[^"]+" fill="#000" fill-opacity="0\.05"\/>/);
  assert.match(wide, /style="width:[\d.]+px;height:38\.1px"/);
});

// A gradient in a chart: the readings at its two ends, on a scale from four under nothing to 20,
// and its stops.
const gradientOf = (chart: string, id: string) => {
  const [, ends = '', stops = ''] =
      chart.match(new RegExp(`<linearGradient id="${id}"([^>]*)>(.*?)</linearGradient>`)) ?? [],
    [, from, to] = ends.match(/y1="([\d.-]+)" y2="([\d.-]+)"/) ?? [],
    reading = (place: string | undefined) =>
      place === undefined ? null : Number(((1 - Number(place) / HEIGHT) * 24 - 4).toFixed(1));
  return {
    from: reading(from),
    to: reading(to),
    stops: [...stops.matchAll(/offset="([\d.]+)" stop-color="(#[\da-f]{6})"/g)].map(([, offset, colour]) => [
      Number(offset),
      colour,
    ]),
  };
};
// 8 mph is 1.21 of the way along the scale's eleven steps, and 16 mph 2.41.
const AT_8 = '#06c2b5',
  AT_16 = '#00b975';

test('the line goes from calm’s colour at its lowest to its highest speed’s colour', () => {
  const line = gradientOf(windChart(series(), frameOf([55, 55])).chart, 'strip-wind');
  assert.equal(line.from, 4);
  assert.equal(line.to, 8);
  // The second colour comes 1/11 of 73 mph up, at 6.6 mph, which is 0.83 of the way to 8.
  assert.deepEqual(line.stops, [
    [0, '#22b9d2'],
    [0.83, '#07c3c0'],
    [1, AT_8],
  ]);
});

test('the gust band goes from calm’s colour at the lowest speed under it to its highest gust’s colour', () => {
  const band = gradientOf(windChart(series(), frameOf([55, 55])).chart, 'strip-gust');
  assert.equal(band.from, 4);
  assert.equal(band.to, 16);
  assert.deepEqual(band.stops, [
    [0, '#22b9d2'],
    [0.41, '#07c3c0'],
    [0.83, '#00bc8b'],
    [1, AT_16],
  ]);
});

test('a level line is its speed’s one colour', () => {
  const flat = series({
    points: [
      { time: START, speed: 8, gust: null },
      { time: START + HOUR, speed: 8, gust: null },
    ],
  });
  assert.match(
    windChart(flat, frameOf([55, 55])).chart,
    new RegExp(`<linearGradient id="strip-wind"><stop offset="1" stop-color="${AT_8}"/></linearGradient>`),
  );
});

test('the wind’s colours keep to their speeds in the card’s units', () => {
  const ends = (unit: string, perMile: number) => {
    const { points } = series(),
      converted = points.map(point => ({ ...point, speed: point.speed * perMile, gust: (point.gust ?? 0) * perMile })),
      { chart } = windChart(series({ unit, points: converted }), frameOf([55, 55]));
    return [gradientOf(chart, 'strip-wind').stops.at(-1)?.[1], gradientOf(chart, 'strip-gust').stops.at(-1)?.[1]];
  };
  assert.deepEqual(ends('mph', 1), [AT_8, AT_16]);
  assert.deepEqual(ends('km/h', 1.609_344), [AT_8, AT_16]);
  assert.deepEqual(ends('m/s', 0.447_04), [AT_8, AT_16]);
});

test('a sun’s label cuts the chart where it rides on the line', () => {
  const frame = frameOf([55, 60, 55, 55], [1]),
    { chart, pills } = windChart(series({ span: 3 * HOUR }), frame);
  assert.deepEqual(
    pills.map(place => place !== null),
    [false, true, false, false],
  );
  assert.match(chart, /<clipPath id="strip-pills"><path clip-rule="evenodd"/);
  assert.match(chart, /<g clip-path="url\(#strip-pills\)">/);
  // Clear of any sun, nothing is cut.
  assert.doesNotMatch(windChart(series(), frameOf([55, 55])).chart, /clipPath/);
});

test('a rule stands in every gap between columns, sun columns or not', () => {
  const { chart } = windChart(series(), frameOf([55, 60, 55])),
    rules = chart.match(/<path d="([^"]+)" fill="none" stroke="#ffffff4d"/)?.[1] ?? '';
  assert.deepEqual(
    [...rules.matchAll(/M([\d.]+) /g)].map(([, x]) => Number(x)),
    [60.63, 130.63],
  );
  assert.match(chart, /stroke-width="1\.25" stroke-linecap="round" stroke-dasharray="5 5"/);
});

test('a strip of days plots its days, with no now among them', () => {
  const DAY = 24 * HOUR,
    entries = [0, 1, 2].map(i => hour(START + i * DAY, 5 + i)),
    items = entries.map((entry): StripItem => ({ ...entry, time: Date.parse(entry.datetime) })),
    wind = windSeries('daily', items, { status: 'ready', forecast: entries }, 'mph', NOW);
  assert.equal(wind.now, null);
  assert.equal(wind.span, 3 * DAY);
  assert.equal(wind.from, START);
  assert.notEqual(lineOf(windChart(wind, frameOf([55, 55, 55])).chart), '');
});

test('hours with no wind leave the chart to its rules', () => {
  const entries = [{ datetime: new Date(START + HOUR).toISOString() }],
    wind = windSeries('hourly', [{ time: START + HOUR }], { status: 'ready', forecast: entries }, 'mph', NOW),
    { chart } = windChart(wind, frameOf([55, 55]));
  assert.deepEqual(wind.points, []);
  assert.doesNotMatch(chart, /url\(#strip-wind\)"\s/);
  assert.match(chart, /stroke="#ffffff4d"/);
});

const bars = (night: readonly boolean[]) => {
  const frame = frameOf(night.map(() => 55)),
    box = { top: 25, width: 30, height: 51.25 };
  return {
    frame: {
      ...frame,
      columns: frame.columns.map(column => ({ ...column, bar: { ...box, left: column.left + 12.5 } })),
    },
    columns: night.map(dark => ({ night: dark, none: null })),
  };
};

test('a day’s tint, the level lines and the baseline all add their light', () => {
  const { frame, columns } = bars([true, false, false]),
    marks = rainMarks(frame, columns),
    tints = marks.match(/<clipPath id="tint-strip">(.*?)<\/clipPath>/)?.[1] ?? '';
  assert.equal(marks.match(/class="lift"/g)?.length, 3);
  assert.equal(tints.match(/<rect /g)?.length, 2, 'night bars have no tint of light');
  assert.match(tints, /width="30" height="51\.25" rx="7\.5"/);
  const rules = marks.match(/<clipPath id="rules-strip"><path d="([^"]+)"/)?.[1] ?? '',
    tops = [...rules.matchAll(/M[\d.]+ ([\d.]+)h/g)].map(([, y]) => Number(y));
  // 33% and 66% down the bar, eight dashes each across its 30 px.
  assert.equal(tops.filter(y => y === Number((25 + 51.25 * 0.33).toFixed(2))).length, 3 * 8);
  assert.equal(tops.filter(y => y === Number((25 + 51.25 * 0.66).toFixed(2))).length, 3 * 8);
  // And the baseline 4.375 px under the bars, across the whole of the strip, sun columns or not.
  const base = [...rules.matchAll(/M([\d.]+) 80\.63h2\.5/g)].map(([, x]) => Number(x));
  assert.equal(base[0], 0);
  assert.ok((base.at(-1) ?? 0) > frame.width - 5);
});

test('the labels name each third of a bar, heaviest at the top, and the row under the bars', () => {
  const { frame } = bars([true, false]),
    value = { left: 0, top: 86, width: 30, height: 13 },
    words = { levels: ['Heavy', 'Moderate', 'Light'], row: 'Chance' },
    labels = rainLabels({ ...frame, columns: frame.columns.map(column => ({ ...column, value })) }, words),
    clip = labels.match(/<clipPath id="labels-strip">(.*?)<\/clipPath>/)?.[1] ?? '',
    levels = [...clip.matchAll(/<text class="level" y="([\d.]+)">(\w+)</g)].map(([, y, word]) => [word, Number(y)]);
  assert.deepEqual(
    levels,
    [1, 3, 5].map((sixths, index) => [words.levels[index], Number((25 + (51.25 * sixths) / 6).toFixed(2))]),
  );
  assert.match(clip, /<text y="99">Chance</, 'on the row’s own baseline');
  // In what is second to a reading's light, over words that hold the longest's room.
  assert.match(labels, /<g fill="rgb\(255 255 255\)" fill-opacity="0\.550">/);
  assert.equal(labels.match(/<span>/g)?.length, 4);
});
test('there are no labels for a strip with no bars', () => {
  assert.equal(rainLabels(frameOf([55, 55]), { levels: ['Heavy'], row: 'Chance' }), '');
});

test('a column with nothing to fall has its words in added light, and a sun’s column has no bar', () => {
  const frame = frameOf([55, 55]),
    value = { left: 10, top: 86, width: 30, height: 13 },
    marks = rainMarks({ ...frame, columns: frame.columns.map(column => ({ ...column, value })) }, [
      { night: true, none: '0%' },
      null,
    ]);
  assert.equal(marks.match(/<text /g)?.length, 2, 'once to clip the lift, and once to draw');
  assert.match(marks, />0%<\/text>/);
});

const rows = (rain: HourlyRows['rain'], unit = 'in'): HourlyRows => ({
  mode: 'rain',
  t: weatherText('en'),
  locale: 'en',
  numbers: 'en',
  timeZone: 'UTC',
  attrs: { precipitation_unit: unit },
  fmt: String,
  type: 'hourly',
  rain,
  unit,
  night: false,
  hour12: undefined,
  named: condition => condition ?? '',
});

test('the row under a bar has a chance, or the amount without one, and never stands in for a reading', () => {
  const wet = { time: START, condition: 'rainy', precipitation: 0.1, precipitation_probability: 43 };
  assert.equal(rainReading(wet, rows('precipitation_probability')).text, '45%', 'to the nearest five');
  assert.equal(rainReading(wet, rows('precipitation')).text, '.1″');
  assert.equal(rainReading({ time: START }, rows('precipitation_probability')).text, '');
  assert.equal(rainReading({ time: START }, rows('precipitation')).text, '');
  assert.equal(
    rainReading({ time: START, precipitation_probability: 2 }, rows('precipitation_probability')).none,
    true,
  );
  assert.equal(
    rainReading({ time: START, precipitation_probability: 5 }, rows('precipitation_probability')).none,
    false,
  );
  assert.equal(rainReading({ time: START, precipitation: 0 }, rows('precipitation')).text, '0″');
  assert.equal(PRECIPITATION_GLYPHS.none, 'drop', 'a chance of nothing in particular is a chance of rain');
});

test('Now reads hour 0 where the entity has no reading, and the first hour where the forecast starts after now', () => {
  const after = START + HOUR,
    [now] = forecastItems(
      [
        {
          ...hour(after, 6, 11),
          temperature: 58,
          precipitation: 0.02,
          precipitation_probability: 30,
          condition: 'rainy',
        },
      ],
      'hourly',
      { state: 'cloudy', attributes: {} },
      NOW,
      4,
    );
  assert.ok(now);
  assert.equal(now.precipitation, 0.02);
  assert.equal(now.precipitation_probability, 30);
  assert.equal(now.temperature, 58);
  assert.equal(now.wind_speed, 6);
  assert.equal(now.condition, 'cloudy', 'the entity’s own word stands');
  // An hour later than that is no reading of now.
  const [alone] = forecastItems([hour(START + 3 * HOUR, 6)], 'hourly', { state: 'cloudy', attributes: {} }, NOW, 4);
  assert.ok(alone);
  assert.equal(alone.wind_speed, undefined);
});

test('without sun.sun the place alone says which hours are dark', () => {
  const place = { latitude: 38.63, longitude: -90.2 },
    // Central daylight time: 8 PM on the 30th to 7 PM on the 31st.
    items = Array.from({ length: 24 }, (_, i): StripItem => ({ time: Date.UTC(2026, 9, 31, 1 + i) })),
    [live] = [{ time: Date.UTC(2026, 9, 31, 1), now: true }],
    marked = withSunEvents([live, ...items.slice(1)], undefined, place),
    darkAt = (utc: number) => marked.find(item => item.time === Date.UTC(2026, 9, 31, utc))?.night;
  assert.equal(darkAt(1), true, 'now too, as nothing else can say');
  assert.equal(darkAt(9), true, '4 AM');
  assert.equal(darkAt(14), false, '9 AM');
  assert.equal(darkAt(22), false, '5 PM');
  assert.equal(darkAt(24), true, '7 PM');
  assert.ok(
    marked.every(item => !item.sun),
    'it marks the hours, and leaves the columns to sun.sun',
  );
  assert.ok(
    withSunEvents(items, undefined).every(item => item.night === undefined),
    'nowhere, nothing is said',
  );
});

test('with sun.sun it is for the sky to say whether now is dark', () => {
  const place = { latitude: 38.63, longitude: -90.2 },
    sun = { attributes: { next_rising: '2026-10-31T12:30:00Z', next_setting: '2026-10-31T23:10:00Z' } },
    marked = withSunEvents(
      [
        { time: Date.UTC(2026, 9, 31, 1), now: true },
        { time: Date.UTC(2026, 9, 31, 2) },
        { time: Date.UTC(2026, 9, 31, 3) },
      ],
      sun,
      place,
    );
  assert.equal(marked[0]?.night, undefined);
  assert.equal(marked[1]?.night, true);
});

test('an hour is dark by when it falls, whatever its forecast calls it', () => {
  const hour = (night: boolean | undefined, condition = 'clear-night'): StripItem => ({
    time: 0,
    condition,
    ...(night === undefined ? {} : { night }),
  });
  assert.equal(hourNight(hour(false), true), false, 'clear in daylight is day, named once for all its hours');
  assert.equal(hourNight(hour(true, 'sunny'), false), true, 'sunny after dark is night');
  assert.equal(hourNight(hour(undefined), false), true, 'with nothing to tell the time by, the name stands');
  assert.equal(hourNight({ time: 0, is_daytime: false }, false), true, 'as does what the entry says of itself');
  assert.equal(hourNight({ time: 0, now: true }, true), true, 'now goes by the weather now');
});
