import { CONDITION } from '../../card/home-assistant.ts';
import { convertUnit, UNITS } from '../../weather/units.ts';
import { phrase, say } from '../../weather/words.ts';
// Visibility sentences. The first that applies: fog under 2 km in fog, by metres (50, 200,
// 500, 1000); haze from 2 to 10 km in any weather, heavier to 4 km; else how clear it is,
// by band (see visibilityBand).
const FOG: readonly (readonly [below: number, sentence: string])[] = [
  [50, phrase('Dense fog is affecting visibility.')],
  [200, phrase('Thick fog is affecting visibility.')],
  [500, phrase('Moderate fog is affecting visibility.')],
  [1000, phrase('Light fog is affecting visibility.')],
  [Infinity, phrase('Very light fog is affecting visibility.')],
];
const HAZE = { from: 2, heavy: 4, to: 10 } as const;
const VISIBILITY_SENTENCES: Readonly<Record<VisibilityBand, string>> = {
  perfect: phrase('Perfectly clear view.'),
  clear: phrase('Clear view.'),
  fair: phrase('Fairly clear view.'),
  moderate: phrase('Visibility is moderate.'),
  poor: phrase('Visibility is poor.'),
  very_poor: phrase('Visibility is very poor.'),
};
export function visibilityText(value: number, unit: string | undefined, condition: string | undefined): string {
  const km = visibilityKm(value, unit),
    m = km * METRES_PER_KM;
  if (condition === CONDITION.fog && km < HAZE.from) return say(FOG.find(([below]) => m < below)?.[1] ?? '');
  if (km > HAZE.from && km < HAZE.to)
    return km <= HAZE.heavy ? say('Haze is affecting visibility.') : say('Light haze is affecting visibility.');
  return say(VISIBILITY_SENTENCES[visibilityBand(km)]);
}

const VISIBILITY_LABELS: Readonly<Record<VisibilityBand, string>> = {
  perfect: phrase('Perfectly clear'),
  clear: phrase('Clear'),
  fair: phrase('Fairly clear'),
  moderate: phrase('Moderate'),
  poor: phrase('Poor'),
  very_poor: phrase('Very poor'),
};
// A band inside a sentence. These describe visibility and nothing else, so each can agree with it.
const VISIBILITY_WORDS: Readonly<Record<VisibilityBand, string>> = {
  perfect: phrase('perfectly clear'),
  clear: phrase('clear'),
  fair: phrase('fairly clear'),
  moderate: phrase('moderate'),
  poor: phrase('poor'),
  very_poor: phrase('very poor'),
};
export const visibilityLabel = (value: number, unit: string | undefined): string =>
  say(VISIBILITY_LABELS[visibilityBand(visibilityKm(value, unit))]);
export const visibilityWord = (value: number, unit: string | undefined): string =>
  say(VISIBILITY_WORDS[visibilityBand(visibilityKm(value, unit))]);
// Visibility in kilometres from the entity's unit.
export const visibilityKm = (value: number, unit: string | undefined): number =>
  convertUnit('distance_unit', value, unit, UNITS.kilometers);

// How clear the air is, in six bands. The two clearest go by whole miles: 10 and more is
// perfectly clear, 7 to 9 clear. Below that, by metres: over 1000 fairly clear, over 200
// moderate, over 50 poor, else very poor.
export type VisibilityBand = 'perfect' | 'clear' | 'fair' | 'moderate' | 'poor' | 'very_poor';

const VISIBILITY = { perfectMiles: 10, clearMiles: 7, fairMetres: 1000, moderateMetres: 200, poorMetres: 50 } as const;

export const METRES_PER_KM = 1000;

export function visibilityBand(km: number): VisibilityBand {
  const miles = Math.round(convertUnit('distance_unit', km, UNITS.kilometers, UNITS.miles)),
    metres = km * METRES_PER_KM;
  return miles >= VISIBILITY.perfectMiles
    ? 'perfect'
    : miles >= VISIBILITY.clearMiles
      ? 'clear'
      : metres > VISIBILITY.fairMetres
        ? 'fair'
        : metres > VISIBILITY.moderateMetres
          ? 'moderate'
          : metres > VISIBILITY.poorMetres
            ? 'poor'
            : 'very_poor';
}
