import { QUARTER_TURN, HALF_TURN, FULL_TURN } from '../../lib/compass.ts';
import type { TileContext } from '../shared/context.ts';
import { finite } from '../../lib/values.ts';
import { addedLight, FILL } from '../shared/light.ts';
import { esc } from '../../lib/html.ts';
import { header, factList } from '../shared/tile.ts';
import { glyphs } from '../shared/glyphs.ts';
import { phrase, say } from '../../weather/words.ts';
import { bearingPoint } from './rules.ts';
// The wind dial: 108 ticks, every ninth (30°) bolder. None within 7° of a letter; those 10°
// off only on a dial large enough to leave them clear (see .compass in the CSS, which sizes it).
const DIAL = { ticks: 108, major: 9, clear: 7, near: 10.5 } as const;
const CARDINAL_ANGLES = [0, QUARTER_TURN, HALF_TURN, HALF_TURN + QUARTER_TURN, FULL_TURN];
// The dial's letters and where each stands. Those places are attributes because a percentage in a
// CSS transform means the text's own box in WebKit, which would pile all four up in the corner.
const DIAL_LETTERS = [
  [phrase('N'), 'x="50%" y="6.875"'],
  [phrase('E'), 'x="100%" dx="-6.875" y="50%"'],
  [phrase('S'), 'x="50%" y="100%" dy="-6.875"'],
  [phrase('W'), 'x="6.875" y="50%"'],
] as const;
// The arrow, drawn with its tail to the north in the dial's 100-unit box and turned by the
// bearing: from where the wind comes, a line out to a disc on the ring; where it goes, a line
// out to a narrow head whose point reaches the ring's edge, its barbs swept back past where
// they meet the line. Both lines start a little over half way out, clear of the speed.
const WIND_ARROW =
  '<path d="M49.02 23.86V5.78H50.98V23.86Z"/><circle cx="50" cy="5.78" r="4.42"/><path class="head" d="M49.02 76.14V88.7L44.92 86.5L50 98.37L55.08 86.5L50.98 88.7V76.14Z"/>';

export function windTile(ctx: TileContext): string | null {
  const { wind_speed: speed, wind_bearing: bearing, wind_speed_unit: unit } = ctx.attrs;
  if (!finite(speed)) return null;
  const gust = ctx.attrs.wind_gust_speed;
  const direction = bearingPoint(bearing);
  // The dial: a dense ring of fine ticks, parted where the cardinal letters sit on it, with a
  // bolder tick every 30°: two evenly between each pair of letters.
  const ticks = Array.from({ length: DIAL.ticks }, (_, i) => {
    const angle = (i * FULL_TURN) / DIAL.ticks;
    return { angle, off: Math.min(...CARDINAL_ANGLES.map(c => Math.abs(angle - c))), major: i % DIAL.major === 0 };
  }).filter(tick => tick.off >= DIAL.clear);
  const marks = (major: boolean) =>
    ticks
      .filter(tick => tick.major === major)
      .map(
        tick =>
          `<rect class="tick${major ? ' major' : ''}${tick.off < DIAL.near ? ' near' : ''}" style="--a:${tick.angle.toFixed(2)}deg"/>`,
      )
      .join('');
  const dial = addedLight(ctx.id, [
    { name: 'dial-minor', shapes: marks(false), ...FILL.tertiary },
    { name: 'dial-major', shapes: marks(true), ...FILL.secondary },
    {
      name: 'dial-letters',
      shapes: DIAL_LETTERS.map(([label, place]) => `<text data-at="${label}" ${place}>${say(label)}</text>`).join(''),
      ...FILL.label,
    },
  ]);
  const arrow = finite(bearing) ? `<g transform="rotate(${bearing} 50 50)">${WIND_ARROW}</g>` : '';
  // The wide tile lists the readings beside the dial; the grid picks which layout shows (see
  // pageFit), so both are in the markup.
  const facts: [label: string, value: string][] = [
    [say('Wind'), `${ctx.fmt(speed)} <small>${esc(unit ?? '')}</small>`],
  ];
  if (finite(gust)) facts.push([say('Gusts'), `${ctx.fmt(gust)} <small>${esc(unit ?? '')}</small>`]);
  if (finite(bearing)) facts.push([say('Direction'), `${Math.round(bearing)}° ${esc(direction)}`]);
  return `${header(glyphs.wind, say('Wind'))}${factList(`${ctx.id}-wind`, facts)}<div class="compass">${dial.lifts}<svg class="dial" aria-hidden="true">${dial.marks}</svg>
        <svg class="needle" viewBox="0 0 100 100" aria-hidden="true">${arrow}</svg>
        <span class="speed"><b>${ctx.fmt(speed)}</b><small>${esc(unit ?? '')}</small></span></div>
      <p>${finite(gust) ? say('Gusts: {speed}', { speed: [ctx.fmt(gust), esc(unit ?? ''), esc(direction)].filter(Boolean).join(' ') }) : direction ? say('From the {direction}', { direction: esc(direction) }) : ''}</p>`;
}
