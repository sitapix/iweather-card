// How light on a cloud becomes brightness on screen, under a fair day's sun.
//
// The lights' strengths fall off toward the ends of the day faster than a sky is seen to dim, and
// summed as they are a morning's clouds come out slate. So the three lights are scaled together to a
// level the eye would settle on (see `exposure`): their balance, and so the cloud's own light and
// shade, stays as it is, and only how bright the whole is changes.
//
// Where the sum still passes what a screen can show, each colour is rolled off toward full rather
// than cut (see `toned`): cut, a pink light over a blue one loses its green and goes garish.
//
// `strength` blends both in: none at night or under rain, snow or lightning, whose skies are tuned
// without them, and all of it under a fair day's sun. None with the sun on the horizon either: there
// the glow opposite the sun is the stronger light by far, and a cloud is dark but for the rims it
// catches.

// The sun's strength, in the lights' own units, from which this comes in and by which it is whole.
export const TONE_DAY = [300, 600] as const;
// The sun's height, in degrees, from which it comes in and by which it is whole.
export const TONE_RISEN = [2, 12] as const;
// Where the roll-off starts, as a share of full.
export const KNEE = 0.75;
// How bright a lit cloud is to be, as a share of full: low with the sun on the horizon, when the
// sky itself is dim, and whole from a sun as strong as a mid-morning's on.
const LEVEL = { low: 0.52, whole: 0.65, from: 625, by: 900 } as const;
// How far the lights may be scaled either way.
const REACH = [0.75, 1.9] as const;
// A cloud's light maps in the middle of their range: how much of the sun's light and of the fill's
// a typical lit pixel takes.
const TYPICAL = { direct: 0.5, opposite: 0.3 } as const;
// How bright each of red, green and blue is to the eye.
const EYE = [0.299, 0.587, 0.114] as const;
// A colour's full strength, as the lights' colours are given.
const FULL = 255;

const share = (value: number, from: number, to: number) => Math.min(1, Math.max(0, (value - from) / (to - from)));
type Light = readonly [red: number, green: number, blue: number, intensity: number];
const seen = ([red, green, blue, intensity]: Light) =>
  ((red * EYE[0] + green * EYE[1] + blue * EYE[2]) / FULL) * intensity;

// How much of this a sky takes: by its sun's strength and height, and none where anything falls or
// flashes.
export function toneStrength(sunIntensity: number, stormy: boolean, elevation: number): number {
  return stormy ? 0 : share(sunIntensity, TONE_DAY[0], TONE_DAY[1]) * share(elevation, TONE_RISEN[0], TONE_RISEN[1]);
}

// What to scale a deck's three lights by, each given with its strength as the deck draws it.
export function exposure(sun: Light, fill: Light, ambient: Light, sunIntensity: number, strength: number): number {
  const lit = seen(sun) * TYPICAL.direct + seen(fill) * TYPICAL.opposite + seen(ambient);
  if (strength <= 0 || lit <= 0) return 1;
  const level = LEVEL.low + (LEVEL.whole - LEVEL.low) * share(sunIntensity, LEVEL.from, LEVEL.by),
    scale = Math.min(REACH[1], Math.max(REACH[0], level / lit));
  return 1 + (scale - 1) * Math.min(1, strength);
}

// One colour of the summed light, rolled off toward full past the knee.
export function toned(light: number, strength: number): number {
  if (strength <= 0 || light <= KNEE) return light;
  const rolled = KNEE + (1 - KNEE) * (1 - Math.exp(-(light - KNEE) / (1 - KNEE)));
  return light + (rolled - light) * Math.min(1, strength);
}

// How far the air's light is drawn toward grey, and how much stronger it is taken. Its colour is the
// sky's own blue, and a cloud's shaded side, lit by it alone, is seen a little greyer than that and
// a good deal lighter: the cloud is white, and lit by its neighbours and the ground as well.
const PALE = 0.25;
const AIR = 0.35;
export function paled([red, green, blue, intensity]: Light, strength: number): [number, number, number, number] {
  const by = Math.min(1, Math.max(0, strength)),
    grey = red * EYE[0] + green * EYE[1] + blue * EYE[2],
    pale = PALE * by;
  return [
    red + (grey - red) * pale,
    green + (grey - green) * pale,
    blue + (grey - blue) * pale,
    intensity * (1 + AIR * by),
  ];
}

// How much of the sun's light reaches a cloud's shaded side, thrown back by the clouds round it: the
// shade under a fair sun is a pale grey, not the sky's blue alone.
const BOUNCE = 0.22;
export function bounced(
  [red, green, blue, intensity]: Light,
  [sunRed, sunGreen, sunBlue, sunIntensity]: Light,
  strength: number,
): [number, number, number, number] {
  const share = BOUNCE * Math.min(1, Math.max(0, strength)) * sunIntensity;
  if (share <= 0 || intensity <= 0) return [red, green, blue, intensity];
  return [
    red + (sunRed * share) / intensity,
    green + (sunGreen * share) / intensity,
    blue + (sunBlue * share) / intensity,
    intensity,
  ];
}
