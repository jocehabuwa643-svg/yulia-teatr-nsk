/* sw.js — сервис-воркер «Бизнес-помощника Юлии»: установка на телефон/ноутбук и работа без сети.
   Принципы:
   • ДАННЫЕ (data/*.json) — всегда из сети (network-first). Кэш — только запасной вариант без сети или при сбое сервера (5xx);
     такой ответ помечается заголовком X-SW-Fallback, а странице уходит сообщение «показаны сохранённые данные».
   • HTML — тоже network-first (свежая страница), без сети — последняя сохранённая, иначе offline.html.
   • Запросы со сбросом кэша (?t=, ?v= — кнопка «Обновить данные» в js/live-data.js) идут в сеть; кэш — только без сети.
   • Статика (assets/, css/, js/, иконки) — stale-while-revalidate: мгновенно из кэша, в фоне обновляется.
     В сборке assets/* подключаются с ?b=<версия>, поэтому новая страница никогда не получит старый бандл.
   • Внешние библиотеки (unpkg, jsdelivr, Google Fonts) — ограниченный кэш (не больше EXT_LIMIT записей);
     тайлы карты и прочие внешние запросы сервис-воркер не трогает вовсе.
   • Новая версия ждёт: skipWaiting — только по нажатию «Обновить» на плашке (сообщение SKIP_WAITING из js/pwa.js).
   VERSION и PRECACHE подставляет scripts/build.mjs; в исходниках (локальная разработка) VERSION = '__BUILD_VERSION__',
   и тогда вся локальная статика тоже идёт network-first — правки видны сразу, без «залипшего» кэша. */
'use strict';

const VERSION = '__BUILD_VERSION__';
const DEV = VERSION.indexOf('__') === 0;

/* Оболочка приложения: всё, что нужно, чтобы открыться без сети. В сборке список заменяется полным (assets, иконки) */
const PRECACHE = /*PRECACHE*/['./', 'offline.html', 'manifest.webmanifest', 'favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png']/*END*/;

const SHELL = 'yulia-shell-' + VERSION;     // оболочка конкретной версии
const RUNTIME = 'yulia-runtime-' + VERSION; // статика, догруженная по ходу работы
const DATA = 'yulia-data-v1';               // последние удачные data/*.json — живут между версиями (запасной вариант без сети)
const EXT = 'yulia-ext-v1';                 // внешние библиотеки с лимитом записей
const KEEP = [SHELL, RUNTIME, DATA, EXT];
const EXT_LIMIT = 24;
const EXT_HOSTS = ['unpkg.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const BUST_PARAMS = ['t', 'v'];             // параметры «принудительно из сети»
const MSG_DATA_FALLBACK = 'yulia-sw:data-fallback';

/* ---------- Маршрутизация (чистая функция — проверяется тестами) ----------
   Возвращает стратегию: 'bypass' (не трогаем), 'html', 'data', 'fresh', 'static', 'ext' */
function routeFor(urlStr, scopeStr, method, mode) {
  if (method && method !== 'GET') return 'bypass';
  let url, scope;
  try { url = new URL(urlStr); scope = new URL(scopeStr); } catch (e) { return 'bypass'; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'bypass';
  if (url.origin !== scope.origin) return EXT_HOSTS.indexOf(url.hostname) >= 0 ? 'ext' : 'bypass';
  if (url.pathname.indexOf(scope.pathname) !== 0) return 'bypass';
  const rel = url.pathname.slice(scope.pathname.length);
  if (rel === 'sw.js') return 'bypass';
  if (rel.indexOf('data/') === 0) return 'data';
  if (mode === 'navigate' || rel === '' || /\.html$/.test(rel)) return 'html';
  for (const p of BUST_PARAMS) if (url.searchParams.has(p)) return 'fresh';
  return 'static';
}

/* Ключ кэша данных: путь без параметров (?t= от «Обновить данные» и без него — один и тот же файл) */
function dataKey(urlStr) {
  const u = new URL(urlStr);
  return u.origin + u.pathname;
}

/* Ключ кэша страницы: корень области и index.html — один документ, параметры (?source=pwa) не важны */
function htmlKey(urlStr, scopeStr) {
  const u = new URL(urlStr);
  const rel = u.pathname.slice(new URL(scopeStr).pathname.length);
  return u.origin + (rel === '' || rel === 'index.html' ? new URL(scopeStr).pathname : u.pathname);
}

/* Можно ли класть ответ в кэш: успешный того же источника/CORS; непрозрачный — только для внешних библиотек */
function cacheable(res, allowOpaque) {
  if (!res) return false;
  if (res.type === 'opaque') return !!allowOpaque;
  return res.ok && res.status === 200;
}

/* Ответ из кэша с пометкой «запасной вариант» (заголовки кэшированного ответа неизменяемы — пересобираем) */
function markFallback(res) {
  const h = new Headers(res.headers);
  h.set('X-SW-Fallback', 'cache');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

/* Обрезка внешнего кэша: удаляем самые старые записи сверх лимита */
async function trimCache(name, limit) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
}

/* Сообщить странице, что данные взяты из кэша (дата — из заголовка Date сохранённого ответа) */
async function notifyFallback(clientId, path, cached) {
  try {
    const client = clientId ? await self.clients.get(clientId) : null;
    const targets = client ? [client] : await self.clients.matchAll({ type: 'window' });
    const date = cached.headers.get('date') || null;
    targets.forEach(c => c.postMessage({ type: MSG_DATA_FALLBACK, path, date }));
  } catch (e) { /* страница могла закрыться — не критично */ }
}

/* ---------- Стратегии ---------- */

/* HTML: сеть (с навигационным preload) → сохранённая страница → offline.html */
async function handleHtml(event) {
  const req = event.request;
  const key = htmlKey(req.url, self.registration.scope);
  try {
    const res = (await event.preloadResponse) || await fetch(req);
    if (cacheable(res)) {
      const copy = res.clone();
      event.waitUntil(caches.open(SHELL).then(c => c.put(key, copy)));
    }
    return res;
  } catch (e) {
    const cached = await caches.match(key) || await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    const offline = await caches.match(new URL('offline.html', self.registration.scope).href);
    if (offline) return offline;
    throw e;
  }
}

/* Данные: только сеть; кэш — без сети или при 5xx, с пометкой и сообщением странице */
async function handleData(event) {
  const req = event.request;
  const key = dataKey(req.url);
  let res = null, err = null;
  try { res = await fetch(req); } catch (e) { err = e; }
  if (res && res.status < 500) {
    if (cacheable(res)) {
      const copy = res.clone();
      event.waitUntil(caches.open(DATA).then(c => c.put(key, copy)));
    }
    return res;
  }
  const cached = await caches.match(key, { cacheName: DATA });
  if (cached) {
    event.waitUntil(notifyFallback(event.clientId, new URL(req.url).pathname, cached));
    return markFallback(cached);
  }
  if (res) return res;
  throw err;
}

/* Сеть, кэш — только без сети (запросы со сбросом кэша и вся статика в режиме разработки) */
async function handleNetworkFirst(event, cacheName) {
  const req = event.request;
  try {
    const res = await fetch(req);
    if (cacheable(res)) {
      const copy = res.clone();
      event.waitUntil(caches.open(cacheName).then(c => c.put(req, copy)));
    }
    return res;
  } catch (e) {
    const cached = await caches.match(req) || await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    throw e;
  }
}

/* Stale-while-revalidate: ответ из кэша сразу, обновление — в фоне; без кэша — из сети */
async function handleSwr(event, cacheName, allowOpaque, limit) {
  const req = event.request;
  const cached = await caches.match(req);
  const update = fetch(req).then(async res => {
    if (cacheable(res, allowOpaque)) {
      const cache = await caches.open(cacheName);
      await cache.put(req, res.clone());
      if (limit) await trimCache(cacheName, limit);
    }
    return res;
  });
  if (cached) {
    event.waitUntil(update.catch(() => null));
    return cached;
  }
  return update;
}

/* ---------- Жизненный цикл ---------- */
self.addEventListener('install', event => {
  // cache: 'reload' — мимо HTTP-кэша браузера, чтобы в оболочку попали именно файлы этой версии
  event.waitUntil(caches.open(SHELL).then(cache =>
    cache.addAll(PRECACHE.map(u => new Request(u, { cache: 'reload' })))
  ));
  // skipWaiting здесь НЕ вызываем: новая версия включается по кнопке «Обновить» (или когда закроются все вкладки)
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.indexOf('yulia-') === 0 && KEEP.indexOf(n) < 0).map(n => caches.delete(n)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) { /* не поддерживается — обычный fetch */ }
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  else if (data.type === 'GET_VERSION' && event.ports && event.ports[0]) event.ports[0].postMessage({ version: VERSION });
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const route = routeFor(req.url, self.registration.scope, req.method, req.mode);
  if (route === 'bypass') return;
  if (route === 'html') event.respondWith(handleHtml(event));
  else if (route === 'data') event.respondWith(handleData(event));
  else if (route === 'fresh') event.respondWith(handleNetworkFirst(event, RUNTIME));
  else if (route === 'ext') event.respondWith(handleSwr(event, EXT, true, EXT_LIMIT));
  else event.respondWith(DEV ? handleNetworkFirst(event, RUNTIME) : handleSwr(event, RUNTIME, false, 0));
});
