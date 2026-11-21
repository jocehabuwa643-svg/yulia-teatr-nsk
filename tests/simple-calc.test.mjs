/* tests/simple-calc.test.mjs — «Сколько я заработаю»: эталоны посчитаны вручную из формул проекта (в комментариях),
   границы, согласованность с travel.calc и basecamp.calc. Ожидания не подгоняются под код. Запуск: node --test */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCalcConfig } from '../js/calculators/config.js';
import { firstBadNumber } from '../js/calculators/util.js';
import { calc as travel } from '../js/calculators/travel.js';
import { calc as basecamp } from '../js/calculators/basecamp.js';
import { buildComparison } from '../js/calculators/scenarios.js';
import { simpleProfit, simpleFields, simpleDefaults, statusOf, makeSimpleModule, MODES } from '../js/simple-calc.js';

const J = n => JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url), 'utf-8'));
const cfg = buildCalcConfig({ rates: J('rates'), config: J('config'), competitors: J('competitors') });
const seasonality = J('seasonality').months;
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b} (допуск ${eps})`);

/* Вводы-эталоны. Выезд: сад, Новосибирск, ГПХ, УСН 6%, взносы 30,2%, 45 детей по 325 ₽, 4 показа в неделю.
   Студия: 130 м², аренда 1000, 30 детей по 350 ₽, 3 показа в неделю, 8 праздников по 10 000 ₽, 40 учеников по 4300 ₽. */
const T = { mode: 'travel', kids: 45, ticket: 325, perWeek: 4, route: 0, taxPct: 6, venue: 0, perDay: 1, cast: 0, teamFee: null, props: null, otherMonthly: 0, contribPct: 30.2 };
const S = { mode: 'studio', kids: 30, ticket: 350, perWeek: 3, parties: 8, partyCheck: 10000, students: 40, taxPct: 6, area: 130, rent: 1000, subscription: 4300, admin: 35000, marketing: 20000, teamFee: null, props: 300, otherMonthly: 0, contribPct: 30.2 };

test('данные: значения по умолчанию полей — из config и совпадают с эталонными вводами', () => {
  const dt = simpleDefaults(cfg, 'travel'), ds = simpleDefaults(cfg, 'studio');
  assert.equal(dt.kids, 45); assert.equal(dt.ticket, 325); assert.equal(dt.perWeek, 4); assert.equal(dt.taxPct, 6);
  near(dt.contribPct, 30.2, 1e-9); assert.equal(dt.props, null);   // реквизит выезда — «по модели» (600 ₽ в ДК вместо 400)
  assert.equal(ds.kids, 30); assert.equal(ds.ticket, 350); assert.equal(ds.students, 40);   // билет студии — выходного дня (350), не выездной (325)
  assert.equal(simpleProfit(ds, cfg).monthly.toFixed(1), '13333.2');   // значения по умолчанию = эталон ниже assert.equal(ds.rent, 1000); assert.equal(ds.admin, 35000);
  // на экране не больше семи крупных полей
  MODES.forEach(m => assert.ok(simpleFields(cfg, m.id).main.length <= 7));
});

test('выезд: эталон. Показ: выручка 45×325 = 14 625; доля площадки 10% = 1 462,5; гонорар 5 000; взносы 5 000×0,302 = 1 510; ГСМ 1 000; износ 400; печать 45×10 = 450; УСН 14 625×0,06 = 877,5; расходы 10 700; прибыль 3 925', () => {
  const r = simpleProfit(T, cfg, { seasonality });
  near(r.perShow, 3925);
  // месяц = 3 925 × 4 × 52 ÷ 12 = 68 033,33; год = ×12 = 3 925 × 4 × 52 = 816 400
  near(r.showsMonth, 4 * 52 / 12, 1e-9);
  near(r.monthly, 68033.3333, 0.01);
  near(r.yearly, 816400, 0.01);
  // выручка месяца 14 625 × 208 ÷ 12 = 253 500
  near(r.revenueMonth, 253500, 0.01);
  assert.equal(r.status, 'plus');
  // безубыточность по детям: фикс дня 5 000+1 510+1 000+400 = 7 910; вклад зрителя 325×(1−0,10−0,06)−10 = 263; 7 910÷263 = 30,08 → 31
  assert.equal(r.breakEvenKids, 31);
  assert.equal(r.breakEvenShows, null);          // своих постоянных расходов нет — точка по показам не нужна
  assert.equal(firstBadNumber(r), null);
});

test('выезд: согласованность — прибыль показа совпадает с travel.calc при тех же вводах', () => {
  [[45, 325, 1, 0, 0, 0], [60, 350, 2, 0, 0, 0], [150, 350, 1, 0, 1, 0], [45, 300, 3, 1, 0, 0], [45, 325, 1, 0, 0, 1], [45, 300, 1, 5, 0, 0]].forEach(([n, p, k, rt, dk, own]) => {
    const r = simpleProfit({ ...T, kids: n, ticket: p, perDay: k, route: rt, venue: dk, cast: own }, cfg);
    near(r.perShow, travel({ n, p, k, r: rt, dk, own }, cfg).per, 1e-6);
  });
});

test('выезд: убыток. 30 детей по 300 ₽: прибыль показа −650, месяц −650×208÷12 = −11 266,67; подсказки считаются подстановкой', () => {
  const r = simpleProfit({ ...T, kids: 30, ticket: 300 }, cfg);
  // расходы 5 000+1 510+1 000+400+300+900+540 = 9 650 при выручке 9 000
  near(r.perShow, -650);
  near(r.monthly, -650 * 208 / 12, 0.01);
  assert.equal(r.status, 'minus');
  // цена: 30p×0,84 − 8 210 ≥ 0 → p ≥ 325,8 → ближайшая кратная 10: 330 (при 320 ещё −146)
  const price = r.advice.find(a => a.kind === 'price');
  assert.equal(price.to, 330); assert.equal(price.zero, true);
  near(price.gain, (30 * 330 * 0.84 - 8210) * 208 / 12 + 650 * 208 / 12, 0.01);
  // дети: n×(300×0,84−10) − 7 910 = 242n − 7 910 ≥ 0 → n ≥ 32,69 → 33
  assert.equal(r.advice.find(a => a.kind === 'kids').to, 33);
  // показ убыточен — «добавить показы» не советуем
  assert.ok(!r.advice.some(a => a.kind === 'shows'));
  // найденная цена действительно выводит в плюс
  assert.ok(simpleProfit({ ...T, kids: 30, ticket: 330 }, cfg).monthly >= 0);
});

test('выезд: свои постоянные расходы вычитаются, точка безубыточности — в показах', () => {
  const r = simpleProfit({ ...T, otherMonthly: 20000 }, cfg);
  near(r.monthly, 68033.3333 - 20000, 0.01);
  assert.equal(r.breakEvenShows, 6);             // 20 000 ÷ 3 925 = 5,09 → 6 показов в месяц
});

test('выезд: сезонность из seasonality.json — декабрь (1,45) максимум, январь (0,45) минимум; сумма месяцев = год', () => {
  const r = simpleProfit(T, cfg, { seasonality });
  // среднее факторов = 11 ÷ 12; месяц = средний × factor ÷ среднее
  assert.equal(r.season.hi.name, 'Декабрь'); assert.equal(r.season.lo.name, 'Январь');
  near(r.season.hi.monthly, 68033.3333 * 1.45 * 12 / 11, 0.05);
  near(r.season.lo.monthly, 68033.3333 * 0.45 * 12 / 11, 0.05);
  near(r.season.rows.reduce((a, x) => a + x.monthly, 0), r.yearly, 0.05);
  // без данных сезонности блока нет
  assert.equal(simpleProfit(T, cfg).season, null);
});

test('студия: эталон. Выручка 13×30×350 + 8×10 000 + 40×4 300 = 136 500 + 80 000 + 172 000 = 388 500', () => {
  const r = simpleProfit(S, cfg);
  // постоянные 130×(1 000+200) + 35 000 + 20 000 = 211 000; преподаватели ⌈40÷10⌉=4 группы × 8 × 1 200 × 1,302 = 49 996,8
  // показы выходного дня 13 × (3 500×1,302 + 300 + 0,03×30×350) = 13 × 5 172 = 67 236; праздники 8 × 2 953 = 23 624; УСН 388 500×0,06 = 23 310
  // прибыль = 388 500 − 211 000 − 49 996,8 − 67 236 − 23 624 − 23 310 = 13 333,2
  near(r.revenueMonth, 388500);
  near(r.monthly, 13333.2, 0.01);
  near(r.yearly, 13333.2 * 12, 0.05);
  // вклад одного показа: 10 500×(1−0,06) − 5 172 = 4 698
  near(r.perShow, 4698, 0.01);
  // без показов месяц = 13 333,2 − 13×4 698 = −47 740,8 → до нуля 47 740,8 ÷ 4 698 = 10,16 → 11 показов в месяц
  assert.equal(r.breakEvenShows, 11);
  assert.equal(r.status, 'plus');
  assert.equal(r.season, null);                  // для студии сезонность не показываем
  assert.equal(firstBadNumber(r), null);
});

test('студия: согласованность с basecamp.calc без выездов (прибыль базы)', () => {
  const b = basecamp({ year: 2027, area: 130, rent: 1000, students: 40, sub: 4300, week: 13, attendance: 30, party: 8, eventprice: 10000, trips: 0, teams: 1 }, cfg);
  near(simpleProfit(S, cfg).monthly, b.x.profit, 0.01);
});

test('студия: свой налог и цена билета доходят до расчёта', () => {
  const r = simpleProfit({ ...S, taxPct: 0 }, cfg);
  near(r.monthly, 13333.2 + 23310, 0.01);
  assert.equal(r.parts.find(p => p.id === 'tax').v, 0);
  // билет 400 вместо 350: выручка +13×30×50 = 19 500, налог +1 170, касса площадки +3%×30×50×13 = 585
  near(simpleProfit({ ...S, ticket: 400 }, cfg).monthly - 13333.2, 19500 - 1170 - 585, 0.01);
});

test('границы: 0 детей, 0 показов, пустые и нечисловые поля — без NaN и undefined', () => {
  const variants = [{ kids: 0 }, { perWeek: 0 }, { kids: 0, perWeek: 0 }, { ticket: 0 }, { kids: '', ticket: '', perWeek: '' }, { kids: 'abc', perWeek: null }, { kids: -5, perWeek: -2 }, { taxPct: '' }, { perDay: 0 }, { route: 99 }];
  [T, S].forEach(base => variants.forEach(v => {
    const r = simpleProfit({ ...base, ...v }, cfg, { seasonality });
    assert.equal(firstBadNumber(r), null, JSON.stringify(v));
    assert.ok(['plus', 'zero', 'minus'].includes(r.status));
  }));
  assert.equal(simpleProfit({ ...T, perWeek: 0 }, cfg).empty, 'shows');
  assert.equal(simpleProfit({ ...T, kids: 0 }, cfg).empty, 'kids');
  near(simpleProfit({ ...T, perWeek: 0 }, cfg).monthly, 0);
  // 0 показов, но есть постоянные расходы: месяц = −расходы
  near(simpleProfit({ ...T, perWeek: 0, otherMonthly: 5000 }, cfg).monthly, -5000);
});

test('статус: около нуля — в пределах полосы из config; знак определяет остальное', () => {
  assert.equal(statusOf(0, 0, cfg), 'zero');
  assert.equal(statusOf(100, 100000, cfg), 'zero');       // 0,1% выручки < 2%
  assert.equal(statusOf(5000, 100000, cfg), 'plus');
  assert.equal(statusOf(-5000, 100000, cfg), 'minus');
});

test('плюс: подсказки — +1 шаг цены и +1 показ в неделю, прирост посчитан подстановкой', () => {
  const r = simpleProfit(T, cfg);
  const price = r.advice.find(a => a.kind === 'price'), shows = r.advice.find(a => a.kind === 'shows');
  assert.equal(price.to, 330); assert.equal(price.zero, false);
  // +5 ₽ к билету: 45×5×(1−0,10−0,06) = 189 ₽ с показа × 208 ÷ 12 = 3 276
  near(price.gain, 189 * 208 / 12, 0.01);
  assert.equal(shows.to, 5);
  near(shows.gain, 3925 * 52 / 12, 0.01);                 // +1 показ в неделю = 3 925 × 52 ÷ 12 = 17 008,33
});

test('НДС: годовая выручка выше порога даёт предупреждение; обычный сценарий — без него', () => {
  assert.equal(simpleProfit(T, cfg).vatOver, false);
  assert.equal(simpleProfit({ ...T, kids: 500, ticket: 1000, perWeek: 20 }, cfg).vatOver, true);  // 500 000 × 20 × 52 = 520 млн ₽ в год
});

test('сравнение сценариев: модуль простого калькулятора работает с scenarios.buildComparison', () => {
  const mod = makeSimpleModule(seasonality);
  const cmp = buildComparison({ mod, cfg, ctx: {}, scenarios: [{ id: 'a', name: 'Дороже', at: '2026-11-21', inputs: { ...T, ticket: 400 } }], currentInputs: T });
  const row = cmp.rows.find(x => x.label === 'Чистыми в месяц');
  assert.equal(row.cells.length, 2);
  assert.ok(row.cells[1].raw > row.cells[0].raw);
  near(row.cells[0].raw, 68033.3333, 0.01);
});
