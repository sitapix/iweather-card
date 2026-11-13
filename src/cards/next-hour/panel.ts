import type { NextHour } from './rules.ts';
import { precipitationIntensity } from '../../weather/precipitation.ts';
import { percent, esc } from '../../lib/html.ts';
import { MINUTES_PER_HOUR } from '../../lib/time.ts';
import type { Update } from '../../card/update.ts';
import { say } from '../../weather/words.ts';

// The next hour's chart: a bar a minute, in thirds by how heavy it falls, with a tick every ten
// minutes. It is shown while precipitation falls now or starts soon (see NEAR_MINUTES).
const NEXT_TICKS = 6,
  NEXT_LEVELS = 3;

// A bar is 3.75 px wide, rounded 1.25 px at its top, and stops 2.5 px above the baseline, which it
// does by running past a clip that ends there: its square foot is the clip's, whatever the chart's
// height, and its top corners stay round.
const NEXT_BAR = { width: 3.75, radius: 1.25, gap: 2.5 } as const;

// Next-hour tile: its title, a sentence and sixty minutes of intensity. `id` keeps its fill apart
// from another card's. The chart stretches with the tile in percentages, so its bars and lines
// keep their sizes in px at any width and height.
export function nextHourMarkup({ title, text, chart, past, unit, felt }: NextHour, id: string): string {
  const count = chart.length || MINUTES_PER_HOUR,
    levelAt = (band: number) => percent(1 - (band + 1) / NEXT_LEVELS);
  const bars = chart
    .map((value, minute) => {
      if (value === null) return '';
      const level = precipitationIntensity(value, unit, felt);
      if (!(level > 0)) return '';
      return `<rect x="${percent((minute + 1 / 2) / count, 2)}" y="${percent(1 - level)}" width="${NEXT_BAR.width}" height="${percent(level)}" rx="${NEXT_BAR.radius}"${minute < past ? ' class="past"' : ''}/>`;
    })
    .join('');
  // Dashed lines at each level, a solid one at none, and a rule at now once a minute has gone.
  const now = percent(past / count, 2),
    lines =
      Array.from(
        { length: NEXT_LEVELS },
        (_, band) => `<line x2="100%" y1="${levelAt(band)}" y2="${levelAt(band)}"/>`,
      ).join('') +
      '<line class="base" x2="100%" y1="100%" y2="100%"/>' +
      (past > 0 ? `<line class="now" x1="${now}" x2="${now}" y2="100%"/>` : ''),
    axis = Array.from({ length: NEXT_TICKS }, (_, tick) => {
      const minutes = (tick * MINUTES_PER_HOUR) / NEXT_TICKS;
      return past + minutes < count
        ? `<span style="left:${percent((past + minutes) / count)}">${tick ? say('{minutes}m', { minutes }) : say('Now')}</span>`
        : '';
    }).join('');
  return `<i class="glass" aria-hidden="true"></i><div class="tile-content"><strong class="next-title">${esc(title)}</strong><div class="body-window"><div class="panel-body"><p class="next-text">${esc(text)}</p>
      <div class="next-chart"><svg aria-hidden="true"><defs><linearGradient id="next-fill-${id}" gradientUnits="userSpaceOnUse" x2="0" y2="100%"><stop offset="0" stop-color="#caf3fe"/><stop offset="1" stop-color="#86ddff"/></linearGradient><clipPath id="next-foot-${id}"><rect y="${-NEXT_BAR.gap}" width="100%" height="100%"/></clipPath></defs>${lines}<g clip-path="url(#next-foot-${id})"><g transform="translate(${-NEXT_BAR.width / 2})" style="--fill:url(#next-fill-${id})">${bars}</g></g></svg></div>
      <div class="next-axis">${axis}</div></div></div></div>`;
}
export class NextHourPanel {
  readonly node: HTMLElement;
  key: string | undefined;
  constructor(node: HTMLElement) {
    this.node = node;
  }
  draw({ nextHour: { data, felt, key }, ctx }: Update) {
    const { node } = this;
    node.hidden = !data;
    node.toggleAttribute('data-detail', Boolean(data));
    node.tabIndex = data ? 0 : -1;
    node.setAttribute('role', 'button');
    if (this.key === key) return;
    this.key = key;
    if (!data) {
      node.replaceChildren();
      return;
    }
    // Snow's bars are white, a mix's pale blue, rain's blue.
    node.dataset['precipitation'] = felt ?? 'rain';
    node.setAttribute('aria-label', say('{title}. {text}', { title: data.title, text: data.text }));
    node.innerHTML = nextHourMarkup(data, ctx.id);
  }
}
