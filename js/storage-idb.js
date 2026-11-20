/* storage-idb.js — надёжное хранилище пользователя: IndexedDB с fallback на localStorage.
   Схема с версией и миграциями, автосейв с дебаунсом, экспорт/импорт JSON, persist().
   Чистая логика хранится отдельно от DOM (notes.js). Никаких секретов. */

const DB_NAME = 'yulia-helper';
const DB_VERSION = 1;
const STORE = 'kv';

/* ---- лёгкая обёртка localStorage (fallback) ---- */
function lsGet(key, fallback) {
  try { const v = localStorage.getItem('yulia.idb.' + key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem('yulia.idb.' + key, JSON.stringify(value)); return true; } catch (e) { return false; }
}
function lsKeys() {
  try { return Object.keys(localStorage).filter(k => k.startsWith('yulia.idb.')).map(k => k.slice(9)); } catch (e) { return []; }
}

/* ---- IndexedDB ---- */
function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no idb'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      // Миграции будущих версий: switch (e.oldVersion) { case 1: ... }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb open error'));
    req.onblocked = () => reject(new Error('idb blocked'));
  });
}

/* Режим: 'idb' | 'ls'. Определяется при первом обращении. */
let mode = null, dbPromise = null;
export function storageMode() { return mode; }

async function withIDB(fn) {
  if (!dbPromise) dbPromise = openDB().then(db => { mode = 'idb'; return db; }).catch(e => { mode = 'ls'; throw e; });
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const out = fn(store);
    tx.oncomplete = () => resolve(out && out.result !== undefined ? out.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

/* ---- публичный API (асинхронный, одинаковый для обоих режимов) ---- */
export const store2 = {
  async get(key, fallback = null) {
    try { const v = await withIDB(s => s.get(key)); return v === undefined || v === null ? fallback : v; }
    catch (e) { return lsGet(key, fallback); }
  },
  async set(key, value) {
    try { await withIDB(s => s.put(value, key)); return true; }
    catch (e) { return lsSet(key, value); }
  },
  async del(key) {
    try { await withIDB(s => s.delete(key)); return true; }
    catch (e) { try { localStorage.removeItem('yulia.idb.' + key); } catch (e2) {} return true; }
  },
  async keys() {
    try { return await withIDB(s => s.getAllKeys()) || []; }
    catch (e) { return lsKeys(); }
  },
  mode() { return mode || 'ls'; }
};

/* Дебаунс-автосейв: вызывает save не чаще, чем через delay мс после последнего изменения */
export function autosave(save, delay = 400) {
  let t = null, lastPromise = Promise.resolve(true);
  return value => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { lastPromise = Promise.resolve(save(value)).catch(() => false); }, delay);
    return lastPromise;
  };
}

/* Запрос защиты от автоматической очистки хранилища */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (e) { /* не критично */ }
  return false;
}

/* Экспорт всех данных пользователя в объект (для JSON-файла) */
export async function exportAll(extra = {}) {
  const keys = await store2.keys();
  const data = { __app: 'yulia-teatr-nsk', __schema: DB_VERSION, __exportedAt: new Date().toISOString() };
  for (const k of keys) data[k] = await store2.get(k);
  return { ...data, ...extra };
}

/* Импорт: возвращает список импортированных ключей; чужие файлы отклоняет */
export async function importAll(obj) {
  if (!obj || obj.__app !== 'yulia-teatr-nsk') throw new Error('Это не резервная копия справочника Юлии');
  const keys = Object.keys(obj).filter(k => !k.startsWith('__'));
  for (const k of keys) await store2.set(k, obj[k]);
  return keys;
}

/* Скачивание JSON-файла резервной копии */
export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
