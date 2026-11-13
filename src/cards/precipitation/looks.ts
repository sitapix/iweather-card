import {
  INTENSITY_LEVELS,
  precipitationIntensity,
  precipitationSymbol,
  conditionPrecipitation,
  roundChance,
} from '../../weather/precipitation.ts';
import { PERCENT } from '../../lib/html.ts';
import { finite } from '../../lib/values.ts';
import type { PlotPoint, Series } from '../../sheets/series.ts';
import type { ChartContext, ChartLook } from '../../sheets/chart.ts';
import { KIND_COLORS, KIND_NAMES } from './totals.ts';
import { type ChartScale, steppedScale } from '../../sheets/scale.ts';
import { say } from '../../weather/words.ts';
// Precipitation is charted by how hard it falls: a step of the scale each for light, moderate and
// heavy.
const INTENSITY_TOP = INTENSITY_LEVELS.length;
// The chance of precipitation reads in fifths, leaves one step clear above 100%, and draws a plain,
// thin, straight line over a light fill, from now on only.
export const CHANCE_STEP = 20,
  CHANCE_TOP = PERCENT + CHANCE_STEP,
  CHANCE_LINE = 2.5,
  CHANCE_FILL = 0.28,
  RAIN_BLUE = '#3cd3fe';
// Under this chance an hour's precipitation is unlikely, whatever it amounts to.
const LIKELY_CHANCE = 10;
// How hard an hour's precipitation falls, as a share of the scale's top (see precipitationIntensity).
const level = (point: PlotPoint, ctx: ChartContext) =>
  precipitationIntensity(
    point.value,
    ctx.attrs.precipitation_unit,
    precipitationSymbol({ condition: point.condition, precipitation: point.value }),
  );
export const precipitationSeries: Series = { hour: entry => entry.precipitation };
export const precipitationLook: ChartLook = {
  id: 'precipitation',
  flush: true,
  dotless: true,
  bars: (point, ctx) => ({
    height: level(point, ctx) * INTENSITY_TOP,
    color: KIND_COLORS[conditionPrecipitation(point.condition) ?? 'rain'],
  }),
  levels: INTENSITY_LEVELS.map((label, i) => [i + 1, label]),
  reads: ({ ctx, value, near }) =>
    value > 0
      ? say(
          INTENSITY_LEVELS[
            Math.min(INTENSITY_LEVELS.length - 1, Math.floor(level(near, ctx) * INTENSITY_LEVELS.length))
          ] ?? '',
        )
      : say('None'),
  notes: ({ near }) =>
    near.value <= 0
      ? say('No Precipitation')
      : finite(near.chance) && roundChance(near.chance) < LIKELY_CHANCE
        ? say('Precipitation Unlikely')
        : say(KIND_NAMES[conditionPrecipitation(near.condition) ?? 'rain']),
};
export const precipitationScale = (): ChartScale => steppedScale(0, INTENSITY_TOP, 1);
export const chanceSeries: Series = { hour: entry => entry.precipitation_probability };
export const chanceLook: ChartLook = {
  id: 'chance',
  color: RAIN_BLUE,
  alpha: CHANCE_FILL,
  flush: true,
  curve: 'straight',
  hatched: true,
  spans: true,
  lineWidth: CHANCE_LINE,
  tickSuffix: () => '%',
  reads: ({ ctx, value }) => `${ctx.fmt(roundChance(value))}%`,
};
export const chanceScale = (): ChartScale => steppedScale(0, CHANCE_TOP, CHANCE_STEP, PERCENT);
