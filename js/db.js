// Minimal IndexedDB wrapper. All data stays on the device.
const DB_NAME = 'lift-run-journey';
const DB_VERSION = 1;
export const STORES = ['exercises', 'sessions', 'runs', 'races', 'bodyweight', 'meta'];

let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const db = {
  all: store => tx(store, 'readonly', s => wrap(s.getAll())),
  get: (store, id) => tx(store, 'readonly', s => wrap(s.get(id))),
  put: (store, obj) => tx(store, 'readwrite', s => { s.put(obj); return obj; }),
  putMany: (store, arr) => tx(store, 'readwrite', s => { arr.forEach(o => s.put(o)); return arr.length; }),
  del: (store, id) => tx(store, 'readwrite', s => { s.delete(id); }),
  clear: store => tx(store, 'readwrite', s => { s.clear(); }),
  async getMeta(key, fallback = null) {
    const r = await db.get('meta', key);
    return r ? r.value : fallback;
  },
  setMeta: (key, value) => db.put('meta', { id: key, value }),
};

export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (e) { /* ignore */ }
  return false;
}
