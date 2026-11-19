/* travel.js — калькулятор «Выездной спектакль».
   Чистая функция: никакой DOM-логики. Формула перенесена из проверенной версии без изменений;
   константы приходят из config.json/rates.json, пустые и нечисловые входы превращаются в 0. */
import { num, nonNeg, share, safeDiv, rangeField, ruNum } from './util.js';

export const meta = {
  id: 'travel',
  icon: 'route',
  title: 'Выездной спектакль и область',
  what: 'Считает: чистую прибыль показа и дня, точку безубыточности по зрителям',
  when: 'Когда: перед каждым подтверждением выезда в сад, школу, ДК или область'
};

export const controls = cfg => [
  rangeField(cfg, 'travel', 'kids', 'Дети на показ'),
  rangeField(cfg, 'travel', 'ticket', 'Цена билета'),
  { type: 'select', id: 'venue', label: 'Формат площадки', options: [[0, `Сад / школа · оргсбор ${ruNum(cfg.venue_share.school_garden)}%`], [1, `Зал ДК · доля ${ruNum(cfg.venue_share.dk)}%`]] },
  { type: 'select', id: 'cluster', label: 'Показов в день', options: [[1, 'Один показ'], [2, 'Два подряд'], [3, 'Три подряд']] },
  { type: 'select', id: 'route', label: 'Маршрут и ГСМ', options: cfg.travel.routeNames.map((n, i) => [i, n]) },
  { type: 'select', id: 'cast', label: 'Состав', options: [[0, `Наём по ГПХ · +${ruNum(cfg.gphRate * 100, 2)}% взносов (модель)`], [1, 'Основатели ИП · взносы 0% в модели']] }
];

/* Вход calc(): n — зрителей на показ, p — цена, k — показов в день, r — индекс маршрута,
   dk — зал ДК (1/0), own — играют основатели (1/0) */
export function calc(input, cfg) {
  const t = cfg.travel;
  const n = nonNeg(input.n), p = nonNeg(input.p);
  const k = Math.max(1, Math.round(num(input.k, 1)));
  const r = Math.min(Math.max(0, Math.round(num(input.r))), t.gas.length - 1);
  const dk = num(input.dk) ? 1 : 0, own = num(input.own) ? 1 : 0;
  const gross = n * p * k;
  const rate = dk ? t.shareDk : t.shareSchool;
  const salary = Math.max(r ? t.salary_gastro_day : 0, k * (dk ? t.salary_dk : k > 1 ? t.salary_city_cluster : t.salary_city_single));
  const social = own ? 0 : salary * cfg.gphRate;
  const fuel = t.gas[r] + (dk && !r ? t.delivery_dk_city : 0);
  const wear = k * (dk ? t.wear_dk : t.wear_per_show);
  const print = n * k * t.print_per_viewer;
  const fee = gross * rate;
  const tax = gross * share(cfg.usn);
  const cost = salary + social + fuel + wear + print + fee + tax;
  const profit = gross - cost;
  // безубыточность: фикс. расходы дня ÷ вклад одного зрителя (цена за вычетом доли площадки, УСН и печати)
  const beDenom = p * (1 - rate - share(cfg.usn)) - t.print_per_viewer;
  const be = Math.max(1, Math.ceil(safeDiv(salary + social + fuel + wear, Math.max(1, beDenom), 0)));
  return {
    gross, salary, social, fuel, wear, print, fee, tax, cost, profit, be,
    per: profit / k,
    margin: gross > 0 ? 100 * profit / gross : 0,
    k, rate, usn: cfg.usn
  };
}
export const travelCalc = calc;

/* Поля формы (kids, ticket, …) → вход calc() (n, p, …) */
export const fromForm = i => ({ n: i.kids, p: i.ticket, k: i.cluster, r: i.route, dk: i.venue, own: i.cast });

/* Ключевые показатели для сравнения сценариев */
export const summary = r => [
  { label: 'Чистая прибыль показа', v: r.per, t: 'rub' },
  { label: 'Прибыль дня', v: r.profit, t: 'rub' },
  { label: 'Выручка дня', v: r.gross, t: 'rub' },
  { label: 'Маржа', v: r.margin, t: 'pct' },
  { label: 'Безубыточность, зрителей за день', v: r.be, t: 'int' }
];
