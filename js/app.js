/* app.js — точка входа ES-модулей. Порядок запуска устроен так, чтобы сбой одного раздела
   не ронял остальные: каждый раздел стартует в своей обёртке safe(). */
window.__yuliaModuleOk = true; // сигнал для boot.js: модули распарсились и запустились

import { $, icons } from './ui/helpers.js';
import { loadAll, buildCalcConfig } from './data-loader.js';
import { initTheme } from './theme.js';
import { initNav } from './router.js';
import { initOverview } from './overview.js';
import { initCalc, applyOverrides } from './calc-panel.js';
import { initMarket } from './market.js';
import { initMap, setMapConfig } from './map.js';
import { initGuide } from './guide.js';
import { initChecklist } from './checklist.js';
import { initReveal } from './ui/helpers.js';
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

async function main() {
  // Тема и заставка уже работают благодаря boot.js; здесь только подписки модулей
  safe('Тема', initTheme);
  safe('Навигация', initNav);

  let DATA;
  try { DATA = await loadAll(); } catch (e) { DATA = { health: { errors: [String(e)], cached: [] } }; }
  state.DATA = DATA;

  if (!hasCoreData()) {
    dataBanner('Данные не загрузились', 'Не удалось прочитать data/config.json и data/rates.json. Если страница открыта двойным кликом, браузер блокирует чтение файлов: откройте офлайн-версию (yulia-offline.html) или запустите «npx serve .». Заставка, справочник-архив и чек-лист продолжают работать.');
    ['kpis', 'calcpanels', 'cashTable', 'budget', 'stages'].forEach(id => sectionNoData(id, 'расчёты и обзор'));
    safe('Чек-лист', () => initChecklist({ checklist_30d: [] }));
    initReveal();
    icons();
    return;
  }

  state.CFG = buildCalcConfig(DATA);
  applyOverrides();
  const CFG = state.CFG;

  safe('Обзор', () => initOverview(CFG));
  safe('Калькуляторы', () => initCalc(CFG));
  safe('Навигатор рынка', () => initMarket(CFG, DATA.competitors || { outbound_performers: [], studio_scene: [], party_venues: [], stationary_benchmarks: [] }, DATA.market || {}));
  safe('Карта', () => {
    setMapConfig(CFG);
    initMap(DATA.regions || { points: [], region_routes: [], home_zone_radius_m: 1250 }, CFG);
  });
  safe('Справочник', () => initGuide(DATA.guide || { categories: [], entries: [] }));
  safe('Чек-лист', () => initChecklist(CFG));
  initReveal();
  icons();
}

main();
