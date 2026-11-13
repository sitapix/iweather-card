// The Sun's position and the day's events from the NOAA solar calculator
// equations (accurate to about a minute away from the poles). Home Assistant's
// sun.sun reports only the next rising and setting; the sun sheet also needs
// today's twilight, the elevation through the day and the longest day.
import { say } from '../weather/words.ts';
import { DAY, HOUR, HOURS_PER_DAY, MINUTE, MINUTES_PER_HOUR } from '../lib/time.ts';
import { FULL_TURN, HALF_TURN, QUARTER_TURN } from '../lib/compass.ts';

const RAD = Math.PI / HALF_TURN;
// Julian dates: the Unix epoch's, and J2000.0's, from which the series count Julian centuries.
const JD_UNIX_EPOCH = 2440587.5,
  JD_J2000 = 2451545,
  DAYS_PER_CENTURY = 36525;
// The Earth turns a degree in four minutes, 15° an hour.
const MINUTES_PER_DEGREE = (HOURS_PER_DAY * MINUTES_PER_HOUR) / FULL_TURN;
const DEGREES_PER_HOUR = FULL_TURN / HOURS_PER_DAY;
// The zenith angles of the day's events: sunrise and sunset at 90.833° (refraction and the
// Sun's radius), first and last light at civil twilight, 96°. As elevations, these are the
// horizon the sun sheet calls daylight, and where twilight ends.
const ZENITH = { sunrise: 90.833, civil: 96 } as const;
export const ELEVATION = { daylight: QUARTER_TURN - ZENITH.sunrise, twilight: QUARTER_TURN - ZENITH.civil } as const;
// A crossing's time is refined in three passes.
const PASSES = 3;
// The solstices, at noon UTC on 21 June and 21 December.
const SOLSTICE = { june: [5, 21], december: [11, 21], hour: 12 } as const;

function orbit(time: number): { declination: number; equation: number } {
  const T = (time / DAY + JD_UNIX_EPOCH - JD_J2000) / DAYS_PER_CENTURY;
  const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % FULL_TURN) + FULL_TURN) % FULL_TURN;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T),
    e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C =
    Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * T,
    lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const epsilon =
    23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(epsilon * RAD) * Math.sin(lambda * RAD));
  const y = Math.tan((epsilon * RAD) / 2) ** 2;
  const equation =
    (MINUTES_PER_DEGREE / RAD) *
    (y * Math.sin(2 * L0 * RAD) -
      2 * e * Math.sin(M * RAD) +
      4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) -
      0.5 * y * y * Math.sin(4 * L0 * RAD) -
      1.25 * e * e * Math.sin(2 * M * RAD));
  return { declination, equation };
}

// Degrees above the horizon, without refraction.
export function solarElevation(time: number, latitude: number, longitude: number): number {
  const { declination, equation } = orbit(time),
    minutes = (((time % DAY) + DAY) % DAY) / MINUTE;
  const minutesPerDay = DAY / MINUTE,
    hourAngle =
      ((((minutes + equation + MINUTES_PER_DEGREE * longitude) % minutesPerDay) + minutesPerDay) % minutesPerDay) /
        MINUTES_PER_DEGREE -
      HALF_TURN,
    phi = latitude * RAD;
  const cosine =
    Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle * RAD);
  return QUARTER_TURN - Math.acos(Math.max(-1, Math.min(1, cosine))) / RAD;
}

// When the Sun's centre reaches `zenith` degrees on the day containing `noon`;
// null when it never does (polar day or night).
// Each pass refines solar noon by the equation of time at the last estimate, from `noon`
// itself: worked out again from its UTC midnight, a noon near the date line lands a day off.
function crossing(noon: number, latitude: number, zenith: number, sign: number): number | null {
  const phi = latitude * RAD,
    base = orbit(noon).equation;
  let time = noon;
  for (let pass = 0; pass < PASSES; pass++) {
    const { declination, equation } = orbit(time);
    const cosine =
      Math.cos(zenith * RAD) / (Math.cos(phi) * Math.cos(declination)) - Math.tan(phi) * Math.tan(declination);
    if (cosine < -1 || cosine > 1) return null;
    const solarNoon = noon + (base - equation) * MINUTE;
    time = solarNoon + ((sign * MINUTES_PER_DEGREE * Math.acos(cosine)) / RAD) * MINUTE;
  }
  return time;
}

// `localNoon`: any instant near noon on the local date (see ZENITH).
export interface SunEvents {
  firstLight: number | null;
  sunrise: number | null;
  noon: number;
  sunset: number | null;
  lastLight: number | null;
  daylight: number;
}
export function sunEvents(localNoon: number, latitude: number, longitude: number): SunEvents {
  const { equation } = orbit(localNoon),
    midnight = Math.floor(localNoon / DAY) * DAY;
  let noon = midnight + (DAY / MINUTE / 2 - MINUTES_PER_DEGREE * longitude - equation) * MINUTE;
  if (noon - localNoon > DAY / 2) noon -= DAY;
  else if (localNoon - noon > DAY / 2) noon += DAY;
  const at = (zenith: number, sign: number) => crossing(noon, latitude, zenith, sign);
  const sunrise = at(ZENITH.sunrise, -1),
    sunset = at(ZENITH.sunrise, 1),
    rise = sunrise ?? 0,
    set = sunset ?? 0;
  return {
    firstLight: at(ZENITH.civil, -1),
    sunrise,
    noon,
    sunset,
    lastLight: at(ZENITH.civil, 1),
    daylight: rise && set ? set - rise : solarElevation(noon, latitude, longitude) > 0 ? DAY : 0,
  };
}

// The longest and shortest days of the year, at the solstices for this hemisphere.
export function daylightExtremes(
  year: number,
  latitude: number,
  longitude: number,
): { longest: { time: number; daylight: number }; shortest: { time: number; daylight: number } } {
  const solstice = ([month, day]: readonly [number, number]) =>
      Date.UTC(year, month, day, SOLSTICE.hour) - (longitude / DEGREES_PER_HOUR) * HOUR,
    june = solstice(SOLSTICE.june),
    december = solstice(SOLSTICE.december);
  const [long, short] = latitude >= 0 ? [june, december] : [december, june];
  return {
    longest: { time: long, daylight: sunEvents(long, latitude, longitude).daylight },
    shortest: { time: short, daylight: sunEvents(short, latitude, longitude).daylight },
  };
}

export const duration = (ms: number): string => {
  const minutes = Math.round(ms / MINUTE);
  return `${Math.floor(minutes / MINUTES_PER_HOUR)}<small>${say('HR')}</small> ${minutes % MINUTES_PER_HOUR}<small>${say('MIN')}</small>`;
};
