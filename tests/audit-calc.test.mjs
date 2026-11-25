/* tests/audit-calc.test.mjs — баги расчётов из аудита владельца (2026-11-24): 1(а) «Мой спектакль» при 0 детей,
   1(б) «Расчёты → Выезды» с 0 детей, 1(в) вычет взносов ИП из УСН «Доходы» в остатке владельца.
   Эталоны выведены вручную из формул и data/*.json (в комментариях); ожидания не подгоняются под код. Запуск: node --test */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCalcConfig } from '../js/calculators/config.js';
import { firstBadNumber } from '../js/calculators/util.js';
import { runCalc } from '../js/calculators/run.js';
import * as travel from '../js/calculators/travel.js';
import { calc as taxes, controls as taxControls, hasStaff } from '../js/calculators/taxes.js';
import { buildReport, shownBook } from '../js/simple-calc-report.js';

const J = n => JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url), 'utf-8'));
const cfg = buildCalcConfig({ rates: J('rates'), config: J('config'), competitors: J('competitors') });
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b} (допуск ${eps})`);
const flat = s => s.replace(/\s/g, ' ');

/* Те же эталонные вводы, что в simple-calc-report.test.mjs: выезд 45 детей × 325 ₽, 4 показа в неделю */
const T = { mode: 'travel', kids: 45, ticket: 325, perWeek: 4, route: 0, taxPct: 6, venue: 0, perDay: 1, cast: 0, teamFee: null, props: null, otherMonthly: 0, contribPct: 30.2 };
const rep = (o = {}) => ({ title: '', runN: 9, runUnit: 'months', invest: 0, period: 'month', ...o });
const sum = a => a.reduce((s, x) => s + x, 0);

/* ================= 1(а) «Мой спектакль»: верх = строки = итог ================= */

test('1а: 0 детей — «Ушло всего» = сумма строк = «Осталось» со знаком минус (≈ 137 100 ₽)', () => {
  // на показ: гонорар 5 000 + взносы 30,2% 1 510 = 6 510; бензин 1 000; износ 400; печать/площадка/налог = 0 (нет кассы)
  // показов в месяц 4 × 52 ÷ 12 = 17,333: актёры 112 840; дорога 17 333,33; прочее 6 933,33; всего 137 106,67
  const r = buildReport({ ...T, kids: 0, ...rep() }, cfg);
  near(r.expensesTotal, 137106.67, 0.01);
  near(r.profit, -137106.67, 0.01);
  const sh = r.shown;
  assert.equal(sh.revenue, 0);
  assert.equal(sh.expensesTotal, 137100);                     // одна точка округления: 137 106,67 → 137 100
  assert.equal(sh.profit, -137100);                           // Осталось = Пришло − Ушло
  // строки делят 137 100 наибольшими остатками в сотнях: 1 128,4 / 173,33 / 69,33 → 1 129 + 173 + 69 = 1 371 сотня
  assert.deepEqual(sh.items.map(e => [e.key, e.amount]), [['actors', 112900], ['road', 17300], ['other', 6900]]);
  assert.equal(sum(sh.items.map(e => e.amount)), sh.expensesTotal);
  // в минусе с детьми (10 в зале): фраза-вывод называет ту же сумму, что «Осталось вам»
  const m = buildReport({ ...T, kids: 10, ...rep() }, cfg);
  assert.equal(m.status, 'minus');
  assert.ok(flat(m.verdict).includes(`примерно на ${(-m.shown.profit).toLocaleString('ru-RU').replace(/\s/g, ' ')} ₽`), m.verdict);
});

test('1а: обычный сценарий (45 детей) — подача сходится до рубля', () => {
  // выручка 45 × 325 × 17,333 = 253 500; расходы 185 466,67 → 185 500; осталось 253 500 − 185 500 = 68 000
  const r = buildReport({ ...T, ...rep() }, cfg);
  const sh = r.shown;
  assert.equal(sh.revenue, 253500);
  assert.equal(sh.expensesTotal, 185500);
  assert.equal(sh.profit, 68000);
  assert.equal(sum(sh.items.map(e => e.amount)), 185500);
  assert.ok(sh.items.every(e => e.amount % 100 === 0));
});

test('1а: сезон и неделя, студия — верх, строки и итог согласованы в любом периоде', () => {
  const S = { mode: 'studio', kids: 0, ticket: 350, perWeek: 3, parties: 8, partyCheck: 10000, students: 40, taxPct: 6, area: 130, rent: 1000, subscription: 4300, admin: 35000, marketing: 20000, teamFee: null, props: 300, otherMonthly: 5000, contribPct: 30.2 };
  for (const input of [{ ...T, kids: 0 }, T, S, { ...S, kids: 30 }]) {
    for (const period of ['week', 'month', 'season']) {
      const r = buildReport({ ...input, ...rep({ period, invest: 50000 }) }, cfg);
      const sh = r.shown;
      assert.equal(sum(sh.items.map(e => e.amount)), sh.expensesTotal, `${input.mode}/${period}`);
      assert.equal(sh.revenue - sh.expensesTotal, sh.profit, `${input.mode}/${period}`);
      assert.ok(Math.abs(sh.profit - r.profit) <= sh.step, `${input.mode}/${period}: ${sh.profit} vs ${r.profit}`);
      assert.equal(firstBadNumber(sh), null);
    }
  }
});

test('1а: shownBook без расходов — нули, без NaN', () => {
  const sh = shownBook({ revenue: 0, expensesTotal: 0, expenses: [] }, cfg);
  assert.deepEqual(sh, { step: 100, revenue: 0, expensesTotal: 0, profit: 0, items: [] });
});

/* ================= 1(б) «Расчёты → Выезды»: 0 детей разрешён ================= */

test('1б: поле «Дети на показ» начинается с 0 (как в «Заработке»)', () => {
  const kids = travel.controls(cfg).find(f => f.id === 'kids');
  assert.equal(kids.min, 0);
  assert.equal(cfg.calc.controls.simple.kids.min, 0);
});

test('1б: 0 детей — выручка 0, расходы реальные, прибыль отрицательная, безубыточность ≥ 1', () => {
  // гонорар 5 000 + взносы 1 510 + бензин 1 000 + износ 400 = 7 910; печать 0 (нет зрителей), площадка и УСН от 0 = 0
  const r = runCalc(travel, { kids: 0, ticket: 325, cluster: 1, venue: 0, route: 0, cast: 0 }, cfg);
  assert.equal(r.gross, 0);
  near(r.cost, 7910, 1e-6);
  near(r.profit, -7910, 1e-6);
  assert.equal(r.margin, 0);
  // «сколько нужно» не меньше 1: 7 910 ÷ (325 × (1 − 0,10 − 0,06) − 10 = 263) = 30,08 → 31 зритель
  assert.equal(r.be, 31);
  assert.equal(firstBadNumber(r), null);
  // ДК и 3 показа в день тоже без NaN
  assert.equal(firstBadNumber(runCalc(travel, { kids: 0, ticket: 325, cluster: 3, venue: 1, route: 2, cast: 1 }, cfg)), null);
});

/* ================= 1(в) Налоги: вычет взносов ИП из УСН «Доходы» ================= */

const TX = { year: 2027, revenue: 3.6e6, costShare: 55, social: 0 };

test('1в: без работников — вычет до 100%: налог 216 000 − 94 154 = 121 846 к уплате', () => {
  // налог 6% × 3 600 000 = 216 000; взносы ИП 2027 = 61 154 + 1% × (3 600 000 − 300 000) = 94 154
  const r = taxes({ ...TX, employees: 0 }, cfg);
  near(r.usn6Tax, 216000, 1e-6);
  near(r.usn6Deduction, 94154, 1e-6);
  near(r.usn6Pay, 121846, 1e-6);
  assert.equal(r.staff, false);
  assert.equal(r.dedPct, 100);
  // остаток = 3 600 000 − расходы 1 980 000 − налог к уплате 121 846 − взносы 94 154 = 1 404 000
  near(r.ownerNet, 1404000, 1e-6);
  // раньше вычитались и полный налог, и полные взносы: 1 309 846 (так считается только «точка перехода»)
  near(r.now.netUsn6, 1309846, 1e-6);
  near(r.ownerNet - r.now.netUsn6, 94154, 1e-6);
});

test('1в: есть штат — вычет не больше 50% налога (108 000)', () => {
  // гонорары 1 200 000 × 30,2% = 362 400 взносов за работников; пул 94 154 + 362 400 = 456 554; лимит 50% × 216 000 = 108 000
  for (const staff of ['auto', 1]) {
    const r = taxes({ ...TX, employees: 1.2e6, staff }, cfg);
    assert.equal(r.staff, true);
    assert.equal(r.dedPct, 50);
    near(r.usn6Deduction, 108000, 1e-6);
    near(r.usn6Pay, 108000, 1e-6);
    // решение владельца 25.11.2026: взносы с гонораров (362 400) — поверх доли расходов 55%
    // остаток = 3 600 000 − 1 980 000 − 362 400 − 108 000 − 94 154 = 1 055 446
    near(r.ownerNet, 1055446, 1e-6);
  }
  // штат есть, но пул меньше лимита: только взносы за себя 94 154 < 108 000 → вычет 94 154
  const small = taxes({ ...TX, employees: 0, staff: 1 }, cfg);
  near(small.usn6Deduction, 94154, 1e-6);
  near(small.usn6Pay, 121846, 1e-6);
});

test('1в: переключатель «работаю одна» при гонорарах (команда — самозанятые) — до 100%, пул только взносы ИП', () => {
  const r = taxes({ ...TX, employees: 1.2e6, staff: 0 }, cfg);
  assert.equal(r.staff, false);
  near(r.usn6Deduction, 94154, 1e-6);
  near(r.usn6Pay, 121846, 1e-6);
});

test('1в: налог к уплате не меньше 0; переключатель есть в полях «Налогов»; без NaN', () => {
  // маленькая выручка: налог 6% × 500 000 = 30 000 < взносов 61 154 + 2 000 = 63 154 → вычет 30 000, к уплате 0
  const r = taxes({ ...TX, revenue: 5e5, employees: 0 }, cfg);
  near(r.usn6Tax, 30000, 1e-6);
  near(r.usn6Deduction, 30000, 1e-6);
  assert.equal(r.usn6Pay, 0);
  const f = taxControls(cfg).find(x => x.id === 'staff');
  assert.ok(f && f.type === 'select' && f.def === 'auto');
  assert.deepEqual(f.options.map(o => o[0]), ['auto', 0, 1]);
  assert.equal(hasStaff('auto', 0), false);
  assert.equal(hasStaff('auto', 1), true);
  assert.equal(hasStaff('0', 1e6), false);
  assert.equal(hasStaff('1', 0), true);
  for (const staff of ['auto', 0, 1, '', null, 'abc']) assert.equal(firstBadNumber(taxes({ ...TX, employees: 1.2e6, staff }, cfg)), null);
});

test('1в: лимиты вычета — из rates.json с источником', () => {
  assert.equal(cfg.deductNoStaff, 100);
  assert.equal(cfg.deductWithStaff, 50);
  for (const k of ['usn_deduction_no_staff_pct', 'usn_deduction_with_staff_pct']) assert.ok(cfg.rateMeta[k] && cfg.rateMeta[k].source_name, k);
});

/* ==== Приёмка: лучший режим по налогу к уплате, конфликт «работаю одна» + ГПХ, склонение единиц ==== */
import { agreeSuffix } from '../js/calculators/scenarios.js';

test('налоги: bestPay выбирается по налогу к уплате; шапка и смета совпадают с плашками', () => {
  const taxesCalc = taxes, cfgAudit = () => cfg;
  const r = taxesCalc({ year: 2027, revenue: 3.6e6, costShare: 55, employees: 1.2e6, social: 0, staff: 'auto' }, cfgAudit());
  const u = r.regimes.find(g => g.id === 'usn6');
  assert.equal(u.pay, r.usn6Pay);                                 // 108 000 к уплате
  assert.equal(r.bestPay.id, 'usn6');
  assert.ok(r.regimes.every(g => g.tax == null || g.pay <= g.tax)); // к уплате не больше налога до вычета
  assert.equal(r.staffConflict, false);
  const solo = taxesCalc({ year: 2027, revenue: 3.6e6, costShare: 55, employees: 1.2e6, social: 0, staff: 0 }, cfgAudit());
  assert.equal(solo.staffConflict, true);                         // «работаю одна», но гонорары по ГПХ есть → предупреждение
  const soloClean = taxesCalc({ year: 2027, revenue: 3.6e6, costShare: 55, employees: 0, social: 0, staff: 0 }, cfgAudit());
  assert.equal(soloClean.staffConflict, false);
});

test('единицы согласуются с числом: 1 показ, 2 показа, 5 показов, 11 показов, 21 показ, 1,5 показа', () => {
  assert.equal(agreeSuffix('показов', 1), 'показ');
  assert.equal(agreeSuffix('показов', 2), 'показа');
  assert.equal(agreeSuffix('показов', 5), 'показов');
  assert.equal(agreeSuffix('показов', 11), 'показов');
  assert.equal(agreeSuffix('показов', 21), 'показ');
  assert.equal(agreeSuffix('показов', 1.5), 'показа');
  assert.equal(agreeSuffix('показов/мес', 3), 'показа/мес');
  assert.equal(agreeSuffix('чел.', 1), 'чел.');
});

/* Решение владельца 25.11.2026: взносы по ГПХ — поверх доли расходов, одинаково в УСН «Доходы» и «Доходы − расходы» */
test('1в: оба режима УСН считают остаток владельца на одной базе (взносы с гонораров поверх 55%)', () => {
  const r = taxes({ ...TX, employees: 1.2e6, staff: 1 }, cfg);
  near(r.paidGph, 362400, 1e-6);                          // 1 200 000 × 30,2%
  // «Доходы − расходы»: база = 3 600 000 − 1 980 000 − (94 154 + 362 400) = 1 163 446; 15% = 174 516,9
  // (минимальный налог 1% × 3 600 000 = 36 000 меньше) → к уплате 174 516,9
  const g15 = r.regimes.find(g => g.id === 'usn15');
  near(g15.pay, 174516.9, 1e-6);
  // остаток = 3 600 000 − 1 980 000 − 362 400 − 174 516,9 − 94 154 = 988 929,1
  near(r.ownerNet15, 988929.1, 1e-6);
  near(g15.ownerNet, r.ownerNet15, 1e-6);
  // разница остатков = разница налогов к уплате (одна база): 174 516,9 − 108 000 = 66 516,9
  near(r.ownerNet - r.ownerNet15, 66516.9, 1e-6);
  // «работаю одна» (команда на НПД): взносов с гонораров нет ни в одном режиме
  const solo = taxes({ ...TX, employees: 1.2e6, staff: 0 }, cfg);
  near(solo.paidGph, 0, 1e-9);
  near(solo.ownerNet, 1404000, 1e-6);
});
