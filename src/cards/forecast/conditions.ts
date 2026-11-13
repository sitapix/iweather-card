import { type SummaryContext, noHours } from '../../sheets/reading.ts';
import {
  type ChartContext,
  chartMarkup,
  type ChartLook,
  shadeByValue,
  type ChartRead,
  WEATHER_ROW,
} from '../../sheets/chart.ts';
import type { TileContext } from '../shared/context.ts';
import { dayAxis, type DetailDay } from '../../sheets/days.ts';
import { dateFormat } from '../../lib/formats.ts';
import {
  detailSeries,
  lightSeries,
  earlierPoints,
  type ChartPoint,
  withEarlier,
  range,
  attributeSeries,
  type PlotPoint,
  type Reach,
  reachOf,
  type Series,
} from '../../sheets/series.ts';
import { dateKey, dayAsHour, hoursToTell } from '../../weather/forecast-items.ts';
import { forecastSummary } from '../../weather/summary.ts';
import { temperatureRange, type RangeBar, rangeStyles, temperatureColor } from '../../weather/temperature-colors.ts';
import { finite } from '../../lib/values.ts';
import { esc } from '../../lib/html.ts';
import { ceilTo, floorTo, steppedScale } from '../../sheets/scale.ts';
import { iconDetails, weatherIcon } from '../../weather/icons.ts';
import { feelsLike, feelsSeries } from '../feels-like/rules.ts';
import { chanceChart, chanceHead, chanceNote } from '../precipitation/chance.ts';
import { totals } from '../precipitation/totals.ts';
import { convertUnit, UNITS } from '../../weather/units.ts';
import { HOUR } from '../../lib/time.ts';
import { isCondition } from '../../card/home-assistant.ts';
import { clockOf } from '../../sheets/time.ts';
import { type Comparison, highest, compareResult } from '../../sheets/compare.ts';
import { aboutMarkup, segmented, sheetSection } from '../../sheets/parts.ts';
import type { SheetCard } from '../card.ts';
import { dayBefore, dayHead } from '../../sheets/reading.ts';
import { chartPages } from '../../sheets/pages.ts';
import { glyphs } from '../shared/glyphs.ts';
import { phrase, say } from '../../weather/words.ts';
import { skyKind } from '../../sky/presets.ts';
import type { SkyKind } from '../../sky/presets-data.ts';
import { freshnessMarkup } from './freshness.ts';
// The Conditions sheet for a day, on its Actual or Feels Like tab: the temperature now (or the
// day's high and low) with the weather's icon, the hourly temperature or feels-like, the chance
// of precipitation, the totals, a paragraph on the day, and today, its range against yesterday's.
const SCALE_NAMES: Readonly<Record<string, string>> = {
  '°F': phrase('Fahrenheit (°F)'),
  '°C': phrase('Celsius (°C)'),
  K: phrase('Kelvin (K)'),
};
// The weather now, as the paragraph has it: "79° now and partly cloudy." Anything falling or out of
// the ordinary is what the temperature comes with: "28° now with blowing snow."
const NOW_SENTENCES: Readonly<Partial<Record<SkyKind, string>>> = {
  rain: phrase('{temperature} now and raining.'),
  sunShowers: phrase('{temperature} now and raining.'),
  snow: phrase('{temperature} now and snowing.'),
  blizzard: phrase('{temperature} now with an ongoing blizzard.'),
  blowingDust: phrase('{temperature} now with blowing dust.'),
  blowingSnow: phrase('{temperature} now with blowing snow.'),
  drizzle: phrase('{temperature} now with drizzle.'),
  flurries: phrase('{temperature} now with flurries.'),
  foggy: phrase('{temperature} now with fog.'),
  freezingDrizzle: phrase('{temperature} now with freezing drizzle.'),
  freezingRain: phrase('{temperature} now with freezing rain.'),
  hail: phrase('{temperature} now with hail.'),
  haze: phrase('{temperature} now with haze.'),
  heavyRain: phrase('{temperature} now with heavy rain.'),
  heavySnow: phrase('{temperature} now with heavy snow.'),
  hurricane: phrase('{temperature} now with an ongoing hurricane.'),
  isolatedThunderstorms: phrase('{temperature} now with thunderstorms.'),
  scatteredThunderstorms: phrase('{temperature} now with thunderstorms.'),
  sleet: phrase('{temperature} now with sleet.'),
  smoky: phrase('{temperature} now with smoky conditions.'),
  strongStorms: phrase('{temperature} now with severe thunderstorms.'),
  thunderstorms: phrase('{temperature} now with thunderstorms.'),
  tropicalStorm: phrase('{temperature} now with an ongoing tropical storm.'),
  wintryMix: phrase('{temperature} now with wintry mix.'),
};
const WINDY_SENTENCE = phrase('{temperature} now with windy conditions.');
const nowSentence = (condition: string, sky: SkyKind) =>
  condition === 'windy' || condition === 'windy-variant' ? WINDY_SENTENCE : NOW_SENTENCES[sky];
// Only English capitalises that name as a headline, so only English lowers it in a sentence (see
// workOut).
const ENGLISH = 'en';
const inSentence = (name: string, locale: string | undefined) =>
  (locale ?? ENGLISH).startsWith(ENGLISH) ? name.toLowerCase() : name;
// How a day that is over felt, and how one to come will feel, against its temperature, by how hot or
// cold it feels (see FEELS_HOTTER).
const AGAINST_ACTUAL = {
  over: {
    similar: phrase('It felt similar to the actual temperature.'),
    hotter: phrase('It felt hotter than the actual temperature.'),
    warmer: phrase('It felt warmer than the actual temperature.'),
    cooler: phrase('Wind made it feel cooler than the actual temperature.'),
    colder: phrase('Wind made it feel colder than the actual temperature.'),
  },
  coming: {
    similar: phrase('It will feel similar to the actual temperature.'),
    hotter: phrase('It will feel hotter than the actual temperature.'),
    warmer: phrase('It will feel warmer than the actual temperature.'),
    cooler: phrase('Wind will make it feel cooler than the actual temperature.'),
    colder: phrase('Wind will make it feel colder than the actual temperature.'),
  },
} as const;
// A feels-like high this hot (°F) feels hotter, not warmer; one this mild feels cooler, not colder.
const FEELS_HOTTER = 92,
  FEELS_COOLER = 40;
// A day's temperatures, as they are or as they feel: drawn in the daily list's colours, with their
// lowest and highest marked.
const SIMILAR_FAHRENHEIT = 5;
// The gradient's colours mix in OKLab, so they are named every two degrees.
const SHADE_EVERY = 2;
const shadeByTemperature = shadeByValue(
  (value, ctx) => temperatureColor(value, ctx.attrs.temperature_unit),
  SHADE_EVERY,
);
const degreesRead = ({ ctx, value }: ChartRead) => `${ctx.fmt(value)}°`,
  degree = () => '°';
// Feels-like is a bare line in the temperature's colours. The temperature itself runs under it in
// grey, with a faint fill of its own.
const ACTUAL_GREY = '#5a5a5c',
  ACTUAL_FILL = '#5a5a5c2c';
export const ACTUAL = {
  series: {
    ...attributeSeries('temperature'),
    day: entry => [entry.high, entry.low],
    also: [feelsSeries],
  } satisfies Series,
  chart: {
    id: 'temperature',
    shade: shadeByTemperature,
    curve: 'catmullRom',
    extremes: true,
    weather: true,
    row: WEATHER_ROW,
    tickSuffix: degree,
    reads: read => `${degreesRead(read)}${read.icon(read.weather)}`,
  } satisfies ChartLook,
};
export const FELT = {
  series: feelsSeries,
  chart: {
    id: 'feels_like',
    shade: shadeByTemperature,
    curve: 'catmullRom',
    bare: true,
    under: { read: point => point.actual, stroke: ACTUAL_GREY, fill: ACTUAL_FILL },
    extremes: true,
    weather: true,
    row: WEATHER_ROW,
    tickSuffix: degree,
    reads: read => `${degreesRead(read)}${read.icon(read.weather)}`,
    notes: ({ ctx, actual }) =>
      finite(actual) ? say('Actual: {temperature}', { temperature: `${ctx.fmt(actual)}°` }) : '',
  } satisfies ChartLook,
};
// The tick steps by span of temperatures, widest first; anything less steps by 3. These run on the
// numbers shown, whatever their unit.
const TEMPERATURE_STEPS = [
    [72, 15],
    [45, 12],
    [40, 10],
    [28, 8],
    [25, 6],
    [18, 5],
  ] as const,
  NARROWEST_STEP = 3,
  // Room above the highest temperature: a fifth of the way up from the scale's foot.
  HEADROOM = 5;
export function temperatureScale({ min, max }: Reach) {
  const step = TEMPERATURE_STEPS.find(([span]) => max - min > span)?.[1] ?? NARROWEST_STEP,
    low = floorTo(min - step, step);
  return steppedScale(low, ceilTo(max + (max - low) / HEADROOM, step), step);
}
const compareHighs = (
  today: readonly PlotPoint[],
  yesterday: readonly PlotPoint[],
  { fmt, attrs }: Pick<TileContext, 'fmt' | 'attrs'>,
): Comparison => {
  const a = highest(today),
    b = highest(yesterday),
    unit = attrs.temperature_unit,
    apart =
      Math.round(convertUnit('temperature_unit', a, unit, UNITS.fahrenheit)) -
      Math.round(convertUnit('temperature_unit', b, unit, UNITS.fahrenheit));
  return compareResult('high', a, b, value => `${fmt(value)}°`, Math.abs(apart) < SIMILAR_FAHRENHEIT);
};
export interface ConditionsInputs {
  // Home Assistant's history of the weather entity: earlier today and yesterday; undefined while
  // it loads.
  history: { today?: unknown; yesterday?: unknown } | undefined;
  // How far the temperatures go over the whole sheet, as they are and as they feel.
  reach: Reach | null;
  pending: boolean;
  // The weather now, as the card names it (Mostly sunny) and by its kind of sky, and a condition's name.
  nowName: string;
  nowSky?: SkyKind | undefined;
  named: (condition: string) => string;
}
export type ConditionsContext = SummaryContext &
  ChartContext &
  Pick<TileContext, 'condition' | 'daily' | 'lastDay' | 'pastHours' | 'recent'> &
  Partial<Pick<TileContext, 'latitude' | 'longitude' | 'sun' | 'freshness'>>;
export function conditionsBody(
  ctx: ConditionsContext,
  day: DetailDay,
  variant: string,
  inputs: ConditionsInputs,
  days: readonly DetailDay[] = [day],
): string {
  const { fmt, attrs } = ctx,
    daily = day.daily,
    feels = variant === 'feels_like',
    deg = (value: number) => `${fmt(value)}°`,
    scale = SCALE_NAMES[attrs.temperature_unit ?? ''],
    scaleName = esc(scale ? say(scale) : (attrs.temperature_unit ?? '')),
    weekday = dateFormat(ctx.locale, { weekday: 'long', timeZone: ctx.timeZone }).format(day.time);
  const series = (source: Series, item = day) =>
    item.entries.length ? detailSeries(source, item.entries, attrs, ctx.now, ctx.timeZone, item.today) : [];
  const earlier = (source: Series, item = day) => earlierPoints(source, item.key, ctx, inputs.history),
    over = day.key < dateKey(ctx.now, ctx.timeZone);
  const lit = lightSeries(ctx);
  const shown = feels ? FELT : ACTUAL;
  // A day with nothing to chart keeps its frame while another day has something, and its summary
  // says why.
  const page = (item: DetailDay) => {
    const points = lit(series(shown.series, item)),
      past = lit(earlier(shown.series, item)),
      reach = inputs.reach ?? reachOf([...past, ...points].map(point => point.value));
    return `${reach ? chartMarkup(shown.chart, points, temperatureScale(reach), ctx, dayAxis(item.time, ctx.timeZone), past, 'detail-reading') : ''}${chanceChart(ctx, item, { alone: true })}`;
  };
  // The whole day's temperatures and feels-like, earlier today included.
  const actuals = withEarlier(earlier(ACTUAL.series), series(ACTUAL.series)),
    temperatures = actuals.map(point => point.value),
    feltList = withEarlier(earlier(FELT.series), series(FELT.series)).map(point => point.value);
  const high = finite(daily?.high) ? daily.high : temperatures.length ? Math.max(...temperatures) : null,
    low = finite(daily?.low) ? daily.low : temperatures.length ? Math.min(...temperatures) : null;
  // A day with no forecast of its own, as one that is over, goes by the weather halfway through it.
  const sky = daily?.sky.condition ?? (day.today ? ctx.condition : actuals[Math.floor(actuals.length / 2)]?.condition),
    icon = `<span class="detail-icon">${sky ? weatherIcon(sky, daily?.sky.night, iconDetails(daily?.sky.hour ?? (day.today ? attrs : daily && dayAsHour(daily)), attrs)) : ''}</span>`,
    feltNow = feelsLike(attrs)?.value;
  const [headline, sub] = day.today
    ? [
        `${deg((feels ? feltNow : attrs.temperature) ?? Number.NaN)}${icon}`,
        feels
          ? finite(attrs.temperature)
            ? say('Actual: {temperature}', { temperature: deg(attrs.temperature) })
            : ''
          : finite(high) && finite(low)
            ? say('H:{high} L:{low}', { high: deg(high), low: deg(low) })
            : '',
      ]
    : [
        feels && feltList.length
          ? `${deg(Math.max(...feltList))} <span class="low">${deg(Math.min(...feltList))}</span>${icon}`
          : `${finite(high) ? deg(high) : '—'} <span class="low">${finite(low) ? deg(low) : ''}</span>${icon}`,
        feels && feltList.length ? say('Feels Like') : finite(high) ? scaleName : '',
      ];
  const tabs = `${segmented(
    say('Temperature'),
    [
      ['temperature', say('Actual')],
      ['feels_like', say('Feels Like')],
    ],
    feels ? 'feels_like' : 'temperature',
  )}
    <p class="detail-note">${feels ? say('What the temperature feels like, as a result of humidity, sunlight, or wind.') : say('The actual temperature.')}</p>`;
  const paragraph = day.today
    ? sheetSection(say('Forecast'), `<p>${forecastParagraph(ctx, inputs, [low, high], feltList, feltNow)}</p>`)
    : sheetSection(
        say('Daily Summary'),
        `<p>${actuals.length ? daySummary(ctx, day, weekday, actuals, feltList, over) : noHours(day, inputs.pending, 'temperatures')}</p>`,
      );
  return `<div class="detail-reading conditions"><span class="detail-time"></span><div class="detail-headline">${headline}</div><div class="detail-sub">${sub}</div></div>
    ${
      inputs.reach || actuals.length
        ? chartPages(days, page, `${tabs}${chanceHead(ctx, day, daily, weekday)}`)
        : `<p class="detail-note">${noHours(day, inputs.pending, 'temperatures')}</p>${tabs}${chanceHead(ctx, day, daily, weekday)}`
    }${chanceNote(ctx, day)}${totals(ctx, day, daily)}${paragraph}${day.today ? rangeComparison(ctx, [low, high], inputs) : ''}${aboutMarkup(FEELS_ABOUT)}${freshnessMarkup(ctx)}`;
}
// Today's paragraph: the temperature now and the weather, how it feels, how the sky changes
// (as the hourly forecast's summary has it), and the day's range of temperatures and of feels-like.
function forecastParagraph(
  ctx: ConditionsContext,
  inputs: ConditionsInputs,
  [low, high]: readonly [low: number | null, high: number | null],
  felt: readonly number[],
  now: number | undefined,
): string {
  const { fmt, attrs } = ctx,
    deg = (value: number) => `${fmt(value)}°`,
    unit = attrs.temperature_unit,
    sentences: string[] = [];
  const temperature = attrs.temperature,
    condition = ctx.condition ?? '';
  // A sky is said from a condition of Home Assistant's; one of an integration's own is said as it is
  // written, and with none at all the headline's temperature says it.
  if (finite(temperature)) {
    const sentence = isCondition(condition) ? nowSentence(condition, inputs.nowSky ?? skyKind(condition)) : undefined;
    if (sentence) sentences.push(say(sentence, { temperature: deg(temperature) }));
    else if (inputs.nowName)
      sentences.push(
        say('{temperature} now and {condition}.', {
          temperature: deg(temperature),
          condition: esc(inSentence(inputs.nowName, ctx.locale)),
        }),
      );
  }
  // Feeling apart from the temperature, as they read: warmer or hotter, cooler or colder by how
  // warm the day feels at its warmest.
  const warmest = felt.length ? convertUnit('temperature_unit', Math.max(...felt), unit, UNITS.fahrenheit) : Number.NaN;
  if (finite(now) && finite(temperature) && fmt(now) !== fmt(temperature)) {
    const about = { temperature: deg(now) };
    sentences.push(
      now > temperature
        ? warmest >= FEELS_HOTTER
          ? say('It feels hotter, about {temperature}.', about)
          : say('It feels warmer, about {temperature}.', about)
        : warmest >= FEELS_COOLER
          ? say('Wind is making it feel cooler, about {temperature}.', about)
          : say('Wind is making it feel colder, about {temperature}.', about),
    );
  }
  const change = forecastSummary(hoursToTell(ctx.hourly, ctx.now), 'conditions', {
    text: condition => esc(inputs.named(condition)),
    clock: clockOf(ctx, false),
    timeZone: ctx.timeZone,
    unit: attrs.precipitation_unit,
  });
  if (change) sentences.push(change);
  if (finite(low) && finite(high)) sentences.push(rangeSentence(fmt, low, high, felt));
  return sentences.join(' ');
}
// Today's range of temperatures, and of what they feel like, each one reading or a span.
function rangeSentence(fmt: ConditionsContext['fmt'], low: number, high: number, felt: readonly number[]): string {
  const deg = (value: number) => `${fmt(value)}°`,
    [feltLow, feltHigh] = felt.length ? range(felt) : [Number.NaN, Number.NaN],
    values = { low: deg(low), high: deg(high), feltLow: deg(feltLow), feltHigh: deg(feltHigh) },
    feltSteady = fmt(feltLow) === fmt(feltHigh);
  if (fmt(low) === fmt(high)) {
    if (!felt.length) return say('Today’s temperature is {low} all day.', values);
    return feltSteady
      ? say('Today’s temperature is {low} all day and feels like {feltLow}.', values)
      : say('Today’s temperature is {low} all day and feels like {feltLow} to {feltHigh}.', values);
  }
  if (!felt.length) return say('Today’s temperature range is from {low} to {high}.', values);
  return feltSteady
    ? say('Today’s temperature range is from {low} to {high} and feels like {feltLow} all day.', values)
    : say('Today’s temperature range is from {low} to {high} and feels like {feltLow} to {feltHigh}.', values);
}
// Another day's summary: its low and its high with the hours they come, its feels-like range, and
// how it will feel against the temperature; or, of a day that is over, how it felt.
function daySummary(
  ctx: ConditionsContext,
  day: DetailDay,
  weekday: string,
  points: readonly ChartPoint[],
  felt: readonly number[],
  over: boolean,
): string {
  const { fmt, attrs } = ctx,
    deg = (value: number) => `${fmt(value)}°`,
    hour = clockOf(ctx, false);
  // The hours at a value as it reads: from the first to the end of the last.
  const when = (value: number) => {
    const at = points.filter(point => fmt(point.value) === fmt(value)),
      from = at[0]?.time ?? day.time,
      to = (at.at(-1)?.time ?? from) + HOUR;
    return [hour(from), hour(to)] as const;
  };
  const [low, high] = range(points.map(point => point.value)),
    [lowFrom, lowTo] = when(low),
    [highFrom, highTo] = when(high),
    values = { weekday, low: deg(low), lowFrom, lowTo, high: deg(high), highFrom, highTo },
    sentences = [
      over
        ? say(
            '{weekday}’s low was {low} between {lowFrom} and {lowTo}, and the high was {high} between {highFrom} and {highTo}.',
            values,
          )
        : say(
            '{weekday}’s low will be {low} between {lowFrom} and {lowTo}, and the high will be {high} between {highFrom} and {highTo}.',
            values,
          ),
    ];
  if (felt.length) {
    const [feltLow, feltHigh] = range(felt),
      feltValues = { low: deg(feltLow), high: deg(feltHigh) };
    if (fmt(feltLow) === fmt(feltHigh))
      sentences.push(
        over
          ? say('The temperature felt like {low} all day.', feltValues)
          : say('The temperature will feel like {low} all day.', feltValues),
      );
    else
      sentences.push(
        over
          ? say('The temperature range felt like {low} to {high}.', feltValues)
          : say('The temperature range will feel like {low} to {high}.', feltValues),
      );
    const warmest = convertUnit('temperature_unit', feltHigh, attrs.temperature_unit, UNITS.fahrenheit),
      against = AGAINST_ACTUAL[over ? 'over' : 'coming'];
    sentences.push(
      say(
        fmt(feltHigh) === fmt(high)
          ? against.similar
          : feltHigh > high
            ? warmest >= FEELS_HOTTER
              ? against.hotter
              : against.warmer
            : warmest >= FEELS_COOLER
              ? against.cooler
              : against.colder,
      ),
    );
  }
  return sentences.join(' ');
}
// Today's range against yesterday's, as the 10-day list draws them, on one scale; today's with a
// dot at the temperature now. The highs are compared (see comparison).
function rangeComparison(
  ctx: ConditionsContext,
  [low, high]: readonly [low: number | null, high: number | null],
  inputs: ConditionsInputs,
): string {
  const { fmt, attrs } = ctx,
    yesterday = inputs.pending
      ? []
      : earlierPoints(ACTUAL.series, dayBefore(ctx), ctx, inputs.history).map(point => point.value);
  if (!finite(low) || !finite(high)) return '';
  if (!yesterday.length)
    return inputs.pending
      ? sheetSection(
          say('Daily Comparison'),
          `<p>${say('Comparing today with yesterday.')}</p><div class="compare-ranges"><div></div><div></div></div>`,
          { pending: true },
        )
      : '';
  const [before, after] = range(yesterday),
    compared = compareHighs(
      [
        { hour: 0, value: low },
        { hour: 0, value: high },
      ],
      [
        { hour: 0, value: before },
        { hour: 0, value: after },
      ],
      ctx,
    ),
    bars = temperatureRange(
      [
        { low, high, today: true },
        { low: before, high: after },
      ],
      attrs.temperature_unit,
      attrs.temperature,
    );
  const rangeBar = (bar: RangeBar) => {
    const style = rangeStyles(bar);
    return `<span class="range-fill" style="${style.fill}"></span>${style.dot ? `<span class="range-current" style="${style.dot}"></span>` : ''}`;
  };
  const row = (label: string, [from, to]: readonly [number, number], bar: RangeBar | null | undefined) =>
    `<div><span>${label}</span><b class="low">${fmt(from)}°</b><span class="range-track">${bar ? rangeBar(bar) : ''}</span><b>${fmt(to)}°</b></div>`;
  return sheetSection(
    say('Daily Comparison'),
    `<p>${compared.text}</p><div class="compare-ranges">${row(say('Today'), [low, high], bars[0])}${row(say('Yesterday'), [before, after], bars[1])}</div>`,
  );
}
const FEELS_ABOUT = [
  phrase('About Feels Like Temperature'),
  phrase(
    'Feels like combines the air temperature with humidity and wind. Humid air slows the cooling of sweat, so it feels warmer; wind carries heat away from skin, so it feels colder.',
  ),
] as const;
export const conditions: SheetCard = {
  id: 'conditions',
  title: phrase('Conditions'),
  series: ACTUAL.series,
  glyph: glyphs.conditions,
  // Its two tabs.
  shows: [phrase('Temperature'), phrase('Feels Like')],
  units: ['temperature_unit', 'precipitation_unit'],
  sheet(view) {
    const { ctx, day, days, variant, history, reach, canAsk, nowName, nowSky, named } = view;
    return day
      ? `${dayHead(view, glyphs.conditions)}${conditionsBody(
          ctx,
          day,
          variant,
          {
            history: history ?? undefined,
            reach,
            pending: history === undefined && canAsk,
            nowName,
            nowSky,
            named,
          },
          days,
        )}`
      : '';
  },
};
