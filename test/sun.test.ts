import { test } from 'vitest';
import assert from 'node:assert/strict';
import { daylightExtremes, solarElevation, sunEvents } from '../src/sky/sun.ts';
import { SUN_PLOT, sunDetail } from '../src/cards/sun/sheet.ts';
import { skyGradientFor } from '../src/sky/presets.ts';

const clock = (time: number | null) =>
  time === null
    ? 'none'
    : new Date(time).toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' });
const STL: [number, number] = [38.63, -90.2];

// St. Louis on Oct 26, 2026: first light 6:54, sunrise 7:21,
// sunset 6:07, last light 6:35, 10 hr 46 min of daylight, longest 14 hr 52 min on Jun 21.
test('sunrise, sunset and twilight are right to the minute', () => {
  const day = sunEvents(Date.parse('2026-10-26T17:00:00Z'), ...STL);
  assert.deepEqual([day.firstLight, day.sunrise, day.sunset].map(clock), ['6:54 AM', '7:21 AM', '6:07 PM']);
  assert.ok(day.lastLight !== null && Math.abs(day.lastLight - Date.parse('2026-10-26T23:35:00Z')) < 90000);
  assert.equal(Math.round(day.daylight / 60000), 646);
  const year = daylightExtremes(2026, ...STL);
  assert.equal(Math.round(year.longest.daylight / 60000), 892);
  assert.equal(new Date(year.longest.time).getUTCDate(), 21);
  assert.ok(year.shortest.daylight < year.longest.daylight);
});

test('the Sun stays up or down all day near the poles', () => {
  const summer = sunEvents(Date.parse('2026-06-21T12:00:00Z'), 78, 15),
    winter = sunEvents(Date.parse('2026-12-21T12:00:00Z'), 78, 15);
  assert.equal(summer.sunrise, null);
  assert.equal(summer.daylight, 86400000);
  assert.equal(winter.sunset, null);
  assert.equal(winter.daylight, 0);
  assert.ok(solarElevation(Date.parse('2026-10-26T18:00:00Z'), ...STL) > 35);
  assert.ok(solarElevation(Date.parse('2026-10-27T06:00:00Z'), ...STL) < -40);
});

const PLACE = { latitude: STL[0], longitude: STL[1], timeZone: 'America/Chicago', locale: 'en-US', hour12: true },
  NORTH = { ...PLACE, latitude: 78.22, longitude: 15.65, timeZone: 'Arctic/Longyearbyen', locale: 'en-US' };
const sheetAt = (time: string, place = PLACE) => {
  const sheet = sunDetail({ ...place, now: Date.parse(time) });
  if (!sheet) throw new Error('No sun sheet.');
  return sheet;
};
const reading = (html: string) =>
  /class="detail-time">(.*?)<\/span><div class="detail-headline">(.*?)<\/div><div class="detail-sub">(.*?)<\/div>/
    .exec(html)
    ?.slice(1)
    .map(part => part.replace(/<[^>]+>/g, ''));

test('at rest the sun sheet names the next event and the daylight that goes with it', () => {
  const before = sheetAt('2026-10-26T06:00:00Z'),
    day = sheetAt('2026-10-26T18:47:00Z'),
    after = sheetAt('2026-10-27T01:46:00Z');
  // No phase and no clock: the next sunrise before it comes, and the day's whole length.
  assert.equal(before.title, 'Sunrise');
  assert.deepEqual(reading(before.html), ['', '7:21AM', 'Total daylight: 10HR 46MIN']);
  // In the day, its sunset and what is left until then.
  assert.equal(day.title, 'Sunset');
  assert.deepEqual(reading(day.html), ['', '6:07PM', 'Daylight remaining: 4HR 21MIN']);
  // After sunset, tomorrow's sunrise over the day just gone.
  assert.equal(after.title, 'Sunrise');
  assert.deepEqual(reading(after.html), ['', '7:22AM', 'Total daylight: 10HR 46MIN']);
});

test('the sun’s chart has a reading for every minute of its day, each with its hour', () => {
  const { html } = sheetAt('2026-10-26T18:47:00Z'),
    list = /data-points="([^"]*)"/.exec(html)?.[1]?.replaceAll('&quot;', '"').replaceAll('&lt;', '<') ?? '[]',
    points: unknown = JSON.parse(list);
  assert.ok(Array.isArray(points));
  assert.equal(points.length, 24 * 60 + 1);
  // 6:07 PM: its place across, its reading and its hour.
  const evening: unknown = points[18 * 60 + 7];
  assert.ok(Array.isArray(evening));
  assert.equal(evening[0], 75.49);
  assert.match(String(evening[2]), /^Day\n6:07<small>PM<\/small>\nSunset: 0<small>HR<\/small> 1<small>MIN<\/small>$/);
  assert.equal(evening[3], 18.1167);
});

test('the sun sheet is read along its chart: the phase, the time and what comes next', () => {
  const { html } = sheetAt('2026-10-26T18:47:00Z');
  for (const phase of ['Night', 'Civil Twilight', 'Nautical Twilight', 'Astronomical Twilight', 'Day'])
    assert.match(html, new RegExp(`${phase}\\\\n`));
  assert.match(html, /Sunrise: \d+&lt;small>HR/);
  assert.match(html, /Sunset: \d+&lt;small>HR/);
  assert.match(html, /data-readout="detail-reading"/);
  // Every month's average sunrise and sunset, December's daylight shorter than June's.
  const spans = [...html.matchAll(/class="sun-span"><i style="left:[\d.]+%;width:([\d.]+)%/g)].map(m => Number(m[1]));
  assert.equal(spans.length, 12);
  assert.ok((spans[5] ?? 0) > (spans[11] ?? 0));
  assert.equal(sunDetail({ ...PLACE, latitude: undefined, now: 0 }), null);
});

test('with no sunrise or sunset the sun sheet goes by the date of the next one', () => {
  const summer = sheetAt('2026-06-21T10:00:00Z', NORTH),
    winter = sheetAt('2026-12-21T10:00:00Z', NORTH);
  assert.equal(summer.title, 'Sunset');
  assert.deepEqual(reading(summer.html)?.slice(2), ['Up all day']);
  assert.match(reading(summer.html)?.[1] ?? '', /^Aug \d+$/);
  assert.match(summer.html, /<dt>Sunrise Today<\/dt><dd>No sunrise today/);
  assert.match(summer.html, /<dt>Total Daylight<\/dt><dd>24<small>HR<\/small> 0<small>MIN/);
  assert.match(summer.html, /data-up/);
  assert.equal(winter.title, 'Sunrise');
  assert.deepEqual(reading(winter.html)?.slice(2), ['Down all day']);
  assert.match(reading(winter.html)?.[1] ?? '', /^Feb \d+$/);
  assert.match(winter.html, /<dt>Sunset Today<\/dt><dd>No sunset today/);
  assert.match(winter.html, /<dt>Total Daylight<\/dt><dd>0<small>HR<\/small> 0<small>MIN/);
  assert.doesNotMatch(winter.html, /data-up/);
  // A polar day is never all one curve's side of nothing: its marks stay on the chart.
  assert.equal(summer.html.match(/class="sun-twilight"/g), null);
  // A month with no sunrise has no bar, and reads none.
  assert.match(winter.html, /<dt>Dec<\/dt><dd>—<\/dd><dd class="sun-span"><\/dd><dd>—/);
});

test('the sun chart puts the horizon past half way, on one scale whatever the day', () => {
  const { html } = sheetAt('2026-10-26T18:47:00Z'),
    { height, width } = SUN_PLOT,
    horizon = Number(/d="M0 ([\d.]+)H375" class="horizon"/.exec(html)?.[1]);
  assert.ok(Math.abs(horizon - 139) < 0.5, `horizon ${horizon}`);
  assert.ok(Math.abs(horizon / height - 0.52) < 0.005);
  const lines = [...html.matchAll(/d="M0 ([\d.]+)H375" class="grid"/g)].map(m => Number(m[1])),
    perDegree = (height - horizon) / 90;
  assert.ok(Math.abs(perDegree - 1.42) < 0.01);
  // Every 30°, down to straight down on the plot's foot, and none at +90.
  assert.deepEqual(
    lines.map(line => Math.round((horizon - line) / perDegree)),
    [-90, -60, -30, 30, 60],
  );
  assert.equal(width, 375);
  // Rules at 6AM, 12PM and 6PM, none at the first 12AM, and a solid one to close the day.
  assert.deepEqual(
    [...html.matchAll(/class="chart-hour"( data-last)? style="left:([\d.]+)%/g)].map(m => [
      Number(m[2]),
      m[1] !== undefined,
    ]),
    [
      [25, false],
      [50, false],
      [75, false],
      [100, true],
    ],
  );
  // Three dots each side.
  assert.equal(html.match(/class="sun-twilight"/g)?.length, 6);
  // Faint and fading below the horizon, bright above it, each across the whole plot.
  const stops = (name: string) =>
    [
      ...(new RegExp(`id="sun-${name}"[^>]*x2="375">(.*?)</linearGradient>`).exec(html)?.[1] ?? '').matchAll(
        /offset="([\d.]+)" stop-color="#fff" stop-opacity="([\d.]+)"/g,
      ),
    ].map(m => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(stops('below'), [
    [0, 0.05],
    [0.4, 0.3],
    [0.5, 0.35],
    [0.6, 0.3],
    [1, 0.05],
  ]);
  assert.deepEqual(stops('above'), [
    [0, 0.35],
    [0.4, 0.5],
    [0.5, 0.85],
    [0.6, 0.5],
    [1, 0.5],
  ]);
  assert.match(html, /stroke="url\(#sun-below\)" clip-path="url\(#sun-night\)"/);
  assert.match(html, /stroke="url\(#sun-above\)" clip-path="url\(#sun-day\)"/);
});

test('the sun chart goes by time gone, so the clocks going back leave a day of 25 hours', () => {
  const { html } = sheetAt('2026-11-01T18:00:00Z');
  assert.deepEqual(
    [...html.matchAll(/class="chart-x"[\s\S]*?<\/div>/g)][0]?.[0]
      .match(/\d+<small>[AP]M/g)
      ?.map(m => m.replace(/<small>/, '')),
    ['12AM', '5AM', '11AM', '5PM'],
  );
  // The last line is inside the plot, at 24 hours of the 25.
  assert.match(html, /class="chart-hour" data-last style="left:96\.0%"/);
});

// Solar noon a few minutes before midnight UTC, as east of about 176°E, kept its sunrise and
// sunset a day early.
test('sunrise and sunset fall on the same day as noon beside the date line', () => {
  const suva = sunEvents(Date.UTC(2026, 10, 3, 0), -18.14, 178.44);
  if (suva.sunrise === null || suva.sunset === null) throw new Error('No sunrise or sunset.');
  assert.ok(suva.noon - suva.sunrise > 6 * 3600000 && suva.noon - suva.sunrise < 7 * 3600000);
  assert.ok(suva.sunset - suva.noon > 6 * 3600000 && suva.sunset - suva.noon < 7 * 3600000);
});

// The band over the horizon: [colours, strength] from the sheet's markup.
const skyBand = (html: string | undefined) => {
  const found = /class="sun-sky" style="[^"]*background:linear-gradient\(([^)]*)\);opacity:([\d.]+)"/.exec(html ?? '');
  return found ? [found[1], Number(found[2])] : undefined;
};
test('the sun chart’s sky is the weather’s turned upside down, stronger by day under a sky that hides the Sun', () => {
  const noon = Date.parse('2026-10-26T18:47:00Z'),
    elevation = solarElevation(noon, ...STL),
    rising = solarElevation(noon + 60_000, ...STL) > elevation;
  for (const [kind, strength] of [
    ['cloudyLowAltitude', 0.8],
    ['rain', 0.8],
    ['foggy', 0.8],
    ['clear', 0.5],
    ['partlyCloudyMidAltitude', 0.5],
    ['mostlyCloudyMidAltitude', 0.5],
  ] as const) {
    const [top, middle, bottom, stop] = skyGradientFor(kind, elevation, rising);
    // The horizon's colour at the band's top, overhead's along the horizon.
    assert.deepEqual(skyBand(sunDetail({ ...PLACE, now: noon }, kind)?.html), [
      `${bottom},${middle} ${(100 * (1 - stop)).toFixed(1)}%,${top}`,
      strength,
    ]);
  }
  // A low overcast is a grey that lightens down to the horizon.
  const [, , low] = skyGradientFor('cloudyLowAltitude', elevation, rising),
    [lowTop] = skyGradientFor('cloudyLowAltitude', elevation, rising);
  assert.equal(String(skyBand(sunDetail({ ...PLACE, now: noon }, 'cloudyLowAltitude')?.html)?.[0]).split(',')[0], low);
  assert.ok(Number.parseInt(low.slice(1, 3), 16) < Number.parseInt(lowTop.slice(1, 3), 16));
  // By night every sky shows at half, and with no weather it is a clear one.
  assert.equal(skyBand(sunDetail({ ...PLACE, now: Date.parse('2026-10-27T06:00:00Z') }, 'rain')?.html)?.[1], 0.5);
  assert.deepEqual(
    skyBand(sunDetail({ ...PLACE, now: noon })?.html),
    skyBand(sunDetail({ ...PLACE, now: noon }, 'clear')?.html),
  );
});
