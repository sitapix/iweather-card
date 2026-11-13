import { clamp } from '../../lib/values.ts';
import { UNITS } from '../../weather/units.ts';
import { type PressureTrend, pressureNumber } from './rules.ts';
import type { TileContext } from '../shared/context.ts';
import { finite } from '../../lib/values.ts';
import { pressureTrendNow } from './rules.ts';
import { FULL_TURN, HALF_TURN } from '../../lib/compass.ts';
import { addedLight, FILL } from '../shared/light.ts';
import { WHITE_LEVEL } from '../sun/tile.ts';
import { header } from '../shared/tile.ts';
import { glyphs } from '../shared/glyphs.ts';
import { esc } from '../../lib/html.ts';
import { phrase, say } from '../../weather/words.ts';
// The pressure gauge's span, 950 to 1075 hPa, in each unit; in another, 3% either side of the
// reading. It sweeps 126° either side of the top: a tick every 6° (60 round, none across the
// bottom), the reading marked at its place.
const PRESSURE_RANGE: Readonly<Record<string, readonly [low: number, high: number]>> = {
  [UNITS.inchesOfMercury]: [28.05, 31.75],
  [UNITS.hectopascals]: [950, 1075],
  [UNITS.pascals]: [95000, 107500],
  [UNITS.millibars]: [950, 1075],
  [UNITS.kilopascals]: [95, 107.5],
  [UNITS.millimetersOfMercury]: [712.6, 806.3],
  [UNITS.poundsPerSquareInch]: [13.8, 15.6],
};
const PRESSURE_SPREAD = 0.03;
const GAUGE = { ticks: 60, reach: 126 } as const;
// The ticks beside the mark are lit by a trail from where the pressure has come: by a rising
// one the ticks over the last tenth of a turn below the mark, by a falling one the tenth above,
// and by a steady one a twentieth either side; white, up to 40% at the mark.
const GAUGE_TRAIL: Record<PressureTrend, { below: number; above: number }> = {
  rising: { below: 0.1, above: 0 },
  falling: { below: 0, above: 0.1 },
  steady: { below: 0.05, above: 0.05 },
};
const TRAIL_LIGHT = 0.4;
// What the trend's mark is called, to someone who can't see it.
const TREND_NAMES: Readonly<Record<PressureTrend, string>> = {
  rising: phrase('rising'),
  falling: phrase('falling'),
  steady: phrase('steady'),
};

export function pressureTile(ctx: TileContext): string | null {
  const { pressure: value, pressure_unit: unit } = ctx.attrs;
  if (!finite(value)) return null;
  const [low, high] = (unit === undefined ? undefined : PRESSURE_RANGE[unit]) ?? [
      value * (1 - PRESSURE_SPREAD),
      value * (1 + PRESSURE_SPREAD),
    ],
    at = high === low ? 1 / 2 : clamp((value - low) / (high - low)),
    mark = -GAUGE.reach + at * 2 * GAUGE.reach;
  const trend = pressureTrendNow(ctx),
    trail = trend ? GAUGE_TRAIL[trend] : { below: 0, above: 0 };
  // Each tick's light from the trail: full at the mark, fading to none a trail's length off.
  const lit = (angle: number) => {
    const off = (angle - mark) / FULL_TURN,
      length = off < 0 ? trail.below : trail.above;
    return length && Math.abs(off) < length ? TRAIL_LIGHT * (1 - Math.abs(off) / length) : 0;
  };
  const ticks = Array.from({ length: GAUGE.ticks }, (_, i) => {
    const turn = (i * FULL_TURN) / GAUGE.ticks,
      angle = turn > HALF_TURN ? turn - FULL_TURN : turn;
    return { angle, light: lit(angle) };
  }).filter(tick => Math.abs(tick.angle) <= GAUGE.reach);
  const tick = (angle: number) => `<rect class="tick" style="--a:${angle}deg"/>`;
  // A lit tick adds the trail's white to the faint fill: its own kind of mark.
  const gauge = addedLight(ctx.id, [
    {
      name: 'gauge-ticks',
      shapes: ticks
        .filter(t => !t.light)
        .map(t => tick(t.angle))
        .join(''),
      ...FILL.tertiary,
    },
    ...ticks
      .filter(t => t.light)
      .map((t, k) => {
        const opacity = FILL.tertiary.opacity + t.light;
        return {
          name: `gauge-lit${k}`,
          shapes: tick(t.angle),
          rgb: FILL.tertiary.rgb.map(c => (c * FILL.tertiary.opacity + WHITE_LEVEL * t.light) / opacity),
          opacity,
        };
      }),
  ]);
  // The trend is marked in the gauge's centre: an arrow up or down, or an equals sign.
  const sign = trend
    ? `<svg class="trend" viewBox="0 0 16 16" role="img" aria-label="${esc(say(TREND_NAMES[trend]))}">${trend === 'steady' ? '<path d="M2.5 5h11M2.5 11h11"/>' : trend === 'rising' ? '<path d="M8 13V3M4 7l4-4 4 4"/>' : '<path d="M8 3v10M4 9l4 4 4-4"/>'}</svg>`
    : '';
  // The reading's mark, a white bar across the ticks, and the ends' names under the sweep.
  return `${header(glyphs.pressure, say('Pressure'))}<div class="gauge">${gauge.lifts}<svg class="ring" aria-hidden="true">${gauge.marks}<rect class="mark" style="--a:${mark.toFixed(1)}deg"/></svg>
        <span>${sign}<b>${pressureNumber(value, unit, ctx.numbers)}</b><small>${esc(unit ?? '')}</small></span><div class="ends" aria-hidden="true"><span>${say('Low')}</span><span>${say('High')}</span></div></div>`;
}
