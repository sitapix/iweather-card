import { finite } from './values.ts';
// Bearings in degrees clockwise from north, and the compass points that name them.
export const FULL_TURN = 360;
export const HALF_TURN = FULL_TURN / 2;
export const QUARTER_TURN = FULL_TURN / 4;
// The sixteen points, clockwise from north; every other one makes the eight.
export const POINTS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
];
export const EIGHT_POINTS = POINTS.filter((_, index) => index % 2 === 0);

// A bearing brought into 0 to 360.
export const normalBearing = (bearing: number): number => ((bearing % FULL_TURN) + FULL_TURN) % FULL_TURN;
// The point nearest `bearing` among `points`, spaced evenly round the compass from north.
export const nearestPoint = (bearing: number, points: readonly string[]): string =>
  points[Math.round(normalBearing(bearing) / (FULL_TURN / points.length)) % points.length] ?? '';
// The bearing a point (N, SSW…) stands for, whatever its case.
export const pointBearing = (point: string): number | undefined => {
  const index = POINTS.indexOf(point.trim().toUpperCase());
  return index < 0 ? undefined : (index * FULL_TURN) / POINTS.length;
};
// A bearing as the nearest of the sixteen points; a point an integration gives as it is.
export const compass16 = (bearing: number | string | undefined): string =>
  finite(bearing) ? nearestPoint(bearing, POINTS) : typeof bearing === 'string' ? bearing : '';
// A bearing as the nearest of the eight points, in the card's language's `compass`.
export function windDirection(bearing: number | string | undefined, compass: readonly string[] = EIGHT_POINTS): string {
  if (finite(bearing)) return nearestPoint(bearing, compass);
  return typeof bearing === 'string' ? bearing : '';
}
