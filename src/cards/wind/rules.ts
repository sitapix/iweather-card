import { windMetersPerSecond } from '../../sky/sky.ts';
import { finite } from '../../lib/values.ts';
import { convertUnit, isBeaufort, METERS_PER_SECOND, UNITS } from '../../weather/units.ts';
import { compass16, POINTS } from '../../lib/compass.ts';
import { phrase, say } from '../../weather/words.ts';
// The Beaufort scale: each force's name, its colour and the whole mph it starts at. Each runs to the
// mile below the next, and the last one has no end.
export const BEAUFORT = [
  { name: phrase('Calm'), color: '#22b9d2', from: 0 },
  { name: phrase('Light air'), color: '#07c3c0', from: 1 },
  { name: phrase('Light breeze'), color: '#00bc8b', from: 3 },
  { name: phrase('Gentle breeze'), color: '#00b556', from: 7 },
  { name: phrase('Moderate breeze'), color: '#24b426', from: 12 },
  { name: phrase('Fresh breeze'), color: '#90b400', from: 18 },
  { name: phrase('Strong breeze'), color: '#d5b300', from: 24 },
  { name: phrase('High wind'), color: '#dda500', from: 31 },
  { name: phrase('Gale'), color: '#df9500', from: 39 },
  { name: phrase('Strong gale'), color: '#e28400', from: 46 },
  { name: phrase('Storm'), color: '#e65305', from: 55 },
  { name: phrase('Violent storm'), color: '#e72d2e', from: 64 },
  { name: phrase('Hurricane-force'), color: '#e81854', from: 73 },
] as const;
// Beaufort force and name from a wind speed.
export function beaufort(speed: number | undefined, unit: string | undefined): { force: number; name: string } | null {
  const ms = windMetersPerSecond(speed, unit);
  if (!finite(speed) || !finite(ms)) return null;
  const force = BEAUFORT.findLastIndex(
      ({ from }) => ms >= convertUnit('wind_speed_unit', from, UNITS.milesPerHour, UNITS.metersPerSecond),
    ),
    name = BEAUFORT[force]?.name;
  return name ? { force, name } : null;
}
// What each force's speeds read: the list in mph, and in any other unit the same list converted, in
// whole numbers but for metres a second, whose numbers are small. A unit the card can't convert to
// has the list in mph, so `unit` names what the speeds are in. The Beaufort scale has no speeds of
// its own to give.
const METRE_DIGITS = 1;
export function beaufortSpeeds(
  shown: string | undefined,
  fmt: (value: number, digits?: number) => string,
): { unit: string; speeds: readonly string[] } | null {
  if (isBeaufort(shown)) return null;
  const unit = shown !== undefined && shown in METERS_PER_SECOND ? shown : UNITS.milesPerHour,
    digits = unit === UNITS.metersPerSecond ? METRE_DIGITS : 0,
    speed = (mph: number) => fmt(convertUnit('wind_speed_unit', mph, UNITS.milesPerHour, unit), digits);
  return {
    unit,
    speeds: BEAUFORT.map(({ from }, force) => {
      const next = BEAUFORT[force + 1]?.from;
      if (!force) return `< ${speed(next ?? from)}`;
      return next === undefined ? `> ${speed(from)}` : `${speed(from)} - ${speed(next - 1)}`;
    }),
  };
}

// The sixteen points as read, in the order of POINTS, by their letters and in words.
const POINT_LETTERS = [
  phrase('N'),
  phrase('NNE'),
  phrase('NE'),
  phrase('ENE'),
  phrase('E'),
  phrase('ESE'),
  phrase('SE'),
  phrase('SSE'),
  phrase('S'),
  phrase('SSW'),
  phrase('SW'),
  phrase('WSW'),
  phrase('W'),
  phrase('WNW'),
  phrase('NW'),
  phrase('NNW'),
];
const POINT_WORDS = [
  phrase('north'),
  phrase('north-northeast'),
  phrase('northeast'),
  phrase('east-northeast'),
  phrase('east'),
  phrase('east-southeast'),
  phrase('southeast'),
  phrase('south-southeast'),
  phrase('south'),
  phrase('south-southwest'),
  phrase('southwest'),
  phrase('west-southwest'),
  phrase('west'),
  phrase('west-northwest'),
  phrase('northwest'),
  phrase('north-northwest'),
];
// A bearing by its letters (WSW); a point an integration gives as it is.
export const bearingPoint = (bearing: number | string | undefined): string => {
  const point = compass16(bearing),
    letters = POINT_LETTERS[POINTS.indexOf(point)];
  return letters ? say(letters) : point;
};
// A bearing in words (west-southwest); a point an integration gives as it is, lower case.
export const bearingName = (bearing: number | string | undefined): string => {
  const point = compass16(bearing),
    name = POINT_WORDS[POINTS.indexOf(point.toUpperCase())];
  return name ? say(name) : point.toLowerCase();
};
