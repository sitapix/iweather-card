import { HOUR } from '../../lib/time.ts';

// What fell over the last `hours`, from a precipitation sensor's history (times in ms,
// oldest first). A rate sensor (per hour) is added up over time; a gauge's running total
// counts only its rises, so a midnight reset doesn't subtract the day.
export function recentPrecipitation(
  readings: readonly { time: number; value: number | null }[],
  rate: boolean,
  now: number,
  hours: number,
): { amount: number; partial: boolean } {
  const from = now - hours * HOUR;
  let total = 0,
    covered = 0;
  readings.forEach((reading, i) => {
    const next = readings[i + 1];
    if (rate) {
      const start = Math.max(from, reading.time),
        end = Math.min(now, next?.time ?? now);
      if (end > start && reading.value !== null) {
        covered += end - start;
        total += (Math.max(0, reading.value) * (end - start)) / HOUR;
      }
    } else if (
      next &&
      next.time > from &&
      next.time <= now &&
      next.value !== null &&
      reading.value !== null &&
      next.value > reading.value
    )
      total += next.value - reading.value;
  });
  return { amount: total, partial: rate && covered < now - from };
}
