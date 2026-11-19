#!/usr/bin/env node
/* touch-meta.mjs — проверяет, что все data/*.json валидны, и (с флагом --stamp) обновляет
   data/meta.json → generated_at. Вызывается из data-refresh.yml только когда данные реально изменились,
   чтобы ежедневный прогон без изменений не плодил пустые коммиты. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, readJson, writeJsonIfChanged } from './fetch-util.mjs';

/* Валидность JSON: битый файл не должен попасть в коммит и на сайт */
let bad = 0;
for (const f of readdirSync(DATA_DIR).filter(n => n.endsWith('.json'))) {
  try { JSON.parse(readFileSync(join(DATA_DIR, f), 'utf-8')); }
  catch (e) { bad++; console.error(`data/${f}: невалидный JSON — ${e.message}`); }
}
if (bad) process.exit(1);

if (process.argv.includes('--stamp')) {
  const file = join(DATA_DIR, 'meta.json');
  const meta = readJson(file);
  meta.generated_at = new Date().toISOString();
  writeJsonIfChanged(file, meta);
  console.log('meta.generated_at =', meta.generated_at);
} else {
  console.log('Все data/*.json валидны');
}
