import type { PlotPoint } from './series.ts';
import type { TileContext } from '../cards/shared/context.ts';
import { finite } from '../lib/values.ts';
import { phrase, say } from '../weather/words.ts';
// Today against yesterday: the sentence, and the two values it compares as the bars show them.
// Each is compared as it reads: humidity's average, wind's peak gust (its highest speed when a
// day has no gusts), UV's peak in whole numbers, equal when they read the same; the highest
// visibility, the same only when it reads the same; the high temperature within 5 °F.
export interface Comparison {
  text: string;
  today: number;
  yesterday: number;
  shown: readonly [today: string, yesterday: string];
}
export type Compare = (
  today: readonly PlotPoint[],
  yesterday: readonly PlotPoint[],
  ctx: Pick<TileContext, 'fmt' | 'attrs'>,
) => Comparison;
export const compareDays = (
  compare: Compare | undefined,
  today: readonly PlotPoint[],
  yesterday: readonly PlotPoint[],
  ctx: Pick<TileContext, 'fmt' | 'attrs'>,
): Comparison | null => (compare && today.length && yesterday.length ? compare(today, yesterday, ctx) : null);
export const values = (points: readonly PlotPoint[]): number[] => points.map(point => point.value);
export const gusts = (points: readonly PlotPoint[]): number[] => points.map(point => point.gust).filter(finite);
export const highest = (points: readonly PlotPoint[]): number => Math.max(...values(points));
// What is compared, in whole sentences, as a word like "higher" takes after its noun in many
// languages.
const COMPARED = {
  high: {
    similar: phrase('The high temperature today is similar to yesterday.'),
    higher: phrase('The high temperature today is higher than yesterday.'),
    lower: phrase('The high temperature today is lower than yesterday.'),
  },
  humidity: {
    similar: phrase('The average humidity today is similar to yesterday.'),
    higher: phrase('The average humidity today is higher than yesterday.'),
    lower: phrase('The average humidity today is lower than yesterday.'),
  },
  gust: {
    similar: phrase('The peak gust speed today is similar to yesterday.'),
    higher: phrase('The peak gust speed today is higher than yesterday.'),
    lower: phrase('The peak gust speed today is lower than yesterday.'),
  },
  wind: {
    similar: phrase('The wind speed today is similar to yesterday.'),
    higher: phrase('The wind speed today is higher than yesterday.'),
    lower: phrase('The wind speed today is lower than yesterday.'),
  },
  uv: {
    similar: phrase('The peak UV index today is similar to yesterday.'),
    higher: phrase('The peak UV index today is higher than yesterday.'),
    lower: phrase('The peak UV index today is lower than yesterday.'),
  },
} as const;
// The sentence and bars for two values, `similar` or else higher or lower.
export function compareResult(
  noun: keyof typeof COMPARED,
  a: number,
  b: number,
  shown: (value: number) => string,
  similar: boolean,
): Comparison {
  const way = similar ? 'similar' : a > b ? 'higher' : 'lower';
  return { text: say(COMPARED[noun][way]), today: a, yesterday: b, shown: [shown(a), shown(b)] };
}
// The comparison's two bars, today's and yesterday's, each as long as its value against the larger
// (both full when neither is above zero), with the value just after it. The longest bar leaves room
// for the longest value, which each row holds again, unseen, to size the column bars are a share of.
const SHARE_DIGITS = 3;
export function comparisonMarkup(compared: Pick<Comparison, 'text' | 'today' | 'yesterday' | 'shown'>): string {
  const most = Math.max(compared.today, compared.yesterday),
    share = (value: number) => (most > 0 ? Math.min(1, Math.max(0, value / most)) : 1);
  const bar = (label: string, value: number, shown: string, yesterday: boolean) => {
    return `<div${yesterday ? ' data-yesterday' : ''} style="--share:${share(value).toFixed(SHARE_DIGITS)}"><span>${label}</span><b>${shown}</b><i>${shown}</i></div>`;
  };
  return `<p>${compared.text}</p><div class="compare-bars">${bar(say('Today'), compared.today, compared.shown[0], false)}${bar(say('Yesterday'), compared.yesterday, compared.shown[1], true)}</div>`;
}
