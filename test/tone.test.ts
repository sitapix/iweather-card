import { expect, test } from 'vitest';
import { scenePreset } from '../src/sky/sky.ts';
import { HORIZON, KNEE, TONE_DAY, bounced, exposure, horizon, paled, toneStrength, toned } from '../src/sky/tone.ts';

test('light under the knee is what it was, and past it rolls off toward full without passing it', () => {
  for (const light of [0, 0.05, 0.4, 1, 1.6]) expect(toned(light, 0)).toBe(light);
  for (const light of [0, 0.2, KNEE]) expect(toned(light, 1)).toBe(light);
  expect(toned(1, 1)).toBeLessThan(1);
  expect(toned(1, 1)).toBeGreaterThan(KNEE);
  expect(toned(6, 1)).toBeLessThanOrEqual(1);
  let last = 0;
  for (let light = 0; light <= 2; light += 0.05) {
    const out = toned(light, 1);
    expect(out).toBeGreaterThanOrEqual(last);
    last = out;
  }
  expect(toned(1.2, 0.5)).toBeCloseTo((1.2 + toned(1.2, 1)) / 2);
});

test('a strong coloured light keeps some of its weakest colour where a cut would lose it', () => {
  // Pink fill over blue air: red and blue past what a screen shows, green under.
  const [red, green, blue] = [1.4, 0.7, 1.1].map(light => toned(light, 1));
  expect(red).toBeLessThan(1);
  expect(blue).toBeLessThan(red ?? 0);
  expect(green).toBe(0.7);
});

test('the lights are scaled together to one level by day, within bounds, and left alone otherwise', () => {
  const white = (intensity: number) => [255, 255, 255, intensity] as const,
    none = white(0);
  // A dim sky is brought up and a bright one down, toward the same level.
  const dim = exposure(white(0.5), none, white(0.2), 1200, 1),
    bright = exposure(white(0.8), none, white(0.4), 1200, 1);
  expect(dim).toBeGreaterThan(1);
  expect(bright).toBeLessThan(1);
  expect(0.5 * 0.5 * dim + 0.2 * dim).toBeCloseTo(0.8 * 0.5 * bright + 0.4 * bright);
  // Never further than its bounds, however dim or bright.
  expect(exposure(white(0.01), none, white(0.01), 1200, 1)).toBeLessThanOrEqual(1.9);
  expect(exposure(white(9), none, white(9), 1200, 1)).toBeGreaterThanOrEqual(0.75);
  // A low sun's sky is levelled lower than a high one's.
  expect(exposure(white(0.5), none, white(0.2), 625, 1)).toBeLessThan(dim);
  // None of it without strength, and part of it with part.
  expect(exposure(white(0.5), none, white(0.2), 1200, 0)).toBe(1);
  expect(exposure(white(0.5), none, white(0.2), 1200, 0.5)).toBeCloseTo((1 + dim) / 2);
  expect(exposure(none, none, none, 1200, 1)).toBe(1);
});

test('the air’s light is drawn toward grey and taken stronger, its colour as bright as it was', () => {
  const [red, green, blue, intensity] = paled([81, 106, 244, 0.8], 1);
  expect(blue - red).toBeLessThan(244 - 81);
  expect(blue).toBeGreaterThan(red);
  expect(intensity).toBeGreaterThan(0.8);
  expect(red * 0.299 + green * 0.587 + blue * 0.114).toBeCloseTo(81 * 0.299 + 106 * 0.587 + 244 * 0.114);
  expect(paled([81, 106, 244, 0.8], 0)).toEqual([81, 106, 244, 0.8]);
});

test('some of the sun’s light reaches the shade, by its strength, and none where the sky takes no tone', () => {
  const air = [81, 106, 244, 0.8] as const,
    sun = [255, 240, 220, 0.5] as const,
    [red, green, blue, intensity] = bounced(air, sun, 1);
  expect(intensity).toBe(0.8);
  expect(red).toBeGreaterThan(81);
  expect(green).toBeGreaterThan(106);
  expect(blue).toBeGreaterThan(244);
  // The sun's own colour is added: more red than blue of it.
  expect(red - 81).toBeGreaterThan(blue - 244);
  expect(bounced(air, sun, 0)).toEqual([81, 106, 244, 0.8]);
  expect(bounced(air, [255, 240, 220, 0], 1)).toEqual([81, 106, 244, 0.8]);
});

test('all of it comes in with the sun, and never where anything falls or flashes', () => {
  const [from, whole] = TONE_DAY;
  expect(toneStrength(from, false)).toBe(0);
  expect(toneStrength(0, false)).toBe(0);
  expect(toneStrength(whole, false)).toBe(1);
  expect(toneStrength(whole * 2, false)).toBe(1);
  expect(toneStrength((from + whole) / 2, false)).toBeCloseTo(0.5);
  expect(toneStrength(whole * 2, true)).toBe(0);
});

test('night skies and skies with rain, snow or lightning keep their light as it is', () => {
  const strength = (inputs: Parameters<typeof scenePreset>[0]) => {
    const preset = scenePreset(inputs),
      stormy = preset.rain + preset.snow + preset.sleet + preset.hail > 0 || preset.lightning || preset.cloudFlash;
    return toneStrength(preset.light.sunIntensity, stormy);
  };
  expect(strength({ condition: 'partlycloudy', elevation: 40 })).toBe(1);
  expect(strength({ condition: 'cloudy', elevation: 35 })).toBe(1);
  expect(strength({ condition: 'partlycloudy', elevation: -30, night: true })).toBe(0);
  expect(strength({ condition: 'rainy', elevation: 30 })).toBe(0);
  expect(strength({ condition: 'lightning', elevation: 25 })).toBe(0);
  expect(strength({ condition: 'snowy', elevation: 20 })).toBe(0);
});

test('the horizon’s paling is whole with the sun on it, gone once the sun has risen, and never without the tone', () => {
  const { from, by } = HORIZON;
  expect(horizon(0, 1)).toBe(1);
  expect(horizon(from, 1)).toBe(1);
  expect(horizon((from + by) / 2, 1)).toBeCloseTo(0.5);
  expect(horizon(by, 1)).toBe(0);
  expect(horizon(40, 1)).toBe(0);
  expect(horizon(0, 0)).toBe(0);
  expect(horizon(0, 0.5)).toBeCloseTo(0.5);
});
