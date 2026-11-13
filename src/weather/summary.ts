import { type StripItem, dateKey } from './forecast-items.ts';
import {
  LEVELS,
  wet,
  type IntensityLevel,
  type PrecipitationKind,
  conditionPrecipitation,
  INTENSITY_LEVELS,
  precipitationIntensity,
} from './precipitation.ts';
import { type WeatherCondition, isCondition, CONDITION } from '../card/home-assistant.ts';
import { finite } from '../lib/values.ts';
import { phrase, say } from './words.ts';
// The summary line over the hourly strip, from the strip's own hours:
// "Rain until 4PM.", "Cloudy conditions expected around 3PM.", gusts after.
// `text(condition)` names a condition; `clock(time)` formats an hour.
const FAMILY: Readonly<Partial<Record<WeatherCondition, WeatherCondition>>> = {
  'clear-night': 'sunny',
  'windy-variant': 'windy',
};

const family = (condition: string) => (isCondition(condition) ? (FAMILY[condition] ?? condition) : condition);

export interface SummaryOptions {
  text: (condition: string) => string;
  clock: (time: number) => string;
  timeZone?: string | undefined;
  fmt?: (value: number) => string;
  gustUnit?: string;
  gustLimit?: number;
  // The unit of the hours' precipitation amounts, which set how hard it falls.
  unit?: string | undefined;
}

// What falls, by how hard, each name whole, as an adjective takes after its noun in many languages:
// as it opens a sentence, and as it reads further into one. An hour without an amount has the plain
// name.
type Name = readonly [opening: string, within: string];
const FALLING: Readonly<Record<PrecipitationKind, Readonly<Record<IntensityLevel | '', Name>>>> = {
  rain: {
    '': [phrase('Rain'), phrase('rain')],
    Light: [phrase('Light rain'), phrase('light rain')],
    Moderate: [phrase('Moderate rain'), phrase('moderate rain')],
    Heavy: [phrase('Heavy rain'), phrase('heavy rain')],
  },
  snow: {
    '': [phrase('Snow'), phrase('snow')],
    Light: [phrase('Light snow'), phrase('light snow')],
    Moderate: [phrase('Moderate snow'), phrase('moderate snow')],
    Heavy: [phrase('Heavy snow'), phrase('heavy snow')],
  },
  sleet: {
    '': [phrase('Sleet'), phrase('sleet')],
    Light: [phrase('Light sleet'), phrase('light sleet')],
    Moderate: [phrase('Moderate sleet'), phrase('moderate sleet')],
    Heavy: [phrase('Heavy sleet'), phrase('heavy sleet')],
  },
  hail: {
    '': [phrase('Hail'), phrase('hail')],
    Light: [phrase('Light hail'), phrase('light hail')],
    Moderate: [phrase('Moderate hail'), phrase('moderate hail')],
    Heavy: [phrase('Heavy hail'), phrase('heavy hail')],
  },
  wintry_mix: {
    '': [phrase('Wintry mix'), phrase('wintry mix')],
    Light: [phrase('Light wintry mix'), phrase('light wintry mix')],
    Moderate: [phrase('Moderate wintry mix'), phrase('moderate wintry mix')],
    Heavy: [phrase('Heavy wintry mix'), phrase('heavy wintry mix')],
  },
};
// One kind that comes and goes has a sentence of its own, and two share one.
const VARIABLE: Readonly<Record<PrecipitationKind, string>> = {
  rain: phrase('Variable rain expected throughout the day.'),
  snow: phrase('Variable snow expected throughout the day.'),
  sleet: phrase('Variable sleet expected throughout the day.'),
  hail: phrase('Variable hail expected throughout the day.'),
  wintry_mix: phrase('Variable wintry mix expected throughout the day.'),
};
const KIND_WORDS: Readonly<Record<PrecipitationKind, string>> = {
  rain: phrase('rain'),
  snow: phrase('snow'),
  sleet: phrase('sleet'),
  hail: phrase('hail'),
  wintry_mix: phrase('wintry mix'),
};

// The rest of today's precipitation as stretches of one kind falling equally hard, or dry,
// each read until the next begins: "Light rain until 3PM. Then, no precipitation until 6PM.
// Then, heavy rain for the remainder of the day." One stretch falls throughout the day;
// four or more are variable. How hard is light, moderate or heavy by the hour's amount
// (see precipitationIntensity), left unsaid without amounts.
const VARIABLE_RUNS = 4;

interface Run {
  kind: PrecipitationKind | null;
  level: IntensityLevel | '';
  time: number;
}
// The first stretch's sentence, until the next begins, and each one after it, until the next or
// else for the rest of the day.
const firstStretch = ({ kind, level }: Run, time: string): string =>
  kind
    ? say('{precipitation} until {time}.', { precipitation: say(FALLING[kind][level][0]), time })
    : say('No precipitation until {time}.', { time });
function laterStretch({ kind, level }: Run, time: string | undefined): string {
  if (!kind)
    return time
      ? say('Then, no precipitation until {time}.', { time })
      : say('Then, no precipitation for the remainder of the day.');
  const precipitation = say(FALLING[kind][level][1]);
  return time
    ? say('Then, {precipitation} until {time}.', { precipitation, time })
    : say('Then, {precipitation} for the remainder of the day.', { precipitation });
}

function precipitationStory(
  hours: readonly (StripItem & { condition: string })[],
  clock: (time: number) => string,
  unit: string | undefined,
): string {
  const runs: Run[] = [];
  for (const item of hours) {
    const kind = wet(item) ? (conditionPrecipitation(item.condition) ?? 'rain') : null,
      felt = kind === 'snow' ? 'snow' : kind === 'sleet' || kind === 'wintry_mix' ? 'mixed' : undefined,
      amount = item.precipitation,
      level =
        kind && finite(amount) && amount > 0
          ? (INTENSITY_LEVELS[Math.min(LEVELS - 1, Math.floor(precipitationIntensity(amount, unit, felt) * LEVELS))] ??
            '')
          : '',
      last = runs.at(-1);
    if (!last || last.kind !== kind || last.level !== level) runs.push({ kind, level, time: item.time });
  }
  const [only] = runs;
  if (runs.length === 1 && only)
    return only.kind
      ? say('{precipitation} expected throughout the day.', { precipitation: say(FALLING[only.kind][only.level][0]) })
      : '';
  if (runs.length >= VARIABLE_RUNS) {
    const [one, other, more] = [...new Set(runs.flatMap(run => (run.kind ? [run.kind] : [])))];
    if (more || !one) return say('Variable mixed precipitation expected throughout the day.');
    return other
      ? say('Variable {one} and {other} expected throughout the day.', {
          one: say(KIND_WORDS[one]),
          other: say(KIND_WORDS[other]),
        })
      : say(VARIABLE[one]);
  }
  return runs
    .map((run, index) => {
      const next = runs[index + 1];
      return !index && next ? firstStretch(run, clock(next.time)) : laterStretch(run, next && clock(next.time));
    })
    .join(' ');
}

export function forecastSummary(
  items: readonly StripItem[],
  mode: string | undefined,
  { text, clock, timeZone, fmt = String, gustUnit = '', gustLimit = Infinity, unit }: SummaryOptions,
): string {
  const hours = items.filter((item): item is StripItem & { condition: string } => !item.sun && Boolean(item.condition)),
    [first] = hours;
  if (!first) return '';
  const today = dateKey(first.time, timeZone),
    rest = hours.filter(item => dateKey(item.time, timeZone) === today);
  const sentences: string[] = [];
  // Falling now, or later today in the precipitation view, today's precipitation is told
  // stretch by stretch.
  const story = mode !== 'wind' && (wet(first) || (mode === 'rain' && rest.some(wet)));
  if (story) sentences.push(precipitationStory(rest, clock, unit));
  else if (mode !== 'wind') {
    // Dry now: when it starts, or that nothing falls, or how the sky changes.
    const start = hours.find(wet);
    if (start)
      sentences.push(
        say('{condition} expected around {time}.', {
          condition: text(conditionPrecipitation(start.condition) ? start.condition : CONDITION.rainy),
          time: clock(start.time),
        }),
      );
    else if (mode === 'rain')
      sentences.push(
        rest.length === hours.length
          ? say('No precipitation for the remainder of the day.')
          : say('No precipitation expected.'),
      );
    else {
      const change = hours.find(item => family(item.condition) !== family(first.condition));
      sentences.push(
        change
          ? say('{condition} conditions expected around {time}.', {
              condition: text(change.condition),
              time: clock(change.time),
            })
          : say('{condition} conditions will continue for the rest of the day.', { condition: text(first.condition) }),
      );
    }
  }
  const gusts = hours.map(item => item.wind_gust_speed).filter(finite),
    speeds = hours.map(item => item.wind_speed).filter(finite),
    speed = (value: number) => `${fmt(value)} ${gustUnit}`.trimEnd();
  if (gusts.length && Math.max(...gusts) >= gustLimit)
    sentences.push(say('Wind gusts are up to {speed}.', { speed: speed(Math.max(...gusts)) }));
  else if (mode === 'wind' && speeds.length)
    sentences.push(
      say('Wind speeds are {low} to {high}.', { low: fmt(Math.min(...speeds)), high: speed(Math.max(...speeds)) }),
    );
  return sentences.join(' ');
}
