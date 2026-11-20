/* util.js — чистые помощники калькуляторов (без DOM): безопасные числа, проценты, спецификации полей.
   Единственные числовые литералы здесь — 0, 1 и 100 (определение процента); все бизнес-константы лежат в data/*.json. */

/* Число из чего угодно: пустое поле, NaN, «1 200,5» → конечное число либо значение по умолчанию */
export function num(v, d = 0) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : d;
  if (v == null) return d;
  const n = parseFloat(String(v).replace(/[\s\u00a0]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : d;
}
/* Неотрицательное конечное число (количества, суммы) */
export const nonNeg = v => Math.max(0, num(v));
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/* Процент → доля (100 — определение процента) */
export const share = p => num(p) / 100;
/* Деление без Infinity/NaN: при нулевом знаменателе — запасное значение */
export const safeDiv = (a, b, d = 0) => {
  const r = num(a) / num(b);
  return Number.isFinite(r) ? r : d;
};
/* Значение по пути «a.b.c» (для def_from и редактируемых допущений) */
export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
/* Число по-русски: «30,2» (для подписей, формируемых из данных) */
export const ruNum = (v, digits = 1) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(num(v));
export const ruRub = v => ruNum(v, 0) + '\u00a0₽';

/* Поле-ползунок из config.calc.controls: диапазон/шаг/значение по умолчанию — из данных.
   def_from указывает на путь в config (значение по умолчанию = допущение проекта). */
export function rangeField(cfg, calcId, id, label, extra = {}) {
  const s = (cfg.calc && cfg.calc.controls && cfg.calc.controls[calcId] && cfg.calc.controls[calcId][id]) || {};
  const def = s.def_from ? getPath(cfg, s.def_from) : s.def;
  return { type: 'range', id, label, min: s.min ?? 0, max: s.max ?? 0, softMax: s.soft_max ?? null, step: s.step ?? 1, def: def ?? s.min ?? 0, suffix: s.suffix ?? '', ...extra };
}
/* Выбор года расчёта: годы — из config.calc.years */
export function yearField(cfg, extra = {}) {
  return { type: 'select', id: 'year', label: 'Год расчёта', options: (cfg.calc.years || [cfg.year]).map(y => [y, String(y)]), def: cfg.year, ...extra };
}

/* Значения по умолчанию из спецификации полей: { id: def }. Для select — первый вариант, если def не задан */
export function defaultsOf(fields) {
  const out = {};
  fields.forEach(f => { out[f.id] = f.def != null ? f.def : (f.options && f.options[0] ? (Array.isArray(f.options[0]) ? f.options[0][0] : f.options[0]) : 0); });
  return out;
}
/* Глубокая проверка результата: все числа конечны (нет NaN/Infinity). Возвращает путь первого плохого числа или null */
export function firstBadNumber(v, path = '') {
  if (typeof v === 'number') return Number.isFinite(v) ? null : path || '(root)';
  if (v == null || typeof v !== 'object' || v instanceof Date) return null;
  for (const [k, x] of Object.entries(v)) { const bad = firstBadNumber(x, path ? path + '.' + k : k); if (bad) return bad; }
  return null;
}
