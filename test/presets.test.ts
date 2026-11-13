import { test } from 'vitest';
import assert from 'node:assert/strict';
import { lightingFor, skyGradientFor, skyKind, skyPreset, sunDirection } from '../src/sky/presets.ts';
import { dropletTier, dropletsFor } from '../src/sky/droplets.ts';
import { WeatherScene } from '../src/sky/scene.ts';
import { blanketSprite } from '../src/sky/cloud-decks.ts';
import { scenePreset, type SceneInputs } from '../src/sky/sky.ts';

test('conditions map to kinds of sky, with cloud cover at its thresholds', () => {
  assert.equal(skyKind('partlycloudy'), 'partlyCloudyMidAltitude');
  assert.equal(skyKind('sunny', { cloudCover: 5 }), 'clear');
  assert.equal(skyKind('sunny', { cloudCover: 30 }), 'mostlyClear');
  assert.equal(skyKind('cloudy', { cloudCover: 70 }), 'mostlyCloudyMidAltitude');
  assert.equal(skyKind('cloudy'), 'cloudyHighAltitude', 'a full overcast is the high sky of soft mottling');
  assert.equal(skyKind('rainy', { precipitation: 0.2 }), 'drizzle');
  assert.equal(skyKind('pouring'), 'heavyRain');
});

test('a cover refines the condition and never overrules it, wherever the cover came from', () => {
  assert.equal(skyKind('clear-night', { cloudCover: 95 }), 'mostlyClear', 'clear stays at most mostly clear');
  assert.equal(skyKind('sunny', { cloudCover: 70 }), 'mostlyClear');
  assert.equal(skyKind('partlycloudy', { cloudCover: 5 }), 'mostlyClear');
  assert.equal(skyKind('partlycloudy', { cloudCover: 50 }), 'partlyCloudyMidAltitude');
  assert.equal(skyKind('partlycloudy', { cloudCover: 100 }), 'mostlyCloudyMidAltitude', 'never overcast');
  assert.equal(skyKind('cloudy', { cloudCover: 10 }), 'mostlyCloudyMidAltitude', 'never more than broken');
  assert.equal(skyKind('cloudy', { cloudCover: 90 }), 'cloudyHighAltitude');
});

test('a cloudy sky is drawn at the height of its cloud, where that is known', () => {
  assert.equal(skyKind('partlycloudy', { cloudAltitude: 'high' }), 'partlyCloudyHighAltitude');
  assert.equal(skyKind('partlycloudy', { cloudCover: 50, cloudAltitude: 'low' }), 'partlyCloudyLowAltitude');
  assert.equal(skyKind('partlycloudy', { cloudCover: 70, cloudAltitude: 'high' }), 'mostlyCloudyHighAltitude');
  assert.equal(skyKind('cloudy', { cloudCover: 80, cloudAltitude: 'low' }), 'mostlyCloudyLowAltitude');
  assert.equal(skyKind('cloudy', { cloudCover: 100, cloudAltitude: 'low' }), 'cloudyLowAltitude');
  assert.equal(skyKind('cloudy', { cloudCover: 100, cloudAltitude: 'mid' }), 'cloudyMidAltitude');
  const muggy = { temperature: 20, dewPoint: 18 };
  assert.equal(skyKind('cloudy', { ...muggy, cloudAltitude: 'high' }), 'cloudyHighAltitude', 'the height known wins');
  assert.equal(skyKind('cloudy', muggy), 'cloudyLowAltitude');
  assert.equal(skyKind('windy-variant', { cloudAltitude: 'low' }), 'mostlyCloudyLowAltitude');
  assert.equal(
    skyKind('sunny', { cloudCover: 30, cloudAltitude: 'high' }),
    'mostlyClear',
    'clear skies have no height',
  );
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
  assert.equal(skyKind('fog', { ...lifted, cloudCover: 75 }), 'mostlyCloudyMidAltitude');
  assert.equal(skyKind('fog', { ...lifted, cloudCover: 40 }), 'partlyCloudyMidAltitude');
  assert.equal(skyKind('fog', { ...lifted, cloudCover: 5 }), 'clear');
});

test('a full overcast is soft mottling in the upper sky, with no heaps and no lid', () => {
  const { decks, wideDecks, blanket } = skyPreset(skyKind('cloudy'));
  for (const deck of [...decks, ...wideDecks]) {
    assert.ok(deck && ['stratus', 'wispy'].includes(deck[0]), 'nothing here stops at a scalloped edge');
    assert.ok(deck[3] >= 10, 'it hangs in the upper half of the frame, and thins out above the page');
    assert.ok((deck[7] ?? 0) > 1, 'its puffs are rounder than the bake leaves them');
  }
  assert.equal(blanket?.[0], 'cirrus', 'a cirrus blanket counts as overcast but draws no lid');
  assert.deepEqual(
    scenePreset({ condition: 'cloudy', elevation: 30 }).sky,
    skyGradientFor('cloudyHighAltitude', 30).slice(0, 3),
    'with no lid to lighten it, the sky is its gradient',
  );
});

test('clouds in each deck of an overcast or rain sky drift at their own speeds, so they pass one another', () => {
  for (const kind of ['cloudyHighAltitude', 'cloudyMidAltitude', 'cloudyLowAltitude', 'rain'] as const) {
    const { decks, wideDecks, day } = skyPreset(kind);
    for (const deck of [...decks, ...wideDecks, ...(day?.decks ?? []), ...(day?.wideDecks ?? [])]) {
      if (!deck) continue;
      const [low, high] = deck[4];
      assert.ok(high >= low * 2, `${kind}: the fastest ${deck[0]} go at least twice as fast as the slowest`);
    }
  }
});

test('a full overcast takes fine fibres while the sun is up, and keeps its soft mottling after dark', () => {
  const { day, decks } = skyPreset(skyKind('cloudy'));
  assert.equal(day?.decks[3]?.[0], 'cirrus');
  assert.deepEqual(day.decks.slice(0, 2), decks.slice(0, 2), 'the soft sky behind them is the same');
  assert.deepEqual(scenePreset({ condition: 'cloudy', night: false, elevation: 30 }).look.decks, day.decks);
  assert.deepEqual(scenePreset({ condition: 'cloudy', night: true, elevation: -20 }).look.decks, decks);
});

test('a wide overcast is a soft layered field, not a few solid clouds', () => {
  const low = skyPreset('cloudyLowAltitude'),
    high = skyPreset('cloudyHighAltitude');
  for (const look of [low.wideDecks, high.day?.wideDecks ?? [], skyPreset('cloudyMidAltitude').wideDecks])
    for (const deck of look) assert.ok((deck?.[6] ?? 1) <= 0.6, 'each deck is thin enough to read as part of a field');
  assert.ok((low.wideDecks[1]?.[3] ?? 0) > 8, 'the main deck sits in the top of the sky, with plain sky below it');
  assert.notDeepEqual(low.wideDecks, low.decks, 'a narrow card keeps its own decks');
});

test('overcast and rain by day show their gradient as it is', () => {
  for (const [condition, kind, weather] of [
    ['cloudy', 'cloudyLowAltitude', { temperature: 3, dewPoint: 2 }],
    ['cloudy', 'cloudyHighAltitude', {}],
    ['rainy', 'rain', {}],
  ] as const) {
    const { sky } = scenePreset({ condition, elevation: 30, night: false, ...weather });
    assert.deepEqual(sky, skyGradientFor(kind, 30, true).slice(0, 3), kind);
  }
});

test('a full overcast by day has a deck darker than the sky, deepest when the sun is low', () => {
  const dark = (elevation: number) => lightingFor('cloudyHighAltitude', elevation).brightness[1] ?? 1,
    white = (elevation: number) => lightingFor('cloudyHighAltitude', elevation).brightness[0] ?? 0;
  assert.ok(dark(60) < white(60) / 2, 'one deck darkens the sky while another lightens it');
  assert.ok(dark(12) < dark(60), 'a low sun leaves more of it in shadow');
});

test('air at its dew point means low cloud: a heaped sky, which only a full overcast shows', () => {
  const low = { temperature: 3, dewPoint: 2 };
  assert.equal(skyKind('cloudy', low), 'cloudyLowAltitude');
  assert.equal(skyKind('cloudy', { temperature: 3, dewPoint: -1.5 }), 'cloudyLowAltitude', 'at 4.5 °C it still counts');
  assert.equal(skyKind('cloudy', { temperature: 15.5, dewPoint: 10.5 }), 'cloudyHighAltitude', '5 °C apart is high');
  assert.equal(skyKind('cloudy', { temperature: 3 }), 'cloudyHighAltitude', 'with no dew point to go on, it is high');
  assert.equal(skyKind('cloudy', { ...low, cloudCover: 70 }), 'mostlyCloudyMidAltitude', 'broken cloud is not low');
  for (const deck of skyPreset('cloudyLowAltitude').decks.slice(0, 3)) assert.equal(deck?.[0], 'cumulus');
});

test('a mostly clear sky stays clear under a veil of cirrus as opaque as its preset says, and a high overcast stays overcast', () => {
  const day = { night: false, elevation: 30 },
    mostly = { condition: 'sunny', cloudCover: 25, ...day },
    sky = scenePreset(mostly);
  assert.equal(sky.kind, 'mostlyClear');
  assert.equal(sky.overcastSky, false);
  assert.equal(sky.blanket, 0.45);
  assert.deepEqual(sky.sky, scenePreset({ condition: 'sunny', cloudCover: 0, ...day }).sky, 'as blue as a clear sky');
  const scene = new WeatherScene(null);
  scene.prepare(mostly);
  assert.equal(scene.blanket?.sprite, blanketSprite('cirrus'));
  const overcast = { condition: 'cloudy', cloudCover: 100, ...day };
  assert.equal(scenePreset(overcast).kind, 'cloudyHighAltitude');
  assert.equal(scenePreset(overcast).overcastSky, true);
  scene.prepare(overcast);
  assert.equal(scene.blanket, null, 'its soft mottling is all decks');
});

test("in the dark the night's light shades cloud with sky between it, at twice its share; twilight and a full overcast keep a third", () => {
  const sun = (inputs: SceneInputs) => {
    const scene = new WeatherScene(null);
    scene.prepare(inputs);
    const [, deck] = scene.tints;
    assert.ok(deck);
    return deck.sun[3];
  };
  const share = (inputs: SceneInputs) => Math.min(0.95, scenePreset(inputs).light.sunIntensity / 900);
  const dark = { condition: 'partlycloudy', night: true, elevation: -40, cloudCover: 50 },
    dusk = { ...dark, elevation: -3 },
    overcast = { condition: 'cloudy', night: true, elevation: -40, cloudCover: 100 };
  assert.ok(Math.abs(sun(dark) - share(dark) * 2) < 1e-9, 'night');
  assert.ok(Math.abs(sun(dusk) - share(dusk) * 0.35) < 1e-9, 'twilight');
  assert.ok(Math.abs(sun(overcast) - share(overcast) * 0.35) < 1e-9, 'a full overcast');
});

test("rain at night keeps its blue; a dry overcast's cloud is near neutral over a blue sky; others keep their light", () => {
  const lit = (inputs: SceneInputs) => {
    const scene = new WeatherScene(null);
    scene.prepare(inputs);
    const [, deck] = scene.tints;
    assert.ok(deck);
    return deck;
  };
  const blue = ([red, , blue]: readonly number[]) => (blue ?? 0) - (red ?? 0);
  const rain = lit({ condition: 'rainy', night: true, elevation: -60, cloudCover: 100 });
  assert.equal(rain.ambient[3], 2, 'the floor under a night overcast');
  assert.ok(blue(rain.ambient) >= 16, `ambient light stays blue, ${rain.ambient.join()}`);
  assert.ok(blue(rain.sun) <= 12, `the moon's light stays near grey, ${rain.sun.join()}`);
  const dry = lit({ condition: 'cloudy', night: true, elevation: -60, cloudCover: 100 });
  assert.ok(blue(dry.ambient) <= 12, `cloud adds grey to the blue sky, which stays blue, ${dry.ambient.join()}`);
  // Days are as they were. In the dark, cloud with sky between it stands on a lower floor, as the night's light shades it.
  const ambient = (inputs: SceneInputs) => lit(inputs).ambient;
  assert.deepEqual(
    ambient({ condition: 'clear-night', night: true, elevation: -40, cloudCover: 25 }),
    [69, 75, 108, 1.1],
  );
  assert.deepEqual(
    ambient({ condition: 'partlycloudy', night: true, elevation: -40, cloudCover: 50 }),
    [56, 60, 92, 1.1],
  );
  // Mist is its own light, in its own colour: none of it comes from the sun or moon.
  assert.deepEqual(ambient({ condition: 'fog', night: true, elevation: -40 }), [40, 60, 70, 1]);
  assert.equal(lit({ condition: 'fog', night: true, elevation: -40 }).sun[3], 0);
  assert.deepEqual(
    ambient({ condition: 'rainy', night: false, elevation: 40, cloudCover: 100 }),
    [106, 113, 125, 1.15],
  );
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
  const partly = scenePreset({ condition: 'partlycloudy', elevation: 30 });
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
  assert.equal(skyKind('exceptional', { windSpeed: 3 }), 'cloudyMidAltitude', 'a calm is no storm');
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
  assert.equal(skyKind('Sleet'), 'sleet');
  assert.equal(skyKind('Rain and Snow'), 'wintryMix');
  assert.equal(skyKind('Snow Showers'), 'snow', 'showers of snow are snow');
  assert.equal(skyKind('snow', { windSpeed: 16 }), 'blizzard');
  assert.equal(skyKind('Chance Flurries'), 'flurries');
  assert.equal(skyKind('Mist', { visibility: 3, humidity: 95 }), 'foggy');
  assert.equal(skyKind('Haze'), 'haze');
  assert.equal(skyKind('Smoke'), 'smoky');
  assert.equal(skyKind('Dust Storm'), 'blowingDust', 'a dust storm is no thunderstorm');
  assert.equal(skyKind('Windy'), 'mostlyClear');
  assert.equal(skyKind('Breezy and Mostly Cloudy'), 'mostlyCloudyMidAltitude');
  assert.equal(skyKind('Windstorm'), 'mostlyClear');
  assert.equal(skyKind('Overcast clouds'), 'cloudyHighAltitude');
  assert.equal(skyKind('Mostly Cloudy'), 'mostlyCloudyMidAltitude');
  assert.equal(skyKind('Mixed sun and cloud'), 'partlyCloudyMidAltitude');
  assert.equal(skyKind('Dark_LightCloud'), 'partlyCloudyMidAltitude');
  assert.equal(skyKind('Mostly Sunny'), 'mostlyClear');
  assert.equal(skyKind('Clear sky', { cloudCover: 30 }), 'mostlyClear');
  assert.equal(skyKind('Hurricane'), 'hurricane');
  assert.equal(skyKind('Frost'), 'cloudyMidAltitude', 'words that name no weather keep the overcast sky');
  assert.equal(skyKind('Bewölkt'), 'cloudyMidAltitude', 'only English is read');
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
