#!/usr/bin/env node
/* build.mjs — сборка каталога _site/ для GitHub Pages и офлайн-версии.

   Что получается:
   1) _site/index.html + css/ + js/boot.js + data/ + favicon.svg + .nojekyll,
      а js/app.js со всеми модулями склеен esbuild в один классический скрипт assets/app.js (IIFE);
   2) _site/yulia-offline.html — ОДИН самодостаточный файл: стили, boot.js, бандл и все data/*.json
      вшиты в страницу, открывается двойным кликом по file://. CDN-скрипты (Leaflet, Chart.js, Lucide)
      остаются ссылками: приложение работает и без них (иконки декоративны, графики/карта показывают плашку).

   Флаги: --offline-only — собрать только yulia-offline.html (каталог _site/ не очищается целиком).
   Производительность _site/index.html: все css/*.css склеены и минифицированы в один assets/app.css (один запрос
   вместо девяти), boot.js (минифицированный) встроен в <head> — без отдельного блокирующего запроса.
   Исходники в репозитории не меняются.
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

/* Стили делятся на две части. КРИТИЧЕСКАЯ (первый экран: токены, темы, база, шапка, hero, KPI, заставка) встраивается в <head>
   и блокирует отрисовку минимально. ОТЛОЖЕННАЯ (калькуляторы, рынок, справочник, карта, схемы) — assets/rest.css,
   подключается без блокировки отрисовки (media=print → all по загрузке).
   Отложены файлы целиком (DEFER_FILES) и блоки в остальных файлах между CSS-комментариями-маркерами «@defer» и «@end-defer» (см. components.css). */
// preset-cards.css и premises.css — стили блоков, которые строятся лениво вместе с разделами калькуляторов и карты
const DEFER_FILES = new Set(['css/calc.css', 'css/simple-calc.css', 'css/market.css', 'css/guide.css', 'css/preset-cards.css', 'css/premises.css']);

/* Склеивает локальные таблицы стилей из index.html (в порядке подключения), делит на критические и отложенные,
   минифицирует. Возвращает { critical, rest, hrefs } */
async function bundleCss(esbuild, indexHtml) {
  const hrefs = [...indexHtml.matchAll(/<link rel="stylesheet" href="(css\/[^"]+)">/g)].map(m => m[1]);
  if (!hrefs.length) fail('в index.html не найдено ни одной ссылки на css/*.css');
  const crit = [], rest = [];
  for (const h of hrefs) {
    const text = read(h);
    if (DEFER_FILES.has(h)) { rest.push(text); continue; }
    // блоки между маркерами уходят в отложенную часть, порядок внутри блока сохраняется
    crit.push(text.replace(/\/\* @defer[^*]*\*\/([\s\S]*?)\/\* @end-defer \*\//g, (_, block) => { rest.push(block); return ''; }));
  }
  const min = async src => {
    const res = await esbuild.transform(src, { loader: 'css', minify: true, legalComments: 'none' });
    if (!res.code) fail('esbuild не вернул результат для css');
    return res.code;
  };
  return { critical: await min(crit.join('\n')), rest: await min(rest.join('\n')), hrefs };
}

/* Лёгкая минификация HTML для _site: убираются комментарии и ведущие отступы строк. Содержимое <textarea>/<pre>/<script>/<style>
   не трогается (там отступы и переводы строк значимы); печатные тексты страницы не меняются. */
function minifyHtml(html) {
  const keep = [];
  // 1) прячем блоки, где пробелы значимы
  let out = html.replace(/<(script|style|textarea|pre)\b[\s\S]*?<\/\1>/gi, m => { keep.push(m); return `\u0000${keep.length - 1}\u0000`; });
  // 2) комментарии HTML (кроме условных) и ведущие пробелы строк
  out = out.replace(/<!--(?!\[if)[\s\S]*?-->/g, '').replace(/^[ \t]+/gm, '').replace(/\r/g, '').replace(/\n{2,}/g, '\n');
  // 3) возвращаем спрятанное
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => keep[+i]);
}

/* Минифицированный boot.js для встраивания в <head> */
async function minifyBoot(esbuild) {
  const res = await esbuild.transform(read('js/boot.js'), { loader: 'js', minify: true, target: 'es2019', legalComments: 'none' });
  if (!res.code) fail('esbuild не вернул результат для js/boot.js');
  return res.code;
}

/* Загрузчик приложения: assets/app.js запрашивается ПОСЛЕ первой отрисовки (событие paint + 600 мс — главный заголовок успевает
   отрисоваться как LCP-кандидат; запасной таймер 1500 мс).
   Первый экран (шапка, hero, заставка) — статический HTML + CSS, ему скрипты не нужны; тяжёлый бандл и 8 файлов данных
   не конкурируют за канал с первой отрисовкой. Порядок исполнения не важен: бандл самодостаточный классический скрипт. */
const APP_LOADER = '<script>(function(){var d=0;function go(){if(d)return;d=1;var s=document.createElement("script");s.src="assets/app.js";s.defer=true;document.head.appendChild(s)}' +
  'try{new PerformanceObserver(function(l,o){if(l.getEntriesByName("first-contentful-paint").length){o.disconnect();setTimeout(go,600)}}).observe({type:"paint",buffered:true})}catch(e){}' +
  'setTimeout(go,1500)})()</script>';

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

  // Чистая сборка: содержимое каталога очищается, сам каталог остаётся (его может удерживать как рабочую папку
  // локальный сервер раздачи — на Windows такой каталог удалить нельзя, а раздача продолжает работать)
  mkdirSync(OUT, { recursive: true });
  for (const entry of readdirSync(OUT)) rmSync(join(OUT, entry), { recursive: true, force: true });

  // Статика: данные, иконка, служебный .nojekyll (стили — ниже: склеенный assets/app.css или, без esbuild, копия css/)
  cpSync(join(ROOT, 'data'), join(OUT, 'data'), { recursive: true });
  // js/ в _site не копируется: заметки, кейс-карточки, помещения и «Обновить данные» входят в бандл assets/app.js,
  // boot.js встраивается в <head> (без esbuild js/ копируется ниже, в запасной ветке)
  for (const f of ['favicon.svg', '.nojekyll']) {
    if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(OUT, f));
    else if (f === 'favicon.svg') console.warn('! нет favicon.svg — пропущено');
  }

  // Скрипты приложения: бандл (основной путь) или копия модулей (запасной)
  let indexOut = indexSrc;
  if (bundleJs) {
    mkdirSync(join(OUT, 'assets'), { recursive: true });
    writeFileSync(join(OUT, 'assets', 'app.js'), bundleJs);
    let n = 0;
    indexOut = indexSrc.replace(/<script type="module" src="js\/app\.js"><\/script>/, () => { n++; return APP_LOADER; });
    if (n !== 1) fail('в index.html не найден <script type="module" src="js/app.js"> для подмены');
    console.log(`assets/app.js: ${kb(Buffer.byteLength(bundleJs))}`);

    // Стили: критическая часть встраивается на месте первой ссылки, остальное — assets/rest.css (грузится без блокировки)
    const { critical, rest, hrefs } = await bundleCss(esbuild, indexOut);
    writeFileSync(join(OUT, 'assets', 'rest.css'), rest);
    let first = true;
    indexOut = indexOut.replace(/<link rel="stylesheet" href="css\/[^"]+">\r?\n?/g, () => {
      if (!first) return '';
      first = false;
      return `<style>${critical}</style>\n` +
        '<link rel="stylesheet" href="assets/rest.css" media="print" onload="this.media=\'all\'">\n' +
        '<noscript><link rel="stylesheet" href="assets/rest.css"></noscript>\n';
    });
    console.log(`css: критический ${kb(Buffer.byteLength(critical))} (в HTML) + assets/rest.css ${kb(Buffer.byteLength(rest))}; склеено файлов: ${hrefs.length}`);

    // boot.js встраивается в <head> (классический скрипт, выполняется до первой отрисовки, без лишнего запроса)
    const bootMin = await minifyBoot(esbuild);
    let nb = 0;
    indexOut = indexOut.replace(/<script src="js\/boot\.js"><\/script>/, () => { nb++; return `<script>${escapeForScript(bootMin)}</script>`; });
    if (nb !== 1) fail('в index.html не найден <script src="js/boot.js"></script> для встраивания');
  } else {
    cpSync(join(ROOT, 'css'), join(OUT, 'css'), { recursive: true });
    cpSync(join(ROOT, 'js'), join(OUT, 'js'), { recursive: true });
  }
  writeFileSync(join(OUT, 'index.html'), bundleJs ? minifyHtml(indexOut) : indexOut);

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
