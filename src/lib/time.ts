// Spans of time in milliseconds, as Date.now() and Date.parse() count them, and the counts
// between them.
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const MINUTES_PER_HOUR = HOUR / MINUTE;
export const HOURS_PER_DAY = DAY / HOUR;
// A moment a service gives in whole seconds since 1970, as Open-Meteo, RainViewer and Home
// Assistant's compressed history do, in the card's milliseconds. Every such time comes in here.
export const fromUnix = (seconds: number): number => seconds * SECOND;
