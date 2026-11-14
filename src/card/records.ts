// What the tiles ask for beyond the forecast: Home Assistant's history of their entities, and the
// normals and recent rain the averages are set against. Each piece is asked for when it is due,
// kept here, and the tiles are drawn again as it comes.
import type { CardConfig } from './config.ts';
import { OPEN_METEO } from './config.ts';
import { inDomain, type EntityAttributes, type HomeAssistant } from './home-assistant.ts';
import { weatherPlace } from './place.ts';
import { DAY, HOUR, HOURS_PER_DAY, MINUTE } from '../lib/time.ts';
import { finite, isList, isRecord } from '../lib/values.ts';
import {
  openMeteoClimate,
  openMeteoRecentRain,
  statisticsClimate,
  type Climate,
  type ClimateUnits,
  type RecentRain,
} from '../cards/averages/climate.ts';
import { recentPrecipitation } from '../cards/precipitation/recent.ts';
import { PER_HOUR, UNITS, convertUnit } from '../weather/units.ts';
import { askHistory, historyOf, historyReadings, historyIntervals } from '../weather/history.ts';
import { dayAxis } from '../sheets/days.ts';
import { readingOption, sensorReadings } from '../weather/sources.ts';
import { weatherAvailable } from '../weather/conditions.ts';
import { type ForecastSources, forecastLacks } from '../weather/forecast.ts';
import { openMeteoForecast } from '../weather/open-meteo.ts';
import { AIR_REFRESH, type AirSupply, airAnswered, openMeteoAir } from '../cards/air-quality/open-meteo.ts';
import { NWS_ALERTS_REFRESH, type NwsAlerts, nwsAlerts, nwsCovers } from '../cards/alerts/nws.ts';

// How often each piece is asked for again.
const REFRESH = {
  earlier: 30 * MINUTE,
  soFar: 30 * MINUTE,
  airYesterday: 30 * MINUTE,
  recent: 15 * MINUTE,
  recentRain: 6 * HOUR,
  climate: 30 * MINUTE,
  supplementRetry: 15 * MINUTE,
  air: AIR_REFRESH,
  airRetry: 15 * MINUTE,
  alerts: NWS_ALERTS_REFRESH,
  minutes: 5 * MINUTE,
  minutesRetry: HOUR,
} as const;
// The integration that gives minute precipitation when asked, and how it is asked.
const MINUTES = { domain: 'openweathermap', service: 'get_minute_forecast' } as const;
// The pressure trend compares with three hours ago; yesterday's air quality is the reading
// nearest a day ago within half an hour either way; what fell lately is the last 6 hours, or
// the last day when nothing fell in the 6.
const TREND_SPAN = 3 * HOUR;
const AIR_WINDOW = 30 * MINUTE;
const TEMPERATURE_UNITS: ReadonlySet<string> = new Set([UNITS.celsius, UNITS.fahrenheit, UNITS.kelvin]);
const RECENT_HOURS = [6, HOURS_PER_DAY] as const;
// A reading filled in stays through failed tries for this long after it was asked for, and alerts
// asked for, which can be in force for hours, for an hour.
const AIR_KEPT = 2 * HOUR;
const ALERTS_KEPT = HOUR;

// The averages tile, and so its normals and recent rain, appear only on the full page.
const averagesShown = (config: CardConfig): boolean =>
  config.weather_layout === 'page' && config.tiles.includes('averages');
// What the records read from the card, and redraw on it.
export interface RecordsHost {
  readonly config: CardConfig | undefined;
  readonly readHass: HomeAssistant | undefined;
  readonly forecasts: Pick<ForecastSources, 'answered' | 'own' | 'supplement' | 'supply'>;
  readonly timeZone: string | undefined;
  // The card is on screen, in a tab that is showing.
  readonly inSight: boolean;
  redrawTiles(): void;
}
export class WeatherRecords {
  readonly card: RecordsHost;
  // The entity's attributes three hours ago, which entity they were asked for and when.
  earlier: Readonly<Record<string, unknown>> | undefined;
  earlierAt: number | undefined;
  earlierEntity: string | undefined;
  private earlierKey: string | undefined;
  // Today's lowest and highest temperatures recorded since midnight, in the unit they were recorded
  // in; and for which entity and date they were last asked for, and when.
  soFar: { low: number; high: number; unit: string | undefined } | undefined;
  soFarAsked: { key: string; at: number } | undefined;
  // The air quality sensor's reading a day ago, which sensor it came from and when it was asked.
  airYesterday: { value: number | undefined; entity: string; at: number } | undefined;
  // What a precipitation sensor recorded lately (see loadRecent), which sensor and when.
  recent: { hours: number; amount: number; partial?: boolean } | undefined;
  recentAt: number | undefined;
  recentEntity: string | undefined;
  private recentKey: string | undefined;
  // What the precipitation sensor recorded over the last 24 hours.
  lastDay: number | undefined;
  climate: Climate | null | undefined;
  // The units it came in.
  climateUnits: ClimateUnits = {};
  climateKey: string | undefined;
  climateAt = 0;
  private climatePlace: string | undefined;
  private climateRequest: object | undefined;
  // The last weeks' precipitation for the averages tile, where it was asked for and when.
  recentRain: { rain: RecentRain | null; place: string; unit: string | undefined; at: number } | undefined;
  // The supplement last asked for: for where, when, and whether that brought nothing.
  supplementAsked: { key: string; at: number; failed: boolean; pending: boolean } | undefined;
  // Whether Open-Meteo has answered for this place, or failed to, or won't be asked: until then its
  // minute forecast may yet come, and how soon precipitation comes waits for it (see rainOutlook).
  supplementSettled = false;
  // Air quality filled in where no sensor gives it (see loadAirSupply): for where, and when asked.
  // `known`: the place has had an answer in this browser before, so one is expected.
  airSupply: { supply: AirSupply | null; key: string; at: number; failed: boolean; known: boolean } | undefined;
  // Alerts asked for where no alert sensor is set (see loadNwsAlerts): for where, and when asked.
  alerts: { found: NwsAlerts | null; key: string; at: number; failed: boolean } | undefined;
  // The next hour's precipitation, minute by minute, from an integration asked for it (see loadMinutes).
  minutes: { list: readonly unknown[]; key: string; at: number; failed: boolean } | undefined;
  constructor(card: RecordsHost) {
    this.card = card;
  }
  // The reading three hours ago, for the pressure trend; refreshed every half hour.
  async loadEarlier(now: number) {
    const { card } = this,
      hass = card.readHass,
      entity = sensorReadings(hass, card.config).has('pressure') ? card.config?.pressure_entity : card.config?.entity,
      unit = entity === undefined ? undefined : hass?.states[entity]?.attributes.unit_of_measurement,
      target = card.config ? hass?.states[card.config.entity]?.attributes.pressure_unit : undefined,
      key = JSON.stringify([entity, unit, target]);
    if (
      !hass?.callWS ||
      entity === undefined ||
      (this.earlierAt !== undefined && now - this.earlierAt < REFRESH.earlier && this.earlierKey === key)
    )
      return;
    if (this.earlierKey !== key) this.earlier = undefined;
    this.earlierKey = key;
    this.earlierAt = now;
    this.earlierEntity = entity;
    try {
      const weather = inDomain(entity, 'weather'),
        result = await askHistory(hass, [entity], true, now - TREND_SPAN, now - TREND_SPAN + MINUTE);
      if (this.earlierKey !== key || this.earlierAt !== now) return;
      const [first] = historyOf(result, entity),
        attributes = isRecord(first) ? (first['a'] ?? first['attributes']) : undefined,
        state = isRecord(first) ? (first['s'] ?? first['state']) : undefined,
        pressure =
          weather && isRecord(attributes)
            ? attributes['pressure']
            : typeof state === 'string' && state.trim()
              ? Number(state)
              : undefined,
        sourceUnit = isRecord(attributes) ? attributes[weather ? 'pressure_unit' : 'unit_of_measurement'] : undefined;
      this.earlier = finite(pressure)
        ? {
            pressure: convertUnit(
              'pressure_unit',
              pressure,
              typeof sourceUnit === 'string' ? sourceUnit : undefined,
              target,
            ),
            ...(target ? { pressure_unit: target } : {}),
          }
        : undefined;
      card.redrawTiles();
    } catch {}
  }
  // Today's temperatures so far, for today's low and high wherever the card shows them: from the
  // temperature sensor set, else the weather entity, since midnight where the card is. Refreshed
  // every half hour, and at once on a new date, when yesterday's go.
  async loadSoFar(now: number) {
    const { card } = this,
      { config, timeZone } = card,
      hass = card.readHass;
    if (!config || !hass?.callWS || !(config.weather_layout === 'page' || config.show_daily || config.show_high_low))
      return;
    const source = sensorReadings(hass, config).has('temperature') ? config[readingOption('temperature')] : undefined,
      entity = source ?? config.entity,
      weather = inDomain(entity, 'weather'),
      midnight = dayAxis(now, timeZone).start,
      key = JSON.stringify([entity, midnight]),
      asked = this.soFarAsked;
    if (asked?.key === key && now - asked.at < REFRESH.soFar) return;
    if (asked?.key !== key) this.soFar = undefined;
    const asking = { key, at: now };
    this.soFarAsked = asking;
    try {
      const result = await askHistory(hass, [entity], true, midnight, now);
      if (this.soFarAsked !== asking) return;
      const readings = historyOf(result, entity).flatMap(row => {
        if (!isRecord(row)) return [];
        const fields = row['a'] ?? row['attributes'],
          attrs = isRecord(fields) ? fields : {},
          value = weather ? attrs['temperature'] : parseFloat(String(row['s'] ?? row['state'])),
          unit = weather ? attrs['temperature_unit'] : attrs['unit_of_measurement'];
        return finite(value) ? [{ value, unit: typeof unit === 'string' ? unit : undefined }] : [];
      });
      const recordedUnit = readings.findLast(reading => reading.unit !== undefined)?.unit,
        unit = recordedUnit ?? (weather ? undefined : hass.states[entity]?.attributes.unit_of_measurement),
        values = readings.flatMap(reading => {
          // Older integrations may omit attributes entirely. Do not guess their unit in a mixed record.
          if (reading.unit === undefined && recordedUnit !== undefined) return [];
          if (reading.unit === unit || !reading.unit) return [reading.value];
          if (!unit || !TEMPERATURE_UNITS.has(reading.unit) || !TEMPERATURE_UNITS.has(unit)) return [];
          return [convertUnit('temperature_unit', reading.value, reading.unit, unit)];
        });
      this.soFar = values.length ? { low: Math.min(...values), high: Math.max(...values), unit } : undefined;
      card.redrawTiles();
    } catch {}
  }
  // The air quality sensor's reading at about this time yesterday, for its tile; refreshed
  // every half hour.
  async loadAirYesterday(now: number) {
    const { card } = this,
      hass = card.readHass,
      entity = card.config?.air_quality_entity;
    if (!entity || !hass?.callWS) return;
    const asked = this.airYesterday;
    if (asked && asked.entity === entity && now - asked.at < REFRESH.airYesterday) return;
    const asking = { value: undefined, entity, at: now };
    this.airYesterday = asking;
    const then = now - DAY;
    try {
      const result = await askHistory(hass, [entity], false, then - AIR_WINDOW, then + AIR_WINDOW);
      // The reading nearest a day ago: the state at the window's start counts from then.
      let best: { gap: number; value: number } | undefined;
      for (const { time, value } of historyReadings(result, entity)) {
        const gap = Math.abs(Math.max(time, then - AIR_WINDOW) - then);
        if (!best || gap < best.gap) best = { gap, value };
      }
      if (best && this.airYesterday === asking) {
        this.airYesterday = { value: best.value, entity, at: now };
        card.redrawTiles();
      }
    } catch {}
  }
  // What fell lately, from a configured precipitation sensor's last day of history:
  // the last 6 hours, or the last 24 when nothing fell in the 6. Refreshed every 15 minutes.
  async loadRecent(now: number) {
    const { card } = this,
      hass = card.readHass,
      entity = card.config?.precipitation_entity;
    if (!inDomain(entity, 'sensor') || !hass?.callWS) {
      this.recentKey = undefined;
      this.recent = undefined;
      this.lastDay = undefined;
      return;
    }
    const unit = hass.states[entity]?.attributes.unit_of_measurement,
      target = card.config ? hass.states[card.config.entity]?.attributes.precipitation_unit : undefined,
      key = JSON.stringify([entity, unit, target]);
    if (this.recentKey === key && this.recentAt !== undefined && now - this.recentAt < REFRESH.recent) return;
    if (this.recentKey !== key) {
      this.recent = undefined;
      this.lastDay = undefined;
    }
    this.recentKey = key;
    this.recentAt = now;
    this.recentEntity = entity;
    try {
      const result = await askHistory(hass, [entity], false, now - DAY);
      if (this.recentKey !== key || this.recentAt !== now) return;
      const rate = PER_HOUR.test(unit ?? ''),
        readings = rate ? historyIntervals(result, entity) : historyReadings(result, entity),
        totals = RECENT_HOURS.map(hours => {
          const { amount, partial } = recentPrecipitation(readings, rate, now, hours);
          return {
            hours,
            amount: convertUnit('precipitation_unit', amount, unit?.replace(PER_HOUR, ''), target),
            ...(partial ? { partial } : {}),
          };
        });
      this.recent = totals.find(({ amount }) => amount > 0);
      const day = totals.at(-1);
      this.lastDay = day?.partial ? undefined : day?.amount;
      card.redrawTiles();
    } catch {}
  }
  // Climate normals for the averages tile, once per source and place; again a while after a try
  // that brought none, as a screen starting up may not have its network yet.
  async loadClimate() {
    const { card } = this,
      config = card.config,
      source = config && averagesShown(config) ? config.averages : undefined,
      hass = card.readHass,
      { latitude: lat, longitude: lon } = weatherPlace(hass, config) ?? {},
      now = Date.now();
    const attrs: EntityAttributes = (config ? hass?.states[config.entity]?.attributes : undefined) ?? {};
    const place = source && hass ? JSON.stringify([source, lat, lon]) : undefined;
    if (this.climatePlace !== place) {
      this.climatePlace = place;
      this.climate = undefined;
      this.climateKey = undefined;
      this.climateRequest = undefined;
      this.climateUnits = {};
    }
    const key = JSON.stringify([place, attrs.temperature_unit, attrs.precipitation_unit]);
    if (
      !source ||
      !hass ||
      (this.climateKey === key && (this.climate !== null || now - this.climateAt < REFRESH.climate)) ||
      (source === OPEN_METEO && !attrs.temperature_unit) ||
      (source !== OPEN_METEO && !hass.callWS)
    )
      return;
    const request = {};
    this.climateRequest = request;
    this.climateKey = key;
    this.climateAt = now;
    let climate: Climate | null = null;
    try {
      climate =
        source === OPEN_METEO
          ? await openMeteoClimate(lat, lon, attrs.temperature_unit, attrs.precipitation_unit)
          : await statisticsClimate(hass, source, attrs.temperature_unit);
    } catch {}
    if (this.climateRequest !== request) return;
    this.climate = climate;
    this.climateUnits = { temperature_unit: attrs.temperature_unit, precipitation_unit: attrs.precipitation_unit };
    card.redrawTiles();
  }
  // The last weeks' precipitation, set against its normal on the averages tile; with Open-Meteo
  // normals only, asked again every six hours.
  async loadRecentRain() {
    const { card } = this,
      hass = card.readHass,
      config = card.config,
      { latitude: lat, longitude: lon } = weatherPlace(hass, config) ?? {},
      unit = config ? hass?.states[config.entity]?.attributes.precipitation_unit : undefined;
    if (config?.averages !== OPEN_METEO || !averagesShown(config) || !hass) {
      this.recentRain = undefined;
      return;
    }
    const place = JSON.stringify([lat, lon]),
      asked = this.recentRain,
      now = Date.now();
    if (asked?.place === place && asked.unit === unit && now - asked.at < REFRESH.recentRain) return;
    const held = asked?.place === place ? asked.rain : null,
      amount = (value: number) => convertUnit('precipitation_unit', value, asked?.unit, unit),
      rain =
        held && asked?.unit !== unit
          ? { dates: held.dates, amounts: held.amounts.map(amount), total: amount(held.total) }
          : held;
    const asking = { rain, place, unit, at: now };
    this.recentRain = asking;
    try {
      const rain = await openMeteoRecentRain(lat, lon, unit);
      if (this.recentRain === asking) {
        this.recentRain = { ...asking, rain };
        card.redrawTiles();
      }
    } catch {}
  }
  // Air quality for the weather's place where the page shows its tile and no sensor is set, from
  // Open-Meteo, whatever integration gives the weather. Asked for hourly while in sight, at once for
  // a new place, and again a while after a try that brought nothing. Nothing leaves Home Assistant
  // with `local_only`, and a sensor set takes over from it. Called before an update is worked out,
  // so the tile can hold its room from the first frame while the answer is on its way.
  async loadAirSupply(now: number) {
    const { card } = this,
      config = card.config,
      hass = card.readHass,
      { latitude, longitude } = weatherPlace(hass, config) ?? {};
    if (
      config?.weather_layout !== 'page' ||
      !config.tiles.includes('air_quality') ||
      config.air_quality_entity !== undefined ||
      config.local_only ||
      !finite(latitude) ||
      !finite(longitude)
    ) {
      if (this.airSupply) {
        this.airSupply = undefined;
        card.redrawTiles();
      }
      return;
    }
    const key = JSON.stringify([latitude, longitude]),
      asked = this.airSupply?.key === key ? this.airSupply : undefined;
    if (!card.inSight || (asked && now - asked.at < (asked.failed ? REFRESH.airRetry : REFRESH.air))) return;
    // Another place's reading goes at once; this place's stays while the new one is asked for.
    const asking = {
      supply: asked?.supply ?? null,
      key,
      at: now,
      failed: false,
      known: asked?.known ?? airAnswered(latitude, longitude),
    };
    this.airSupply = asking;
    const supply = await openMeteoAir(latitude, longitude, now).catch(() => null);
    if (this.airSupply !== asking) return;
    if (supply) {
      // A saved answer is as old as it is, not as this ask.
      asking.supply = supply;
      asking.at = supply.at;
      asking.known = true;
    } else {
      asking.failed = true;
      if (asking.supply && now - asking.supply.at >= AIR_KEPT) asking.supply = null;
    }
    card.redrawTiles();
  }
  // Alerts for the weather's place from the National Weather Service, on the full page with no alert
  // sensor set, where it covers the place: the entity is its integration's, or home is in a country
  // it covers. Asked for every five minutes while in sight, at once for a new place, and again five
  // minutes after a try that brought nothing, through which the last alerts stay for an hour. Nothing
  // leaves Home Assistant with `local_only`, and an alert sensor set takes over from it.
  async loadNwsAlerts(now: number) {
    const { card } = this,
      config = card.config,
      hass = card.readHass,
      { latitude, longitude } = weatherPlace(hass, config) ?? {};
    if (
      config?.weather_layout !== 'page' ||
      (config.alert_entities ?? []).length > 0 ||
      config.local_only ||
      !nwsCovers(hass?.entities?.[config.entity]?.platform, hass?.config?.country) ||
      !finite(latitude) ||
      !finite(longitude)
    ) {
      if (this.alerts) {
        this.alerts = undefined;
        card.redrawTiles();
      }
      return;
    }
    const key = JSON.stringify([latitude, longitude]),
      asked = this.alerts?.key === key ? this.alerts : undefined;
    if (!card.inSight || (asked && now - asked.at < REFRESH.alerts)) return;
    // Another place's alerts go at once; this place's stay while the new ones are asked for.
    const asking = { found: asked?.found ?? null, key, at: now, failed: false };
    this.alerts = asking;
    const found = await nwsAlerts(latitude, longitude, now).catch(() => null);
    if (this.alerts !== asking) return;
    if (found) {
      // A saved answer is as old as it is, not as this ask.
      asking.found = found;
      asking.at = found.at;
    } else {
      asking.failed = true;
      if (asking.found && now - asking.found.at >= ALERTS_KEPT) asking.found = null;
    }
    card.redrawTiles();
  }
  // The next hour's precipitation minute by minute, from an integration that gives it only when asked:
  // OpenWeatherMap, in its one mode with minutes, answers from what Home Assistant already holds, so
  // asking costs nothing outside it. On the full page with no next-hour entity set, every few minutes
  // while in sight; an entity that answers with an error, as in its other modes, only hourly.
  async loadMinutes(now: number) {
    const { card } = this,
      config = card.config,
      hass = card.readHass,
      entity = config?.entity;
    if (
      config?.weather_layout !== 'page' ||
      config.next_hour_entity !== undefined ||
      entity === undefined ||
      hass?.entities?.[entity]?.platform !== MINUTES.domain ||
      !hass.callWS
    ) {
      if (this.minutes) {
        this.minutes = undefined;
        card.redrawTiles();
      }
      return;
    }
    const asked = this.minutes?.key === entity ? this.minutes : undefined;
    if (!card.inSight || (asked && now - asked.at < (asked.failed ? REFRESH.minutesRetry : REFRESH.minutes))) return;
    const asking = { list: asked?.list ?? [], key: entity, at: now, failed: false };
    this.minutes = asking;
    try {
      const answer = await hass.callWS({
          type: 'call_service',
          ...MINUTES,
          target: { entity_id: entity },
          return_response: true,
        }),
        response = isRecord(answer) ? answer['response'] : undefined,
        own = isRecord(response) ? response[entity] : undefined,
        list = isRecord(own) ? own['forecast'] : undefined;
      if (this.minutes !== asking) return;
      asking.list = isList(list) ? list : [];
    } catch {
      if (this.minutes !== asking) return;
      asking.failed = true;
      asking.list = [];
    }
    card.redrawTiles();
  }
  // Open-Meteo's forecast, on the full page where the settings allow it and the entities, once
  // they have answered, leave anything out. Asked for at its refresh interval while in sight, at once for a new place
  // or zone, and again a while after a try that brought nothing. It is decoration, so nothing waits
  // for it and a failure goes unsaid: the card carries on with what it has, however long. Called
  // before an update is worked out, so a change of place never draws the old place's hours.
  async loadSupplement(now: number) {
    const { card } = this,
      { config, timeZone, forecasts } = card,
      hass = card.readHass,
      { latitude, longitude } = weatherPlace(hass, config) ?? {};
    const drop = () => {
      if (this.supplementAsked) forecasts.supply(undefined);
      this.supplementAsked = undefined;
    };
    if (config?.weather_layout !== 'page' || !config.open_meteo_forecast || !finite(latitude) || !finite(longitude)) {
      drop();
      this.supplementSettled = true;
      return;
    }
    // Its hours are kept in the entity's units, so another entity starts afresh.
    const key = JSON.stringify([latitude, longitude, timeZone, config.entity]);
    if (this.supplementAsked?.key !== key) {
      drop();
      this.supplementSettled = false;
    }
    if (!forecasts.answered || !weatherAvailable(hass?.states[config.entity])) return;
    if (!forecastLacks(forecasts.own, config.forecast_days, now, timeZone)) {
      drop();
      this.supplementSettled = true;
      return;
    }
    const asked = this.supplementAsked,
      refresh = config.forecast_refresh_minutes * MINUTE;
    if (
      !card.inSight ||
      asked?.pending ||
      (asked && now - asked.at < (asked.failed ? REFRESH.supplementRetry : refresh))
    )
      return;
    const asking = { key, at: now, failed: asked?.failed ?? false, pending: true };
    this.supplementAsked = asking;
    const answer = openMeteoForecast(latitude, longitude, timeZone, now, { maxAge: refresh }),
      supplement = answer instanceof Promise ? await answer.catch(() => null) : answer;
    if (this.supplementAsked !== asking) return;
    const awaited = this.supplementAwaited;
    asking.pending = false;
    asking.failed = !supplement;
    this.supplementSettled = true;
    if (supplement) {
      // A saved answer is as old as it is, not as this ask.
      asking.at = supplement.at;
      forecasts.supply(supplement, timeZone);
    }
    // A saved answer is already part of the render that asked for it. A network answer needs
    // another render, even with nothing new, to give back the room held for it.
    if (answer instanceof Promise && (supplement || awaited)) card.redrawTiles();
  }
  // Air quality for this place is on its way, and has come here before, so its tile holds its room.
  // A place never answered for leaves none: offline, the tile would come only to go.
  get airAwaited(): boolean {
    const asked = this.airSupply;
    return Boolean(asked && !asked.supply && !asked.failed && asked.known);
  }
  // The first answer is on its way. A try after one that brought nothing doesn't count: it may
  // bring nothing again, and the page shouldn't move for it each time.
  get supplementAwaited(): boolean {
    const asked = this.supplementAsked;
    return Boolean(asked && !asked.failed) && !this.card.forecasts.supplement;
  }
}
