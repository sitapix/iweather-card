import type {
  Connection,
  ForecastEntry,
  ForecastSubscription,
  HomeAssistant,
  Unsubscribe,
} from '../src/card/home-assistant.ts';
import { ENTITY, type Theme, type World } from './world.ts';

// A stand-in for Home Assistant: one connection for as long as the page is open, whose forecast
// subscriptions hear each new forecast as Home Assistant sends them, and a new `hass` for each
// change, as a dashboard hands the card one on every change in the house.

interface Subscriber {
  message: ForecastSubscription;
  callback: (message: unknown) => void;
}

export class House {
  private world: World;
  private readonly subscribers = new Set<Subscriber>();
  readonly connection: Connection = {
    subscribeMessage: (callback, message): Promise<Unsubscribe> => {
      const subscriber = { message, callback };
      this.subscribers.add(subscriber);
      queueMicrotask(() => {
        if (this.subscribers.has(subscriber)) callback({ forecast: this.forecast(message) });
      });
      return Promise.resolve(() => this.subscribers.delete(subscriber));
    },
  };

  constructor(world: World) {
    this.world = world;
  }

  private forecast({ entity_id, forecast_type }: ForecastSubscription): ForecastEntry[] {
    return entity_id === ENTITY ? (this.world.forecasts[forecast_type] ?? []) : [];
  }

  // The house as it stands in `world`, telling every subscriber when its forecast is new.
  hass(world: World, language: string, theme: Theme): HomeAssistant {
    if (world.forecasts !== this.world.forecasts) {
      this.world = world;
      for (const subscriber of this.subscribers) subscriber.callback({ forecast: this.forecast(subscriber.message) });
    }
    return {
      states: world.states,
      config: world.config,
      language,
      locale: { language, time_format: 'language' },
      themes: { darkMode: theme === 'dark' },
      connection: this.connection,
    };
  }
}
