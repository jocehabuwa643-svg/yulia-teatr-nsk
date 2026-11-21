/* app.js — точка входа ES-модулей. Порядок запуска устроен так, чтобы сбой одного раздела
   не ронял остальные: каждый раздел стартует в своей обёртке safe(). */
window.__yuliaModuleOk = true; // сигнал для boot.js: модули распарсились и запустились

import { $, icons } from './ui/helpers.js';
import { loadAll, buildCalcConfig } from './data-loader.js';
import { initTheme } from './theme.js';
import { initNav } from './router.js';
import { initOverview } from './overview.js';
import { initCalc, applyOverrides } from './calc-panel.js';
import { initSimpleCalc } from './simple-calc-ui.js';
import { initMarket } from './market.js';
import { initMap, setMapConfig } from './map.js';
import { initGuide } from './guide.js';
import { initChecklist } from './checklist.js';
import { initToday } from './today.js';
import { initNews } from './news.js';
import { initNotes } from './notes.js';
import { initPresetCards } from './preset-cards.js';
import { initPremises } from './premises.js';
import { initLiveData } from './live-data.js';
import './afford.js'; // самоподключаемый: «пальчик»-пульс на главных кнопках при первом входе
import { initReveal, enter, whenIdle } from './ui/helpers.js';
import { lazyChartLib } from './charts.js';
import { state, hasCoreData } from './state.js';

/* Баннер ошибки данных: аккуратная плашка в начале <main>, с кнопкой «Повторить» */
function dataBanner(title, text) {
  const main = $('main');
  if (!main || $('dataBanner')) return;
  main.insertAdjacentHTML('afterbegin',
    `<div class="advice warn databanner" id="dataBanner" role="alert"><strong>${title}</strong>${text}
     <div class="toolrow"><button type="button" class="btn small secondary" id="dataRetry">Повторить загрузку</button></div></div>`);
  $('dataRetry').onclick = () => location.reload();
}

/* Заглушка раздела, которому не хватает данных: честный статус вместо пустоты */
function sectionNoData(id, what) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = `<div class="nodata"><strong>Нет данных: ${what}</strong><span>Файл данных не загрузился. Нажмите «Повторить загрузку» вверху страницы или откройте офлайн-версию.</span></div>`;
}

/* Запуск раздела в изоляции: ошибка пишется в консоль и в плашку, остальные разделы живут */
function safe(name, fn) {
  try { fn(); } catch (e) {
    console.error(`[${name}]`, e);
    dataBanner('Часть интерфейса не запустилась', `Раздел «${name}» недоступен: ${String(e && e.message || e)}. Остальное работает.`);
  }
}

/* Асинхронный модуль (заметки, помещения, кейс-карточки читают IndexedDB/данные): ошибка — в консоль, без плашки;
   блок просто не появляется, остальное работает */
function asyncSafe(name, fn) {
  try { Promise.resolve(fn()).catch(e => console.error(`[${name}]`, e)); } catch (e) { console.error(`[${name}]`, e); }
}

/* ---------- Ленивая сборка тяжёлых разделов ----------
   Калькуляторы, навигатор рынка, карта, справочник и чек-лист (≈5000 DOM-узлов) собираются не на старте, а когда нужны:
   • раздел подошёл ближе чем на 1500px к вьюпорту (IntersectionObserver);
   • переход по якорю/хэшу (собираются все ленивые разделы до цели включительно — чтобы позиции на странице сошлись);
   • первое действие пользователя (клавиатура, колесо, касание, клик) — остальное достраивается в простое по одному;
   • печать (калькулятор нужен в документе).
   Первый экран (шапка, hero, KPI, графики) не ждёт эти разделы: меньше работы до первой отрисовки и интерактивности. */
const LAZY_ORDER = ['profit', 'calc', 'schemes', 'market', 'geo', 'guide', 'launch']; // порядок разделов на странице

function lazySections(jobs) {
  const done = new Set();
  const build = id => {
    if (done.has(id) || !jobs[id]) return;
    done.add(id);
    jobs[id]();
    initReveal(); // .rv новых разделов (идемпотентно)
    icons();
  };
  // до цели включительно: всё, что выше, тоже собрано, поэтому смещения при прокрутке по якорю не «уплывают»
  const buildUpTo = id => {
    const at = LAZY_ORDER.indexOf(id);
    if (at < 0) return;
    LAZY_ORDER.slice(0, at + 1).forEach(build);
  };
  Object.keys(jobs).forEach(id => { const el = $(id); if (el) enter(el, () => build(id), '1500px'); });

  /* Реальные высоты вместо оценок: пока раздел пропущен (content-visibility), его высота — оценка из CSS, и прокрутка к далёкому
     якорю промахнулась бы. Разделы от начала страницы до цели на время перехода «закрепляются» видимыми (.cv-vis), раскладка
     выполняется сразу, потом они снова пропускаются — уже с запомненными настоящими высотами (contain-intrinsic-size: auto). */
  const pinTo = id => {
    const secs = [...document.querySelectorAll('.section')];
    const at = secs.findIndex(s => s.id === id);
    if (at < 0) return;
    const pinned = secs.slice(0, at + 1);
    pinned.forEach(s => s.classList.add('cv-vis'));
    void document.body.offsetHeight; // принудительная раскладка с настоящими размерами
    setTimeout(() => pinned.forEach(s => s.classList.remove('cv-vis')), 1800);
  };
  const goTo = id => { buildUpTo(id); pinTo(id); };

  // якоря: capture-фаза — раздел готов до того, как браузер начнёт прокрутку к нему
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (a && a.hash.length > 1) goTo(a.hash.slice(1));
  }, true);
  addEventListener('hashchange', () => goTo(location.hash.slice(1)));
  if (location.hash.length > 1) {
    const id = location.hash.slice(1);
    goTo(id);
    const el = $(id);
    if (el) requestAnimationFrame(() => el.scrollIntoView()); // браузер уже прокрутил по оценочной раскладке — уточняем
  }
  addEventListener('beforeprint', () => Object.keys(jobs).forEach(build));

  // первое взаимодействие: достраиваем остальное в простое, по одному разделу за задачу
  let armed = false;
  const buildRest = () => {
    if (armed) return;
    armed = true;
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(t => removeEventListener(t, buildRest, true));
    const queue = Object.keys(jobs).filter(id => !done.has(id));
    const next = () => { const id = queue.shift(); if (!id) return; build(id); whenIdle(next, 1500); };
    whenIdle(next, 1500);
  };
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(t => addEventListener(t, buildRest, { capture: true, passive: true }));
}

/* Отдать управление браузеру между разделами: каждая инициализация — отдельная задача, а не одна длинная (меньше TBT, отзывчивый ввод) */
const yieldToMain = () => new Promise(resolve => {
  if (window.scheduler && typeof scheduler.yield === 'function') scheduler.yield().then(resolve);
  else setTimeout(resolve, 0);
});

/* Дайджест «Сегодня» и плашка новостей отрасли. Дата берётся в момент открытия (и обновляется через полночь внутри
   initToday); рисуется синхронно из уже загруженных данных — место под блок зарезервировано в CSS (без сдвига макета).
   Плашка новостей сама ждёт закрытия заставки и первого действия Юлии; ссылка «Все новости» ведёт к #today */
function startToday(DATA, steps) {
  safe('Сегодня', () => initToday(DATA, { steps, onRender: () => icons() }));
  safe('Новости отрасли', () => initNews(DATA.news || null, { now: Date.now() }));
  // кнопка «Обновить данные» в hero — в простое, после первой отрисовки
  whenIdle(() => safe('Обновить данные', initLiveData), 2000);
  // если дайджест не собрался (ошибка выше уже в плашке) — снимаем резерв высоты, чтобы не осталось пустого места
  const box = $('today');
  if (box && !box.classList.contains('ready')) { box.classList.add('ready'); box.hidden = true; }
}

async function main() {
  // Тема и заставка уже работают благодаря boot.js; здесь только подписки модулей
  safe('Тема', initTheme);
  safe('Навигация', initNav);

  let DATA;
  try { DATA = await loadAll(); } catch (e) { DATA = { health: { errors: [String(e)], cached: [] } }; }
  state.DATA = DATA;

  if (!hasCoreData()) {
    dataBanner('Данные не загрузились', 'Не удалось прочитать data/config.json и data/rates.json. Если страница открыта двойным кликом, браузер блокирует чтение файлов: откройте офлайн-версию (yulia-offline.html) или запустите «npx serve .». Заставка, справочник-архив и чек-лист продолжают работать.');
    ['kpis', 'calcpanels', 'profitApp', 'cashTable', 'budget', 'stages'].forEach(id => sectionNoData(id, 'расчёты и обзор'));
    safe('Чек-лист', () => initChecklist({ checklist_30d: [] }));
    asyncSafe('Заметки', initNotes);
    startToday(DATA, []);
    initReveal();
    icons();
    return;
  }

  state.CFG = buildCalcConfig(DATA);
  applyOverrides();
  const CFG = state.CFG;

  // Первый экран — сразу: «Сегодня», Обзор и ленивая подгрузка Chart.js
  startToday(DATA, CFG.checklist_30d || []);
  safe('Обзор', () => initOverview(CFG));
  safe('Графики', () => lazyChartLib(document.querySelector('.analytics')));
  initReveal();
  icons();
  await yieldToMain();

  // Остальное — по требованию (см. lazySections)
  lazySections({
    profit: () => safe('Сколько я заработаю', initSimpleCalc),
    calc: () => {
      safe('Калькуляторы', () => initCalc(CFG));
      asyncSafe('Кейс-карточки', () => initPresetCards(CFG));
    },
    market: () => safe('Навигатор рынка', () => initMarket(CFG, DATA.competitors || { outbound_performers: [], studio_scene: [], party_venues: [], stationary_benchmarks: [] }, DATA.market || {})),
    geo: () => {
      safe('Карта', () => {
        setMapConfig(CFG);
        initMap(DATA.regions || { points: [], region_routes: [], home_zone_radius_m: 1250 }, CFG);
      });
      asyncSafe('Помещения', initPremises);
    },
    guide: () => safe('Справочник', () => initGuide(DATA.guide || { categories: [], entries: [] })),
    launch: () => {
      safe('Чек-лист', () => initChecklist(CFG));
      asyncSafe('Заметки', initNotes);
    }
  });
}

main();
