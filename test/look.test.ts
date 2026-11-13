import { test } from 'vitest';
import assert from 'node:assert/strict';
import { WEATHER_CONDITIONS } from '../src/card/home-assistant.ts';
import { forecastSummary, type SummaryOptions } from '../src/weather/summary.ts';
import {
  dominantPrecipitation,
  precipitationAmount,
  precipitationIntensity,
  precipitationSymbol,
  roundChance,
} from '../src/weather/precipitation.ts';
import { numberLocale, weatherNumber } from '../src/lib/formats.ts';
import { pressureTrend } from '../src/cards/pressure/rules.ts';
import { weatherAlerts } from '../src/cards/alerts/rules.ts';
import { alertLevel } from '../src/weather/icons.ts';
import type { StripItem } from '../src/weather/forecast-items.ts';
import { opensSheet } from '../src/cards/index.ts';
import { BEAUFORT, beaufort, beaufortSpeeds } from '../src/cards/wind/rules.ts';
import { compareDays } from '../src/sheets/compare.ts';
import { airQualityDetail, pollutantIndex, pollutantSensors } from '../src/cards/air-quality/sheet.ts';
import { visibilityLabel } from '../src/cards/visibility/rules.ts';
import { moonDistance, nextMoonPhase } from '../src/sky/sky.ts';
import { normalizeConfig } from '../src/card/config.ts';
import { visibilityReading } from '../src/cards/visibility/sheet.ts';

const hour = 3600000,
  start = Date.UTC(2026, 9, 27, 15);
const strip = (conditions: string[]): StripItem[] =>
  conditions.map((condition, i) => ({
    time: start + i * hour,
    condition,
    precipitation: ['rainy', 'snowy'].includes(condition) ? 0.1 : 0,
  }));
const NAMES: Readonly<Record<string, string>> = {
  rainy: 'Rain',
  cloudy: 'Cloudy',
  sunny: 'Sunny',
  partlycloudy: 'Partly cloudy',
  snowy: 'Snow',
};
const options: SummaryOptions = {
  text: c => NAMES[c] ?? c,
  clock: time => `${new Date(time).getUTCHours()}h`,
  timeZone: 'UTC',
};

test('summary line follows the sentence rules', () => {
  // Falling now, or later today in the precipitation view: stretch by stretch, how hard by the amount.
  assert.equal(
    forecastSummary(strip(['rainy', 'rainy', 'cloudy']), 'conditions', options),
    'Light rain until 17h. Then, no precipitation for the remainder of the day.',
  );
  assert.equal(
    forecastSummary(strip(['sunny', 'rainy', 'rainy']), 'rain', options),
    'No precipitation until 16h. Then, light rain for the remainder of the day.',
  );
  assert.equal(forecastSummary(strip(['rainy', 'rainy']), 'rain', options), 'Light rain expected throughout the day.');
  assert.equal(
    forecastSummary(strip(['rainy', 'cloudy', 'snowy', 'cloudy', 'rainy']), 'rain', options),
    'Variable rain and snow expected throughout the day.',
  );
  const heavy = strip(['rainy', 'rainy', 'rainy']).map((item, i) => ({ ...item, precipitation: i ? 0.1 : 12 }));
  assert.equal(
    forecastSummary(heavy, 'rain', options),
    'Heavy rain until 16h. Then, light rain for the remainder of the day.',
  );
  assert.equal(
    forecastSummary(strip(['sunny', 'cloudy', 'rainy']), 'conditions', options),
    'Rain expected around 17h.',
  );
  assert.equal(
    forecastSummary(strip(['sunny', 'sunny', 'cloudy']), 'conditions', options),
    'Cloudy conditions expected around 17h.',
  );
  assert.equal(
    forecastSummary(strip(['sunny', 'sunny']), 'conditions', options),
    'Sunny conditions will continue for the rest of the day.',
  );
  assert.equal(
    forecastSummary(strip(['sunny', 'sunny']), 'rain', options),
    'No precipitation for the remainder of the day.',
  );
  const gusty = strip(['sunny', 'sunny']).map(item => ({ ...item, wind_speed: 8, wind_gust_speed: 26 }));
  assert.equal(
    forecastSummary(gusty, 'conditions', { ...options, fmt: String, gustUnit: 'mph', gustLimit: 20 }),
    'Sunny conditions will continue for the rest of the day. Wind gusts are up to 26 mph.',
  );
});

test('the precipitation view names the kind', () => {
  // The kind named by the chance and the switch: frozen or hail now, else today's frozen forecast, else rain.
  assert.equal(dominantPrecipitation('snowy', 'rainy'), 'snow');
  assert.equal(dominantPrecipitation('cloudy', 'snowy'), 'snow', 'a snowy day reads as snow while dry for now');
  assert.equal(dominantPrecipitation('rainy', 'snowy-rainy'), 'wintry_mix', 'frozen precipitation wins');
  assert.equal(dominantPrecipitation('hail', 'rainy'), 'hail');
  assert.equal(dominantPrecipitation('rainy', 'hail'), 'rain', 'hail later in the day does not name it');
  assert.equal(dominantPrecipitation('sunny', 'cloudy'), 'rain');
  // Each hour's own glyph.
  assert.equal(precipitationSymbol({ condition: 'snowy' }), 'snow');
  assert.equal(precipitationSymbol({ condition: 'snowy-rainy' }), 'mixed');
  assert.equal(precipitationSymbol({ condition: 'hail' }), 'rain', 'hail shows a drop');
  assert.equal(
    precipitationSymbol({ condition: 'cloudy', precipitation_probability: 20 }),
    'none',
    'a dry hour with a chance',
  );
  // Snow feels heavier for its liquid: 1 mm of snow fills like 3 mm of rain.
  assert.equal(precipitationIntensity(1, 'mm', 'snow'), precipitationIntensity(3, 'mm'));
  // Inches in twentieths, whole from a foot; some, but less than rounds to anything.
  assert.equal(precipitationAmount(1.07, 'in', 'en'), '1.05″');
  assert.equal(precipitationAmount(11.97, 'in', 'en'), '11.95″');
  assert.equal(precipitationAmount(12.3, 'in', 'en'), '12″');
  assert.equal(precipitationAmount(0.02, 'in', 'en'), '<.05″');
  assert.equal(precipitationAmount(0.03, 'in', 'en'), '.05″');
  assert.equal(precipitationAmount(0, 'in', 'en'), '0″');
  // Millimetres whole, and under half of one, a trace.
  assert.equal(precipitationAmount(3.4, 'mm', 'en'), '3 mm');
  assert.equal(precipitationAmount(3.5, 'mm', 'en'), '4 mm');
  assert.equal(precipitationAmount(1234.4, 'mm', 'en'), '1,234 mm');
  assert.equal(precipitationAmount(0.5, 'mm', 'en'), '1 mm');
  assert.equal(precipitationAmount(0.49, 'mm', 'en'), '<1 mm');
  assert.equal(precipitationAmount(0, 'mm', 'en'), '0 mm');
  // Centimetres as inches are, whole from 20.
  assert.equal(precipitationAmount(1.07, 'cm', 'en'), '1.05 cm');
  assert.equal(precipitationAmount(20.4, 'cm', 'en'), '20 cm');
  assert.deepEqual([43, 47, 2, 98].map(roundChance), [45, 45, 0, 100], 'chances show to the nearest 5%');
  assert.equal(normalizeConfig({ entity: 'weather.home' }).weather_mode, 'auto');
  assert.equal(normalizeConfig({ entity: 'weather.home' }).size, 'standard');
  assert.throws(() => normalizeConfig({ entity: 'weather.home', size: 'huge' }));
});

const whole = (value: number, digits = 0) => value.toFixed(digits).replace(/\.0$/, '');
test('the Beaufort scale reads its own list of speeds, in mph as it stands and in any other unit converted', () => {
  assert.deepEqual(BEAUFORT.at(7)?.name, 'High wind');
  assert.deepEqual(BEAUFORT.at(-1)?.name, 'Hurricane-force');
  assert.deepEqual(beaufortSpeeds('mph', whole), {
    unit: 'mph',
    speeds: [
      '< 1',
      '1 - 2',
      '3 - 6',
      '7 - 11',
      '12 - 17',
      '18 - 23',
      '24 - 30',
      '31 - 38',
      '39 - 45',
      '46 - 54',
      '55 - 63',
      '64 - 72',
      '> 73',
    ],
  });
  assert.deepEqual(beaufortSpeeds('km/h', whole)?.speeds, [
    '< 2',
    '2 - 3',
    '5 - 10',
    '11 - 18',
    '19 - 27',
    '29 - 37',
    '39 - 48',
    '50 - 61',
    '63 - 72',
    '74 - 87',
    '89 - 101',
    '103 - 116',
    '> 117',
  ]);
  // Metres a second keep a decimal, or the calm end of the scale would read nought.
  assert.deepEqual(beaufortSpeeds('m/s', whole)?.speeds.slice(0, 3), ['< 0.4', '0.4 - 0.9', '1.3 - 2.7']);
  assert.equal(beaufortSpeeds('kn', whole)?.speeds.at(-1), '> 63');
  // A unit nothing converts to keeps the list, under the name of what it is in.
  assert.deepEqual(beaufortSpeeds('furlongs', whole), beaufortSpeeds('mph', whole));
  assert.deepEqual(beaufortSpeeds(undefined, whole), beaufortSpeeds('mph', whole));
  // Forces have no speeds of their own to list.
  assert.equal(beaufortSpeeds('bft', whole), null);
  assert.equal(beaufortSpeeds('Beaufort', whole), null);
});
test('a wind takes the force whose speeds it falls in, by the same list', () => {
  for (const [speed, force] of [
    [0.5, 0],
    [1, 1],
    [2.9, 1],
    [3, 2],
    [6.9, 2],
    [7, 3],
    [38.9, 7],
    [39, 8],
    [46, 9],
    [72.9, 11],
    [73, 12],
  ] as const)
    assert.equal(beaufort(speed, 'mph')?.force, force, `${speed} mph`);
  // Any unit lands on the same force.
  assert.deepEqual(beaufort(62.8, 'km/h'), { force: 8, name: 'Gale' });
  assert.deepEqual(beaufort(117.5, 'km/h'), { force: 12, name: 'Hurricane-force' });
});

test('pressure trend, visibility words and Beaufort force', () => {
  assert.equal(pressureTrend(30.1, 30.15, 'inHg', undefined), 'rising');
  assert.equal(pressureTrend(1013, undefined, 'hPa', 1016), 'falling');
  assert.equal(pressureTrend(1013, 1013.4, 'hPa', undefined), 'steady');
  assert.equal(pressureTrend(1013, undefined, 'hPa', undefined), null);
  assert.equal(visibilityLabel(10, 'mi'), 'Perfectly clear');
  assert.equal(visibilityLabel(0.5, 'km'), 'Moderate');
  assert.equal(visibilityLabel(12, 'km'), 'Clear');
  assert.equal(visibilityLabel(5, 'km'), 'Fairly clear');
  assert.deepEqual(beaufort(15, 'mph'), { force: 4, name: 'Moderate breeze' });
  assert.equal(
    compareDays(visibilityReading.compare, [{ hour: 0, value: 10 }], [{ hour: 0, value: 6 }], {
      fmt: String,
      attrs: {},
    })?.text,
    'Visibility today is greater than yesterday.',
  );
});

test('detail sheets open only with the data they need', () => {
  const ctx = { latitude: 38, longitude: -90, hourly: [{ pressure: 30 }] };
  assert.equal(opensSheet('pressure', ctx), true);
  assert.equal(opensSheet('visibility', ctx), false);
  assert.equal(opensSheet('visibility', { ...ctx, hourly: [{ visibility: 12 }] }), true);
  assert.equal(opensSheet('moon', { ...ctx, latitude: undefined }), false);
});

test('air quality sub-indexes and pollutant discovery', () => {
  assert.equal(pollutantIndex('pm25', 9, 'µg/m³'), 50);
  assert.equal(pollutantIndex('pm10', 154, 'µg/m³'), 100);
  assert.equal(pollutantIndex('carbon_monoxide', 9400, 'ppb'), 100);
  const hass = {
    entities: {
      'sensor.aqi': { device_id: 'a' },
      'sensor.pm25': { device_id: 'a' },
      'sensor.other': { device_id: 'b' },
    },
    states: {
      'sensor.pm25': {
        entity_id: 'sensor.pm25',
        state: '12',
        attributes: { device_class: 'pm25', unit_of_measurement: 'µg/m³' },
      },
      'sensor.other': { entity_id: 'sensor.other', state: '5', attributes: { device_class: 'pm10' } },
    },
  };
  assert.deepEqual(
    pollutantSensors(hass, 'sensor.aqi').map(p => p.kind),
    ['pm25'],
  );
});

// The air quality sheet, from a sample sensor and what its device reports.
const airHass = (
  reading: string,
  attributes: object = {},
  pollutants: Readonly<Record<string, readonly [state: string, unit: string]>> = {},
) => ({
  states: {
    'sensor.aqi': { entity_id: 'sensor.aqi', state: reading, attributes: { device_class: 'aqi', ...attributes } },
    ...Object.fromEntries(
      Object.entries(pollutants).map(([kind, [state, unit]]) => [
        `sensor.${kind}`,
        { entity_id: `sensor.${kind}`, state, attributes: { device_class: kind, unit_of_measurement: unit } },
      ]),
    ),
  },
  entities: Object.fromEntries(
    ['aqi', ...Object.keys(pollutants)].map(kind => [`sensor.${kind}`, { device_id: 'air' }]),
  ),
});
const airSheet =
  (...sensor: Parameters<typeof airHass>) =>
  (airYesterday?: number) =>
    airQualityDetail({
      fmt: String,
      hass: airHass(...sensor),
      config: normalizeConfig({ entity: 'weather.home', air_quality_entity: 'sensor.aqi' }),
      airYesterday,
    });
const BREAKDOWN: Readonly<Record<string, readonly [string, string]>> = {
  pm25: ['15', 'µg/m³'],
  sulphur_dioxide: ['1', 'ppb'],
  carbon_monoxide: ['300', 'ppb'],
  ozone: ['26', 'ppb'],
  nitrogen_dioxide: ['19', 'ppb'],
  pm10: ['49', 'µg/m³'],
};

test('each air quality category has its word alone, on its scale, and its own health text', () => {
  const words = [
    ['30', 'Good'],
    ['63', 'Moderate'],
    ['120', 'Unhealthy for Sensitive Groups'],
    ['170', 'Unhealthy'],
    ['250', 'Very Unhealthy'],
    ['350', 'Hazardous'],
  ] as const;
  const health = words.map(([reading, word]) => {
    const html = airSheet(reading)();
    assert.ok(
      html.startsWith(
        `<div class="detail-headline named">${word}</div><div class="detail-sub">Scale: United States (AQI)</div>`,
      ),
      word,
    );
    return /<h3>Health Information<\/h3><div class="detail-panel"><p>(.*?)<\/p>/.exec(html)?.[1];
  });
  assert.equal(new Set(health).size, words.length);
  assert.ok(health.every(text => (text?.length ?? 0) > 40));
});

test('the air quality sentence sets the index against yesterday, and stands alone without it', () => {
  const sheet = airSheet('63');
  assert.match(sheet(60), /Air quality index is 63, which is similar to yesterday at about this time\./);
  assert.match(sheet(120), /which is better than yesterday/);
  assert.match(sheet(20), /which is worse than yesterday/);
  assert.match(sheet(), /<p class="detail-text">Current AQI \(US\) is 63\.<\/p>/);
});

test('the air quality sheet runs sentence, scale, health, primary pollutant, details and source', () => {
  const html = airSheet('63', { attribution: 'Data from <a sample>' }, BREAKDOWN)(60),
    places = [
      'detail-text',
      'class="scale"',
      'Health Information',
      'Primary Pollutant',
      'Pollutant Details',
      'detail-source',
    ].map(mark => html.indexOf(mark));
  assert.ok(places.every(place => place >= 0));
  assert.deepEqual(
    places,
    places.toSorted((a, b) => a - b),
  );
  // No history chart and no About.
  assert.doesNotMatch(html, /class="chart|About/);
  assert.match(html, /<p>Data from &lt;a sample&gt;<\/p>/);
  // Whichever sensor is worst leads, with its digits set low.
  assert.match(
    html,
    /<div class="detail-sub">PM<sub>2\.5<\/sub> \(particulate matter under 2\.5µm\)<\/div><div class="detail-panel"><p>The finest/,
  );
  // Rows in order of their symbols, whatever order the sensors come in.
  assert.deepEqual(
    [...html.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)].map(m => [m[1], m[2]]),
    [
      ['CO Carbon Monoxide', '300 <small>ppb</small>'],
      ['NO<sub>2</sub> Nitrogen Dioxide', '19 <small>ppb</small>'],
      ['O<sub>3</sub> Ozone', '26 <small>ppb</small>'],
      ['PM<sub>10</sub> Particulates Under 10µm', '49 <small>µg/m³</small>'],
      ['PM<sub>2.5</sub> Particulates Under 2.5µm', '15 <small>µg/m³</small>'],
      ['SO<sub>2</sub> Sulfur Dioxide', '1 <small>ppb</small>'],
    ],
  );
});

test('the air quality sheet names the primary pollutant as the sensor does, in any form', () => {
  const heading = (name: string) =>
    /Primary Pollutant<\/h3><div class="detail-sub">(.*?)<\/div>(<div class="detail-panel"><p>)?/.exec(
      airSheet('63', { dominentpol: name }, BREAKDOWN)(),
    );
  assert.equal(heading('pm25')?.[1], 'PM<sub>2.5</sub> (particulate matter under 2.5µm)');
  assert.equal(heading('PM2.5')?.[1], 'PM<sub>2.5</sub> (particulate matter under 2.5µm)');
  assert.equal(heading('o3')?.[1], 'O<sub>3</sub> (ozone)');
  assert.equal(heading('Ozone')?.[1], 'O<sub>3</sub> (ozone)');
  assert.equal(heading('so2')?.[1], 'SO<sub>2</sub> (sulfur dioxide)');
  // One the card knows nothing of keeps its name, with nothing said about it.
  assert.equal(heading('lead')?.[1], 'LEAD');
  assert.equal(heading('lead')?.[2], undefined);
});

test('a sensor with no breakdown of its pollutants ends the sheet at health', () => {
  const html = airSheet('63')();
  assert.match(html, /Health Information/);
  assert.doesNotMatch(html, /Primary Pollutant|Pollutant Details|detail-source/);
});

test('moon distance and phases land on published dates', () => {
  // Full moon 24 Nov 2026 14:53 UTC, new moon 9 Nov 2026 07:02 UTC.
  assert.ok(
    Math.abs((nextMoonPhase(0.5, Date.UTC(2026, 9, 27)) ?? Number.NaN) - Date.UTC(2026, 10, 24, 14, 53)) < 45 * 60000,
  );
  assert.ok(
    Math.abs((nextMoonPhase(0, Date.UTC(2026, 9, 27)) ?? Number.NaN) - Date.UTC(2026, 10, 9, 7, 2)) < 45 * 60000,
  );
  const km = moonDistance(Date.UTC(2026, 9, 27));
  assert.ok(km > 356000 && km < 407000);
});

test('alerts read numbered warnings, numbered titles, and a colour for each hazard', () => {
  // A level from 1 to 4 in numbered records, the state the highest level: 0 is none.
  const level = { region_name: 'Heilbronn', warning_count: 1 };
  assert.deepEqual(weatherAlerts({ state: '0', attributes: { ...level, warning_count: 0 } }), []);
  const [storm] = weatherAlerts({
    state: '2',
    attributes: {
      ...level,
      warning_1_name: 'STARKES GEWITTER',
      warning_1: {
        event: 'STARKES GEWITTER',
        level: 2,
        headline: 'Amtliche WARNUNG vor STARKEM GEWITTER',
        description: 'Es treten Gewitter auf.',
        instruction: 'Aufenthalt im Freien vermeiden.',
        start_time: '2026-08-16T17:17:00+00:00',
        end_time: '2026-08-16T18:30:00+00:00',
      },
    },
  });
  assert.deepEqual(
    [storm?.event, storm?.text, alertLevel(storm?.severity), storm?.starts, storm?.ends, storm?.description],
    [
      'STARKES GEWITTER',
      'Amtliche WARNUNG vor STARKEM GEWITTER',
      'orange',
      Date.parse('2026-08-16T17:17:00Z'),
      Date.parse('2026-08-16T18:30:00Z'),
      'Es treten Gewitter auf.\n\nAufenthalt im Freien vermeiden.',
    ],
  );
  // Numbered titles on a sensor for one kind of alert, its state their count.
  const titles = (translation_key: string) =>
    weatherAlerts(
      {
        state: '2',
        attributes: {
          location: 'Calgary',
          alert_1: 'Severe Thunderstorm Watch',
          alert_time_1: '2026-08-16T16:36:10.115Z',
          alert_2: 'Rainfall Warning',
          friendly_name: 'Calgary Watches',
        },
      },
      { translation_key },
    );
  assert.deepEqual(
    titles('watches').map(alert => [alert.event, alertLevel(alert.severity), alert.sent]),
    [
      ['Severe Thunderstorm Watch', 'yellow', Date.parse('2026-08-16T16:36:10.115Z')],
      ['Rainfall Warning', 'yellow', Number.NaN],
    ],
  );
  assert.equal(alertLevel(titles('statements')[0]?.severity), 'green', 'a statement only informs');
  // A colour for each hazard, named in French, under the worst of them.
  const hazards = {
    'Vent violent': 'Vert',
    Orages: 'Jaune',
    Canicule: 'Orange',
    icon: 'mdi:weather-cloudy-alert',
    friendly_name: 'Strasbourg Weather alert',
  };
  assert.deepEqual(weatherAlerts({ state: 'Vert', attributes: { ...hazards, Orages: 'Vert', Canicule: 'Vert' } }), []);
  assert.deepEqual(
    weatherAlerts({ state: 'Orange', attributes: hazards }).map(alert => [alert.event, alertLevel(alert.severity)]),
    [
      ['Orages', 'yellow'],
      ['Canicule', 'orange'],
    ],
  );
  assert.deepEqual(
    weatherAlerts({ state: 'Rouge', attributes: { friendly_name: 'Weather alert' } }).map(alert => [
      alert.event,
      alertLevel(alert.severity),
    ]),
    [['Weather alert', 'red']],
    'with no hazard named, the state says how bad',
  );
});

test('alerts read NWS lists, Meteoalarm attributes and quiet sensors', () => {
  assert.deepEqual(weatherAlerts({ state: 'off', attributes: { event: 'x' } }), []);
  assert.equal(
    weatherAlerts({ state: 'on', attributes: { event: 'Wind', headline: 'Strong winds' } })[0]?.event,
    'Wind',
  );
  const nws = weatherAlerts({
    state: '2',
    attributes: { Alerts: [{ Event: 'Flood Watch', Headline: 'Flooding possible' }, { Event: 'Heat Advisory' }] },
  });
  assert.deepEqual(
    nws.map(alert => alert.event),
    ['Flood Watch', 'Heat Advisory'],
  );
  // An alert issued ahead of its hazard carries when the hazard begins as well as when it ends.
  const [watch] = weatherAlerts({
    state: 'on',
    attributes: {
      Alerts: [{ Event: 'Winter Storm Watch', Onset: '2026-10-29T18:00:00-05:00', Ends: '2026-10-30T12:00:00-05:00' }],
    },
  });
  if (!watch) throw new Error('No alert.');
  assert.equal(watch.starts, Date.parse('2026-10-29T23:00:00Z'));
  assert.equal(watch.ends, Date.parse('2026-10-30T17:00:00Z'));
  assert.throws(() => normalizeConfig({ entity: 'weather.home', alert_entities: ['weather.x'] }));
  // For the sheet: the message with its instructions, where, from the National Weather Service by
  // NWS Alerts' own fields, and the link; Meteoalarm's urgency, response type and sender.
  const [flood] = weatherAlerts({
    state: '1',
    attributes: {
      Alerts: [
        {
          Event: 'Flash Flood Warning',
          NWSCode: 'FFW',
          Description: 'Heavy rain across the warned area.',
          Instruction: 'Turn around, do not drown.',
          AreasAffected: 'Shawnee, KS',
          Sent: '2026-10-30T01:29:00-05:00',
          URL: 'https://api.weather.gov/alerts/x',
        },
      ],
    },
  });
  assert.deepEqual(
    [flood?.description, flood?.area, flood?.source, flood?.url, flood?.sent],
    [
      'Heavy rain across the warned area.\n\nTurn around, do not drown.',
      'Shawnee, KS',
      'National Weather Service',
      'https://api.weather.gov/alerts/x',
      Date.parse('2026-10-30T06:29:00Z'),
    ],
  );
  const [storm] = weatherAlerts({
    state: 'on',
    attributes: { event: 'Storm', urgency: 'Immediate', responseType: 'Shelter', senderName: 'Met Office' },
  });
  assert.deepEqual([storm?.urgency, storm?.responses, storm?.source], ['immediate', ['shelter'], 'Met Office']);
});

test('symbols follow the kind of sky, by day and night, and alerts show their level', async () => {
  const { weatherIcon, iconDetails, alertLevel, alertIcon } = await import('../src/weather/icons.ts');
  const { SYMBOLS, warning } = await import('../src/weather/symbols.ts');
  const units = { temperature_unit: '°F', wind_speed_unit: 'mph', precipitation_unit: 'mm' };
  assert.equal(
    weatherIcon('rainy', false, iconDetails({ cloud_coverage: 40 }, units)),
    SYMBOLS['sun-rain'],
    'rain with the sun showing',
  );
  assert.equal(weatherIcon('rainy', true, iconDetails({ cloud_coverage: 40 }, units)), SYMBOLS['moon-rain']);
  assert.equal(weatherIcon('rainy', false, { precipitation: 0.1, precipitationUnit: 'mm' }), SYMBOLS.drizzle);
  assert.equal(weatherIcon('lightning', true), SYMBOLS['moon-storm']);
  assert.equal(weatherIcon('pouring'), SYMBOLS['heavy-rain']);
  assert.equal(weatherIcon('fog', false, { visibility: 3, humidity: 40 }), SYMBOLS['sun-haze']);
  assert.equal(weatherIcon('fog', true, { visibility: 3, humidity: 40 }), SYMBOLS['moon-haze']);
  assert.equal(weatherIcon('sunny', false, iconDetails({ temperature: 100, cloud_coverage: 0 }, units)), SYMBOLS.hot);
  assert.equal(weatherIcon('windy'), SYMBOLS.wind);
  assert.equal(weatherIcon('snowy'), SYMBOLS.snow);
  assert.equal(
    weatherIcon('snowy', false, { precipitation: 0.1, precipitationUnit: 'mm' }),
    SYMBOLS.flurries,
    'flurries are a cloud with fewer flakes',
  );
  assert.equal(weatherIcon('sunny'), SYMBOLS.sun);
  assert.equal(weatherIcon('sunny', false, { cloudCover: 20 }), SYMBOLS.sun, 'a mostly clear day still shows the sun');
  assert.equal(weatherIcon('clear-night', true), SYMBOLS.moon, 'a clear night is a moon among stars');
  assert.equal(weatherIcon('clear-night', false), SYMBOLS.sun, 'its day form is the sun');
  assert.equal(weatherIcon('partlycloudy'), SYMBOLS['cloud-sun']);
  assert.equal(weatherIcon('partlycloudy', true), SYMBOLS['cloud-moon']);
  assert.equal(weatherIcon('cloudy'), SYMBOLS.cloud);
  assert.equal(weatherIcon('Light Rain'), SYMBOLS.rain, "an integration's own words take the nearest symbol");
  assert.equal(weatherIcon('Mostly Cloudy', true), SYMBOLS.cloud);
  assert.equal(weatherIcon('Partly Cloudy', true), SYMBOLS['cloud-moon']);
  assert.equal(weatherIcon('Breezy'), SYMBOLS.wind);
  assert.equal(weatherIcon('Smoke'), SYMBOLS.smoke);
  assert.equal(weatherIcon('Hurricane'), SYMBOLS.warning, 'as exceptional weather is with nothing to go on');
  assert.equal(weatherIcon('Frost'), weatherIcon('not weather'), 'words that name no weather keep the unknown mark');
  assert.notEqual(weatherIcon('Frost'), SYMBOLS.cloud);
  assert.equal(weatherIcon('cloudy', true), SYMBOLS.cloud, 'cloud hides the moon as it hides the sun');
  assert.equal(weatherIcon('exceptional'), SYMBOLS.warning, 'exceptional weather is a warning');
  assert.equal(weatherIcon('sunrise'), SYMBOLS.sunrise);
  assert.equal(weatherIcon('sunset'), SYMBOLS.sunset);
  assert.equal(
    weatherIcon('snowy', false, { precipitation: 4, precipitationUnit: 'mm' }),
    SYMBOLS['heavy-snow'],
    'heavy snow is more of it',
  );
  assert.equal(weatherIcon('snowy', false, { cloudCover: 40 }), SYMBOLS['sun-snow'], 'snow with the sun showing');
  assert.equal(weatherIcon('snowy', true, { cloudCover: 40 }), SYMBOLS['moon-snow']);
  assert.equal(alertLevel('Extreme'), 'red');
  assert.equal(alertLevel('2; yellow; Moderate'), 'yellow');
  assert.equal(alertLevel(undefined), 'yellow');
  assert.equal(alertIcon(['Minor', 'Severe']), warning('#f97316'), 'the most severe alert sets the level');
});

test('every condition has a symbol, flat, filled and still, and left for its row to name', async () => {
  const { weatherIcon, PRECIPITATION_GLYPHS } = await import('../src/weather/icons.ts');
  const { SYMBOLS } = await import('../src/weather/symbols.ts');
  const drawn: readonly string[] = Object.values(SYMBOLS);
  const conditions = [...WEATHER_CONDITIONS, 'windy', 'exceptional', 'sunrise', 'sunset'];
  for (const condition of conditions)
    for (const night of [false, true])
      assert.ok(drawn.includes(weatherIcon(condition, night)), `${condition} is one of the set`);
  const marks = ['conditions', 'wind', ...Object.values(PRECIPITATION_GLYPHS)].map(mark => weatherIcon(mark));
  for (const svg of [...drawn, ...marks]) {
    assert.match(svg, /^<svg [^>]*aria-hidden="true"/);
    assert.doesNotMatch(svg, /<animate|<style|<title|Gradient|filter=|mask=/);
  }
  // The cloud has no outline, and the set keeps its two colours.
  const cloud = SYMBOLS.cloud;
  assert.doesNotMatch(cloud, /stroke/);
  assert.match(SYMBOLS.sun, /fill="#ffd702"/);
  assert.match(SYMBOLS.rain, /stroke="#39d1fd"/);
  assert.match(SYMBOLS.drizzle, /stroke-dasharray/);
  assert.doesNotMatch(SYMBOLS.rain, /stroke-dasharray/);
});

test("only a web address is offered as an alert's source", () => {
  const link = (url: string) => weatherAlerts({ state: 'on', attributes: { event: 'Wind', url } })[0]?.url;
  assert.equal(link('https://alerts.example.org/1'), 'https://alerts.example.org/1');
  assert.equal(link('http://alerts.example.org/1'), 'http://alerts.example.org/1');
  assert.equal(link('javascript:alert(1)'), undefined);
  assert.equal(link('www.example.org'), undefined);
});

test('numbers follow the profile, and the language only where the profile leaves them to it', () => {
  const written = (format: string | undefined, language = 'en') =>
    weatherNumber(1234.5, numberLocale(format, language), 1);
  assert.equal(written(undefined), '1,234.5', 'unset goes by the language');
  assert.equal(written('language', 'de'), '1.234,5');
  assert.equal(written('comma_decimal', 'de'), '1,234.5');
  assert.equal(written('decimal_comma'), '1.234,5');
  assert.match(written('space_comma'), /^1\s234,5$/u);
  assert.match(written('quote_decimal'), /^1.234\.5$/u);
  assert.equal(written('none', 'de'), '1234.5', 'none is plain digits and a point, with nothing between thousands');
  assert.equal(numberLocale('system', 'de'), undefined, "system leaves it to the browser's own");
  assert.equal(precipitationAmount(1234.4, 'mm', numberLocale('decimal_comma', 'en')), '1.234 mm');
});
