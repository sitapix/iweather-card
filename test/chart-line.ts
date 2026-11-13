import { CURVES, heightAt, type XY } from '../src/sheets/curve.ts';
import { finite, isList, isRecord } from '../src/lib/values.ts';

// A chart's markup attribute, as it was before it was escaped.
export const attributeIn = (markup: string, name: string): string | undefined =>
  new RegExp(`data-${name}="([^"]*)"`)
    .exec(markup)?.[1]
    ?.replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');

// A line chart's reading, as its markup lists it: the minutes it can be read between, what it
// reads at a minute (its value's line and the line under it, without the time the sheet gives it),
// where its line stands at an hour, and the minutes its reading changes at.
export function lineIn(markup: string) {
  const parsed: unknown = JSON.parse(attributeIn(markup, 'line') ?? 'null');
  if (!isRecord(parsed)) throw new Error('No line to read.');
  const { start, from, to } = parsed,
    curve = CURVES.find(name => name === parsed['curve']),
    places = isList(parsed['places'])
      ? parsed['places'].flatMap((place): XY[] => {
          const [hour, top] = isList(place) ? place : [];
          return finite(hour) && finite(top) ? [[hour, top]] : [];
        })
      : [],
    reads = isList(parsed['reads'])
      ? parsed['reads'].flatMap(item => {
          const [minute, label] = isList(item) ? item : [];
          return finite(minute) && typeof label === 'string' ? [{ minute, label }] : [];
        })
      : [];
  if (!finite(start) || !finite(from) || !finite(to) || !curve) throw new Error('A line half listed.');
  return {
    start,
    from,
    to,
    reads,
    at: (minute: number) => reads.findLast(read => read.minute <= minute)?.label,
    topAt: heightAt(places, curve),
  };
}
