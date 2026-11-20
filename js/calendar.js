/* calendar.js — чистая логика календаря от текущей даты (без DOM).
   Тестируется подменой даты: см. tests/calendar.test.mjs */
export const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/* Окно месяцев от текущего: history месяцев назад + будущее вперёд (вместе — 12).
   Возвращает [{y, m (1-12), name, short, current, future}] в хронологическом порядке. */
export function monthWindow(now = new Date(), history = 2, total = 12) {
  const out = [];
  const startY = now.getFullYear(), startM = now.getMonth(); // 0-based
  for (let i = -history; i < total - history; i++) {
    const d = new Date(startY, startM + i, 1);
    const y = d.getFullYear(), m = d.getMonth() + 1;
    out.push({
      y, m, name: MONTHS_RU[d.getMonth()], short: MONTHS_SHORT[d.getMonth()],
      current: y === now.getFullYear() && m === now.getMonth() + 1,
      future: new Date(y, m - 1, 1) > new Date(now.getFullYear(), now.getMonth(), 1)
    });
  }
  return out;
}

/* Заголовок окна: от текущего месяца («Декабрь 2026 — Сентябрь 2027»); если текущего нет — от первого */
export function windowTitle(win) {
  if (!win || !win.length) return '';
  const first = win.find(w => w.current) || win[0];
  const b = win[win.length - 1];
  return `${first.name} ${first.y} — ${b.name} ${b.y}`;
}

/* Каникулы года: {loaded:true, items} | {loaded:false, note} — данные из seasonality.json */
export function holidaysForYear(data, year) {
  const h = data && data.school_holidays && data.school_holidays[String(year)];
  if (!h) return { loaded: false, note: `Календарь каникул на ${year} год не загружен.` };
  if (h.loaded === false) return { loaded: false, note: h.note || `Календарь каникул на ${year} год не загружен.` };
  return { loaded: true, items: h.items || [], checkedAt: h.checked_at, confidence: h.confidence, sourceName: h.source_name, sourceUrl: h.source_url };
}

/* Пересечение каникул с месяцем (для подсветки в ленте) */
export function holidaysInMonth(holidays, y, m) {
  if (!holidays || !holidays.loaded) return [];
  return holidays.items.filter(it => {
    const f = new Date(it.from), t = new Date(it.to);
    const mm = new Date(y, m - 1, 1), me = new Date(y, m, 0);
    return f <= me && t >= mm;
  });
}

/* Коэффициент месяца из seasonality.json (по номеру месяца) */
export function factorFor(data, m) {
  const row = data && data.months && data.months.find(x => x.m === m);
  return row ? row.factor : null;
}

/* ---------- Каникулы относительно дня открытия (точные даты из seasonality.json) ---------- */

/* Локальная дата из 'ГГГГ-ММ-ДД' (без сдвига часового пояса); иначе null */
function localDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/* Ключ каникул — первое слово названия в нижнем регистре: «Зимние (новогодние)» → «зимние» */
export function holidayKey(name) {
  return String(name || '').trim().split(/[\s(]/)[0].toLowerCase();
}

/* Все загруженные отрезки каникул с данным ключом по всем годам (повторы между годами убираются) */
export function holidaySpans(data, name) {
  const key = holidayKey(name);
  const sh = data && data.school_holidays;
  if (!key || !sh) return [];
  const seen = new Set();
  const out = [];
  for (const y of Object.keys(sh)) {
    const h = sh[y];
    if (!h || h.loaded === false) continue;
    for (const it of h.items || []) {
      if (holidayKey(it.name) !== key) continue;
      const from = localDay(it.from), to = localDay(it.to);
      if (!from || !to || to < from) continue;
      const id = it.from + '|' + it.to;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ from, to, verified: it.verified !== false });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

/* Статус каникул на день now: идут сейчас / ближайшие впереди / последние прошедшие.
   {state:'now'|'next'|'past', from, to, days} — days: для now — осталось дней (включая сегодня), для next — дней до начала,
   для past — дней с окончания. null — точных дат нет (тогда показываем только ориентир из модели). */
export function holidayStatus(data, name, now = new Date()) {
  const spans = holidaySpans(data, name);
  if (!spans.length) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const DAY = 86400000;
  const diff = (a, b) => Math.round((a - b) / DAY);
  const cur = spans.find(s => s.from <= today && today <= s.to);
  if (cur) return { state: 'now', from: cur.from, to: cur.to, days: diff(cur.to, today) + 1 };
  const next = spans.find(s => s.from > today);
  if (next) return { state: 'next', from: next.from, to: next.to, days: diff(next.from, today) };
  const past = spans.filter(s => s.to < today).pop();
  return { state: 'past', from: past.from, to: past.to, days: diff(today, past.to) };
}

/* Закончились ли уже все известные каникулы с этим ключом, пересекающие месяц (y, m 1-12), к дню now.
   Нет точных дат на этот месяц → false (ориентир модели остаётся без пометки). */
export function holidayEndedInMonth(data, name, y, m, now = new Date()) {
  const ms = new Date(y, m - 1, 1), me = new Date(y, m, 0);
  const inMonth = holidaySpans(data, name).filter(s => s.from <= me && s.to >= ms);
  if (!inMonth.length) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return inMonth.every(s => s.to < today);
}
