import { WIND_LINES } from '../cards/shared/glyphs.ts';
// The weather's symbols: flat, filled and still, each built from the same few parts in a box of
// 32, so that a rain cloud is the cloud with rain under it. A symbol stays centred on its box and
// may run past it: the cloud just fills its width, and the cloud and sun overhangs both sides.
// Nothing is shaded, and only what is thin is a stroke: rays, what falls, and the lines of wind.
const WHITE = '#fff',
  // These two are the sun and the rain wherever they appear.
  YELLOW = '#ffd702',
  CYAN = '#39d1fd';

const strokes = (colour: string, width: string, d: string, extra = '') =>
  `<path fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${extra} d="${d}"/>`;
const moved = (x: string, y: string, part: string, scale = '1') =>
  `<g transform="translate(${x} ${y}) scale(${scale})">${part}</g>`;
const symbol = (...parts: readonly string[]) =>
  `<svg viewBox="0 0 32 32" overflow="visible" aria-hidden="true">${parts.join('')}</svg>`;

// A flat base and three bumps, the highest left of the middle, on circles of 6, 8.8 and 7.2.
const CLOUD = `<path fill="${WHITE}" d="M6 20.5H24.6A7.2 7.2 0 1 0 23.87 6.14A1.1 1.1 0 0 1 22.74 5.46A8.8 8.8 0 0 0 5.88 7.65A1.1 1.1 0 0 1 4.97 8.59A6 6 0 0 0 6 20.5Z"/>`;
// Alone; over what falls from it; and in front of the sun or moon, low on the left.
const WHOLE_CLOUD = moved('.1', '5.75', CLOUD),
  HIGH_CLOUD = moved('1.15', '.6', CLOUD, '.935'),
  FRONT_CLOUD = moved('-3.2', '12.5', CLOUD, '.85');

// A solid disc and eight rounded rays.
const SUN =
  `<circle fill="${YELLOW}" cx="16" cy="16" r="6.9"/>` +
  strokes(
    YELLOW,
    '2.1',
    'M26.3 16H29.3M23.28 23.28L25.4 25.4M16 26.3V29.3M8.72 23.28L6.6 25.4M5.7 16H2.7M8.72 8.72L6.6 6.6M16 5.7V2.7M23.28 8.72L25.4 6.6',
  );
// Behind the cloud at the top right: the disc, cut clear of the cloud, and the rays that show.
const SUN_BEHIND =
  `<path fill="${YELLOW}" d="M15.97 14.22A6.6 6.6 0 1 1 24.69 21A7.52 7.52 0 0 0 17.29 16.3A8.88 8.88 0 0 0 15.97 14.22Z"/>` +
  strokes(
    YELLOW,
    '2.1',
    'M15.9 8.1L14.35 6.55M22.55 5.35V3.15M29.2 8.1L30.75 6.55M31.95 14.75H34.15M29.2 21.4L30.75 22.95',
  );
const star = (x: string, y: string, scale: string) =>
  moved(x, y, `<path fill="${WHITE}" d="M0-1Q.13-.13 1 0Q.13.13 0 1Q-.13.13-1 0Q-.13-.13 0-1Z"/>`, scale);
// A crescent open to the upper right, with two four-point stars in the opening.
const CRESCENT = `<path fill="${WHITE}" d="M12.6 6.9A11.6 11.6 0 1 0 26 21.2A10.1 10.1 0 0 1 12.6 6.9Z"/>`,
  STARS = star('24.65', '11.8', '4.4') + star('18.9', '5.3', '3.2');
// Behind the cloud at the top right: the crescent as it is alone, open to the top right, so its
// hollow faces away from the cloud and leaves no dark gap against it, and cut clear of the cloud
// as the sun is.
const MOON_BEHIND = `<path fill="${WHITE}" d="M32.23 14.63A8.5 8.5 0 0 1 24.7 20.97A7.52 7.52 0 0 0 17.29 16.3A8.88 8.88 0 0 0 15.6 13.82A8.5 8.5 0 0 1 22.41 4.15A7.4 7.4 0 0 0 32.23 14.63Z"/>`;
// With something falling, the cloud and what is behind it shrink to make room for it under the
// cloud. The moon reaches less far to the right, so all of it moves over to stay centred.
const falling = (behind: string, fall: string) =>
    moved('3.5', '-1.24', behind + FRONT_CLOUD, '.78') + moved('-3.2', '1', fall),
  sunOver = (fall: string) => falling(SUN_BEHIND, fall),
  moonOver = (fall: string) => moved('1.2', '0', falling(MOON_BEHIND, fall));

// Three slanted strokes; broken, they are drizzle.
const RAIN_PATH = 'M9.8 22.6L7.4 29.8M16.8 22.6L14.4 29.8M23.8 22.6L21.4 29.8',
  RAIN = strokes(CYAN, '2.1', RAIN_PATH),
  DRIZZLE = strokes(CYAN, '2.1', RAIN_PATH, ' stroke-dasharray="2 3.6"'),
  HEAVY_RAIN = strokes(CYAN, '2.3', 'M7.8 22.2L5 31M14 22.2L11.2 31M20.2 22.2L17.4 31M26.4 22.2L23.6 31');
const flakes = (...at: readonly string[]) =>
  strokes(WHITE, '1.3', at.map(place => `M${place}m0-2.6v5.2m-2.25-3.9l4.5 2.6m0-2.6l-4.5 2.6`).join(''));
const SNOW = flakes('9.5 25.6', '16.5 28.6', '23.5 25.6'),
  FLURRIES = flakes('11 27.2', '21 27.2'),
  HEAVY_SNOW = flakes('6.5 25', '13 28.6', '19.5 25', '26 28.6'),
  // Rain and snow together, a stroke either side of a flake.
  SLEET = strokes(CYAN, '2.1', 'M9.3 22.6L6.9 29.8M25.3 22.6L22.9 29.8') + flakes('16.3 26.3'),
  HAIL = `<g fill="${WHITE}"><circle cx="9" cy="25" r="2.3"/><circle cx="16" cy="28.9" r="2.3"/><circle cx="23" cy="25" r="2.3"/></g>`,
  FOG = strokes(WHITE, '2.4', 'M4.5 24.8H27.5M8.5 29.6H23.5');
// A bolt under the cloud, with a stroke of rain either side when it rains.
const BOLT = `<path fill="${YELLOW}" d="M18.3 21.2L12.6 27.2H15.9L13.6 31.2L20.1 24.8H16.6L19.5 21.2Z"/>`,
  BOLT_RAIN = strokes(CYAN, '2.1', 'M9 22.6L6.6 29.8M26 22.6L23.6 29.8'),
  BOLT_HEAVY_RAIN = strokes(CYAN, '2.3', 'M5.2 22.2L2.4 31M10.6 22.2L7.8 31M25.2 22.2L22.4 31M30.6 22.2L27.8 31');

// Above three bars of haze: the top of a sun, with its rays, or the moon.
const HAZE = strokes(WHITE, '2.2', 'M3.5 21.6H28.5M6.5 26.1H25.5M10 30.6H22'),
  HAZY_SUN =
    `<circle fill="${YELLOW}" cx="16" cy="11.6" r="5.5"/>` +
    strokes(YELLOW, '2.1', 'M16 2.9V1.5M22.2 5.4L23.2 4.4M24.7 11.6H26.2M9.8 5.4L8.8 4.4M7.3 11.6H5.8');

// A second cloud behind, fainter.
const SMOKE = `<g fill-opacity=".55">${moved('6', '3.2', CLOUD, '.82')}</g>${moved('-.6', '11.2', CLOUD, '.88')}`;
// A ring with two arms, one sweeping off each way.
const ARM = 'M6.6 16.6C5.4 9.6 14 2.6 27.6 3.4C22.2 5.2 19.8 7 19.3 9.5A7.8 7.8 0 0 0 6.6 16.6Z',
  HURRICANE = `<circle fill="none" stroke="${WHITE}" stroke-width="3.8" cx="16" cy="16" r="4.6"/><path fill="${WHITE}" d="${ARM}"/><path fill="${WHITE}" transform="rotate(180 16 16)" d="${ARM}"/>`;
// A clear day hot enough to say so: a thermometer beside the sun.
const HEAT = moved(
  '-1.5',
  '.4',
  `<circle fill="${YELLOW}" cx="21.4" cy="13.6" r="6.1"/>` +
    strokes(
      YELLOW,
      '2.1',
      'M21.4 4.5V2.6M27.9 7.1L29.2 5.8M30.5 13.6H32.4M27.9 20.1L29.2 21.4M21.4 22.7V24.6M14.9 7.1L13.6 5.8',
    ) +
    `<path fill="${WHITE}" d="M4.1 8.6A2.9 2.9 0 0 1 9.9 8.6V19.6A5.4 5.4 0 1 1 4.1 19.6Z"/>`,
);
// A half disc over the horizon, its rays, and an arrow up or down.
const SUN_ON_HORIZON =
  `<path fill="${YELLOW}" d="M8.7 26.2A7.3 7.3 0 0 1 23.3 26.2Z"/>` +
  strokes(YELLOW, '2.1', 'M2.8 25H6.2M25.8 25H29.2M6.9 15.4L9.5 18M25.1 15.4L22.5 18') +
  strokes(WHITE, '1.9', 'M-.2 29H32.2');
const WARNING = 'M13.7 5L2.8 24.4A2.2 2.2 0 0 0 4.7 27.7H27.3A2.2 2.2 0 0 0 29.2 24.4L18.3 5A2.6 2.6 0 0 0 13.7 5Z',
  MARK = 'M14.5 10.4H17.5L17 20.2H15ZM16 21.7A1.6 1.6 0 1 0 16 24.9A1.6 1.6 0 1 0 16 21.7Z';
// The warning sign, in the colour it is given.
export const warning = (colour: string): string =>
  symbol(`<path fill="${colour}" fill-rule="evenodd" d="${WARNING}${MARK}"/>`);

export const SYMBOLS = {
  sun: symbol(SUN),
  moon: symbol(CRESCENT, STARS),
  cloud: symbol(WHOLE_CLOUD),
  'cloud-sun': symbol(SUN_BEHIND, FRONT_CLOUD),
  'cloud-moon': symbol(moved('1.5', '-1', MOON_BEHIND + FRONT_CLOUD)),
  fog: symbol(HIGH_CLOUD, FOG),
  'sun-haze': symbol(HAZY_SUN, HAZE),
  'moon-haze': symbol(moved('2.6', '-2.8', CRESCENT, '.68'), HAZE),
  smoke: symbol(SMOKE),
  drizzle: symbol(HIGH_CLOUD, DRIZZLE),
  rain: symbol(HIGH_CLOUD, RAIN),
  'heavy-rain': symbol(HIGH_CLOUD, HEAVY_RAIN),
  'sun-rain': symbol(sunOver(RAIN)),
  'moon-rain': symbol(moonOver(RAIN)),
  snow: symbol(HIGH_CLOUD, SNOW),
  flurries: symbol(HIGH_CLOUD, FLURRIES),
  'heavy-snow': symbol(HIGH_CLOUD, HEAVY_SNOW),
  'sun-snow': symbol(sunOver(SNOW)),
  'moon-snow': symbol(moonOver(SNOW)),
  'blowing-snow': symbol(moved('1.4', '-1.6', strokes(WHITE, '1.1', WIND_LINES), '1.85'), flakes('6.5 28', '27 27.5')),
  sleet: symbol(HIGH_CLOUD, SLEET),
  hail: symbol(HIGH_CLOUD, HAIL),
  'sun-storm': symbol(sunOver(BOLT)),
  'moon-storm': symbol(moonOver(BOLT)),
  'storm-rain': symbol(HIGH_CLOUD, BOLT, BOLT_RAIN),
  'sun-storm-rain': symbol(sunOver(BOLT + BOLT_RAIN)),
  'moon-storm-rain': symbol(moonOver(BOLT + BOLT_RAIN)),
  'strong-storm': symbol(HIGH_CLOUD, BOLT, BOLT_HEAVY_RAIN),
  hurricane: symbol(moved('-2.4', '-2.4', HURRICANE, '1.15')),
  wind: symbol(moved('.5', '.5', strokes(WHITE, '1.1', WIND_LINES), '1.94')),
  hot: symbol(HEAT),
  warning: warning(WHITE),
  sunrise: symbol(SUN_ON_HORIZON, strokes(WHITE, '2', 'M16 13.4V3.1M11.6 7.5L16 3.1L20.4 7.5')),
  sunset: symbol(SUN_ON_HORIZON, strokes(WHITE, '2', 'M16 3.1V13.4M11.6 9L16 13.4L20.4 9')),
} as const;
export type SymbolName = keyof typeof SYMBOLS;
