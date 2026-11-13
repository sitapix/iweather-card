// Checks for values from outside the card: Home Assistant's states and replies, services'
// responses, saved settings. Each proves a type to the compiler as it tests it at runtime.

export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const text = (value: unknown): value is string => typeof value === 'string';

export const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);
export const clamp = (value: number, min = 0, max = 1): number => Math.max(min, Math.min(max, value));
