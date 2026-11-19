/* pricing.js — цена билета и маржа: от себестоимости к цене + тепловая карта
   чувствительности (цена × посещаемость → прибыль показа). */
import { calc as travelCalc } from './travel.js';

export const meta = {
  id: 'pricing',
  icon: 'ticket',
  title: 'Цена билета и маржа',
  what: 'Считает: цену из себестоимости и маржи, чувствительность прибыли к цене и посещаемости',
  when: 'Когда: назначаете цену и минимальную группу'
};

export const controls = cfg => [
  { type: 'range', id: 'margin', label: 'Желаемая маржа показа', min: 10, max: 70, step: 1, def: 35, suffix: '%' },
  { type: 'range', id: 'audience', label: 'Зрителей на показ', min: 20, max: 150, step: 1, def: 45, suffix: 'чел.' },
  { type: 'select', id: 'venue', label: 'Формат площадки', options: [[0, `Сад / школа · оргсбор ${cfg.venue_share.school_garden}%`], [1, `Зал ДК · доля ${cfg.venue_share.dk}%`]] },
  { type: 'select', id: 'route', label: 'Маршрут и ГСМ', options: cfg.travel.routeNames.map((n, i) => [i, n]) }
];

/* Себестоимость одного зрителя при данной аудитории (прямые расходы модели) */
export function unitCost(input, cfg) {
  const t = travelCalc({ ...input, p: 100, own: 0 }, cfg);
  const direct = t.salary + t.social + t.fuel + t.wear;             // не зависит от цены
  const perViewer = t.print + input.p * 0 + (input.venue ? cfg.travel.shareDk : cfg.travel.shareSchool) * 100 + cfg.usn;
  return { direct, perViewer, cost: direct + perViewer * input.audience };
}

export function calc({ margin, audience, venue, route }, cfg) {
  const input = { n: audience, p: 100, k: 1, r: route, dk: venue, own: 0 };
  const t = travelCalc(input, cfg);
  const direct = t.salary + t.social + t.fuel + t.wear;
  const share = venue ? cfg.travel.shareDk : cfg.travel.shareSchool;
  const varPercent = share + cfg.usn / 100 + cfg.travel.print_per_viewer / 100; // доля переменных от цены
  // цена из маржи: P = direct / (n × (1 − varPercent − margin))
  const denom = audience * Math.max(0.05, 1 - varPercent - margin / 100);
  const priceFromMargin = denom > 0 ? Math.ceil(direct / denom / 10) * 10 : null;
  // тепловая карта: цены × аудитория → прибыль показа
  const prices = [250, 275, 300, 325, 350, 375, 400, 450, 500];
  const auds = [20, 30, 45, 60, 90, 150];
  const grid = auds.map(a => prices.map(pr => travelCalc({ n: a, p: pr, k: 1, r: route, dk: venue, own: 0 }, cfg).profit));
  const maxAbs = Math.max(...grid.flat().map(Math.abs), 1);
  return { margin, priceFromMargin, prices, auds, grid, maxAbs, direct, share, varPercent };
}
