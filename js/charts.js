/* charts.js — фабрика монохромных графиков Chart.js: цвета берутся из CSS-токенов,
   рисуются лениво, перерисовываются при смене темы (событие yulia:theme → theme.js), с доступным описанием. */
import { $, fmt, enter, motionOK } from './ui/helpers.js';
import { onThemeChange } from './theme.js';

/* Читает значение CSS-токена (уже разрешённое браузером, например #1C1C1E) */
function token(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}
/* Прозрачность поверх HEX-токена (производная палитры) */
function alpha(hex, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

export function chartColors() {
  const text = token('--text', '#1C1C1E');
  const silver = token('--silver', '#8E8E93');
  return {
    line: text,                              // основная линия и столбцы
    tick: token('--mutedS', '#2C2C2E'),      // подписи осей — AA-контрастный вторичный текст
    grid: token('--line', '#E5E5EA'),
    fill: alpha(silver, .16),                // заливка под линией
    soft: alpha(silver, .55),                // второй ряд столбцов
    cardBg: token('--card', '#FFFFFF'),
    tipBg: token('--card', '#FFFFFF'),
    tipText: text,
    font: getComputedStyle(document.body).fontFamily
  };
}

/* Перерисовка при смене темы: тихо, без повторной анимации */
let quiet = false;
const redraws = new Set();
onThemeChange(() => {
  quiet = true;
  try { redraws.forEach(fn => fn()); } finally { quiet = false; }
});
export function onChartTheme(fn) { redraws.add(fn); }

export function baseOptions(extra = {}) {
  const c = chartColors();
  return {
    responsive: true, maintainAspectRatio: false, locale: 'ru-RU',
    animation: (!motionOK() || quiet) ? false : { duration: 800, easing: 'easeOutExpo' },
    interaction: { mode: 'index', intersect: false },
    font: { family: c.font },
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false, backgroundColor: c.tipBg, titleColor: c.tipText, bodyColor: c.tipText,
        borderColor: c.grid, borderWidth: 1, cornerRadius: 12, padding: 10,
        titleFont: { family: c.font, weight: '700' }, bodyFont: { family: c.font },
        ...(extra.tooltip || {})
      }
    },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { color: c.tick, font: { size: 11, family: c.font }, autoSkip: true, maxRotation: 0 } },
      y: { beginAtZero: true, grid: { color: c.grid }, border: { display: false }, ticks: { color: c.tick, maxTicksLimit: 5, callback: v => fmt(v), font: { size: 11, family: c.font } } }
    },
    ...extra.scalesOverride
  };
}

/* Текстовое описание графика для скринридеров: диапазон, минимум и максимум */
function describe(label, rows, key, unit) {
  const vals = rows.map(x => x[key]);
  let lo = 0, hi = 0;
  vals.forEach((v, i) => { if (v < vals[lo]) lo = i; if (v > vals[hi]) hi = i; });
  return `${label}. ${rows[0].m} — ${rows[rows.length - 1].m}: от ${signed(vals[0])} до ${signed(vals[vals.length - 1])}. ` +
    `Минимум ${signed(vals[lo])} (${rows[lo].m}), максимум ${signed(vals[hi])} (${rows[hi].m}). ${unit}`;
}

/* Линейный/столбчатый денежный поток: view 'net' | 'op' */
export function drawCash(canvas, rows, view, state) {
  if (!window.Chart) return null;
  const c = chartColors();
  const v = rows.map(x => x[view] / 1000);
  const el = typeof canvas === 'string' ? $(canvas) : canvas;
  if (state.chart) state.chart.destroy();
  const label = view === 'net' ? 'Баланс с учётом стартовых вложений' : 'Прибыль за месяц';
  el.setAttribute('aria-label', describe(label, rows, view, 'Таблица со всеми месяцами — под графиком.'));
  state.chart = new Chart(el, {
    type: view === 'net' ? 'line' : 'bar',
    data: {
      labels: rows.map(x => x.short),
      datasets: [{
        label,
        data: v, borderColor: c.line, backgroundColor: view === 'net' ? c.fill : c.line,
        fill: view === 'net', tension: .22, borderWidth: view === 'net' ? 3 : 0,
        pointRadius: rows.map((_, j) => j === state.month ? 5 : 3), pointHoverRadius: 6,
        pointBackgroundColor: c.line, pointBorderColor: c.cardBg, pointBorderWidth: 1.5,
        borderRadius: 6, barPercentage: .57, maxBarThickness: 44
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
  const tour = rows.reduce((a, x) => a + x.tour, 0), base = rows.reduce((a, x) => a + x.base, 0);
  el.setAttribute('aria-label', `Вклад выездов и базы по месяцам, ${rows[0].m} — ${rows[rows.length - 1].m}. Выезды за период: ${signed(tour)}, база: ${signed(base)}.`);
  state.split = new Chart(el, {
    type: 'bar',
    data: {
      labels: rows.map(x => x.short),
      datasets: [
        { label: 'Выезды', data: rows.map(x => x.tour / 1000), backgroundColor: c.line, borderRadius: 6, barPercentage: .8, categoryPercentage: .72 },
        { label: 'База', data: rows.map(x => x.base / 1000), backgroundColor: c.soft, borderColor: c.grid, borderWidth: 1, borderRadius: 6, barPercentage: .8, categoryPercentage: .72 }
      ]
    },
    options: baseOptions({ tooltip: { callbacks: { label: it => it.dataset.label + ': ' + signed(it.raw * 1000) } } })
  });
  return state.split;
}

function signed(v) { return (Math.round(v) > 0 ? '+' : '') + fmt(v) + ' ₽'; }

/* Ленивая отрисовка при попадании в вьюпорт */
export function drawWhenVisible(el, fn) { enter(el, fn); }
