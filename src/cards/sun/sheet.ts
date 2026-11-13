import { DAY, HOUR, HOURS_PER_DAY, MINUTES_PER_HOUR, MINUTE } from '../../lib/time.ts';
import { axisMarks, hourAxis } from '../../sheets/chart.ts';
import { ELEVATION, sunEvents, solarElevation, duration, daylightExtremes } from '../../sky/sun.ts';
import { FULL_TURN } from '../../lib/compass.ts';
import { clockHours, dayAxis, type DayAxis, hoursInto } from '../../sheets/days.ts';
import type { TileContext } from '../shared/context.ts';
import { finite } from '../../lib/values.ts';
import { ampm, clockOf, REFERENCE_DAY } from '../../sheets/time.ts';
import { dateFormat } from '../../lib/formats.ts';
import { percent, esc, PERCENT } from '../../lib/html.ts';
import { pointsAttribute, timeSelector } from '../../sheets/chart-scrub.ts';
import type { SheetView } from '../card.ts';
import { sheetHeader, sheetPanel, sheetSection } from '../../sheets/parts.ts';
import { dateKey } from '../../weather/forecast-items.ts';
import { sunGlyph } from './tile.ts';
import { phrase, say } from '../../weather/words.ts';
import { skyGradientFor } from '../../sky/presets.ts';
import type { SkyKind } from '../../sky/presets-data.ts';
// The sun sheet: the next sunrise or sunset and the daylight it goes with, the Sun's elevation
// through the local day against the horizon, today's light and the year's extremes. The curve takes
// the elevation every quarter hour on one scale for every day and place, from straight down at the
// plot's foot to 98° at its top, so the horizon sits a little over half way down and the curve shows
// how high the Sun really climbs. Gridlines every 30°, the last of them on the foot, and none at
// +90. The sky above the horizon is the weather's (see sunSky), and the curve is one white line drawn twice, faint
// below the horizon and bright above it, each fading towards midnight, with a dot where each
// twilight ends as the Sun sets and begins as it rises: civil at 6° down, nautical at 12°,
// astronomical at 18°.
export const NOON = DAY / 2;
const SAMPLES_PER_HOUR = 4;
export const SUN_PLOT = { width: 375, height: 266.25 } as const;
const SUN_SCALE = { top: 98, foot: -90 } as const;
const SUN_GRID = [-90, -60, -30, 30, 60] as const;
const TWILIGHT_DOTS = [-6, -12, -18] as const;
// Where the Sun's two halves place it, to a ten-thousandth of their sides.
const SUN_DIGITS = 4;
// The band over the horizon is the sky the page draws behind it for the weather now, upside down: the
// colour it shows at the horizon along the band's top, and the colour high overhead along the
// horizon line. It shows at half strength, or at four fifths by day under a sky that hides the Sun:
// overcast, fog, haze, smoke or anything falling.
const FAIR_SKIES: ReadonlySet<SkyKind> = new Set<SkyKind>([
  'clear',
  'mostlyClear',
  'partlyCloudyMidAltitude',
  'partlyCloudyLowAltitude',
  'partlyCloudyHighAltitude',
  'mostlyCloudyMidAltitude',
  'mostlyCloudyLowAltitude',
  'mostlyCloudyHighAltitude',
]);
const SKY_STRENGTH = { fair: 0.5, hidden: 0.8 } as const;
function sunSky(kind: SkyKind, elevation: number, rising: boolean, up: boolean): string {
  const [top, middle, bottom, stop] = skyGradientFor(kind, elevation, rising),
    strength = up && !FAIR_SKIES.has(kind) ? SKY_STRENGTH.hidden : SKY_STRENGTH.fair;
  return `background:linear-gradient(${bottom},${middle} ${percent(1 - stop)},${top});opacity:${strength}`;
}
// Each half of the curve's white along the day, as [where, strength].
const CURVE_FADE = {
  below: [
    [0, 0.05],
    [0.4, 0.3],
    [0.5, 0.35],
    [0.6, 0.3],
    [1, 0.05],
  ],
  above: [
    [0, 0.35],
    [0.4, 0.5],
    [0.5, 0.85],
    [0.6, 0.5],
    [1, 0.5],
  ],
} as const;
const curveFade = (name: keyof typeof CURVE_FADE) =>
  `<linearGradient id="sun-${name}" gradientUnits="userSpaceOnUse" x2="${SUN_PLOT.width}">${CURVE_FADE[name]
    .map(([at, strength]) => `<stop offset="${at}" stop-color="#fff" stop-opacity="${strength}"/>`)
    .join('')}</linearGradient>`;
// Where the Sun is in the day, by its elevation: up (day), then civil, nautical and astronomical
// twilight down to each depth in turn, then night. The chart can be read at any minute.
const SUN_PHASES = [
  [ELEVATION.daylight, phrase('Day')],
  [TWILIGHT_DOTS[0], phrase('Civil Twilight')],
  [TWILIGHT_DOTS[1], phrase('Nautical Twilight')],
  [TWILIGHT_DOTS[2], phrase('Astronomical Twilight')],
] as const;
const sunPhase = (elevation: number) => say(SUN_PHASES.find(([above]) => elevation > above)?.[1] ?? phrase('Night'));

// The sunrises and sunsets from the day before `axis`, as a day's light can run on past midnight
// near the poles, to the first of each after it ends. That can be months away, and at a pole there
// is neither: the search stops after a year.
const DAYS_PER_YEAR = 366,
  YEAR_DIGITS = 4;
function sunCrossings(axis: DayAxis, latitude: number, longitude: number) {
  const rises: number[] = [],
    sets: number[] = [],
    end = axis.start + axis.hours * HOUR;
  for (let day = -1; day <= DAYS_PER_YEAR; day++) {
    if ((rises.at(-1) ?? end) > end && (sets.at(-1) ?? end) > end) break;
    const { sunrise, sunset } = sunEvents(axis.start + day * DAY + NOON, latitude, longitude);
    if (sunrise !== null) rises.push(sunrise);
    if (sunset !== null) sets.push(sunset);
  }
  return { rises, sets };
}

// Each month of a year at a place: its days' sunrise and sunset averaged as clock hours (none in
// a month without them), kept per year and place.
interface SunMonth {
  rise: number | null;
  set: number | null;
}
const MONTHS = 12,
  sunYears = new Map<string, SunMonth[]>();
function sunMonths(year: number, latitude: number, longitude: number, timeZone: string | undefined): SunMonth[] {
  const key = [year, latitude, longitude, timeZone].join('|'),
    kept = sunYears.get(key);
  if (kept) return kept;
  const months = Array.from({ length: MONTHS }, (_, month) => {
    const rises: number[] = [],
      sets: number[] = [];
    for (let day = 1; new Date(Date.UTC(year, month, day)).getUTCMonth() === month; day++) {
      const events = sunEvents(Date.UTC(year, month, day) + NOON - (longitude / FULL_TURN) * DAY, latitude, longitude);
      if (events.sunrise !== null) rises.push(clockHours(events.sunrise, timeZone));
      if (events.sunset !== null) sets.push(clockHours(events.sunset, timeZone));
    }
    const mean = (hours: number[]) => (hours.length ? hours.reduce((sum, hour) => sum + hour, 0) / hours.length : null);
    return { rise: mean(rises), set: mean(sets) };
  });
  sunYears.set(key, months);
  return months;
}
export function sunDetail(
  ctx: Pick<TileContext, 'latitude' | 'longitude' | 'now' | 'timeZone' | 'locale' | 'hour12'>,
  sky: SkyKind = 'clear',
): { title: string; html: string } | null {
  const { latitude, longitude, now, timeZone } = ctx;
  if (!finite(latitude) || !finite(longitude)) return null;
  const axis = dayAxis(now, timeZone),
    midnight = axis.start,
    today = sunEvents(midnight + NOON, latitude, longitude);
  const elevation = solarElevation(now, latitude, longitude),
    rising = solarElevation(now + MINUTE, latitude, longitude) > elevation;
  const clock = (time: number | null, minutes = true) => (time !== null ? clockOf(ctx, minutes)(time) : '—');
  const date = (time: number) => dateFormat(ctx.locale, { month: 'short', day: 'numeric', timeZone }).format(time);
  // While the Sun is up the next sunset comes next, and otherwise the next sunrise.
  const { rises, sets } = sunCrossings(axis, latitude, longitude),
    upAt = (height: number) => height > ELEVATION.daylight,
    nextAfter = (time: number, up: boolean) => (up ? sets : rises).find(event => event > time),
    up = upAt(elevation),
    next = nextAfter(now, up),
    title = up ? phrase('Sunset') : phrase('Sunrise'),
    // Polar day or night: the next event is more than a day off, so it goes by its date.
    far = next !== undefined && next - now > DAY;
  // What comes next from a time on the chart: how long until it, or its date when that's far off.
  const until = (time: number, height: number) => {
    const event = nextAfter(time, upAt(height));
    if (event === undefined) return '';
    const when = event - time > DAY ? date(event) : duration(event - time);
    return upAt(height) ? say('Sunset: {time}', { time: when }) : say('Sunrise: {time}', { time: when });
  };
  // The day's light: sunset less sunrise, or where one is missing, up to the day's end from it.
  const noEvent = today.sunrise === null && today.sunset === null,
    light = noEvent ? today.daylight : (today.sunset ?? midnight + axis.hours * HOUR) - (today.sunrise ?? midnight),
    sub = noEvent
      ? up
        ? say('Up all day')
        : say('Down all day')
      : up && next !== undefined && !far
        ? say('Daylight remaining: {time}', { time: duration(next - now) })
        : say('Total daylight: {time}', { time: duration(light) });
  const samples = Array.from({ length: axis.hours * SAMPLES_PER_HOUR + 1 }, (_, i) => ({
    hour: i / SAMPLES_PER_HOUR,
    value: solarElevation(midnight + i * (HOUR / SAMPLES_PER_HOUR), latitude, longitude),
  }));
  const { width: W, height: H } = SUN_PLOT,
    x = (hour: number) => ((hour / axis.hours) * W).toFixed(1),
    y = (value: number) => (((SUN_SCALE.top - value) / (SUN_SCALE.top - SUN_SCALE.foot)) * H).toFixed(1),
    at = hoursInto(now, timeZone);
  const curve = samples.map((sample, i) => `${i ? 'L' : 'M'}${x(sample.hour)} ${y(sample.value)}`).join('');
  // Where the curve passes each twilight depth, going down in the evening and up in the morning.
  const twilight = TWILIGHT_DOTS.flatMap((depth, step) =>
    samples.slice(1).flatMap((sample, i) => {
      const before = samples[i];
      if (!before || (before.value - depth) * (sample.value - depth) > 0 || before.value === sample.value) return [];
      const hour = before.hour + ((depth - before.value) / (sample.value - before.value)) * (sample.hour - before.hour);
      return [
        `<i class="sun-twilight" data-step="${step}" style="left:${percent(hour / axis.hours)};top:${percent(+y(depth) / H)}"></i>`,
      ];
    }),
  );
  // The chart read at every minute: the phase, the time and what comes next, shown over it, and the
  // hour of the day each falls in, which a finger feels as it passes.
  const dayMinutes = axis.hours * MINUTES_PER_HOUR,
    readings = pointsAttribute(
      Array.from({ length: dayMinutes + 1 }, (_, minute) => {
        const time = midnight + minute * MINUTE,
          height = solarElevation(time, latitude, longitude);
        return [
          (minute / dayMinutes) * PERCENT,
          (+y(height) / H) * PERCENT,
          `${sunPhase(height)}\n${clock(time)}\n${until(time, height)}`,
          minute / MINUTES_PER_HOUR,
        ];
      }),
    );
  const hours = hourAxis(ctx, axis);
  const rows: [label: string, value: string][] = [
    [say('First Light'), clock(today.firstLight)],
    [say('Sunrise Today'), today.sunrise === null ? say('No sunrise today') : clock(today.sunrise)],
    [say('Sunset Today'), today.sunset === null ? say('No sunset today') : clock(today.sunset)],
    [say('Last Light'), clock(today.lastLight)],
    [say('Total Daylight'), duration(light)],
  ];
  const thisYear = Number(dateKey(now, timeZone).slice(0, YEAR_DIGITS)),
    year = daylightExtremes(thisYear, latitude, longitude);
  // The months' average sunrise and sunset, each a bar across the year's earliest sunrise to its
  // latest sunset.
  const months = sunMonths(thisYear, latitude, longitude, timeZone),
    hourClock = dateFormat(ctx.locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC', hour12: ctx.hour12 }),
    clockHour = (hour: number | null) =>
      hour === null ? '—' : ampm(hourClock.format(REFERENCE_DAY + Math.round(hour * MINUTES_PER_HOUR) * MINUTE)),
    monthName = dateFormat(ctx.locale, { month: 'short', timeZone: 'UTC' }),
    earliest = Math.min(...months.flatMap(month => (month.rise === null ? [] : [month.rise]))),
    latest = Math.max(...months.flatMap(month => (month.set === null ? [] : [month.set]))),
    span = latest - earliest || 1;
  const monthRows = months
    .map(({ rise, set }, month) => {
      const bar =
        rise !== null && set !== null
          ? `<i style="left:${percent((rise - earliest) / span)};width:${percent((set - rise) / span)}"></i>`
          : '';
      return `<div><dt>${esc(monthName.format(Date.UTC(thisYear, month, 1)))}</dt><dd>${clockHour(rise)}</dd><dd class="sun-span">${bar}</dd><dd>${clockHour(set)}</dd></div>`;
    })
    .join('');
  // The hours' lines run on through their row, and a solid one at 24 hours ends the plot: inside it,
  // on a day that runs longer.
  const marks = axisMarks(axis)
    .slice(1)
    .map(
      hour =>
        `<i class="chart-hour"${hour === HOURS_PER_DAY ? ' data-last' : ''} style="left:${percent(hour / axis.hours)}"></i>`,
    )
    .join('');
  const horizon = y(0);
  // The Sun is drawn twice, each side of the horizon showing its own: above it the day's white disc
  // in its glow, below it the night's dark disc ringed in white. One crossing the horizon shows a part
  // of each, and one just under it still lights the sky above with its glow. Each sits at --x of the
  // way across and --y of the way down its side, from the plot's top to the horizon or from the
  // horizon to its foot.
  const sunAt = (from: number, to: number) =>
    `--x:${(at / axis.hours).toFixed(SUN_DIGITS)};--y:${((+y(elevation) - from) / (to - from)).toFixed(SUN_DIGITS)};--h:${percent(+horizon / H)}`;
  const html = `<div class="detail-reading"><span class="detail-time"></span><div class="detail-headline">${far ? date(next) : clock(next ?? null)}</div><div class="detail-sub">${sub}</div></div>
    <div class="chart sun-chart"${up ? ' data-up' : ''} data-readout="detail-reading" data-points="${readings}"><div class="chart-plot"><i class="sun-sky" style="height:${percent(+horizon / H)};${sunSky(sky, elevation, rising, up)}"></i><svg class="sun-grid" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${SUN_GRID.map(degrees => `<path d="M0 ${y(degrees)}H${W}" class="grid"/>`).join('')}</svg>${marks}<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><clipPath id="sun-day"><rect width="${W}" height="${horizon}"/></clipPath><clipPath id="sun-night"><rect y="${horizon}" width="${W}" height="${H}"/></clipPath>${curveFade('above')}${curveFade('below')}</defs>
      <path d="${curve}" class="sun-curve" stroke="url(#sun-below)" clip-path="url(#sun-night)"/><path d="${curve}" class="sun-curve" stroke="url(#sun-above)" clip-path="url(#sun-day)"/>
      <path d="M0 ${horizon}H${W}" class="horizon"/></svg>${twilight.join('')}
      <i class="sun-marker" data-side="day" style="${sunAt(0, +horizon)}"></i><i class="sun-marker" data-side="night" style="${sunAt(+horizon, H)}"></i></div>
      <div class="chart-x" aria-hidden="true">${hours}</div>${timeSelector(0, dayMinutes)}</div>
    ${sheetPanel(`<dl class="sheet-rows sun-rows">${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`)}
    ${sheetSection(say('Sunrise and Sunset Averages'), `<dl class="sheet-rows sun-months">${monthRows}</dl>`, { under: `<p>${say('Longest daylight: {time} {date}', { time: duration(year.longest.daylight), date: date(year.longest.time) })}</p>` })}`;
  return { title, html };
}
export function sunSheet({ ctx, title, nowSky }: SheetView): string {
  const sun = sunDetail(ctx, nowSky);
  return `${sheetHeader(sunGlyph(sun?.title), sun ? say(sun.title) : title)}${sun?.html ?? `<p class="detail-text">${say('Set your home location in Home Assistant to see sunrise and sunset.')}</p>`}`;
}
