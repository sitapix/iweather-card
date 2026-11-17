// Forecast tiles kept in the browser between visits. A tile of a model's run never changes, so once
// fetched it is read from IndexedDB rather than the network, for a day; anything older is let go
// in batches while the store is in use. Where IndexedDB isn't there or refuses (Node, some private
// windows), every tile is simply fetched.
import { DAY, HOUR, MINUTE, SECOND } from '../lib/time.ts';

const DATABASE = 'iweather-forecast',
  STORE = 'tiles',
  STILLS = 'basemaps',
  VERSION = 2,
  // Enough for two themes and several screen sizes, including a sheet.
  MAX_STILLS = 12;
// Longer than this to open the store, or to find a tile in it, and it is passed over until a later attempt.
// Some browsers leave an open hanging and tiles mustn't wait on that.
export const STORE_WAIT = 5 * SECOND;

let opened: Promise<IDBDatabase | null> | undefined;
let current: IDBDatabase | undefined;
let retryAt = 0;
// The wait before the next attempt doubles with each failure in a row, up to an hour: an open that
// hangs holds every tile asked for meanwhile for STORE_WAIT, which mustn't come round each minute.
let retryWait = MINUTE;
let pruneAt = 0;
const PRUNE_BATCH = 128;

function forget(store: IDBDatabase) {
  if (current !== store) return;
  opened = undefined;
  current = undefined;
}

function passOver() {
  retryAt = Date.now() + retryWait;
  retryWait = Math.min(retryWait * 2, HOUR);
}

function pruneDue(store: IDBDatabase) {
  if (Date.now() < pruneAt) return;
  pruneAt = Date.now() + HOUR;
  try {
    prune(store, STORE);
    prune(store, STILLS);
  } catch {}
}

// An index cursor visits only expired keys without copying tile bytes during startup.
function prune(database: IDBDatabase, name: string) {
  const store = database.transaction(name, 'readwrite').objectStore(name);
  const cursor = store.index('at').openKeyCursor(IDBKeyRange.upperBound(Date.now() - DAY, true));
  let removed = 0;
  cursor.onsuccess = () => {
    const item = cursor.result;
    if (!item) return;
    store.delete(item.primaryKey);
    if (++removed < PRUNE_BATCH) item.continue();
    else pruneAt = Math.min(pruneAt, Date.now() + MINUTE);
  };
}

function database(): Promise<IDBDatabase | null> {
  if (Date.now() < retryAt || typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (current) pruneDue(current);
  opened ??= new Promise<IDBDatabase | null>(resolve => {
    let late = false;
    const timer = setTimeout(() => {
        late = true;
        resolve(null);
      }, STORE_WAIT),
      done = (store: IDBDatabase | null) => {
        clearTimeout(timer);
        resolve(store);
      };
    try {
      const request = indexedDB.open(DATABASE, VERSION);
      request.onupgradeneeded = () => {
        for (const name of [STORE, STILLS]) {
          const db = request.result;
          const records = db.objectStoreNames.contains(name)
            ? request.transaction?.objectStore(name)
            : db.createObjectStore(name);
          if (records && !records.indexNames.contains('at')) records.createIndex('at', 'at');
        }
      };
      request.onsuccess = () => {
        const store = request.result;
        if (late) {
          store.close();
          return;
        }
        // Closed by the browser, or asked to make way for a newer version in another tab, it is
        // opened again when next needed.
        current = store;
        retryWait = MINUTE;
        store.onclose = () => forget(store);
        store.onversionchange = () => {
          forget(store);
          store.close();
        };
        pruneDue(store);
        done(store);
      };
      // Held up by an older version open in another tab.
      request.onblocked = () => {
        late = true;
        done(null);
      };
      request.onerror = () => done(null);
    } catch {
      done(null);
    }
  }).then(store => {
    if (!store) {
      opened = undefined;
      passOver();
    }
    return store;
  });
  return opened;
}

// Both forecast tiles and pairs of basemap images use the same short-lived store.
async function kept(key: string, name = STORE): Promise<unknown> {
  const store = await database();
  if (!store) return undefined;
  return new Promise(resolve => {
    const timer = setTimeout(() => {
        if (current === store) {
          forget(store);
          passOver();
          store.close();
        }
        resolve(undefined);
      }, STORE_WAIT),
      done = (value: unknown) => {
        clearTimeout(timer);
        resolve(value);
      };
    try {
      const request = store.transaction(name).objectStore(name).get(key);
      request.onsuccess = () => {
        const value: unknown = request.result;
        done(
          typeof value === 'object' &&
            value !== null &&
            'at' in value &&
            typeof value.at === 'number' &&
            value.at >= Date.now() - DAY
            ? value
            : undefined,
        );
      };
      request.onerror = () => done(undefined);
    } catch {
      done(undefined);
    }
  });
}

async function keep(key: string, value: { bytes: ArrayBuffer } | StillPictures, name = STORE): Promise<void> {
  const store = await database();
  if (!store) return;
  try {
    const records = store.transaction(name, 'readwrite').objectStore(name);
    records.put({ at: Date.now(), ...value }, key);
    if (name === STILLS) {
      const keys = records.index('at').getAllKeys();
      keys.onsuccess = () => {
        for (const old of keys.result.slice(0, -MAX_STILLS)) records.delete(old);
      };
    }
  } catch {}
}

export async function keptTile(url: string) {
  const value = await kept(url);
  return typeof value === 'object' && value !== null && 'bytes' in value && value.bytes instanceof ArrayBuffer
    ? value.bytes
    : undefined;
}
export const keepTile = (url: string, bytes: ArrayBuffer) => keep(url, { bytes });

export interface StillPictures {
  ground: Blob;
  names: Blob;
}
// Version the painted style independently of forecast data. Save both images in one transaction.
const stillKey = (key: string) => `basemap-v1|${key}`;
export async function keptStill(key: string): Promise<StillPictures | undefined> {
  const value = await kept(stillKey(key), STILLS);
  return typeof value === 'object' &&
    value !== null &&
    'ground' in value &&
    value.ground instanceof Blob &&
    'names' in value &&
    value.names instanceof Blob
    ? { ground: value.ground, names: value.names }
    : undefined;
}
export const keepStill = (key: string, pictures: StillPictures) => keep(stillKey(key), pictures, STILLS);
