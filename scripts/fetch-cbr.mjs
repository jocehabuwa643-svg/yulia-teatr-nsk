#!/usr/bin/env node
/* fetch-cbr.mjs — обновляет курсы USD/EUR в data/rates.json (блок cbr) из публичного XML Банка России
   (XML_daily.asp, без ключей). Таймаут 10 с, ретраи с бэкоффом (fetch-util.mjs).
   При сбое источника прежние значения НЕ затираются: в блоке выставляются stale:true и stale_since.
   fetched_at меняется только при новом курсе, новой дате ЦБ или снятии stale.
   Процесс всегда завершается кодом 0 — сбой источника не роняет workflow, сайт продолжает работать.
   Переменные: DATA_DIR — каталог данных (для сухого прогона), CBR_URL — подмена адреса (тесты). */
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, fetchRetry, readJson, writeJsonIfChanged, markStale, clearStale } from './fetch-util.mjs';

const RATES = join(DATA_DIR, 'rates.json');
const URL_DAILY = process.env.CBR_URL || 'https://www.cbr.ru/scripts/XML_daily.asp';
const CURRENCIES = { usd_rub: 'USD', eur_rub: 'EUR' };

/* Разбор XML: курс за 1 единицу = Value / Nominal; дата — из атрибута Date корневого элемента */
export function parseDaily(xml) {
  const dateM = xml.match(/<ValCurs[^>]*\sDate="(\d{2})\.(\d{2})\.(\d{4})"/);
  if (!dateM) throw new Error('в ответе ЦБ нет даты (ValCurs/@Date)');
  const validFrom = `${dateM[3]}-${dateM[2]}-${dateM[1]}`;
  const out = {};
  for (const blockXml of xml.split('<Valute ').slice(1)) {
    const code = (blockXml.match(/<CharCode>([A-Z]{3})<\/CharCode>/) || [])[1];
    const nominal = parseInt((blockXml.match(/<Nominal>(\d+)<\/Nominal>/) || [])[1], 10);
    const value = parseFloat(((blockXml.match(/<Value>([\d\s,.]+)<\/Value>/) || [])[1] || '').replace(/\s/g, '').replace(',', '.'));
    if (code && nominal > 0 && Number.isFinite(value) && value > 0) out[code] = Math.round((value / nominal) * 1e6) / 1e6;
  }
  return { validFrom, rates: out };
}

async function main() {
  const rates = readJson(RATES);
  if (!rates.cbr) throw new Error('в rates.json нет блока cbr');
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);

  let parsed = null, failReason = '';
  try {
    const res = await fetchRetry(URL_DAILY, {}, { label: 'ЦБ РФ XML_daily' });
    // Ответ в windows-1251
    parsed = parseDaily(new TextDecoder('windows-1251').decode(Buffer.from(await res.arrayBuffer())));
  } catch (e) {
    failReason = e.message;
    console.error('Источник ЦБ недоступен:', failReason);
  }

  for (const [key, code] of Object.entries(CURRENCIES)) {
    const block = rates.cbr[key];
    if (!block) continue;
    const v = parsed && parsed.rates[code];
    if (v) {
      // Успех. Если курс и дата ЦБ те же и блок не был stale — файл не трогаем (fetched_at не сдвигаем),
      // иначе cron-бот коммитил бы пустышку каждый день
      const same = block.value === v && block.valid_from === parsed.validFrom && !block.stale && block.fetched_at;
      Object.assign(block, {
        value: v, unit: '₽', fetched_at: same ? block.fetched_at : today, valid_from: parsed.validFrom, confidence: 'high',
        source_name: 'Банк России, XML_daily', source_url: 'https://www.cbr.ru/scripts/XML_daily.asp'
      });
      delete block.status;
      // legal_note и note согласуем с источником, который скрипт записал в блок, чтобы прежнее название источника не оставалось
      block.legal_note = `Проверено: ${block.fetched_at} · ${block.source_name} · официальный курс, не налоговая ставка`;
      block.note = 'Обновляется scripts/fetch-cbr.mjs по XML_daily.asp (курс на дату valid_from).';
      clearStale(block);
      console.log(`${code}/RUB = ${v} на ${parsed.validFrom}`);
    } else if (block.value !== null && block.value !== undefined) {
      // Сбой (или валюты нет в ответе): прежнее значение остаётся, помечаем устаревшим
      markStale(block, failReason || `валюта ${code} отсутствует в ответе ЦБ`, nowIso);
      console.log(`${code}: значение сохранено, помечено stale с ${block.stale_since}`);
    } else {
      console.log(`${code}: данных нет и источник не ответил — остаётся «нет данных»`);
    }
  }
  const changed = writeJsonIfChanged(RATES, rates);
  console.log(changed ? 'rates.json обновлён' : 'rates.json без изменений');
}

/* Запуск только как скрипт (импорт parseDaily в тестах не стартует сетевой код).
   Сбой источника — код 0 (обработан выше); непредвиденная локальная ошибка (битый JSON) — код 1 */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('fetch-cbr: непредвиденная ошибка:', e.message); process.exit(1); });
}
