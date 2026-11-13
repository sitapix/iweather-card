import type { TileContext } from '../shared/context.ts';
import { sunPath } from './rules.ts';
import { percent } from '../../lib/html.ts';
import { DAY } from '../../lib/time.ts';
import { header } from '../shared/tile.ts';
import { clock } from '../shared/tile.ts';
import { glyphs } from '../shared/glyphs.ts';
import { phrase, say, sayCount } from '../../weather/words.ts';
// The sun's glyph rises or sets with the event named, in English.
export const sunGlyph = (event: string | undefined): string => (event === 'Sunset' ? glyphs.sunset : glyphs.sun);
// The sun tile's day curve: across 100 by 60, a cosine filling the height, in 48 steps; its
// line 5 px, the horizon 1.25 px (4 and 1 on screen at the standard size); the sun placed to
// three places.
// Past a week, how far off the next sunrise or sunset is stops mattering.
const WEEK_DAYS = 7;
const SUN_CHART = {
  width: 100,
  height: 60,
  middle: 30,
  swing: 30,
  steps: 48,
  line: 5,
  horizonLine: 1.25,
  digits: 3,
} as const;
// The curve above the horizon is shaded across the day, brightest at noon: by day white, clear
// at either end and half at noon; by night a dark grey at 60% at either end, white at 30%
// through the middle tenth.
interface LineStop {
  at: number;
  rgb: readonly number[];
  opacity: number;
}
export const WHITE_LEVEL = 255,
  WHITE = [WHITE_LEVEL, WHITE_LEVEL, WHITE_LEVEL],
  LINE_GREY = [58, 58, 60];
const SUN_LINE: Record<'day' | 'night', readonly LineStop[]> = {
  day: [
    { at: 0, rgb: WHITE, opacity: 0 },
    { at: 0.5, rgb: WHITE, opacity: 0.5 },
    { at: 1, rgb: WHITE, opacity: 0 },
  ],
  night: [
    { at: 0, rgb: LINE_GREY, opacity: 0.6 },
    { at: 0.45, rgb: WHITE, opacity: 0.3 },
    { at: 0.55, rgb: WHITE, opacity: 0.3 },
    { at: 1, rgb: LINE_GREY, opacity: 0.6 },
  ],
};
// SVG blends between stops colour and opacity apart, which lights a stop's colour where it is
// nearly clear; these stops blend it by weight of opacity instead, in a few steps between each
// pair, so the grey darkens the night line's ends rather than greying its middle. Each is
// written to three places.
const LINE_BLEND_STEPS = 4,
  STOP_DIGITS = 3;
function lineStops(stops: readonly LineStop[]): string {
  const blended = stops.flatMap((stop, i) => {
    const next = stops[i + 1];
    if (!next) return [stop];
    return Array.from({ length: LINE_BLEND_STEPS }, (_, k): LineStop => {
      const t = k / LINE_BLEND_STEPS,
        opacity = stop.opacity + (next.opacity - stop.opacity) * t;
      return {
        at: stop.at + (next.at - stop.at) * t,
        rgb: stop.rgb.map((c, j) =>
          opacity ? (c * stop.opacity * (1 - t) + (next.rgb[j] ?? c) * next.opacity * t) / opacity : (next.rgb[j] ?? c),
        ),
        opacity,
      };
    });
  });
  return blended
    .map(
      ({ at, rgb, opacity }) =>
        `<stop offset="${at.toFixed(STOP_DIGITS)}" stop-color="rgb(${rgb.map(Math.round).join(' ')})" stop-opacity="${opacity.toFixed(STOP_DIGITS)}"/>`,
    )
    .join('');
}

export function sunTile(ctx: TileContext): string | null {
  const path = sunPath(ctx.sun, ctx.now, ctx.timeZone);
  if (!path) return null;
  const events: [[string, number], [string, number]] = path.up
      ? [
          [phrase('Sunset'), path.setting],
          [phrase('Sunrise'), path.rising],
        ]
      : [
          [phrase('Sunrise'), path.rising],
          [phrase('Sunset'), path.setting],
        ],
    [main, other] = events;
  const { width: W, height: H, middle, swing, steps } = SUN_CHART,
    y = (level: number) => (middle - level * swing).toFixed(1),
    points = Array.from(
      { length: steps + 1 },
      (_, i) => `${((i / steps) * W).toFixed(1)} ${y(Math.cos(2 * Math.PI * (i / steps - 1 / 2)))}`,
    );
  const level = path.level(ctx.now),
    horizon = y(path.horizon),
    x = (path.progress * W).toFixed(1),
    sunY = Number(y(level)),
    horizonY = Number(horizon);
  // The sun is drawn twice, each half of the chart showing its own: above the horizon a white
  // disc in a soft glow, below it a dark disc ringed in white. A sun at the horizon shows a
  // little of each, and one just under it still lights the sky above with its glow. Each sits
  // at --y of the way across its half, from the top down to the horizon or from the horizon
  // down to the foot.
  const sunAt = (from: number, to: number) =>
    `--x:${x}%;--y:${((sunY - from) / (to - from)).toFixed(SUN_CHART.digits)};--h:${percent(horizonY / H)}`;
  // Polar day or night: the next event is more than a day off, so say how many, up to a week.
  const far = main[1] - ctx.now > DAY,
    days = Math.ceil((main[1] - ctx.now) / DAY);
  if (far)
    return `${header(sunGlyph(main[0]), say(main[0]))}<div class="big">${days > WEEK_DAYS ? sayCount('&gt;{count} <small>day</small>', '&gt;{count} <small>days</small>', WEEK_DAYS) : sayCount('{count} <small>day</small>', '{count} <small>days</small>', days)}</div><div class="sub">${path.up ? say('Up all day') : say('Down all day')}</div><p>${path.up ? say('No sunset today.') : say('No sunrise today.')}</p>`;
  const then = clock(other[1], ctx);
  // The curve's line reaches past the box at its peak and trough, so the halves' clips do too:
  // the night half dark below the horizon, the day half shaded above it.
  return `${header(sunGlyph(main[0]), say(main[0]))}<div class="big">${clock(main[1], ctx)}</div>
      <div class="sun-path"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><clipPath id="day-${ctx.id}"><rect y="${-H}" width="${W}" height="${Number(horizon) + H}"/></clipPath><clipPath id="night-${ctx.id}"><rect y="${horizon}" width="${W}" height="${H}"/></clipPath>
        <linearGradient id="line-${ctx.id}" gradientUnits="userSpaceOnUse" x2="${W}">${lineStops(SUN_LINE[path.up ? 'day' : 'night'])}</linearGradient></defs>
        <path d="M${points.join('L')}" fill="none" stroke="#00000033" stroke-width="${SUN_CHART.line}" vector-effect="non-scaling-stroke" clip-path="url(#night-${ctx.id})"/>
        <path d="M${points.join('L')}" fill="none" stroke="url(#line-${ctx.id})" stroke-width="${SUN_CHART.line}" vector-effect="non-scaling-stroke" clip-path="url(#day-${ctx.id})"/>
        <path d="M0 ${horizon}H${W}" stroke="#ffffff8c" stroke-width="${SUN_CHART.horizonLine}" vector-effect="non-scaling-stroke"/></svg>
      <i class="sun-day" style="${sunAt(0, horizonY)}"></i><i class="sun-night" style="${sunAt(horizonY, H)}"></i></div><p>${path.up ? say('Sunrise: {time}', { time: then }) : say('Sunset: {time}', { time: then })}</p>`;
}
