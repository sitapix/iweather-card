import { STATE, type EntityRegistryEntry, type EntityState, type HomeAssistant } from '../../card/home-assistant.ts';
import { finite, isRecord, isList } from '../../lib/values.ts';
import type { CardConfig } from '../../card/config.ts';

// An alert sensor at rest: off, a count or level of none, the colour of no warning, empty, or
// without a reading.
const ACTIVE_OFF: ReadonlySet<string> = new Set([
  STATE.off,
  '0',
  'none',
  'green',
  'vert',
  '',
  STATE.unknown,
  STATE.unavailable,
]);

export interface WeatherAlert {
  event: string;
  text: string | undefined;
  severity: string | undefined;
  // When the hazard begins (an alert can be issued ahead of it) and ends, as times.
  starts: number;
  ends: number;
  // For its sheet: the whole message, with the instructions where they come apart; how soon to
  // act and what to do (the CAP urgency and response types, lower case); where; from whom; when
  // it was last sent; and a link to the source.
  description: string | undefined;
  urgency: string | undefined;
  responses: string[];
  area: string | undefined;
  source: string | undefined;
  sent: number;
  url: string | undefined;
}

// The first of `keys` whose value is non-blank text.
const pick = (source: unknown, ...keys: string[]) =>
  keys
    .map(key => (isRecord(source) ? source[key] : undefined))
    .find((value): value is string => typeof value === 'string' && Boolean(value.trim()));

// A CAP response type or a list of them, lower case: "AllClear" reads "allclear". NWS names it
// response, Meteoalarm responseType.
const responsesOf = (source: unknown): string[] => {
  const value = isRecord(source)
      ? (source['Response'] ?? source['response'] ?? source['responseType'] ?? source['ResponseType'])
      : undefined,
    list: readonly unknown[] = isList(value) ? value : [value];
  return list.flatMap(item => (typeof item === 'string' && item.trim() ? [item.trim().toLowerCase()] : []));
};

// An alert's link, if it is a web address: its text comes from outside Home Assistant, and only
// these are safe to follow.
const webLink = (url: string | undefined) => (url && /^https?:\/\//i.test(url) ? url : undefined);
// A warning level's colour in the words alertLevel reads, from a colour named in French, or a level
// numbered 1 (yellow) to 4 (extreme).
const COLOURS: Readonly<Record<string, string>> = {
  vert: 'green',
  green: 'green',
  jaune: 'yellow',
  yellow: 'yellow',
  orange: 'orange',
  rouge: 'red',
  red: 'red',
};
const NUMBERED_LEVELS = ['green', 'yellow', 'orange', 'red', 'extreme'];
// The kinds of alert, on a sensor that keeps one kind, that only inform. Its warnings, watches and
// advisories carry no colour of their own, so they take the usual level.
const KINDS: Readonly<Record<string, string>> = { statements: 'minor', endings: 'minor' };
// Attributes numbered from 1 (`warning_1`, `warning_2`…), in order, while there are more.
function numbered(attrs: Readonly<Record<string, unknown>>, prefix: string): unknown[] {
  const found: unknown[] = [];
  for (let index = 1; attrs[`${prefix}${index}`] !== undefined; index++) found.push(attrs[`${prefix}${index}`]);
  return found;
}
// What a sensor's alerts are, as each integration sets them out:
// - a list in `Alerts` or `alerts` (NWS Alerts);
// - numbered records, `warning_1`… each with its event, headline, times and a level from 1 to 4;
// - numbered titles, `alert_1`… with `alert_time_1`…, on a sensor that keeps one kind of alert;
// - a colour for each hazard, under the hazard's name, beneath a state that is the worst of them;
// - else the sensor's own attributes, as one alert (Meteoalarm).
function alertList(
  state: Pick<EntityState, 'state' | 'attributes'>,
  entry: EntityRegistryEntry | undefined,
): unknown[] {
  const attrs = state.attributes,
    { Alerts: upper, alerts: lower } = attrs;
  if (isList(upper)) return [...upper];
  if (isList(lower)) return [...lower];
  const records = numbered(attrs, 'warning_').filter(isRecord);
  if (records.length)
    return records.map(record => {
      const level = record['level'];
      return { ...record, severity: finite(level) ? NUMBERED_LEVELS[level] : undefined };
    });
  const titles = numbered(attrs, 'alert_'),
    times = numbered(attrs, 'alert_time_'),
    kind = KINDS[entry?.translation_key ?? ''];
  if (titles.length) return titles.map((title, i) => ({ event: title, sent: times[i], severity: kind }));
  const worst = COLOURS[state.state.toLowerCase()];
  if (worst !== undefined) {
    const hazards = Object.entries(attrs).flatMap(([hazard, colour]) => {
      const level = typeof colour === 'string' ? COLOURS[colour.toLowerCase()] : undefined;
      return level === undefined || level === 'green' ? [] : [{ event: hazard, severity: level }];
    });
    return hazards.length ? hazards : [{ ...attrs, severity: worst }];
  }
  return [attrs];
}
// The National Weather Service, as an alert's source.
export const NWS = 'National Weather Service';
// One alert as Home Assistant's integrations and the National Weather Service set it out, or
// none without an event; `name` stands in for an event it doesn't name. The time it ends comes
// before the time its message expires, which can be hours earlier.
export function alertOf(alert: unknown, name?: string): WeatherAlert | undefined {
  const event = pick(alert, 'Event', 'event', 'headline', 'Headline', 'title') ?? name,
    message = pick(alert, 'Description', 'description', 'message', 'text'),
    instruction = pick(alert, 'Instruction', 'instruction');
  return event
    ? {
        event,
        text: pick(alert, 'Headline', 'headline', 'Description', 'description', 'message', 'text'),
        severity: pick(alert, 'Severity', 'severity', 'awareness_level'),
        starts: Date.parse(pick(alert, 'Onset', 'onset', 'Starts', 'starts', 'start', 'start_time') ?? ''),
        ends: Date.parse(pick(alert, 'Ends', 'ends', 'Expires', 'expires', 'end', 'end_time') ?? ''),
        description:
          [message, instruction && !message?.includes(instruction) ? instruction : undefined]
            .filter(Boolean)
            .join('\n\n') || undefined,
        urgency: pick(alert, 'Urgency', 'urgency')?.toLowerCase(),
        responses: responsesOf(alert),
        area: pick(alert, 'AreasAffected', 'areaDesc', 'area', 'areas'),
        source:
          pick(alert, 'SenderName', 'senderName', 'sender_name', 'sender') ??
          (pick(alert, 'NWSCode') ? NWS : undefined),
        sent: Date.parse(pick(alert, 'Sent', 'sent', 'Effective', 'effective') ?? ''),
        url: webLink(pick(alert, 'URL', 'url', 'web', 'link')),
      }
    : undefined;
}
// Alerts from any integration (see alertList); one it can't make out goes by the sensor's own name.
// NWS Alerts names no sender, being the National Weather Service's own.
export function weatherAlerts(
  state: Pick<EntityState, 'state' | 'attributes'> | undefined,
  entry?: EntityRegistryEntry,
): WeatherAlert[] {
  if (!state || ACTIVE_OFF.has(state.state.toLowerCase())) return [];
  return alertList(state, entry).flatMap(alert => alertOf(alert, state.attributes.friendly_name) ?? []);
}
// The alerts the page shows: from the alert sensors set, else those the card asked for itself
// (`asked`, see loadNwsAlerts), which go by where they came from.
export type PageAlert = WeatherAlert & { id: string; ahead: boolean };
const ASKED_ALERTS = 'nws';
export function pageAlerts(
  config: CardConfig,
  hass: HomeAssistant | undefined,
  now: number,
  asked: readonly WeatherAlert[] = [],
): PageAlert[] {
  if (config.weather_layout !== 'page') return [];
  const sensors = config.alert_entities ?? [],
    found = sensors.length
      ? sensors.flatMap(id => weatherAlerts(hass?.states[id], hass?.entities?.[id]).map(alert => ({ alert, id })))
      : asked.map(alert => ({ alert, id: ASKED_ALERTS }));
  return found.map(({ alert, id }) => ({ ...alert, id, ahead: alert.starts > now }));
}
