/* payroll.js — ФОТ: ГПХ против самозанятых против штата.
   Считает только взносы заказчика по модельной ставке из rates.json; НДФЛ и точные
   перечни — за консультацией (в интерфейсе плашка). */
export const meta = {
  id: 'payroll',
  icon: 'users',
  title: 'ФОТ и ГПХ',
  what: 'Считает: стоимость команды в месяц по трём схемам оплаты труда',
  when: 'Когда: оформляете актёров и техника и выбираете договор'
};

export const controls = cfg => [
  { type: 'range', id: 'fee', label: 'Гонорар на человека в месяц', min: 10000, max: 120000, step: 1000, def: 45000, suffix: '₽' },
  { type: 'range', id: 'people', label: 'Человек в команде', min: 1, max: 8, step: 1, def: 3, suffix: '' },
  { type: 'select', id: 'regular', label: 'Регулярность работы', options: [[0, 'Разовые выезды'], [1, 'Регулярный график']] }
];

export function calc({ fee, people, regular }, cfg) {
  const gross = fee * people;
  const gph = { name: 'ГПХ (наём)', cost: gross * (1 + cfg.gphRate), note: `Взносы ${cfg.gphRate * 100}% — модельная надбавка, не ставка для любого договора` };
  const npd = { name: 'Самозанятые (НПД)', cost: gross, note: `Заказчик не платит взносы; исполнитель платит ${cfg.npdCompanies * 100}% сам` };
  const staff = { name: 'Штат (трудовой договор)', cost: gross * (1 + cfg.gphRate), note: 'Взносы по той же модельной ставке + отпуск, больничные, локации' };
  const cheapest = Math.min(gph.cost, npd.cost, staff.cost);
  const risk = regular
    ? 'При регулярном графике с единым работодателем ГПХ и НПД рискуют переквалификацией в трудовые отношения — оформляйте по фактической организации труда.'
    : 'Разовые выезды допустимы по ГПХ; НПД — только при реальной самостоятельности подрядчика.';
  return {
    gross, gph, npd, staff, cheapest, risk, regular,
    ndflNoData: true // НДФЛ-расчёт сознательно не выполняется без проверенной ставки — плашка в UI
  };
}
