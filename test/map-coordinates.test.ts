import { expect, test } from 'vitest';
import { tileGrid, tilePlace, tilePoint } from '../src/map/sources.ts';

test('polar locations stop at the map edge with finite coordinates and drawable tiles', () => {
  for (const latitude of [-90, -89, 89, 90]) {
    const point = tilePoint(latitude, 0, 4),
      place = tilePlace(point.x, point.y, 4),
      tiles = tileGrid(latitude, 0, 4, 400, 200);
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
    expect(Math.abs(place.latitude)).toBeCloseTo(85.05112878);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every(tile => tile.y >= 0 && tile.y < 16)).toBe(true);
  }
});
