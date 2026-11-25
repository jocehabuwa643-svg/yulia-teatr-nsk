/* scenarios.js — сохранённые сценарии калькуляторов и таблица сравнения «рядом» (чистый модуль, без DOM).
   Хранилище передаётся снаружи ({get,set}), поэтому логика проверяется в node без браузера.
   В сценарии хранятся только входы: итоги пересчитываются по текущим данным при сравнении —
   так сравнение не врёт, если ставки обновились после сохранения. */
import { num, ruNum } from './util.js';
import { runCalc, summaryOf } from './run.js';

const NBSP = ' ';
const MINUS = '−';

/* Значение показателя → строка по типу: rub / int / pct / text. null → empty (по умолчанию «нет данных») */
export function fmtValue(v, t, empty = 'нет данных') {
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return empty;
  const sign = n => (n < 0 ? MINUS : '');
  if (t === 'rub') return `${sign(v)}${ruNum(Math.abs(Math.round(v)), 0)}${NBSP}₽`;
  if (t === 'int') return `${sign(v)}${ruNum(Math.abs(Math.round(v)), 0)}`;
  if (t === 'pct') return `${sign(v)}${ruNum(Math.abs(v), 1)}%`;
  return String(v);
}

/* Имя сценария: пробелы схлопнуты, длина ограничена; пустое → запасное имя */
export function sanitizeName(raw, fallback, maxLen) {
  const s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, maxLen);
  return s || fallback;
}

const key = id => `scen.${id}`;

/* Список сценариев калькулятора id; битые записи в хранилище отбрасываются */
export function loadScenarios(storage, id) {
  const raw = storage.get(key(id), []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(s => s && typeof s.id === 'string' && s.inputs && typeof s.inputs === 'object' && typeof s.name === 'string');
}
export const saveScenarios = (storage, id, list) => storage.set(key(id), list);

/* Добавляет сценарий: то же имя — обновляет запись; сверх лимита вытесняются самые старые.
   uid и at передаются снаружи (в тестах — фиксированные). Возвращает новый список. */
export function addScenario(list, { name, inputs, at, uid }, max, maxNameLen) {
  const nm = sanitizeName(name, `Сценарий ${list.length + 1}`, maxNameLen);
  const entry = { id: uid, name: nm, at, inputs: { ...inputs } };
  const i = list.findIndex(s => s.name.toLowerCase() === nm.toLowerCase());
  let out;
  if (i >= 0) { out = list.slice(); out[i] = { ...entry, id: list[i].id }; } else out = [...list, entry];
  return out.length > max ? out.slice(out.length - max) : out;
}
export const removeScenario = (list, sid) => list.filter(s => s.id !== sid);

/* Подпись значения поля: select → текст варианта, range → число с единицей */
export function fieldText(f, v) {
  if (f.type === 'select') {
    const o = (f.options || []).find(x => String(Array.isArray(x) ? x[0] : x) === String(v));
    return o ? String(Array.isArray(o) ? o[1] : o) : String(v);
  }
  const n = num(v);
  return `${ruNum(n, 2)}${f.suffix ? NBSP + agreeSuffix(f.suffix, n) : ''}`;
}

/* Согласование единицы с числом: «1 показ», «2 показа», «5 показов», «1,5 показа».
   Склоняется только первое слово единицы из словаря; остальные единицы (₽, %, чел.) не меняются.
   Форму выбирают правила русского языка из Intl.PluralRules (one / few / many / other — дробные) */
const PLURAL_UNITS = { 'показов': { one: 'показ', few: 'показа', many: 'показов', other: 'показа' } };
let ruPlural = null;
try { ruPlural = new Intl.PluralRules('ru-RU'); } catch (e) { ruPlural = null; }
export function agreeSuffix(suffix, n) {
  const m = /^([^\s/]+)(.*)$/.exec(String(suffix));
  const forms = m && PLURAL_UNITS[m[1]];
  if (!forms || !ruPlural || typeof n !== 'number' || !Number.isFinite(n)) return suffix;
  return (forms[ruPlural.select(Math.abs(n))] || m[1]) + m[2];
}

/* Таблица сравнения: первый столбец — текущие входы, затем сохранённые сценарии.
   rows — показатели из summary() с разницей к текущему; inputRows — входы, отличающиеся у сценариев помечены differs. */
export function buildComparison({ mod, cfg, ctx, scenarios, currentInputs, currentName = 'Текущий' }) {
  const fields = mod.controls(cfg);
  const cols = [{ id: 'current', name: currentName, current: true, inputs: currentInputs }, ...scenarios.map(s => ({ id: s.id, name: s.name, at: s.at, inputs: s.inputs }))];
  cols.forEach(c => { c.summary = summaryOf(mod, runCalc(mod, c.inputs, cfg, ctx)); });
  const labels = cols[0].summary.map(x => ({ label: x.label, t: x.t, empty: x.empty }));
  const rows = labels.map((l, i) => ({
    label: l.label,
    cells: cols.map((c, j) => {
      const s = c.summary[i];
      const cur = cols[0].summary[i];
      const text = fmtValue(s.v, s.t, s.empty);
      const numeric = typeof s.v === 'number' && typeof cur.v === 'number' && (s.t === 'rub' || s.t === 'int' || s.t === 'pct');
      const delta = j > 0 && numeric && s.v !== cur.v ? fmtValue(s.v - cur.v, s.t).replace(/^(?!−)/, '+') : '';
      return { raw: s.v, text, delta };
    })
  }));
  const inputRows = fields.map(f => {
    const texts = cols.map(c => fieldText(f, c.inputs[f.id] ?? f.def));
    return { label: f.label, cells: texts, differs: texts.some(t => t !== texts[0]) };
  });
  return { cols: cols.map(({ id, name, at, current }) => ({ id, name, at, current: !!current })), rows, inputRows };
}
