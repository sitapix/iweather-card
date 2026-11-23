import { test } from 'vitest';
import assert from 'node:assert/strict';
import { minuteSpans, rainOutlook } from '../src/weather/rain-outlook.ts';

const MINUTE = 60_000,
  HOUR = 60 * MINUTE,
  now = Date.UTC(2026, 10, 13, 6, 20);
const hour = (start: number, wet = false) => ({
  datetime: new Date(start).toISOString(),
  ...(wet ? { precipitation: 0.4 } : { precipitation: 0 }),
});
const dry = Array.from({ length: 12 }, (_, i) => hour(Date.UTC(2026, 10, 13, 6 + i)));
const wetFrom = (first: number) => dry.map((entry, i) => (i >= first ? hour(Date.parse(entry.datetime), true) : entry));

test('the minute forecast decides first: falling now, or starting within the hour', () => {
  const quarters = (wet: number[]) =>
    [0, 1, 2, 3, 4, 5].map(i => ({
      time: Date.UTC(2026, 10, 13, 6, 30) + i * 15 * MINUTE,
      precipitation: wet.includes(i) ? 0.2 : 0,
    }));
  assert.equal(rainOutlook(minuteSpans(undefined, quarters([0]), now), dry, now), 'now');
  assert.equal(rainOutlook(minuteSpans(undefined, quarters([3]), now), dry, now), 'nextHour');
  // Starting an hour or more away, the hourly forecast decides.
  assert.equal(rainOutlook(minuteSpans(undefined, quarters([5]), now), dry, now), 'none');
  // A next-hour reading minute by minute comes before the quarters.
  const series = Array.from({ length: 60 }, (_, minute) => (minute >= 30 ? 1.2 : 0));
  assert.equal(rainOutlook(minuteSpans(series, quarters([0]), now), dry, now), 'nextHour');
});

test('then the hourly forecast: the first wet hour, to the nearest hour from now, an hour under way being the next hour', () => {
  assert.equal(rainOutlook([], wetFrom(0), now), 'nextHour', 'the hour under way');
  assert.equal(rainOutlook([], wetFrom(1), now), 'nextThreeHours', '40 min away reads as 1 hour');
  assert.equal(rainOutlook([], wetFrom(2), now), 'nextThreeHours', '1 h 40 min away reads as 2 hours');
  assert.equal(rainOutlook([], wetFrom(3), now), 'nextSixHours', '2 h 40 min away reads as 3 hours');
  assert.equal(rainOutlook([], wetFrom(5), now), 'nextSixHours', '4 h 40 min away reads as 5 hours');
  assert.equal(rainOutlook([], wetFrom(6), now), 'none', '5 h 40 min away reads as 6 hours');
  // Under half an hour over, the count rounds down.
  assert.equal(rainOutlook([], wetFrom(3), now + 30 * MINUTE), 'nextThreeHours', '2 h 10 min away reads as 2 hours');
  assert.equal(rainOutlook([], dry, now), 'none');
  assert.equal(rainOutlook([], [], now), 'unknown');
  // An hour that began more than an hour ago is passed over.
  const earlier = [hour(now - 2 * HOUR, true), ...dry];
  assert.equal(rainOutlook([], earlier, now), 'none');
});
