import assert from 'node:assert/strict';
import { test } from 'vitest';
import { normalizeConfig } from '../src/card/config.ts';
import { creditsOf, type CreditInputs } from '../src/card/credits.ts';
import type { EntityState, HomeAssistant } from '../src/card/home-assistant.ts';
import { airNow } from '../src/cards/air-quality/rules.ts';
import { NWS, alertOf, pageAlerts } from '../src/cards/alerts/rules.ts';

const NOW = Date.UTC(2026, 10, 11, 17);
const entity = (entity_id: string, state: string, attribution?: string, more: object = {}): EntityState => ({
  entity_id,
  state,
  attributes: { ...(attribution === undefined ? {} : { attribution }), ...more },
});
const hassOf = (...states: EntityState[]): HomeAssistant => ({
  states: Object.fromEntries(states.map(state => [state.entity_id, state])),
});
const HOME = entity('weather.home', 'cloudy', 'Data from National Weather Service/NOAA', { temperature: 50 });
const inputs = (settings: object, hass: HomeAssistant, over: Partial<CreditInputs> = {}): CreditInputs => {
  const config = normalizeConfig({ type: 'custom:iweather-card', entity: 'weather.home', ...settings });
  return {
    config,
    hass,
    supplied: false,
    alerts: [],
    nextHour: false,
    air: airNow({ config, hass }),
    averaged: false,
    ...over,
  };
};
const page = { weather_layout: 'page' };

test('the card’s own entity is credited alone when nothing else is set', () => {
  assert.deepEqual(creditsOf(inputs(page, hassOf(HOME))), {
    named: ['Data from National Weather Service/NOAA'],
    openMeteo: false,
  });
});

test('each entity the page draws from is credited once, the card’s own first', () => {
  const hass = hassOf(
    HOME,
    entity('weather.second', 'sunny', 'Powered by a second service'),
    entity('sensor.yard', '48.2', 'Data provided by a weather station', { unit_of_measurement: '°F' }),
    entity('sensor.sky', 'rainy', 'Conditions by a local service'),
    entity('sensor.air', '42', 'Data provided by an air network'),
    // Another sensor of the same integration says nothing new.
    entity('sensor.yard_humidity', '61', 'Data provided by a weather station'),
  );
  const { named } = creditsOf(
    inputs(
      {
        ...page,
        forecast_entity: 'weather.second',
        temperature_entity: 'sensor.yard',
        humidity_entity: 'sensor.yard_humidity',
        condition_entity: 'sensor.sky',
        air_quality_entity: 'sensor.air',
      },
      hass,
    ),
  );
  assert.deepEqual(named, [
    'Data from National Weather Service/NOAA',
    'Conditions by a local service',
    'Data provided by a weather station',
    'Powered by a second service',
    'Data provided by an air network',
  ]);
});

test('an entity the page shows nothing of goes uncredited', () => {
  const hass = hassOf(
    HOME,
    entity('weather.second', 'unavailable', 'Powered by a second service'),
    entity('sensor.yard', 'unknown', 'Data provided by a weather station'),
    entity('sensor.sky', 'not a sky', 'Conditions by a local service'),
    entity('sensor.minutes', '0', 'Minutes from a radar service'),
    entity('sensor.air', '42', 'Data provided by an air network'),
  );
  const settings = {
    ...page,
    forecast_entity: 'weather.second',
    temperature_entity: 'sensor.yard',
    condition_entity: 'sensor.sky',
    next_hour_entity: 'sensor.minutes',
    air_quality_entity: 'sensor.air',
    tiles: ['wind', 'sun'],
  };
  assert.deepEqual(creditsOf(inputs(settings, hass)).named, ['Data from National Weather Service/NOAA']);
  assert.deepEqual(creditsOf(inputs(settings, hass, { nextHour: true })).named, [
    'Data from National Weather Service/NOAA',
    'Minutes from a radar service',
  ]);
});

test('alerts credit their entity, or the sender of those the card asked for itself', () => {
  const warning = { Event: 'Flood Warning', Severity: 'Severe' },
    hass = hassOf(
      entity('weather.home', 'cloudy', 'Weather forecast from a national institute'),
      entity('sensor.alerts', '1', 'Information provided by an alert service', { alerts: [warning] }),
    );
  const fromSensor = inputs({ ...page, alert_entities: ['sensor.alerts'] }, hass),
    asked = alertOf({ ...warning, senderName: NWS });
  assert.deepEqual(creditsOf({ ...fromSensor, alerts: pageAlerts(fromSensor.config, hass, NOW) }).named, [
    'Weather forecast from a national institute',
    'Information provided by an alert service',
  ]);
  const fromNws = inputs(page, hass);
  assert.deepEqual(creditsOf({ ...fromNws, alerts: pageAlerts(fromNws.config, hass, NOW, asked && [asked]) }).named, [
    'Weather forecast from a national institute',
    NWS,
  ]);
  // Already named by the card's own entity.
  const nws = inputs(page, hassOf(HOME));
  assert.deepEqual(creditsOf({ ...nws, alerts: pageAlerts(nws.config, hass, NOW, asked && [asked]) }).named, [
    'Data from National Weather Service/NOAA',
  ]);
});

test('Open-Meteo is linked for the forecast it filled, the air without a sensor, and its normals', () => {
  const hass = hassOf(HOME),
    supply = { index: 30, yesterday: undefined, at: NOW, pollutants: [] };
  assert.equal(creditsOf(inputs(page, hass, { supplied: true })).openMeteo, true);
  const air = inputs(page, hass);
  assert.equal(creditsOf({ ...air, air: airNow({ config: air.config, hass, airSupply: supply }) }).openMeteo, true);
  assert.equal(creditsOf(inputs({ ...page, averages: 'open-meteo' }, hass, { averaged: true })).openMeteo, true);
  assert.equal(creditsOf(inputs({ ...page, averages: 'open-meteo' }, hass)).openMeteo, false);
  // Off the page, with neither tile, nothing of it shows.
  assert.equal(
    creditsOf({ ...air, ...inputs({ ...page, averages: 'open-meteo', tiles: ['wind'] }, hass, { averaged: true }) })
      .openMeteo,
    false,
  );
});

test('an entity’s credit naming Open-Meteo gives way to the link', () => {
  const hass = hassOf(entity('weather.home', 'sunny', 'Weather data by Open-Meteo.com'));
  assert.deepEqual(creditsOf(inputs(page, hass, { supplied: true })), { named: [], openMeteo: true });
  assert.deepEqual(creditsOf(inputs(page, hass)).named, ['Weather data by Open-Meteo.com']);
});
