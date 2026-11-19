/* cashflow.js — денежный поток на 12 месяцев: сезонность модели, кассовые разрывы.
   Месяцы приходят из config.cashflow_12m (Сен–Ноя помечены projected:true). */
export const meta = {
  id: 'cashflow',
  icon: 'wallet',
  title: 'Денежный поток на 12 месяцев',
  what: 'Считает: помесячный баланс с вложениями, минимальный остаток и кассовые разрывы',
  when: 'Когда: планируете платёжный календарь и решаете, сколько резервов нужно'
};

export const controls = cfg => [
  { type: 'range', id: 'startCapital', label: 'Начальное финансирование', min: 0, max: 1500000, step: 50000, def: 1185000, suffix: '₽', wide: true },
  { type: 'range', id: 'tourDelta', label: 'Правка выездов ±', min: -8, max: 8, step: 1, def: 0, suffix: 'показов/мес', wide: true },
  { type: 'range', id: 'baseDelta', label: 'Правка базы ±', min: -50000, max: 50000, step: 5000, def: 0, suffix: '₽/мес', wide: true }
];

/* Вклад выездов за месяц: базовый прогноз месяца из config + правка показов × вклад одного показа.
   Прежняя версия считала выручку (аудитория × билет = 16 250 ₽/показ), а не вклад (7 550 ₽/показ),
   и потому дно баланса уходило от модельного −964 900 ₽. */
function tourContribution(m, tourDelta, cfg) {
  const u = cfg.tour_unit;
  const shows = Math.max(0, m.shows + tourDelta);
  const unit = shows > u.capacity_per_troupe ? u.unit_large : u.unit_small;
  return Math.max(0, m.tour + tourDelta * unit);
}

export function calc({ startCapital, tourDelta, baseDelta }, cfg) {
  let cum = startCapital;
  const rows = cfg.cashflow_12m.months.map(m => {
    const shows = Math.max(0, m.shows + tourDelta);
    const tour = tourContribution(m, tourDelta, cfg);
    const base = Math.max(0, m.base + (m.base > 0 ? baseDelta : 0));
    const fixed = m.fixed;
    const op = tour + base - fixed;
    const net = cum += op - m.cap;
    return { ...m, shows, tour, base, fixed, op, net };
  });
  let min = { net: Infinity, m: null };
  rows.forEach(r => { if (r.net < min.net) min = { net: r.net, m: r.m }; });
  const gaps = rows.filter(r => r.net < 0).map(r => r.m);
  return {
    rows, min, gaps,
    startCapital,
    projected: cfg.cashflow_12m.months.some(m => m.projected),
    minNoFinancing: rows.reduce((a, r) => Math.min(a, r.net - startCapital), Infinity)
  };
}
