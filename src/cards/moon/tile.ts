import { PERCENT } from '../../lib/html.ts';
import type { TileContext } from '../shared/context.ts';
import { moonInfo, moonGlyph } from './rules.ts';
import { nextMoonPhase, MOON_PHASE, moonTilt, PHASE_DIGITS } from '../../sky/sky.ts';
import { daysUntil } from '../../weather/forecast-items.ts';
import { DAY } from '../../lib/time.ts';
import { header, factList } from '../shared/tile.ts';
import { clock } from '../shared/tile.ts';
import { phrase, say, sayCount } from '../../weather/words.ts';
type MoonEvent = 'Moonrise' | 'Moonset';
const NEXT_EVENT: Readonly<Record<MoonEvent, string>> = {
  Moonrise: phrase('Next Moonrise'),
  Moonset: phrase('Next Moonset'),
};
// The line under the moon on its next rise or set, each way whole: today's at its time, a later one
// as the next, and one more than a day away in days.
function eventLine(kind: MoonEvent, next: boolean, days: number, time: string): string {
  const rise = kind === 'Moonrise';
  if (days > 0) {
    if (next)
      return rise
        ? sayCount('Next Moonrise: {count} day', 'Next Moonrise: {count} days', days)
        : sayCount('Next Moonset: {count} day', 'Next Moonset: {count} days', days);
    return rise
      ? sayCount('Moonrise: {count} day', 'Moonrise: {count} days', days)
      : sayCount('Moonset: {count} day', 'Moonset: {count} days', days);
  }
  if (next) return rise ? say('Next Moonrise: {time}', { time }) : say('Next Moonset: {time}', { time });
  return rise ? say('Moonrise: {time}', { time }) : say('Moonset: {time}', { time });
}
export function moonTile(ctx: TileContext): string | null {
  const info = moonInfo(ctx.now, ctx.latitude, ctx.longitude),
    south = ctx.latitude !== undefined && ctx.latitude < 0;
  // The wide tile lists the facts beside the moon; the grid picks which layout shows (see
  // pageFit), so both are in the markup.
  const full = nextMoonPhase(MOON_PHASE.full, ctx.now),
    days = full === null ? null : daysUntil(full, ctx.now, ctx.timeZone);
  const facts: [label: string, value: string][] = [[say('Illumination'), `${ctx.fmt(info.illumination * PERCENT)}%`]];
  // Today's rise or set by name; a later one is the next, and past a day away goes by days.
  const event = info.event,
    next = event !== null && daysUntil(event.time, ctx.now, ctx.timeZone) > 0,
    daysOff = event ? Math.floor((event.time - ctx.now) / DAY) : 0;
  if (event)
    facts.push([
      say(next ? NEXT_EVENT[event.kind] : event.kind),
      daysOff > 0 ? sayCount('{count} day', '{count} days', daysOff) : clock(event.time, ctx),
    ]);
  if (days !== null)
    facts.push([
      say('Next Full Moon'),
      days <= 0 ? say('Today') : sayCount('{count} <small>day</small>', '{count} <small>days</small>', days),
    ]);
  // The moon as it stands in the sky now, turned with its axis; upside down in the south without a place.
  const turn = moonTilt(ctx.now, ctx.latitude, ctx.longitude) ?? (south ? Math.PI : 0);
  return `${header(moonGlyph(info.phase, south), say(info.name))}${factList(`${ctx.id}-moon`, facts)}
      <div class="moon"><canvas class="moon-disc" data-phase="${info.phase.toFixed(PHASE_DIGITS)}" data-turn="${turn.toFixed(PHASE_DIGITS)}" aria-hidden="true"></canvas></div>
      <p>${
        event
          ? eventLine(event.kind, next, daysOff, clock(event.time, ctx))
          : say('{percent}% illuminated', { percent: ctx.fmt(info.illumination * PERCENT) })
      }</p>`;
}
