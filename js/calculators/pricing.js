/* pricing.js — цена билета и маржа: от себестоимости к цене + тепловая карта
   чувствительности (цена × посещаемость → прибыль показа). Сетка и округление — из config.calc.pricing.
   Цена из маржи выводится из определения маржи показа, а не подгоняется под эталон:
     прибыль = n·P·(1 − доля площадки − УСН) − n·печать − прямые расходы,  маржа m = прибыль / (n·P)
     ⇒ P = (прямые/n + печать) / (1 − доля площадки − УСН − m). */
import { num, nonNeg, share, safeDiv, clamp, rangeField } from './util.js';
import { calc as travelCalc } from './travel.js';

export const meta = {
  id: 'pricing',
  sources: ['usn_income_rate'],
  icon: 'ticket',
  headline: 'amount',            // тип главной цифры: result — со знаком, amount — сумма/цена без плюса, count — целое число
  title: 'Цена билета и маржа',
  what: 'Считает: цену из себестоимости и маржи, чувствительность прибыли к цене и посещаемости',
  when: 'Когда: назначаете цену и минимальную группу'
};

export const controls = cfg => [
  rangeField(cfg, 'pricing', 'margin', 'Желаемая маржа показа'),
  rangeField(cfg, 'pricing', 'audience', 'Зрителей на показ'),
  { type: 'select', id: 'venue', label: 'Формат площадки', options: [[0, `Сад / школа · оргсбор ${cfg.venue_share.school_garden}%`], [1, `Зал ДК · доля ${cfg.venue_share.dk}%`]] },
  { type: 'select', id: 'route', label: 'Маршрут и ГСМ', options: cfg.travel.routeNames.map((n, i) => [i, n]) }
];

/* Округление цены вверх до шага (шаг — из config; без шага цена не округляется) */
const roundUp = (v, step) => (step > 0 ? Math.ceil(v / step) * step : v);

export function calc(input, cfg) {
  const audience = Math.round(nonNeg(input.audience));
  const margin = clamp(nonNeg(input.margin), 0, 100);
  const venue = num(input.venue) ? 1 : 0;
  const route = Math.round(num(input.route));
  const pc = cfg.calc.pricing;
  // прямые расходы показа не зависят от цены: берём их из калькулятора выезда при нулевой цене
  const t = travelCalc({ n: audience, p: 0, k: 1, r: route, dk: venue, own: 0 }, cfg);
  const direct = t.salary + t.social + t.fuel + t.wear;
  const share1 = venue ? cfg.travel.shareDk : cfg.travel.shareSchool;      // доля площадки (доля единицы)
  const varPercent = share1 + share(cfg.usn);                                // доля цены, уходящая площадке и УСН
  const perViewerFixed = safeDiv(direct, audience, 0) + cfg.travel.print_per_viewer; // прямые на зрителя + печать
  // цена из маржи; знаменатель не меньше min_denominator (защита от деления на ноль при нереальной марже)
  const denom = 1 - varPercent - margin / 100;
  const priceFromMargin = audience > 0 && denom >= pc.min_denominator ? roundUp(perViewerFixed / denom, pc.price_round_step) : null;
  // цена безубыточности (маржа 0)
  const be = 1 - varPercent;
  const priceBreakEven = audience > 0 && be > 0 ? roundUp(perViewerFixed / be, pc.price_round_step) : null;
  // тепловая карта: цены × аудитория → прибыль показа
  const prices = pc.grid_prices, auds = pc.grid_audiences;
  const grid = auds.map(a => prices.map(pr => travelCalc({ n: a, p: pr, k: 1, r: route, dk: venue, own: 0 }, cfg).profit));
  const maxAbs = Math.max(...grid.flat().map(Math.abs), 1);
  // проверка: реальная маржа выезда при найденной цене (должна быть не ниже желаемой)
  const check = priceFromMargin != null ? travelCalc({ n: audience, p: priceFromMargin, k: 1, r: route, dk: venue, own: 0 }, cfg) : null;
  return {
    margin, audience, priceFromMargin, priceBreakEven, prices, auds, grid, maxAbs, direct, share: share1, varPercent,
    perViewerFixed, actualMargin: check ? check.margin : null, profitAtPrice: check ? check.profit : null
  };
}

/* Ключевые показатели для сравнения сценариев */
export const summary = r => [
  { label: 'Цена билета из маржи', v: r.priceFromMargin, t: 'rub', empty: 'недостижима' },
  { label: 'Цена безубыточности', v: r.priceBreakEven, t: 'rub', empty: 'нет данных' },
  { label: 'Маржа при этой цене', v: r.actualMargin, t: 'pct', empty: 'нет данных' },
  { label: 'Прибыль показа при этой цене', v: r.profitAtPrice, t: 'rub', empty: 'нет данных' },
  { label: 'Прямые расходы показа', v: r.direct, t: 'rub' }
];
