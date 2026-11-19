#!/usr/bin/env node
/* fetch-wordstat.mjs — адаптер спроса Яндекс Wordstat → data/market.json (блок demand).
   Работает ТОЛЬКО если задан секрет WORDSTAT_TOKEN. Без токена честно выходит, ничего не меняя:
   график не подделывается. Токен нигде не печатается.

   Окружение:
     WORDSTAT_TOKEN       — ключ API (секрет GitHub; обязателен);
     WORDSTAT_FOLDER_ID   — идентификатор каталога Yandex Cloud (не секрет; переменная репозитория);
     WORDSTAT_API_URL     — база API, по умолчанию Yandex Cloud Search API (v2/wordstat);
     WORDSTAT_AUTH_SCHEME — схема заголовка Authorization, по умолчанию «Api-Key»;
     WORDSTAT_REGION      — id региона Wordstat (по умолчанию 65 — Новосибирская область);
     DATA_DIR             — каталог данных (сухой прогон).
   Формат запроса (метод topRequests: phrase, regions, folderId) взят из публичного разбора API —
   официальная страница Яндекса отсылает к Yandex Search API. Поэтому ответ проверяется на форму,
   а при любом расхождении данные не затираются: блок помечается stale с причиной. */
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, fetchRetry, readJson, writeJsonIfChanged, markStale, clearStale } from './fetch-util.mjs';

const MARKET = join(DATA_DIR, 'market.json');
const API = (process.env.WORDSTAT_API_URL || 'https://searchapi.api.cloud.yandex.net/v2/wordstat').replace(/\/+$/, '');
const SCHEME = process.env.WORDSTAT_AUTH_SCHEME || 'Api-Key';
const REGION = process.env.WORDSTAT_REGION || '65';

/* Один запрос topRequests: возвращает число запросов за 30 дней по фразе */
async function topRequests(phrase, token, folderId) {
  const res = await fetchRetry(`${API}/topRequests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `${SCHEME} ${token}` },
    body: JSON.stringify({ phrase, numPhrases: 1, regions: [REGION], folderId })
  }, { label: `Wordstat «${phrase}»` });
  const json = await res.json();
  const total = Number(json && json.totalCount);
  if (!Number.isFinite(total) || total < 0) throw new Error(`Wordstat «${phrase}»: в ответе нет totalCount`);
  return total;
}

async function main() {
  const token = process.env.WORDSTAT_TOKEN;
  if (!token) {
    console.log('WORDSTAT_TOKEN не задан — спрос не обновляется (раздел «Спрос» остаётся «подключите источник»).');
    return;
  }
  const folderId = process.env.WORDSTAT_FOLDER_ID;
  const market = readJson(MARKET);
  const d = market.demand;
  if (!d || !Array.isArray(d.queries)) throw new Error('в market.json нет demand.queries');
  // Список фраз хранится строками; после успешного прогона результаты лежат отдельно в demand.results
  const phrases = d.queries.map(q => (typeof q === 'string' ? q : q && q.q)).filter(Boolean);
  const nowIso = new Date().toISOString();

  try {
    if (!folderId) throw new Error('не задана переменная WORDSTAT_FOLDER_ID');
    const results = [];
    for (const q of phrases) results.push({ q, shows_30d: await topRequests(q, token, folderId) });
    Object.assign(d, {
      status: 'ok',
      results,
      region: REGION,
      source_name: 'Яндекс Wordstat (topRequests, 30 дней)',
      source_url: 'https://wordstat.yandex.ru/',
      fetched_at: nowIso.slice(0, 10),
      confidence: 'medium',
      queries: phrases,
      note: 'Число запросов за 30 дней по региону; источник — Wordstat API. Обновляется scripts/fetch-wordstat.mjs.'
    });
    clearStale(d);
    console.log(`Wordstat: обновлено фраз — ${results.length}`);
  } catch (e) {
    // Сбой: прежние данные остаются. Пометка stale ставится только если данные уже были (status ok);
    // пока источник не подключён, блок остаётся «подключите источник» без лишних полей
    console.error('Wordstat не обновлён:', e.message);
    if (d.status === 'ok') markStale(d, e.message, nowIso);
  }
  console.log(writeJsonIfChanged(MARKET, market) ? 'market.json обновлён' : 'market.json без изменений');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('fetch-wordstat: непредвиденная ошибка:', e.message); process.exit(1); });
}
