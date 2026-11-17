// The weather's symbols: flat, filled and still, each built from the same few parts in a box of
// 32, so that a rain cloud is the cloud with rain under it. A symbol stays centred on its box and
// may run past it: the cloud just fills its width, and the cloud and sun overhangs both sides.
// Nothing is shaded, and only what is thin is a stroke: rays, what falls, and the lines of wind.
const WHITE = '#fff',
  // These two are the sun and the rain wherever they appear.
  YELLOW = '#ffd702',
  CYAN = '#39d1fd',
  RED = '#ff453a';

const strokes = (colour: string, width: string, d: string, extra = '') =>
  `<path fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${extra} d="${d}"/>`;
const moved = (x: string, y: string, part: string, scale = '1') =>
  `<g transform="translate(${x} ${y}) scale(${scale})">${part}</g>`;
const symbol = (...parts: readonly string[]) =>
  `<svg viewBox="0 0 32 32" overflow="visible" aria-hidden="true">${parts.join('')}</svg>`;

// A flat base and three bumps, the highest left of the middle, on circles of 6, 8.8 and 7.2.
const CLOUD = `<path fill="${WHITE}" d="M6 20.5H24.6A7.2 7.2 0 1 0 23.87 6.14A1.1 1.1 0 0 1 22.74 5.46A8.8 8.8 0 0 0 5.88 7.65A1.1 1.1 0 0 1 4.97 8.59A6 6 0 0 0 6 20.5Z"/>`;
// Alone; over what falls from it; and in front of the sun or the moon, low on the left. Each is
// a little taller than the path is drawn.
const WHOLE_CLOUD = moved('.36', '5.45', CLOUD, '1 1.03'),
  HIGH_CLOUD = moved('1.45', '.73', CLOUD, '.949 .977'),
  SUN_CLOUD = moved('-2.55', '10.91', CLOUD, '.84 .866'),
  MOON_CLOUD = moved('-.55', '8.73', CLOUD, '.835 .86');

// A solid disc and eight rounded rays.
const SUN =
  `<circle fill="${YELLOW}" cx="16" cy="16" r="6.9"/>` +
  strokes(
    YELLOW,
    '2.1',
    'M26.3 16H29.3M23.28 23.28L25.4 25.4M16 26.3V29.3M8.72 23.28L6.6 25.4M5.7 16H2.7M8.72 8.72L6.6 6.6M16 5.7V2.7M23.28 8.72L25.4 6.6',
  );
// Behind the cloud at the top right: the disc, cut clear of the cloud, and the rays that show.
const CLOUD_SUN =
  `<path fill="${YELLOW}" d="M16.23 12.83A6.6 6.6 0 1 1 25.36 21.43A7.3 7.3 0 0 0 17.68 15.14A8.65 8.65 0 0 0 16.23 12.83Z"/>` +
  strokes(
    YELLOW,
    '2.18',
    'M22.2 3.09V5.82M32 15.64H34.91M29.27 8.73L31.27 6.73M13.27 6.73L15.27 8.73M29.27 22.73L31.27 24.73',
  ) +
  SUN_CLOUD;
// A shape whose corners are rounded by a thin stroke of its own colour.
const rounded = (colour: string, d: string) =>
  `<path fill="${colour}" stroke="${colour}" stroke-width=".6" stroke-linejoin="round" d="${d}"/>`;
const star = (x: string, y: string, scale: string) =>
  moved(x, y, `<path fill="${WHITE}" d="M0-1Q.13-.13 1 0Q.13.13 0 1Q-.13.13-1 0Q-.13-.13 0-1Z"/>`, scale);
// A crescent open to the upper right, with two four-point stars in the opening.
const CRESCENT = rounded(WHITE, 'M12.66 8.29A10.8 10.8 0 1 0 25.57 22.53A10.07 10.07 0 0 1 12.66 8.29Z'),
  STARS = star('25.8', '12.7', '5.1') + star('19.5', '5.5', '3.2');
// Behind the cloud at the top right: a crescent open to the top right, so its hollow faces away
// from the cloud, cut clear of the cloud as the sun is.
const CLOUD_MOON =
  `<path fill="${WHITE}" d="M25.58 3.61A8.1 8.1 0 0 0 18.8 11.54A8.6 8.6 0 0 1 19.55 12.92A7.26 7.26 0 0 1 27.24 19.69A8.1 8.1 0 0 0 34.96 12.39A6.6 6.6 0 0 1 25.58 3.61Z"/>` +
  MOON_CLOUD;
// With something falling, the cloud and what is behind it move up, and what falls moves under
// the cloud, which sits left of the middle.
const sunOver = (fall: string, up: string, down: string) => moved('0', up, CLOUD_SUN) + moved('-5.1', down, fall),
  moonOver = (fall: string, up: string, down: string) => moved('0', up, CLOUD_MOON) + moved('-3.5', down, fall);

// Slanted strokes in two lengths: four short ones on two levels are drizzle, short and long by
// turns are rain, and four long ones heavy rain.
const DRIZZLE = strokes(
    CYAN,
    '1.6',
    'M9.02 23.71L7.35 26.65M13.2 27.35L11.53 30.47M19.56 23.71L17.89 26.65M23.74 27.35L22.07 30.47',
  ),
  RAIN = strokes(
    CYAN,
    '1.6',
    'M9.02 23.71L7.35 26.65M14.29 23.71L10.44 30.47M19.56 23.71L17.89 26.65M24.84 23.71L20.98 30.47',
  ),
  HEAVY_RAIN = strokes(
    CYAN,
    '1.6',
    'M8.47 23.71L4.62 30.47M13.75 23.71L9.9 30.47M19.02 23.71L15.17 30.47M24.29 23.71L20.44 30.47',
  );
// A flake is three strokes, six arms.
const flakes = (...at: readonly string[]) =>
  strokes(WHITE, '1.1', at.map(place => `M${place}m0-1.75v3.5m-1.52-2.62l3.03 1.75m0-1.75l-3.03 1.75`).join(''));
// What falls behind a short trail: one long in the middle, one short either side.
const TRAILS = 'M16.47 23.71L14.44 27.38M9.56 23.71L8.7 25.38M23.38 23.71L22.52 25.38';
const SNOW = flakes('8.45 25.19', '15.73 25.19', '23.09 25.19', '5.55 30.19', '12.91 30.19', '20.18 30.19'),
  FLURRIES = flakes('9 25.4', '16.3 29.6', '23.6 25.4'),
  HEAVY_SNOW = flakes(
    '6.2 25.19',
    '12.9 25.19',
    '19.6 25.19',
    '26.3 25.19',
    '4.1 30.19',
    '10.8 30.19',
    '17.5 30.19',
    '24.2 30.19',
  ),
  // Rain and snow together: trails of rain over flakes.
  SLEET = strokes(CYAN, '1.6', TRAILS) + flakes('6.91 29.09', '13.27 31.18', '20.82 29.18'),
  // Three stones, each under its trail.
  HAIL =
    strokes(WHITE, '1.6', TRAILS) +
    `<g fill="${WHITE}"><circle cx="7.1" cy="28.36" r="1.45"/><circle cx="12.82" cy="30.36" r="1.45"/><circle cx="20.9" cy="28.36" r="1.45"/></g>`,
  FOG = strokes(WHITE, '1.64', 'M8.09 24.82H25.36M8.09 29.37H25.36');
// A bolt under the cloud, with two short strokes of rain either side when it rains, and two long
// ones in a strong storm.
const BOLT = `<path fill="${WHITE}" stroke="${WHITE}" stroke-width=".5" stroke-linejoin="round" d="M15.3 23.16H18.25L17.1 26.18H19.9L14.05 32.48L15.65 27.93H13Z"/>`,
  BOLT_RAIN = strokes(
    CYAN,
    '1.6',
    'M7.02 23.71L5.35 26.84M9.56 27.53L7.89 30.48M25.38 23.71L23.71 26.84M27.93 27.53L26.26 30.48',
  ),
  BOLT_HEAVY_RAIN = strokes(
    CYAN,
    '1.6',
    'M6.9 23.71L3.05 30.47M11.4 23.71L7.55 30.47M25.6 23.71L21.75 30.47M30.1 23.71L26.25 30.47',
  );

// Most of a disc on a level edge, with the four rays that show beside and above it; and the
// same with the ray straight up.
const HALF_SUN =
    `<path fill="${YELLOW}" d="M9.46 25.09A7.09 7.09 0 1 1 22.54 25.09Z"/>` +
    strokes(YELLOW, '2.1', 'M1.73 22.09H5.36M26.64 22.09H30.27M6 12.36L8.36 14.73M26 12.36L23.64 14.73'),
  SUN_TOP = HALF_SUN + strokes(YELLOW, '2.1', 'M16 8.18V11.64');
// The crescent, cut level the same way.
const MOON_TOP = rounded(
  WHITE,
  'M13.42 1.65A9.7 9.7 0 0 0 8.35 16.97H23.65A9.7 9.7 0 0 0 25.05 14.49A9.1 9.1 0 0 1 13.42 1.65Z',
);
// Three bars of haze, the middle one set to the left.
const HAZE = strokes(WHITE, '1.64', 'M3.37 20.82H30.63M1.37 25.91H28.63M3.37 31H30.63');
// A bar over three rows of specks.
const DUST =
  strokes(WHITE, '1.64', 'M2.46 20.45H29.36') +
  strokes(
    WHITE,
    '1.36',
    'M3.72 25h0M9.36 25h0M14.9 25h0M20.45 25h0M26.1 25h0M2.1 28.18h0M7.63 28.18h0M13.18 28.18h0M18.8 28.18h0M24.45 28.18h0M30 28.18h0M5.9 31.45h0M11.55 31.45h0M17.2 31.45h0M22.7 31.45h0M28.3 31.45h0',
  );

// Two clouds, the one behind up and to the left and cut clear of the one in front.
const SMOKE = `<path fill="${WHITE}" d="M3.92 19.76A5.4 5.4 0 0 1 4.11 9.2A5.9 5.9 0 0 1 15.12 6.51A4.9 4.9 0 0 1 21.64 8.62A11.18 11.18 0 0 0 8.08 15.72A6.3 6.3 0 0 0 3.92 19.76ZM9.9 26.73A5 5 0 0 1 9.53 16.76A9.48 9.48 0 0 1 27.48 15.97A5.4 5.4 0 0 1 26.6 26.73Z"/>`;
// Two arms sweeping off a storm's eye, one each way: about a disc with a hole in it for a
// hurricane, and about a ring and a dot for a tropical storm.
const ARM = 'M9.2 16C9.2 8 13.5 2.35 23.5 2.35A.75 .75 0 0 1 23.5 3.85C18 4.2 14.2 6.8 12.5 10.3A6.8 6.8 0 0 0 9.2 16Z',
  ARMS = `<path fill="${WHITE}" d="${ARM}"/><path fill="${WHITE}" transform="rotate(180 16 16)" d="${ARM}"/>`,
  HURRICANE = `${ARMS}<path fill="${WHITE}" fill-rule="evenodd" d="M16 9.2A6.8 6.8 0 1 0 16 22.8A6.8 6.8 0 1 0 16 9.2ZM16 14.1A1.9 1.9 0 1 0 16 17.9A1.9 1.9 0 1 0 16 14.1Z"/>`,
  TROPICAL_STORM = `${ARMS}<circle fill="none" stroke="${WHITE}" stroke-width="2.1" cx="16" cy="16" r="5.75"/><circle fill="${WHITE}" cx="16" cy="16" r="1.9"/>`;
// A funnel of five turns, the top one a loop.
const TORNADO = strokes(
  WHITE,
  '1.75',
  'M10.5 2.6C6.5 3.8 4.3 5.6 4.3 7.8C4.3 10.6 9.5 12.6 16.2 12.6C22.8 12.6 28 11 28 8.3C28 6 23.5 5.2 19.5 5.2C16 5.2 12.8 6.2 10.6 7.4M7.05 15.6Q16.8 18.8 26.6 15.4M13.05 21.1Q20.5 22.2 26.75 19.95M15.95 25.55Q20 26 23.7 25.05M15.1 29.82H17.65',
);
// Three lines of wind, each ending in a curl: the top and middle ones up, the bottom one down.
const WIND = strokes(
  WHITE,
  '1.55',
  'M3.5 11.2C6.5 10 9.5 9.6 12.5 10.3C14 10.65 15.2 10.8 16.6 10.8A2.9 2.9 0 1 0 13.75 7.2M3.5 16.4C7 15 10.5 15 14 15.9C18 17 21.5 17.5 25.5 17.3A3.75 3.75 0 1 0 21.8 13.2M3.5 21.4C6.5 20.2 9.5 19.8 12.5 20.4C14 20.75 15.2 20.95 16.4 20.95A2.95 2.95 0 1 1 13.5 24.3',
);
// A thermometer in outline, and what fills it: the bulb and a column up to a height.
const THERMOMETER = `<path fill="${WHITE}" fill-rule="evenodd" d="M6.9 7.1A4.2 4.2 0 0 1 15.3 7.1V19.98A6.9 6.9 0 1 1 6.9 19.98ZM8.95 7.1A2.15 2.15 0 0 1 13.25 7.1V21.1A4.85 4.85 0 1 1 8.95 21.1Z"/>`,
  filled = (colour: string, top: string) =>
    `<circle fill="${colour}" cx="11.1" cy="25.45" r="3.2"/>${strokes(colour, '1.8', `M11.1 ${top}V25.45`)}`;
// A clear day hot enough to say so: a full thermometer in front of the sun.
const HEAT =
  `<path fill="${YELLOW}" d="M16.6 5.51A6.55 6.55 0 1 1 16.6 18.49Z"/>` +
  strokes(YELLOW, '2.18', 'M17.45-.73V2.18M24.36 5.09L26.36 2.91M27.27 12H30M24.36 18.91L26.36 20.91') +
  THERMOMETER +
  filled(RED, '8.5');
// A day cold enough to say so: a thermometer nearly empty, in front of a snowflake.
const COLD =
  strokes(
    WHITE,
    '1.3',
    'M20.55 1V19.9M20.55 4.6l-2.7-1.55M20.55 4.6l2.7-1.55M20.55 16.3l-2.7 1.55M20.55 16.3l2.7 1.55M20.55 10.45L28.73 5.73M20.55 10.45L28.73 15.17M25.62 7.52V4.42M25.62 7.52l2.68 1.55M25.62 13.38V16.48M25.62 13.38l2.68-1.55M20.55 10.45L17.6 8.75M20.55 10.45L17.6 12.15',
  ) + moved('.63', '-1.45', THERMOMETER + filled(CYAN, '18.6'));
// The sun on the horizon, and an arrow up or down.
const SUN_ON_HORIZON = HALF_SUN + strokes(WHITE, '2', 'M.09 27.73H31.91');
const WARNING = 'M13.7 5L2.8 24.4A2.2 2.2 0 0 0 4.7 27.7H27.3A2.2 2.2 0 0 0 29.2 24.4L18.3 5A2.6 2.6 0 0 0 13.7 5Z',
  MARK = 'M14.5 10.4H17.5L17 20.2H15ZM16 21.7A1.6 1.6 0 1 0 16 24.9A1.6 1.6 0 1 0 16 21.7Z';
// The warning sign, in the colour it is given.
export const warning = (colour: string): string =>
  symbol(`<path fill="${colour}" fill-rule="evenodd" d="${WARNING}${MARK}"/>`);

export const SYMBOLS = {
  sun: symbol(SUN),
  moon: symbol(CRESCENT, STARS),
  cloud: symbol(WHOLE_CLOUD),
  'cloud-sun': symbol(CLOUD_SUN),
  'cloud-moon': symbol(CLOUD_MOON),
  fog: symbol(moved('0', '.54', HIGH_CLOUD + FOG)),
  'sun-haze': symbol(moved('0', '-6.73', SUN_TOP), HAZE),
  'moon-haze': symbol(MOON_TOP, moved('0', '-1.09', HAZE)),
  'sun-dust': symbol(moved('0', '-7.09', SUN_TOP), DUST),
  'moon-dust': symbol(moved('-1.09', '-.18', MOON_TOP), moved('0', '-.9', DUST)),
  smoke: symbol(SMOKE),
  drizzle: symbol(HIGH_CLOUD, DRIZZLE),
  rain: symbol(HIGH_CLOUD, RAIN),
  'heavy-rain': symbol(HIGH_CLOUD, HEAVY_RAIN),
  'sun-rain': symbol(sunOver(DRIZZLE, '-4.55', '3.45')),
  'moon-rain': symbol(moonOver(DRIZZLE, '-4.37', '1.27')),
  snow: symbol(moved('0', '-.55', HIGH_CLOUD + SNOW)),
  flurries: symbol(moved('0', '-.55', HIGH_CLOUD + FLURRIES)),
  'heavy-snow': symbol(moved('0', '-.55', HIGH_CLOUD + HEAVY_SNOW)),
  'sun-snow': symbol(sunOver(SNOW, '-4.8', '3.2')),
  'moon-snow': symbol(moonOver(SNOW, '-4.6', '1.05')),
  'blowing-snow': symbol(moved('0', '1.2', WIND), flakes('25.9 5.45', '25.9 24.55')),
  sleet: symbol(moved('0', '-1.09', HIGH_CLOUD + SLEET)),
  hail: symbol(moved('0', '-.18', HIGH_CLOUD + HAIL)),
  'sun-storm': symbol(sunOver(BOLT, '-4.91', '2.91')),
  'moon-storm': symbol(moonOver(BOLT, '-4.73', '.73')),
  'storm-rain': symbol(moved('0', '-.73', HIGH_CLOUD + BOLT + BOLT_RAIN)),
  'sun-storm-rain': symbol(sunOver(BOLT + BOLT_RAIN, '-4.91', '2.91')),
  'moon-storm-rain': symbol(moonOver(BOLT + BOLT_RAIN, '-4.73', '.73')),
  'strong-storm': symbol(moved('0', '-.73', HIGH_CLOUD + BOLT + BOLT_HEAVY_RAIN)),
  hurricane: symbol(HURRICANE),
  'tropical-storm': symbol(TROPICAL_STORM),
  tornado: symbol(TORNADO),
  wind: symbol(WIND),
  hot: symbol(HEAT),
  cold: symbol(COLD),
  warning: warning(WHITE),
  sunrise: symbol(SUN_ON_HORIZON, strokes(WHITE, '2', 'M16 11V2.09M11.82 6.3L16 2.09L20.18 6.3')),
  sunset: symbol(SUN_ON_HORIZON, strokes(WHITE, '2', 'M16 2.09V11M11.82 6.8L16 11L20.18 6.8')),
} as const;
export type SymbolName = keyof typeof SYMBOLS;
