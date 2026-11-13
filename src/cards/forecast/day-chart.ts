// The little chart on a row of the daily list. Both kinds are worked out in shares of a box that
// keeps its proportions, so that it can give way where a row is short of room: what lies under
// them is drawn in the box's own shares, and what stands over them on the plot's 125 × 30.
import { percent } from '../../lib/html.ts';
import { finite } from '../../lib/values.ts';
import { addedLightBoxes } from '../shared/light.ts';
import type { DaySegment } from './day-detail.ts';
import { DAY_TINT, NIGHT_TINT, speedAt, type WindPoint, windColours, windTop } from './strip-chart.ts';

const PLOT = { width: 125, height: 30, radius: 2.5 } as const;
// Bars 7.5 px wide stand with their middles from one end of the plot to the other, so that the end
// ones overhang it: their box is the plot and that overhang.
const BAR = 7.5;
const BARS_ACROSS = PLOT.width + BAR;
// A line 3.75 px across, in round dashes before now, under a gust band of its colours at 30%.
const LINE = { width: 3.75, dash: 7.5, gust: 0.3 } as const;
const VIEW = `0 0 ${PLOT.width} ${PLOT.height}`;
const SHARE_DIGITS = 4,
  PLOT_DIGITS = 2,
  // Places across a plot, in percent: the bars and the lifts under them stand on the same ones.
  PLACE_DIGITS = 2;
const share = (value: number) => Number(value.toFixed(SHARE_DIGITS));
const plotted = (value: number) => Number(value.toFixed(PLOT_DIGITS));

// A box's tint: added light by day and black by night, each stretch in shares of the box. Rounded
// `each`, every stretch has the plot's corners, as the bars do; rounded at the `ends`, only the
// plot's own corners are, at its first and last stretch.
interface TintBox {
  left: number;
  width: number;
  day: boolean;
}
const RADIUS = `${PLOT.radius}px`;
function tint(boxes: readonly TintBox[], rounded: 'each' | 'ends'): string {
  const rx = rounded === 'each' ? PLOT.radius / BARS_ACROSS : 0,
    rect = ({ left, width }: TintBox) =>
      `<rect x="${share(left)}" width="${share(width)}" height="1" rx="${share(rx)}" ry="${share(PLOT.radius / PLOT.height)}"/>`,
    corners = (box: TintBox) => {
      if (rounded === 'each') return RADIUS;
      const [start, end] = [box === boxes[0] ? RADIUS : 0, box === boxes.at(-1) ? RADIUS : 0];
      return `${start} ${end} ${end} ${start}`;
    },
    lit = boxes.filter(box => box.day),
    { lifts, marks } = addedLightBoxes(
      lit.map(
        box =>
          `inset:0 auto 0 ${percent(box.left, PLACE_DIGITS)};width:${percent(box.width, PLACE_DIGITS)};border-radius:${corners(box)}`,
      ),
      lit.map(rect).join(''),
      DAY_TINT,
    );
  return `${lifts}<svg class="day-tint" viewBox="0 0 1 1" preserveAspectRatio="none">${marks}<g fill="${NIGHT_TINT}">${boxes
    .filter(box => !box.day)
    .map(rect)
    .join('')}</g></svg>`;
}

// A bar to each segment, with a white outline on the one now is in, dry or not. Each fills to
// `shares`' part of it.
export function rainPlot(segments: readonly DaySegment[], shares: readonly number[], now: number | null): string {
  const width = BAR / BARS_ACROSS,
    left = (index: number) => (index / (segments.length - 1)) * (PLOT.width / BARS_ACROSS),
    boxes = segments.map(({ day }, index) => ({ left: left(index), width, day })),
    bars = segments.map((_, index) => {
      const fill = shares[index] ?? 0;
      return `<span class="segment" style="left:${percent(left(index), PLACE_DIGITS)};width:${percent(width, PLACE_DIGITS)}"${index === now ? ' data-now="true"' : ''}>${fill > 0 ? `<span style="height:${percent(fill)}"></span>` : ''}</span>`;
    });
  return `${tint(boxes, 'each')}${bars.join('')}`;
}

// What runs on unbroken, as one stretch.
function runs<Item>(items: readonly Item[], together: (before: Item, after: Item) => boolean): Item[][] {
  const grouped: Item[][] = [];
  for (const item of items) {
    const run = grouped.at(-1),
      last = run?.at(-1);
    if (run && last !== undefined && together(last, item)) run.push(item);
    else grouped.push([item]);
  }
  return grouped;
}
const nextPoint = (before: WindPoint, after: WindPoint) => after.time === before.time + 1;

// The tint side by side in stretches, hard-edged, round only the plot's own corners; on it the
// wind's line, in dashes before now and with a dot there; and over them both a band from the line
// up to the gusts. The scale runs from nothing to the day's own top. A point's `time` is its place
// along the segments.
export function windPlot(
  id: string,
  segments: readonly DaySegment[],
  now: number | null,
  unit: string | undefined,
): string {
  const count = segments.length,
    top = windTop(Math.max(0, ...segments.flatMap(({ speed, gust }) => [speed, gust]).filter(finite)), unit),
    x = (place: number) => (place / (count - 1)) * PLOT.width,
    y = (value: number) => PLOT.height * (1 - value / top),
    at = (place: number, value: number) => `${plotted(x(place))} ${plotted(y(value))}`,
    line = (run: readonly WindPoint[]) => run.map(point => at(point.time, point.speed)).join('L');
  const points = segments.flatMap(({ speed, gust }, time): WindPoint[] =>
      finite(speed) ? [{ time, speed, gust }] : [],
    ),
    band = runs(
      points.filter(point => point.gust !== null),
      nextPoint,
    )
      .filter(run => run.length > 1)
      .map(
        run => `M${run.map(point => at(point.time, point.gust ?? point.speed)).join('L')}L${line([...run].reverse())}Z`,
      )
      .join(''),
    live = now === null ? null : speedAt(points, now);
  // The line, cut at now, each side going out from it so that a dash meets the dot. Without hours
  // from before the segment now is in, the line starts at now.
  const paths = runs(points, nextPoint).flatMap(run => {
    if (now === null || !finite(live)) return [{ run, dashed: false }];
    const moment = { time: now, speed: live, gust: null },
      past = run.filter(point => point.time < now),
      coming = run.filter(point => point.time > now),
      over = past.some(point => point.time < Math.floor(now));
    return [
      { run: over ? [moment, ...[...past].reverse()] : [], dashed: true },
      { run: [moment, ...coming], dashed: false },
    ].filter(path => path.run.length > 1);
  });
  const stroke = `fill="none" stroke="url(#wind-${id})" stroke-width="${LINE.width}" stroke-linecap="round" stroke-linejoin="round"`,
    boxes = runs(
      segments.map(({ day }, index) => ({ left: index / count, width: 1 / count, day })),
      (before, after) => before.day === after.day,
    ).flatMap(run => {
      const [first] = run;
      return first ? [{ ...first, width: run.length / count }] : [];
    }),
    dot =
      now !== null && finite(live)
        ? `<i class="wind-dot" style="left:${percent(x(now) / PLOT.width)};bottom:${percent((PLOT.height - y(live)) / PLOT.height)}"></i>`
        : '';
  return `${tint(boxes, 'ends')}<svg class="day-line" viewBox="${VIEW}" preserveAspectRatio="none"><defs>${windColours(`wind-${id}`, y, unit)}</defs>${paths
    .map(
      ({ run, dashed }) =>
        `<path d="M${line(run)}" ${stroke}${dashed ? ` stroke-dasharray="${LINE.dash} ${LINE.dash}"` : ''}/>`,
    )
    .join(
      '',
    )}</svg>${dot}${band ? `<svg class="day-line" viewBox="${VIEW}" preserveAspectRatio="none"><path d="${band}" fill="url(#wind-${id})" fill-opacity="${LINE.gust}"/></svg>` : ''}`;
}
