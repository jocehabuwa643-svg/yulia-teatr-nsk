/* audit-ui.test.mjs — аудит, часть «UI и сеть»: иконка кнопки «Обновить данные» вместо символа-квадрата,
   все имена иконок есть во встроенном наборе (офлайн без CDN), спокойные подписи о сети с датой данных. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON_DATA } from '../js/ui/icon-data.js';
import { fmtDayMonth, dataDateOf, savedDataDate, networkNotice } from '../js/live-data.js';
import { copyFor } from '../js/pwa.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = p => readFileSync(join(ROOT, p), 'utf-8');

/* Все исходники интерфейса: js/**, index.html, offline.html */
function sources() {
  const out = ['index.html', 'offline.html'];
  const walk = d => readdirSync(join(ROOT, d)).forEach(f => {
    const p = d + '/' + f;
    if (statSync(join(ROOT, p)).isDirectory()) walk(p); else if (/\.js$/.test(f)) out.push(p);
  });
  walk('js');
  return out;
}

/* Локальное хранилище-заглушка с интерфейсом localStorage */
function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('кнопка «Обновить данные»: SVG-иконка refresh-cw, без символа ⟳ (в части шрифтов — пустой квадрат)', () => {
  const src = read('js/live-data.js');
  assert.doesNotMatch(src, /⟳/);
  assert.match(src, /ICON_DATA\['refresh-cw'\]/);
  assert.ok(ICON_DATA['refresh-cw'] && ICON_DATA['refresh-cw'].length === 4, 'refresh-cw есть в наборе (Lucide 0.454.0)');
  assert.match(read('css/components.css'), /#liveDataBtn\[aria-busy=true\] svg\.lucide\{animation:ld-spin/);
  assert.match(read('css/components.css'), /prefers-reduced-motion:reduce\)\{#liveDataBtn/);
});

test('в интерфейсе нет символов-заглушек (▯ □ ￼ � ⟳)', () => {
  for (const f of sources()) assert.doesNotMatch(read(f), /[\u25AF\u25A1\uFFFC\uFFFD\u27F3]/, f);
});

test('все иконки ic(\'…\') и data-lucide="…" есть во встроенном наборе — офлайн ничего не грузится с CDN', () => {
  const missing = new Set();
  const res = [/data-lucide=\\?["']([a-z0-9-]+)["']/g, /\bic\(\s*['"]([a-z0-9-]+)['"]\s*\)/g, /\bicon\s*:\s*'([a-z0-9-]+)'/g];
  for (const f of sources()) {
    const t = read(f);
    for (const re of res) for (const m of t.matchAll(re)) if (!ICON_DATA[m[1]]) missing.add(m[1] + ' (' + f + ')');
  }
  for (const f of readdirSync(join(ROOT, 'data')).filter(x => x.endsWith('.json'))) {
    for (const m of read('data/' + f).matchAll(/"icon"\s*:\s*"([a-z0-9-]+)"/g)) if (!ICON_DATA[m[1]]) missing.add(m[1] + ' (data/' + f + ')');
  }
  assert.deepEqual([...missing], []);
  assert.ok(ICON_DATA['map-pin-check'], 'map-pin-check (карточки клиентов) — в наборе');
});

test('fmtDayMonth: «23 ноября», другой год — с годом, мусор — пусто', () => {
  const now = Date.parse('2026-11-24T05:00:00Z');
  assert.equal(fmtDayMonth(Date.parse('2026-11-23T06:00:00Z'), now), '23 ноября');
  assert.equal(fmtDayMonth('2026-03-08T06:00:00Z', now), '8 марта');
  assert.equal(fmtDayMonth('2025-11-23T06:00:00Z', now), '23 ноября 2025');
  assert.equal(fmtDayMonth('', now), '');
  assert.equal(fmtDayMonth('не дата', now), '');
  assert.equal(fmtDayMonth(null, now), '');
});

test('dataDateOf: самая поздняя из meta.generated_at / meta.checked_at / news.updated_at', () => {
  assert.equal(dataDateOf({ meta: { generated_at: '2026-11-20T00:00:00Z', checked_at: '2026-11-23T02:30:00Z' }, news: { updated_at: '2026-11-22T00:00:00Z' } }), Date.parse('2026-11-23T02:30:00Z'));
  assert.equal(dataDateOf({ news: { updated_at: '2026-11-22T00:00:00Z' } }), Date.parse('2026-11-22T00:00:00Z'));
  assert.equal(dataDateOf({}), null);
  assert.equal(dataDateOf(null), null);
});

test('savedDataDate: читает сохранённые data-loader.js копии (ключ yulia.v2.data.v2.<имя>) и не падает без хранилища', () => {
  const ls = memStorage({
    'yulia.v2.data.v2.meta': JSON.stringify({ t: 1, d: { generated_at: '2026-11-23T11:00:00Z' } }),
    'yulia.v2.data.v2.news': JSON.stringify({ t: 1, d: { updated_at: '2026-11-21T00:00:00Z' } })
  });
  assert.equal(savedDataDate(ls), Date.parse('2026-11-23T11:00:00Z'));
  assert.equal(savedDataDate(memStorage({ 'yulia.v2.data.v2.meta': '{битый json' })), null);
  assert.equal(savedDataDate(null), null);
  // ключ кэша совпадает с data-loader.js (версия данных 2)
  const dl = read('js/data-loader.js');
  assert.match(dl, /const DATA_VERSION = 2;/);
  assert.match(dl, /const cacheKey = n => `data\.v\$\{DATA_VERSION\}\.\$\{n\}`/);
});

test('networkNotice: спокойные подписи без «ошибок», с датой данных', () => {
  const now = Date.parse('2026-11-24T05:00:00Z'), at = Date.parse('2026-11-23T06:00:00Z');
  assert.equal(networkNotice('offline', at, now), 'Работа в офлайн-режиме · данные от 23 ноября');
  assert.equal(networkNotice('offline', null, now), 'Работа в офлайн-режиме · показаны сохранённые данные');
  assert.equal(networkNotice('stale', at, now), 'Данные от 23 ноября · обновятся автоматически');
  assert.equal(networkNotice('news-partial', at, now), 'Часть новостей обновится позже');
  assert.equal(networkNotice('что-то ещё', at, now), '');
  for (const k of ['offline', 'stale', 'news-partial']) {
    assert.doesNotMatch(networkNotice(k, at, now), /Нет сети|не удалось|ошибк|проверьте|не ответил/i);
  }
});

test('офлайн-плашка pwa.js: «Работа в офлайн-режиме · данные от …», «Сеть есть · Обновить»', () => {
  const off = copyFor('offline', 'android', { dataDate: Date.parse('2026-11-23T06:00:00Z'), now: Date.parse('2026-11-24T05:00:00Z') });
  assert.equal(off.title, 'Работа в офлайн-режиме · данные от 23 ноября');
  assert.match(off.text, /сохранённых данных/);
  assert.equal(off.secondary, '');
  assert.equal(copyFor('offline', 'android').title, 'Работа в офлайн-режиме');
  const on = copyFor('online', 'android');
  assert.equal(on.title, 'Сеть есть');
  assert.equal(on.primary, 'Обновить');
  const src = read('js/pwa.js');
  assert.doesNotMatch(src, /title: 'Нет сети'/);
  assert.match(src, /GLYPHS\.refresh : GLYPHS\.saved/);
});

test('тексты о сбоях в live-data.js и data-loader.js — без «проверьте интернет» и «Данные не загрузились»', () => {
  const live = read('js/live-data.js'), dl = read('js/data-loader.js');
  assert.doesNotMatch(live, /say\('Не удалось обновить/);
  assert.doesNotMatch(dl, /toast\('Данные не загрузились/);
  assert.doesNotMatch(dl, /toast\('Часть данных — из кэша браузера'\)/);
  assert.match(dl, /networkNotice\(offline \? 'offline' : 'stale', dataDateOf\(out\)\)/);
  assert.match(live, /networkNotice\(browserOffline\(\) \? 'offline' : 'stale', shownDate\)/);
});
