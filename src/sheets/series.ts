import { type DailyItem, type TimedEntry, dateKey, gustOverWind, nightBySun } from '../weather/forecast-items.ts';
import type { EntityAttributes } from '../card/home-assistant.ts';
import type { TileContext } from '../cards/shared/context.ts';
import { finite, isRecord, isList, text } from '../lib/values.ts';
import { type History, stateTime } from '../weather/history.ts';
import { hoursInto } from './days.ts';
import { HOUR } from '../lib/time.ts';
import { solarElevation, ELEVATION } from '../sky/sun.ts';
// What a chart reads: an hour's value in the forecast, and the same reading in a set of attributes,
// the entity's now, with the hour under way, or a row of its history. A series with no such reading
// starts from the forecast.
export interface Series {
  hour: (entry: TimedEntry, attrs: EntityAttributes) => number | undefined;
  reading?: (attrs: Readonly<Record<string, unknown>>) => unknown;
  // Each point keeps the temperature beside it.
  withActual?: boolean;
  // The same reading in a day's forecast, for days past the hours.
  day?: (entry: DailyItem) => readonly (number | null | undefined)[];
  // What is charted with it: the scale takes in both.
  also?: readonly Series[];
  // Worked out from other readings in history, so hours that hold it outright go before those rows.
  derived?: boolean;
}
type Charted = 'uv_index' | 'wind_speed' | 'wind_gust_speed' | 'humidity' | 'temperature' | 'pressure' | 'visibility';
export const attributeSeries = (key: Charted): Series => ({
  hour: entry => entry[key],
  reading: attrs => attrs[key],
  day: entry => [entry[key]],
});

// A point on a chart's axis: `hour` is the hours gone since its day started.
export interface PlotPoint {
  hour: number;
  value: number;
  gust?: number | undefined;
  dew?: number | undefined;
  bearing?: number | string | undefined;
  // The weather then, and whether it was night; the temperature beside a feels-like reading; and
  // the chance of precipitation.
  condition?: string | undefined;
  night?: boolean | undefined;
  actual?: number | undefined;
  chance?: number | undefined;
  now?: boolean;
  past?: boolean;
}
// A reading at a time of day: a forecast hour, the current reading or one from history.
export interface ChartPoint extends PlotPoint {
  time: number;
}
// Weather symbols follow the sun's times, or the Sun's height where the place is known.
// Without either, keep the forecast's own day/night information.
export function lightSeries(
  ctx: Pick<TileContext, 'now'> & Partial<Pick<TileContext, 'latitude' | 'longitude' | 'sun'>>,
): (points: readonly ChartPoint[]) => ChartPoint[] {
  const { latitude, longitude } = ctx,
    dark =
      nightBySun(ctx.sun, ctx.now) ??
      (finite(latitude) && finite(longitude)
        ? (time: number) => solarElevation(time, latitude, longitude) < ELEVATION.daylight
        : null);
  return points => (dark ? points.map(point => ({ ...point, night: dark(point.time) })) : [...points]);
}
// One value per hour for a series, with what goes with it alongside.
// A reading within about a minute (0.02 h) of now stands for now.
const SAME_MOMENT = 0.02;
export function detailSeries(
  source: Series,
  entries: readonly TimedEntry[],
  attrs: EntityAttributes,
  now: number,
  timeZone: string | undefined,
  today: boolean,
): ChartPoint[] {
  const points = entries.flatMap(entry => {
    const point = source.hour(entry, attrs);
    return finite(point)
      ? [
          {
            hour: hoursInto(entry.time, timeZone),
            time: entry.time,
            value: point,
            gust: entry.wind_gust_speed,
            bearing: entry.wind_bearing,
            dew: entry.dew_point,
            condition: entry.condition,
            night: entry.is_daytime === false,
            actual: source.withActual ? entry.temperature : undefined,
            chance: entry.precipitation_probability,
          },
        ]
      : [];
  });
  const series: ChartPoint[] = points;
  // Today starts from the current reading, unless a reading already sits within a minute of now.
  if (today) {
    const current = source.reading?.(attrs),
      at = hoursInto(now, timeZone);
    if (finite(current) && !series.some(point => Math.abs(point.hour - at) < SAME_MOMENT))
      series.push({
        hour: at,
        time: now,
        value: current,
        now: true,
        gust: gustOverWind({ wind_speed: attrs.wind_speed, wind_gust_speed: attrs.wind_gust_speed }).wind_gust_speed,
        bearing: attrs.wind_bearing,
        dew: attrs.dew_point,
        actual: source.withActual ? attrs.temperature : undefined,
      });
    series.sort((a, b) => a.hour - b.hour);
  }
  return series;
}

export const range = (values: readonly number[]): [low: number, high: number] => [
  Math.min(...values),
  Math.max(...values),
];
export const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
// A day's readings from earlier today (history) and the forecast from now: the earlier ones up to
// the forecast's first.
export const withEarlier = <T extends PlotPoint>(past: readonly T[], points: readonly T[]): T[] => [
  ...past.filter(point => point.hour < (points[0]?.hour ?? Infinity)),
  ...points,
];

const numberOr = (value: unknown) => (finite(value) ? value : undefined);
export interface HistoryPoint extends ChartPoint {
  past: true;
}
// Readings from Home Assistant's history of the entity (compressed or full states). `states`: its
// rows from a history request, as received. Each keeps the gust, bearing and dew point read
// alongside.
export function historyPoints(source: Series, states: unknown, timeZone?: string): HistoryPoint[] {
  return (isList(states) ? states : []).flatMap(state => {
    if (!isRecord(state)) return [];
    const attrs = state['a'] ?? state['attributes'],
      time = stateTime(state);
    if (!isRecord(attrs) || !Number.isFinite(time)) return [];
    const value = source.reading?.(attrs),
      bearing = attrs['wind_bearing'],
      condition = state['s'] ?? state['state'];
    return finite(value)
      ? [
          {
            hour: hoursInto(time, timeZone),
            time,
            value,
            past: true as const,
            gust: numberOr(attrs['wind_gust_speed']),
            dew: numberOr(attrs['dew_point']),
            bearing: finite(bearing) || typeof bearing === 'string' ? bearing : undefined,
            condition: text(condition) ? condition : undefined,
            actual: source.withActual ? numberOr(attrs['temperature']) : undefined,
          },
        ]
      : [];
  });
}

// A chart's readings from before the forecast's hours, on one day: the entity's own history of the
// reading, and for what that leaves out, anything earlier and what goes with each reading, the hours
// kept from the supplement. A day gone by has nothing else. With neither, a line starts at now.
export type EarlierContext = Pick<TileContext, 'attrs' | 'pastHours' | 'now' | 'timeZone'>;
export function earlierPoints(
  source: Series,
  key: string,
  { attrs, pastHours, now, timeZone }: EarlierContext,
  history: { yesterday?: unknown; today?: unknown } | null | undefined,
): ChartPoint[] {
  const onDay = ({ time }: { time: number }) => dateKey(time, timeZone) === key,
    hours = detailSeries(source, pastHours.filter(onDay), attrs, now, timeZone, false),
    kept = [history?.yesterday, history?.today].flatMap(rows => historyPoints(source, rows, timeZone)).filter(onDay);
  const filled = kept.map(point => {
    const hour = hours.find(({ time }) => point.time >= time && point.time < time + HOUR);
    return hour ? { ...point, gust: point.gust ?? hour.gust, dew: point.dew ?? hour.dew } : point;
  });
  return source.derived && hours.length ? hours : withEarlier<ChartPoint>(hours, filled);
}

// How low and how high a reading goes.
export interface Reach {
  min: number;
  max: number;
}
export const reachOf = (values: readonly number[]): Reach | null => {
  if (!values.length) return null;
  const [min, max] = range(values);
  return { min, max };
};
// What a reading's whole series is gathered from: every hour, forecast or over, whatever its day; the
// reading now; history, yesterday's and earlier today's; and the daily forecast from the last day
// with hours.
export interface SeriesData {
  attrs: EntityAttributes;
  hourly: readonly TimedEntry[];
  pastHours: readonly TimedEntry[];
  daily: readonly DailyItem[];
  history: Pick<History, 'yesterday' | 'today'> | null | undefined;
  timeZone: string | undefined;
}
function seriesValues(source: Series, { attrs, hourly, pastHours, daily, history, timeZone }: SeriesData): number[] {
  const end = hourly.at(-1),
    hoursEnd = end ? dateKey(end.time, timeZone) : '';
  return [
    ...[...pastHours, ...hourly].map(entry => source.hour(entry, attrs)),
    source.reading?.(attrs),
    ...[history?.yesterday, history?.today].flatMap(rows =>
      historyPoints(source, rows, timeZone).map(point => point.value),
    ),
    ...daily.flatMap(entry => (dateKey(entry.time, timeZone) >= hoursEnd ? (source.day?.(entry) ?? []) : [])),
  ].filter(finite);
}
// The reach of a reading and whatever is charted with it over all a sheet can show. A chart's scale
// comes from this rather than from the day on screen, so it stays put from day to day and tab to tab.
export const seriesReach = (source: Series, data: SeriesData): Reach | null =>
  reachOf([source, ...(source.also ?? [])].flatMap(series => seriesValues(series, data)));
