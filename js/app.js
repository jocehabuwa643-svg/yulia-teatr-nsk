/* app.js — точка входа. Собирает данные, калькуляторы, навигатор, карту, справочник. */
import { $, $$, fmt, rub, signed, pct, ic, icons, kv, minis, table, advice, toast, store, enter, counter, initReveal, srcBadge, isStale } from './ui/helpers.js';
import { fieldHTML, readInputs, rangeValues, renderResult } from './ui/calc-ui.js';
import { loadAll, buildCalcConfig, ageDays } from './data-loader.js';
import { theme, initTheme, onThemeChange } from './theme.js';
import { initVeil } from './onboarding.js';
import { initNav } from './router.js';
import { drawCash, drawSplit, chartColors, onChartTheme } from './charts.js';
import { initMap, setMapConfig } from './map.js';
import { registry } from './calculators/index.js';
import { calc as travelCalc } from './calculators/travel.js';
import { baseMonth } from './calculators/basecamp.js';

let CFG = null, DATA = null;
const chartState = { chart: null, split: null, month: 8, view: 'net', seen: false, splitSeen: false };
const lastHeadline = {};

/* ==== Тексты допущений (провенанс) по калькуляторам ==== */
const METHOD = {
  travel: 'Число зрителей задано на один показ. В городе команда получает 5 000 ₽ за одиночный показ или 4 300 ₽ за каждый в кластере; в ДК 6 500 ₽ за показ. При гастролях гарантированный гонорар дня 15 500 ₽ (два актёра по 6 000 ₽ и техник 3 500 ₽). ГСМ делятся на весь день; для ДК в городе добавлена доставка 200 ₽. Износ 400 ₽/показ, в ДК 600 ₽. Полиграфия 10 ₽/зритель. Наём: модельная надбавка 30,2%. Комиссия площадки и УСН — с валовой кассы. Личные взносы ИП и постоянные расходы здесь не списываются. Ставки — из data/config.json (предположения проекта) и data/rates.json.',
  basecamp: 'Фикс: площадь × (ставка + 200 ₽ КУ) + 35 000 ₽ администрирования + 20 000 ₽ рекламы. Группа до 10 учеников: 8 уроков × 1 200 ₽ × 1,302. Выходной: билет 350 ₽, гонорар 3 500 ₽ × 1,302 + 300 ₽ реквизита + 3% кассы. Праздник: переменные 2 953 ₽. УСН 6%, льготы и вычеты не заложены. До 55 выездов: 50 × 325 ₽ и 7 550 ₽ вклада с показа. С 56-го: модель гастролей с 55 зрителями, 17 875 ₽ выручки, 7 965,12 ₽ вклада до поправки на НДС (≈7 165 ₽ после неё). Мощность 55 показов/труппа. НДС в цене по 5/105 и штаб 150 000 ₽ при темпе выше 20 млн ₽/год (228-ФЗ). Цена воспроизводства доп. комплекта 180–220 тыс. ₽.',
  goal: 'Обратная задача решается прямым перебором целых показов на точной модели базы+выездов (функция монотонна по числу показов). Ученики и загрузка выходных зафиксированы стадией. До февраля — одна труппа до 55 показов, после открытия — до 200.',
  taxes: 'Ставки и пороги — только из data/rates.json с источниками и датами. Отсутствующие значения (патент, фиксированные взносы ИП) честно показываются как «нет данных» и вводятся вручную. НДС 5% — только при годовой выручке сверх порога 20 млн ₽ (228-ФЗ). Вычет взносов из УСН, НДФЛ и региональные нюансы — консультация со специалистом.',
  payroll: 'Считаются взносы заказчика по модельной ставке 30,2% (rates.json). НПД: исполнитель платит налог сам, заказчик взносов не платит — но схема законна только при реальной самостоятельности подрядчика. НДФЛ сознательно не считается: проверенной ставки в data/ нет.',
  pricing: 'Цена из маржи: P = прямые расходы ÷ (зрители × (1 − доля переменных − маржа)). Тепловая карта считается тем же калькулятором выезда по сетке «цена × аудитория».',
  parties: 'Переменные праздника 2 953 ₽ и ФОТ по формуле выходного показания — из модели проекта. Ориентир рынка: PlayPanda, 5 000 ₽/час, пакеты 21 000–26 000 ₽ (data/competitors.json).',
  cashflow: 'Декабрь–август — базовый прогноз модели (9 месяцев). Сентябрь–ноябрь — проекция для 12-месячного графика, помечена звёздочкой. Вклад выездов: показы × юнит-экономика из config (50/55 зрителей × 325 ₽).',
  grants: 'Только конкурсы с проверенными окнами из data/market.json (срез 18.11.2026). Даты парсятся из строк окна и итогов.'
};

/* ==== Обзор: KPI + статус данных + аналитика ==== */
function initOverview(cfg) {
  const metrics = [
    ['wallet', 'Бюджет запуска', cfg.phases_budget.total, '₽', 'Вложения двух фаз'],
    ['paint-roller', 'Экономия', cfg.phases_budget.renovation_saving, '₽', 'На готовом ремонте'],
    ['key-round', 'Аренда', cfg.base_costs.rent_per_m2, '₽/м²', 'Ставка без КУ'],
    ['ruler', 'База', 130, 'м²', 'На Богдашке'],
    ['ticket', 'Операционный ноль', 8, 'показов', 'В месяц до февраля'],
    ['timer', 'Окупаемость', 10, 'мес.', 'Цель базового прогноза']
  ];
  $('kpis').innerHTML = metrics.map(([i, l, v, u, h]) => `<article class="kpi rv"><div class="kphead">${ic(i)}${l}</div><div class="num"><span data-target="${v}">${fmt(v)}</span> <small class="unit">${u}</small></div><p>${h}</p></article>`).join('');
  $$('[data-target]').forEach(e => enter(e, () => counter(e)));
  const meta = DATA.meta || {};
  $('dataStatus').innerHTML = `Данные обновлены: ${meta.generated_at ? new Date(meta.generated_at).toLocaleDateString('ru-RU') : '—'} · схема v${meta.data_version || '?'}`;

  // Аналитика
  const rows = cashRowsOf(cfg);
  $('budget').innerHTML = budgetTables(cfg);
  $('cashTable').innerHTML = table(['Месяц', 'Показы', 'Выезды', 'База', 'Фикс', 'Вложения', 'Прибыль', 'Баланс'], rows.map(x => [x.m + (x.projected ? ' *' : ''), x.shows, ...[x.tour, x.base, x.fixed, x.cap, x.op, x.net].map(rub)]));
  $('periods').innerHTML = rows.map((x, i) => `<button data-m="${i}" aria-label="${x.m}" aria-pressed="${i === 8}">${x.short}</button>`).join('');
  $('periods').onclick = e => { if (e.target.dataset.m != null) setMonth(+e.target.dataset.m, rows); };
  setMonth(8, rows);
  $('chartSwitch').onclick = e => {
    if (!e.target.dataset.view) return;
    chartState.view = e.target.dataset.view;
    $$('#chartSwitch button').forEach(b => { b.classList.toggle('on', b === e.target); b.setAttribute('aria-pressed', String(b === e.target)); });
    redrawCharts(); setMonth(chartState.month, rows);
  };
  enter($('cash').parentElement, () => { chartState.seen = true; redrawCharts(); });
  enter($('split'), () => { chartState.splitSeen = true; redrawCharts(); });

  $('stages').innerHTML = cfg.stages.map(m => {
    const b = baseMonth({ area: 130, rent: 1000, s: m.students, p: m.subscription, w: m.weekend_shows, a: m.weekend_audience, h: m.parties, c: m.party_check }, cfg);
    return `<div class="stagerow"><div><strong>${m.name} · ${m.period}</strong><small>${m.students} учеников · ${m.weekend_shows} показов · ${m.parties} праздников · выручка ${rub(b.gross)}</small></div><b>${signed(b.profit)}</b></div>`;
  }).join('');
  const margins = cfg.stages.map(m => {
    const a = baseMonth({ area: 130, rent: 1000, s: m.students, p: m.subscription, w: m.weekend_shows, a: m.weekend_audience, h: m.parties, c: m.party_check }, cfg);
    return a.gross > 0 ? a.profit * 100 / a.gross : 0;
  });
  $('marginPts').innerHTML = margins.map((v, i) => `<circle cx="${[27, 200, 364][i]}" cy="${[65, 34, 16][i]}" r="4" fill="currentColor"/><text x="${[27, 200, 364][i]}" y="${[51, 60, 43][i]}" fill="var(--mutedS)" text-anchor="middle" font-size="12">${pct(v)}</text>`).join('');
  enter($('marginSvg'), () => {
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
      $('marginSvg').querySelector('.growth').animate([{ strokeDasharray: '1', strokeDashoffset: 1 }, { strokeDasharray: '1', strokeDashoffset: 0 }], { duration: 900, easing: 'cubic-bezier(.16,1,.3,1)' });
  });
  onChartTheme(redrawCharts);
}

function cashRowsOf(cfg) {
  let cum = 0;
  return cfg.cashflow_12m.months.map(m => { const op = m.tour + m.base - m.fixed; return { ...m, op, net: cum += op - m.cap }; });
}
function budgetTables(cfg) {
  const p1 = [['Регистрация, касса и эквайринг', 45000], ['Куклы, костюмы и ширма', 220000], ['Мобильный звук и свет', 85000], ['Сценарии и методические паспорта', 40000], ['Первый тираж полиграфии', 35000], ['Документы и медосмотры команды', 20000], ['Сайт, съёмка, реклама и учёт клиентов', 65000], ['Оборотный резерв', 90000]];
  const p2 = [['Обеспечительный платёж', 130000], ['Вывеска, шторы и оформление', 110000], ['Сцена, свет и звук', 120000], ['Зеркала, инвентарь, стулья и мебель', 140000], ['Безопасность и оснащение', 35000], ['Стартовая районная реклама', 50000]];
  return table(['Подготовка выездов', 'Бюджет'], p1.map(([a, v]) => [a, rub(v)])) + table(['Открытие студии', 'Бюджет'], p2.map(([a, v]) => [a, rub(v)])) +
    `<p>В ${fmt(cfg.phases_budget.total)} ₽ входят депозит и оборотный резерв — бюджет финансирования, а не только основные средства. Пустое помещение: ${fmt(cfg.phases_budget.empty_room_total)} ₽ до холостой аренды. Экономия на отделке: 130 × 5 000 ₽. Неуплаченная холостая аренда с КУ за 1,5–2 месяца: 234–312 тыс. ₽.</p><p>Наименьший расчётный остаток без начального финансирования: −964 900 ₽ в феврале. Положительный операционный результат не исключает кассового разрыва: нужен платёжный календарь.</p>`;
}
function setMonth(i, rows) {
  chartState.month = i;
  const x = rows[i];
  $('monthRead').innerHTML = `<b>${x.m}: ${signed(x[chartState.view])}</b> · ${x.shows} показов. ${x.note}`;
  $$('#periods button').forEach((b, j) => { b.classList.toggle('on', i === j); b.setAttribute('aria-pressed', String(i === j)); });
  if (chartState.chart) { chartState.chart.data.datasets[0].pointRadius = rows.map((_, j) => j === i ? 5 : 3); chartState.chart.update('none'); }
}
function redrawCharts() {
  if (!window.Chart) return;
  const rows = cashRowsOf(CFG);
  if (chartState.seen) drawCash('cash', rows, chartState.view, chartState);
  if (chartState.splitSeen) drawSplit('split', rows, chartState);
}

/* ==== Калькуляторы ==== */
function presetChips(mod, cfg) {
  if (mod.meta.id === 'travel') return `<div class="chips" id="quick" role="group" aria-label="Пресеты выезда">${cfg.presets_travel.map((s, i) => `<button class="chip" data-preset="${i}">${s.name}</button>`).join('')}</div>`;
  if (mod.meta.id === 'basecamp') return `<div class="chips" id="basePresets" role="group" aria-label="Стадии базы">${cfg.stages.map((s, i) => `<button class="chip" data-stage="${i}">${i === 1 ? s.name + ' · база на Богдашке' : s.name}</button>`).join('')}</div>`;
  return '';
}

function initCalc(cfg) {
  $('calcnav').innerHTML = registry.map((m, i) => `<button class="mode ${i ? '' : 'on'}" role="tab" aria-pressed="${i === 0}">${ic(m.meta.icon)}${m.meta.title}<small>${m.meta.when}</small></button>`).join('');
  $('calcnav').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const i = [...$('calcnav').children].indexOf(b);
    $$('#calcpanels > div').forEach((p, j) => p.hidden = j !== i);
    $$('#calcnav .mode').forEach((m, j) => { m.classList.toggle('on', i === j); m.setAttribute('aria-pressed', String(i === j)); });
  };
  $('calcpanels').innerHTML = registry.map((m, i) => {
    const fields = m.controls(cfg);
    return `<div id="calc-${m.meta.id}" class="calcgrid" role="tabpanel" ${i ? 'hidden' : ''}>
      <article class="card rv">
        <div class="calcdesc"><b>Что считает:</b> ${m.meta.what}</div>
        <div class="calcdesc"><b>Когда использовать:</b> ${m.meta.when}</div>
        ${presetChips(m, cfg)}
        <div class="controls">${fields.map(fieldHTML).join('')}</div>
        <div class="toolrow">
          <button class="btn small secondary" data-act="reset">${ic('rotate-ccw')}<span>Сбросить</span></button>
          <button class="btn small secondary" data-act="save">${ic('bookmark')}<span>Сохранить сценарий</span></button>
          <button class="btn small secondary" data-act="compare">${ic('git-compare-arrows')}<span>Сравнить с сохранённым</span></button>
          <button class="btn small secondary" data-act="print">${ic('printer')}<span>Печать / PDF</span></button>
        </div>
        <details><summary>Допущения и источники данных</summary><p>${METHOD[m.meta.id] || ''}</p></details>
      </article>
      <article class="card result rv" id="res-${m.meta.id}" aria-live="polite"></article>
    </div>`;
  }).join('');

  // Пресеты
  const travelPanel = $('calc-travel');
  travelPanel.querySelector('#quick').onclick = e => {
    const b = e.target.closest('[data-preset]'); if (!b) return;
    const s = cfg.presets_travel[+b.dataset.preset];
    Object.entries({ kids: s.n, ticket: s.p, cluster: s.k, route: s.r, venue: s.dk, cast: s.own }).forEach(([k, v]) => { const el = $(k); if (el) el.value = v; });
    rerender('travel');
  };
  const basePanel = $('calc-basecamp');
  basePanel.querySelector('#basePresets').onclick = e => {
    const b = e.target.closest('[data-stage]'); if (!b) return;
    const m = cfg.stages[+b.dataset.stage];
    Object.entries({ area: 130, rent: 1000, students: m.students, sub: m.subscription, week: m.weekend_shows, party: m.parties, attendance: m.weekend_audience, eventprice: m.party_check }).forEach(([k, v]) => { const el = $(k); if (el) el.value = v; });
    rerender('basecamp');
  };

  // Ввод
  $('calcpanels').addEventListener('input', e => { if (e.target.matches('input,select')) rerender(activeCalcId()); });
  $('calcpanels').addEventListener('change', e => { if (e.target.matches('select')) rerender(activeCalcId()); });

  // Тулбар
  $('calcpanels').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = activeCalcId();
    if (b.dataset.act === 'reset') {
      const mod = registry.find(m => m.meta.id === id);
      mod.controls(CFG).forEach(f => { const el = $(f.id); if (el) el.value = f.def != null ? f.def : (f.options ? f.options[0][0] : ''); });
      rerender(id);
    }
    if (b.dataset.act === 'save') {
      store.set('scen.' + id, { inputs: currentInputs(id), headline: lastHeadline[id], at: new Date().toISOString() });
      toast('Сценарий сохранён в этом браузере');
    }
    if (b.dataset.act === 'compare') {
      const saved = store.get('scen.' + id, null);
      const cur = lastHeadline[id];
      if (!saved || !saved.headline) { toast('Сначала сохраните сценарий'); return; }
      const el = $('res-' + id);
      el.insertAdjacentHTML('afterbegin', `<div class="advice warn"><strong>Сравнение с сохранённым (${new Date(saved.at).toLocaleDateString('ru-RU')})</strong>Сохранённый: <b>${saved.headline}</b> · Текущий: <b>${cur || '—'}</b></div>`);
    }
    if (b.dataset.act === 'print') window.print();
    // «Ввести вручную» для no_data
    if (b.dataset.fill) {
      const v = prompt('Введите проверенное значение (₽/год):');
      if (v != null && !isNaN(+v) && +v >= 0) {
        store.set('ovr.' + b.dataset.fill, +v);
        applyOverrides(); rerender(id); toast('Значение сохранено (переопределение в этом браузере)');
      }
    }
  });

  registry.forEach(m => rerender(m.meta.id));
}
function activeCalcId() { return registry[[...$('calcpanels').children].findIndex(p => !p.hidden)].meta.id; }
function currentInputs(id) {
  const mod = registry.find(m => m.meta.id === id);
  return readInputs(mod.controls(CFG));
}
function rerender(id) {
  const mod = registry.find(m => m.meta.id === id);
  const fields = mod.controls(CFG);
  rangeValues(fields);
  const inputs = readInputs(fields);
  const result = mod.calc(inputs, CFG, DATA.market);
  const el = $('res-' + id);
  el.innerHTML = renderResult(mod, inputs, CFG, result, DATA);
  const big = el.querySelector('.big-num');
  lastHeadline[id] = big ? big.textContent.trim() : rub(result.profit ?? 0);
  icons();
}
function applyOverrides() {
  // ручные переопределения «нет данных» (только в этом браузере)
  const patent = store.get('ovr.patent', null);
  if (patent != null) CFG.patentPotential = patent;
}

/* ==== Навигатор рынка ==== */
function initMarket(cfg, competitors, market) {
  const cards = [
    ...competitors.outbound_performers.map(c => ({ icon: 'drama', t: c.name, d: `${c.status === 'public' ? 'Публичное предложение' : c.status === 'historical' ? 'Подтверждённый прошлый выезд' : c.status === 'mixed' ? 'Разночтения о статусе' : 'Ориентир'} · ${c.address}. ${c.program}. ${c.price != null ? 'Цена: ' + c.price + ' ₽ (' + (c.price_note || '') + ')' : (c.price_note || 'Цена: нет данных')}`, url: c.url })),
    ...competitors.studio_scene.map(c => ({ icon: 'users', t: c.name, d: `${c.address}. ${c.price != null ? c.price + ' ₽/' + (c.price_unit || 'мес') + '. ' : ''}${c.price_note || ''}`, url: c.url })),
    ...competitors.party_venues.map(c => ({ icon: 'cake', t: c.name, d: `${c.address}. ${c.hour_rate ? c.hour_rate + ' ₽/час. ' : ''}${c.packages ? 'Пакеты: ' + c.packages.map(p => p.name + ' ' + fmt(p.price) + ' ₽').join(', ') + '. ' : ''}${c.price_note || ''}`, url: c.url })),
    ...competitors.stationary_benchmarks.map(c => ({ icon: 'ticket', t: c.name, d: `${c.address}. ${c.price_note}`, url: c.url }))
  ];
  const filters = ['Все', 'Выездные', 'Студии', 'Лофты', 'Ориентиры'];
  $('marketCards').innerHTML =
    `<div class="filters" role="group" aria-label="Фильтр конкурентов">${filters.map((f, i) => `<button class="chip ${i ? '' : 'on'}" data-f="${i}">${f}</button>`).join('')}</div>` +
    `<div class="rivals">${cards.map((c, i) => rivalCard(c, i)).join('')}</div>`;
  $('marketCards').querySelector('.filters').onclick = e => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    $$('#marketCards .filters .chip').forEach(x => x.classList.toggle('on', x === b));
    const f = +b.dataset.f;
    $$('#marketCards .rival').forEach((el, i) => {
      const group = i < 9 ? 1 : i < 14 ? 2 : i < 17 ? 3 : 4;
      el.style.display = (f === 0 || group === f) ? '' : 'none';
    });
  };
  // Спрос: без источника — честная заглушка
  const d = market.demand || {};
  $('demandBox').innerHTML = d.status === 'no_source'
    ? `<div class="nodata"><strong>Спрос по запросам — подключите источник</strong>
       <span>Wordstat требует официальный API-токен (см. DATA_SOURCES.md). Без токена график не строится и не имитируется.</span>
       <span class="tiny">Запросы-кандидаты: ${(d.queries || []).join(' · ')}</span>
       <button class="btn small secondary" id="demandManual">Ввести данные вручную</button></div>`
    : '';
  const dm = $('demandManual');
  if (dm) dm.onclick = () => {
    const v = prompt('Вставьте данные Wordstat (запрос: показы в месяц, через запятую):');
    if (v) { store.set('ovr.demand', v); toast('Сохранено в этом браузере — построение графика запланировано (см. HANDOFF)'); }
  };
  // Сезонность модели + календарь
  const s = market.seasonality_model || { months: [] };
  const maxS = Math.max(...s.months.map(m => m.shows), 1);
  $('seasonStrip').innerHTML = s.months.map(m =>
    `<div class="cal-m"><b>${m.m}</b><span class="bar"><span style="height:${m.shows / maxS * 100}%"></span></span>${m.shows}</div>`).join('');
  $('chartMeta').innerHTML = `Источник: модель проекта · Обновлено: ${(market.fetched_at || '—')} · Надёжность: средняя (не рыночная статистика)`;
  const cal = market.school_calendar || { holidays: [] };
  $('holidayList').innerHTML = cal.holidays.map(h => `<span class="chip">${h.name} — ${h.approx}${h.peak ? ' · ' + h.peak : ''}</span>`).join('') +
    `<p class="hint" style="margin-top:10px">${cal.note || ''}</p>`;
  // Сеть учреждений
  $('networkStats').innerHTML = table(['Территория', 'Подтверждённый масштаб'], (market.network_stats || []).map(n => [n.area, n.stat]));
}
function rivalCard(c, i) {
  return `<article class="card rival rv"><h4>${ic(c.icon)}${c.t}</h4><p>${c.d}</p>${c.url ? `<a class="chip tag" target="_blank" rel="noopener" href="${c.url}" style="text-decoration:none">Источник ↗</a>` : ''}</article>`;
}

/* ==== Справочник ==== */
function initGuide(guide) {
  const cats = guide.categories;
  $('guideTabs').innerHTML = cats.map((c, i) => `<button class="tab ${i === 0 ? 'on' : ''}" role="tab" aria-pressed="${i === 0}">${c}</button>`).join('');
  $('guideTabs').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    guideState.cat = [...$('guideTabs').children].indexOf(b);
    $('q').value = '';
    guideView();
  };
  $('q').oninput = guideView;
  guideView();

  fetch('data/archive.html').then(r => r.ok ? r.text() : Promise.reject(r.status))
    .then(html => { $('archiveBody').innerHTML = html; })
    .catch(() => { $('archiveBody').innerHTML = '<p class="hint">Архив недоступен без сети.</p>'; });
}
const guideState = { cat: 0 };
function guideView() {
  const guide = DATA.guide;
  let q = $('q').value.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е');
  const rows = guide.entries.filter(([k, t, d]) => q ? (t + ' ' + d.replace(/<[^>]+>/g, '')).toLocaleLowerCase('ru').replaceAll('ё', 'е').includes(q) : k === guideState.cat);
  $$('#guideTabs .tab').forEach((b, i) => { b.classList.toggle('on', !q && guideState.cat === i); b.setAttribute('aria-pressed', String(!q && guideState.cat === i)); });
  $('found').textContent = q ? `Поиск по всем разделам · найдено ${rows.length}` : `${guide.categories[guideState.cat]} · материалов: ${rows.length}`;
  if (!rows.length) { $('entries').innerHTML = q ? '<p class="hint">Ничего не найдено. Попробуйте «лицензия», «ПДД» или название площадки.</p>' : ''; return; }
  if (guideState.cat === 2 && !q) {
    $('entries').innerHTML = `<div class="risk-grid">${rows.map(([k, t, d, v]) => {
      const cut = d.indexOf('. ');
      const head = cut > 0 ? d.slice(0, cut) : '';
      const body = cut > 0 ? d.slice(cut + 2) : d;
      const title = t.split(' · ').slice(1).join(' · ') || t;
      return `<div class="risk"><div class="rt">${ic('triangle-alert')}<span>${title}</span></div><div class="tiny"><b>${head}.</b></div><div class="arrow" aria-hidden="true">↓ Решение</div><p>${body}</p></div>`;
    }).join('')}</div>`;
  } else if (guideState.cat === 3 && !q) {
    $('entries').innerHTML = `<div class="templates">${rows.filter(r => r[3] === 'Шаблон').map(([k, t, d]) => `<details class="tmpl"><summary>${t.replace('Шаблон: ', '')}<span class="plus">+</span></summary><pre>${d}</pre></details>`).join('')}</div>
      <h3 style="margin:18px 0 10px">Словарь терминов</h3><div class="dict">${rows.filter(r => r[3] === 'Справка').map(([k, t, d]) => d.split('. ').filter(Boolean).map(s => { const [w, ...rest] = s.split(' — '); return `<div><b>${w}</b><span>${rest.join(' — ')}</span></div>`; }).join('')).join('')}</div>`;
  } else {
    $('entries').innerHTML = `<div class="items">${rows.map(([k, t, d, v]) => `<details class="item"><summary>${t}<span class="plus">+</span></summary><p>${d}</p>${v ? `<span class="verify">${v}</span>` : ''}</details>`).join('')}</div>`;
  }
  icons();
}

/* ==== Чек-лист ==== */
function initChecklist(cfg) {
  const saved = store.get('checks', Array(10).fill(false));
  const a = Array.from({ length: cfg.checklist_30d.length }, (_, i) => Array.isArray(saved) && saved[i] === true);
  $('checks').innerHTML = cfg.checklist_30d.map(([d, t, s], i) => `<label class="checkrow"><input type="checkbox" data-i="${i}" ${a[i] ? 'checked' : ''}><span class="cbody"><span class="days">${d}</span><strong>${t}</strong><small>${s}</small></span></label>`).join('');
  const note = store.get('note', '');
  $('note').value = typeof note === 'string' ? note : '';
  const status = () => { $('saved').textContent = store.ok ? 'Заметки и отметки сохраняются только в этом браузере.' : 'Хранилище недоступно: изменения живут до закрытия страницы.'; };
  const tally = () => { const n = a.filter(Boolean).length; $('checkbar').style.width = n * 10 + '%'; $('checkcount').textContent = `${n} из 10 · ${n * 10}%`; status(); };
  $('checks').onchange = e => { if (e.target.matches('input')) { a[+e.target.dataset.i] = e.target.checked; store.set('checks', a); tally(); } };
  $('note').oninput = () => { store.set('note', $('note').value); status(); };
  tally();
}

/* ==== Старт ==== */
(async function main() {
  DATA = await loadAll();
  if (!DATA.config || !DATA.rates) {
    document.getElementById('main').insertAdjacentHTML('afterbegin', '<div class="advice warn"><strong>Данные не загрузились</strong>Проверьте соединение и обновите страницу. Архив и статические разделы продолжают работать.</div>');
    DATA.config = {};
    DATA.rates = { tax: {} };
  }
  CFG = buildCalcConfig(DATA);
  applyOverrides();

  initTheme();
  initNav();
  initVeil();
  initOverview(CFG);
  initCalc(CFG);
  initMarket(CFG, DATA.competitors || { outbound_performers: [], studio_scene: [], party_venues: [], stationary_benchmarks: [] }, DATA.market || {});
  setMapConfig(CFG);
  initMap(DATA.regions || { points: [], region_routes: [], home_zone_radius_m: 1250 }, CFG);
  initGuide(DATA.guide || { categories: [], entries: [] });
  initChecklist(CFG);
  initReveal();
  icons();
})();
