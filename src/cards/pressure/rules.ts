import { HOUR } from '../../lib/time.ts';
import type { TileContext } from '../shared/context.ts';
import { forecasts } from '../../weather/forecast-items.ts';
import { finite } from '../../lib/values.ts';
import { UNITS } from '../../weather/units.ts';
import { numberFormat } from '../../lib/formats.ts';
// Trend from the reading three hours ago (history) or the forecast three hours ahead: the
// first hour at least two and a half hours on.
export const TREND_AHEAD_HOURS = 2.5;
const TREND_AHEAD = TREND_AHEAD_HOURS * HOUR;
export function pressureTrendNow(ctx: Pick<TileContext, 'attrs' | 'hourly' | 'now' | 'earlier'>): PressureTrend | null {
  const value = ctx.attrs.pressure,
    ahead = forecasts(ctx.hourly).find(entry => entry.time >= ctx.now + TREND_AHEAD && finite(entry.pressure)),
    earlier = ctx.earlier?.['pressure'];
  return pressureTrend(value, ahead?.pressure, ctx.attrs.pressure_unit, finite(earlier) ? earlier : undefined);
}
// A day's change shows in the last place of each: a whole kilopascal is ten hectopascals.
const PRESSURE_DIGITS: Readonly<Record<string, number>> = {
  [UNITS.inchesOfMercury]: 2,
  [UNITS.kilopascals]: 1,
  [UNITS.poundsPerSquareInch]: 2,
};
export const pressureDigits = (unit: string | undefined): number =>
  (unit === undefined ? undefined : PRESSURE_DIGITS[unit]) ?? 0;

// A pressure as it reads: always to the same places (30.10, 101.3), and whole in the small units.
export const pressureNumber = (
  value: number | null | undefined,
  unit: string | undefined,
  locale: string | undefined,
): string => {
  const digits = pressureDigits(unit);
  return finite(value)
    ? numberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
    : '—';
};

// Rising, falling or steady: the change across three hours, past (history) or ahead (forecast).
export type PressureTrend = 'rising' | 'falling' | 'steady';

const PRESSURE_STEP: Readonly<Record<string, number>> = {
  inHg: 0.03,
  hPa: 1,
  Pa: 100,
  mbar: 1,
  kPa: 0.1,
  mmHg: 0.75,
  psi: 0.015,
};

export function pressureTrend(
  current: number | undefined,
  later: number | undefined,
  unit: string | undefined,
  earlier: number | undefined,
): PressureTrend | null {
  if (!finite(current)) return null;
  const step = (unit === undefined ? undefined : PRESSURE_STEP[unit]) ?? 1;
  const change = finite(earlier) ? current - earlier : finite(later) ? later - current : null;
  if (!finite(change)) return null;
  return change >= step ? 'rising' : change <= -step ? 'falling' : 'steady';
}
