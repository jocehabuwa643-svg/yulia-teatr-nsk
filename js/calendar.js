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
