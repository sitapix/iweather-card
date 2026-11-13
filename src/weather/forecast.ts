import {
  FORECAST_READINGS,
  type Connection,
  type ForecastEntry,
  type ForecastType,
  type Unsubscribe,
} from '../card/home-assistant.ts';
import { finite, isList, isRecord, text } from '../lib/values.ts';
import { DAY, HOUR, MINUTE, SECOND } from '../lib/time.ts';
import { dailyItems, dateKey, daysFromHours, gustOverWind } from './forecast-items.ts';
import type { Supplement } from './open-meteo.ts';
import { plausible } from './now.ts';

export type ForecastStatus = 'loading' | 'unavailable' | 'ready' | 'error';
// One forecast type as held: `raw` as received, `forecast` after the card's transform. `earlier`:
// the hours over before its first, which no forecast holds (see extendForecast).
export interface ForecastState {
  readonly status: ForecastStatus;
  readonly forecast: readonly ForecastEntry[];
  readonly raw?: readonly ForecastEntry[];
  readonly earlier?: readonly ForecastEntry[];
}
export type ForecastData = Partial<Record<ForecastType, ForecastState>>;
type Transform = (list: readonly ForecastEntry[], type: ForecastType) => readonly ForecastEntry[];
export const FORECAST_TYPES: readonly ForecastType[] = ['daily', 'hourly', 'twice_daily'];

// Where one page of a sideways strip lands from `from`: a `viewport` along, between 0 and `end`.
// A page that would stop within `snap` of either end goes all the way, leaving no sliver to scroll.
export function pageTarget(forward: boolean, from: number, viewport: number, end: number, snap: number): number {
  if (forward) {
    const next = Math.min(from + viewport, end);
    return next > end - snap ? end : next;
  }
  const next = Math.max(from - viewport, 0);
  return next < snap ? 0 : next;
}

// Forecast entries from a subscription event, each reading kept only when it has its type and could
// be a reading at all (see plausible).
function forecastEntry(value: unknown): ForecastEntry[] {
  if (!isRecord(value)) return [];
  const entry: ForecastEntry = {},
    { datetime, condition, is_daytime: daytime, wind_bearing: bearing } = value;
  if (text(datetime)) entry.datetime = datetime;
  if (text(condition)) entry.condition = condition;
  if (typeof daytime === 'boolean') entry.is_daytime = daytime;
  if (typeof bearing === 'number' || text(bearing)) entry.wind_bearing = bearing;
  for (const key of FORECAST_READINGS) {
    const reading = value[key];
    if (finite(reading) && plausible(key, reading, value['wind_speed'])) entry[key] = reading;
  }
  return [entry];
}
export const forecastEntries = (event: unknown): ForecastEntry[] => {
  const list = isRecord(event) ? event['forecast'] : undefined;
  return isList(list) ? list.flatMap(forecastEntry) : [];
};

// A forecast that hasn't answered in this long has failed, which says so and offers Retry. Failed,
// it is asked for again after 2 seconds, as an entity can be slow to come up with Home Assistant,
// then twice as long each time, up to every 5 minutes.
const ANSWER_WITHIN = 20 * SECOND;
const ASK_AGAIN = { first: 2 * SECOND, most: 5 * MINUTE } as const;
// A subscription that has said nothing for this long is asked again, as one can go quiet without
// ending. Integrations send their forecasts at least hourly, and a new subscription answers at once
// with the forecast as it is.
const QUIET = 2 * HOUR;
// The last forecast of each kind on a connection, for a card that comes back before its
// subscription answers: the dashboard's editor builds a new one at every change, so "loading" would
// flash each time. Kept for as long as such a run of changes lasts.
const KEPT_FOR = 5 * MINUTE;
const kept = new WeakMap<Connection, Map<string, { raw: readonly ForecastEntry[]; at: number }>>();
const keptKey = (entity: string, type: ForecastType) => `${entity} ${type}`;
function keep(connection: Connection, entity: string, type: ForecastType, raw: readonly ForecastEntry[]) {
  const held = kept.get(connection) ?? new Map<string, { raw: readonly ForecastEntry[]; at: number }>();
  held.set(keptKey(entity, type), { raw, at: Date.now() });
  kept.set(connection, held);
}
function keptRaw(connection: Connection, entity: string, type: ForecastType): readonly ForecastEntry[] | undefined {
  const held = kept.get(connection)?.get(keptKey(entity, type));
  return held && Date.now() - held.at < KEPT_FOR ? held.raw : undefined;
}

// Use HA's streaming forecast API. One subscription per requested forecast type;
// state updates do not refetch, and late subscription resolutions are disposed.
export class WeatherForecast {
  onChange: (data: ForecastData) => void;
  transform: Transform;
  generation = 0;
  data: ForecastData = {};
  stops = new Map<ForecastType, Unsubscribe>();
  connection: Connection | undefined;
  key: string | undefined;
  // What is on its way for each type: when it is given up on, or asked for again.
  private readonly timers = new Map<ForecastType, ReturnType<typeof setTimeout>>();
  // When each type, quiet since its last forecast, is asked again (see QUIET).
  private readonly quiet = new Map<ForecastType, ReturnType<typeof setTimeout>>();
  // The wait before each type is next asked for again.
  private readonly waits = new Map<ForecastType, number>();
  // The latest try for each type: an earlier one that answers late has been let go.
  private readonly tries = new Map<ForecastType, number>();
  private tried = 0;
  private entity: string | undefined;
  private paused = false;
  // The entity whose forecasts this follows.
  get subscribed(): string | undefined {
    return this.entity;
  }
  // `transform` adapts each received forecast (the card converts its units); refresh()
  // applies it again to what is held, after the transform's settings change.
  constructor(onChange: (data: ForecastData) => void, transform: Transform = list => list) {
    this.onChange = onChange;
    this.transform = transform;
  }
  update(connection: Connection | undefined, entity: string, types: readonly ForecastType[]) {
    const key = JSON.stringify([entity, types]);
    if (this.connection === connection && this.key === key) return;
    const { paused } = this;
    this.stop();
    this.paused = paused;
    this.connection = connection;
    this.key = key;
    this.entity = entity;
    for (const type of types) this.data[type] = this.start(connection, entity, type);
    this.onChange(this.data);
    if (connection && !paused) for (const type of types) this.subscribe(connection, entity, type);
  }
  // What a type shows until its subscription answers.
  private start(connection: Connection | undefined, entity: string, type: ForecastType): ForecastState {
    const raw = connection && keptRaw(connection, entity, type);
    if (raw) return { status: 'ready', raw, forecast: this.transform(raw, type) };
    return { status: connection ? 'loading' : 'unavailable', forecast: [] };
  }
  private subscribe(connection: Connection, entity: string, type: ForecastType) {
    const generation = this.generation,
      attempt = ++this.tried,
      current = () => generation === this.generation && this.tries.get(type) === attempt;
    this.tries.set(type, attempt);
    const failed = () => {
      if (!current()) return;
      // A forecast already showing stands while the next is asked for.
      if ((this.data[type]?.raw?.length ?? 0) === 0) {
        this.data[type] = { status: 'error', forecast: [] };
        this.onChange(this.data);
      }
      this.again(connection, entity, type);
    };
    this.timers.set(type, setTimeout(failed, ANSWER_WITHIN));
    Promise.resolve()
      .then(() => {
        if (!current()) return undefined;
        return connection.subscribeMessage(
          event => {
            if (!current()) return;
            clearTimeout(this.timers.get(type));
            const raw = forecastEntries(event);
            // An update with nothing in it says nothing about the forecast showing.
            if (!raw.length && (this.data[type]?.raw?.length ?? 0) > 0) return;
            this.waits.delete(type);
            if (raw.length) keep(connection, entity, type, raw);
            this.data[type] = { status: 'ready', raw, forecast: this.transform(raw, type) };
            this.onChange(this.data);
            clearTimeout(this.quiet.get(type));
            this.quiet.set(
              type,
              setTimeout(() => {
                if (current()) this.renew(connection, entity, type);
              }, QUIET),
            );
          },
          { type: 'weather/subscribe_forecast', entity_id: entity, forecast_type: type },
        );
      })
      .then(stop => {
        if (typeof stop !== 'function') return;
        if (current()) this.stops.set(type, stop);
        else this.dispose(stop);
      })
      .catch(failed);
  }
  private again(connection: Connection, entity: string, type: ForecastType) {
    const stop = this.stops.get(type),
      wait = this.waits.get(type) ?? ASK_AGAIN.first,
      generation = this.generation;
    if (stop) this.dispose(stop);
    this.stops.delete(type);
    this.tries.delete(type);
    clearTimeout(this.timers.get(type));
    this.waits.set(type, Math.min(wait * 2, ASK_AGAIN.most));
    this.timers.set(
      type,
      setTimeout(() => {
        if (generation === this.generation) this.subscribe(connection, entity, type);
      }, wait),
    );
  }
  // A new subscription in place of one gone quiet; the forecast showing stands until it answers.
  private renew(connection: Connection, entity: string, type: ForecastType) {
    const stop = this.stops.get(type);
    if (stop) this.dispose(stop);
    this.stops.delete(type);
    this.subscribe(connection, entity, type);
  }
  // Each type asked again, as the entity was made anew (see ForecastSources.renew); the forecast
  // showing stands until they answer.
  renewAll() {
    const { connection, entity } = this;
    if (!connection || entity === undefined || this.paused) return;
    for (const type of FORECAST_TYPES) if (this.data[type]) this.renew(connection, entity, type);
  }
  // Whether anything was held to convert. `quiet`, it says nothing, for whoever holds more to
  // convert first (see ForecastSources.refresh).
  refresh(quiet = false): boolean {
    let changed = false;
    for (const type of FORECAST_TYPES) {
      const entry = this.data[type];
      if (entry?.raw) {
        this.data[type] = { ...entry, forecast: this.transform(entry.raw, type) };
        changed = true;
      }
    }
    if (changed && !quiet) this.onChange(this.data);
    return changed;
  }
  dispose(stop: Unsubscribe) {
    try {
      Promise.resolve(stop()).catch(() => {});
    } catch {}
  }
  // Lets go of the subscriptions, and whatever was on its way.
  private release() {
    this.generation++;
    for (const timer of [...this.timers.values(), ...this.quiet.values()]) clearTimeout(timer);
    this.timers.clear();
    this.quiet.clear();
    this.waits.clear();
    this.tries.clear();
    for (const stop of this.stops.values()) this.dispose(stop);
    this.stops.clear();
  }
  // While the page is hidden: a page the browser has frozen can't read what Home Assistant sends,
  // which piles up until Home Assistant drops the connection. What is held stays on show.
  suspend() {
    if (this.paused) return;
    this.paused = true;
    this.release();
  }
  resume() {
    if (!this.paused) return;
    this.paused = false;
    const { connection, entity } = this;
    if (!connection || entity === undefined) return;
    for (const type of FORECAST_TYPES) if (this.data[type]) this.subscribe(connection, entity, type);
  }
  stop() {
    this.release();
    this.paused = false;
    this.data = {};
    this.connection = undefined;
    this.key = undefined;
    this.entity = undefined;
  }
}

// Fills what an entry lacks from the second entity's entry nearest in time (within half
// the spacing of its forecast): rain chance, UV, gusts and the rest, never the time,
// condition or temperatures the card's own entity already gives.
const FILLED = ['condition', ...FORECAST_READINGS, 'wind_bearing', 'cloud_altitude'] as const;
type Filled = (typeof FILLED)[number];
// The value `other` lends `out` for `key`, if `entry` has none of its own.
const fill = <K extends Filled>(
  out: ForecastEntry,
  entry: ForecastEntry,
  other: ForecastEntry,
  key: K,
): ForecastEntry[K] | undefined => {
  const value = other[key];
  if (value === undefined || entry[key] !== undefined) return undefined;
  out[key] = value;
  return value;
};
// `entry` with what it lacks of `fields` from `other`; itself when it lacks none of them.
function lend(entry: ForecastEntry, other: ForecastEntry, fields: readonly Filled[]): ForecastEntry {
  const out = { ...entry };
  let filled = false;
  for (const key of fields) if (fill(out, entry, other, key) !== undefined) filled = true;
  return filled ? out : entry;
}
export function fillForecast(
  own: readonly ForecastEntry[],
  other: readonly ForecastEntry[],
  window: number,
  fields: readonly Filled[] = FILLED,
): readonly ForecastEntry[] {
  if (!own.length || !other.length) return own;
  const times = other.map(entry => Date.parse(entry.datetime ?? ''));
  return own.map(entry => {
    const time = Date.parse(entry.datetime ?? '');
    let best = -1,
      gap = window;
    times.forEach((t, i) => {
      const d = Math.abs(t - time);
      if (d <= gap) {
        gap = d;
        best = i;
      }
    });
    const nearest = other[best];
    return nearest ? lend(entry, nearest, fields) : entry;
  });
}

// What `other` has of the hours `own` hasn't, whole: `fillForecast` only maps `own`.
// An hour over by `at` goes to `earlier`, as no forecast shows it; those after it join `own`, the
// one under way among them, whose readings stand for the hour now.
export function extendForecast(
  own: readonly ForecastEntry[],
  other: readonly ForecastEntry[],
  window: number,
  at: number,
): { forecast: readonly ForecastEntry[]; earlier: readonly ForecastEntry[] } {
  const timeOf = (entry: ForecastEntry) => Date.parse(entry.datetime ?? ''),
    times = own.map(timeOf).filter(Number.isFinite);
  // Past either end, or in a hole in the middle: an entity can drop the hour that repeats as the
  // clocks go back.
  const outside = other.filter(entry => !times.some(time => Math.abs(time - timeOf(entry)) <= window)),
    over = (entry: ForecastEntry) => timeOf(entry) + HOUR <= at;
  return { forecast: [...own, ...outside.filter(entry => !over(entry))], earlier: outside.filter(over) };
}

// What the supplement lends an entry within the entity's own range. The rest of an hour there is
// the entity's to give or leave.
const LENT = [
  'precipitation_probability',
  'wind_gust_speed',
  'apparent_temperature',
  'dew_point',
  'visibility',
  'humidity',
  'pressure',
  'uv_index',
] as const satisfies readonly Filled[];
// An hour is lent its amount as well, as many entities send a chance and no amount, and a day's
// bars and total are its hours'. A day isn't: one given twice would hold the whole day's in each half.
// An hour is lent its cloud cover too, which tells mostly cloudy from overcast where the condition
// names both alike, and the cloud's height. The condition still bounds what the cover can make of
// the sky (see skyKind).
const LENT_HOURLY = [...LENT, 'precipitation', 'cloud_coverage', 'cloud_altitude'] as const satisfies readonly Filled[];
// Lending a gust takes the entry's own wind into account; the entity's own gust stands as sent.
const lentGust = (entry: ForecastEntry, own: ForecastEntry | undefined): ForecastEntry =>
  own?.wind_gust_speed === undefined ? gustOverWind(entry) : entry;

// `own`'s days filled by local date, then the days it doesn't have. A day's stamp is no use for
// matching: it can be midnight in one source and noon, or UTC's midnight, in another.
function fillDays(
  own: readonly ForecastEntry[],
  days: readonly ForecastEntry[],
  timeZone: string | undefined,
): readonly ForecastEntry[] {
  const dateOf = (entry: ForecastEntry) => {
    const time = Date.parse(entry.datetime ?? '');
    return Number.isFinite(time) ? dateKey(time, timeZone) : undefined;
  };
  const byDate = new Map(days.map(day => [dateOf(day), day])),
    held = new Set(own.map(dateOf));
  return [
    ...own.map(entry => {
      const day = byDate.get(dateOf(entry));
      return day ? lentGust(lend(entry, day, LENT), entry) : entry;
    }),
    ...days.filter(day => !held.has(dateOf(day))),
  ];
}

// The entities' forecasts with the supplement's added: their own values always win, field by
// field, hour by hour. Keyed by the epoch, never a clock, so half-hour zones, clock changes and an
// entity stamping HH:30 all line up. A type they have nothing of takes the supplement's, whole.
export function supplementForecast(
  own: ForecastData,
  { at, hours, days }: Supplement,
  timeZone: string | undefined,
): ForecastData {
  const entity = own.hourly?.forecast ?? [],
    lent = fillForecast(entity, hours, HOUR / 2, LENT_HOURLY).map((entry, i) => lentGust(entry, entity[i])),
    // A forecast given twice a day stands in for the daily one (see workOut), so that's what grows.
    type = own.twice_daily && !own.daily ? 'twice_daily' : 'daily';
  return {
    ...own,
    hourly: { status: 'ready', ...extendForecast(lent, hours, HOUR / 2, at) },
    [type]: { status: 'ready', forecast: fillDays(own[type]?.forecast ?? [], days, timeZone) },
  };
}

// Whether a forecast leaves out what the supplement brings: a chance, an amount, a gust or a cloud
// cover for any hour, or days short of the `days` shown. An entity that sends everything never
// causes a request.
export function forecastLacks(data: ForecastData, days: number, now: number, timeZone: string | undefined): boolean {
  const hours = data.hourly?.forecast ?? [];
  return (
    !hours.length ||
    !hours.every(
      entry =>
        finite(entry.precipitation_probability) &&
        finite(entry.precipitation) &&
        finite(entry.wind_gust_speed) &&
        finite(entry.cloud_coverage),
    ) ||
    dailyItems((data.daily ?? data.twice_daily)?.forecast, now, timeZone, {}, days).length < days
  );
}

// Forecasts from up to two weather entities: the card's own, and a second entity that
// supplies the forecast types the first doesn't provide (an integration with only daily
// forecasts can borrow another's hourly) and fills details the first leaves out (rain
// chance, UV, gusts) hour by hour. `data` merges them, the card's own values winning, with the
// supplement last of all, and `own` is the same without it.
export type ForecastSource = 'main' | 'extra' | 'open_meteo';
export class ForecastSources {
  main: WeatherForecast;
  extra: WeatherForecast;
  merged = new Map<ForecastType, { own: ForecastState; other: ForecastState; value: ForecastState }>();
  transform: (list: readonly ForecastEntry[], source: ForecastSource, type: ForecastType) => readonly ForecastEntry[];
  // The supplement as it came, the same in the card's units, and the zone that dates its days.
  supplement: { raw: Supplement; converted: Supplement; timeZone: string | undefined } | undefined;
  // Merged once per set of forecasts, as `merged` is.
  supplied:
    | {
        from: ForecastData;
        supplement: ForecastSources['supplement'];
        value: ForecastData;
      }
    | undefined;
  private readonly onChange: (data: ForecastData) => void;
  constructor(
    onChange: (data: ForecastData) => void,
    transform: (list: readonly ForecastEntry[], source: ForecastSource, type: ForecastType) => readonly ForecastEntry[],
  ) {
    this.onChange = onChange;
    this.transform = transform;
    this.main = new WeatherForecast(onChange, (list, type) => transform(list, 'main', type));
    this.extra = new WeatherForecast(onChange, (list, type) => transform(list, 'extra', type));
  }
  // Whether every forecast asked of the entities has answered, one way or the other.
  get answered(): boolean {
    return (
      this.main.key !== undefined &&
      [...Object.values(this.main.data), ...Object.values(this.extra.data)].every(
        ({ status }) => status === 'ready' || status === 'error',
      )
    );
  }
  get data(): ForecastData {
    const own = this.own,
      { supplement } = this;
    if (!supplement) return own;
    const { supplied } = this;
    if (supplied?.supplement === supplement && FORECAST_TYPES.every(type => supplied.from[type] === own[type]))
      return supplied.value;
    const value = supplementForecast(own, supplement.converted, supplement.timeZone);
    this.supplied = { from: own, supplement, value };
    return value;
  }
  get own(): ForecastData {
    const out: ForecastData = { ...this.extra.data };
    for (const type of FORECAST_TYPES) {
      const own = this.main.data[type],
        other = this.extra.data[type];
      if (!own) continue;
      // Nothing from the entity's own, say it failed: the other's stands in, whole.
      if (!own.forecast.length && (other?.forecast.length ?? 0)) continue;
      if (!other || other.forecast.length === 0 || !own.forecast.length) {
        out[type] = own;
        continue;
      }
      // Merged once per pair of forecasts, so repeated reads share one result.
      const cached = this.merged.get(type);
      if (cached?.own === own && cached.other === other) {
        out[type] = cached.value;
        continue;
      }
      const value = {
        ...own,
        forecast: fillForecast(own.forecast, other.forecast, type === 'hourly' ? HOUR / 2 : DAY / 2),
      };
      this.merged.set(type, { own, other, value });
      out[type] = value;
    }
    return out;
  }
  update(
    connection: Connection | undefined,
    entity: string,
    types: readonly ForecastType[],
    extraEntity?: string,
    extraTypes: readonly ForecastType[] = [],
  ) {
    this.main.update(connection, entity, types);
    if (extraEntity && extraTypes.length) this.extra.update(connection, extraEntity, extraTypes);
    else this.extra.stop();
  }
  // An entity Home Assistant made anew, as an integration does when it reloads: a subscription to the
  // one before stays open but says nothing more, and nothing on the connection tells of it.
  renew(entity: string) {
    for (const stream of [this.main, this.extra]) if (stream.subscribed === entity) stream.renewAll();
  }
  // The supplement to add to the forecasts, in the card's units; none lets go of what was held.
  supply(raw: Supplement | undefined, timeZone?: string) {
    this.supplement = raw && { raw, converted: this.converted(raw), timeZone };
  }
  converted(raw: Supplement): Supplement {
    const bring = (list: readonly ForecastEntry[], type: ForecastType) =>
      this.transform(list, 'open_meteo', type).map(gustOverWind);
    return { ...raw, hours: bring(raw.hours, 'hourly'), days: bring(raw.days, 'daily') };
  }
  suspend() {
    this.main.suspend();
    this.extra.suspend();
  }
  resume() {
    this.main.resume();
    this.extra.resume();
  }
  // Everything held, converted again for new settings, and only then told: told between, the card
  // would draw one source in the new units beside another still in the old, and a sheet open then
  // keeps the scale it worked out from both until it closes.
  refresh() {
    if (this.supplement) this.supplement = { ...this.supplement, converted: this.converted(this.supplement.raw) };
    const main = this.main.refresh(true),
      extra = this.extra.refresh(true);
    if (main || extra) this.onChange(this.data);
  }
  stop() {
    this.main.stop();
    this.extra.stop();
  }
}

// Sensor updates keep the same hourly forecast. Its partial days are included according to the
// local date, which can change before another forecast arrives.
const derivedDays = new WeakMap<
  readonly ForecastEntry[],
  { date: string; zone: string | undefined; daily: ForecastState }
>();

// An entity with no forecast by the day has its days made from its hours, unless days are on their
// way from it or from what fills it in.
export function withHourlyDays(
  data: ForecastData,
  awaited: boolean,
  now: number,
  timeZone: string | undefined,
): ForecastData {
  const days = data.daily ?? data.twice_daily,
    hours = data.hourly?.forecast;
  if (awaited || (days?.forecast.length ?? 0) > 0 || days?.status === 'loading' || !hours || hours.length === 0)
    return data;
  const date = dateKey(now, timeZone),
    kept = derivedDays.get(hours);
  if (kept?.date === date && kept.zone === timeZone) return { ...data, daily: kept.daily };
  const daily: ForecastState = { status: 'ready', forecast: daysFromHours(hours, now, timeZone) };
  derivedDays.set(hours, { date, zone: timeZone, daily });
  return { ...data, daily };
}
