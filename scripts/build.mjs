#!/usr/bin/env node
/* build.mjs — сборка каталога _site/ для GitHub Pages и офлайн-версии.

   Что получается:
   1) _site/index.html + css/ + js/boot.js + data/ + favicon.svg + .nojekyll,
      а js/app.js со всеми модулями склеен esbuild в один классический скрипт assets/app.js (IIFE);
   2) _site/yulia-offline.html — ОДИН самодостаточный файл: стили, boot.js, бандл и все data/*.json
      вшиты в страницу, открывается двойным кликом по file://. CDN-скрипты (Leaflet, Chart.js, Lucide)
      остаются ссылками: приложение работает и без них (иконки декоративны, графики/карта показывают плашку).

   Флаги: --offline-only — собрать только yulia-offline.html (каталог _site/ не очищается целиком).
   Запасной вариант: если esbuild не установлен — исходные модули копируются как есть, офлайн-файл пропускается.
   Любая ошибка завершает скрипт кодом 1 с понятным сообщением — молчаливых провалов нет. */
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');
const OFFLINE_ONLY = process.argv.includes('--offline-only');

/* Исключение с понятным текстом: ловится в самом низу и печатается без стека */
class BuildError extends Error {}
const fail = msg => { throw new BuildError(msg); };

const read = rel => {
  const p = join(ROOT, rel);
  if (!existsSync(p)) fail(`нет файла ${rel}`);
  return readFileSync(p, 'utf-8');
};
const kb = n => (n / 1024).toFixed(1) + ' КБ';

/* Безопасное встраивание в <script>: последовательности, которые HTML-парсер принял бы за конец блока */
const escapeForScript = s => s
  .replace(/<\/(script)/gi, '<\\/$1')
  .replace(/<!--/g, '<\\!--');

/* JSON → строка для встраивания: JSON.stringify + экранирование «</», U+2028/2029 */
const jsonForScript = obj => JSON.stringify(obj)
  .replace(/</g, '\\u003c')
  .replace(new RegExp('\u2028', 'g'), '\\u2028')
  .replace(new RegExp('\u2029', 'g'), '\\u2029');

/* ---------- Бандл ---------- */
async function loadEsbuild() {
  try { return await import('esbuild'); } catch { return null; }
}

/* Склеивает js/app.js в один IIFE-текст. Возвращает строку JS */
async function bundleApp(esbuild) {
  const entry = join(ROOT, 'js', 'app.js');
  if (!existsSync(entry)) fail('нет js/app.js — нечего бандлить');
  const res = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    target: 'es2019',
    minify: true,
    sourcemap: false,
    write: false,
    legalComments: 'none',
    logLevel: 'silent'
  });
  const out = res.outputFiles && res.outputFiles[0];
  if (!out || !out.text) fail('esbuild не вернул результат для js/app.js');
  return out.text;
}

/* ---------- Данные для офлайн-версии ---------- */
function collectData() {
  const dir = join(ROOT, 'data');
  if (!existsSync(dir)) fail('нет каталога data/');
  const data = {};
  for (const f of readdirSync(dir).sort()) {
    if (f.endsWith('.json')) {
      const name = f.slice(0, -5);
      try { data[name] = JSON.parse(readFileSync(join(dir, f), 'utf-8')); }
      catch (e) { fail(`data/${f} — невалидный JSON: ${e.message}`); }
    }
  }
  // Обязательные для работы файлы: без них приложение в офлайне покажет «нет данных»
  for (const need of ['rates', 'config']) if (!data[need]) fail(`нет обязательного data/${need}.json`);
  const archive = join(dir, 'archive.html');
  if (existsSync(archive)) data.archive_html = readFileSync(archive, 'utf-8');
  return data;
}

/* ---------- Офлайн-страница ---------- */
function buildOffline(indexHtml, bundleJs) {
  let html = indexHtml;
  let n;

  // 1) boot.js → встроенный классический скрипт
  const boot = read('js/boot.js');
  n = 0;
  html = html.replace(/<script src="js\/boot\.js"><\/script>/, () => { n++; return `<script>\n${escapeForScript(boot)}\n</script>`; });
  if (n !== 1) fail('в index.html не найден <script src="js/boot.js"></script>');

  // 2) локальные таблицы стилей → <style> в том же порядке (каскад не меняется)
  n = 0;
  html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, href) => {
    n++;
    const css = read(href);
    if (/<\/style/i.test(css)) fail(`${href} содержит «</style» — нельзя встроить`);
    return `<style data-css="${href}">\n${css}\n</style>`;
  });
  if (n === 0) fail('в index.html не найдено ни одной ссылки на css/*.css');

  // 3) данные + бандл вместо <script type="module">.
  //    Бандл запускается по DOMContentLoaded: к этому моменту отложенные CDN-скрипты (Leaflet/Chart/Lucide)
  //    уже выполнены — как и у обычной версии, где скрипт приложения стоит последним в очереди defer.
  const data = collectData();
  const dataScript = `<script>window.__YULIA_DATA__=${jsonForScript(data)};</script>`;
  const wrapped = `(function(){var run=function(){${bundleJs}\n};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();})();`;
  const appScript = `<script>\n${escapeForScript(wrapped)}\n</script>`;
  n = 0;
  html = html.replace(/<script type="module" src="js\/app\.js"><\/script>/, () => { n++; return dataScript + '\n' + appScript; });
  if (n !== 1) fail('в index.html не найден <script type="module" src="js/app.js">');

  // 4) контроль: ни одной локальной ссылки на файлы, которых в офлайн-версии нет
  const leftovers = html.match(/(?:src|href)="(?:js|css|data)\/[^"]*"/g);
  if (leftovers) fail(`в офлайн-версии остались внешние ссылки на файлы проекта: ${[...new Set(leftovers)].join(', ')}`);
  return html;
}

/* ---------- Основной сценарий ---------- */
async function main() {
  const esbuild = await loadEsbuild();
  const indexSrc = read('index.html');
  let bundleJs = null;
  if (esbuild) bundleJs = await bundleApp(esbuild);
  else console.warn('! esbuild не найден (выполните npm ci) — запасной вариант: модули копируются как есть, офлайн-версия пропущена');

  if (OFFLINE_ONLY) {
    if (!bundleJs) fail('для --offline-only нужен esbuild (npm ci)');
    mkdirSync(OUT, { recursive: true });
    const file = join(OUT, 'yulia-offline.html');
    writeFileSync(file, buildOffline(indexSrc, bundleJs));
    console.log(`yulia-offline.html: ${kb(statSync(file).size)}`);
    return;
  }

  // Чистая сборка: каталог пересоздаётся целиком
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  // Статика: стили, данные, иконка, служебный .nojekyll
  cpSync(join(ROOT, 'css'), join(OUT, 'css'), { recursive: true });
  cpSync(join(ROOT, 'data'), join(OUT, 'data'), { recursive: true });
  for (const f of ['favicon.svg', '.nojekyll']) {
    if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(OUT, f));
    else if (f === 'favicon.svg') console.warn('! нет favicon.svg — пропущено');
  }
  mkdirSync(join(OUT, 'js'), { recursive: true });
  cpSync(join(ROOT, 'js', 'boot.js'), join(OUT, 'js', 'boot.js'));

  // Скрипты приложения: бандл (основной путь) или копия модулей (запасной)
  let indexOut = indexSrc;
  if (bundleJs) {
    mkdirSync(join(OUT, 'assets'), { recursive: true });
    writeFileSync(join(OUT, 'assets', 'app.js'), bundleJs);
    let n = 0;
    indexOut = indexSrc.replace(/<script type="module" src="js\/app\.js"><\/script>/, () => { n++; return '<script defer src="assets/app.js"></script>'; });
    if (n !== 1) fail('в index.html не найден <script type="module" src="js/app.js"> для подмены');
    console.log(`assets/app.js: ${kb(Buffer.byteLength(bundleJs))}`);
  } else {
    cpSync(join(ROOT, 'js'), join(OUT, 'js'), { recursive: true });
  }
  writeFileSync(join(OUT, 'index.html'), indexOut);

  // Офлайн-версия
  if (bundleJs) {
    const file = join(OUT, 'yulia-offline.html');
    writeFileSync(file, buildOffline(indexSrc, bundleJs));
    console.log(`yulia-offline.html: ${kb(statSync(file).size)}`);
  }
  console.log(`Готово: ${OUT}`);
}

main().catch(e => {
  if (e instanceof BuildError) console.error(`Ошибка сборки: ${e.message}`);
  else console.error('Непредвиденная ошибка сборки:', e && e.stack || e);
  process.exit(1);
});
