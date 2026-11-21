#!/usr/bin/env node
/* refresh-local.mjs — то же обновление данных, что делают workflow в GitHub, но с компьютера владельца.
   Зачем: часть источников (mk.nso.ru, nso.ru, culture.gov.ru) не отвечает зарубежным серверам GitHub Actions
   (502 / таймаут), а из российской сети открывается. Скрипт по очереди запускает сборщики, затем, если файлы
   в data/ реально изменились, ставит метку времени (touch-meta --stamp). Коммит и пуш — вручную (git), скрипт их не делает.

   Запуск:  node scripts/refresh-local.mjs            — ежедневные источники (курсы ЦБ, новости)
            node scripts/refresh-local.mjs --weekly   — плюс «потенциальные клиенты» (OpenStreetMap) и сайты конкурентов
   Переменная DATA_DIR=… — прогон на копии данных (передаётся сборщикам как есть). */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, DATA_DIR } from './fetch-util.mjs';

/* Отпечаток всех data/*.json: по нему видно, поменялось ли что-то после сборщиков */
function fingerprint(dir) {
  const h = createHash('sha1');
  if (!existsSync(dir)) return '';
  for (const f of readdirSync(dir).filter(n => n.endsWith('.json')).sort()) h.update(f).update(readFileSync(join(dir, f)));
  return h.digest('hex');
}

/* Запуск одного скрипта в отдельном процессе с выводом в консоль; сбой одного не останавливает остальные */
function run(script, args = []) {
  console.log(`\n=== ${script} ${args.join(' ')}`.trimEnd());
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) console.log(`(${script} завершился с кодом ${r.status} — остальные шаги продолжаются)`);
  return r.status === 0;
}

const weekly = process.argv.includes('--weekly');
const before = fingerprint(DATA_DIR);

run('fetch-cbr.mjs');
run('fetch-news.mjs');
if (process.env.WORDSTAT_TOKEN) run('fetch-wordstat.mjs');
if (weekly) {
  run('fetch-leads.mjs');
  run('fetch-competitors.mjs');
}

const changed = fingerprint(DATA_DIR) !== before;
run('touch-meta.mjs', changed ? ['--stamp'] : []);
console.log(changed
  ? '\nДанные обновлены. Проверьте и закоммитьте: git add data/ && git commit -m "data: локальное обновление" && git push'
  : '\nДанные не изменились — коммит не нужен.');
