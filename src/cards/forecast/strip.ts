import type { Mode, HourlyRows } from './rows.ts';
import { weatherAvailable } from '../../weather/conditions.ts';
import { forecastItems, withSunEvents, rainMetric, todayCondition, type Place } from '../../weather/forecast-items.ts';
import { dominantPrecipitation } from '../../weather/precipitation.ts';
import type { CardConfig } from '../../card/config.ts';
import type { EntityState, EntityAttributes } from '../../card/home-assistant.ts';
import type { ForecastData } from '../../weather/forecast.ts';
import { windSeries } from './strip-chart.ts';
// What the forecast panel is drawn from.
export interface StripInputs {
  config: CardConfig;
  state: EntityState | undefined;
  attrs: EntityAttributes;
  data: ForecastData;
  daily: ForecastData['daily'];
  sun: EntityState | undefined;
  place: Place | undefined;
  now: number;
  timeZone: string | undefined;
}
// What the hourly panel shows: the finest forecast there is, as a strip of hours (with sunrise
// and sunset among them) and their readings, in the view `chosen`, else the configured view, with
// Automatic opening on Conditions.
export function forecastStrip(
  { config, state, attrs, data, daily, sun, place, now, timeZone }: StripInputs,
  chosen: Mode | undefined,
) {
  const available = weatherAvailable(state),
    type: HourlyRows['type'] = data.hourly ? 'hourly' : data.daily ? 'daily' : 'twice_daily',
    forecast = data[type],
    base =
      available && forecast?.status === 'ready'
        ? forecastItems(forecast.forecast, type, state, now, config.forecast_hours, timeZone)
        : [],
    items = type === 'hourly' ? withSunEvents(base, sun, place) : base,
    points = items.filter(item => !item.sun),
    rain = rainMetric(points),
    mode = chosen ?? (config.weather_mode === 'auto' ? 'conditions' : config.weather_mode),
    unit =
      mode === 'conditions'
        ? attrs.temperature_unit
        : mode === 'wind'
          ? attrs.wind_speed_unit
          : rain === 'precipitation_probability'
            ? '%'
            : attrs.precipitation_unit;
  return {
    type,
    forecast,
    items,
    points,
    rain,
    mode,
    unit,
    kind: dominantPrecipitation(state?.state, todayCondition(daily?.forecast ?? [], now, timeZone)),
    wind: windSeries(type, items, forecast, attrs.wind_speed_unit, now),
  };
}
export type Strip = ReturnType<typeof forecastStrip>;
