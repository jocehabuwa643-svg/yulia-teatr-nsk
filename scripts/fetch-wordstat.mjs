#!/usr/bin/env node
/* fetch-wordstat.mjs — адаптер спроса из Яндекс Wordstat.
   Работает ТОЛЬКО если в окружении/секретах задан WORDSTAT_TOKEN
   (официальный API Яндекс — см. DATA_SOURCES.md). Без токена честно
   завершается без записи данных: график не подделывается. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const MARKET = 'data/market.json';
const TOKEN = process.env.WORDSTAT_TOKEN;
const QUERIES = ['выездной театр', 'детский театр на праздник', 'день рождения в театре', 'ПДД для детей', 'кукольный театр в сад'];

if (!TOKEN) {
  console.log('WORDSTAT_TOKEN не задан — спрос не обновляется (раздел «Спрос» остаётся «подключите источник»).');
  process.exit(0);
}

/* Схема интеграции (реализовать при получении токена):
   1. OAuth Яндекса → токен с правами на API статистики.
   2. POST https://api.yandex.ru/... (эндпоинт уточнить по актуальной документации API,
      не выдумывать) с keywords=QUERIES, regions=Новосибирская обл. (регион 65).
   3. Ответ нормализуется в { queries: [{q, shows, month}], fetched_at } и пишется
      в market.demand.status='ok' с provenance. */
async function main() {
  const market = JSON.parse(readFileSync(MARKET, 'utf-8'));
  // TODO(интеграция): настоящий запрос к API после получения документации и токена.
  // Пока — заглушка, которая ничего не выдумывает:
  console.log('АдаптерWordstat запущен с токеном, но эндпоинт ещё не подключён — см. DATA_SOURCES.md и HANDOFF.md.');
}
main();
