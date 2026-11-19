/* overview.js — раздел «Обзор»: KPI, график денежного потока, рост базы, смета фаз. */
import { $, $$, fmt, rub, signed, pct, ic, table, enter, counter } from './ui/helpers.js';
import { drawCash, drawSplit, onChartTheme } from './charts.js';
import { baseMonth } from './calculators/basecamp.js';
import { state } from './state.js';

const chartState = { chart: null, split: null, month: 8, view: 'net', seen: false, splitSeen: false };

export function initOverview(cfg) {
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
  const meta = state.DATA.meta || {};
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
  if (!window.Chart || !state.CFG) return;
  const rows = cashRowsOf(state.CFG);
  if (chartState.seen) drawCash('cash', rows, chartState.view, chartState);
  if (chartState.splitSeen) drawSplit('split', rows, chartState);
}
