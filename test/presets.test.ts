import { test } from 'vitest';
import assert from 'node:assert/strict';
import { lightingFor, skyGradientFor, skyKind, skyPreset, sunDirection } from '../src/sky/presets.ts';
import { dropletTier, dropletsFor } from '../src/sky/droplets.ts';
import { scenePreset } from '../src/sky/sky.ts';

test('named clear and cloud conditions retain their kind across cover values', () => {
  for (const cloudCover of [0, 12.5, 37.5, 62.5, 87.5, 100, Number.NaN]) {
    assert.equal(skyKind('sunny', { cloudCover }), 'clear');
    assert.equal(skyKind('clear-night', { cloudCover }), 'clear');
    assert.equal(skyKind('partlycloudy', { cloudCover }), 'partlyCloudyLowAltitude');
    assert.equal(skyKind('cloudy', { cloudCover }), 'cloudyLowAltitude');
  }
  assert.equal(skyKind('rainy', { precipitation: 0.2 }), 'drizzle');
  assert.equal(skyKind('pouring'), 'heavyRain');
});

test('wind coverage selects each cloud band at its lower endpoint', () => {
  const bands = [
    [0, 'clear'],
    [12.499, 'clear'],
    [12.5, 'mostlyClear'],
    [37.499, 'mostlyClear'],
    [37.5, 'partlyCloudyLowAltitude'],
    [62.499, 'partlyCloudyLowAltitude'],
    [62.5, 'mostlyCloudyLowAltitude'],
    [87.499, 'mostlyCloudyLowAltitude'],
    [87.5, 'cloudyLowAltitude'],
    [100, 'cloudyLowAltitude'],
  ] as const;
  for (const condition of ['windy', 'windy-variant', 'Breezy'])
    for (const [cloudCover, kind] of bands) assert.equal(skyKind(condition, { cloudCover }), kind);
  assert.equal(skyKind('windy'), 'mostlyClear');
  assert.equal(skyKind('windy-variant'), 'mostlyCloudyLowAltitude');
  assert.equal(skyKind('windy', { cloudCover: Number.NaN }), 'mostlyClear');
  assert.equal(skyKind('windy-variant', { cloudCover: Number.POSITIVE_INFINITY }), 'mostlyCloudyLowAltitude');
});

test('named cloud conditions follow the available cloud height', () => {
  for (const [cloudAltitude, suffix] of [
    ['low', 'LowAltitude'],
    ['mid', 'MidAltitude'],
    ['high', 'HighAltitude'],
  ] as const) {
    assert.equal(skyKind('partlycloudy', { cloudAltitude, cloudCover: 90 }), `partlyCloudy${suffix}`);
    assert.equal(skyKind('cloudy', { cloudAltitude, cloudCover: 10 }), `cloudy${suffix}`);
    assert.equal(skyKind('Mostly Cloudy', { cloudAltitude, cloudCover: 5 }), `mostlyCloudy${suffix}`);
    assert.equal(skyKind('windy', { cloudAltitude, cloudCover: 70 }), `mostlyCloudy${suffix}`);
  }
  assert.equal(skyKind('sunny', { cloudCover: 30, cloudAltitude: 'high' }), 'clear');
  assert.equal(skyPreset('mostlyCloudyHighAltitude').sky, 'default_high');
});

test("by day the sun lights the clouds' faces, from its own side of the sky", () => {
  const [x, y, z] = sunDirection(120, -50);
  assert.ok(Math.abs(x + 0.383) < 0.001 && Math.abs(y - 0.866) < 0.001 && Math.abs(z - 0.321) < 0.001);
  for (const kind of ['partlyCloudyLowAltitude', 'mostlyCloudyLowAltitude', 'partlyCloudyMidAltitude'] as const)
    for (const elevation of [12, 15.6, 18, 25, 30]) {
      const morning = lightingFor(kind, elevation, true).direction,
        afternoon = lightingFor(kind, elevation, false).direction;
      assert.ok(morning[2] > 0 && afternoon[2] > 0, `${kind} at ${elevation}°: in front of the clouds`);
      assert.ok(morning[1] > 0 && afternoon[1] > 0, `${kind} at ${elevation}°: from above`);
      if (elevation <= 18)
        assert.ok(morning[0] < 0 && afternoon[0] > 0, `${kind} at ${elevation}°: from the left, then the right`);
    }
});

test('while the moon shows, a sky with a moon is lit by its own moonlight', () => {
  assert.equal(lightingFor('clear', -60).sun, '#978ede');
  assert.equal(lightingFor('clear', -60, true, true).sun, '#5d5dde', 'bluer by night');
  assert.equal(lightingFor('cloudyHighAltitude', -60, true, true).sun, lightingFor('cloudyHighAltitude', -60).sun);
  const night = { condition: 'clear-night', night: true, elevation: -60 };
  assert.equal(scenePreset({ ...night, moonAltitude: 30 }).light.sun, '#5d5dde');
  assert.equal(
    scenePreset({ ...night, moonAltitude: 5 }).light.sun,
    '#978ede',
    'a moon too low to show lights nothing',
  );
});

test('mist that has lifted shows the sky above it, a low deck when that is full or unknown', () => {
  const lifted = { visibility: 8 };
  assert.equal(skyKind('fog', lifted), 'cloudyLowAltitude');
  assert.equal(skyKind('fog', { ...lifted, cloudCover: 100 }), 'cloudyLowAltitude');
  assert.equal(skyKind('fog', { ...lifted, cloudCover: 75 }), 'mostlyCloudyLowAltitude');
  assert.equal(skyKind('fog', { ...lifted, cloudCover: 40 }), 'partlyCloudyLowAltitude');
  assert.equal(skyKind('fog', { ...lifted, cloudCover: 5 }), 'clear');
});

test('cloud altitude selects the blanket and four depth groups', () => {
  const low = skyPreset('cloudyLowAltitude'),
    mid = skyPreset('cloudyMidAltitude'),
    high = skyPreset('cloudyHighAltitude');
  const art = (look: typeof low) => look.decks.map(deck => [deck?.[6], deck?.[1]]);
  assert.equal(low.blanket?.[3], 'Stratus_Blanket');
  assert.equal(mid.blanket?.[3], 'Altostratus_Blanket');
  assert.equal(high.blanket?.[3], 'Altostratus_Blanket');
  assert.deepEqual(art(low), [
    ['Altostratus_SingleL', 4],
    ['Cumulus_SingleL', 6],
    ['Cumulus_SingleM', 4],
    ['Wispy_Single', 6],
  ]);
  assert.deepEqual(art(mid), [
    ['Altostratus_SingleL', 6],
    ['Altostratus_SingleL', 6],
    ['Altostratus_SingleS', 4],
    ['Wispy_Single', 6],
  ]);
  assert.deepEqual(art(high), [
    ['Altostratus_SingleL', 6],
    ['Cirrostratus_SingleL', 6],
    ['Cirrus_SingleS', 4],
    ['Wispy_Single', 6],
  ]);
  assert.deepEqual(
    low.decks.map(deck => deck?.[4]),
    [
      [0.3, 0.9],
      [0.2, 0.6],
      [0.2, 0.8],
      [0.5, 1],
    ],
  );
});

test('the layout selects emitter geometry while time selects its lighting', () => {
  const inputs = { condition: 'cloudy', cloudAltitude: 'low', elevation: 60 } as const;
  const day = scenePreset(inputs),
    night = scenePreset({ ...inputs, night: true, elevation: -18 }),
    wide = scenePreset({ ...inputs, windowClass: 'landscapeRegular' });
  assert.deepEqual(day.look.decks, night.look.decks);
  assert.equal(wide.look, skyPreset('cloudyLowAltitude', 'landscapeRegular'));
  assert.notDeepEqual(day.look.decks, wide.look.decks);
  assert.deepEqual([day.light.sunIntensity, day.light.ambientIntensity], [1000, 1]);
  assert.deepEqual([night.light.sunIntensity, night.light.ambientIntensity], [200, 0.1]);
  assert.equal(day.light.cloudAlpha[0], 0.25);
  assert.equal(day.light.cloudAlpha[3], 0.5);
});

test('high sun uses the three sky colors underneath each cloud band', () => {
  for (const [cloudAltitude, colors] of [
    ['low', ['#7b8796', '#65717e', '#5a6570']],
    ['mid', ['#85bce0', '#a9d4e6', '#b9cdcc']],
    ['high', ['#bfd0e4', '#a7b8ca', '#90a0b0']],
  ] as const) {
    assert.deepEqual(scenePreset({ condition: 'cloudy', elevation: 60, cloudAltitude }).sky, colors);
  }
  assert.deepEqual(scenePreset({ condition: 'mostly cloudy', cloudAltitude: 'low', elevation: 60 }).sky, [
    '#064b8e',
    '#3679ba',
    '#62a3e5',
  ]);
});

test('missing cloud height uses low cloud independently of surface humidity', () => {
  for (const readings of [
    {},
    { temperature: 3, dewPoint: 2 },
    { temperature: 15.5, dewPoint: 10.5 },
    { temperature: 3 },
  ]) {
    assert.equal(skyKind('cloudy', readings), 'cloudyLowAltitude');
    assert.equal(skyKind('partlycloudy', readings), 'partlyCloudyLowAltitude');
  }
  assert.equal(skyKind('cloudy', { temperature: 3, dewPoint: 2, cloudAltitude: 'high' }), 'cloudyHighAltitude');
  // Custom entity attributes arrive as JSON and can contain a height the card doesn't know.
  assert.equal(skyKind('cloudy', { cloudAltitude: '900 m' }), 'cloudyLowAltitude');
});

test('sky gradients and light interpolate the keyframes by sun elevation', () => {
  assert.deepEqual(skyGradientFor('clear', -60), ['#030317', '#21243e', '#2d3e5e', 0.5]);
  assert.deepEqual(skyGradientFor('drizzle', 30, true).slice(0, 3), ['#647386', '#607286', '#455364']);
  const evening = skyGradientFor('clear', 3, false),
    morning = skyGradientFor('clear', 3, true);
  assert.notDeepEqual(evening, morning, 'evening skies differ from morning ones');
  assert.ok(lightingFor('clear', -60).stars > 0.5 && lightingFor('clear', 30).stars === 0);
});

test('presets drive the scene: decks, layers and precipitation', () => {
  const partly = scenePreset({ condition: 'partlycloudy', cloudAltitude: 'mid', elevation: 30 });
  assert.deepEqual(
    partly.look.decks.map(deck => deck?.[0] ?? null),
    skyPreset('partlyCloudyMidAltitude').decks.map(deck => deck?.[0] ?? null),
  );
  assert.equal(partly.sky[0], skyGradientFor('partlyCloudyMidAltitude', 30)[0]);
  assert.ok(
    scenePreset({ condition: 'pouring', elevation: 30 }).rain > scenePreset({ condition: 'rainy', elevation: 30 }).rain,
  );
  assert.equal(scenePreset({ condition: 'clear-night', night: true, elevation: -40 }).rain, 0);
});

test('rain beads on the glass by tier, and stays inside each panel', () => {
  assert.equal(dropletTier('drizzle'), 1);
  assert.equal(dropletTier('heavyRain'), 3);
  assert.equal(dropletTier('clear'), 0);
  assert.equal(dropletTier('thunderstorms'), 2);
  assert.equal(dropletTier('wintryMix'), 1);
  assert.equal(dropletTier('hail'), 0);
  const rect = { x: 10, y: 20, width: 300, height: 200 },
    light = dropletsFor(rect, 0, 1, 5000),
    heavy = dropletsFor(rect, 0, 3, 5000);
  assert.ok(heavy.length > light.length);
  for (const drop of heavy)
    assert.ok(drop.x >= rect.x && drop.x <= rect.x + rect.width && drop.y >= rect.y && drop.y <= rect.y + rect.height);
  assert.deepEqual(
    dropletsFor(rect, 0, 2, 1234),
    dropletsFor(rect, 0, 2, 1234),
    'the same moment draws the same glass',
  );
});

test('frost replaces rain beads in freezing weather and gathers at the panel edges', async () => {
  const { frostEffect, frostFor } = await import('../src/sky/droplets.ts');
  // The rule: under 20 °F in snow, or in calm skies only between 5 and 8 am.
  assert.equal(frostEffect('snow', -8, 14), true);
  assert.equal(frostEffect('snow', 0, 14), false, '32 °F is too warm');
  assert.equal(frostEffect('clear', -10, 7), true);
  assert.equal(frostEffect('clear', -10, 14), false, 'only in the early morning');
  assert.equal(frostEffect('rain', -10, 7), false, 'rain never frosts');
  assert.equal(frostEffect('cloudyLowAltitude', -10, 6), true);
  const rect = { x: 0, y: 0, width: 400, height: 300 },
    crystals = frostFor(rect, 0);
  // Two in three lie in the outer fifth of the panel; none in its middle tenth.
  const edgy = crystals.filter(piece => piece.y < 60 || piece.y > 240).length;
  assert.ok(edgy / crystals.length > 0.6);
  assert.ok(crystals.every(piece => piece.y < 136 || piece.y > 164));
});

test('sun extras and lightning follow each preset', () => {
  const clear = scenePreset({ condition: 'sunny', elevation: 40 }),
    partly = scenePreset({ condition: 'partlycloudy', elevation: 40 });
  assert.ok(clear.rays && clear.ghosts && clear.rainbow);
  assert.ok(partly.rays && partly.rainbow);
  assert.equal(partly.ghosts, null);
  assert.equal(scenePreset({ condition: 'sunny', night: true, elevation: -30 }).rays, null);
  const storm = scenePreset({ condition: 'lightning-rainy', elevation: 20 });
  assert.equal(storm.lightning, true);
  assert.deepEqual(storm.strikes.strikeInterval, [6, 9]);
  assert.equal(storm.strikes.branchCount, 3);
});

test("lightning without rain, and drizzle from the current hour's amount", async () => {
  const { sceneInputs } = await import('../src/weather/conditions.ts');
  const storm = scenePreset({ condition: 'lightning', elevation: 20 });
  assert.equal(storm.kind, 'isolatedThunderstorms');
  assert.equal(storm.look.blanket?.[3], 'Cumulonimbus_BlanketS');
  assert.deepEqual(
    scenePreset({ condition: 'lightning', elevation: -20, night: true }).look.blanket,
    storm.look.blanket,
  );
  assert.equal(storm.lightning, true);
  assert.equal(storm.rain, 0);
  assert.ok(scenePreset({ condition: 'lightning-rainy', elevation: 20 }).rain > 0);
  const now = Date.parse('2026-10-27T15:20:00Z'),
    hourly = [
      { datetime: '2026-10-27T15:00:00Z', precipitation: 0.2 },
      { datetime: '2026-10-27T16:00:00Z', precipitation: 3 },
    ];
  const state = { state: 'rainy', attributes: { precipitation_unit: 'mm' } };
  const light = sceneInputs(state, undefined, {}, now, hourly);
  assert.equal(light.precipitation, 0.2);
  assert.equal(scenePreset(light).kind, 'drizzle');
  assert.equal(scenePreset(sceneInputs(state, undefined, {}, now, [{ ...hourly[0], precipitation: 2 }])).kind, 'rain');
  assert.equal(
    scenePreset(
      sceneInputs({ state: 'rainy', attributes: { precipitation_unit: 'in' } }, undefined, {}, now, [
        { ...hourly[0], precipitation: 0.01 },
      ]),
    ).kind,
    'drizzle',
  );
  assert.equal(scenePreset(sceneInputs(state, undefined, {}, now, [])).kind, 'rain', 'no amount: plain rain');
});

test('the sun follows its path through the solar day', async () => {
  const { solarHour, sunPathAt } = await import('../src/sky/presets.ts');
  const H = 3600000,
    sunrise = Date.parse('2026-10-27T12:00:00Z'),
    sunset = sunrise + 11 * H;
  // Daytime: next sunset today, next sunrise tomorrow.
  assert.equal(solarHour(sunrise + 5.5 * H, { nextSetting: sunset, nextRising: sunrise + 24 * H }), 12);
  assert.equal(solarHour(sunrise, { nextSetting: sunset, nextRising: sunrise + 24 * H }), 6);
  // Night: next sunrise comes first.
  assert.ok(solarHour(sunset + H, { nextSetting: sunset + 24 * H, nextRising: sunrise + 24 * H }) > 18);
  const noon = sunPathAt(12),
    morning = sunPathAt(7.5),
    evening = sunPathAt(16.5);
  assert.deepEqual([noon.x, noon.y, noon.rayAngle], [0.5, 0, 0]);
  assert.ok(morning.x < 0.5 && evening.x > 0.5, 'left in the morning, right in the evening');
  assert.ok(morning.rayAngle > 0 && evening.rayAngle < 0);
  assert.equal(morning.ghosts, 10);
  assert.ok(sunPathAt(3).x < 0, 'below the horizon it is off screen');
});

test('condition definitions refine Home Assistant conditions when the entity reports enough', () => {
  assert.equal(skyKind('snowy', { precipitation: 0.2 }), 'flurries', 'light snow');
  assert.equal(skyKind('snowy', { precipitation: 1 }), 'snow');
  assert.equal(skyKind('snowy', { precipitation: 1, windSpeed: 12 }), 'blowingSnow', 'snow in a strong breeze');
  assert.equal(
    skyKind('rainy', { precipitation: 0.2, temperature: -1 }),
    'freezingDrizzle',
    'light rain at or below freezing',
  );
  assert.equal(skyKind('rainy', { temperature: -1 }), 'freezingRain', 'rain of no known rate at or below freezing');
  assert.equal(skyKind('rainy', { precipitation: 2, temperature: -1 }), 'freezingRain', 'rain at or below freezing');
  assert.equal(skyKind('rainy', { precipitation: 2, cloudCover: 40 }), 'sunShowers', 'rain with the sun showing');
  assert.equal(skyKind('rainy', { precipitation: 2, cloudCover: 90 }), 'rain');
  assert.equal(skyKind('lightning-rainy', { cloudCover: 45 }), 'scatteredThunderstorms');
  assert.equal(skyKind('lightning-rainy', { cloudCover: 80 }), 'thunderstorms');
  assert.equal(skyKind('fog', { visibility: 3, humidity: 40 }), 'haze', 'a kilometre or more through dry air is haze');
  assert.equal(
    skyKind('fog', { visibility: 3, temperature: 30, dewPoint: 10 }),
    'haze',
    'as is air far from its dew point',
  );
  assert.equal(skyKind('fog', { visibility: 3, humidity: 100 }), 'foggy', 'through wet air it is mist, drawn as fog');
  assert.equal(skyKind('fog', { visibility: 3 }), 'foggy', 'air not known to be dry is taken for wet');
  assert.equal(
    skyKind('fog', { visibility: 6.4, humidity: 100 }),
    'cloudyLowAltitude',
    'past 5 km the sky above shows',
  );
  assert.equal(skyKind('fog', { visibility: 8, cloudCover: 10 }), 'clear', 'as its cover, where reported');
  assert.equal(skyKind('fog', { visibility: 0.4 }), 'foggy');
  assert.equal(skyKind('fog'), 'foggy', 'nothing reported, nothing assumed');
  assert.equal(skyKind('snowy'), 'snow');
  assert.equal(skyKind('snowy', { precipitation: 0 }), 'snow', 'a reported 0 says nothing about how hard');
  assert.equal(skyKind('rainy', { precipitation: 0 }), 'rain');
});

test('snow on a gale is a blizzard unless the air is clear enough to see through', () => {
  assert.equal(skyKind('snowy', { windSpeed: 16 }), 'blizzard', 'with no visibility known, the wind decides');
  assert.equal(skyKind('snowy', { windSpeed: 16, visibility: 0.3 }), 'blizzard');
  assert.equal(skyKind('snowy', { windSpeed: 16, visibility: 2 }), 'blowingSnow', 'a gale you can see through');
  assert.equal(skyKind('snowy', { windSpeed: 15 }), 'blowingSnow');
});

test('exceptional weather is told apart by its wind and air', () => {
  const haze = { visibility: 3, temperature: 35, dewPoint: 5 };
  assert.equal(skyKind('exceptional', { ...haze, windSpeed: 12 }), 'blowingDust', 'wind in dry, thick air');
  assert.equal(skyKind('exceptional', { ...haze, windSpeed: 3 }), 'smoky', 'still, thick air');
  assert.equal(skyKind('exceptional', { visibility: 3, windSpeed: 3 }), 'smoky', 'still air of no known dryness');
  assert.equal(skyKind('exceptional', { windSpeed: 25 }), 'tropicalStorm');
  assert.equal(skyKind('exceptional', { windSpeed: 33 }), 'hurricane');
  assert.equal(
    skyKind('exceptional', { windSpeed: 25, visibility: 3, temperature: 26, dewPoint: 24 }),
    'tropicalStorm',
    'humid air carries no dust',
  );
  assert.equal(skyKind('exceptional'), 'hurricane', 'nothing to go on');
  assert.equal(skyKind('exceptional', { windSpeed: 3 }), 'cloudyLowAltitude', 'a calm is no storm');
});

test("an integration's own words draw the nearest sky, refined by the readings as a condition is", () => {
  assert.equal(skyKind('Light Rain'), 'rain');
  assert.equal(skyKind('light rain', { precipitation: 0.2 }), 'drizzle', 'the readings still refine it');
  assert.equal(skyKind('Showers', { cloudCover: 30 }), 'sunShowers');
  assert.equal(skyKind('LightRainSun'), 'sunShowers', 'joined-up words');
  assert.equal(skyKind('Dark_LightRainThunderSun'), 'scatteredThunderstorms');
  assert.equal(skyKind('Thunderstorm'), 'thunderstorms');
  assert.equal(skyKind('Isolated Thunderstorms'), 'isolatedThunderstorms');
  assert.equal(skyKind('heavy intensity rain'), 'heavyRain');
  assert.equal(skyKind('Freezing Rain'), 'freezingRain');
  assert.equal(skyKind('Drizzle'), 'drizzle');
  assert.equal(skyKind('rain', { cloudCover: 10, temperature: -1, precipitation: 0.2 }), 'rain');
  assert.equal(skyKind('foggy', { visibility: 10 }), 'foggy');
  assert.equal(skyKind('thunderstorms', { cloudCover: 10, precipitation: 10 }), 'thunderstorms');
  assert.equal(skyKind('StrongStorms'), 'strongStorms');
  assert.equal(skyKind('SunFlurries'), 'sunFlurries');
  assert.equal(skyKind('Hot'), 'hot');
  assert.equal(skyKind('Frigid'), 'frigid');
  assert.equal(skyKind('Sleet'), 'sleet');
  assert.equal(skyKind('Rain and Snow'), 'wintryMix');
  assert.equal(skyKind('Snow Showers'), 'snow', 'showers of snow are snow');
  assert.equal(skyKind('snow', { windSpeed: 16 }), 'snow');
  assert.equal(skyKind('Chance Flurries'), 'flurries');
  assert.equal(skyKind('Mist', { visibility: 3, humidity: 95 }), 'foggy');
  assert.equal(skyKind('Haze'), 'haze');
  assert.equal(skyKind('Smoke'), 'smoky');
  assert.equal(skyKind('Dust Storm'), 'blowingDust', 'a dust storm is no thunderstorm');
  assert.equal(skyKind('Windy'), 'mostlyClear');
  assert.equal(skyKind('Breezy and Mostly Cloudy'), 'mostlyCloudyLowAltitude');
  assert.equal(
    skyKind('Breezy and Mostly Cloudy', { cloudCover: 5, cloudAltitude: 'high' }),
    'mostlyCloudyHighAltitude',
  );
  assert.equal(skyKind('Breezy and Mostly Sunny', { cloudCover: 95 }), 'mostlyClear');
  assert.equal(skyKind('Windstorm'), 'mostlyClear');
  assert.equal(skyKind('Overcast clouds'), 'cloudyLowAltitude');
  assert.equal(skyKind('Mostly Cloudy'), 'mostlyCloudyLowAltitude');
  assert.equal(skyKind('Mixed sun and cloud'), 'partlyCloudyLowAltitude');
  assert.equal(skyKind('Dark_LightCloud'), 'partlyCloudyLowAltitude');
  assert.equal(skyKind('Mostly Sunny'), 'mostlyClear');
  assert.equal(skyKind('Clear sky', { cloudCover: 30 }), 'clear');
  assert.equal(skyKind('Hurricane'), 'hurricane');
  assert.equal(skyKind('Frost'), 'cloudyLowAltitude', 'words that name no weather keep the overcast sky');
  assert.equal(skyKind('Bewölkt'), 'cloudyLowAltitude', 'only English is read');
});

test('explicit provider conditions keep their named preset through conflicting readings', () => {
  const readings = {
    cloudCover: 100,
    cloudAltitude: 'high',
    precipitation: 10,
    windSpeed: 40,
    visibility: 20,
    temperature: -5,
  } as const;
  for (const condition of [
    'blizzard',
    'blowingDust',
    'blowingSnow',
    'clear',
    'drizzle',
    'flurries',
    'foggy',
    'freezingDrizzle',
    'freezingRain',
    'frigid',
    'hail',
    'haze',
    'heavyRain',
    'heavySnow',
    'hot',
    'hurricane',
    'isolatedThunderstorms',
    'mostlyClear',
    'rain',
    'scatteredThunderstorms',
    'sleet',
    'smoky',
    'snow',
    'strongStorms',
    'sunFlurries',
    'sunShowers',
    'thunderstorms',
    'tropicalStorm',
    'wintryMix',
  ])
    assert.equal(skyKind(condition, readings), condition);
  assert.equal(skyKind('mostlyCloudy', readings), 'mostlyCloudyHighAltitude');
  assert.equal(skyKind('partlyCloudy', readings), 'partlyCloudyHighAltitude');
});

test("an integration's own words take the nearest condition's scene, and no condition takes none", async () => {
  const { nearestCondition } = await import('../src/weather/condition-words.ts');
  assert.deepEqual(
    { ...scenePreset({ condition: 'Heavy Rain' }), condition: 'pouring' },
    scenePreset({ condition: 'pouring' }),
  );
  assert.equal(nearestCondition('lightning-rainy'), 'lightning-rainy', "Home Assistant's own stay as they are");
  for (const none of ['unknown', 'unavailable', '', 'Frost']) assert.equal(nearestCondition(none), undefined, none);
});

test('every kind of sky has a preset that names its own gradient and keyframes', () => {
  for (const kind of ['blizzard', 'freezingRain', 'tropicalStorm', 'blowingDust'] as const) {
    const look = skyPreset(kind);
    assert.ok(look.light.length > 0, kind);
    assert.ok(look.layers.length > 0, kind);
  }
  assert.ok(skyPreset('blowingDust').layers.includes('dust'));
});
