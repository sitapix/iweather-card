import { execFile } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { isRecord, text } from '../../src/lib/values.ts';
import { artifact } from '../artifacts.ts';
import buildCard from '../build.ts';
import {
  CARD,
  DASHBOARD,
  ENTITY,
  HOME,
  RESOURCE,
  SERVER_ENV,
  VIEW,
  ask,
  connect,
  json,
  tokensFor,
  type Server,
} from './home-assistant.ts';

// A Home Assistant of its own for the run, in a container: `HA_RUNTIME` is the command that runs
// containers (docker by default, or any with the same `run`, `logs`, `stop` and `rm`), and
// `HA_VERSION` the image's tag. Its config is written fresh to a folder of its own, and the
// container and the folder go when the run ends. The image stays, as it is large to fetch again.
const RUNTIME = process.env['HA_RUNTIME'] ?? 'docker',
  IMAGE = `ghcr.io/home-assistant/home-assistant:${process.env['HA_VERSION'] ?? 'stable'}`;
// A first start writes its whole config folder, so it is given a while. Fetching the image comes
// before, and takes as long as it takes.
const STARTUP = 10 * 60_000,
  POLL = 1000,
  // Home Assistant's log, of which a failed start shows the end.
  LOG = { maxBuffer: 64 * 1024 * 1024 },
  LOG_END = 4000;
const USER = { name: 'Tester', username: 'tester', password: 'stand-in-password', language: 'en' };

const run = promisify(execFile);
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

// A port on this machine nobody is listening on.
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (isRecord(address) && typeof address['port'] === 'number') resolve(address['port']);
        else reject(new Error('No free port.'));
      });
    });
  });
}

// The parts of Home Assistant the card meets: the frontend and its dashboards, and the history
// (with the recorder under it) that every installation has, which the card and the frontend both
// ask. Without it the frontend's own first page fails on asking for the recorder.
const CONFIGURATION = `homeassistant:
  name: ${HOME.name}
  latitude: ${HOME.latitude}
  longitude: ${HOME.longitude}
  unit_system: ${HOME.unitSystem}
  time_zone: ${HOME.timeZone}
  country: ${HOME.country}
http:
frontend:
lovelace:
history:
stand_in_weather:
`;

// The config folder: the stand-in integration, configuration.yaml, and the built card in www/,
// which Home Assistant serves at /local/ if the folder is there when it starts.
function writeConfig(): string {
  const folder = mkdtempSync(join(tmpdir(), 'iweather-ha-'));
  cpSync(fileURLToPath(new URL('config/', import.meta.url)), folder, { recursive: true });
  writeFileSync(join(folder, 'configuration.yaml'), CONFIGURATION);
  cpSync(artifact('dist'), join(folder, 'www', 'iweather'), {
    recursive: true,
  });
  return folder;
}

// Asks until Home Assistant answers as `ready` says, or gives up at `until`.
async function waitFor(what: string, until: number, ready: () => Promise<boolean>): Promise<void> {
  while (Date.now() < until) {
    if (await ready().catch(() => false)) return;
    await sleep(POLL);
  }
  throw new Error(`Home Assistant never had ${what}.`);
}

// Onboarding as the frontend does it: the owner, then the rest of the steps, signed in as them.
async function onboard(url: string, clientId: string): Promise<string> {
  const created = await ask(`${url}/api/onboarding/users`, json({ client_id: clientId, ...USER })),
    code = isRecord(created) ? created['auth_code'] : undefined;
  if (!text(code)) throw new Error('Onboarding gave no code.');
  const tokens = await tokensFor(url, { grant_type: 'authorization_code', code, client_id: clientId }),
    token = tokens.access_token;
  await ask(`${url}/api/onboarding/core_config`, json({}, token));
  await ask(`${url}/api/onboarding/analytics`, json({}, token));
  await ask(
    `${url}/api/onboarding/integration`,
    json({ client_id: clientId, redirect_uri: `${url}/?auth_callback=1` }, token),
  );
  return tokens.refresh_token;
}

// The card's file as a resource, and a dashboard of its own showing the stand-in's weather. The
// default dashboard is the frontend's own and can move, so a test never looks there.
async function install(url: string, token: string): Promise<void> {
  const socket = await connect(url, token);
  try {
    await socket.send({ type: 'lovelace/resources/create', res_type: 'module', url: RESOURCE });
    await socket.send({
      type: 'lovelace/dashboards/create',
      url_path: DASHBOARD,
      title: 'iWeather',
      require_admin: false,
      show_in_sidebar: true,
    });
    await socket.send({
      type: 'lovelace/config/save',
      url_path: DASHBOARD,
      config: { title: 'iWeather', views: [{ title: 'Weather', path: VIEW, type: 'panel', cards: [CARD] }] },
    });
  } finally {
    socket.close();
  }
}

export default async function startHomeAssistant(): Promise<() => Promise<void>> {
  const clean = await buildCard();
  let folder: string;
  try {
    folder = writeConfig();
  } finally {
    clean();
  }
  const port = await freePort(),
    url = `http://127.0.0.1:${port}`,
    clientId = `${url}/`,
    name = `iweather-e2e-${port}`;
  const stop = async () => {
    await run(RUNTIME, ['stop', name]).catch(() => undefined);
    await run(RUNTIME, ['rm', name]).catch(() => undefined);
    // A runtime that writes as another user can leave files this one can't remove, in the
    // system's temporary folder.
    try {
      rmSync(folder, { recursive: true, force: true });
    } catch {}
  };
  try {
    await run(RUNTIME, ['run', '-d', '--name', name, '-v', `${folder}:/config`, '-p', `127.0.0.1:${port}:8123`, IMAGE]);
    const until = Date.now() + STARTUP;
    await waitFor('its onboarding', until, async () => (await fetch(`${url}/api/onboarding`)).ok);
    const refreshToken = await onboard(url, clientId),
      { access_token: token } = await tokensFor(url, {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
      });
    await waitFor(ENTITY, until, async () => {
      const response = await fetch(`${url}/api/states/${ENTITY}`, { headers: { Authorization: `Bearer ${token}` } });
      return response.ok;
    });
    await install(url, token);
    const server: Server = { url, clientId, refreshToken };
    process.env[SERVER_ENV] = JSON.stringify(server);
  } catch (error) {
    const { stdout } = await run(RUNTIME, ['logs', name], LOG).catch(() => ({ stdout: '' }));
    await stop();
    throw new Error(
      `Home Assistant (${IMAGE}, through ${RUNTIME}) didn't start: ${error instanceof Error ? error.message : String(error)}\n${stdout.slice(-LOG_END)}`,
      { cause: error },
    );
  }
  return stop;
}
