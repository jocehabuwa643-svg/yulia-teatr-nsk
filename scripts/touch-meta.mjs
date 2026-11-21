#!/usr/bin/env node
/* touch-meta.mjs — проверяет, что все data/*.json валидны, и (с флагом --stamp) обновляет
   data/meta.json → generated_at. Вызывается из data-refresh.yml только когда данные реально изменились,
   чтобы ежедневный прогон без изменений не плодил пустые коммиты. */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, readJson, writeJsonIfChanged, ageInDays } from './fetch-util.mjs';

/* Валидность JSON: битый файл не должен попасть в коммит и на сайт */
let bad = 0;
for (const f of readdirSync(DATA_DIR).filter(n => n.endsWith('.json'))) {
  try { JSON.parse(readFileSync(join(DATA_DIR, f), 'utf-8')); }
  catch (e) { bad++; console.error(`data/${f}: невалидный JSON — ${e.message}`); }
}
if (bad) process.exit(1);

/* Напоминание о календаре каникул: даты на следующий год вносятся вручную (официального машиночитаемого источника нет).
   Если до конца года меньше 60 дней, а следующий год в seasonality.json не загружен (или не загружен текущий),
   печатаем предупреждение GitHub Actions — прогон не падает, но строка видна в сводке workflow */
try {
  const seas = JSON.parse(readFileSync(join(DATA_DIR, 'seasonality.json'), 'utf-8'));
  const sh = seas.school_holidays || {};
  const now = new Date();
  const y = now.getUTCFullYear();
  const loaded = yr => !!(sh[String(yr)] && sh[String(yr)].loaded !== false && Array.isArray(sh[String(yr)].items) && sh[String(yr)].items.length);
  const daysLeft = Math.ceil((Date.UTC(y + 1, 0, 1) - now.getTime()) / 86400000);
  const missing = [];
  if (!loaded(y)) missing.push(y);
  if (daysLeft <= 60 && !loaded(y + 1)) missing.push(y + 1);
  if (missing.length) {
    console.log(`::warning file=data/seasonality.json::Календарь школьных каникул на ${missing.join(' и ')} не загружен — внесите даты вручную по do.nios.ru (см. DATA_SOURCES.md, раздел «Каникулы»)`);
  }
} catch (e) {
  console.log('::warning file=data/seasonality.json::Не удалось проверить календарь каникул: ' + e.message);
}

/* Недельные источники: если «потенциальные клиенты» не обновлялись дольше порога (leads.json → updated_at) или у большинства
   конкурентов давно не было проверки сайта — печатаем ::warning; прогон не падает (данные на сайте помечаются устаревшими) */
try {
  const meta = readJson(join(DATA_DIR, 'meta.json'));
  const limits = (meta.refresh_policy && meta.refresh_policy.stale_after_days) || {};
  if (existsSync(join(DATA_DIR, 'leads.json'))) {
    const leads = readJson(join(DATA_DIR, 'leads.json'));
    const age = ageInDays(leads.updated_at);
    const limit = Number.isFinite(limits.leads) ? limits.leads : 10;
    if (leads.stale || age > limit) {
      console.log(`::warning file=data/leads.json::«Потенциальные клиенты» не обновлялись ${Number.isFinite(age) ? Math.floor(age) + ' дн.' : '(даты нет)'} — проверьте недельный workflow Weekly refresh${leads.stale_reason ? ': ' + leads.stale_reason : ''}`);
    }
  }
  if (existsSync(join(DATA_DIR, 'competitors.json'))) {
    const comp = readJson(join(DATA_DIR, 'competitors.json'));
    const limit = Number.isFinite(limits.competitors_check) ? limits.competitors_check : 14;
    const checked = ['outbound_performers', 'studio_scene', 'party_venues', 'stationary_benchmarks']
      .flatMap(k => comp[k] || []).filter(x => x.check_status && x.check_status !== 'skipped_policy' && x.checked_at);
    if (checked.length && checked.every(x => ageInDays(x.checked_at) > limit)) {
      console.log(`::warning file=data/competitors.json::Автопроверка сайтов конкурентов не выполнялась более ${limit} дн. — проверьте недельный workflow Weekly refresh`);
    }
  }
} catch (e) {
  console.log('::warning::Не удалось проверить свежесть недельных данных: ' + e.message);
}

if (process.argv.includes('--stamp')) {
  const file = join(DATA_DIR, 'meta.json');
  const meta = readJson(file);
  meta.generated_at = new Date().toISOString();
  writeJsonIfChanged(file, meta);
  console.log('meta.generated_at =', meta.generated_at);
} else {
  console.log('Все data/*.json валидны');
}
