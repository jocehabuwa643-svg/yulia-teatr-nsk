#!/usr/bin/env node
/* fetch-cbr.mjs — обновляет курсы USD/EUR в data/rates.json из публичных
   XML-эндпоинтов Банка России. При ошибке сети оставляет прежние значения
   и ставит stale:true. Запускается из GitHub Actions (data-refresh.yml).
   Без ключей и токенов. */
import { readFileSync, writeFileSync } from 'node:fs';

const RATES = 'data/rates.json';

function decodeWin1251(buf) {
  return new TextDecoder('windows-1251').decode(buf);
}
function lastValue(xml, charCode) {
  const re = new RegExp(`<Valute ID="[^"]*"[^>]*>[\\s\\S]*?<CharCode>${charCode}</CharCode>[\\s\\S]*?<Value>([\\d,]+)</Value>`);
  const m = xml.match(re);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

async function main() {
  const rates = JSON.parse(readFileSync(RATES, 'utf-8'));
  const today = new Date().toISOString().slice(0, 10);
  const dd = String(new Date().getDate()).padStart(2, '0');
  const mm = String(new Date().getMonth() + 1).padStart(2, '0');
  const yyyy = new Date().getFullYear();
  const dateReq = `${dd}/${mm}/${yyyy}`;

  let ok = false;
  try {
    const res = await fetch(`https://www.cbr.ru/scripts/XML_daily.asp?date_req=${dateReq}`, { signal: AbortSignal.timeout(20000) });
    if (res.ok) {
      const xml = decodeWin1251(Buffer.from(await res.arrayBuffer()));
      const usd = lastValue(xml, 'USD'), eur = lastValue(xml, 'EUR');
      if (usd) { rates.cbr.usd_rub = { ...rates.cbr.usd_rub, value: usd, fetched_at: today, valid_from: `${yyyy}-${mm}-${dd}`, confidence: 'high', status: undefined, stale: false }; ok = true; }
      if (eur) { rates.cbr.eur_rub = { ...rates.cbr.eur_rub, value: eur, fetched_at: today, valid_from: `${yyyy}-${mm}-${dd}`, confidence: 'high', status: undefined, stale: false }; ok = true; }
    }
  } catch (e) {
    console.error('CBR fetch failed:', e.message);
  }
  if (!ok) {
    // источник упал: оставляем прежние данные, помечаем stale
    rates.cbr.usd_rub.stale = true;
    rates.cbr.eur_rub.stale = true;
    console.log('Источник недоступен — данные помечены stale, прежние значения сохранены');
    writeFileSync(RATES, JSON.stringify(rates, null, 2) + '\n');
    process.exit(0); // не роняем workflow: сайт продолжает работать
  }
  rates.generated_note = `cbr updated ${today}`;
  writeFileSync(RATES, JSON.stringify(rates, null, 2) + '\n');
  console.log('rates.json обновлён:', JSON.stringify({ usd: rates.cbr.usd_rub.value, eur: rates.cbr.eur_rub.value, date: today }));
}
main();
