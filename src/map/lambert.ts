// A Lambert conformal conic projection on a sphere: the plane regional forecast models lay their
// grids out on. A cone touches or cuts the sphere along one or two standard parallels, about a
// central meridian; a place's distance down the cone from its tip, and its angle about it, make
// metres east and north.
import { HALF_TURN, FULL_TURN } from '../lib/compass.ts';

export interface LambertCone {
  // The standard parallels, the same twice where the cone only touches; in degrees.
  parallels: readonly [number, number];
  // The central meridian, in degrees east.
  meridian: number;
  // The sphere's radius, in metres.
  radius: number;
}

const RADIANS = Math.PI / HALF_TURN,
  QUARTER_PI = Math.PI / 4,
  // Parallels closer than this are one: the cone touches rather than cuts.
  TOUCHING = 1e-9;

// Metres east and north of the cone's tip for a place. North grows upward, so a grid's rows,
// each a fixed number of metres apart, follow it.
export function lambert({ parallels: [first, second], meridian, radius }: LambertCone) {
  const one = first * RADIANS,
    two = second * RADIANS,
    tan = (latitude: number) => Math.tan(QUARTER_PI + latitude / 2),
    n =
      Math.abs(one - two) < TOUCHING
        ? Math.sin(one)
        : Math.log(Math.cos(one) / Math.cos(two)) / Math.log(tan(two) / tan(one)),
    scale = (radius * Math.cos(one) * tan(one) ** n) / n;
  return (latitude: number, longitude: number): { x: number; y: number } => {
    const reach = scale / tan(latitude * RADIANS) ** n,
      turn = ((((longitude - meridian + HALF_TURN) % FULL_TURN) + FULL_TURN) % FULL_TURN) - HALF_TURN,
      angle = n * turn * RADIANS;
    return { x: reach * Math.sin(angle), y: -reach * Math.cos(angle) };
  };
}
