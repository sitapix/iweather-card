import { afterEach, expect, test, vi } from 'vitest';
import {
  AIR_CONTOUR_REACH,
  airContours,
  airPoints,
  bandIndex,
  contourField,
  forgetAirContours,
  loadAirContours,
} from '../src/map/air-contours.ts';
import { gridAt, windPoints } from '../src/map/sources.ts';

afterEach(() => {
  forgetAirContours();
  vi.unstubAllGlobals();
});

// A square of good air from 30° to 40° north and 100° to 90° west, a square of unhealthy air at
// its middle, and beside it a square with a hole.
const square = (west: number, south: number, size: number) => [
  [west, south],
  [west + size, south],
  [west + size, south + size],
  [west, south + size],
  [west, south],
];
const sent = {
  type: 'FeatureCollection',
  features: [
    { properties: { gridcode: 4 }, geometry: { type: 'Polygon', coordinates: [square(-96, 34, 2)] } },
    { properties: { gridcode: 1 }, geometry: { type: 'Polygon', coordinates: [square(-100, 30, 10)] } },
    {
      properties: { gridcode: 2 },
      geometry: { type: 'MultiPolygon', coordinates: [[square(-88, 30, 6), square(-86, 32, 2)]] },
    },
    { properties: { gridcode: 9 }, geometry: { type: 'Polygon', coordinates: [square(-80, 30, 2)] } },
    { properties: { gridcode: 2 }, geometry: { type: 'Point', coordinates: [-80, 30] } },
    { properties: {}, geometry: null },
  ],
};

test('contours are read lowest band first, and what is not an area in a band is left out', () => {
  const contours = airContours(sent);
  expect(contours.map(each => each.band)).toEqual([1, 2, 4]);
  expect(contours[1]?.rings).toHaveLength(2);
  expect(airContours(null)).toEqual([]);
  expect(airContours({ features: 'none' })).toEqual([]);
});

test('each band is drawn at the reading that gives its own colour, and between two bands between theirs', () => {
  expect([1, 2, 3, 4, 5, 6].map(bandIndex)).toEqual([25, 75, 125, 175, 250, 400]);
  expect(bandIndex(1.5)).toBe(50);
  expect(bandIndex(0)).toBe(25);
  expect(bandIndex(9)).toBe(400);
});

test('contours are drawn over the points as the index, worse air over better, holes left open, the model beyond them', () => {
  const points = windPoints({ north: 42, south: 28, west: -102, east: -80 }, 0.25),
    model = {
      ...windPoints({ north: 42, south: 28, west: -102, east: -80 }, 5),
      values: new Float32Array(48).fill(60),
    },
    field = contourField(airContours(sent), points, model);
  if (!field) throw new Error('No field.');
  const at = (latitude: number, longitude: number) => gridAt(field, field.values, latitude, longitude);
  // Deep in the good air, in the unhealthy square, in the moderate one and in its hole.
  expect(at(32, -98)).toBeCloseTo(25, 0);
  expect(at(35, -95)).toBeCloseTo(175, 0);
  expect(at(31, -87)).toBeCloseTo(75, 0);
  expect(at(33, -85)).toBeCloseTo(60, 0);
  // Beyond every contour, the model's reading; across an edge, between the two.
  expect(at(41, -101)).toBeCloseTo(60, 0);
  const edge = at(32, -100);
  expect(edge).toBeGreaterThan(27);
  expect(edge).toBeLessThan(58);
  // Without the model, nothing beyond them.
  const alone = contourField(airContours(sent), points);
  expect(alone && gridAt(alone, alone.values, 41, -101)).toBeNaN();
  expect(alone && gridAt(alone, alone.values, 32, -98)).toBeCloseTo(25, 0);
  // None reach these points, so there is no field to draw.
  expect(contourField(airContours(sent), windPoints({ north: 10, south: 0, west: 0, east: 10 }, 0.5))).toBeNull();
  expect(contourField([], points)).toBeNull();
});

test('the contours are asked for only where they reach, at 240 points across, once for every map', async () => {
  const far = windPoints({ north: 55, south: 40, west: 0, east: 20 }, 2),
    near = windPoints({ north: 45, south: 30, west: -110, east: -80 }, 3),
    fine = airPoints(near);
  expect(airPoints(far)).toBeNull();
  expect(fine?.step).toBeCloseTo(((near.cols - 1) * near.step) / 240, 5);
  expect(airPoints(windPoints({ north: 39, south: 38, west: -91, east: -90 }, 0.2))?.step).toBe(0.05);
  expect(AIR_CONTOUR_REACH.west).toBeLessThan(AIR_CONTOUR_REACH.east);
  const fetched = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sent))));
  vi.stubGlobal('fetch', fetched);
  const [first, second] = await Promise.all([loadAirContours(), loadAirContours()]);
  expect(first).toBe(second);
  expect(first).toHaveLength(3);
  expect(fetched).toHaveBeenCalledTimes(1);
  // A request that fails is made again by the next map.
  forgetAirContours();
  fetched.mockImplementationOnce(() => Promise.resolve(new Response('', { status: 503 })));
  await expect(loadAirContours()).rejects.toThrow(/AirNow/);
  await expect(loadAirContours()).resolves.toHaveLength(3);
});
