/* basecamp.js — калькулятор «Студия и база» (база + выезды + порог НДС).
   Формулы base()/business() перенесены из проверенной версии, константы из config/rates. */
import { calc as travelCalc } from './travel.js';

export const meta = {
  id: 'basecamp',
  icon: 'building-2',
  title: 'Студия и база 130 м² на Богдашке',
  what: 'Считает: прибыль бизнеса в месяц, окупаемость вложений, автопорог НДС 5% после 20 млн ₽/год',
  when: 'Когда: меняете аренду, набор учеников, праздники или число выездов'
};

export const controls = cfg => [
  { type: 'select', id: 'area', label: 'Площадь базы', options: [[100, '100 м²'], [130, '130 м²'], [150, '150 м²']] },
  { type: 'range', id: 'rent', label: 'Ставка аренды', min: 500, max: 2000, step: 25, def: 1000, suffix: '₽/м²' },
  { type: 'range', id: 'students', label: 'Ученики', min: 0, max: 80, step: 1, def: 40, suffix: 'чел.' },
  { type: 'range', id: 'sub', label: 'Абонемент', min: 2500, max: 7000, step: 50, def: 4300, suffix: '₽' },
  { type: 'range', id: 'week', label: 'Спектакли выходного дня', min: 0, max: 20, step: 1, def: 12, suffix: '' },
  { type: 'range', id: 'attendance', label: 'Зрители на показ', min: 15, max: 40, step: 1, def: 30, suffix: 'чел.' },
  { type: 'range', id: 'party', label: 'Дни рождения', min: 0, max: 16, step: 1, def: 8, suffix: '' },
  { type: 'range', id: 'eventprice', label: 'Чек праздника', min: 6000, max: 16000, step: 250, def: 10000, suffix: '₽' },
  { type: 'range', id: 'trips', label: 'Выезды в месяц', min: 0, max: 200, step: 1, def: 16, suffix: '' },
  { type: 'range', id: 'teams', label: 'Выездные труппы', min: 1, max: 4, step: 1, def: 1, suffix: '' }
];

/* Прибыль базы за месяц (без выездов) */
export function baseMonth(m, cfg) {
  const b = cfg.base_costs;
  const gross = m.s * m.p + m.w * m.a * b.weekend_ticket + m.h * m.c;
  const fixed = m.area * (m.rent + b.utilities_per_m2) + b.admin_month + b.marketing_month;
  const groups = Math.ceil(m.s / Math.max(1, b.group_max_students));
  const teachers = groups * b.lessons_per_month * b.lesson_price * (1 + cfg.gphRate);
  const week = m.w * (b.weekend_fee * (1 + cfg.gphRate) + b.weekend_props + b.weekend_cash_share / 100 * m.a * b.weekend_ticket);
  const party = m.h * b.party_variables;
  const tax = gross * cfg.usn / 100;
  return { gross, fixed, teachers, week, party, tax, groups, profit: gross - fixed - teachers - week - party - tax };
}

/* База + выезды как средний портфель (мощность 55/труппа, юнит-экономика из config) */
export function business(b, n, troupes, cfg, cap = true) {
  const u = cfg.tour_unit;
  const served = cap ? Math.min(n, troupes * u.capacity_per_troupe) : n;
  const large = served > u.capacity_per_troupe;
  const aud = large ? u.aud_large : u.aud_small;
  const unitSales = aud * u.ticket;
  const unit = large ? u.unit_large : u.unit_small;
  const g = b.gross + served * unitSales;
  const annual = g * 12;
  const reg = annual > cfg.vatThreshold;
  const vatInPrice = reg ? g * cfg.vatRate / 1.05 : 0; // НДС в цене: касса × 5/105
  const hq = reg ? cfg.phases_budget.hq_month_over_threshold : 0;
  const save = vatInPrice * cfg.usn / 100;
  const baseProfit = b.profit - (reg ? b.gross * 5 / 105 * .94 : 0);
  const profit = b.profit + served * unit - vatInPrice + save - hq;
  return {
    served, aud, annual, reg, vat: vatInPrice, hq, save, baseProfit, profit, g, unit, unitSales,
    tourProfit: served * unit - (reg ? served * unitSales * 5 / 105 * .94 : 0)
  };
}

export function calc(input, cfg) {
  const m = {
    area: input.area, rent: input.rent, s: input.students, p: input.sub,
    w: input.week, h: input.party, a: input.attendance, c: input.eventprice
  };
  const b = baseMonth(m, cfg);
  const x = business(b, input.trips, input.teams, cfg);
  return { m, b, x };
}
