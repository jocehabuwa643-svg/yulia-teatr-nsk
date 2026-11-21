/* data-loader.js — загрузка data/*.json с кэшем, версией и graceful fallback.
   Никаких расчётов: только доставка данных и флаги свежести. */
import { store, toast } from './ui/helpers.js';

const FILES = ['rates', 'config', 'regions', 'competitors', 'market', 'meta', 'guide', 'seasonality', 'news', 'leads'];
/* Необязательные файлы (дайджест «Сегодня», новости, «потенциальные клиенты» leads.json): их отсутствие не повод для тоста «данные не загрузились» —
   блоки, которым они нужны, просто не показываются. Ошибка всё равно попадает в health.optional для отладки */
const OPTIONAL = new Set(['seasonality', 'news', 'leads']);
const DATA_VERSION = 2;
const cacheKey = n => `data.v${DATA_VERSION}.${n}`;

/* Обычная загрузка — cache:'no-cache' (браузер сверяет файл с сервером по ETag, свежие данные приходят сразу после деплоя).
   fresh:true (кнопка «Обновить данные») — уникальный ?t=… и cache:'reload': запрос гарантированно идёт в сеть мимо
   HTTP-кэша (контракт с sw.js: data/*.json — всегда сначала сеть; сохранённая копия — только без сети, с заголовком
   X-SW-Fallback), а ответ заодно обновляет HTTP-кэш, так что перезагрузка страницы покажет уже новые файлы */
async function fetchOne(name, fresh = false) {
  const url = `data/${name}.json` + (fresh ? `?t=${Date.now()}` : '');
  // Офлайн-версия (один HTML-файл): данные вшиты в страницу сборкой scripts/build.mjs — сеть и fetch не нужны
  const embedded = typeof window !== 'undefined' && window.__YULIA_DATA__ && window.__YULIA_DATA__[name];
  if (embedded) return { data: embedded, fromCache: false, error: null };
  try {
    const r = await fetch(url, { cache: fresh ? 'reload' : 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    // Service worker без сети отдаёт сохранённую копию с заголовком X-SW-Fallback (sw.js) — это не свежие данные
    const swFallback = !!(r.headers && r.headers.get && r.headers.get('X-SW-Fallback'));
    if (swFallback) return { data: json, fromCache: true, error: 'нет сети — копия из кэша приложения' };
    try { store.set(cacheKey(name), { t: Date.now(), d: json }); } catch (e) { /* квота — не критично */ }
    return { data: json, fromCache: false, error: null };
  } catch (e) {
    // fallback на последние известные значения из localStorage
    const cached = store.get(cacheKey(name), null);
    if (cached && cached.d) return { data: cached.d, fromCache: true, error: e.message };
    return { data: null, fromCache: false, error: e.message };
  }
}

/* Возвращает { rates, config, regions, competitors, market, meta, guide, seasonality, news, leads, health }.
   { fresh:true } — перечитать всё в обход кэшей и без тостов (сообщение покажет вызывающий, js/live-data.js) */
export async function loadAll({ fresh = false } = {}) {
  const entries = await Promise.all(FILES.map(n => fetchOne(n, fresh)));
  const out = { health: { errors: [], cached: [], optional: [] } };
  FILES.forEach((n, i) => {
    out[n] = entries[i].data;
    if (!entries[i].error) return;
    if (OPTIONAL.has(n)) { out.health.optional.push(n + ': ' + entries[i].error); return; }
    out.health.errors.push(n + ': ' + entries[i].error);
    if (entries[i].fromCache) out.health.cached.push(n);
  });
  if (fresh) return out;
  if (out.health.errors.length && !out.health.cached.length) {
    toast('Данные не загрузились — проверьте соединение');
  } else if (out.health.cached.length) {
    toast('Часть данных — из кэша браузера');
  }
  return out;
}

/* Архив исследования (HTML-фрагмент): вшит в офлайн-версию как window.__YULIA_DATA__.archive_html,
   иначе читается из data/archive.html. Бросает исключение, если недоступен. */
export async function loadArchive() {
  if (typeof window !== 'undefined' && window.__YULIA_DATA__ && window.__YULIA_DATA__.archive_html) return window.__YULIA_DATA__.archive_html;
  const r = await fetch('data/archive.html');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

/* Возраст значения со встроенным провенансом (fetched_at) в днях; Infinity если даты нет */
export function ageDays(value) {
  if (!value || !value.fetched_at) return Infinity;
  const d = new Date(value.fetched_at);
  return isNaN(d) ? Infinity : (Date.now() - d.getTime()) / 864e5;
}

/* Собирает единый config для калькуляторов: JSON → плоская структура формул.
   Реализация — в чистом модуле js/calculators/config.js (годовые ставки rates.json,
   переопределения пользователя, провенанс для бейджей). Здесь только реэкспорт. */
export { buildCalcConfig } from './calculators/config.js';
