/* overview.js — раздел «Обзор» и схемы проекта: bento-KPI, график денежного потока, рост базы, смета фаз.
   Все числа берутся из data/config.json (через cfg); единственное допущение проекта — площадь базы. */
import { $, $$, fmt, rub, signed, pct, ic, table, enter, counter, popNumber, motionOK } from './ui/helpers.js';
import { drawCash, drawSplit, onChartTheme } from './charts.js';
import { baseMonth } from './calculators/basecamp.js';
import { state } from './state.js';

const chartState = { chart: null, split: null, month: 8, view: 'net', seen: false, splitSeen: false };
const SPRING = 'cubic-bezier(.16,1,.3,1)';

/* Предположение проекта: площадь базы на Богдашке (в data/config.json пока нет поля area) */
const PROJECT_AREA = 130;

/* Данные могут приходить с провенансом ({value, unit, source_name, …}) или плоскими — читаем оба вида */
const U = x => (x && typeof x === 'object' && !Array.isArray(x) && 'value' in x) ? x.value : x;
const flat = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, U(v)]));

export function initOverview(cfg) {
  const rows = cashRowsOf(cfg);
  const pb = flat(cfg.phases_budget), bc = flat(cfg.base_costs), tu = flat(cfg.tour_unit);

  /* ---------- KPI: каждое число — из данных или явно помечено допущением ---------- */
  const payIdx = rows.findIndex(x => x.net >= 0);
  const zeroShows = tu.unit_small > 0 && pb.phase1_fixed_month > 0 ? Math.ceil(pb.phase1_fixed_month / tu.unit_small) : null;
  const metrics = [
    ['wallet', 'Бюджет запуска', pb.total, '₽', 'Две фазы: выезды и студия'],
    ['paint-roller', 'Экономия', pb.renovation_saving, '₽', 'На готовом ремонте'],
    ['key-round', 'Аренда', bc.rent_per_m2, '₽/м²', 'Предположение проекта'],
    ['ruler', 'База', PROJECT_AREA, 'м²', 'Предположение проекта'],
    ['ticket', 'Операционный ноль', zeroShows, 'показов', 'В месяц при фиксе фазы 1'],
    ['timer', 'Окупаемость', payIdx >= 0 ? payIdx + 1 : null, 'мес.', payIdx >= 0 ? (rows[payIdx].projected ? 'По проекции модели' : 'По расчёту') : 'За 12 месяцев не наступает']
  ];
  $('kpis').innerHTML = metrics.map(([i, l, v, u, h]) => {
    const num = v == null ? '<span class="muted">нет данных</span>' : `<span data-target="${v}">${fmt(v)}</span> <small class="unit">${u}</small>`;
    return `<article class="kpi rv"><div class="kphead"><span class="kicon">${ic(i)}</span>${l}</div><div class="num">${num}</div><p>${h}</p></article>`;
  }).join('');
  $$('[data-target]').forEach(e => enter(e, () => counter(e)));

  /* Дата обновления данных показывается один раз — в блоке «Сегодня» (js/today.js); p#dataStatus в hero занимает
     кнопка «Обновить данные» (js/live-data.js) — без повтора одной и той же информации трижды подряд */

  /* Короткий лид (≤2 строк) со значениями из данных */
  const t = flat(cfg.ticket);
  if (isFinite(t.min) && isFinite(t.max)) $('lead').textContent = `Выезды по ${t.min}–${t.max} ₽ с декабря 2026, своя база ${PROJECT_AREA} м² — с февраля 2027.`;

  fillSchemes(cfg);

  /* ---------- Аналитика ---------- */
  $('budget').innerHTML = budgetTables(cfg, rows);
  $('cashTable').innerHTML = table(['Месяц', 'Показы', 'Выезды', 'База', 'Фикс', 'Вложения', 'Прибыль', 'Баланс'], rows.map(x => [x.m + (x.projected ? ' *' : ''), x.shows, ...[x.tour, x.base, x.fixed, x.cap, x.op, x.net].map(rub)]));
  $('periods').innerHTML = rows.map((x, i) => `<button type="button" data-m="${i}" aria-label="${x.m}" aria-pressed="${i === 8}">${x.short}</button>`).join('');
  $('periods').onclick = e => { const b = e.target.closest('button[data-m]'); if (b) setMonth(+b.dataset.m, rows); };
  setMonth(8, rows, true);
  $('chartSwitch').onclick = e => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    chartState.view = b.dataset.view;
    $$('#chartSwitch button').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    redrawCharts(); setMonth(chartState.month, rows);
  };
  enter($('cash').parentElement, () => { chartState.seen = true; redrawCharts(); });
  enter($('split'), () => { chartState.splitSeen = true; redrawCharts(); });

  /* ---------- Как растёт база ---------- */
  const stages = U(cfg.stages) || [];
  const stageCalc = stages.map(m => baseMonth({ area: PROJECT_AREA, rent: bc.rent_per_m2, s: m.students, p: m.subscription, w: m.weekend_shows, a: m.weekend_audience, h: m.parties, c: m.party_check }, cfg));
  $('stages').innerHTML = stages.map((m, i) => `<div class="stagerow"><div><strong>${m.name} · ${m.period}</strong><small>${m.students} учеников · ${m.weekend_shows} показов · ${m.parties} праздников · выручка ${rub(stageCalc[i].gross)}</small></div><b>${signed(stageCalc[i].profit)}</b></div>`).join('');
  const margins = stageCalc.map(a => a.gross > 0 ? a.profit * 100 / a.gross : 0);
  drawMargin(stages.map(m => m.name), margins);
  enter($('marginSvg'), () => animateMargin());
  onChartTheme(redrawCharts);
}

function cashRowsOf(cfg) {
  let cum = 0;
  return U(cfg.cashflow_12m).months.map(m => { const op = m.tour + m.base - m.fixed; return { ...m, op, net: cum += op - m.cap }; });
}

/* ---------- Схемы: подстановка чисел из данных ---------- */
function fillSchemes(cfg) {
  const pb = flat(cfg.phases_budget), st = U(cfg.stages) || [], bc = flat(cfg.base_costs), t = flat(cfg.ticket), tc = flat(cfg.travel_costs);
  const rng = (arr, f = x => x) => { const lo = Math.min(...arr), hi = Math.max(...arr); return lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`; };
  const V = {
    phase1: () => rub(pb.phase1), phase2: () => rub(pb.phase2), total: () => rub(pb.total),
    fix1: () => rub(pb.phase1_fixed_month) + '/мес', fix2: () => rub(pb.phase2_fixed_month) + '/мес',
    saving: () => rub(pb.renovation_saving), empty: () => rub(pb.empty_room_total),
    ticket: () => `${t.min}–${t.max} ₽`,
    print: () => rub(tc.print_per_viewer) + '/зритель',
    sub: () => rng(st.map(s => s.subscription), v => fmt(v)) + ' ₽/мес',
    party: () => rng(st.map(s => s.party_check), v => fmt(v / 1000)) + ' тыс. ₽',
    area: () => `${PROJECT_AREA}`,
    rent: () => rub(bc.rent_per_m2) + '/м²'
  };
  $$('[data-v]').forEach(el => {
    let out = '—';
    try { out = V[el.dataset.v](); if (/undefined|NaN/.test(out)) out = '—'; } catch (e) { out = '—'; }
    el.textContent = out;
  });
}

/* ---------- Смета: статьи и суммы из data/config.json (phases_budget_items), сверка с бюджетом фаз ---------- */
function budgetTables(cfg, rows) {
  const pb = flat(cfg.phases_budget), bc = flat(cfg.base_costs);
  const items = U(cfg.phases_budget_items);
  const sum = a => a.reduce((s, [, v]) => s + v, 0);
  const idle = (bc.rent_per_m2 + bc.utilities_per_m2) * PROJECT_AREA;
  const low = rows.reduce((m, x) => x.net < m.net ? x : m, rows[0]);
  const check = (arr, total, name) => sum(arr) === total ? '' : `<div class="advice warn"><strong>Смета не сходится</strong>Статьи ${name} в сумме ${rub(sum(arr))}, а бюджет фазы в данных — ${rub(total)}.</div>`;
  const part = (title, arr, total, name) => table([title, 'Бюджет'], [...arr.map(([a, v]) => [a, rub(v)]), ['<b>Итого</b>', `<b>${rub(sum(arr))}</b>`]]) + check(arr, total, name);
  const tables = items && items.phase1 && items.phase2
    ? part('Подготовка выездов', items.phase1, pb.phase1, 'фазы 1') + part('Открытие студии', items.phase2, pb.phase2, 'фазы 2')
    : '<div class="nodata"><strong>Нет данных: статьи сметы</strong><span>В data/config.json нет phases_budget_items.</span></div>';
  return tables +
    `<div class="ledger" style="margin:14px 0 4px">
      <div class="kv"><span>Бюджет финансирования</span><b>${rub(pb.total)}</b></div>
      <div class="kv"><span>Пустое помещение до холостой аренды</span><b>${rub(pb.empty_room_total)}</b></div>
      <div class="kv"><span>Холостая аренда с КУ, 1,5–2 мес. (допущение)</span><b>${rub(idle * 1.5)} – ${rub(idle * 2)}</b></div>
      <div class="kv"><span>Наименьший остаток без финансирования</span><b>${signed(low.net)} · ${low.m}</b></div>
    </div>
    <p>Положительная прибыль не исключает кассового разрыва: нужен платёжный календарь.</p>`;
}

/* ---------- Выбор месяца ---------- */
function setMonth(i, rows, silent) {
  chartState.month = i;
  const x = rows[i];
  const el = $('monthRead');
  el.innerHTML = `<b>${x.m}: ${signed(x[chartState.view])}</b> · ${x.shows} показов<small class="tiny" style="display:block;margin-top:2px">${x.note}</small>`;
  if (!silent) popNumber(el);
  $$('#periods button').forEach((b, j) => { b.classList.toggle('on', i === j); b.setAttribute('aria-pressed', String(i === j)); });
  if (chartState.chart) { chartState.chart.data.datasets[0].pointRadius = rows.map((_, j) => j === i ? 5 : 3); chartState.chart.update('none'); }
}
function redrawCharts() {
  if (!window.Chart || !state.CFG) return;
  const rows = cashRowsOf(state.CFG);
  if (chartState.seen) drawCash('cash', rows, chartState.view, chartState);
  if (chartState.splitSeen) drawSplit('split', rows, chartState);
}

/* ---------- Рентабельность по стадиям: точки и линия считаются из данных ---------- */
function drawMargin(names, margins) {
  const svg = $('marginSvg'), W = 320, X = [48, 160, 272], top = 34, base = 86;
  const lo = Math.min(0, ...margins), hi = Math.max(...margins, lo + 1);
  const y = v => base - (v - lo) / (hi - lo) * (base - top);
  const pts = margins.map((v, i) => [X[i] ?? W / 2, y(v)]);
  svg.setAttribute('aria-label', 'Рентабельность по стадиям: ' + names.map((n, i) => `${n} ${pct(margins[i])}`).join(', '));
  svg.querySelector('.zero').setAttribute('d', `M8 ${y(0).toFixed(1)}H${W - 8}`);
  svg.querySelector('.growth').setAttribute('d', pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py.toFixed(1)}`).join(' '));
  $('marginPts').innerHTML = pts.map(([px, py], i) =>
    `<g class="mp"><circle cx="${px}" cy="${py.toFixed(1)}" r="5" fill="currentColor"/>` +
    `<text x="${px}" y="${(py - 12).toFixed(1)}" fill="currentColor" text-anchor="middle" font-weight="700" font-size="13">${pct(margins[i])}</text>` +
    `<text x="${px}" y="108" fill="var(--mutedS)" text-anchor="middle" font-size="12">${names[i] || ''}</text></g>`).join('');
}
function animateMargin() {
  if (!motionOK()) return;
  const svg = $('marginSvg');
  svg.querySelector('.growth').animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 800, easing: SPRING });
  $$('.mp', svg).forEach((g, i) => g.animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'none' }], { duration: 650, delay: 120 + i * 120, easing: SPRING, fill: 'backwards' }));
}
