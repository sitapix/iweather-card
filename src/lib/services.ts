// Addresses of the services more than one part of the card asks. None needs a key.

// Open-Meteo: forecasts, the air, and the record of past years.
export const OPEN_METEO = {
  forecast: 'https://api.open-meteo.com/v1/forecast',
  airQuality: 'https://air-quality-api.open-meteo.com/v1/air-quality',
  archive: 'https://archive-api.open-meteo.com/v1/archive',
} as const;
// A place to Open-Meteo, to about 100 m: finer only splits what its caches can share.
export const COORDINATE_DIGITS = 3;
export const atPlace = (latitude: number, longitude: number): string =>
  `latitude=${latitude.toFixed(COORDINATE_DIGITS)}&longitude=${longitude.toFixed(COORDINATE_DIGITS)}`;

// RainViewer: its radar frames, and the tiles of where its radar reaches, black where it has
// nothing and see-through where it reaches: one tile, or with `{z}`, `{x}` and `{y}` the template
// a map fills in.
export const RAINVIEWER = { frames: 'https://api.rainviewer.com/public/weather-maps.json' } as const;
const COVERAGE_TILE = 512;
export const coverageTile = (zoom: number | string, x: number | string, y: number | string): string =>
  `https://tilecache.rainviewer.com/v2/coverage/0/${COVERAGE_TILE}/${zoom}/${x}/${y}/0/0_0.png`;
