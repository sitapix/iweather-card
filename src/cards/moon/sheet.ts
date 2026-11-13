import { PERCENT } from '../../lib/html.ts';
import { HOUR, MINUTE, SECOND, DAY } from '../../lib/time.ts';
import { dateFormat } from '../../lib/formats.ts';
import { dayAxis, part } from '../../sheets/days.ts';
import type { TileContext } from '../shared/context.ts';
import { moonGlyph, moonInfo, moonHeading } from './rules.ts';
import { clockOf, REFERENCE_YEAR } from '../../sheets/time.ts';
import { nextMoonPhase, MOON_PHASE, moonDistance, PHASE_DIGITS, moonAxis, moonPhase } from '../../sky/sky.ts';
import { daysUntil, dateKey } from '../../weather/forecast-items.ts';
import { AUTO, UNITS, convertUnit } from '../../weather/units.ts';
import { type About, rows, sheetHeader, aboutMarkup, sheetPanel, sheetSection } from '../../sheets/parts.ts';
import { NOON } from '../sun/sheet.ts';
import type { SheetView } from '../card.ts';
import { finite } from '../../lib/values.ts';
import { glyphs } from '../shared/glyphs.ts';
import { phrase, say, sayCount } from '../../weather/words.ts';
// The moon sheet: the disc, its phase, rise and set, the next full and new
// moons and the distance, then a month of phases. `month` steps from this month.
// The moon timeline: a strip of two-hour ticks, white at midnight, with the day's name
// across its day, scrolled under a fixed marker. Two weeks either side of now.
export const MOON_HOUR_PX = 84 / 24,
  MOON_SPAN_DAYS = 14;
// A tick is drawn with a line's round ends, so it runs that much short of the strip's 25.6.
export const MOON_TICK = { hours: 2, top: 1, foot: 24.6 } as const;
const MOON_ARROW = '<svg viewBox="0 0 15 26.9" aria-hidden="true"><path d="M13.8 1.15 1.2 13.45l12.6 12.3"/></svg>';
// Where a step to the day before or after lands on the moon's strip from `left`: that day's
// midnight, or nothing past either end. Days aren't all as long, so `midnights` lists where they are.
// A scroller can come to rest a shade short of where it was sent, which still counts as there.
const MOON_NEAR = 0.5;
export function moonStep(left: number, forward: boolean, midnights: readonly number[]): number | undefined {
  return midnights[midnights.findLastIndex(midnight => midnight <= left + MOON_NEAR) + (forward ? 1 : -1)];
}
// The start of the hour `time` is in, by the clock where the card is: half-hour zones don't turn
// their hours with the world's.
function moonHour(time: number, timeZone: string | undefined): number {
  const parts = dateFormat('en-US', { minute: 'numeric', second: 'numeric', timeZone }).formatToParts(time);
  return time - part(parts, 'minute') * MINUTE - part(parts, 'second') * SECOND - (time % SECOND);
}

// What the moon sheet reads: the place, the clock and the distance unit the card uses.
export type MoonContext = Pick<
  TileContext,
  'latitude' | 'longitude' | 'timeZone' | 'locale' | 'now' | 'hour12' | 'fmt' | 'config' | 'attrs' | 'hass'
>;
// The part of the moon sheet that follows the timeline: the moon, its phase and the
// moment, then the day's moonrise and moonset in order, the next full moon and the
// distance. `offset` is milliseconds from now, a whole number of hours. Returns the part above
// the timeline and the part below it.
export function moonLive(ctx: MoonContext, offset = 0): [hero: string, list: string] {
  const { latitude, longitude, timeZone, locale } = ctx,
    at = ctx.now + offset,
    today = dateKey(at, timeZone) === dateKey(ctx.now, timeZone),
    south = latitude !== undefined && latitude < 0;
  const info = moonInfo(at, latitude, longitude);
  // Today it has its weekday, and any other day only its date. A 24-hour clock reads 13:00, not 13.
  const hours: Intl.DateTimeFormatOptions = { hour: 'numeric', timeZone, hour12: ctx.hour12 },
    moment = dateFormat(locale, {
      ...(today ? { weekday: 'long' } : {}),
      month: 'long',
      day: 'numeric',
      ...hours,
      ...(dateFormat(locale, hours).resolvedOptions().hour12 ? {} : { minute: '2-digit' }),
    }).format(moonHour(at, timeZone));
  const time = clockOf(ctx);
  // Moonrise and moonset on the chosen day, in the order they happen. The moon rises and
  // sets about 50 minutes later each day, so once a month a day has no rise and another no
  // set: that row stays and reads a dash, so the rows never change.
  const { start: midnight, hours: dayHours } = dayAxis(at, timeZone),
    day = moonInfo(midnight, latitude, longitude);
  const events = (
    [
      [phrase('Moonrise'), day.rise],
      [phrase('Moonset'), day.set],
    ] as const
  )
    .flatMap(([label, value]): [string, number][] => (value === null ? [] : [[label, value]]))
    .sort((a, b) => a[1] - b[1])
    .map(([label, value]): [string, string] => [say(label), value < midnight + dayHours * HOUR ? time(value) : '-']);
  const full = nextMoonPhase(MOON_PHASE.full, at),
    days = full === null ? null : daysUntil(full, at, timeZone);
  const units = ctx.config.distance_unit,
    miles =
      units && units !== AUTO
        ? units === UNITS.miles
        : ctx.attrs.visibility_unit
          ? ctx.attrs.visibility_unit === UNITS.miles
          : ctx.hass?.config?.unit_system?.length === UNITS.miles;
  const km = moonDistance(at),
    distance = `${ctx.fmt(miles ? convertUnit('distance_unit', km, UNITS.kilometers, UNITS.miles) : km)} <small>${miles ? UNITS.miles : UNITS.kilometers}</small>`;
  return [
    // North up, as a sky chart has it, turned with the Moon's axis at the chosen moment:
    // it leans a little further each day through the month. Upside down in the south.
    `<canvas class="moon-disc" data-phase="${info.phase.toFixed(PHASE_DIGITS)}" data-turn="${((south ? Math.PI : 0) - moonAxis(at)).toFixed(PHASE_DIGITS)}" aria-hidden="true"></canvas><b>${say(moonHeading(info.phase))}</b><span${today ? '' : ' data-away'}>${moment}</span>`,
    rows([
      [say('Illumination'), `${ctx.fmt(info.illumination * PERCENT)}%`],
      ...events,
      [
        say('Next Full Moon'),
        days === null
          ? ''
          : days <= 0
            ? say('Today')
            : sayCount('{count} <small>day</small>', '{count} <small>days</small>', days),
      ],
      [say('Distance'), distance],
    ]),
  ];
}

// The calendar's weeks start on Sunday: 2 January 2000 was one.
const DAYS_PER_WEEK = 7;
const A_SUNDAY = Date.UTC(REFERENCE_YEAR, 0, 2);
// A calendar day shows one of twenty moons: new, full, and nine each way between them. A day takes
// step k when its share lit at its start is nearest k tenths, waxing or waning as the Moon is then,
// so each holds for longer near new and full than at the half. The nine are drawn 15° of the cycle
// apart, from 30° past new to 30° short of full: step k at (k + 1) 24ths of the cycle.
const CALENDAR_STEPS = 10,
  CALENDAR_DRAWN = 24;
function calendarPhase(phase: number): number {
  const step = Math.round(((1 - Math.cos(2 * Math.PI * phase)) / 2) * CALENDAR_STEPS),
    drawn = step === 0 ? 0 : step === CALENDAR_STEPS ? MOON_PHASE.full : (step + 1) / CALENDAR_DRAWN;
  return phase < MOON_PHASE.full ? drawn : (1 - drawn) % 1;
}
// A day's symbol (see moonGlyph): new, full or a quarter on the day it comes, by the world's clock as
// the dates under the calendar are, and between them the crescent or gibbous moon it is passing
// through at noon, drawn from the middle of that stretch of the cycle.
const BETWEEN = [0.125, 0.375, 0.625, 0.875] as const;
function symbolPhase(principal: ReadonlyMap<number, number>, date: number, atNoon: number): number {
  return principal.get(date) ?? BETWEEN[Math.floor(atNoon * BETWEEN.length) % BETWEEN.length] ?? atNoon;
}
// Local noon on a calendar date where the card is: the date's UTC noon, moved a day when the
// zone is far enough east or west to put that on another date.
function localNoon(year: number, month: number, day: number, timeZone: string | undefined): number {
  const key = dateKey(Date.UTC(year, month, day), 'UTC');
  let time = Date.UTC(year, month, day) + NOON;
  const shown = dateKey(time, timeZone);
  if (shown !== key) time += shown < key ? DAY : -DAY;
  return dayAxis(time, timeZone).start + NOON;
}
// The times a phase comes round in a month, which is usually once and can be twice or not at all.
// The calendar's days go by the world's clock, so that one place's date for a full moon is every
// place's.
function phasesIn(phase: number, year: number, month: number): number[] {
  const end = Date.UTC(year, month + 1, 1),
    found: number[] = [];
  for (
    let time = nextMoonPhase(phase, Date.UTC(year, month, 1));
    time !== null && time < end;
    time = nextMoonPhase(phase, time + DAY)
  )
    found.push(time);
  return found;
}
export function moonDetail(ctx: MoonContext, month = 0, offset = 0): string {
  const { now, latitude, timeZone, locale } = ctx,
    south = latitude !== undefined && latitude < 0,
    today = dateKey(now, timeZone),
    hour = moonHour(now, timeZone);
  // The calendar's month: `month` steps from this one.
  const parts = dateFormat('en-US', { year: 'numeric', month: 'numeric', timeZone }).formatToParts(now);
  const first = new Date(Date.UTC(part(parts, 'year'), part(parts, 'month') - 1 + month, 1) + NOON),
    year = first.getUTCFullYear(),
    monthIndex = first.getUTCMonth(),
    length = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  // The timeline from local midnight two weeks back to two weeks on, stretched to the day
  // either side of the calendar's month so each of its days can be picked. Its days are as long as
  // the clocks make them. `data-origin` is now's place on it, at the start of its hour, as the hours
  // the moment reads are whole.
  const start = dayAxis(
      Math.min(now - MOON_SPAN_DAYS * DAY, localNoon(year, monthIndex, 1, timeZone) - DAY),
      timeZone,
    ).start,
    end = dayAxis(
      Math.max(now + MOON_SPAN_DAYS * DAY, localNoon(year, monthIndex, length, timeZone) + DAY),
      timeZone,
    ).start,
    place = (time: number) => ((time - start) / HOUR) * MOON_HOUR_PX,
    days = Array.from({ length: Math.round((end - start) / DAY) + 1 }, (_, i) =>
      dayAxis(start + i * DAY + NOON, timeZone),
    );
  const labels = days
    .map(day => {
      const noon = day.start + (day.hours / 2) * HOUR,
        isToday = dateKey(noon, timeZone) === today,
        name = isToday ? say('Today') : dateFormat(locale, { weekday: 'short', timeZone }).format(noon);
      return `<span style="left:${place(noon).toFixed(1)}px"${isToday ? ' data-today' : ''}>${name}</span>`;
    })
    .join('');
  const midnights = days.map(day => place(day.start)),
    ticks = days
      .flatMap(day =>
        Array.from(
          { length: Math.ceil(day.hours / MOON_TICK.hours) - 1 },
          (_, i) =>
            `M${place(day.start + (i + 1) * MOON_TICK.hours * HOUR).toFixed(1)} ${MOON_TICK.top}V${MOON_TICK.foot}`,
        ),
      )
      .join(''),
    width = (midnights.at(-1) ?? 0) + (days.at(-1)?.hours ?? 0) * MOON_HOUR_PX;
  const timeline = `<div class="moon-timeline"><div class="moon-scroll" data-origin="${place(hour).toFixed(1)}" data-midnights="${midnights.map(midnight => midnight.toFixed(1)).join()}" tabindex="0" role="region" aria-label="${say('Moon over the coming and past days')}">
      <div class="moon-track" style="width:${width.toFixed(1)}px"><svg class="moon-ticks" aria-hidden="true"><path d="${ticks}"/><path d="${midnights.map(midnight => `M${midnight.toFixed(1)} ${MOON_TICK.top}V${MOON_TICK.foot}`).join('')}" data-midnight/></svg><i class="moon-here" style="left:${place(hour).toFixed(1)}px" hidden></i>${labels}</div></div><svg class="moon-marker" viewBox="0 0 25 25" aria-hidden="true"><path d="M2 2H23L12.5 23Z"/></svg>
      <button type="button" class="moon-now" hidden aria-label="${say('Back to now')}"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.25"/><path d="M12.5 7.5 8 12l4.5 4.5M8.5 12h8"/></svg></button></div>`;
  // The calendar: the month's days, each with its moon (see calendarPhase), north up, and upside
  // down in the south, or its phase's symbol where the styles show that instead (see moonGlyph). A
  // day moves the timeline to its noon (`data-hours` from now); the day under the marker is pressed.
  const selected = dateKey(now + offset, timeZone),
    named = dateFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', timeZone });
  const phases = Object.values(MOON_PHASE).map(phase => ({ phase, times: phasesIn(phase, year, monthIndex) }));
  const principal = new Map(
    phases.flatMap(({ phase, times }) => times.map(time => [new Date(time).getUTCDate(), phase])),
  );
  const cells = Array.from({ length: first.getUTCDay() }, () => '<span></span>').concat(
    Array.from({ length }, (_, i) => {
      const noon = localNoon(year, monthIndex, i + 1, timeZone),
        key = dateKey(noon, timeZone),
        moon = calendarPhase(moonPhase(dayAxis(noon, timeZone).start));
      return `<button type="button" data-hours="${Math.round((noon - hour) / HOUR)}" data-key="${key}" aria-pressed="${key === selected}"${key === today ? ' aria-current="date"' : ''} aria-label="${named.format(noon)}"><b>${i + 1}</b><canvas class="moon-disc" data-phase="${moon.toFixed(PHASE_DIGITS)}" data-turn="${(south ? Math.PI : 0).toFixed(PHASE_DIGITS)}" aria-hidden="true"></canvas><i class="moon-glyph">${moonGlyph(symbolPhase(principal, i + 1, moonPhase(noon)), south)}</i></button>`;
    }),
  );
  const weekdays = Array.from(
    { length: DAYS_PER_WEEK },
    (_, i) => `<i>${dateFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(A_SUNDAY + i * DAY)}</i>`,
  ).join('');
  const title = dateFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(first);
  const [hero, list] = moonLive(ctx, offset);
  const arrows = ['start', 'end']
    .map(
      edge =>
        `<button type="button" class="moon-arrow" data-edge="${edge}" tabindex="-1" aria-hidden="true">${MOON_ARROW}</button>`,
    )
    .join('');
  const phaseDate = dateFormat(locale, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }),
    dates = (
      [
        [phrase('New Moon'), MOON_PHASE.new],
        [phrase('Full Moon'), MOON_PHASE.full],
      ] as const
    ).flatMap(([label, phase]) =>
      (phases.find(item => item.phase === phase)?.times ?? []).map((time): [string, string] => [
        say(label),
        phaseDate.format(time),
      ]),
    );
  return `<div class="moon-stage"><div class="moon-hero">${hero}</div><div class="moon-arrows">${arrows}</div></div>${timeline}${sheetPanel(`<div class="moon-rows">${list}</div>`)}
    ${sheetSection(
      say('Calendar'),
      `<div class="moon-month"><button type="button" data-month="-1" aria-label="${say('Previous month')}"><svg viewBox="0 0 7.5 13.75" aria-hidden="true"><path d="M6.9.55.9 6.875l6 6.325"/></svg></button><h3>${title}</h3><button type="button" data-month="1" aria-label="${say('Next month')}"><svg viewBox="0 0 7.5 13.75" aria-hidden="true"><path d="M.6.55l6 6.325-6 6.325"/></svg></button></div>
      <div class="moon-week">${weekdays}</div><div class="moon-grid">${cells.join('')}</div>${rows(dates)}`,
      { kind: 'moon-calendar', titleClass: 'moon-calendar-title' },
    )}`;
}
const ABOUT: readonly About[] = [
  [
    phrase('About Illumination'),
    phrase(
      'This is the share of the Moon’s visible face in sunlight at the moment shown, worked out from where it is in its monthly cycle: 0% at new moon and 100% at full. The card doesn’t look at the sky, so the figure is the same whether the Moon is up or set, and whatever the clouds are doing.',
    ),
  ],
  [
    phrase('About Moon Distance'),
    phrase(
      'The Moon’s path around Earth isn’t a circle, so it drifts nearer and farther over the weeks. The figure here runs from the center of Earth to the center of the Moon at the moment shown, roughly 356,000 to 407,000 km (221,000 to 253,000 mi).',
    ),
  ],
];
export function moonSheet({ ctx, title, month, moonOffset }: SheetView): string {
  const latitude = ctx.latitude,
    info = finite(latitude) ? moonInfo(ctx.now, latitude, ctx.longitude) : null;
  return `${sheetHeader(glyphs.moon, title)}${info ? moonDetail(ctx, month, moonOffset) : `<p class="detail-text">${say('Set your home location in Home Assistant to see the moon.')}</p>`}${ABOUT.map(aboutMarkup).join('')}`;
}
