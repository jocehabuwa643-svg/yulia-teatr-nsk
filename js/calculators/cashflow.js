/* cashflow.js — денежный поток на 12 месяцев: сезонность модели, кассовые разрывы.
   Месяцы приходят из config.cashflow_12m (Сен–Ноя помечены projected:true). Правки — дельты к модели. */
import { num, nonNeg, rangeField } from './util.js';

export const meta = {
  id: 'cashflow',
  icon: 'wallet',
  headline: 'result',            // тип главной цифры: result — со знаком, amount — сумма/цена без плюса, count — целое число
  title: 'Денежный поток на 12 месяцев',
  what: 'Считает: помесячный баланс, минимальный остаток, кассовые разрывы',
  when: 'Когда: планируете платёжный календарь',
  more: 'Считает: помесячный баланс с вложениями, минимальный остаток и кассовые разрывы. Когда это нужно: планируете платёжный календарь и решаете, сколько резервов нужно.'
};

export const controls = cfg => [
  rangeField(cfg, 'cashflow', 'startCapital', 'Начальное финансирование', { wide: true }),
  rangeField(cfg, 'cashflow', 'tourDelta', 'Правка выездов ±', { wide: true }),
  rangeField(cfg, 'cashflow', 'baseDelta', 'Правка базы ±', { wide: true })
];

/* Вклад выездов за месяц: базовый прогноз месяца из config + правка показов × вклад одного показа.
   Прежняя версия считала выручку (аудитория × билет), а не вклад, и потому дно баланса уходило от модельного. */
function tourContribution(m, tourDelta, cfg) {
  const u = cfg.tour_unit;
  const shows = Math.max(0, m.shows + tourDelta);
  const unit = shows > u.capacity_per_troupe ? u.unit_large : u.unit_small;
  return Math.max(0, m.tour + tourDelta * unit);
}

export function calc(input, cfg) {
  const startCapital = nonNeg(input.startCapital);
  const tourDelta = Math.round(num(input.tourDelta));
  const baseDelta = num(input.baseDelta);
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
    minNoFinancing: rows.reduce((a, r) => Math.min(a, r.net - startCapital), Infinity),
    yearOp: rows.reduce((a, r) => a + r.op, 0),
    capTotal: rows.reduce((a, r) => a + r.cap, 0)
  };
}

/* Ключевые показатели для сравнения сценариев */
export const summary = r => [
  { label: 'Минимальный остаток', v: r.min.net, t: 'rub' },
  { label: 'Месяц дна', v: r.min.m, t: 'text' },
  { label: 'Месяцев в минусе', v: r.gaps.length, t: 'int' },
  { label: 'Операционная прибыль за год', v: r.yearOp, t: 'rub' },
  { label: 'Дно без финансирования', v: r.minNoFinancing, t: 'rub' }
];
