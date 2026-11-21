#!/usr/bin/env node
/* touch-meta.mjs — проверяет, что все data/*.json валидны, печатает находки аудита свежести (::warning в сводке
   GitHub Actions) и по флагам ставит метки времени в data/meta.json:
   --stamp      данные реально изменились → generated_at и checked_at = сейчас (вызывается только при непустом diff);
   --heartbeat  ежедневный прогон прошёл, курсы ЦБ получены, но по существу ничего не поменялось → checked_at = сейчас,
                не чаще раза в HEARTBEAT_DAYS дней (иначе бот коммитил бы метку каждый день). Нужен, чтобы в долгие
                праздники без новых курсов сайт не считал данные «устаревшими», хотя проверка шла каждый день. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, readJson, writeJsonIfChanged, ageInDays } from './fetch-util.mjs';
import { auditFreshness, readDataDir } from './data-freshness.mjs';

const HEARTBEAT_DAYS = 2;

/* Валидность JSON: битый файл не должен попасть в коммит и на сайт */
let bad = 0;
for (const f of readdirSync(DATA_DIR).filter(n => n.endsWith('.json'))) {
  try { JSON.parse(readFileSync(join(DATA_DIR, f), 'utf-8')); }
  catch (e) { bad++; console.error(`data/${f}: невалидный JSON — ${e.message}`); }
}
if (bad) process.exit(1);

/* Аудит свежести по договорённым срокам (data-freshness.mjs): прогон не падает, строки видны в сводке workflow */
const data = readDataDir();
for (const f of auditFreshness(data)) {
  console.log(`::${f.level === 'warning' ? 'warning' : 'notice'} file=data/${f.file}::${f.message}`);
}

const file = join(DATA_DIR, 'meta.json');
const nowIso = new Date().toISOString();

if (process.argv.includes('--stamp')) {
  // Данные изменились: дата релиза и дата последней успешной проверки
  const meta = readJson(file);
  meta.generated_at = nowIso;
  meta.checked_at = nowIso;
  writeJsonIfChanged(file, meta);
  console.log('meta.generated_at =', meta.generated_at);
} else if (process.argv.includes('--heartbeat')) {
  // Метка «проверено» — только если ежедневный источник (ЦБ) действительно ответил: при сбое метка не двигается
  const meta = readJson(file);
  const cbr = (data.rates && data.rates.cbr) || {};
  const cbrOk = ['usd_rub', 'eur_rub'].every(k => cbr[k] && cbr[k].value !== null && cbr[k].value !== undefined && cbr[k].stale !== true);
  const last = meta.checked_at || meta.generated_at;
  if (!cbrOk) console.log('checked_at не сдвигается: курсы ЦБ не получены');
  else if (ageInDays(last) < HEARTBEAT_DAYS) console.log(`checked_at свежий (${last}) — метка не нужна`);
  else {
    meta.checked_at = nowIso;
    writeJsonIfChanged(file, meta);
    console.log('meta.checked_at =', meta.checked_at);
  }
} else {
  console.log('Все data/*.json валидны');
}
