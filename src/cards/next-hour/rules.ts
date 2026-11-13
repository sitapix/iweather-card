import { isRecord, isList, text, finite } from '../../lib/values.ts';
import { HOUR, MINUTES_PER_HOUR, MINUTE, fromUnix } from '../../lib/time.ts';
import { precipitationIntensity, INTENSITY_LEVELS, type PrecipitationSymbol } from '../../weather/precipitation.ts';
import {
  type WeatherCondition,
  type HomeAssistant,
  type EntityState,
  type ForecastEntry,
  inDomain,
  type EntityAttributes,
  isCondition,
} from '../../card/home-assistant.ts';
import type { CardConfig } from '../../card/config.ts';
import { UNITS } from '../../weather/units.ts';
import { phrase, say } from '../../weather/words.ts';

// --- Next-hour precipitation ------------------------------------------------
// Minute-by-minute readings for the coming hour, from a weather entity whose
// forecast steps under an hour (nowcast integrations), or a sensor that lists them
// in an attribute (Buienradar-style lists, Pirate Weather's minutely data).
export interface MinutePoint {
  time: number;
  value: number;
  step: number;
}

const LISTS = ['minutely', 'forecast', 'data', 'precipitation', 'nowcast'];

const TIMES = ['datetime', 'time', 'start', 'datetime_utc'];

// A numeric time below this is in seconds: in milliseconds it would be before 2001.
const SECONDS_BEFORE = 1e12;

const VALUES = ['precipitation', 'precipitation_intensity', 'precipIntensity', 'intensity', 'rain', 'value'];

// `source`: a list of readings, or an entity whose attributes hold one.
export function minutePoints(source: unknown, now: number): MinutePoint[] {
  const attributes = isRecord(source) ? source['attributes'] : undefined;
  const list = isList(source)
    ? source
    : (LISTS.map(key => (isRecord(attributes) ? attributes[key] : undefined)).find(isList) ?? []);
  const readings = new Map<number, Omit<MinutePoint, 'step'>>();
  for (const entry of list) {
    const field = (key: string) => (isRecord(entry) ? entry[key] : undefined);
    const raw = TIMES.map(field).find(value => value !== undefined),
      time = typeof raw === 'number' ? (raw < SECONDS_BEFORE ? fromUnix(raw) : raw) : Date.parse(text(raw) ? raw : '');
    const value = VALUES.map(field).find(finite);
    if (Number.isFinite(time) && finite(value)) readings.set(time, { time, value });
  }
  const points = [...readings.values()].sort((a, b) => a.time - b.time);
  // Only sub-hourly steps count; an hourly forecast says nothing about the next hour.
  let step = Infinity,
    previous: number | null = null;
  for (const point of points) {
    if (previous !== null) step = Math.min(step, point.time - previous);
    previous = point.time;
  }
  if (step >= HOUR) return [];
  // A last reading lasts for one step, not through every hour after the source stops updating.
  const last = points.at(-1);
  if (!last || now >= last.time + step) return [];
  const start = points.findLast(point => point.time <= now)?.time ?? now;
  return points
    .filter(point => point.time >= start && point.time + step > now && point.time <= now + HOUR)
    .map(point => ({ ...point, step }));
}

// A rate for each covered minute; a missing interval is different from measured dry weather.
type Rate = number | null;
export function minuteSeries(points: readonly MinutePoint[], now: number): Rate[] {
  const [first] = points;
  if (!first) return [];
  return Array.from({ length: MINUTES_PER_HOUR }, (_, minute) => {
    const time = now + minute * MINUTE;
    const reading = points.findLast(point => point.time <= time);
    return reading && time < reading.time + reading.step ? reading.value : null;
  });
}

// Named by how heavy it feels: light rain, rain, heavy rain; flurries, snow, heavy snow.
// Sleet and hail have no lighter or heavier names. Each comes as it opens a sentence and as it reads
// further into one, with the titles and the chance whole, as they take after what they name.
type ByLevel = readonly [light: string, moderate: string, heavy: string];
interface NextHourKind {
  opening: ByLevel;
  within: ByLevel;
  forecasted: string;
  stopping: string;
  briefly: string;
  possible: string;
  chanceThroughout: string;
  chanceWithin: string;
}
const RAIN: NextHourKind = {
  opening: [phrase('Light rain'), phrase('Rain'), phrase('Heavy rain')],
  within: [phrase('light rain'), phrase('rain'), phrase('heavy rain')],
  forecasted: phrase('Rain Forecasted'),
  stopping: phrase('Rain Stopping'),
  briefly: phrase('Rain Stopping Briefly'),
  possible: phrase('Possible Light Rain'),
  chanceThroughout: phrase('Chance of light rain for the next hour'),
  chanceWithin: phrase('Chance of light rain in the next hour'),
};
const NEXT_HOUR_WORDS: Readonly<Record<string, NextHourKind>> = {
  rain: RAIN,
  snow: {
    opening: [phrase('Flurries'), phrase('Snow'), phrase('Heavy snow')],
    within: [phrase('flurries'), phrase('snow'), phrase('heavy snow')],
    forecasted: phrase('Snow Forecasted'),
    stopping: phrase('Snow Stopping'),
    briefly: phrase('Snow Stopping Briefly'),
    possible: phrase('Possible Flurries'),
    chanceThroughout: phrase('Chance of flurries for the next hour'),
    chanceWithin: phrase('Chance of flurries in the next hour'),
  },
  sleet: {
    opening: [phrase('Sleet'), phrase('Sleet'), phrase('Sleet')],
    within: [phrase('sleet'), phrase('sleet'), phrase('sleet')],
    forecasted: phrase('Sleet Forecasted'),
    stopping: phrase('Sleet Stopping'),
    briefly: phrase('Sleet Stopping Briefly'),
    possible: phrase('Possible Sleet'),
    chanceThroughout: phrase('Chance of sleet for the next hour'),
    chanceWithin: phrase('Chance of sleet in the next hour'),
  },
  hail: {
    opening: [phrase('Hail'), phrase('Hail'), phrase('Hail')],
    within: [phrase('hail'), phrase('hail'), phrase('hail')],
    forecasted: phrase('Hail Forecasted'),
    stopping: phrase('Hail Stopping'),
    briefly: phrase('Hail Stopping Briefly'),
    possible: phrase('Possible Hail'),
    chanceThroughout: phrase('Chance of hail for the next hour'),
    chanceWithin: phrase('Chance of hail in the next hour'),
  },
};

// A change in how hard it falls counts once it holds ten minutes; a stop is brief when it
// starts again within twenty; a chance under 40% is only possible. Precipitation within the
// next 50 minutes is near: the next-hour panel shows, and the map turns to it.
const STEADY_MINUTES = 10;
const MM_PER_HOUR = 'mm/h';

const BRIEF_STOP = 20;

export const POSSIBLE = 40;

export const NEAR_MINUTES = 50;

// The next-hour panel's title, which names what falls, and its sentence, which says how hard.
// Likely precipitation: "Rain Forecasted" over "Rain for the next hour", "Flurries starting in 5
// min, lasting for 20 min", "Light rain for 20 min, followed by heavy rain" or "Snow starting in 5
// min, then turning to heavy snow 20 min later"; "Rain Stopping" over "Heavy rain stopping in 10
// min", and "Rain Stopping Briefly" when it starts again within 20 minutes. When the hour's
// `chance` is under 40%, it's "Possible Light Rain" over "Chance of light rain in the next hour",
// always in its lightest form. `series` is the rate for each of the next 60 minutes.
export interface NextHourWords {
  title: string;
  text: string;
}

export function nextHourForecast(
  series: readonly Rate[],
  unit: string,
  kind = 'rain',
  chance?: number,
): NextHourWords | null {
  if (!series.some(value => value !== null && value > 0)) return null;
  const words = NEXT_HOUR_WORDS[kind] ?? RAIN,
    symbol = kind === 'snow' ? 'snow' : kind === 'sleet' ? 'mixed' : undefined;
  const level = (i: number) => {
    const value = series[i] ?? 0;
    if (!(value > 0)) return -1;
    const felt = precipitationIntensity(value, unit, symbol);
    return Math.min(INTENSITY_LEVELS.length - 1, Math.floor(felt * INTENSITY_LEVELS.length));
  };
  // What it is called at a level, and in the page's language at the start of a sentence or further in.
  const word = (at: number) => words.opening[Math.max(0, at)] ?? words.opening[0];
  const opening = (at: number) => say(word(at));
  const within = (at: number) => say(words.within[Math.max(0, at)] ?? words.within[0]);
  const wet = (i: number) => level(i) >= 0;
  // The heaviest level over minutes [from, to).
  const peak = (from: number, to: number) => Math.max(...series.slice(from, to).map((_, i) => level(from + i)));
  // Where a stretch from `from` settles into another level for at least ten minutes, if it does.
  const change = (from: number, to: number) => {
    const start = level(from);
    for (let i = from + 1; i + STEADY_MINUTES <= to; i++) {
      const next = level(i);
      if (
        next >= 0 &&
        next !== start &&
        Array.from({ length: STEADY_MINUTES }, (_, k) => level(i + k)).every(at => at === next)
      )
        return i;
    }
    return -1;
  };
  const now = wet(0),
    start = series.findIndex((_, i) => wet(i)),
    gap = series.findIndex((value, i) => i > start && value === null),
    end = gap < 0 ? series.length : gap,
    stop = series.findIndex((value, i) => i > start && i < end && value !== null && value <= 0);
  if (finite(chance) && chance < POSSIBLE)
    return {
      title: say(words.possible),
      text: say(now && stop < 0 && end === MINUTES_PER_HOUR ? words.chanceThroughout : words.chanceWithin),
    };
  if ((start > 0 && series[start - 1] === null) || (now && stop < 0 && end < MINUTES_PER_HOUR)) {
    // Report only the wet interval we can see. A missing neighbor is neither a start nor a stop.
    const offset = (minutes: number) => (minutes ? `+${say('{minutes}m', { minutes })}` : say('Now'));
    return {
      title: say(words.forecasted),
      text: `${opening(peak(start, stop < 0 ? end : stop))} · ${offset(start)}–${offset(stop < 0 ? end : stop)}`,
    };
  }
  if (now) {
    if (stop < 0) {
      const turn = change(0, end);
      if (turn > 0 && word(level(turn)) !== word(level(0)))
        return {
          title: say(words.forecasted),
          text: say('{precipitation} for {minutes} min, followed by {next}', {
            precipitation: opening(level(0)),
            minutes: turn,
            next: within(level(turn)),
          }),
        };
      return {
        title: say(words.forecasted),
        text: say('{precipitation} for the next hour', { precipitation: opening(peak(0, end)) }),
      };
    }
    const precipitation = opening(peak(0, stop)),
      again = series.findIndex((_, i) => i > stop && i < end && wet(i));
    if (again < 0)
      return {
        title: say(words.stopping),
        text: say('{precipitation} stopping in {minutes} min', { precipitation, minutes: stop }),
      };
    return {
      title: say(again - stop <= BRIEF_STOP ? words.briefly : words.stopping),
      text: say('{precipitation} stopping in {minutes} min, starting again {later} min later', {
        precipitation,
        minutes: stop,
        later: again - stop,
      }),
    };
  }
  if (stop >= 0)
    return {
      title: say(words.forecasted),
      text: say('{precipitation} starting in {minutes} min, lasting for {lasting} min', {
        precipitation: opening(peak(start, stop)),
        minutes: start,
        lasting: stop - start,
      }),
    };
  const turn = change(start, end);
  if (turn > 0 && word(level(turn)) !== word(level(start)))
    return {
      title: say(words.forecasted),
      text: say('{precipitation} starting in {minutes} min, then turning to {next} {later} min later', {
        precipitation: opening(level(start)),
        minutes: start,
        next: within(level(turn)),
        later: turn - start,
      }),
    };
  return {
    title: say(words.forecasted),
    text: say('{precipitation} starting in {minutes} min', {
      precipitation: opening(peak(start, end)),
      minutes: start,
    }),
  };
}
export interface NextHour {
  title: string;
  text: string;
  // Rates through the next hour, a minute apart, in `unit` an hour.
  series: readonly Rate[];
  // The tile's chart: an hour from the reading under way, the first `past` minutes of it over.
  chart: readonly Rate[];
  past: number;
  unit: string;
  felt: PrecipitationSymbol | undefined;
}
// The next hour's chart ignores changes finer than a fortieth of its bars' height.
const INTENSITY_STEPS = 40;
// What the next hour calls what falls, by the condition now; anything else is rain.
const NEXT_HOUR_KIND: Readonly<Partial<Record<WeatherCondition, 'snow' | 'sleet' | 'hail'>>> = {
  snowy: 'snow',
  'snowy-rainy': 'sleet',
  hail: 'hail',
};
// What the next-hour panel shows, if anything, and what tells one drawing of it from another.
export interface NextHourPanelData {
  data: NextHour | undefined;
  felt: PrecipitationSymbol | undefined;
  key: string;
}
// Next-hour card: a sentence and sixty minutes of intensity, shown only
// when precipitation is on the way.
// `chance` is the current hour's chance of precipitation, for "Possible" forecasts.
export function nextHourOf(
  config: CardConfig,
  hass: HomeAssistant | undefined,
  state: EntityState | undefined,
  now: number,
  nowcast: readonly ForecastEntry[] | undefined,
  chance?: number,
  minutes?: readonly unknown[],
): NextHourPanelData {
  const id = config.next_hour_entity;
  let series: Rate[] = [],
    chart: Rate[] = [],
    past = 0,
    unit: string = UNITS.millimeters;
  if ((id || (minutes?.length ?? 0) > 0) && config.weather_layout === 'page') {
    const weather = id !== undefined && inDomain(id, 'weather'),
      entity = id === undefined ? undefined : hass?.states[id];
    // With no entity set, the minutes an integration gave when asked, which are rates in mm/h.
    const source = id === undefined ? minutes : weather ? nowcast : entity;
    const points = minutePoints(source ?? [], now),
      attrs: EntityAttributes = entity?.attributes ?? {};
    const declared =
      id === undefined ? MM_PER_HOUR : (attrs.unit_of_measurement ?? attrs.precipitation_unit ?? UNITS.millimeters);
    unit = declared.startsWith(UNITS.inches) ? UNITS.inches : UNITS.millimeters;
    // Amounts per step become hourly rates; sensors in mm/h already are.
    const [first] = points,
      step = (first?.step ?? HOUR) / MINUTE,
      perHour = declared.includes('/h') ? 1 : MINUTES_PER_HOUR / Math.max(1, step);
    const rates = points.map(point => ({ ...point, value: point.value * perHour })),
      start = Math.min(first?.time ?? now, now);
    series = minuteSeries(rates, now);
    chart = minuteSeries(rates, start);
    past = Math.floor((now - start) / MINUTE);
  }
  // Named by what's falling now; a mix of rain and snow reads as sleet in the next hour.
  const kind = (isCondition(state?.state) ? NEXT_HOUR_KIND[state.state] : undefined) ?? 'rain',
    felt = kind === 'snow' ? 'snow' : kind === 'sleet' ? 'mixed' : undefined;
  // Shown while precipitation falls now or starts within 50 minutes; later in the hour it waits.
  const near = series.slice(0, NEAR_MINUTES).some(value => value !== null && value > 0),
    summary = near ? nextHourForecast(series, unit, kind, chance) : null;
  return {
    data: summary ? { ...summary, series, chart, past, unit, felt } : undefined,
    felt,
    key: JSON.stringify([
      summary,
      past,
      chart.map(value =>
        value === null ? null : Math.round(precipitationIntensity(value, unit, felt) * INTENSITY_STEPS),
      ),
    ]),
  };
}
