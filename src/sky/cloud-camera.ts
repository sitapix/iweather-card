import { FRAME, frameUnit } from './cloud-decks.ts';
import type { ScenePreset } from './sky.ts';
import type { SkyKind, WindowClass } from './presets-data.ts';

// In all five window classes the list camera has the same position as the full camera.
// The film X offsets all measure zero. Compact landscape shares compact's film offsets.
type ListCamera = readonly [focal: number, compact: number, portrait: number, landscape: number, ultrawide: number];
const CAMERAS: Readonly<Record<SkyKind, ListCamera>> = {
  blizzard: [100, -500, -500, -500, -500],
  blowingDust: [80, -350, -250, 0, 0],
  blowingSnow: [100, -500, -380, -250, -250],
  clear: [105, -550, -250, -200, -200],
  cloudyHighAltitude: [110, -650, -650, -650, -650],
  cloudyMidAltitude: [110, -650, -650, -650, -650],
  cloudyLowAltitude: [110, -650, -330, -310, -310],
  drizzle: [100, -700, -375, -310, -310],
  flurries: [100, -650, -350, 310, 310],
  foggy: [80, -350, -350, 0, 0],
  freezingDrizzle: [100, -650, -325, -350, -350],
  freezingRain: [100, -650, -350, -250, -250],
  frigid: [105, -550, -250, -200, -200],
  hail: [100, -650, -250, -250, -250],
  haze: [110, -600, -500, -200, -200],
  heavyRain: [100, -550, -290, -200, -200],
  heavySnow: [100, -500, -300, -350, -350],
  hot: [105, -550, -250, -200, -200],
  hurricane: [100, -600, -325, -370, -370],
  isolatedThunderstorms: [110, -700, -450, -300, -300],
  mostlyClear: [105, -550, -250, -200, -350],
  mostlyCloudyHighAltitude: [100, -520, -520, -520, -520],
  mostlyCloudyMidAltitude: [100, -520, -520, -520, -520],
  mostlyCloudyLowAltitude: [100, -520, -300, -225, -225],
  partlyCloudyHighAltitude: [100, -425, -425, -425, -425],
  partlyCloudyMidAltitude: [100, -425, -425, -425, -425],
  partlyCloudyLowAltitude: [100, -425, -225, -225, -225],
  rain: [100, -650, -300, -250, -250],
  scatteredThunderstorms: [110, -700, -400, -250, -250],
  sleet: [100, -650, -300, -250, -250],
  smoky: [110, -600, -250, -200, -200],
  snow: [100, -500, -350, -250, -250],
  strongStorms: [110, -700, -450, -300, -300],
  sunFlurries: [100, -650, -350, 310, 310],
  sunShowers: [100, -550, -300, -215, -215],
  thunderstorms: [110, -700, -450, -335, -335],
  tropicalStorm: [100, -550, -300, -250, -250],
  wintryMix: [100, -500, -275, -225, -225],
};
const FILM_Y: Readonly<Record<WindowClass, 1 | 2 | 3 | 4>> = {
  compact: 1,
  compactLandscape: 1,
  portraitRegular: 2,
  landscapeRegular: 3,
  ultrawide: 4,
};
const STANDARD_SCALE = 0.75;
const DAY_LIST_SCALE = 0.5;

// For dashboard cards we normalize the authored film shift to the 1179-pixel
// width of the 393pt @3x reference viewport. Negative Y moves the picture down
// in CSS pixels. The capped frame width keeps tall clouds visible in shallow strips.
const REFERENCE_PIXELS = 1179;
const ACCESSIBLE_TEXT = [28, 33, 40, 47, 53] as const;
const FILM_MULTIPLIERS = [0.85, 0.78, 0.72, 0.66, 0.6] as const;
const BODY_POINTS = 17;
const BASE_FONT = 16;

// Use CSS root text scaling as the browser equivalent of accessible body-text size.
// Plain page zoom changes the card's measured size, but does not change the user's type tier.
export function listTextScale(rootFontSize: number): number {
  const bodySize = (rootFontSize / BASE_FONT) * BODY_POINTS;
  for (let index = ACCESSIBLE_TEXT.length - 1; index >= 0; index--) {
    if (bodySize >= (ACCESSIBLE_TEXT[index] ?? Infinity)) return FILM_MULTIPLIERS[index] ?? 1;
  }
  return 1;
}

export function cloudCamera(preset: ScenePreset, width: number, height: number, tile: boolean, textScale: number) {
  const camera = preset.look.camera;
  let unit = frameUnit(width, height),
    centerY = height / 2;
  if (tile) {
    const record = CAMERAS[preset.kind],
      scale = preset.stars > 0 || preset.lightning ? STANDARD_SCALE : DAY_LIST_SCALE,
      filmY = record[FILM_Y[preset.windowClass]] * scale * textScale;
    // A longer list lens brings the deck closer. Scaling the crop with the short
    // side keeps the same authored cloud visible in both a 180px tile and a 56px strip.
    centerY -= (filmY / REFERENCE_PIXELS) * unit * FRAME;
    unit = (height / FRAME) * (record[0] / camera.focal);
  }
  return { y: camera.y, z: camera.z, centerX: width / 2, centerY, focalPixels: unit * camera.z };
}
