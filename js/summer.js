/* summer.js — «Летний сценарий (июнь–август)»: чистая логика без DOM (проверяется тестами tests/summer*.test.mjs).
   Источники: data/seasonality.json (коэффициенты сезонности — модель проекта), data/config.json (cashflow_12m, цены-допущения),
   data/competitors.json (подтверждённые цены конкурентов), data/guide.json → summer (форматы, подсказки, чек-лист).
   Никаких собственных чисел: всё берётся из данных с источником, иначе — «цену уточнить». */

const MONTH_GEN = ['', 'январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const ORDER_BY = ['январь', 'февраль', 'март', 'апрель', 'май']; // порядок сроков «до мая» в чек-листе

/* Число с пробелами-разделителями тысяч и запятой — как в остальном интерфейсе (ru-RU), без зависимости от DOM */
export function fmtNum(v, digits = 0) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v).replace(/-/g, '−');
}

/* ---------- Просадка лета по seasonality.json ----------
   Возвращает { months:[{m,name,factor,note,below,summer}], summer:[…июнь–август], below:[…летние ниже среднего],
   lowest: самый слабый летний месяц, avg: среднее по году, ok } — честно из данных, без досчётов */
export function summerDip(seasonality, summerMonths = [6, 7, 8]) {
  const rows = (seasonality && Array.isArray(seasonality.months) ? seasonality.months : [])
    .filter(r => r && Number.isFinite(+r.m) && Number.isFinite(+r.factor))
    .map(r => ({ m: +r.m, name: String(r.name || ''), factor: +r.factor, note: String(r.note || ''), confidence: r.confidence || 'model' }))
    .sort((a, b) => a.m - b.m);
  if (!rows.length) return { ok: false, months: [], summer: [], below: [], lowest: null, avg: null };
  // «средний месяц» в модели = 1,0; дополнительно считаем фактическое среднее коэффициентов, чтобы подпись была честной
  const avg = rows.reduce((s, r) => s + r.factor, 0) / rows.length;
  const months = rows.map(r => ({ ...r, below: r.factor < 1, summer: summerMonths.includes(r.m) }));
  const summer = months.filter(r => r.summer);
  const below = summer.filter(r => r.below);
  const lowest = summer.reduce((lo, r) => (!lo || r.factor < lo.factor ? r : lo), null);
  return { ok: summer.length > 0, months, summer, below, lowest, avg };
}

/* Короткий вывод для подписи: «Ниже среднего: июль (0,85), август (0,65). Самый слабый — август» */
export function dipSentence(dip) {
  if (!dip || !dip.ok) return 'Данных сезонности нет — просадку лета оценить не по чему.';
  if (!dip.below.length) return 'По модели проекта летние месяцы не ниже среднего.';
  const list = dip.below.map(r => `${r.name.toLowerCase()} (${fmtNum(r.factor, 2)})`).join(', ');
  const lo = dip.lowest && dip.lowest.below ? ` Самая глубокая просадка — в ${MONTH_GEN[dip.lowest.m] || dip.lowest.name.toLowerCase()}.` : '';
  return `Ниже среднего месяца (1,0): ${list}.${lo}`;
}

/* Строки модели cashflow_12m для летних месяцев: показы и заметка модели (как есть, без пересчётов) */
export function summerCashflow(config, names = ['Июнь', 'Июль', 'Август']) {
  const cf = config && config.cashflow_12m;
  const months = cf && cf.value && Array.isArray(cf.value.months) ? cf.value.months : [];
  const rows = names.map(n => months.find(r => r && r.m === n)).filter(Boolean)
    .map(r => ({ m: r.m, shows: Number.isFinite(+r.shows) ? +r.shows : null, note: String(r.note || ''), projected: !!r.projected }));
  return { rows, source_name: (cf && cf.source_name) || '', confidence: (cf && cf.confidence) || 'model', fetched_at: (cf && cf.fetched_at) || null };
}

/* Значение по пути «a.b.c» в объекте (без исключений) */
function pick(obj, path) {
  return String(path || '').split('.').reduce((o, k) => (o != null && typeof o === 'object' ? o[k] : undefined), obj);
}

/* ---------- Ориентиры цены формата ----------
   ref: {from:'config', path, label, assumption?} — объект с провенансом (value/unit/source_name) или число-допущение ползунка;
        {from:'competitors', group, id, label_has, label} — подтверждённая цена конкурента (архивные места пропускаются).
   Возвращает {label, value, unit, source_name, source_url, fetched_at, confidence} или null, если значения нет */
export function resolvePriceRef(ref, data) {
  if (!ref || !data) return null;
  if (ref.from === 'config') {
    const v = pick(data.config, ref.path);
    if (v && typeof v === 'object' && Number.isFinite(+v.value)) {
      return { label: ref.label || v.label || '', value: +v.value, unit: v.unit || '₽', source_name: v.source_name || 'Допущение проекта', source_url: v.source_url || null, fetched_at: v.fetched_at || null, confidence: v.confidence || 'model' };
    }
    if (Number.isFinite(+v) && v !== null && v !== '' && ref.assumption) {
      // значение ползунка калькулятора — это допущение проекта, а не рыночная цена
      return { label: ref.label || '', value: +v, unit: '₽', source_name: 'Допущение проекта — требует проверки', source_url: null, fetched_at: (data.config && data.config.as_of) || null, confidence: 'model' };
    }
    return null;
  }
  if (ref.from === 'competitors') {
    const list = data.competitors && Array.isArray(data.competitors[ref.group]) ? data.competitors[ref.group] : [];
    const item = list.find(x => x && x.id === ref.id);
    if (!item || item.archived) return null;
    const p = (item.prices || []).find(x => x && Number.isFinite(+x.value) && (!ref.label_has || String(x.label || '').includes(ref.label_has)));
    if (!p) return null;
    return { label: ref.label || p.label || '', value: +p.value, unit: p.unit || '₽', source_name: p.source_name || item.source_name || item.name || '', source_url: p.source_url || item.source_url || null, fetched_at: p.fetched_at || item.fetched_at || null, confidence: p.confidence || item.confidence || 'medium', who: item.name || '' };
  }
  return null;
}

/* Все ориентиры формата: { items:[…], fallback } — fallback показывается, если подтверждённых значений нет */
export function priceAnchors(format, data) {
  const items = (format && Array.isArray(format.price_refs) ? format.price_refs : []).map(r => resolvePriceRef(r, data)).filter(Boolean);
  const fallback = format && format.price_fallback ? format.price_fallback : 'Цену уточнить: подтверждённого ориентира в данных нет.';
  return { items, fallback: items.length ? (format.price_fallback || '') : fallback };
}

/* Подпись надёжности для ориентира */
export function confidenceLabel(c) {
  return { high: 'источник проверен', medium: 'надёжность средняя', low: 'надёжность низкая', model: 'допущение проекта', no_data: 'нет данных' }[c] || 'надёжность не указана';
}

/* ---------- Состояние пользователя (store: yulia.v2.launchx.summer) ----------
   { formats: ['camps', …], done: { '<todoId>': true } } — чистка от мусора и несуществующих id */
export function sanitizeSummerState(raw, summer) {
  const ids = new Set((summer && Array.isArray(summer.formats) ? summer.formats : []).map(f => f.id));
  const todoIds = new Set();
  (summer && Array.isArray(summer.formats) ? summer.formats : []).forEach(f => (f.todo || []).forEach(t => todoIds.add(t.id)));
  const fallback = (summer && Array.isArray(summer.default_formats) ? summer.default_formats : []).filter(id => ids.has(id));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { formats: fallback, done: {} };
  const formats = Array.isArray(raw.formats) ? [...new Set(raw.formats.filter(id => typeof id === 'string' && ids.has(id)))] : fallback;
  const done = {};
  if (raw.done && typeof raw.done === 'object') for (const k of Object.keys(raw.done)) if (todoIds.has(k) && raw.done[k] === true) done[k] = true;
  return { formats, done };
}

/* Переключить формат (неизменяемо): возвращает новое состояние */
export function toggleFormat(st, id) {
  const has = st.formats.includes(id);
  return { ...st, formats: has ? st.formats.filter(x => x !== id) : [...st.formats, id] };
}

/* ---------- План «Что сделать до мая» ----------
   Пункты выбранных форматов в порядке сроков (март → апрель → май), затем порядок форматов в данных */
export function buildTodo(summer, st) {
  const formats = (summer && Array.isArray(summer.formats) ? summer.formats : []).filter(f => st.formats.includes(f.id));
  const items = [];
  formats.forEach((f, fi) => (f.todo || []).forEach((t, ti) => items.push({ ...t, format: f.id, formatTitle: f.short || f.title, done: !!st.done[t.id], _o: fi * 100 + ti })));
  const rank = by => { const i = ORDER_BY.indexOf(String(by || '').toLowerCase()); return i < 0 ? ORDER_BY.length : i; };
  items.sort((a, b) => rank(a.by) - rank(b.by) || a._o - b._o);
  return items.map(({ _o, ...rest }) => rest);
}

/* Прогресс плана: { done, total, pct } */
export function todoProgress(items) {
  const total = items.length;
  const done = items.filter(x => x.done).length;
  return { done, total, pct: total ? Math.round(done * 100 / total) : 0 };
}
