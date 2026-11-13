import { expect, test } from 'vitest';
import { normalizeConfig } from '../src/card/config.ts';
import { minutePoints, nextHourOf } from '../src/cards/next-hour/rules.ts';
import { HOUR, MINUTE } from '../src/lib/time.ts';

const NOW = Date.UTC(2026, 10, 3, 12);
const point = (minutes: number, precipitation = 1) => ({
  datetime: new Date(NOW + minutes * MINUTE).toISOString(),
  precipitation,
});

test('duplicate timestamps do not turn an hourly forecast into a nowcast', () => {
  expect(minutePoints([point(0), point(0), point(60)], NOW)).toEqual([]);
});

test('a replacement nowcast reading at the same time takes precedence without changing its step', () => {
  expect(minutePoints([point(0), point(5), point(0, 2)], NOW)).toEqual([
    { time: NOW, value: 2, step: 5 * MINUTE },
    { time: NOW + 5 * MINUTE, value: 1, step: 5 * MINUTE },
  ]);
});

test('an expired nowcast stops showing rain instead of carrying its final reading indefinitely', () => {
  const points = [point(0), point(5)];
  expect(minutePoints(points, NOW + HOUR)).toEqual([]);
  expect(minutePoints(points, NOW + 10 * MINUTE)).toEqual([]);
  expect(minutePoints(points, NOW + 9 * MINUTE)).toEqual([{ time: NOW + 5 * MINUTE, value: 1, step: 5 * MINUTE }]);
});

test('unknown minutes neither backfill a future shower nor extend an expiring reading', () => {
  const config = normalizeConfig({ entity: 'weather.home', weather_layout: 'page' }),
    panel = (...minutes: number[]) =>
      nextHourOf(
        config,
        undefined,
        undefined,
        NOW,
        undefined,
        undefined,
        minutes.map(minute => point(minute, 4)),
      ).data;
  expect(panel(55, 59)).toBeUndefined();
  const ending = panel(-6, -1);
  expect(ending?.series.filter(rate => rate !== null)).toEqual([4, 4, 4, 4]);
  expect(ending?.text).toBe('Rain · Now–+4m');
  const later = panel(10, 15, 35);
  expect(later?.past).toBe(0);
  expect(later?.series.slice(19, 22)).toEqual([4, null, null]);
  expect(later?.text).toBe('Rain · +10m–+20m');
});
