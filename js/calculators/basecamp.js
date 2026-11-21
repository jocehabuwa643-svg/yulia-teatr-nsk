/* basecamp.js — калькулятор «Студия и база» (база + выезды + порог НДС).
   Формулы baseMonth()/business() перенесены из проверенной версии; константы — из config/rates,
   НДС и УСН — через tax-core (порог по году, пониженные ставки 5/7%, «в цене» r/(100+r)). */
import { num, nonNeg, share, safeDiv, rangeField, yearField, ruNum } from './util.js';
import { yearParams, vatStatus, vatInPrice, crossingMonth } from './tax-core.js';

export const meta = {
  id: 'basecamp',
  sources: ['usn_income_rate', 'vat_threshold*', 'vat_rate_special_low', 'vat_rate_special_high', 'vat_band_special_low_upto*', 'gph_contributions_rate'],
  icon: 'building-2',
  headline: 'result',            // тип главной цифры: result — со знаком, amount — сумма/цена без плюса, count — целое число
  title: 'Студия и база 130 м² на Богдашке',
  short: 'Студия и база',                 // короткое имя для ленты переключателей
  what: 'Считает: прибыль в месяц, окупаемость и автопорог НДС',
  when: 'Когда: меняете аренду, набор, праздники',
  more: 'Считает: прибыль бизнеса в месяц, окупаемость вложений и автопорог НДС при превышении лимита УСН. Когда это нужно: меняете аренду, набор учеников, праздники или число выездов.'
};

export const controls = cfg => [
  yearField(cfg, { wide: true }),
  { type: 'select', id: 'area', label: 'Площадь базы', options: cfg.calc.controls.basecamp.area_options.map(a => [a, `${a} м²`]), def: cfg.calc.base_area_default },
  rangeField(cfg, 'basecamp', 'rent', 'Ставка аренды'),
  rangeField(cfg, 'basecamp', 'students', 'Ученики'),
  rangeField(cfg, 'basecamp', 'sub', 'Абонемент'),
  rangeField(cfg, 'basecamp', 'week', 'Спектакли выходного дня'),
  rangeField(cfg, 'basecamp', 'attendance', 'Зрители на показ'),
  rangeField(cfg, 'basecamp', 'party', 'Дни рождения'),
  rangeField(cfg, 'basecamp', 'eventprice', 'Чек праздника'),
  rangeField(cfg, 'basecamp', 'trips', 'Выезды в месяц'),
  rangeField(cfg, 'basecamp', 'teams', 'Выездные труппы')
];

/* Прибыль базы за месяц (без выездов). m: area, rent, s (ученики), p (абонемент), w (показы выходного),
   a (зрителей), h (праздники), c (чек праздника) */
export function baseMonth(m0, cfg) {
  const b = cfg.base_costs;
  const m = { area: nonNeg(m0.area), rent: nonNeg(m0.rent), s: nonNeg(m0.s), p: nonNeg(m0.p), w: nonNeg(m0.w), a: nonNeg(m0.a), h: nonNeg(m0.h), c: nonNeg(m0.c) };
  const gross = m.s * m.p + m.w * m.a * b.weekend_ticket + m.h * m.c;
  const fixed = m.area * (m.rent + b.utilities_per_m2) + b.admin_month + b.marketing_month;
  const groups = Math.ceil(m.s / Math.max(1, b.group_max_students));
  const teachers = groups * b.lessons_per_month * b.lesson_price * (1 + cfg.gphRate);
  const week = m.w * (b.weekend_fee * (1 + cfg.gphRate) + b.weekend_props + share(b.weekend_cash_share) * m.a * b.weekend_ticket);
  const party = m.h * b.party_variables;
  const tax = gross * share(cfg.usn);
  return { gross, fixed, teachers, week, party, tax, groups, profit: gross - fixed - teachers - week - party - tax };
}

/* База + выезды как средний портфель (мощность на труппу и юнит-экономика — из config).
   year — год расчёта (порог НДС и ставка зависят от года). */
export function business(b, n0, troupes0, cfg, cap = true, year = cfg.year) {
  const u = cfg.tour_unit;
  const n = nonNeg(n0), troupes = Math.max(1, Math.round(num(troupes0, 1)));
  const p = yearParams(cfg, year);
  const served = cap ? Math.min(n, troupes * u.capacity_per_troupe) : n;
  const large = served > u.capacity_per_troupe;
  const aud = large ? u.aud_large : u.aud_small;
  const unitSales = aud * u.ticket;
  const unit = large ? u.unit_large : u.unit_small;
  const g = b.gross + served * unitSales;
  const annual = g * cfg.calendar.months_per_year;
  const vs = vatStatus(annual, p);
  const reg = vs.state !== 'exempt';
  const keep = 1 - share(cfg.usn);                 // НДС исключается из дохода УСН: налог с этой части не платится
  const vatSum = reg ? vatInPrice(g, vs.rate) : 0;
  const hq = reg ? cfg.phases_budget.hq_month_over_threshold : 0;
  const save = vatSum * share(cfg.usn);
  const baseProfit = b.profit - (reg ? vatInPrice(b.gross, vs.rate) * keep : 0);
  const profit = b.profit + served * unit - vatSum + save - hq;
  // «до порога»: та же прибыль без НДС и штаба — разница с profit и есть цена перехода через порог
  const profitNoVat = b.profit + served * unit;
  // «после порога» как гипотеза: прибыль, если бы НДС по низкой ставке и штаб уже действовали (когда порог ещё не превышен)
  const vatOver = reg ? vatSum : vatInPrice(g, p.vatLow);
  const profitOver = reg ? profit : profitNoVat - vatOver + vatOver * share(cfg.usn) - cfg.phases_budget.hq_month_over_threshold;
  return {
    served, aud, annual, reg, vat: vatSum, hq, save, baseProfit, profit, profitNoVat, profitOver, vatOver, vatCost: profitNoVat - profit, g, unit, unitSales,
    threshold: p.vatThreshold, crossMonth: crossingMonth(annual, p.vatThreshold, cfg.calendar.months_per_year),
    vatRate: vs.rate, vatState: vs.state, usnLost: !!vs.usnLost, year: p.year,
    tourProfit: served * unit - (reg ? vatInPrice(served * unitSales, vs.rate) * keep : 0)
  };
}

export function calc(input, cfg) {
  // входы приводятся к неотрицательным числам: пустое поле и NaN дают 0, а не NaN в результате
  const m = {
    area: nonNeg(input.area), rent: nonNeg(input.rent), s: nonNeg(input.students), p: nonNeg(input.sub),
    w: nonNeg(input.week), h: nonNeg(input.party), a: nonNeg(input.attendance), c: nonNeg(input.eventprice)
  };
  const year = input.year ?? cfg.year;
  const b = baseMonth(m, cfg);
  const x = business(b, input.trips, input.teams, cfg, true, year);
  // окупаемость: бюджет финансирования ÷ месячная прибыль (при неизменной прибыли); null — не достигается
  const payback = x.profit > 0 ? Math.ceil(safeDiv(cfg.phases_budget.total, x.profit, 0)) : null;
  return { m, b, x, payback, threshold: yearParams(cfg, year).vatThreshold };
}

/* Ключевые показатели для сравнения сценариев */
export const summary = r => [
  { label: 'Чистая прибыль месяца', v: r.x.profit, t: 'rub' },
  { label: 'База отдельно', v: r.x.baseProfit, t: 'rub' },
  { label: 'Выезды', v: r.x.tourProfit, t: 'rub' },
  { label: 'Окупаемость, мес.', v: r.payback, t: 'int', empty: 'не достигается' },
  { label: 'Годовой темп выручки', v: r.x.annual, t: 'rub' },
  { label: 'Без НДС и штаба (до порога)', v: r.x.profitNoVat, t: 'rub' }
];
export const hint = cfg => `порог НДС ${ruNum(yearParams(cfg, cfg.year).vatThreshold / 1e6)} млн ₽`;
