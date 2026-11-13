import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { isRecord, text } from '../../src/lib/values.ts';
import type { Recording } from '../recordings.ts';

// The card on a real Home Assistant, started fresh for the run by setup.ts: onboarded, with the
// built file registered as a resource and a dashboard of its own showing it. The weather is
// weather.stand_in, from the stand-in integration in config/, which reports whichever recording
// from test/integrations a test plays to it.

// Home Assistant's home, units and time zone: where met.live.json was recorded.
export const HOME = {
  name: 'Home',
  latitude: 47.3769,
  longitude: 8.5417,
  timeZone: 'Europe/Zurich',
  country: 'CH',
  unitSystem: 'metric',
} as const;
export const ENTITY = 'weather.stand_in';
// The dashboard the card is on, and its one view.
export const DASHBOARD = 'iweather-e2e';
export const VIEW = 'weather';
export const CARD = {
  type: 'custom:iweather-card',
  entity: ENTITY,
  weather_layout: 'page',
  weather_animation: false,
  // Nothing leaves Home Assistant, so the run needs no service beyond it.
  local_only: true,
} as const;
// Where the built file is served from: <config>/www/iweather/.
export const RESOURCE = '/local/iweather/iweather-card.js';
// What setup.ts hands the tests: where Home Assistant is, and how to sign in to it.
export const SERVER_ENV = 'IWEATHER_HA_SERVER';

export interface Server {
  url: string;
  clientId: string;
  refreshToken: string;
}
export function serverOf(value: string | undefined): Server {
  const parsed: unknown = JSON.parse(value ?? 'null');
  if (!isRecord(parsed) || !text(parsed['url']) || !text(parsed['clientId']) || !text(parsed['refreshToken']))
    throw new Error(`No Home Assistant: run these through \`pnpm e2e:ha\`, which starts one (${SERVER_ENV}).`);
  return { url: parsed['url'], clientId: parsed['clientId'], refreshToken: parsed['refreshToken'] };
}

// A JSON answer, with what isn't JSON as null.
async function answerOf(response: Response): Promise<unknown> {
  const body = await response.text();
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed;
  } catch {
    return null;
  }
}
// Asks Home Assistant, and fails with what it said if it says no.
export async function ask(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${url}: ${response.status} ${await response.text()}`);
  return answerOf(response);
}
export const json = (body: unknown, token?: string): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) },
  body: JSON.stringify(body),
});

export interface Tokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}
// The tokens /auth/token gives for a grant: an authorization code, or a refresh token, which it
// doesn't send again.
export async function tokensFor(url: string, grant: Readonly<Record<string, string>>): Promise<Tokens> {
  const answer = await ask(`${url}/auth/token`, { method: 'POST', body: new URLSearchParams(grant) });
  if (!isRecord(answer) || !text(answer['access_token']) || typeof answer['expires_in'] !== 'number')
    throw new Error('No tokens.');
  const refresh = answer['refresh_token'] ?? grant['refresh_token'];
  if (!text(refresh)) throw new Error('No refresh token.');
  return {
    access_token: answer['access_token'],
    refresh_token: refresh,
    expires_in: answer['expires_in'],
    token_type: 'Bearer',
  };
}

// Home Assistant's websocket, signed in: each command answers with its result.
export interface Socket {
  send(command: Readonly<Record<string, unknown>>): Promise<unknown>;
  close(): void;
}
export function connect(url: string, token: string): Promise<Socket> {
  const socket = new WebSocket(`${url.replace(/^http/u, 'ws')}/api/websocket`),
    waiting = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();
  let last = 0;
  const connection: Socket = {
    send(command) {
      last += 1;
      const id = last;
      socket.send(JSON.stringify({ ...command, id }));
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
      });
    },
    close() {
      socket.close();
    },
  };
  return new Promise((resolve, reject) => {
    socket.addEventListener('error', () => {
      reject(new Error(`No websocket at ${url}.`));
    });
    socket.addEventListener('close', () => {
      reject(new Error(`The websocket at ${url} closed.`));
      for (const call of waiting.values()) call.reject(new Error(`The websocket at ${url} closed.`));
    });
    socket.addEventListener('message', event => {
      const data: unknown = event.data,
        message: unknown = typeof data === 'string' ? JSON.parse(data) : null;
      if (!isRecord(message)) return;
      const { type, id } = message;
      if (type === 'auth_required') socket.send(JSON.stringify({ type: 'auth', access_token: token }));
      else if (type === 'auth_ok') resolve(connection);
      else if (type === 'auth_invalid') reject(new Error(`Signed out: ${String(message['message'])}`));
      else if (type === 'result' && typeof id === 'number') {
        const call = waiting.get(id);
        waiting.delete(id);
        if (message['success'] === true) call?.resolve(message['result']);
        else call?.reject(new Error(`Command ${id}: ${JSON.stringify(message['error'])}`));
      }
    });
  });
}

// Home Assistant for one test: its REST services and its websocket, signed in afresh.
export interface HomeAssistant {
  url: string;
  tokens: Tokens;
  socket: Socket;
  service(service: string, data?: Readonly<Record<string, unknown>>, domain?: string): Promise<void>;
  // Hands weather.stand_in a recording, as its integration's next update would.
  play(recording: Recording): Promise<void>;
}
// What the card's page said went wrong: script errors and console errors.
type Faults = string[];
// A page of the dashboard, its clock at a recording's time, with the card on it once it draws.
type Open = (recording: Recording, options?: { drawn?: boolean }) => Promise<Locator>;

export const test = base.extend<{ ha: HomeAssistant; faults: Faults; open: Open }>({
  ha: async ({ request }, use) => {
    const { url, clientId, refreshToken } = serverOf(process.env[SERVER_ENV]),
      tokens = await tokensFor(url, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }),
      socket = await connect(url, tokens.access_token);
    const service: HomeAssistant['service'] = async (name, data = {}, domain = 'stand_in_weather') => {
      const response = await request.post(`${url}/api/services/${domain}/${name}`, {
        data,
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!response.ok()) throw new Error(`${domain}.${name}: ${response.status()} ${await response.text()}`);
    };
    await use({
      url,
      tokens,
      socket,
      service,
      play: ({ state, attributes, forecasts }) => service('play', { state, attributes, forecasts }),
    });
    socket.close();
  },
  // A script error or a console error fails the test that caused it.
  faults: [
    async ({ page }, use) => {
      const faults: Faults = [];
      page.on('pageerror', error => faults.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error') faults.push(message.text());
      });
      await use(faults);
      expect(faults).toEqual([]);
    },
    { auto: true },
  ],
  open: async ({ page, ha }, use) => {
    const { url, tokens } = ha,
      { clientId } = serverOf(process.env[SERVER_ENV]);
    // Signed in, as the frontend keeps its tokens.
    await page.addInitScript(
      saved => {
        localStorage.setItem('hassTokens', JSON.stringify(saved));
      },
      {
        ...tokens,
        hassUrl: url,
        clientId,
        expires: Date.now() + tokens.expires_in * 1000,
      },
    );
    await use(async (played, { drawn = true } = {}) => {
      await ha.play(played);
      await page.clock.setFixedTime(played.now);
      await page.goto(`${url}/${DASHBOARD}/${VIEW}`);
      const card = page.locator('iweather-card');
      if (drawn) await expect(card.locator('.tile').first()).toBeVisible();
      return card;
    });
  },
});
export { expect, type Page };
