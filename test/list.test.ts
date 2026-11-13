import assert from 'node:assert/strict';
import { test } from 'vitest';
import { normalizeConfig } from '../src/card/config.ts';
import type { ForecastEntry, HomeAssistant } from '../src/card/home-assistant.ts';
import { workOut, type UpdateSources } from '../src/card/update.ts';
import { rainPlot, windPlot } from '../src/cards/forecast/day-chart.ts';
import { dailyDetail, dayChance, type DaySegment, dayRain, placeInDay } from '../src/cards/forecast/day-detail.ts';
import { dailyItems, type DailyItem, forecasts, restOfDay } from '../src/weather/forecast-items.ts';
import { weatherText } from '../src/weather/i18n.ts';

const HOUR = 3_600_000,
  ZONE = 'America/Chicago',
  // Where the sun's times below are worked out.
  PLACE = { latitude: 38.63, longitude: -90.2 },
  FALL_BACK = Date.UTC(2026, 10, 1, 17),
  SPRING_FORWARD = Date.UTC(2026, 2, 8, 17),
  // Monday 2 November 2026, in Chicago.
  ORDINARY = Date.UTC(2026, 10, 2, 18),
  MIDNIGHT = Date.UTC(2026, 10, 2, 6);
const dayAt = (time: number) => ({ time, today: false });
const hoursFrom = (start: number, count: number, entry: (index: number) => ForecastEntry = () => ({})) =>
  Array.from({ length: count }, (_, i) => ({
    datetime: new Date(start + i * HOUR).toISOString(),
    ...entry(i),
  }));
const detailOf = (hours: readonly ForecastEntry[], time = ORDINARY, today = false) => {
  const [detail] = dailyDetail(hours, [{ time, today }], ZONE, PLACE).values();
  if (!detail) throw new Error('No day.');
  return detail;
};
const segment = (over: Partial<DaySegment> = {}): DaySegment => ({
  day: false,
  amount: null,
  chance: null,
  speed: null,
  gust: null,
  ...over,
});
const item = (over: Partial<DailyItem> = {}): DailyItem => ({
  time: ORDINARY,
  high: 70,
  low: 50,
  today: false,
  sky: { condition: 'cloudy', night: false },
  ...over,
});

// --- A day cut in two-hour stretches -----------------------------------------------------
test('a day has a segment for every two hours gone by the clock, and the odd hour of a changed day', () => {
  const count = (time: number) => detailOf([], time).segments.length;
  assert.equal(count(ORDINARY), 12);
  assert.equal(count(FALL_BACK), 13);
  assert.equal(count(SPRING_FORWARD), 11);
});
test('the hour a clock repeats falls in its own place, not in with the one before', () => {
  // Midnight to 1 AM, the 1 AM that runs twice, then 2 AM: 1 hour apart, each in order.
  const midnight = Date.UTC(2026, 10, 1, 5),
    hours = hoursFrom(midnight, 25, i => ({ precipitation: i })),
    { segments } = detailOf(hours, FALL_BACK);
  assert.deepEqual(
    segments.map(({ amount }) => amount),
    [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 24],
    'the last stands alone',
  );
});
test('a day that skips an hour puts the odd one in with the last', () => {
  const midnight = Date.UTC(2026, 2, 8, 6),
    hours = hoursFrom(midnight, 23, i => ({ precipitation: i })),
    { segments } = detailOf(hours, SPRING_FORWARD);
  assert.deepEqual(
    segments.map(({ amount }) => amount),
    [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 22],
  );
});
test('a segment holds the most of each reading among its hours, its chance among them', () => {
  const hours = hoursFrom(MIDNIGHT, 3, i => ({
      precipitation: [0.1, 0.3, 0.2][i] ?? 0,
      precipitation_probability: [20, 60, 10][i] ?? 0,
      wind_speed: [4, 9, 7][i] ?? 0,
      wind_gust_speed: [5, 12, 8][i] ?? 0,
    })),
    { segments, chance, total } = detailOf(hours),
    [first, second] = segments;
  assert.deepEqual(first, { day: false, amount: 0.3, chance: 60, speed: 9, gust: 12 });
  assert.deepEqual(second, { day: false, amount: 0.2, chance: 10, speed: 7, gust: 8 });
  assert.equal(chance, 60);
  assert.ok(Math.abs(total - 0.6) < 1e-9);
});
test('a missing reading stays missing, in a segment and across a day', () => {
  const { segments, chance } = detailOf(hoursFrom(MIDNIGHT, 24, () => ({ precipitation: 0, wind_speed: 4 })));
  assert.ok(segments.every(each => each.amount === 0 && each.chance === null && each.gust === null));
  assert.equal(chance, null);
});
test('a gust is never drawn under the wind, though an hour without one holds the wind’s most', () => {
  const [first] = detailOf(
    hoursFrom(MIDNIGHT, 2, i => ({ wind_speed: i ? 10 : 4, ...(i ? {} : { wind_gust_speed: 6 }) })),
  ).segments;
  assert.equal(first?.gust, 10);
});

// --- Day and night -----------------------------------------------------------------------
test('a segment is day only with the sun up all the way through it', () => {
  // Sunrise about 6:30 and sunset about 5:00 in Chicago time, by the standard clock of this date.
  const lit = detailOf([]).segments.flatMap(({ day }, index) => (day ? [index * 2] : []));
  assert.deepEqual(lit, [8, 10, 12, 14], 'the stretch the sun rises in and the one it sets in are dark');
});
test('each day goes by its own sun, whatever the entries say', () => {
  const lit = (hours: readonly ForecastEntry[], time: number) =>
    detailOf(hours, time).segments.flatMap(({ day }, index) => (day ? [index] : []));
  const june = Date.UTC(2026, 5, 21, 17);
  assert.equal(lit([], june).length, 7, 'a long day');
  assert.deepEqual(
    lit(
      hoursFrom(MIDNIGHT, 24, () => ({ is_daytime: true })),
      ORDINARY,
    ),
    lit([], ORDINARY),
    'not by is_daytime',
  );
});
test('the clock-change days count their segments by the time gone, and their sun with them', () => {
  // On the day the clocks go back the same sun comes an hour earlier on the clock; two hours gone
  // by the clock are the same moments either way.
  const lit = (time: number) => detailOf([], time).segments.flatMap(({ day }, index) => (day ? [index] : []));
  assert.deepEqual(lit(FALL_BACK), [4, 5, 6, 7, 8]);
  assert.deepEqual(lit(SPRING_FORWARD), [4, 5, 6, 7, 8]);
});
test('with no place the sun is up from six to six', () => {
  const [detail] = dailyDetail([], [dayAt(ORDINARY)], ZONE).values(),
    lit = detail?.segments.flatMap(({ day }, index) => (day ? [index] : []));
  assert.deepEqual(lit, [3, 4, 5, 6, 7, 8]);
});
test('where the sun never sets or never rises, every segment is the same', () => {
  const north = { latitude: 78, longitude: 15 },
    all = (time: number) => {
      const [detail] = dailyDetail([], [dayAt(time)], 'UTC', north).values();
      return detail?.segments.map(({ day }) => day);
    };
  assert.ok(all(Date.UTC(2026, 5, 21, 12))?.every(Boolean));
  assert.ok(all(Date.UTC(2026, 11, 21, 12))?.every(day => !day));
});
test('a day with no hours still has its segments and tint, and nothing else', () => {
  const { segments, range, chance, total } = detailOf([]);
  assert.equal(segments.length, 12);
  assert.ok(segments.some(({ day }) => day));
  assert.ok(segments.every(({ amount, speed }) => amount === null && speed === null));
  assert.equal(range, null);
  assert.equal(chance, null);
  assert.equal(total, 0);
});

// --- The wind's range --------------------------------------------------------------------
test('a day’s range is the low and high of its hours, and a partial day has none, but for today', () => {
  const speeds = [7, 3, 12, 5];
  const hours = (count: number) => hoursFrom(MIDNIGHT, count, i => ({ wind_speed: speeds[i % 4] ?? 0 }));
  assert.deepEqual(detailOf(hours(24)).range, [3, 12]);
  assert.equal(detailOf(hours(11)).range, null);
  assert.deepEqual(detailOf(hours(2), ORDINARY, true).range, [3, 7], 'today holds what is left of it');
});
test('now comes along the segments by the time gone, and stops at the last', () => {
  const at = (hours: number) => placeInDay(MIDNIGHT + hours * HOUR, ZONE);
  assert.equal(at(0), 0);
  assert.equal(at(15), 7.5);
  assert.equal(at(23.5), 11, 'the line ends at the last segment');
  assert.equal(placeInDay(Date.UTC(2026, 10, 2, 5, 30), ZONE), 12, 'a day of 25 hours has 13 segments');
  assert.equal(placeInDay(Date.UTC(2026, 2, 9, 4), ZONE), 10, 'a day of 23 hours has 11 segments');
});

// --- Today's rest of the day -------------------------------------------------------------
const NOW = MIDNIGHT + 13.5 * HOUR,
  timed = (entries: readonly ForecastEntry[]) => forecasts(entries);
test('what is left of today runs from the hour under way to midnight', () => {
  const hours = timed(
    hoursFrom(MIDNIGHT, 30, i => ({
      condition: 'cloudy',
      // The worst of the day came this morning, and tomorrow is worse again.
      precipitation_probability: i < 13 ? 90 : i < 24 ? (i === 13 ? 25 : 40) : 100,
    })),
  );
  assert.equal(restOfDay(hours, NOW, ZONE).chance, 40);
  assert.equal(restOfDay(hours, NOW, ZONE).condition, undefined, 'nothing wet is left');
});
test('its condition is the wettest left, and the hour it comes from', () => {
  const conditions = ['sunny', 'rainy', 'cloudy', 'pouring', 'rainy'],
    hours = timed(hoursFrom(MIDNIGHT + 13 * HOUR, 5, i => ({ condition: conditions[i] ?? '' }))),
    { condition, hour } = restOfDay(hours, NOW, ZONE);
  assert.equal(condition, 'pouring');
  assert.equal(hour?.time, MIDNIGHT + 16 * HOUR);
  const later = timed(hoursFrom(MIDNIGHT + 13 * HOUR, 3, i => ({ condition: ['rainy', 'snowy', 'pouring'][i] ?? '' })));
  assert.equal(restOfDay(later, NOW, ZONE).condition, 'snowy', 'what is frozen goes before what is heavy');
});
test('with no hours left there is no rest of the day to go by', () => {
  assert.deepEqual(restOfDay([], NOW, ZONE), {});
});
const daysOf = (hours: readonly ForecastEntry[], condition: string, entry: ForecastEntry = {}) => {
  const config = normalizeConfig({ type: 'custom:iweather-card', entity: 'weather.home' }),
    hass: HomeAssistant = {
      states: {
        'weather.home': { entity_id: 'weather.home', state: condition, attributes: {} },
        'sun.sun': { entity_id: 'sun.sun', state: 'above_horizon', attributes: {} },
      },
      config: { time_zone: ZONE },
    },
    daily: ForecastEntry[] = [
      { datetime: new Date(ORDINARY).toISOString(), condition: 'sunny', temperature: 60, ...entry },
      { datetime: new Date(ORDINARY + 24 * HOUR).toISOString(), condition: 'rainy', precipitation_probability: 70 },
    ],
    sources: UpdateSources = {
      config,
      hass,
      data: { hourly: { status: 'ready', forecast: hours }, daily: { status: 'ready', forecast: daily } },
      supplied: false,
      prefersDark: false,
      awaited: false,
      nowcast: undefined,
      timeZone: ZONE,
      text: () => weatherText('en'),
      mode: undefined,
      narrow: false,
      id: 'card',
      records: {
        earlier: undefined,
        recent: undefined,
        lastDay: undefined,
        airYesterday: undefined,
        recentRain: undefined,
        climate: undefined,
      },
      now: NOW,
    };
  return workOut(sources).days;
};
test('today’s row reads the rest of the day, its symbol and chance alike, and later rows their own', () => {
  const days = daysOf(
      hoursFrom(MIDNIGHT + 13 * HOUR, 6, i => ({
        condition: i === 4 ? 'rainy' : 'cloudy',
        precipitation_probability: i === 4 ? 60 : 10,
      })),
      'cloudy',
      { precipitation_probability: 95 },
    ),
    today = days.at(0),
    tomorrow = days.at(1);
  assert.ok(today && tomorrow);
  assert.equal(today.sky.condition, 'rainy');
  assert.equal(today.chance, 60, 'the worst hour left, not the whole day’s 95%');
  assert.equal(today.precipitation_probability, 95, 'the forecast’s own stays as it came');
  assert.equal(tomorrow.chance, 70);
});
test('with nothing wet left today keeps the weather now, and shows no chance by its condition', () => {
  const today = daysOf(
    hoursFrom(MIDNIGHT + 13 * HOUR, 6, () => ({ condition: 'cloudy', precipitation_probability: 30 })),
    'partlycloudy',
  ).at(0);
  assert.ok(today);
  assert.equal(today.sky.condition, 'partlycloudy');
  assert.equal(today.chance, 30);
});
test('with no hours today falls back to the whole day’s chance', () => {
  const today = daysOf([], 'cloudy', { precipitation_probability: 45 }).at(0);
  assert.ok(today);
  assert.equal(today.chance, 45);
  assert.equal(today.sky.condition, 'cloudy');
});
test('a chance is missing when nothing gives one', () => {
  const today = dailyItems([{ datetime: new Date(NOW).toISOString() }], NOW, ZONE, {}).at(0);
  assert.ok(today);
  assert.equal(today.chance, undefined);
  assert.equal(dayChance(today, undefined), null);
});

// --- What a rain row says ----------------------------------------------------------------
const hoursOfRain = (amount: number, chance?: number) =>
  detailOf(
    hoursFrom(MIDNIGHT, 24, () => ({
      precipitation: amount,
      ...(chance === undefined ? {} : { precipitation_probability: chance }),
    })),
  );
test('a wet day with an amount shows its drop at any chance', () => {
  const wet = item({ sky: { condition: 'rainy', night: false } });
  assert.equal(dayRain(wet, hoursOfRain(0.02, 5)).drop, true);
});
test('a likely day shows its drop even with nothing to measure', () => {
  assert.equal(dayRain(item({ chance: 30 }), hoursOfRain(0)).drop, true, 'a cloudy 30% at 0″');
  assert.equal(dayRain(item({ chance: 8 }), hoursOfRain(0)).drop, true, 'a chance that rounds to 10');
});
test('an unlikely day has a bare chance', () => {
  assert.equal(dayRain(item({ chance: 5 }), hoursOfRain(0)).drop, false);
  assert.equal(dayRain(item({ chance: 0 }), hoursOfRain(0)).drop, false);
  assert.equal(
    dayRain(item({ chance: 5, sky: { condition: 'rainy', night: false } }), hoursOfRain(0)).drop,
    false,
    'wet, but with no amount',
  );
});
test('a chance comes from the day’s forecast, else from the most of its hours', () => {
  assert.equal(dayRain(item({ chance: 40 }), hoursOfRain(0, 90)).chance, 40);
  assert.equal(dayRain(item(), hoursOfRain(0, 90)).chance, 90);
  assert.equal(dayRain(item(), hoursOfRain(0)).chance, null, 'none to give');
});
test('a day’s total comes from its hours when they cover half of it, else from its forecast', () => {
  const forecast = item({ precipitation: 0.7 }),
    half = detailOf(hoursFrom(MIDNIGHT, 12, () => ({ precipitation: 0.01 }))),
    few = detailOf(hoursFrom(MIDNIGHT, 4, () => ({ precipitation: 0.01 })));
  assert.ok(Math.abs((dayRain(forecast, half).total ?? 0) - 0.12) < 1e-9);
  assert.equal(dayRain(forecast, few).total, 0.7);
  assert.equal(dayRain(forecast, detailOf([])).total, 0.7);
});

// --- The charts --------------------------------------------------------------------------
const lefts = (markup: string) => [...markup.matchAll(/class="segment" style="left:([\d.]+)%/g)].map(m => Number(m[1]));
test('bars stand end to end of the plot, the end ones overhanging it by half their width', () => {
  const markup = rainPlot(
      Array.from({ length: 12 }, () => segment()),
      [],
      null,
    ),
    places = lefts(markup),
    box = 132.5;
  assert.equal(places.length, 12);
  assert.equal(places[0], 0);
  assert.ok(Math.abs((places.at(-1) ?? 0) - (125 / box) * 100) < 0.01);
  assert.ok(Math.abs((places[1] ?? 0) - (125 / 11 / box) * 100) < 0.01, 'a pitch of 125 / 11 px');
  assert.ok(markup.includes(`width:${((7.5 / box) * 100).toFixed(2)}%`));
});
test('thirteen bars close up to fit', () => {
  const places = lefts(
    rainPlot(
      Array.from({ length: 13 }, () => segment()),
      [],
      null,
    ),
  );
  assert.ok(Math.abs((places[1] ?? 0) - (125 / 12 / 132.5) * 100) < 0.01);
});
test('a bar’s fill is its share of the plot, and an empty bar has none', () => {
  const markup = rainPlot([segment(), segment({ amount: 1 }), segment()], [0, 0.5, 0], null);
  assert.equal([...markup.matchAll(/<span style="height:/g)].length, 1);
  assert.ok(markup.includes('height:50.0%'));
});
test('only the bar now is in is outlined, dry or not', () => {
  const twelve = Array.from({ length: 12 }, () => segment()),
    markup = rainPlot(twelve, [0, 0, 0, 0.5, 0.5], 3);
  assert.equal([...markup.matchAll(/data-now="true"/g)].length, 1);
  assert.equal(lefts(markup.slice(0, markup.indexOf('data-now'))).at(-1), lefts(markup)[3]);
  assert.equal([...rainPlot(twelve, [], 3).matchAll(/data-now="true"/g)].length, 1, 'a dry bar now is outlined too');
  assert.ok(!rainPlot([segment(), segment()], [0.5, 0.5], null).includes('data-now'));
});
test('the day’s bars take added light and the night’s black', () => {
  const markup = rainPlot([segment({ day: true }), segment()], [], null);
  // Each day bar is lifted by a box of its own, where the bar stands, not cut to a clip in shares.
  assert.equal([...markup.matchAll(/<i class="lift"/g)].length, 1);
  assert.ok(markup.includes('inset:0 auto 0 0.00%;width:5.66%;border-radius:2.5px'));
  assert.ok(!markup.includes('clip-path'));
  assert.equal([...markup.matchAll(/<g fill="#00000014"><rect/g)].length, 1);
});
const winds = (speeds: readonly (number | null)[], gust?: number) =>
  speeds.map(speed => segment(speed === null ? {} : { speed, ...(gust === undefined ? {} : { gust: speed + gust }) }));
const pathsOf = (markup: string) => [...markup.matchAll(/<path d="([^"]+)"([^>]*)\/>/g)];
const lines = (markup: string) => pathsOf(markup).filter(([, , rest]) => rest?.includes('stroke='));
const heightAt = (d: string, index: number) => Number(d.split(/[ML]/).filter(Boolean)[index]?.split(' ')[1]);
test('each row scales alone: a calm day fills its box as a windy one does', () => {
  // Their tops are the next multiple of five above the most each day reaches.
  const calm = windPlot('a', winds([4, 5, 4]), null, 'mph'),
    windy = windPlot('a', winds([40, 50, 40]), null, 'mph');
  const [[, calmLine = ''] = []] = lines(calm),
    [[, windyLine = ''] = []] = lines(windy);
  assert.equal(heightAt(calmLine, 1), 0, 'the top of its own scale');
  assert.equal(heightAt(windyLine, 1), 0);
  assert.equal(calmLine, windyLine);
});
test('a day’s scale takes in its gusts, and goes by twos in metres a second', () => {
  const [[, d = ''] = []] = lines(windPlot('a', winds([5, 5], 3), null, 'mph')),
    [[, metres = ''] = []] = lines(windPlot('a', winds([3, 3], 0), null, 'm/s'));
  assert.equal(heightAt(d, 0), 30 * (1 - 5 / 10), 'to 8, so 10');
  assert.equal(heightAt(metres, 0), 30 * (1 - 3 / 4));
});
test('the line is straight, and runs from one end of the plot to the other', () => {
  const [[, d = ''] = []] = lines(windPlot('a', winds([1, 2, 3, 4]), null, 'mph'));
  assert.ok(!d.includes('C'));
  assert.equal(d.split('L').length, 4);
  assert.ok(d.startsWith('M0 '));
  assert.ok(d.includes('L125 '));
});
test('a day’s line is solid, and today’s dashes before now with a dot where it comes', () => {
  const speeds = winds([4, 8, 8, 8, 4, 4]);
  assert.deepEqual(
    lines(windPlot('a', speeds, null, 'mph')).map(([, , rest]) => rest?.includes('dasharray')),
    [false],
  );
  const today = windPlot('a', speeds, 2.5, 'mph');
  assert.deepEqual(
    lines(today).map(([, , rest]) => rest?.includes('stroke-dasharray="7.5 7.5"')),
    [true, false],
  );
  assert.equal([...today.matchAll(/class="wind-dot" style="left:50.0%;bottom:80.0%"/g)].length, 1, 'at 8 of 10');
});
test('without hours from before now the line starts at now, with no dashes', () => {
  const today = windPlot('a', winds([null, null, 8, 8, 4, 4]), 2.5, 'mph'),
    found = lines(today);
  assert.equal(found.length, 1);
  assert.ok(!found[0]?.[2]?.includes('dasharray'));
  assert.ok(found[0]?.[1]?.startsWith('M62.5 '), 'at now, not at the start of its segment');
});
test('the gust band stands between the wind and the gust, in the scale’s colours at 30%', () => {
  const markup = windPlot('a', winds([4, 4], 4), null, 'mph'),
    band = pathsOf(markup).find(([, , rest]) => rest?.includes('fill-opacity'));
  assert.ok(band?.[2]?.includes('fill="url(#wind-a)" fill-opacity="0.3"'));
  assert.equal(band?.[1], 'M0 6L125 6L125 18L0 18Z');
  assert.ok(!markup.includes('wind-dot') || markup.indexOf('wind-dot') < markup.indexOf('fill-opacity'));
});
test('without gusts there is no band, and the scale comes from the wind alone', () => {
  const markup = windPlot('a', winds([3, 3]), null, 'mph');
  assert.ok(!markup.includes('fill-opacity="0.3"'));
  const [[, d = ''] = []] = lines(markup);
  assert.equal(heightAt(d, 0), 30 * (1 - 3 / 5));
});
test('a gap in the hours breaks the line, and a stretch of one is drawn by neither', () => {
  const found = lines(windPlot('a', winds([4, 4, null, 4, null, 4, 4]), null, 'mph'));
  assert.equal(found.length, 3, 'one run is a single point, which a path shows nothing of');
});
test('the tint stands in whole stretches, so nothing shows at a join', () => {
  const days = [false, false, true, true, true, false].map(day => segment({ day })),
    markup = windPlot('a', days, null, 'mph');
  assert.equal([...markup.matchAll(/<i class="lift"/g)].length, 1);
  assert.ok(markup.includes('inset:0 auto 0 33.33%;width:50.00%;border-radius:0 0 0 0'));
  assert.ok(markup.includes('<rect x="0.3333" width="0.5" height="1"'));
  assert.equal([...markup.matchAll(/<g fill="#00000014">(.*?)<\/g>/g)][0]?.[1]?.split('<rect').length, 3);
  // A stretch at an end of the plot rounds that end's corners alone.
  const evening = windPlot(
    'a',
    [false, true, true].map(day => segment({ day })),
    null,
    'mph',
  );
  assert.ok(evening.includes('inset:0 auto 0 33.33%;width:66.67%;border-radius:0 2.5px 2.5px 0'));
});
