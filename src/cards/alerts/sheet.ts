import type { TileContext } from '../shared/context.ts';
import { dateFormat } from '../../lib/formats.ts';
import type { WeatherAlert } from './rules.ts';
import { esc } from '../../lib/html.ts';
import type { SheetCard } from '../card.ts';
import { sheetHeader } from '../../sheets/parts.ts';
import { alertIcon } from '../../weather/icons.ts';
import { phrase, say, sayCount } from '../../weather/words.ts';
// The severe weather alerts, as their source sets them out: one section each, titled with the
// event (the one picked open), then its severity and what that means, when the weather begins,
// the whole message, what to do, how soon, where, and who issued it, when last, with a link to the
// source. A row the alert has nothing for is left out, as is an unknown urgency.
const SEVERITY_NAMES: Readonly<Record<string, string>> = {
  extreme: phrase('Extreme'),
  severe: phrase('Severe'),
  moderate: phrase('Moderate'),
  minor: phrase('Minor'),
  unknown: phrase('Unknown'),
};
const SEVERITY_MEANINGS: Readonly<Record<string, string>> = {
  extreme: phrase('Extraordinary threat to life or property'),
  severe: phrase('Significant threat to life or property'),
  moderate: phrase('Possible threat to life or property'),
  minor: phrase('Minimal to no known threat to life or property'),
  unknown: phrase('The severity of this alert is not known.'),
};
const URGENCY_MEANINGS: Readonly<Record<string, string>> = {
  immediate: phrase('Take action immediately.'),
  expected: phrase('Take action within next hour.'),
  future: phrase('Take action in the near future.'),
  past: phrase('Action is no longer required.'),
};
// What to do, by response type, in the order they are told.
const RESPONSES: readonly (readonly [type: string, text: string])[] = [
  ['evacuate', phrase('Evacuate as instructed in the Description.')],
  ['shelter', phrase('Take shelter in place.')],
  ['execute', phrase('Execute a pre-planned activity as instructed in the Description.')],
  ['prepare', phrase('Make preparations per the Description.')],
  ['avoid', phrase('Avoid the weather event as instructed in the Description.')],
  ['monitor', phrase('Monitor the situation and take precautions if necessary.')],
  ['assess', phrase('Assess the situation and take precautions if necessary.')],
  [
    'allclear',
    phrase(
      'The severe weather event no longer poses a concern. Any recommended action is explained in the Description.',
    ),
  ],
  ['none', phrase('There is no action being recommended.')],
];
// A message's paragraphs, its lines (wrapped short, as weather services send them) run together.
const paragraphs = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map(part => part.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
type AlertClock = Pick<TileContext, 'locale' | 'timeZone' | 'hour12'> & {
  // False leaves the zone off the times, for a reader in the zone they are told in.
  zoned?: boolean;
};
// A moment as its time with its zone, then its date: 1:29 AM (CDT), October 30, or with its day
// named, 1:29 AM (CDT), Friday, October 30.
function alertMoment(ctx: AlertClock, time: number, named = false): string {
  const clock = dateFormat(ctx.locale, {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone: ctx.timeZone,
      hour12: ctx.hour12,
    }).formatToParts(time),
    zone = clock.find(part => part.type === 'timeZoneName')?.value ?? '',
    shown = clock
      .filter(part => part.type !== 'timeZoneName')
      .map(part => part.value)
      .join('')
      .trim(),
    date = dateFormat(
      ctx.locale,
      named
        ? { weekday: 'long', month: 'long', day: 'numeric', timeZone: ctx.timeZone }
        : { month: 'long', day: 'numeric', timeZone: ctx.timeZone },
    ).format(time);
  return zone && ctx.zoned !== false
    ? say('{time} ({zone}), {date}', { time: shown, zone, date })
    : say('{time}, {date}', { time: shown, date });
}
type PanelAlert = Pick<WeatherAlert, 'event' | 'starts' | 'ends' | 'source'>;
const inEffect = (events: string, count: number) =>
  sayCount('Alert in effect: {events}.', 'Alerts in effect: {events}.', count, { events });
// The longest title the alert panel gives with the others counted, in characters: "Flood Advisory
// & 1 More" fits; "Severe Thunderstorm Warning & 1 More" gives the first event alone.
const ALERT_TITLE_LIMIT = 25;
// An alert in one sentence on when it holds: "Flood Advisory. These conditions are expected to last
// until 4:00 AM (CDT), Friday, October 30." Until its end once begun (or when it gives only an
// end); by its start while it is ahead, even when it gives an end; since its start once begun with
// no end, or past its end. With no times, "Alert in effect: Flood Advisory.", or among others its
// event alone.
function alertSaid(ctx: AlertClock, alert: PanelAlert, now: number, count: number): string {
  const at = (time: number) => alertMoment(ctx, time, true),
    onset = Number.isFinite(alert.starts) ? alert.starts : -Infinity,
    { event } = alert;
  if (Number.isFinite(alert.ends) && now <= alert.ends && onset < now)
    return say('{event}. These conditions are expected to last until {time}.', { event, time: at(alert.ends) });
  if (onset > now) return say('{event}. These conditions are expected by {time}.', { event, time: at(onset) });
  if (Number.isFinite(onset) && onset < now)
    return say('{event}. These conditions started at {time}.', { event, time: at(onset) });
  return count > 1 ? say('{event}.', { event }) : inEffect(event, 1);
}
// What the alert panel says, once alerts repeating an event are dropped (a service can send one
// for each zone it covers). Its title: the first alert's event, or "Flood Warning & 1 More" where
// that fits in 25 characters. Its sentence: when the first
// alert holds, then the others' events; or when the first gives no times (or only an end that has
// passed), every alert in effect. Who issued them, and how many there are.
export interface AlertWords {
  title: string | undefined;
  sentence: string;
  source: string | undefined;
  count: number;
}
export function alertWords(ctx: AlertClock, alerts: readonly PanelAlert[], now: number): AlertWords {
  const shown = alerts.filter((alert, i) => alerts.findIndex(other => other.event === alert.event) === i),
    [first, ...rest] = shown,
    events = (list: readonly PanelAlert[]) => list.map(alert => alert.event).join(', ');
  if (!first)
    return { title: undefined, sentence: say('There is a severe weather alert.'), source: undefined, count: 0 };
  const counted = rest.length
      ? sayCount('{event} & {count} More', '{event} & {count} More', rest.length, { event: first.event })
      : first.event,
    timed = Number.isFinite(first.starts) || (Number.isFinite(first.ends) && first.ends >= now);
  return {
    title: counted.length <= ALERT_TITLE_LIMIT ? counted : first.event,
    sentence: timed
      ? alertSaid(ctx, first, now, shown.length) +
        (rest.length
          ? ` ${sayCount('Additional alert: {events}.', 'Additional alerts: {events}.', rest.length, { events: events(rest) })}`
          : '')
      : inEffect(events(shown), shown.length),
    source: shown.find(alert => alert.source)?.source,
    count: shown.length,
  };
}
export function alertsDetail(ctx: AlertClock, alerts: readonly WeatherAlert[], open: number): string {
  const when = (time: number) => alertMoment(ctx, time);
  const row = (title: string, body: string, extra = '') => `<section><h4>${title}</h4>${body}${extra}</section>`;
  const sections = alerts.map((alert, i) => {
    const severity = (alert.severity ?? 'unknown').toLowerCase(),
      level = severity in SEVERITY_MEANINGS ? severity : 'unknown',
      actions = RESPONSES.filter(([type]) => alert.responses.includes(type)),
      // "none" goes when anything is recommended.
      told = actions.length > 1 ? actions.filter(([type]) => type !== 'none') : actions,
      urgency = alert.urgency ? URGENCY_MEANINGS[alert.urgency] : undefined;
    const rows = [
      row(
        say('Severity: {level}', { level: `<span>${esc(say(SEVERITY_NAMES[level] ?? ''))}</span>` }),
        `<p>${say(SEVERITY_MEANINGS[level] ?? '')}</p>`,
      ),
      Number.isFinite(alert.starts) ? row(say('Weather Event Onset'), `<p>${esc(when(alert.starts))}</p>`) : '',
      alert.description
        ? row(
            say('Description'),
            paragraphs(alert.description)
              .map(part => `<p>${esc(part)}</p>`)
              .join(''),
          )
        : '',
      told.length
        ? row(
            sayCount('Action Recommended', 'Actions Recommended', told.length),
            `<p>${told.map(([, text]) => say(text)).join(' ')}</p>`,
          )
        : '',
      urgency ? row(say('Urgency'), `<p>${say(urgency)}</p>`) : '',
      alert.area ? row(say('Affected Area'), `<p>${esc(alert.area)}</p>`) : '',
      alert.source || alert.url
        ? row(
            say('Issued By'),
            alert.source ? `<p>${esc(alert.source)}</p>` : '',
            `${Number.isFinite(alert.sent) ? `<small>${say('Last updated: {time}', { time: esc(when(alert.sent)) })}</small>` : ''}${alert.url ? `<a href="${esc(alert.url)}" target="_blank" rel="noreferrer">${say('View Alert Source')}</a>` : ''}`,
          )
        : '',
    ];
    return `<details class="alert-detail"${i === open ? ' open' : ''}><summary>${esc(alert.event)}<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5"/></svg></summary>${rows.join('')}</details>`;
  });
  return `<div class="alert-details">${sections.join('')}</div>`;
}
// Its title: "Severe Weather Alert", or how many there are.
export const alertsTitle = (count: number): string =>
  count > 1
    ? sayCount('{count} Severe Weather Alerts', '{count} Severe Weather Alerts', count)
    : say('Severe Weather Alert');
export const alertsCard: SheetCard = {
  id: 'alerts',
  title: phrase('Severe Weather Alert'),
  sheet: ({ ctx, alerts, variant }) =>
    `${sheetHeader(
      alertIcon(alerts.map(alert => alert.severity)),
      alertsTitle(alerts.length),
    )}${alertsDetail(ctx, alerts, Number(variant))}`,
};
