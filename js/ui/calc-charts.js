/* calc-charts.js — монохромные SVG/CSS-графики калькуляторов (строки HTML, без внешних библиотек).
   Цвета — только через классы .ch-* из css/calc.css (токены); анимаций нет, кроме opacity/transform через CSS.
   Размеры CHART — геометрия отрисовки, не бизнес-данные. */
import { fmt } from './helpers.js';

const CHART = { w: 320, h: 150, padL: 8, padR: 8, padT: 12, padB: 22, charW: 3.5 + 3, gap: 12, tickGap: 8, topBase: 4 };
// charW — средняя ширина знака подписи 11px в единицах viewBox (≈6,5), gap — поле слева от подписей оси Y, tickGap — зазор подписи до области графика
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const short = v => {                                   // подпись оси: 1 250 000 → «1,25 млн», 45 300 → «45 тыс.»
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e6) return s + new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(a / 1e6) + ' млн';
  if (a >= 1e3) return s + new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(a / 1e3) + ' тыс.';
  return s + fmt(a);
};

/* Линейный график. points: [{x, y}], marks: [{x, label}] — вертикальные пометки (порог, дно),
   hLines: [{y, label, cls}] — горизонтальные уровни (цель), unitX — подпись оси X.
   Всегда рисует нулевую линию, если ряд пересекает ноль. aria-label описывает график словами. */
export function lineChart({ points, marks = [], hLines = [], aria, unitX = '', xLabels = null }) {
  const pts = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 2) return '';
  const { w, h, padR, padT, padB } = CHART;
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y).concat(hLines.map(l => l.y));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys, 0), y1 = Math.max(...ys, 0);
  if (y1 === y0) { y1 = y0 + 1; }
  // Подписи оси Y — в отдельном левом поле, а не поверх области графика: иначе «−7,0 тыс.» налезает на начало линии.
  // Ширина поля — по самой длинной подписи (≈6,2 единицы на знак при 11px), не меньше базового отступа
  const yTop = short(y1), yBot = short(y0);
  const padL = Math.max(CHART.padL, Math.ceil(Math.max(yTop.length, yBot.length) * CHART.charW) + CHART.gap);
  const X = x => padL + (x1 === x0 ? 0 : (x - x0) / (x1 - x0)) * (w - padL - padR);
  const Y = y => padT + (1 - (y - y0) / (y1 - y0)) * (h - padT - padB);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const area = `${d}L${X(x1).toFixed(1)},${Y(0).toFixed(1)}L${X(x0).toFixed(1)},${Y(0).toFixed(1)}Z`;
  const zero = y0 < 0 && y1 > 0 ? `<line class="ch-zero" x1="${padL}" x2="${w - padR}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}"/>` : '';
  const hl = hLines.map(l => `<line class="ch-goal" x1="${padL}" x2="${w - padR}" y1="${Y(l.y).toFixed(1)}" y2="${Y(l.y).toFixed(1)}"/><text class="ch-t" x="${w - padR}" y="${(Y(l.y) - 3).toFixed(1)}" text-anchor="end">${esc(l.label)}</text>`).join('');
  const vm = marks.map(m => `<line class="ch-mark" x1="${X(m.x).toFixed(1)}" x2="${X(m.x).toFixed(1)}" y1="${padT}" y2="${h - padB}"/><text class="ch-t" x="${X(m.x).toFixed(1)}" y="${h - padB + 12}" text-anchor="middle">${esc(m.label)}</text>`).join('');
  const lo = pts.reduce((a, p) => (p.y < a.y ? p : a), pts[0]);
  const xl = xLabels || [{ x: x0, a: 'start' }, { x: x1, a: 'end' }];
  const axis = xLabels === false ? '' : xl.map(l => `<text class="ch-t" x="${X(l.x).toFixed(1)}" y="${h - 4}" text-anchor="${l.a || 'middle'}">${esc(l.text ?? fmt(l.x))}${unitX && l.x === x1 ? ' ' + esc(unitX) : ''}</text>`).join('');
  return `<figure class="chart"><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(aria)}" preserveAspectRatio="xMidYMid meet">
    <path class="ch-area" d="${area}"/>${zero}${hl}<path class="ch-line" d="${d}"/>${vm}
    <circle class="ch-dot" cx="${X(lo.x).toFixed(1)}" cy="${Y(lo.y).toFixed(1)}" r="3.5"/>
    <text class="ch-t" x="${padL - CHART.tickGap}" y="${padT + CHART.topBase}" text-anchor="end">${esc(yTop)}</text><text class="ch-t" x="${padL - CHART.tickGap}" y="${h - padB}" text-anchor="end">${esc(yBot)}</text>${axis}
  </svg></figure>`;
}

/* Горизонтальные столбики-«до/после»: rows [{label, a, b?}], подписи значений форматирует fmtV.
   a — основной столбик (залитый), b — второй (штрих). Ширина — доля от максимума по модулю. */
export function barsChart({ rows, aria, labelA = '', labelB = '', fmtV }) {
  const max = Math.max(1, ...rows.flatMap(r => [Math.abs(r.a ?? 0), Math.abs(r.b ?? 0)]));
  const bar = (v, cls, lab) => (v == null ? '' : `<div class="bar-row"><span class="bar-lab">${lab}</span><span class="bar-track"><span class="bar ${cls}" style="width:${(Math.abs(v) / max * 100).toFixed(2)}%"></span></span><b>${fmtV(v)}</b></div>`);
  const hasB = rows.some(r => r.b != null);
  return `<figure class="chart bars" role="img" aria-label="${esc(aria)}">${rows.map(r => `<div class="bar-grp"><div class="bar-name">${r.label}</div>${bar(r.a, 'bar-a', hasB ? esc(labelA) : '')}${hasB ? bar(r.b, 'bar-b', esc(labelB)) : ''}</div>`).join('')}</figure>`;
}

/* Шкала «насколько близко к порогу»: value/limit с отметкой лимита. Заполнение — transform scaleX через переменную --p */
export function gauge({ value, limit, label, aria }) {
  const p = limit > 0 ? Math.max(0, Math.min(1, value / limit)) : 0;
  const over = limit > 0 && value > limit;
  return `<div class="gauge${over ? ' over' : ''}" role="img" aria-label="${esc(aria)}"><div class="gauge-top"><span>${esc(label)}</span><b>${limit > 0 ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value / limit * 100) + '%' : '—'}</b></div><span class="gauge-track"><span class="gauge-fill" style="--p:${p.toFixed(4)}"></span></span></div>`;
}
