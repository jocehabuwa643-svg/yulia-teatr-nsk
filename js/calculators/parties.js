/* parties.js — праздники и аренда: маржа пакета «День рождения в театре».
   Ориентиры рынка (цена часа и пакеты) приходят из competitors.json через cfg.party_benchmarks. */
import { nonNeg, share, safeDiv, rangeField } from './util.js';

export const meta = {
  id: 'parties',
  icon: 'cake',
  title: 'Праздники и аренда',
  what: 'Считает: прибыль одного праздника и месяца при заданном пакете',
  when: 'Когда: собираете пакет «День рождения в театре» или сдаёте зал'
};

export const controls = cfg => [
  rangeField(cfg, 'parties', 'price', 'Цена пакета праздника'),
  rangeField(cfg, 'parties', 'hours', 'Часов в пакете'),
  rangeField(cfg, 'parties', 'guests', 'Гостей'),
  rangeField(cfg, 'parties', 'extra', 'Наценка за доп. услуги'),
  rangeField(cfg, 'parties', 'perMonth', 'Праздников в месяц')
];

export function calc(input, cfg) {
  const b = cfg.base_costs;
  const price = nonNeg(input.price), hours = nonNeg(input.hours), guests = nonNeg(input.guests);
  const revenue = price * (1 + share(nonNeg(input.extra)));
  const perMonthN = nonNeg(input.perMonth);
  // переменные праздника из модели + ФОТ по формуле выходного показа
  const variables = b.party_variables;
  const fee = b.weekend_fee * (1 + cfg.gphRate) + b.weekend_props;
  const tax = revenue * share(cfg.usn);
  const cost = variables + fee + tax;
  const profit = revenue - cost;
  // цена часа и цена на гостя — для сравнения с ориентирами рынка (расчёт без новых допущений)
  const perHour = safeDiv(revenue, hours, 0);
  const perGuest = safeDiv(revenue, guests, 0);
  const bench = cfg.party_benchmarks || [];
  return {
    revenue, variables, fee, tax, cost, profit,
    margin: revenue > 0 ? 100 * profit / revenue : 0,
    perMonth: profit * perMonthN,
    revenueMonth: revenue * perMonthN,
    perHour, perGuest, hours, guests,
    bench
  };
}

/* Ключевые показатели для сравнения сценариев */
export const summary = r => [
  { label: 'Прибыль праздника', v: r.profit, t: 'rub' },
  { label: 'Выручка пакета', v: r.revenue, t: 'rub' },
  { label: 'Маржа', v: r.margin, t: 'pct' },
  { label: 'Прибыль за месяц', v: r.perMonth, t: 'rub' },
  { label: 'Цена часа пакета', v: r.perHour, t: 'rub' }
];
