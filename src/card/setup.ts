import type { CardConfig } from './config.ts';
import { FORECAST_FEATURES, inDomain, type HomeAssistant } from './home-assistant.ts';
import { weatherAvailable } from '../weather/conditions.ts';

// Presets only change presentation. In particular they never change privacy, services,
// sensors, units, actions, custom tiles or dashboard sizing. They expand to ordinary options.
export const SETUP_PRESETS = [
  {
    id: 'compact',
    label: 'Compact',
    icon: 'mdi:card-outline',
    description: 'Current weather in a small space.',
    config: { weather_layout: 'compact', show_name: true, show_high_low: true },
  },
  {
    id: 'forecast',
    label: 'Expanded',
    icon: 'mdi:weather-partly-cloudy',
    description: 'Hourly weather and a five-day outlook.',
    config: { weather_layout: 'expanded', show_forecast: true, show_daily: true, forecast_hours: 24, forecast_days: 5 },
  },
  {
    id: 'page',
    label: 'Full page',
    icon: 'mdi:view-dashboard-variant',
    description: 'Ten days and detail tiles. Best in a panel view.',
    config: {
      weather_layout: 'page',
      size: 'standard',
      show_forecast: true,
      show_daily: true,
      forecast_hours: 24,
      forecast_days: 10,
    },
  },
  {
    id: 'wall',
    label: 'Wall tablet',
    icon: 'mdi:tablet-dashboard',
    description: 'Larger text and a gentler sky for an always-on display.',
    config: {
      weather_layout: 'page',
      size: 'extra_large',
      low_power: true,
      glass_refraction: false,
      map_wind_animation: false,
      show_forecast: true,
      show_daily: true,
      forecast_hours: 12,
      forecast_days: 5,
    },
  },
] as const satisfies readonly {
  id: string;
  label: string;
  icon: string;
  description: string;
  config: Partial<CardConfig>;
}[];
export type SetupPreset = (typeof SETUP_PRESETS)[number];

export interface SetupSource {
  message?: string;
  forecasts: string[];
}
// Capabilities come from HA's advertised features, not a speculative network request. They
// describe the configured providers, not a guarantee that a forecast request will succeed.
export function setupSource(config: Readonly<Record<string, unknown>>, hass: HomeAssistant | undefined): SetupSource {
  if (!hass) return { forecasts: [] };
  const id = config['entity'],
    state = typeof id === 'string' ? hass.states[id] : undefined;
  let message: string | undefined;
  if (!Object.keys(hass.states).some(entity => inDomain(entity, 'weather')))
    message = 'Add a weather integration in Settings → Devices & services, then choose its weather entity here.';
  else if (typeof id !== 'string' || !id) message = 'Choose a weather entity below.';
  else if (!state) message = 'Home Assistant can’t find this weather entity. Choose another below.';
  else if (!weatherAvailable(state))
    message = 'This weather entity is unavailable. Check its integration or choose another entity.';
  if (message) return { message, forecasts: [] };
  const secondary = config['forecast_entity'],
    sources = [state, typeof secondary === 'string' ? hass.states[secondary] : undefined].filter(weatherAvailable),
    features = sources.reduce((bits, source) => bits | (source.attributes.supported_features ?? 0), 0),
    forecasts = [
      [FORECAST_FEATURES.hourly, 'Hourly forecast'],
      [FORECAST_FEATURES.daily, 'Daily forecast'],
      [FORECAST_FEATURES.twiceDaily, 'Day and night'],
    ] as const;
  if (!features && sources.length && sources.every(source => source.attributes.supported_features === 0))
    return {
      message: 'This source reports current weather only. You can add a forecast entity in Data sources.',
      forecasts: [],
    };
  return { forecasts: forecasts.filter(([bit]) => features & bit).map(([, label]) => label) };
}
