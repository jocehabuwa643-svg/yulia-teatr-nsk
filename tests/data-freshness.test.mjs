/* data-freshness.test.mjs — аудит свежести данных (scripts/data-freshness.mjs), отметки лент новостей (last_ok_at,
   sources_failed), «отпечаток» кнопки «Обновить данные» (js/live-data.js) и расписания workflow обновления. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { auditFreshness, lastDateInText, limitsFrom, readDataDir } from '../scripts/data-freshness.mjs';
import { buildDoc, sourceLastOk, essence } from '../scripts/fetch-news.mjs';
import { dataSignature, signatureChanges, lastCheckedAt } from '../js/live-data.js';

const DAY = 864e5;
const NOW = Date.parse('2026-11-21T12:00:00Z');
const iso = t => new Date(t).toISOString();
const has = (list, file, re) => list.some(f => f.file === file && re.test(f.message));

/* ---------- Аудит свежести ---------- */

test('limitsFrom: пороги из meta.refresh_policy и rates.thresholds_days, иначе значения по умолчанию', () => {
  const L = limitsFrom({ meta: { refresh_policy: { stale_after_days: { leads: 9 } } }, rates: { thresholds_days: { rates: 5 } } });
  assert.equal(L.leads, 9);
  assert.equal(L.rates, 5);
  assert.equal(L.news, 14);
  assert.equal(limitsFrom({}).competitors_check, 14);
});

test('lastDateInText: последняя дата ДД.ММ.ГГГГ из окна гранта', () => {
  assert.equal(lastDateInText('27.10–07.12.2026 (дедлайн 7 декабря)'), Date.UTC(2026, 11, 7, 23, 59, 59));
  assert.equal(lastDateInText('Объявления не получены'), null);
  assert.equal(lastDateInText(null), null);
});

test('auditFreshness: свежие данные — замечаний нет', () => {
  const data = {
    rates: { cbr: { usd_rub: { value: 82, fetched_at: '2026-11-21' }, eur_rub: { value: 90, fetched_at: '2026-11-20' } }, tax: {} },
    news: { updated_at: iso(NOW - DAY), stale: false, sources: [{ name: 'A', status: 'ok', last_ok_at: iso(NOW) }] },
    leads: { updated_at: iso(NOW - 3 * DAY), stale: false },
    competitors: { outbound_performers: [{ check_status: 'ok', checked_at: iso(NOW - 2 * DAY), prices: [{ value: 300, fetched_at: '2026-11-18' }] }] },
    market: { grants: { fetched_at: '2026-11-18', programs: [{ name: 'ПФКИ', status: 'open', window: '27.10–07.12.2026' }] } },
    seasonality: { school_holidays: { 2026: { loaded: true, items: [{ name: 'Осенние' }] } } }
  };
  // 21.11 до конца года 41 день — без 2027 будет напоминание о каникулах; добавим 2027, чтобы аудит был чистым
  data.seasonality.school_holidays[2027] = { loaded: true, items: [{ name: 'Зимние' }] };
  assert.deepEqual(auditFreshness(data, NOW), []);
});

test('auditFreshness: устаревшие курсы, молчащая лента, старые клиенты, закрытый «открытый» грант, каникулы', () => {
  const data = {
    rates: {
      cbr: { usd_rub: { value: 82, fetched_at: '2026-11-01' }, eur_rub: { value: 90, fetched_at: '2026-11-21', stale: true, stale_since: '2026-11-20T03:00:00Z' } },
      tax: { mrot: { years: { 2025: { value: 1 } } } }
    },
    news: { updated_at: iso(NOW), stale: false, sources: [{ name: 'Минкультуры НСО', status: 'error', error: 'HTTP 502', last_ok_at: iso(NOW - 9 * DAY) }, { name: 'ФНС', status: 'error', error: 'таймаут' }] },
    leads: { updated_at: iso(NOW - 12 * DAY), stale: false },
    competitors: { studio_scene: [{ check_status: 'ok', checked_at: iso(NOW - 20 * DAY), prices: [{ value: 500, fetched_at: '2026-09-01' }] }] },
    market: { grants: { fetched_at: '2026-10-01', programs: [{ name: 'Старый', status: 'open', window: 'до 01.11.2026' }] } },
    seasonality: { school_holidays: {} }
  };
  const f = auditFreshness(data, NOW);
  assert.ok(has(f, 'rates.json', /USD не обновлялся 20 дн/));
  assert.ok(has(f, 'rates.json', /EUR не обновился: ЦБ не ответил с 2026-11-20/));
  assert.ok(has(f, 'rates.json', /tax\.mrot: нет значения на 2026/));
  assert.ok(has(f, 'news.json', /«Минкультуры НСО» не отвечает 9 дн/));
  assert.ok(has(f, 'news.json', /«ФНС» не отвечает с первого запуска/));
  assert.ok(has(f, 'leads.json', /не обновлялись 12 дн/));
  assert.ok(has(f, 'competitors.json', /Автопроверка сайтов конкурентов не выполнялась/));
  assert.ok(f.some(x => x.file === 'competitors.json' && x.level === 'notice' && /Цены конкурентов старше 30/.test(x.message)));
  assert.ok(has(f, 'market.json', /Окна грантов сверялись 51 дн/));
  assert.ok(has(f, 'market.json', /«Старый»: приём закрылся/));
  assert.ok(has(f, 'seasonality.json', /на 2026 и 2027 не загружен/));
});

test('auditFreshness: в декабре — напоминание о значениях следующего года; без данных — пусто', () => {
  const dec = Date.parse('2026-12-05T00:00:00Z');
  const data = { rates: { tax: { mrot: { years: { 2026: { value: 1, valid_to: '2026-12-31' }, 2027: { status: 'no_data', value: null } } } } } };
  const f = auditFreshness(data, dec);
  assert.ok(f.some(x => x.level === 'notice' && /на 2027 год значение не внесено/.test(x.message)));
  assert.deepEqual(auditFreshness(null, NOW), []);
});

test('auditFreshness по реальным data/*.json: файлы читаются, находки — массив с понятными полями', () => {
  const data = readDataDir(fileURLToPath(new URL('../data/', import.meta.url)));
  for (const name of ['rates', 'meta', 'news', 'leads', 'competitors', 'market', 'seasonality']) assert.ok(data[name], name);
  const found = auditFreshness(data, NOW);
  assert.ok(Array.isArray(found));
  for (const x of found) {
    assert.match(x.file, /\.json$/);
    assert.ok(['warning', 'notice'].includes(x.level));
    assert.ok(x.message.length > 10);
  }
});

/* ---------- Новости: когда лента последний раз отвечала ---------- */

const st = (status, feed = 'f1', extra = {}) => ({ status: { name: 'Лента', url: 'u', feed_url: feed, fetched_at: iso(NOW), status, items: 0, ...extra }, items: [] });

test('fetch-news: last_ok_at — сейчас при успехе, прежний при сбое; sources_failed считает молчащие ленты', () => {
  const prev = { updated_at: iso(NOW - DAY), stale: false, items: [], sources: [
    { feed_url: 'f1', status: 'ok', fetched_at: iso(NOW - DAY), last_ok_at: iso(NOW - DAY) },
    { feed_url: 'f2', status: 'empty', fetched_at: iso(NOW - 2 * DAY) } // старый формат без last_ok_at
  ] };
  const d = buildDoc([st('error', 'f1'), st('error', 'f2'), st('ok', 'f3')], prev, NOW);
  assert.equal(d.stale, false);
  assert.equal(d.sources_total, 3);
  assert.equal(d.sources_failed, 2);
  assert.equal(d.sources[0].last_ok_at, iso(NOW - DAY));
  assert.equal(d.sources[1].last_ok_at, iso(NOW - 2 * DAY), 'у старого формата берётся fetched_at успешного прогона');
  assert.equal(d.sources[2].last_ok_at, iso(NOW));
  assert.equal(sourceLastOk({ status: 'error', feed_url: 'x' }, [], iso(NOW)), null);
  assert.equal(sourceLastOk({ status: 'error', feed_url: 'f' }, [{ feed_url: 'f', status: 'error', fetched_at: iso(NOW) }], iso(NOW)), null);
});

test('fetch-news: сдвиг last_ok_at и fetched_at не считается изменением по существу (нет пустых коммитов)', () => {
  const a = buildDoc([st('ok')], null, NOW);
  const b = buildDoc([st('ok')], a, NOW + DAY);
  assert.notEqual(a.sources[0].last_ok_at, b.sources[0].last_ok_at);
  assert.equal(essence(a), essence(b));
  const c = buildDoc([st('error')], b, NOW + 2 * DAY);
  assert.notEqual(essence(b), essence(c), 'сбой ленты — изменение по существу');
});

/* ---------- Кнопка «Обновить данные»: отпечаток свежести ---------- */

test('dataSignature / signatureChanges: называет, какие блоки пришли новыми', () => {
  const base = {
    meta: { generated_at: '2026-11-21T11:00:53Z' },
    rates: { cbr: { usd_rub: { value: 82.19, valid_from: '2026-11-21' }, eur_rub: { value: 90.34, valid_from: '2026-11-21' } } },
    news: { updated_at: '2026-11-21T11:00:21Z', items: [1, 2] },
    leads: { updated_at: '2026-11-21T03:22:01Z' },
    competitors: { outbound_performers: [{ checked_at: '2026-11-21T03:22:02Z' }], studio_scene: [{ checked_at: '2026-11-21T04:02:48Z' }] }
  };
  const s1 = dataSignature(base);
  assert.equal(s1.competitors, '2026-11-21T04:02:48Z');
  assert.deepEqual(signatureChanges(s1, dataSignature(base)), []);

  const next = structuredClone(base);
  next.meta.generated_at = '2026-11-22T11:00:00Z';
  next.rates.cbr.usd_rub = { value: 81.5, valid_from: '2026-11-22' };
  next.news.items.push(3);
  assert.deepEqual(signatureChanges(s1, dataSignature(next)), ['курсы ЦБ', 'новости']);

  const onlyRelease = structuredClone(base);
  onlyRelease.meta.generated_at = '2026-11-23T00:00:00Z';
  assert.deepEqual(signatureChanges(s1, dataSignature(onlyRelease)), ['справочные данные']);
  // пустые данные (страница ещё не загрузилась) — без исключений
  assert.ok(dataSignature(null));
});

test('lastCheckedAt: берёт более позднюю из checked_at и generated_at', () => {
  assert.equal(lastCheckedAt({ meta: { generated_at: '2026-11-20T00:00:00Z', checked_at: '2026-11-22T00:00:00Z' } }), '2026-11-22T00:00:00.000Z');
  assert.equal(lastCheckedAt({ meta: { generated_at: '2026-11-20T00:00:00Z' } }), '2026-11-20T00:00:00.000Z');
  assert.equal(lastCheckedAt({}), null);
});

test('data-loader: «Обновить данные» читает файлы мимо кэша (?t= и cache:reload), обычная загрузка — no-cache', () => {
  const src = readFileSync(new URL('../js/data-loader.js', import.meta.url), 'utf-8');
  assert.match(src, /\?t=\$\{Date\.now\(\)\}/);
  assert.match(src, /cache: fresh \? 'reload' : 'no-cache'/);
  assert.match(src, /export async function loadAll\(\{ fresh = false \} = \{\}\)/);
  // копия из кэша service worker без сети не выдаётся за свежие данные
  assert.match(src, /X-SW-Fallback/);
  const live = readFileSync(new URL('../js/live-data.js', import.meta.url), 'utf-8');
  assert.match(live, /loadAll\(\{ fresh: true \}\)/);
  assert.doesNotMatch(live, /cbr\.ru\/scripts/, 'прямой запрос к ЦБ из браузера убран (CORS)');
});

/* ---------- Расписания workflow ---------- */

const wf = name => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf-8');

test('data-refresh.yml: ежедневно (два запуска), ручной запуск, права на коммит и запуск деплоя', () => {
  const y = wf('data-refresh.yml');
  assert.match(y, /cron: '17 3 \* \* \*'/);
  assert.match(y, /cron: '47 15 \* \* \*'/);
  assert.match(y, /workflow_dispatch:/);
  assert.match(y, /contents: write/);
  assert.match(y, /actions: write/);
  assert.match(y, /node scripts\/fetch-cbr\.mjs/);
  assert.match(y, /node scripts\/fetch-news\.mjs/);
  assert.match(y, /touch-meta\.mjs --stamp/);
  assert.match(y, /touch-meta\.mjs --heartbeat/);
  // пуш от GITHUB_TOKEN не запускает другие workflow — деплой вызывается явно
  assert.match(y, /gh workflow run deploy\.yml/);
  assert.doesNotMatch(y, /\t/, 'в YAML нет табов');
});

test('weekly-refresh.yml: раз в неделю, клиенты и конкуренты, права и явный запуск деплоя', () => {
  const y = wf('weekly-refresh.yml');
  assert.match(y, /cron: '30 2 \* \* 1'/);
  assert.match(y, /workflow_dispatch:/);
  assert.match(y, /contents: write/);
  assert.match(y, /actions: write/);
  assert.match(y, /node scripts\/fetch-leads\.mjs/);
  assert.match(y, /node scripts\/fetch-competitors\.mjs/);
  assert.match(y, /gh workflow run deploy\.yml/);
  assert.doesNotMatch(y, /\t/);
});

test('meta.json: пороги устаревания на месте для всех автообновляемых блоков', () => {
  const meta = JSON.parse(readFileSync(new URL('../data/meta.json', import.meta.url), 'utf-8'));
  const s = meta.refresh_policy.stale_after_days;
  for (const k of ['rates', 'prices', 'grants', 'news', 'leads', 'competitors_check']) assert.ok(Number.isFinite(s[k]) && s[k] > 0, k);
});
