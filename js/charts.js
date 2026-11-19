/* charts.js — фабрика монохромных графиков Chart.js, лениво и с обновлением темы */
import { $, fmt, enter, reduced } from './ui/helpers.js';
import { isDark, onThemeChange } from './theme.js';

export function chartColors() {
  const dark = isDark();
  return {
    line: dark ? '#F5F5F7' : '#1C1C1E',
    tick: dark ? '#8E8E93' : '#2C2C2E',
    grid: dark ? '#2C2C2E' : '#E5E5EA',
    fill: dark ? 'rgba(245,245,247,.10)' : 'rgba(142,142,147,.14)',
    soft: 'rgba(142,142,147,.45)',
    cardBg: dark ? '#161618' : '#FFFFFF'
  };
}

const redraws = new Set();
onThemeChange(() => redraws.forEach(fn => fn()));
export function onChartTheme(fn) { redraws.add(fn); }

export function baseOptions(extra = {}) {
  const c = chartColors();
  return {
    responsive: true, maintainAspectRatio: false, locale: 'ru-RU',
    animation: reduced ? false : { duration: 680 },
    plugins: {
      legend: { display: false },
      tooltip: { displayColors: false, ...(extra.tooltip || {}) }
    },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { color: c.tick, font: { size: 11 }, autoSkip: false, maxRotation: 0 } },
      y: { beginAtZero: true, grid: { color: c.grid }, border: { display: false }, ticks: { color: c.tick, maxTicksLimit: 5, callback: v => fmt(v), font: { size: 11 } } }
    },
    ...extra.scalesOverride
  };
}

/* Линейный/столбчатый денежный поток: view 'net' | 'op' */
export function drawCash(canvas, rows, view, state) {
  if (!window.Chart) return null;
  const c = chartColors();
  const v = rows.map(x => x[view] / 1000);
  const el = typeof canvas === 'string' ? $(canvas) : canvas;
  if (state.chart) state.chart.destroy();
  state.chart = new Chart(el, {
    type: view === 'net' ? 'line' : 'bar',
    data: {
      labels: rows.map(x => x.short),
      datasets: [{
        label: view === 'net' ? 'Баланс с учётом стартовых вложений' : 'Прибыль за месяц',
        data: v, borderColor: c.line, backgroundColor: view === 'net' ? c.fill : c.line,
        fill: view === 'net', tension: .22, borderWidth: view === 'net' ? 3 : 0,
        pointRadius: rows.map((_, j) => j === state.month ? 5 : 3),
        pointBackgroundColor: c.line, pointBorderColor: c.cardBg, pointBorderWidth: 1.5,
        borderRadius: 5, barPercentage: .57, maxBarThickness: 44
      }]
    },
    options: baseOptions({
      tooltip: { callbacks: { label: it => signed(it.raw * 1000) } },
      scalesOverride: {}
    })
  });
  return state.chart;
}

/* Сгруппированные столбцы: выезды vs база */
export function drawSplit(canvas, rows, state) {
  if (!window.Chart) return null;
  const c = chartColors();
  const el = typeof canvas === 'string' ? $(canvas) : canvas;
  if (state.split) state.split.destroy();
  state.split = new Chart(el, {
    type: 'bar',
    data: {
      labels: rows.map(x => x.short),
      datasets: [
        { label: 'Выезды', data: rows.map(x => x.tour / 1000), backgroundColor: c.line, borderRadius: 5, barPercentage: .8, categoryPercentage: .72 },
        { label: 'База', data: rows.map(x => x.base / 1000), backgroundColor: c.soft, borderColor: c.grid, borderWidth: 1, borderRadius: 5, barPercentage: .8, categoryPercentage: .72 }
      ]
    },
    options: baseOptions({ tooltip: { callbacks: { label: it => it.dataset.label + ': ' + signed(it.raw * 1000) } } })
  });
  return state.split;
}

function signed(v) { return (Math.round(v) > 0 ? '+' : '') + fmt(v) + ' ₽'; }

/* Ленивая отрисовка при попадании в вьюпорт */
export function drawWhenVisible(el, fn) { enter(el, fn); }
