import { MINUTE } from '../../lib/time.ts';
import { finite, isList, isRecord } from '../../lib/values.ts';
import { type Fetcher, askJson, keepAnswer, keptAnswer, sharedRequests } from '../../lib/asking.ts';
import { NWS, type WeatherAlert, alertOf } from './rules.ts';
// Alerts where no alert sensor is set, for a place the National Weather Service covers: the alerts
// in effect at the point, from its public service, which needs no key and answers any page.

// It takes a point to four decimal places, and answers only for places it covers.
const POINT_DIGITS = 4;
// Home Assistant's countries it covers: the United States and its territories.
const COVERED: ReadonlySet<string> = new Set(['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM']);
// An answer serves for five minutes, across every card in the browser.
export const NWS_ALERTS_REFRESH = 5 * MINUTE;

// The service covers the weather shown: the entity comes from the National Weather Service's
// integration, or home is in a country it covers.
export const nwsCovers = (platform: string | undefined, country: string | null | undefined): boolean =>
  platform === 'nws' || COVERED.has(country?.toUpperCase() ?? '');

// Its alerts that are real and still in force, each linked to the forecast page for the point.
// Each carries the office that sent it, which the page names by the service.
export function parseNwsAlerts(body: unknown, link: string): WeatherAlert[] | null {
  const features = isRecord(body) ? body['features'] : undefined;
  if (!isList(features)) return null;
  return features.flatMap(feature => {
    const properties = isRecord(feature) ? feature['properties'] : undefined;
    if (!isRecord(properties) || properties['status'] !== 'Actual' || properties['messageType'] === 'Cancel') return [];
    return alertOf({ ...properties, senderName: NWS, url: link }) ?? [];
  });
}

export interface NwsAlerts {
  // When they were asked for.
  at: number;
  alerts: readonly WeatherAlert[];
}

const point = (latitude: number, longitude: number) =>
  `${latitude.toFixed(POINT_DIGITS)},${longitude.toFixed(POINT_DIGITS)}`;
const alertsUrl = (latitude: number, longitude: number) =>
  `https://api.weather.gov/alerts/active?point=${point(latitude, longitude)}&status=actual`;
const pageUrl = (latitude: number, longitude: number) =>
  `https://forecast.weather.gov/MapClick.php?lat=${latitude.toFixed(POINT_DIGITS)}&lon=${longitude.toFixed(POINT_DIGITS)}`;

// The last answer, for the place it was asked for, without the areas' outlines, which can be large
// and which nothing draws: read back through the same checks, so a page opened again within five
// minutes has its alerts at once, without asking.
const CACHE = 'iweather-nws-alerts-v1';

const savedAlerts = (url: string, link: string, now: number): NwsAlerts | null =>
  keptAnswer(CACHE, url, (at, body) => {
    const alerts = finite(at) && now - at < NWS_ALERTS_REFRESH ? parseNwsAlerts(body, link) : null;
    return finite(at) && alerts ? { at, alerts } : null;
  });

async function askAlerts(url: string, link: string, now: number, fetcher: Fetcher): Promise<NwsAlerts | null> {
  const saved = savedAlerts(url, link, now);
  if (saved) return saved;
  const answer = await askJson(fetcher, url, 'National Weather Service'),
    features = isRecord(answer) && isList(answer['features']) ? answer['features'] : undefined,
    body = {
      features: features?.map(feature => ({ properties: isRecord(feature) ? feature['properties'] : undefined })),
    },
    alerts = parseNwsAlerts(body, link);
  if (alerts) keepAnswer(CACHE, url, now, body);
  return alerts ? { at: now, alerts } : null;
}

const shared = sharedRequests<NwsAlerts | null>();

// The alerts in force at a place, in one call; the requests of cards asking together are shared.
export function nwsAlerts(
  latitude: number,
  longitude: number,
  now: number,
  fetcher: Fetcher = fetch,
): Promise<NwsAlerts | null> {
  const url = alertsUrl(latitude, longitude);
  return shared(url, () => askAlerts(url, pageUrl(latitude, longitude), now, fetcher));
}
