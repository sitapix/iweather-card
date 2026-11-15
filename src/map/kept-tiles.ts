// Forecast tiles kept in the browser between visits. A tile of a model's run never changes, so once
// fetched it is read from IndexedDB rather than the network, for a day; anything older is let go
// when the store is first opened. Where IndexedDB isn't there or refuses (Node, some private
// windows), every tile is simply fetched.
import { DAY, SECOND } from '../lib/time.ts';

const DATABASE = 'iweather-forecast',
  STORE = 'tiles',
  STILLS = 'basemaps',
  VERSION = 2,
  // Enough for two themes and several screen sizes, including a sheet.
  MAX_STILLS = 12;
// Longer than this to open the store, or to find a tile in it, and it is passed over for the rest of
// the visit: some browsers have been seen to leave an open hanging, and tiles mustn't wait on that.
export const STORE_WAIT = 5 * SECOND;

let opened: Promise<IDBDatabase | null> | undefined;

function passOver() {
  opened = Promise.resolve(null);
}

// An index cursor visits only expired keys without copying tile bytes during startup.
function prune(database: IDBDatabase, name: string) {
  const store = database.transaction(name, 'readwrite').objectStore(name);
  const cursor = store.index('at').openKeyCursor(IDBKeyRange.upperBound(Date.now() - DAY, true));
  cursor.onsuccess = () => {
    const item = cursor.result;
    if (!item) return;
    store.delete(item.primaryKey);
    item.continue();
  };
}

function database(): Promise<IDBDatabase | null> {
  opened ??= new Promise(resolve => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
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
        store.onclose = () => {
          opened = undefined;
        };
        store.onversionchange = () => {
          store.close();
          opened = undefined;
        };
        prune(store, STORE);
        prune(store, STILLS);
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
  });
  return opened;
}

// Both forecast tiles and pairs of basemap images use the same short-lived store.
async function kept(key: string, name = STORE): Promise<unknown> {
  const store = await database();
  if (!store) return undefined;
  return new Promise(resolve => {
    const timer = setTimeout(() => {
        passOver();
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
