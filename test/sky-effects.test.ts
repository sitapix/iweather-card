import { expect, test } from 'vitest';
import { scenePreset } from '../src/sky/sky.ts';
import { WeatherScene } from '../src/sky/scene.ts';
import { dropletTier, frostEffect } from '../src/sky/droplets.ts';

test('wind streaks have their own speed threshold and eligibility', () => {
  for (const condition of ['clear-night', 'cloudy', 'fog', 'Hot', 'Haze', 'blowing snow', 'windy', 'windy-variant']) {
    expect(scenePreset({ condition, windSpeed: 6.7049 }).wind).toBe(0);
    expect(scenePreset({ condition, windSpeed: 6.705 }).wind).toBe(1);
  }
  for (const condition of ['rain', 'snow', 'lightning', 'hail', 'hurricane', 'unavailable'])
    expect(scenePreset({ condition, windSpeed: 40 }).wind).toBe(0);
  const fog = scenePreset({ condition: 'fog', visibility: 8, cloudCover: 0, windSpeed: 8 });
  expect(fog.kind).toBe('clear');
  expect(fog.effectKind).toBe('foggy');
  expect(frostEffect(fog.effectKind, -10, 6)).toBe(false);
  expect(scenePreset({ condition: 'cloudy', windSpeed: 0 }).cloudSpeed).toBe(
    scenePreset({ condition: 'cloudy', windSpeed: 40 }).cloudSpeed,
  );
});

test('wind adjusts the fall angle only in the conditions that use it', () => {
  const angle = (condition: string, windSpeed: number) =>
    (scenePreset({ condition, windSpeed }).windAngle * 180) / Math.PI;
  expect(angle('rain', 0)).toBeCloseTo(0);
  expect(angle('rain', 27.7778)).toBeCloseTo(9.32, 2);
  expect(angle('rain', 60)).toBeCloseTo(15);
  expect(angle('blizzard', 0)).toBeCloseTo(80);
  expect(angle('blizzard', 60)).toBeCloseTo(60);
  expect(angle('strongStorms', 0)).toBeCloseTo(65);
  expect(angle('strongStorms', 60)).toBeCloseTo(45);
  expect(angle('tropical storm', 60)).toBeCloseTo(60);
  expect(angle('hurricane', 0)).toBeCloseTo(90);
  expect(angle('hurricane', 60)).toBeCloseTo(90);
});

test('emitter switches, glass and frame cadence follow their respective inputs', () => {
  expect(scenePreset({ condition: 'foggy' }).fog).toBe(0);
  expect(scenePreset({ condition: 'smoky' }).fog).toBe(1);
  expect(scenePreset({ condition: 'lightning' }).rain).toBe(0);
  expect(dropletTier(scenePreset({ condition: 'lightning' }).effectKind ?? '')).toBe(0);
  expect(dropletTier(scenePreset({ condition: 'wintry mix' }).effectKind ?? '')).toBe(1);
  expect(frostEffect('clear', -10, 8.99)).toBe(true);
  expect(frostEffect('clear', -10, 9)).toBe(false);
  const scene = new WeatherScene(null);
  for (const [condition, fps] of [
    ['sunny', 25],
    ['cloudy', 30],
    ['rain', 48],
    ['lightning', 48],
  ] as const) {
    scene.prepare({ condition });
    scene.advance(0);
    expect(scene.frameInterval).toBeCloseTo(1000 / fps);
  }
});
