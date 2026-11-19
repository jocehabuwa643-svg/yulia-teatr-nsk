/* payroll.js — ФОТ: ГПХ против самозанятых против штата.
   Считает только взносы заказчика: модельная ставка из rates.json, а при выплатах сверх предельной базы года —
   сниженный тариф (gphContributions). НДФЛ и точные перечни — за консультацией (плашка в интерфейсе). */
import { num, nonNeg, rangeField, yearField, ruNum } from './util.js';
import { yearParams, gphContributions } from './tax-core.js';

export const meta = {
  id: 'payroll',
  sources: ['gph_contributions_rate', 'gph_contributions_base_rate', 'gph_contributions_above_base_rate', 'gph_contributions_base_limit*', 'npd_rate_companies', 'npd_income_limit'],
  icon: 'users',
  headline: 'amount',            // тип главной цифры: result — со знаком, amount — сумма/цена без плюса, count — целое число
  title: 'ФОТ и ГПХ',
  what: 'Считает: стоимость команды в месяц по трём схемам оплаты труда',
  when: 'Когда: оформляете актёров и техника и выбираете договор'
};

export const controls = cfg => [
  yearField(cfg, { wide: true }),
  rangeField(cfg, 'payroll', 'fee', 'Гонорар на человека в месяц'),
  rangeField(cfg, 'payroll', 'people', 'Человек в команде'),
  { type: 'select', id: 'regular', label: 'Регулярность работы', options: [[0, 'Разовые выезды'], [1, 'Регулярный график']] }
];

export function calc(input, cfg) {
  const p = yearParams(cfg, input.year);
  const fee = nonNeg(input.fee);
  const people = Math.max(1, Math.round(num(input.people, 1)));
  const regular = num(input.regular) ? 1 : 0;
  const months = cfg.calendar.months_per_year;
  const gross = fee * people;
  // взносы считаем по году: выплаты человеку за год сравниваются с предельной базой (если база года известна)
  const contribs = gphContributions(gross * months, cfg, p, people) / months;
  const gphPct = ruNum(cfg.gphRate * 100, 2);
  const gph = { id: 'gph', name: 'ГПХ (наём)', cost: gross + contribs, contribs, note: `Взносы ${gphPct}% — модельная надбавка, не ставка для любого договора` };
  const npd = { id: 'npd', name: 'Самозанятые (НПД)', cost: gross, contribs: 0, note: `Заказчик не платит взносы; исполнитель платит ${ruNum((cfg.npdCompanies || 0) * 100, 2)}% сам` };
  const staff = { id: 'staff', name: 'Штат (трудовой договор)', cost: gross + contribs, contribs, note: 'Взносы по той же модельной ставке; отпускные, больничные и условия труда не включены' };
  const cheapest = Math.min(gph.cost, npd.cost, staff.cost);
  // лимит самозанятого — доход одного исполнителя за год
  const yearPerPerson = fee * months;
  const npdOver = cfg.npdLimit != null && yearPerPerson > cfg.npdLimit;
  const risk = regular
    ? 'При регулярном графике с единым работодателем ГПХ и НПД рискуют переквалификацией в трудовые отношения — оформляйте по фактической организации труда.'
    : 'Разовые выезды допустимы по ГПХ; НПД — только при реальной самостоятельности подрядчика.';
  return {
    year: p.year, gross, gph, npd, staff, cheapest, risk, regular, people, fee, yearPerPerson,
    gphBase: p.gphBase, gphBaseNoData: p.gphBase == null, npdOver, npdLimit: cfg.npdLimit,
    ndflNoData: true // НДФЛ-расчёт сознательно не выполняется без проверенной ставки — плашка в UI
  };
}

/* Ключевые показатели для сравнения сценариев */
export const summary = r => [
  { label: 'Дешевле всего (в месяц)', v: r.cheapest, t: 'rub' },
  { label: 'ГПХ в месяц', v: r.gph.cost, t: 'rub' },
  { label: 'Самозанятые в месяц', v: r.npd.cost, t: 'rub' },
  { label: 'Штат в месяц', v: r.staff.cost, t: 'rub' },
  { label: 'Лимит самозанятого превышен', v: r.npdOver ? 'да' : 'нет', t: 'text' }
];
