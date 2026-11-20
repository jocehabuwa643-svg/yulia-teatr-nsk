/* data-loader.js — загрузка data/*.json с кэшем, версией и graceful fallback.
   Никаких расчётов: только доставка данных и флаги свежести. */
import { store, toast } from './ui/helpers.js';

const FILES = ['rates', 'config', 'regions', 'competitors', 'market', 'meta', 'guide', 'seasonality', 'news'];
/* Необязательные файлы (дайджест «Сегодня», новости): их отсутствие не повод для тоста «данные не загрузились» —
   блоки, которым они нужны, просто не показываются. Ошибка всё равно попадает в health.optional для отладки */
const OPTIONAL = new Set(['seasonality', 'news']);
const DATA_VERSION = 2;
const cacheKey = n => `data.v${DATA_VERSION}.${n}`;

async function fetchOne(name) {
  const url = `data/${name}.json`;
  // Офлайн-версия (один HTML-файл): данные вшиты в страницу сборкой scripts/build.mjs — сеть и fetch не нужны
  const embedded = typeof window !== 'undefined' && window.__YULIA_DATA__ && window.__YULIA_DATA__[name];
  if (embedded) return { data: embedded, fromCache: false, error: null };
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    try { store.set(cacheKey(name), { t: Date.now(), d: json }); } catch (e) { /* квота — не критично */ }
    return { data: json, fromCache: false, error: null };
  } catch (e) {
    // fallback на последние известные значения из localStorage
    const cached = store.get(cacheKey(name), null);
    if (cached && cached.d) return { data: cached.d, fromCache: true, error: e.message };
    return { data: null, fromCache: false, error: e.message };
  }
}

/* Возвращает { rates, config, regions, competitors, market, meta, guide, seasonality, news, health } */
export async function loadAll() {
  const entries = await Promise.all(FILES.map(fetchOne));
  const out = { health: { errors: [], cached: [], optional: [] } };
  FILES.forEach((n, i) => {
    out[n] = entries[i].data;
    if (!entries[i].error) return;
    if (OPTIONAL.has(n)) { out.health.optional.push(n + ': ' + entries[i].error); return; }
    out.health.errors.push(n + ': ' + entries[i].error);
    if (entries[i].fromCache) out.health.cached.push(n);
  });
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
