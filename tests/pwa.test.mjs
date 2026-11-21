/* Тесты PWA: чистые функции js/pwa.js (платформа, режим установки, правила показа, тексты), манифест и иконки,
   сервис-воркер sw.js в песочнице node:vm с поддельными fetch/caches: маршрутизация, свежесть данных (network-first),
   запасной кэш без сети с пометкой, офлайн-страница, мягкое обновление (skipWaiting только по сообщению), чистка старых кэшей.
   Сеть не используется. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';
import {
  detectPlatform, installMode, canRegister, shouldAutoShow, formatSavedDate, copyFor, initPwa,
  DISMISS_DAYS, ACTION_DELAY_MS, AUTO_DELAY_MS
} from '../js/pwa.js';

const ROOT = new URL('../', import.meta.url);
const read = rel => readFileSync(new URL(rel, ROOT), 'utf-8');
const DAY = 864e5;

/* ---------- Платформа и режим установки ---------- */
const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; 2201117TY) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  miBrowser: 'Mozilla/5.0 (Linux; U; Android 13; ru-ru; M2101K6G Build/TKQ1.221013.002) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/112.0.5615.136 Mobile Safari/537.36 XiaoMi/MiuiBrowser/18.1',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  ipadOs: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
};

test('detectPlatform: Android, iPhone, iPadOS (Macintosh + сенсор), компьютер, уже приложение', () => {
  assert.equal(detectPlatform({ ua: UA.androidChrome }), 'android');
  assert.equal(detectPlatform({ ua: UA.miBrowser }), 'android');
  assert.equal(detectPlatform({ ua: UA.iphone }), 'ios');
  assert.equal(detectPlatform({ ua: UA.ipadOs, maxTouchPoints: 5 }), 'ios');
  assert.equal(detectPlatform({ ua: UA.ipadOs, maxTouchPoints: 0 }), 'desktop');
  assert.equal(detectPlatform({ ua: UA.winChrome }), 'desktop');
  assert.equal(detectPlatform({ ua: UA.androidChrome, standalone: true }), 'standalone');
  assert.equal(detectPlatform(), 'desktop');
});

test('installMode: системное окно важнее инструкции; iPhone — «Поделиться»; без события — меню браузера', () => {
  assert.equal(installMode('android', true), 'prompt');
  assert.equal(installMode('desktop', true), 'prompt');
  assert.equal(installMode('ios', false), 'ios');
  assert.equal(installMode('android', false), 'manual');
  assert.equal(installMode('desktop', false), 'manual');
  assert.equal(installMode('standalone', true), 'none');
});

test('canRegister: только https и локальный сервер, не file://', () => {
  assert.equal(canRegister({ protocol: 'https:', hostname: 'jocehabuwa643-svg.github.io' }), true);
  assert.equal(canRegister({ protocol: 'http:', hostname: 'localhost' }), true);
  assert.equal(canRegister({ protocol: 'http:', hostname: '127.0.0.1' }), true);
  assert.equal(canRegister({ protocol: 'http:', hostname: '[::1]' }), true);
  assert.equal(canRegister({ protocol: 'http:', hostname: '192.168.1.5' }), false);
  assert.equal(canRegister({ protocol: 'file:', hostname: '' }), false);
  assert.equal(canRegister(null), false);
});

test('shouldAutoShow: «Не сейчас» — тишина 14 дней; установлено — никогда; компьютер без окна — только из меню', () => {
  const now = Date.parse('2026-11-21T10:00:00Z');
  assert.equal(DISMISS_DAYS, 14);
  assert.equal(shouldAutoShow({ mode: 'prompt', platform: 'android', now }), true);
  assert.equal(shouldAutoShow({ mode: 'prompt', platform: 'android', now, dismissedAt: now - 13 * DAY }), false);
  assert.equal(shouldAutoShow({ mode: 'prompt', platform: 'android', now, dismissedAt: now - 15 * DAY }), true);
  assert.equal(shouldAutoShow({ mode: 'ios', platform: 'ios', now }), true);
  assert.equal(shouldAutoShow({ mode: 'manual', platform: 'android', now }), true);
  assert.equal(shouldAutoShow({ mode: 'manual', platform: 'desktop', now }), false);
  assert.equal(shouldAutoShow({ mode: 'prompt', platform: 'desktop', now }), true);
  assert.equal(shouldAutoShow({ mode: 'prompt', platform: 'android', now, installed: true }), false);
  assert.equal(shouldAutoShow({ mode: 'none', platform: 'standalone', now }), false);
});

test('задержки показа: не сразу — после действия или ~20 с', () => {
  assert.ok(ACTION_DELAY_MS >= 3000 && ACTION_DELAY_MS <= 15000);
  assert.ok(AUTO_DELAY_MS >= 15000 && AUTO_DELAY_MS <= 30000);
});

test('copyFor: тексты на русском, кнопки, шаги и значки для iPhone и «меню браузера»', () => {
  const p = copyFor('prompt', 'android');
  assert.match(p.title, /Установить на телефон/);
  assert.match(p.text, /ярлыком на рабочем столе/);
  assert.equal(p.primary, 'Установить');
  assert.equal(p.secondary, 'Не сейчас');
  assert.match(copyFor('prompt', 'desktop').title, /компьютер/);
  const ios = copyFor('ios', 'ios');
  assert.equal(ios.steps.length, 3);
  assert.match(ios.steps[0], /Поделиться/);
  assert.match(ios.steps[0], /<svg/);
  assert.match(ios.steps[1], /На экран/);
  const man = copyFor('manual', 'android');
  assert.match(man.steps.join(' '), /Добавить на главный экран/);
  assert.match(copyFor('manual', 'desktop').steps.join(' '), /Safari/);
  const upd = copyFor('update', 'android');
  assert.equal(upd.primary, 'Обновить');
  assert.match(copyFor('offline', 'android', { date: 'Sat, 21 Nov 2026 07:05:00 GMT' }).text, /сохранённые данные от 21\.11\.2026/);
  assert.match(copyFor('offline', 'android').text, /^Показаны сохранённые данные\./);
});

test('formatSavedDate: пустая строка без даты и для мусора', () => {
  assert.equal(formatSavedDate(''), '');
  assert.equal(formatSavedDate(null), '');
  assert.equal(formatSavedDate('не дата'), '');
  assert.match(formatSavedDate('2026-11-21T07:05:00Z'), /21\.11\.2026/);
});

test('initPwa без браузера и на file:// ничего не делает (модуль импортируется без побочных эффектов)', () => {
  assert.equal(initPwa({ win: null, doc: null }), null);
  const win = { location: { protocol: 'file:' } };
  assert.equal(initPwa({ win, doc: {} }), null);
  assert.equal(win.__yuliaPwa, true);
  assert.equal(initPwa({ win, doc: {} }), null, 'повторный запуск игнорируется');
});

/* ---------- Манифест и иконки ---------- */
const pngSize = rel => {
  const b = readFileSync(new URL(rel, ROOT));
  assert.equal(b.toString('hex', 0, 8), '89504e470d0a1a0a', `${rel} — не PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

test('manifest.webmanifest: имя, короткое имя ≤12, относительные start_url/scope, standalone, иконки any+maskable, ярлыки', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.name, 'Бизнес-помощник Юлии');
  assert.ok(m.short_name.length <= 12, 'short_name длиннее 12 символов');
  assert.equal(m.lang, 'ru');
  assert.equal(m.display, 'standalone');
  // относительные адреса работают и на подпути /yulia-teatr-nsk/, и в корне localhost
  for (const k of ['start_url', 'scope', 'id']) assert.ok(!/^\/|^https?:/.test(m[k]), `${k} должен быть относительным`);
  assert.match(m.background_color, /^#[0-9A-F]{6}$/i);
  assert.match(m.theme_color, /^#[0-9A-F]{6}$/i);
  const purposes = new Set(m.icons.map(i => i.purpose));
  assert.ok(purposes.has('any') && purposes.has('maskable'));
  for (const ic of m.icons) {
    assert.ok(existsSync(new URL(ic.src, ROOT)), `нет файла ${ic.src}`);
    const [w, h] = pngSize(ic.src);
    assert.equal(`${w}x${h}`, ic.sizes, `${ic.src}: размер не совпадает с манифестом`);
  }
  assert.ok(m.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable'));
  assert.ok(m.icons.some(i => i.sizes === '192x192' && i.purpose === 'any'));
  const hashes = m.shortcuts.map(s => s.url.split('#')[1]);
  assert.deepEqual(hashes, ['profit', 'calc', 'market']);
  for (const s of m.shortcuts) assert.ok(!/^\//.test(s.url));
});

test('иконки: apple-touch 180, favicon 32; index.html подключает манифест и иконки в <head>', () => {
  assert.deepEqual(pngSize('icons/apple-touch-icon.png'), [180, 180]);
  assert.deepEqual(pngSize('icons/favicon-32.png'), [32, 32]);
  const head = read('index.html').split('</head>')[0];
  assert.match(head, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(head, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/);
  assert.match(head, /apple-mobile-web-app-capable/);
  assert.match(head, /theme-color/);
  assert.match(read('js/app.js'), /import '\.\/pwa\.js'/);
});

/* ---------- Сервис-воркер в песочнице ---------- */
const SCOPE = 'https://example.github.io/yulia-teatr-nsk/';

/* Поддельные Cache Storage, Response, Request, Headers — ровно столько, сколько использует sw.js */
function makeEnv({ network }) {
  const store = new Map(); // имя кэша → Map(url → Response)
  const keyOf = r => typeof r === 'string' ? r : r.url;
  const stripSearch = u => u.split('?')[0];
  class FakeCache {
    constructor(m) { this.m = m; }
    async put(r, res) { this.m.set(keyOf(r), res); }
    async match(r, o = {}) {
      const k = keyOf(r);
      // как настоящий Cache API: каждый раз новая копия ответа
      if (this.m.has(k)) return this.m.get(k).clone();
      if (o.ignoreSearch) for (const [kk, v] of this.m) if (stripSearch(kk) === stripSearch(k)) return v.clone();
      return undefined;
    }
    async keys() { return [...this.m.keys()].map(url => ({ url })); }
    async delete(r) { return this.m.delete(keyOf(r)); }
    async addAll(reqs) { for (const r of reqs) { const res = await network(r); this.m.set(new URL(keyOf(r), SCOPE).href, res); } }
  }
  const caches = {
    async open(n) { if (!store.has(n)) store.set(n, new Map()); return new FakeCache(store.get(n)); },
    async keys() { return [...store.keys()]; },
    async delete(n) { return store.delete(n); },
    async match(r, o = {}) {
      const names = o.cacheName ? [o.cacheName] : [...store.keys()];
      for (const n of names) { if (!store.has(n)) continue; const v = await new FakeCache(store.get(n)).match(r, o); if (v) return v; }
      return undefined;
    }
  };
  const listeners = {};
  const messages = [];
  const self = {
    registration: { scope: SCOPE, navigationPreload: null },
    clients: {
      claimed: false,
      async claim() { this.claimed = true; },
      async get() { return { postMessage: m => messages.push(m) }; },
      async matchAll() { return [{ postMessage: m => messages.push(m) }]; }
    },
    skipped: false,
    skipWaiting() { this.skipped = true; },
    addEventListener(t, fn) { listeners[t] = fn; }
  };
  const ctx = vm.createContext({
    self, caches, URL, Headers, Response, console,
    Request: class { constructor(u, o = {}) { this.url = new URL(u, SCOPE).href; this.cache = o.cache; this.method = 'GET'; } },
    fetch: r => network(r)
  });
  vm.runInContext(read('sw.js'), ctx, { filename: 'sw.js' });
  /* Прогон события fetch: возвращает ответ (или undefined, если воркер его не перехватил) */
  async function fetchEv(url, { mode = 'cors', method = 'GET' } = {}) {
    let responded = null;
    const waits = [];
    const ev = {
      request: { url, method, mode, clone() { return this; } }, clientId: 'c1', preloadResponse: Promise.resolve(undefined),
      respondWith(p) { responded = p; }, waitUntil(p) { waits.push(p); }
    };
    listeners.fetch(ev);
    if (!responded) return undefined;
    const res = await responded;
    await Promise.all(waits);
    return res;
  }
  return { ctx, self, caches, store, listeners, messages, fetchEv };
}
const json = (obj, extra = {}) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json', date: 'Sat, 21 Nov 2026 07:05:00 GMT', ...extra } });

test('sw.js: метки для сборки на месте (VERSION и список предзагрузки), в исходниках — режим разработки', () => {
  const src = read('sw.js');
  assert.match(src, /const VERSION = '__BUILD_VERSION__';/);
  assert.match(src, /\/\*PRECACHE\*\/\[[^\]]*\]\/\*END\*\//);
  assert.match(src, /'offline\.html'/);
});

test('sw.js routeFor: данные, страница, сброс кэша, статика, внешние библиотеки, тайлы карты не трогаем', () => {
  const { ctx } = makeEnv({ network: async () => new Response('') });
  const r = (u, mode) => ctx.routeFor(u, SCOPE, 'GET', mode);
  assert.equal(r(SCOPE + 'data/rates.json'), 'data');
  assert.equal(r(SCOPE + 'data/rates.json?t=123'), 'data');
  assert.equal(r(SCOPE, 'navigate'), 'html');
  assert.equal(r(SCOPE + '?source=pwa', 'navigate'), 'html');
  assert.equal(r(SCOPE + 'yulia-offline.html'), 'html');
  assert.equal(r(SCOPE + 'assets/app.js?b=abc'), 'static');
  assert.equal(r(SCOPE + 'css/base.css?v=2'), 'fresh');
  assert.equal(r(SCOPE + 'icons/icon-192.png'), 'static');
  assert.equal(r(SCOPE + 'sw.js'), 'bypass');
  assert.equal(r('https://example.github.io/other-site/x.js'), 'bypass');
  assert.equal(r('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'), 'ext');
  assert.equal(r('https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.min.js'), 'ext');
  assert.equal(r('https://tile.openstreetmap.org/12/3000/1300.png'), 'bypass');
  assert.equal(r('https://www.cbr.ru/scripts/XML_daily.asp'), 'bypass');
  assert.equal(ctx.routeFor(SCOPE + 'data/rates.json', SCOPE, 'POST', 'cors'), 'bypass');
});

test('sw.js данные: при сети всегда свежий файл, кэш не подменяет ответ', async () => {
  let version = 1;
  const env = makeEnv({ network: async r => (r.url || String(r)).includes('data/') ? json({ v: version }) : new Response('ok') });
  const a = await env.fetchEv(SCOPE + 'data/rates.json');
  assert.deepEqual(await a.json(), { v: 1 });
  version = 2; // файл на сервере изменился
  const b = await env.fetchEv(SCOPE + 'data/rates.json');
  assert.deepEqual(await b.json(), { v: 2 });
  assert.equal(b.headers.get('X-SW-Fallback'), null);
  // «Обновить данные» (?t=) тоже идёт в сеть
  version = 3;
  const c = await env.fetchEv(SCOPE + 'data/rates.json?t=1');
  assert.deepEqual(await c.json(), { v: 3 });
  assert.equal(env.messages.length, 0);
});

test('sw.js данные: без сети — сохранённая копия с пометкой и сообщением странице; без копии — ошибка', async () => {
  let online = true;
  const env = makeEnv({ network: async () => { if (!online) throw new TypeError('Failed to fetch'); return json({ v: 7 }); } });
  await env.fetchEv(SCOPE + 'data/rates.json');
  online = false;
  const res = await env.fetchEv(SCOPE + 'data/rates.json?t=99');
  assert.equal(res.headers.get('X-SW-Fallback'), 'cache');
  assert.deepEqual(await res.json(), { v: 7 });
  assert.equal(env.messages.length, 1);
  assert.equal(env.messages[0].type, 'yulia-sw:data-fallback');
  assert.equal(env.messages[0].path, '/yulia-teatr-nsk/data/rates.json');
  assert.equal(env.messages[0].date, 'Sat, 21 Nov 2026 07:05:00 GMT');
  await assert.rejects(env.fetchEv(SCOPE + 'data/news.json'), /Failed to fetch/);
});

test('sw.js данные: сбой сервера 5xx — запасной кэш; 404 отдаётся как есть', async () => {
  let status = 200;
  const env = makeEnv({ network: async () => status === 200 ? json({ ok: 1 }) : new Response('err', { status }) });
  await env.fetchEv(SCOPE + 'data/meta.json');
  status = 503;
  const res = await env.fetchEv(SCOPE + 'data/meta.json');
  assert.equal(res.headers.get('X-SW-Fallback'), 'cache');
  status = 404;
  const nf = await env.fetchEv(SCOPE + 'data/meta.json');
  assert.equal(nf.status, 404);
});

test('sw.js страница: сеть → последняя сохранённая (с любыми параметрами) → offline.html', async () => {
  let online = true;
  const env = makeEnv({ network: async r => { if (!online) throw new TypeError('offline'); const u = r.url || String(r); return new Response(u.includes('offline.html') ? 'OFFLINE' : 'PAGE v1', { status: 200 }); } });
  // установка кладёт оболочку (включая offline.html) в кэш
  const waits = [];
  env.listeners.install({ waitUntil: p => waits.push(p) });
  await Promise.all(waits);
  assert.equal(await (await env.fetchEv(SCOPE, { mode: 'navigate' })).text(), 'PAGE v1');
  online = false;
  assert.equal(await (await env.fetchEv(SCOPE + '?source=pwa', { mode: 'navigate' })).text(), 'PAGE v1');
  assert.equal(await (await env.fetchEv(SCOPE + 'index.html', { mode: 'navigate' })).text(), 'PAGE v1');
  // страницы, которой никогда не было в кэше, — офлайн-страница
  assert.equal(await (await env.fetchEv(SCOPE + 'yulia-offline.html', { mode: 'navigate' })).text(), 'OFFLINE');
});

test('sw.js тайлы карты и чужие запросы не перехватываются', async () => {
  const env = makeEnv({ network: async () => new Response('') });
  assert.equal(await env.fetchEv('https://tile.openstreetmap.org/1/1/1.png'), undefined);
  assert.equal(await env.fetchEv(SCOPE + 'data/x.json', { method: 'POST' }), undefined);
});

test('sw.js обновление: skipWaiting только по сообщению SKIP_WAITING; при активации старые кэши удаляются', async () => {
  const env = makeEnv({ network: async () => new Response('x') });
  const waits = [];
  env.listeners.install({ waitUntil: p => waits.push(p) });
  await Promise.all(waits);
  assert.equal(env.self.skipped, false, 'установка не должна сама включать новую версию');
  env.listeners.message({ data: { type: 'другое' } });
  assert.equal(env.self.skipped, false);
  env.listeners.message({ data: { type: 'SKIP_WAITING' } });
  assert.equal(env.self.skipped, true);

  await env.caches.open('yulia-shell-old');
  await env.caches.open('yulia-runtime-old');
  await env.caches.open('чужой-кэш');
  const acts = [];
  env.listeners.activate({ waitUntil: p => acts.push(p) });
  await Promise.all(acts);
  const names = await env.caches.keys();
  assert.ok(!names.includes('yulia-shell-old') && !names.includes('yulia-runtime-old'));
  assert.ok(names.includes('чужой-кэш'), 'чужие кэши не трогаем');
  assert.ok(names.includes('yulia-shell-__BUILD_VERSION__'));
  assert.equal(env.self.clients.claimed, true);
});

test('sw.js внешние библиотеки: ограниченный кэш, не больше лимита записей', async () => {
  const env = makeEnv({ network: async () => new Response('lib', { status: 200 }) });
  for (let i = 0; i < 40; i++) await env.fetchEv(`https://cdn.jsdelivr.net/npm/lib${i}.js`);
  const ext = env.store.get('yulia-ext-v1');
  const limit = vm.runInContext('EXT_LIMIT', env.ctx);
  assert.ok(limit > 0 && ext.size <= limit, `в кэше ${ext.size} записей`);
});
