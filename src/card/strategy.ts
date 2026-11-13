import { CARD_TYPE } from './config.ts';
import type { HomeAssistant } from './home-assistant.ts';
import { suggestWeatherEntity } from './weather-entity.ts';
import { weatherText } from '../weather/i18n.ts';

// A dashboard of the weather alone, which Home Assistant offers among its community dashboards when
// a new one is made: the card over a whole view, on the weather entity the strategy's config names,
// else a usable entity, preferring one that supplies forecasts.
export const STRATEGY = 'iweather';
const ICON = 'mdi:weather-partly-cloudy',
  PATH = 'weather';
interface StrategyConfig {
  entity?: unknown;
  title?: unknown;
}
// "Weather", in Home Assistant's language.
const titleOf = (hass: HomeAssistant | undefined) =>
  weatherText(hass?.locale?.language ?? hass?.language ?? 'en')('weather');
export class WeatherDashboardStrategy extends HTMLElement {
  static getCreateSuggestions(hass?: HomeAssistant): { title: string; icon: string } {
    return { title: titleOf(hass), icon: ICON };
  }
  static generate(config: StrategyConfig, hass: HomeAssistant) {
    const entity = typeof config.entity === 'string' ? config.entity : suggestWeatherEntity(hass),
      title = typeof config.title === 'string' ? config.title : titleOf(hass);
    return {
      title,
      views: [
        {
          title,
          path: PATH,
          icon: ICON,
          type: 'panel',
          cards: [{ type: CARD_TYPE, entity, weather_layout: 'page' }],
        },
      ],
    };
  }
}
