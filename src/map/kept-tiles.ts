// Forecast tiles kept in the browser between visits. A tile of a model's run never changes, so once
// fetched it is read from IndexedDB rather than the network, for a day; anything older is let go
// when the store is first opened. Where IndexedDB isn't there or refuses (Node, some private
// windows), every tile is simply fetched.
import { DAY, SECOND } from '../lib/time.ts';

const DATABASE = 'iweather-forecast',
  STORE = 'tiles',
  VERSION = 1;
// Longer than this to open the store, or to find a tile in it, and it is passed over for the rest of
// the visit: some browsers have been seen to leave an open hanging, and tiles mustn't wait on that.
export const STORE_WAIT = 5 * SECOND;

let opened: Promise<IDBDatabase | null> | undefined;

function passOver() {
  opened = Promise.resolve(null);
}

// What has been kept longer than a day, let go.
function prune(database: IDBDatabase) {
  const cursor = database.transaction(STORE, 'readwrite').objectStore(STORE).openCursor(),
    oldest = Date.now() - DAY;
  cursor.onsuccess = () => {
    const at = cursor.result;
    if (!at) return;
    const kept: unknown = at.value;
    if (
      !(typeof kept === 'object' && kept !== null && 'at' in kept && typeof kept.at === 'number' && kept.at >= oldest)
    )
      at.delete();
    at.continue();
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
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
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
        prune(store);
        done(store);
      };
      // Held up by an older version open in another tab.
      request.onblocked = () => done(null);
      request.onerror = () => done(null);
    } catch {
      done(null);
    }
  });
  return opened;
}

// A tile kept under its address, if any.
export async function keptTile(url: string): Promise<ArrayBuffer | undefined> {
  const store = await database();
  if (!store) return undefined;
  return new Promise(resolve => {
    const timer = setTimeout(() => {
        passOver();
        resolve(undefined);
      }, STORE_WAIT),
      done = (bytes: ArrayBuffer | undefined) => {
        clearTimeout(timer);
        resolve(bytes);
      };
    try {
      const request = store.transaction(STORE).objectStore(STORE).get(url);
      request.onsuccess = () => {
        const kept: unknown = request.result;
        done(
          typeof kept === 'object' && kept !== null && 'bytes' in kept && kept.bytes instanceof ArrayBuffer
            ? kept.bytes
            : undefined,
        );
      };
      request.onerror = () => done(undefined);
    } catch {
      done(undefined);
    }
  });
}

// A tile kept under its address, for next time.
export async function keepTile(url: string, bytes: ArrayBuffer): Promise<void> {
  const store = await database();
  if (!store) return;
  try {
    store.transaction(STORE, 'readwrite').objectStore(STORE).put({ at: Date.now(), bytes }, url);
  } catch {}
}
