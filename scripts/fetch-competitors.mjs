#!/usr/bin/env node
/* fetch-competitors.mjs — недельная проверка публичных страниц конкурентов (data/competitors.json).

   Для каждой записи с публичной страницей-источником: проверяет robots.txt (запрещено — пропуск со статусом),
   скачивает страницу (таймаут 10 с, повторы), фиксирует: доступна ли, изменился ли видимый текст (устойчивый хеш),
   и ТОЛЬКО если на странице явно и однозначно найден ценник рядом со словами «билет / спектакль / программа / стоимость…» —
   записывает его как наблюдение observed.price (confidence:'low', авто-извлечение) с ТИПОМ цены kind
   (билет / выезд за ребёнка / пакет праздника / час аренды / абонемент — по ближайшему ключевому слову, js/competitor-prices.js);
   интерфейс сравнивает наблюдение только с ценами карточки того же типа. Ручное значение prices[] НЕ трогается:
   на сайте показывается «на сайте указано … (проверено …)» рядом с ним, при расхождении — пометка.

   Не делает: обход защиты, капчи, авторизацию, сбор с 2ГИС / VK / Яндекс / Zoon (их условия запрещают автоматический сбор —
   такие записи получают check_status:'skipped_policy'). Пауза 2.5 с между запросами к одному хосту, один User-Agent проекта.
   В записи добавляются только новые поля: checked_at, check_status, observed. Существующая схема и ручные цены не меняются.

   Чистые функции (htmlToText, hashText, extractPrice, diffObserved, isDeniedHost, buildCheck, checkItem) экспортируются для тестов.
   Запуск: node scripts/fetch-competitors.mjs (DATA_DIR=… — сухой прогон на копии данных). */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { kindFromText } from '../js/competitor-prices.js';
import { DATA_DIR, PROJECT_UA, fetchRetry, readJson, writeJsonIfChanged, detectIndent, wait, robotsAllowsPath, ageInDays } from './fetch-util.mjs';

/* ---------- Настройки ---------- */
const HOST_PAUSE_MS = 2500;            // пауза между запросами к одному хосту (2–3 с)
const MAX_HTML_CHARS = 2_000_000;      // страницу крупнее не разбираем целиком
const LISTS = ['outbound_performers', 'studio_scene', 'party_venues', 'stationary_benchmarks'];
/* Окно «тот же прогон»: повтор в течение 20 ч не меняет метки времени, если страница не изменилась */
export const SAME_RUN_DAYS = 20 / 24;

/* Площадки, чьи условия использования запрещают автоматический сбор: не запрашиваем вообще */
export const DENY_HOSTS = ['2gis.ru', 'vk.ru', 'vk.com', 'ok.ru', 'yandex.ru', 'yandex.com', 'ya.ru', 'zoon.ru', 'instagram.com', 't.me', 'youtube.com', 'facebook.com'];

/* Допустимый диапазон ценника (₽): отсекает мусор вроде «5 р.» и номера счетов */
const PRICE_MIN = 50, PRICE_MAX = 300_000;
/* Слова рядом с числом, без которых цифра с «₽» не считается ценой услуги (пакеты и тарифы праздников — тоже цена,
   чтобы прайс площадки с несколькими пакетами честно признавался «неоднозначным», а не молча пропускался) */
const PRICE_CONTEXT = /(билет|спектакл|программ|стоимост|цен[аыуе]\b|вход|сеанс|шоу|занят|выезд|с человека|с ребёнка|с ребенка|за ребёнка|за ребенка|с участника|абонемент|аренд|пакет|тариф|праздник|день рожд)/i;
/* Слова перед числом, после которых это точно не цена услуги (реквизиты, капитал и т.п.) */
const PRICE_BLOCK = /(инн|огрн|кпп|бик|р\/с|расч[её]тн|уставн|капитал|выручк|оборот|штраф|тел\.?|телефон|факс)\s*[:№#]?\s*$/i;

/* ---------- Текст и хеш ---------- */

const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…', rub: '₽', thinsp: ' ' };

/* HTML → видимый текст: убираем скрипты, стили, навигацию/подвал и разметку, раскрываем сущности, схлопываем пробелы */
export function htmlToText(html) {
  let s = String(html || '').slice(0, MAX_HTML_CHARS);
  s = s.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|head|nav|footer|iframe|select|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br|ul|ol|table|td)\s*>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
    }
    return ENT[e.toLowerCase()] ?? ' ';
  });
  return s.normalize('NFKC').replace(/[   ]/g, ' ').replace(/[ \t\r\f\v]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n').trim();
}

/* Устойчивый хеш текста: регистр, ё/е и любые пробелы/переводы строк не влияют — только слова и цифры */
export function hashText(text) {
  const norm = String(text || '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(norm).digest('hex').slice(0, 16);
}

/* ---------- Извлечение цены ---------- */

/* Число с необязательными пробелами-разделителями тысяч + валюта (₽ / руб. / рублей / р.) */
const PRICE_RE = /(?<![\d\-–—+(.,/])(?:(от|до)\s+)?(\d{1,3}(?:[ ]\d{3})+|\d{2,6})(?:[.,]\d{1,2})?\s*(?:₽|(?:руб(?:лей|ля|\.)?|р\.|р)(?![а-яёa-z0-9]))/giu;
/* Диапазон «300–500 ₽» и «от 300 до 500 ₽» — цена неоднозначна */
const RANGE_RE = /\d[\d ]*\s*[-–—]\s*\d[\d ]*\s*(?:₽|руб|р\.)|от\s+\d[\d ]*\s+до\s+\d[\d ]*\s*(?:₽|руб|р\.)/giu;

/* Ищет цену рядом с ключевыми словами. Возвращает:
   { value, unit:'₽', qualifier:'от'|'до'|null, snippet } — найдена одна однозначная цена;
   { value:null, reason:'not_found' } — ценника нет;
   { value:null, reason:'ambiguous', values:[…] } — несколько разных цен или диапазон: не угадываем. */
export function extractPrice(text) {
  const t = String(text || '').normalize('NFKC').replace(/[   ]/g, ' ').replace(/\s+/g, ' ');
  const found = [];
  for (const m of t.matchAll(PRICE_RE)) {
    const value = Number(m[2].replace(/ /g, ''));
    if (!Number.isFinite(value) || value < PRICE_MIN || value > PRICE_MAX) continue;
    const start = m.index, end = m.index + m[0].length;
    if (PRICE_BLOCK.test(t.slice(Math.max(0, start - 24), start))) continue;
    const win = t.slice(Math.max(0, start - 80), Math.min(t.length, end + 60));
    if (!PRICE_CONTEXT.test(win)) continue;
    // тип цены (билет / выезд за ребёнка / пакет / час / абонемент) — по ближайшему к числу ключевому слову
    const winStart = Math.max(0, start - 80);
    found.push({ value, qualifier: m[1] ? m[1].toLowerCase() : null, snippet: win.trim(), at: start, kind: kindFromText(win, start - winStart) });
  }
  // диапазон рядом с ключевыми словами делает цену неоднозначной
  for (const m of t.matchAll(RANGE_RE)) {
    const win = t.slice(Math.max(0, m.index - 80), Math.min(t.length, m.index + m[0].length + 60));
    if (PRICE_CONTEXT.test(win)) return { value: null, reason: 'ambiguous', values: [...new Set(found.map(f => f.value))] };
  }
  if (!found.length) return { value: null, reason: 'not_found' };
  const distinct = [...new Set(found.map(f => f.value))];
  if (distinct.length > 1) return { value: null, reason: 'ambiguous', values: distinct.slice(0, 8) };
  const f = found[0];
  // одна цена, но слова рядом указывают на разные типы (например, «билет» и «час аренды») — тип не угадываем
  const kinds = [...new Set(found.map(x => x.kind))];
  return { value: f.value, unit: '₽', qualifier: f.qualifier, kind: kinds.length === 1 ? kinds[0] : 'other', snippet: f.snippet.slice(0, 160) };
}

/* ---------- Сравнение наблюдений ---------- */

/* Что изменилось между прошлым и новым observed: контент, цена (появилась / исчезла / другая) */
export function diffObserved(prev, next) {
  const p = prev || {}, n = next || {};
  const pp = p.price && Number.isFinite(p.price.value) ? p.price : null;
  const np = n.price && Number.isFinite(n.price.value) ? n.price : null;
  return {
    contentChanged: !!p.content_hash && !!n.content_hash && p.content_hash !== n.content_hash,
    priceAppeared: !pp && !!np,
    priceRemoved: !!pp && !np,
    priceChanged: !!pp && !!np && (pp.value !== np.value || (pp.qualifier || null) !== (np.qualifier || null))
  };
}

/* ---------- Политика и сеть ---------- */

export const isDeniedHost = host => { const h = String(host || '').toLowerCase().replace(/^www\./, ''); return DENY_HOSTS.some(d => h === d || h.endsWith('.' + d)); };

const robotsCache = new Map();
const lastHit = new Map();

/* Пауза перед обращением к хосту: не чаще одного запроса в HOST_PAUSE_MS */
async function politeWait(host) {
  const gap = (lastHit.get(host) || 0) + HOST_PAUSE_MS - Date.now();
  if (gap > 0) await wait(gap);
  lastHit.set(host, Date.now());
}

/* robots.txt хоста (кэш на прогон). 4xx — ограничений нет; сеть/5xx — {ok:false}: страницу не запрашиваем */
async function loadRobots(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  const host = new URL(origin).host;
  let res;
  try {
    await politeWait(host);
    const r = await fetchRetry(`${origin}/robots.txt`, { headers: { 'User-Agent': PROJECT_UA } }, { retries: 1, label: `${host}/robots.txt` });
    res = { ok: true, text: await r.text() };
  } catch (e) {
    const m = /HTTP (\d{3})/.exec(e.message);
    res = m && +m[1] >= 400 && +m[1] < 500 ? { ok: true, text: '' } : { ok: false, error: e.message };
  }
  robotsCache.set(origin, res);
  return res;
}

async function loadPage(url) {
  const host = new URL(url).host;
  await politeWait(host);
  const r = await fetchRetry(url, { headers: { 'User-Agent': PROJECT_UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'Accept-Language': 'ru' } }, { retries: 2, label: host });
  const type = r.headers.get('content-type') || '';
  if (type && !/html|xml|text\/plain/i.test(type)) throw new Error(`не HTML (${type.split(';')[0]})`);
  return { status: r.status, html: await r.text() };
}

/* ---------- Проверка одной записи ---------- */

/* Собирает check-результат: {check_status, observed} по прошлому observed и полученному тексту */
export function buildCheck(prevObserved, url, status, html, nowIso) {
  const text = htmlToText(html);
  const hash = hashText(text);
  const pr = extractPrice(text);
  const prev = prevObserved || {};
  const observed = {
    url, http_status: status, content_hash: hash, text_length: text.length,
    hash_at: prev.content_hash === hash ? (prev.hash_at || nowIso) : nowIso,
    last_ok_at: nowIso,
    price: pr.value ? { value: pr.value, unit: pr.unit, qualifier: pr.qualifier, kind: pr.kind || 'other', snippet: pr.snippet, source_url: url, fetched_at: nowIso, confidence: 'low', method: 'auto-regex' } : null
  };
  if (!pr.value && pr.reason === 'ambiguous') observed.price_note = 'на странице несколько цен или диапазон — автоматически не определено';
  const d = diffObserved(prev, observed);
  if (d.contentChanged) observed.changed_at = nowIso; else if (prev.changed_at) observed.changed_at = prev.changed_at;
  /* prev_price фиксируется только в неделю, когда цена на сайте поменялась; дальше расхождение видно по сравнению с ценой карточки */
  if (d.priceChanged && prev.price) observed.prev_price = { value: prev.price.value, qualifier: prev.price.qualifier || null, fetched_at: prev.price.fetched_at };
  return { check_status: d.contentChanged ? 'changed' : 'ok', observed };
}

/* Проверка записи с внедряемыми зависимостями (для тестов без сети). Не бросает исключений */
export async function checkItem(item, nowIso, deps = {}) {
  const getRobots = deps.getRobots || loadRobots;
  const getPage = deps.getPage || loadPage;
  const url = item.source_url;
  let u;
  try { u = new URL(url); } catch { return { checked_at: nowIso, check_status: 'skipped', observed: item.observed }; }
  if (!/^https?:$/.test(u.protocol)) return { checked_at: nowIso, check_status: 'skipped', observed: item.observed };
  if (isDeniedHost(u.hostname)) return { checked_at: nowIso, check_status: 'skipped_policy', observed: item.observed };
  const robots = await getRobots(u.origin);
  if (!robots.ok) return { checked_at: nowIso, check_status: 'unavailable', observed: { ...(item.observed || {}), error: `robots.txt недоступен: ${robots.error}`.slice(0, 160) } };
  if (!robotsAllowsPath(robots.text, u.pathname + u.search)) return { checked_at: nowIso, check_status: 'robots_disallowed', observed: item.observed };
  try {
    const page = await getPage(url);
    const r = buildCheck(item.observed, url, page.status, page.html, nowIso);
    return { checked_at: nowIso, ...r };
  } catch (e) {
    // сбой страницы: прежние наблюдения (хеш, цена) сохраняются, меняется только статус
    return { checked_at: nowIso, check_status: 'unavailable', observed: { ...(item.observed || {}), error: String(e.message).slice(0, 160) } };
  }
}

/* ---------- Запуск ---------- */

/* dataDir и deps — для тестов: прогон на копии данных без сети */
export async function run({ now = new Date(), dataDir = DATA_DIR, deps = {} } = {}) {
  const file = join(dataDir, 'competitors.json');
  const doc = readJson(file);
  const nowIso = now.toISOString();
  const tally = {};
  for (const key of LISTS) {
    for (const item of doc[key] || []) {
      if (!item || !item.source_url) continue;
      const prevChecked = item.checked_at, prevStatus = item.check_status, prevObs = item.observed;
      const res = await checkItem(item, nowIso, deps);
      /* идемпотентность только для повторного запуска в тот же день (ручной перезапуск workflow, < 20 ч):
         если по существу ничего не изменилось, метки времени не трогаем — без пустых коммитов.
         Плановый недельный прогон всегда продвигает checked_at и last_ok_at: иначе дата «автопроверка …» в интерфейсе
         замирала бы, а аудит свежести (порог 14 дн.) мог бы выдать ложное «проверка не выполнялась». */
      if (prevChecked && prevStatus === res.check_status && ageInDays(prevChecked, now.getTime()) < SAME_RUN_DAYS) {
        const strip = o => JSON.stringify(o ? { ...o, last_ok_at: 0, price: o.price ? { ...o.price, fetched_at: 0 } : o.price } : null);
        if (strip(prevObs) === strip(res.observed)) { res.checked_at = prevChecked; res.observed = prevObs; }
      }
      item.checked_at = res.checked_at;
      item.check_status = res.check_status;
      if (res.observed) item.observed = res.observed; else delete item.observed;
      tally[res.check_status] = (tally[res.check_status] || 0) + 1;
      const px = res.observed && res.observed.price ? ` · цена на сайте ${res.observed.price.qualifier || ''} ${res.observed.price.value} ₽ (${res.observed.price.kind})` : '';
      console.log(`[competitors] ${item.id}: ${res.check_status}${px}`);
    }
  }
  const changed = writeJsonIfChanged(file, doc, detectIndent(file));
  console.log(`[competitors] ${changed ? 'записан' : 'без изменений'}; итог:`, JSON.stringify(tally));
  return doc;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error('[competitors] критическая ошибка:', e); process.exit(1); });
}
