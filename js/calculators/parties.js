/* parties.js — праздники и аренда: маржа пакета «День рождения в театре». */
export const meta = {
  id: 'parties',
  icon: 'cake',
  title: 'Праздники и аренда',
  what: 'Считает: прибыль одного праздника и месяца при заданном пакете',
  when: 'Когда: собираете пакет «День рождения в театре» или сдаёте зал'
};

export const controls = cfg => [
  { type: 'range', id: 'price', label: 'Цена пакета праздника', min: 6000, max: 20000, step: 250, def: 10000, suffix: '₽' },
  { type: 'range', id: 'hours', label: 'Часов в пакете', min: 1, max: 5, step: 1, def: 2, suffix: 'ч' },
  { type: 'range', id: 'guests', label: 'Гостей', min: 5, max: 40, step: 1, def: 12, suffix: 'чел.' },
  { type: 'range', id: 'extra', label: 'Наценка за доп. услуги', min: 0, max: 50, step: 5, def: 10, suffix: '%' },
  { type: 'range', id: 'perMonth', label: 'Праздников в месяц', min: 0, max: 20, step: 1, def: 8, suffix: '' }
];

export function calc(input, cfg) {
  const b = cfg.base_costs;
  const revenue = input.price * (1 + input.extra / 100);
  // переменные праздника из модели + ФОТ по формуле выходного показателя + угощения за счёт гостей
  const variables = b.party_variables;
  const fee = b.weekend_fee * (1 + cfg.gphRate) + b.weekend_props;
  const tax = revenue * cfg.usn / 100;
  const cost = variables + fee + tax;
  const profit = revenue - cost;
  const bench = cfg.party_benchmarks || [];
  return {
    revenue, variables, fee, tax, cost, profit,
    margin: revenue > 0 ? 100 * profit / revenue : 0,
    perMonth: profit * input.perMonth,
    revenueMonth: revenue * input.perMonth,
    bench
  };
}
