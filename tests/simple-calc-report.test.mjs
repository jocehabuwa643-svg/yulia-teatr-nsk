/* tests/simple-calc-report.test.mjs — экран «Посчитать»: эталоны выведены вручную из формул проекта (в комментариях),
   границы (нули, пустые поля, минус, недостижимая окупаемость, огромные числа). Ожидания не подгоняются под код. Запуск: node --test */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCalcConfig } from '../js/calculators/config.js';
import { firstBadNumber } from '../js/calculators/util.js';
import { simpleProfit } from '../js/simple-calc.js';
import { buildReport, reportDefaults, normalizeReport, approxRub, monthsText, splitInt, seasonMonths, PERIODS } from '../js/simple-calc-report.js';

const J = n => JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url), 'utf-8'));
const cfg = buildCalcConfig({ rates: J('rates'), config: J('config'), competitors: J('competitors') });
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b} (допуск ${eps})`);
const flat = s => s.replace(/\s/g, ' ');           // NBSP → обычный пробел для сравнения строк

/* Эталонные вводы те же, что в simple-calc.test.mjs: выезд 45 детей × 325 ₽, 4 показа в неделю; студия 130 м² */
const T = { mode: 'travel', kids: 45, ticket: 325, perWeek: 4, route: 0, taxPct: 6, venue: 0, perDay: 1, cast: 0, teamFee: null, props: null, otherMonthly: 0, contribPct: 30.2 };
const S = { mode: 'studio', kids: 30, ticket: 350, perWeek: 3, parties: 8, partyCheck: 10000, students: 40, taxPct: 6, area: 130, rent: 1000, subscription: 4300, admin: 35000, marketing: 20000, teamFee: null, props: 300, otherMonthly: 0, contribPct: 30.2 };
const rep = (o = {}) => ({ title: 'Золотой ключик', runN: 9, runUnit: 'months', invest: 0, period: 'month', ...o });
const key = (r, k) => (r.expenses.find(e => e.key === k) || { amount: 0 }).amount;

test('config: новые настройки — с провенансом и пометкой «допущение»', () => {
  assert.equal(seasonMonths(cfg), 9);
  assert.equal(cfg.meta['simple_calc.season_months'].confidence, 'model');
  assert.equal(cfg.simple_calc.report_round_rub, 100);
  assert.ok(cfg.meta['simple_calc.season_months'].source_name && cfg.meta['simple_calc.season_months'].fetched_at);
  assert.deepEqual(reportDefaults(cfg), { title: '', runN: 9, runUnit: 'months', invest: 0, period: 'month' });
});

test('выезд, месяц: выручка 253 500, прибыль 68 033,33; статьи в месяц = показ × 208/12 (17,333 показа)', () => {
  const r = buildReport({ ...T, ...rep() }, cfg);
  near(r.revenue, 253500); near(r.profit, 68033.3333);
  // на показе: площадка 1 462,5; актёры 5 000+1 510; налог 877,5; бензин 1 000; износ 400 + печать 450
  near(key(r, 'venue'), 1462.5 * 208 / 12);   // 25 350
  near(key(r, 'actors'), 6510 * 208 / 12);    // 112 840
  near(key(r, 'tax'), 877.5 * 208 / 12);      // 15 210
  near(key(r, 'road'), 1000 * 208 / 12);      // 17 333,33
  near(key(r, 'other'), 850 * 208 / 12);      // 14 733,33
  assert.equal(r.expenses.some(e => e.key === 'rent' || e.key === 'ads'), false);   // у выезда нет аренды и «своих» расходов — статей нет
  near(r.revenue - r.expensesTotal, r.profit, 0.01);   // бухгалтерия сходится
  assert.equal(r.status, 'plus');
  assert.equal(r.title, 'Золотой ключик');
});

test('выезд, неделя и сезон: неделя = 4 показа × 3 925 = 15 700 (выручка 58 500); сезон 9 мес. = 9 × месяц', () => {
  const w = buildReport({ ...T, ...rep({ period: 'week' }) }, cfg);
  near(w.revenue, 4 * 14625); near(w.profit, 4 * 3925);
  near(w.perPeriod.shows, 4, 1e-9);
  assert.equal(w.cumulative, null);                       // столбики накопления — только для периода длиннее месяца
  const s = buildReport({ ...T, ...rep({ period: 'season' }) }, cfg);
  near(s.revenue, 253500 * 9); near(s.profit, 68033.3333 * 9, 0.05);
  assert.equal(s.cumulative.length, 9);
  near(s.cumulative[8].value, 68033.3333 * 9, 0.05);      // вложений нет — накопление = прибыль
  near(s.perPeriod.week, 15700, 0.01);
});

test('«каждая сотня»: 10 площадке, 44 актёрам, 6 налогам, 7 дороге, 6 прочее, 27 остаётся — ровно 100', () => {
  // доли: 10 · 44,51 · 6 · 6,84 · 5,81 · 26,84 → целые методом наибольших остатков: 3 недостающих рубля — у 26,84 / 6,84 / 5,81
  const h = buildReport({ ...T, ...rep() }, cfg).perHundred;
  const by = k => h.items.find(i => i.key === k).rub;
  assert.deepEqual([by('venue'), by('actors'), by('tax'), by('road'), by('other'), h.keep], [10, 44, 6, 7, 6, 27]);
  assert.equal(h.items.reduce((a, i) => a + i.rub, 0) + h.keep, 100);
});

test('окупаемость: вложения 300 000 ÷ 68 033,33 = 4,41 мес.; показов ⌈4,41 × 17,333⌉ = 77; накопление уходит в плюс на 5-м месяце', () => {
  const r = buildReport({ ...T, ...rep({ invest: 300000, period: 'season' }) }, cfg);
  assert.equal(r.payback.state, 'ok');
  near(r.payback.months, 300000 / 68033.3333, 1e-6);
  assert.equal(r.payback.shows, 77);
  assert.equal(flat(monthsText(r.payback.months, cfg)), '≈ 5 мес.');
  // накопление: 4 мес.: 4 × 68 033,33 − 300 000 = −27 866,67; 5 мес.: +40 166,67
  near(r.cumulative[3].value, -27866.6667, 0.05); near(r.cumulative[4].value, 40166.6667, 0.05);
  assert.equal(r.cumulative.findIndex(c => c.value >= 0), 4);
  near(r.profitAfterInvest, 68033.3333 * 9 - 300000, 0.05);
});

test('прокат: 12 недель = 12 × 4 показа × 3 925 = 188 400; за вычетом 300 000 вложений — −111 600', () => {
  const r = buildReport({ ...T, ...rep({ invest: 300000, runN: 12, runUnit: 'weeks' }) }, cfg);
  near(r.run.months, 12 * 12 / 52, 1e-9);
  near(r.run.profit, 188400, 0.01); near(r.run.net, -111600, 0.01);
  near(buildReport({ ...T, ...rep({ runN: 3, runUnit: 'months' }) }, cfg).run.profit, 3 * 68033.3333, 0.05);
});

test('минус: 30 детей по 300 ₽ → прибыль месяца −11 266,67; окупаемости нет; «выйти в ноль» — честно', () => {
  const r = buildReport({ ...T, kids: 30, ticket: 300, ...rep({ invest: 50000 }) }, cfg);
  near(r.profit, -650 * 208 / 12, 0.01);
  assert.equal(r.status, 'minus');
  assert.equal(r.payback.state, 'never'); assert.equal(r.payback.months, null);
  assert.equal(monthsText(r.payback.months, cfg), 'пока не окупается');
  assert.equal(r.breakEven.shows, null);                  // каждый показ убыточен — больше показов не помогут
  assert.equal(r.perHundred.keep, 0);
  assert.ok(r.perHundred.total > 100);                    // расходы 9 650 на выручку 9 000 → 107 ₽ на каждые 100 ₽
  assert.match(r.verdict, /в минусе/);
  assert.equal(firstBadNumber(r), null);
});

test('выезд: выход в ноль. Без своих расходов — 0; со своими 20 000 ÷ 3 925 → 6 показов в месяц, в неделю ⌈6 × 12/52 = 1,38⌉ = 2', () => {
  assert.equal(buildReport({ ...T, ...rep() }, cfg).breakEven.shows, 0);
  const r = buildReport({ ...T, otherMonthly: 20000, ...rep({ period: 'week' }) }, cfg);
  assert.equal(r.breakEven.shows, 6);
  assert.equal(r.breakEven.showsPerPeriod, 2);
  near(key(r, 'ads'), 20000 * 12 / 52, 0.01);
  assert.equal(r.breakEven.kids, 31);                     // из simple-calc.test: 7 910 ÷ 263 → 31
});

test('студия, месяц: выручка 388 500, прибыль 13 333,2; помещение 130 × (1 000 + 200) = 156 000; реклама 20 000; налог 23 310', () => {
  const r = buildReport({ ...S, ...rep() }, cfg);
  near(r.revenue, 388500); near(r.profit, 13333.2);
  near(key(r, 'rent'), 156000); near(key(r, 'ads'), 20000); near(key(r, 'tax'), 23310);
  // актёры: преподаватели 49 996,8 + показы 13 × 3 500 × 1,302 = 59 241 → 109 237,8
  near(key(r, 'actors'), 109237.8, 0.01);
  // прочее: админ 35 000 + реквизит 13 × 300 + касса 13 × 0,03 × 30 × 350 + праздники 23 624 = 66 619
  near(key(r, 'other'), 66619, 0.01);
  near(r.expensesTotal, 375166.8, 0.01);
  assert.equal(r.breakEven.shows, 11);
  near(r.profit, simpleProfit(S, cfg).monthly, 1e-6);     // согласованность с simpleProfit
});

test('студия: свои вводы доходят до статей (аренда 1 500/м², гонорар 4 000 за спектакль)', () => {
  const r = buildReport({ ...S, rent: 1500, teamFee: 4000, ...rep() }, cfg);
  near(key(r, 'rent'), 130 * 1700);
  // актёры: преподаватели 49 996,8 + 13 × 4 000 × 1,302 = 67 704
  near(key(r, 'actors'), 49996.8 + 13 * 4000 * 1.302, 0.01);
});

test('границы: нули, пустые поля, строки — нет NaN/Infinity, статьи не отрицательны', () => {
  const zero = buildReport({ ...T, kids: 0, perWeek: 0, ...rep() }, cfg);
  assert.equal(zero.revenue, 0); assert.equal(zero.perHundred, null); assert.equal(zero.expenses.length, 0);
  assert.match(zero.verdict, /нечего считать/);
  assert.equal(firstBadNumber(zero), null);
  const blanks = buildReport({ mode: 'travel', kids: '', ticket: '', perWeek: '', taxPct: '', title: '   ', runN: '', invest: '', period: 'nope' }, cfg);
  assert.equal(firstBadNumber(blanks), null);
  assert.equal(blanks.title, 'Мой спектакль'); assert.equal(blanks.period, 'month');
  const sz = buildReport({ ...S, kids: 0, perWeek: 0, parties: 0, students: 0, ...rep() }, cfg);
  assert.equal(firstBadNumber(sz), null);
  sz.expenses.forEach(e => assert.ok(e.amount > 0));
  assert.ok(sz.profit < 0);                               // постоянные расходы студии без доходов — честный минус
  assert.equal(sz.status, 'minus');
});

test('границы: огромные числа упираются в технический предел, а не в Infinity', () => {
  [T, S].forEach(base => {
    const r = buildReport({ ...base, kids: 1e300, ticket: 1e300, perWeek: 1e300, parties: 1e300, students: 1e300, ...rep({ invest: 1e300, runN: 1e300, period: 'season' }) }, cfg);
    assert.equal(firstBadNumber(r), null);
    assert.ok(Number.isFinite(r.revenue) && Number.isFinite(r.run.profit));
  });
  assert.equal(firstBadNumber(buildReport({ ...T, kids: -5, ...rep({ invest: -10 }) }, cfg)), null);   // отрицательные вводы = 0
});

test('подача: округление до шага из config (100 ₽) с «≈»; настоящий минус; сумма «сотни» через наибольшие остатки', () => {
  assert.equal(flat(approxRub(68033.33, cfg)), '≈ 68 000 ₽');
  assert.equal(flat(approxRub(68061, cfg)), '≈ 68 100 ₽');
  assert.equal(flat(approxRub(-11266.67, cfg)), '≈ −11 300 ₽');
  assert.equal(flat(approxRub(-20, cfg)), '≈ 0 ₽');                // «−0» не показываем
  assert.equal(flat(approxRub(NaN, cfg)), '≈ 0 ₽');
  assert.deepEqual(splitInt([33.4, 33.3, 33.3], 100), [34, 33, 33]);
  assert.equal(flat(monthsText(0.4, cfg)), 'меньше месяца');
  assert.equal(flat(monthsText(30, cfg)), '≈ 3 года');
  assert.equal(monthsText(0, cfg), 'вложений нет');
});

test('нормализация полей: мусор из хранилища заменяется значениями по умолчанию', () => {
  assert.deepEqual(normalizeReport({ title: 5, runN: 'abc', runUnit: 'days', invest: -3, period: 'year' }, cfg), { title: '', runN: 9, runUnit: 'months', invest: 0, period: 'month' });
  assert.equal(normalizeReport(null, cfg).period, 'month');
  assert.equal(normalizeReport({ title: 'я'.repeat(100) }, cfg).title.length, 40);   // как у имени сценария
  assert.deepEqual(PERIODS.map(p => p.id), ['week', 'month', 'season']);
});
