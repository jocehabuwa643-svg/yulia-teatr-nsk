/* tests/calc-extended.test.mjs — граничные значения, год расчёта, no_data-ветки, сценарии, целостность данных.
   Ожидаемые числа считаются вручную в комментариях (независимо от кода); при расхождении выясняем, где ошибка —
   в формуле или в данных, а не подгоняем ожидание. Запуск: node --test */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { buildCalcConfig, flatten } from '../js/calculators/config.js';
import { registry } from '../js/calculators/index.js';
import { runCalc, runDefaults, summaryOf } from '../js/calculators/run.js';
import { firstBadNumber, defaultsOf, getPath } from '../js/calculators/util.js';
import { calc as taxes, breakEvenRevenue, scenario } from '../js/calculators/taxes.js';
import { calc as basecamp, business } from '../js/calculators/basecamp.js';
import { calc as goal } from '../js/calculators/goal.js';
import { calc as payroll } from '../js/calculators/payroll.js';
import { calc as pricing } from '../js/calculators/pricing.js';
import { calc as travel } from '../js/calculators/travel.js';
import { calc as cashflow } from '../js/calculators/cashflow.js';
import { calc as grants } from '../js/calculators/grants.js';
import { yearParams, vatStatus, vatInPrice, ipContributions, crossingMonth, gphContributions } from '../js/calculators/tax-core.js';
import { methodLines, methodVars } from '../js/calculators/method.js';
import { loadScenarios, saveScenarios, addScenario, removeScenario, buildComparison, fmtValue, sanitizeName } from '../js/calculators/scenarios.js';
import { readOverrides, setOverride, clearOverrides } from '../js/calculators/overrides.js';
import { formatHeadline, thousands, HEADLINE_KINDS } from '../js/calculators/headline.js';
import { legalLine } from '../js/calculators/method.js';

const url = p => new URL(p, import.meta.url);
const J = n => JSON.parse(readFileSync(url(`../data/${n}.json`), 'utf-8'));
const rates = J('rates'), config = J('config'), market = J('market'), competitors = J('competitors');
const build = (o, cfgPatch) => {
  const conf = structuredClone(config);
  if (cfgPatch) cfgPatch(conf);
  return buildCalcConfig({ rates, config: conf, competitors }, o);
};
const cfg = build();
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b} (допуск ${eps})`);
const T = 20000000;

/* ================= НДС: порог по годам ================= */

test('данные: порог НДС 20 млн на 2026/2027/2028, границы диапазонов = 250/450 млн × дефлятор', () => {
  const v = rates.tax.vat_threshold.years;
  assert.deepEqual(['2026', '2027', '2028'].map(y => v[y].value), [T, T, T]);
  const d = rates.tax.usn_deflator.years, lo = rates.tax.vat_band_special_low_upto.years, hi = rates.tax.vat_band_special_high_upto.years;
  // 250 000 000 × 1,09 = 272 500 000; 450 000 000 × 1,09 = 490 500 000; 250 000 000 × 1,153 = 288 250 000; 450 000 000 × 1,153 = 518 850 000
  assert.equal(Math.round(lo['2026'].value), Math.round(250e6 * d['2026'].value));
  assert.equal(Math.round(hi['2026'].value), Math.round(450e6 * d['2026'].value));
  assert.equal(Math.round(lo['2027'].value), Math.round(250e6 * d['2027'].value));
  assert.equal(Math.round(hi['2027'].value), Math.round(450e6 * d['2027'].value));
  assert.equal(lo['2028'].value, null);        // дефлятор 2028 не опубликован — не выдумываем
  assert.equal(lo['2028'].status, 'no_data');
});

test('данные: максимум взносов ИП = фикс + потолок 1% (379 208 за 2026, 404 077 за 2027)', () => {
  const f = rates.tax.ip_fixed_contributions.years, c = rates.tax.ip_extra_contrib_cap.years;
  assert.equal(f['2026'].value + c['2026'].value, 57390 + 321818);
  assert.equal(57390 + 321818, 379208);
  assert.equal(f['2027'].value + c['2027'].value, 404077);
});

test('порог НДС: ровно порог — освобождён; порог ± 1 ₽ (год 2027)', () => {
  const run = revenue => taxes({ year: 2027, revenue, costShare: 55, social: 0, employees: 0 }, cfg);
  const at = run(T), below = run(T - 1), over = run(T + 1);
  assert.equal(at.overVat, false);
  assert.equal(at.vat, 0);
  assert.equal(below.overVat, false);
  assert.equal(over.overVat, true);
  // 20 000 001 × 5 / 105 = 100 000 005 / 105 = 952 381,000 (105 × 952 381 = 100 000 005)
  near(over.vat, 952381, 1e-6);
  // «после порога» при выручке ровно на пороге — гипотеза T + 1 ₽: НДС уже есть
  near(at.after.vat, 952381, 1e-6);
  assert.equal(at.before.vat, 0);
});

test('НДС по годам: диапазоны 5% / 7% / утрата УСН (2026 и 2027 различаются)', () => {
  const p26 = yearParams(cfg, 2026), p27 = yearParams(cfg, 2027);
  // 280 млн: 2026 — выше 272,5 млн → 7%; 2027 — ниже 288,25 млн → 5%
  assert.equal(vatStatus(280e6, p26).rate, 7);
  assert.equal(vatStatus(280e6, p27).rate, 5);
  near(vatInPrice(280e6, 7), 280e6 * 7 / 107, 1e-6);          // 18 317 757,01
  near(vatInPrice(280e6, 5), 280e6 * 5 / 105, 1e-6);          // 13 333 333,33
  // 500 млн: 2026 — выше 490,5 млн → утрата УСН; 2027 — ниже 518,85 млн → 7%
  assert.equal(vatStatus(500e6, p26).state, 'lost');
  assert.equal(vatStatus(500e6, p27).state, 'high');
  // граница диапазона включительно: ровно 272,5 млн — ещё 5%
  assert.equal(vatStatus(272.5e6, p26).state, 'low');
  assert.equal(vatStatus(272.5e6 + 1, p26).state, 'high');
  // утрата УСН в калькуляторе налогов: режимы УСН недоступны, патент остаётся
  const r = taxes({ year: 2026, revenue: 500e6, costShare: 55, social: 0, employees: 0 }, cfg);
  assert.equal(r.now.usnLost, true);
  assert.equal(r.regimes.find(g => g.id === 'usn6').tax, null);
});

test('год без границ диапазона (2028): ставка 5% с пометкой «границы неизвестны», не выдумываем', () => {
  const c28 = build({}, conf => { conf.calc.years = [2026, 2027, 2028]; });
  const p = yearParams(c28, 2028);
  assert.equal(p.vatThreshold, T);
  assert.equal(p.vatBandLow, null);
  const s = vatStatus(T + 1, p);
  assert.equal(s.state, 'low');
  assert.equal(s.bandUnknown, true);
  // фиксированные взносы 2028 в данных нет → «нет данных», 0 в расчёте, флаг поднят
  const ip = ipContributions(1e6, p, c28);
  assert.equal(ip.fixedNoData, true);
  assert.equal(ip.fixed, 0);
});

test('неизвестный год → год по умолчанию, а не undefined', () => {
  assert.equal(yearParams(cfg, 1999).year, cfg.year);
  assert.equal(yearParams(cfg, 'abc').year, cfg.year);
  assert.equal(yearParams(cfg, undefined).vatThreshold, T);
});

test('месяц пересечения порога и начало НДС (ст. 145 п. 5: со следующего месяца)', () => {
  // равномерная выручка 25 млн: 20 / (25/12) = 9,6 → порог пересечён в 10-м месяце, НДС — с 11-го
  assert.equal(crossingMonth(25e6, T, 12), 10);
  const r = taxes({ year: 2027, revenue: 25e6, costShare: 55, social: 0, employees: 0 }, cfg);
  assert.equal(r.crossing.month, 10);
  assert.equal(r.crossing.vatFromMonth, 11);
  // НДС в год превышения — только с операций 11–12 месяцев: 25 млн × 2/12 × 5/105
  near(r.crossing.vatFirstYear, 25e6 * 2 / 12 * 5 / 105, 1e-6);     // 198 412,70
  // выручка чуть выше порога: пересечение в 12-м месяце → НДС со следующего года
  const edge = taxes({ year: 2027, revenue: T + 1, costShare: 55, social: 0, employees: 0 }, cfg);
  assert.equal(edge.crossing.month, 12);
  assert.equal(edge.crossing.vatFromMonth, null);
  assert.equal(edge.crossing.vatFirstYear, 0);
  // ниже порога пересечения нет
  assert.equal(crossingMonth(T, T, 12), null);
  assert.equal(crossingMonth(0, T, 12), null);
});

test('точка перехода: остаток после НДС снова равен остатку на пороге — закрытая формула', () => {
  // УСН «Доходы», расходы 55%, без работников. На пороге остаток = 0,45·T − 0,06·T − 0,01·(T − 300 000) − фикс.
  //   = 0,38·T + 3 000 − фикс. После порога НДС 5/105 в цене; и налог 6%, и 1% взносов считаются от дохода УСН
  //   БЕЗ НДС (R·100/105): остаток(R) = R·k + 3 000 − фикс, k = 0,45 − (0,06 + 0,01)·100/105 − 5/105 = 0,3357143.
  //   Равенство: R* = 0,38·T / k = 7 600 000 / 0,3357143 = 22 638 297,9. Потолок 1%-взноса (≥ 321 818) не достигается.
  const k = 0.45 - (0.06 + 0.01) * 100 / 105 - 5 / 105;
  const expected = 0.38 * T / k;
  near(expected, 22638297.9, 1);
  for (const year of [2026, 2027]) {
    const r = taxes({ year, revenue: 3e6, costShare: 55, social: 0, employees: 0 }, cfg);
    near(r.crossing.breakEven, expected, 1);
  }
  // расходы 80%: k = 0,2 − 0,07·100/105 − 5/105 = 0,0857143; на пороге остаток без фикса = 0,2·T − 0,06·T − 0,01·T + 3 000,
  // после порога R·k + 3 000 — взнос 1% с (R − НДС) − 300 000, 3 000 сокращаются: R* = 0,13·T / k
  const k8 = 0.2 - (0.06 + 0.01) * 100 / 105 - 5 / 105;
  near(taxes({ year: 2027, revenue: 3e6, costShare: 80, social: 0, employees: 0 }, cfg).crossing.breakEven, 0.13 * T / k8, 1);
});

test('basecamp: темп ровно на пороге — без НДС; на 12 ₽ в год выше — НДС и штаб', () => {
  // синтетический год: порог 24 000 000 ⇒ месячная выручка 2 000 000 × 12 = 24 000 000 ровно
  const c = build({}, conf => { conf.calc.years = [2027]; });
  c.byYear[2027].vatThreshold = 24e6;
  const b = g => ({ gross: g, profit: 0 });
  const at = business(b(2e6), 0, 1, c, true, 2027);
  assert.equal(at.reg, false);
  assert.equal(at.vat, 0);
  assert.equal(at.hq, 0);
  assert.equal(at.profit, 0);
  // 2 000 001 × 12 = 24 000 012 > порога: НДС = 2 000 001 × 5/105 = 95 238,14; прибыль = −НДС + 6% НДС − штаб 150 000
  const over = business(b(2000001), 0, 1, c, true, 2027);
  assert.equal(over.reg, true);
  near(over.vat, 95238.1429, 1e-3);
  near(over.profit, -95238.1429 * 0.94 - 150000, 1e-3);           // −239 523,857
  near(over.profitNoVat, 0, 1e-9);
  near(over.vatCost, 239523.857, 1e-2);
});

test('basecamp: «до» и «после» порога — profitNoVat − profit = НДС·(1−УСН) + штаб', () => {
  const r = basecamp({ year: 2027, area: 150, rent: 2000, students: 80, sub: 7000, week: 20, attendance: 40, party: 16, eventprice: 16000, trips: 200, teams: 4 }, cfg);
  assert.equal(r.x.reg, true);
  near(r.x.profitNoVat - r.x.profit, r.x.vat * 0.94 + 150000, 1e-6);
  assert.equal(r.x.profitOver, r.x.profit);                       // порог превышен — «после» = фактическая прибыль
  // порог не превышен: «после» — гипотеза, меньше прибыли без НДС
  const low = basecamp({ year: 2027, area: 130, rent: 1000, students: 40, sub: 4300, week: 12, attendance: 30, party: 8, eventprice: 10000, trips: 16, teams: 1 }, cfg);
  assert.equal(low.x.reg, false);
  assert.ok(low.x.profitOver < low.x.profit);
});

/* ================= Взносы ИП и 1% ================= */

test('1% сверх порога: ровно 300 000 → 0; 300 001 → 0,01; потолок года', () => {
  const p26 = yearParams(cfg, 2026), p27 = yearParams(cfg, 2027);
  assert.equal(ipContributions(300000, p27, cfg).extra, 0);
  near(ipContributions(300001, p27, cfg).extra, 0.01, 1e-9);
  assert.equal(ipContributions(299999, p27, cfg).extra, 0);
  assert.equal(ipContributions(0, p27, cfg).total, 61154);        // фикс 2027
  // 40 млн: 1% × 39 700 000 = 397 000 > потолка 321 818 (2026) → ограничено; итого 57 390 + 321 818 = 379 208
  const big = ipContributions(40e6, p26, cfg);
  assert.equal(big.capApplied, true);
  assert.equal(big.extra, 321818);
  assert.equal(big.total, 379208);
  // 2027: потолок 342 923 → 61 154 + 342 923 = 404 077
  assert.equal(ipContributions(40e6, p27, cfg).total, 404077);
  // отрицательная и нечисловая выручка не дают NaN
  assert.equal(ipContributions(-5, p27, cfg).extra, 0);
  assert.equal(ipContributions(NaN, p27, cfg).total, 61154);
});

test('вычет взносов из УСН «Доходы»: 3,6 млн, 2027 — до 100% без работников, до 50% с работниками', () => {
  // налог 6% × 3 600 000 = 216 000; взносы ИП = 61 154 + 1% × 3 300 000 = 61 154 + 33 000 = 94 154
  const noStaff = taxes({ year: 2027, revenue: 3.6e6, costShare: 55, social: 0, employees: 0 }, cfg).regimes.find(g => g.id === 'usn6');
  near(noStaff.tax, 216000, 1e-6);
  near(noStaff.taxAfterContrib, 216000 - 94154, 1e-6);            // 121 846
  // с гонорарами 1,2 млн: взносы с гонораров 1 200 000 × 0,302 = 362 400; пул 456 554; лимит 50% × 216 000 = 108 000
  const staff = taxes({ year: 2027, revenue: 3.6e6, costShare: 55, social: 0, employees: 1.2e6 }, cfg).regimes.find(g => g.id === 'usn6');
  near(staff.deduction, 108000, 1e-6);
  near(staff.taxAfterContrib, 108000, 1e-6);
});

test('УСН «Д−Р»: минимальный налог 1% от дохода', () => {
  // расходы 100% → база 0; налог 15% = 0, минимальный 1% × 1 000 000 = 10 000
  const r = taxes({ year: 2027, revenue: 1e6, costShare: 100, social: 0, employees: 0 }, cfg).regimes.find(g => g.id === 'usn15');
  assert.equal(r.tax, 10000);
  // расходы 55%: 15% × 450 000 = 67 500
  near(taxes({ year: 2027, revenue: 1e6, costShare: 55, social: 0, employees: 0 }, cfg).regimes.find(g => g.id === 'usn15').tax, 67500, 1e-6);
});

/* ================= no_data и ручной ввод ================= */

test('no_data: патент и ставка соцпредприятия 2027 — «нет данных», ручной ввод включает расчёт', () => {
  const base = taxes({ year: 2027, revenue: 3.6e6, costShare: 55, social: 1, employees: 0 }, cfg);
  const pat = base.regimes.find(g => g.id === 'patent'), soc = base.regimes.find(g => g.id === 'usnSocial');
  assert.equal(pat.noData, true); assert.equal(pat.tax, null);
  assert.equal(soc.noData, true); assert.equal(soc.tax, null);
  assert.equal(soc.needStatus, false);
  assert.equal(base.best.id, 'usn6');                             // лучший — только из режимов с данными
  // ручной ввод: потенциальный доход 1 275 700 × 6% = 76 542; ставка соцпредприятия 2027 = 1% → 36 000 с 3,6 млн
  const man = build({ rates: { patent_potential_nsk: 1275700, 'usn_nso_social_income.2027': 1 }, cfg: {} });
  const r = taxes({ year: 2027, revenue: 3.6e6, costShare: 55, social: 1, employees: 0 }, man);
  near(r.regimes.find(g => g.id === 'patent').tax, 76542, 1e-6);
  near(r.regimes.find(g => g.id === 'usnSocial').tax, 36000, 1e-6);
  assert.equal(r.best.id, 'usnSocial');                           // 36 000 < 76 542 < 216 000
  // провенанс ручного значения помечен
  assert.equal(man.rateMeta['patent_potential_nsk'].confidence, 'manual');
});

test('соцпредприятие 2026: ставка 1% есть в данных; без статуса — «нет данных»/needStatus', () => {
  const r = taxes({ year: 2026, revenue: 2e6, costShare: 50, social: 1, employees: 0 }, cfg).regimes.find(g => g.id === 'usnSocial');
  near(r.tax, 20000, 1e-6);                                       // 1% × 2 000 000
  const no = taxes({ year: 2026, revenue: 2e6, costShare: 50, social: 0, employees: 0 }, cfg).regimes.find(g => g.id === 'usnSocial');
  assert.equal(no.needStatus, true); assert.equal(no.tax, null);
});

test('no_data для фиксированных взносов ИП: расчёт продолжается без них, флаг поднят', () => {
  const c = build({}, null);
  c.byYear[2027].ipFixed = null;                                  // как если бы значения в rates.json не было
  const r = taxes({ year: 2027, revenue: 3.6e6, costShare: 55, social: 0, employees: 0 }, c);
  assert.equal(r.ipFixedNoData, true);
  assert.equal(r.ip.total, 33000);                                // только 1% сверх порога
});

test('overrides: сохранение, снятие, перенос старого ключа, мусор отбрасывается', () => {
  const mem = {};
  const st = { get: (k, d) => (k in mem ? mem[k] : d), set: (k, v) => { mem[k] = v; return true; } };
  setOverride(st, 'rates', 'patent_potential_nsk', '1 275 700,5');
  assert.equal(readOverrides(st).rates.patent_potential_nsk, 1275700.5);
  setOverride(st, 'rates', 'patent_potential_nsk', '');
  assert.deepEqual(readOverrides(st).rates, {});
  setOverride(st, 'cfg', 'base_costs.rent_per_m2', 1100);
  setOverride(st, 'cfg', 'base_costs.admin_month', -5);          // отрицательное — не принимается
  assert.deepEqual(readOverrides(st).cfg, { 'base_costs.rent_per_m2': 1100 });
  clearOverrides(st, 'cfg');
  assert.deepEqual(readOverrides(st).cfg, {});
  mem['ovr.patent'] = 90000;                                      // прежний ключ → rates
  assert.equal(readOverrides(st).rates.patent_potential_nsk, 90000);
  mem['ovr.rates'] = { a: 'x', b: NaN, c: 5 };
  assert.deepEqual(readOverrides(st).rates, { c: 5, patent_potential_nsk: 90000 });
});

test('допущение проекта через override меняет расчёт (аренда 1100 вместо 1000 → фикс +13 000)', () => {
  const c = build({ cfg: { 'base_costs.rent_per_m2': 1100 } });
  assert.equal(c.base_costs.rent_per_m2, 1100);
  // фикс базы: 130 м² × (1100 + 200) + 35 000 + 20 000 = 169 000 + 55 000 = 224 000 (при 1000 — 211 000)
  const r = basecamp({ year: 2027, area: 130, rent: 1100, students: 0, sub: 0, week: 0, attendance: 0, party: 0, eventprice: 0, trips: 0, teams: 1 }, c);
  assert.equal(r.b.fixed, 224000);
  assert.ok(c.assumptions.find(a => a.path === 'base_costs.rent_per_m2').overridden);
});

/* ================= Нули, пустые поля, NaN ================= */

const BAD_VALUES = [0, NaN, '', undefined, null, -5, 'abc', Infinity];
test('все калькуляторы: пустые, нулевые, нечисловые, отрицательные значения не дают NaN/Infinity', () => {
  const ctx = { market, now: Date.UTC(2026, 10, 19) };
  for (const mod of registry) {
    const fields = mod.controls(cfg);
    const def = defaultsOf(fields);
    for (const f of fields) {
      const vals = [...BAD_VALUES, f.min, f.max].filter(v => v !== undefined || true);
      for (const v of vals) {
        const inputs = { ...def, [f.id]: v };
        let res;
        assert.doesNotThrow(() => { res = runCalc(mod, inputs, cfg, ctx); }, `${mod.meta.id}.${f.id}=${String(v)}`);
        const bad = firstBadNumber(res);
        assert.equal(bad, null, `${mod.meta.id}.${f.id}=${String(v)} → нечисло в ${bad}`);
        assert.doesNotThrow(() => summaryOf(mod, res));
      }
    }
    // все поля сразу пустые
    const empty = Object.fromEntries(fields.map(f => [f.id, '']));
    assert.equal(firstBadNumber(runCalc(mod, empty, cfg, ctx)), null, `${mod.meta.id}: все поля пусты`);
  }
});

test('нулевая выручка: налоги 0, НДС 0, точка перехода конечна', () => {
  const r = taxes({ year: 2027, revenue: 0, costShare: 55, social: 0, employees: 0 }, cfg);
  assert.equal(r.vat, 0);
  assert.equal(r.regimes.find(g => g.id === 'usn6').tax, 0);
  assert.equal(r.ip.extra, 0);
  assert.equal(firstBadNumber(r), null);
});

test('ноль зрителей: выезд без NaN, безубыточность ≥ 1; цена из маржи недостижима (null)', () => {
  const t = travel({ n: 0, p: 300, k: 1, r: 0, dk: 0, own: 0 }, cfg);
  assert.equal(t.gross, 0);
  assert.equal(t.margin, 0);
  assert.ok(t.be >= 1);
  const p = pricing({ margin: 35, audience: 0, venue: 0, route: 0 }, cfg);
  assert.equal(p.priceFromMargin, null);
  assert.equal(p.priceBreakEven, null);
  assert.equal(firstBadNumber(p), null);
});

test('нулевая выручка базы: окупаемость «не достигается» (null), а не Infinity', () => {
  const r = basecamp({ year: 2027, area: 130, rent: 1000, students: 0, sub: 0, week: 0, attendance: 0, party: 0, eventprice: 0, trips: 0, teams: 1 }, cfg);
  assert.equal(r.payback, null);
  assert.ok(r.x.profit < 0);
});

/* ================= Цена из маржи (формула выводится из определения маржи) ================= */

test('pricing: цена из маржи 35%, 45 зрителей, сад, Новосибирск — 380 ₽; цена нуля — 230 ₽', () => {
  // прямые: гонорар 5 000 + взносы 5 000 × 0,302 = 1 510 + ГСМ 1 000 + износ 400 = 7 910; на зрителя 7 910 / 45 = 175,78; + печать 10 = 185,78
  // доля площадки 10% + УСН 6% = 0,16. Маржа 35%: P = 185,78 / (1 − 0,16 − 0,35) = 185,78 / 0,49 = 379,15 → вверх до 10 ₽ = 380
  // Цена безубыточности: 185,78 / 0,84 = 221,16 → 230
  const r = pricing({ margin: 35, audience: 45, venue: 0, route: 0 }, cfg);
  near(r.direct, 7910, 1e-6);
  assert.equal(r.priceFromMargin, 380);
  assert.equal(r.priceBreakEven, 230);
  // проверка по независимому калькулятору выезда: при 380 ₽ маржа ≥ 35%, при 370 ₽ — ниже
  assert.ok(travel({ n: 45, p: 380, k: 1, r: 0, dk: 0, own: 0 }, cfg).margin >= 35);
  assert.ok(travel({ n: 45, p: 370, k: 1, r: 0, dk: 0, own: 0 }, cfg).margin < 35);
  near(r.profitAtPrice, 6004, 1e-6);                              // 17 100 − 1 710 − 1 026 − 450 − 7 910 = 6 004
});

test('pricing: цена из маржи монотонна по марже и даёт маржу не ниже желаемой при любой площадке', () => {
  for (const venue of [0, 1]) for (const margin of [10, 25, 40, 50]) {
    const r = pricing({ margin, audience: 60, venue, route: 1 }, cfg);
    if (r.priceFromMargin == null) continue;
    assert.ok(r.actualMargin >= margin - 1e-9, `venue=${venue} margin=${margin}: ${r.actualMargin}`);
  }
  const a = pricing({ margin: 20, audience: 45, venue: 0, route: 0 }, cfg).priceFromMargin;
  const b = pricing({ margin: 40, audience: 45, venue: 0, route: 0 }, cfg).priceFromMargin;
  assert.ok(b > a);
  // нереальная маржа (доля площадки + УСН + маржа ≥ 100%) → null
  assert.equal(pricing({ margin: 70, audience: 45, venue: 1, route: 0 }, cfg).priceFromMargin, null); // 1 − 0,30 − 0,06 − 0,70 < 0,05
});

/* ================= ФОТ ================= */

test('payroll: сверх предельной базы — сниженный тариф; лимит НПД 2,4 млн — строго «больше»', () => {
  const p26 = yearParams(cfg, 2026);
  // один исполнитель 4 000 000 за год: 2 979 000 × 0,302 + (4 000 000 − 2 979 000) × (0,151 + 0,002) = 899 658 + 156 213 = 1 055 871
  near(gphContributions(4e6, cfg, p26, 1), 1055871, 1e-6);
  // в пределах базы — модельная ставка: 1 000 000 × 0,302
  near(gphContributions(1e6, cfg, p26, 1), 302000, 1e-6);
  // база 2027 неизвестна → модельная ставка без сниженного тарифа
  near(gphContributions(4e6, cfg, yearParams(cfg, 2027), 1), 4e6 * 0.302, 1e-6);
  // НПД: 200 000 × 12 = 2 400 000 — ровно лимит, не превышен; 200 001 × 12 — превышен
  assert.equal(payroll({ year: 2027, fee: 200000, people: 1, regular: 0 }, cfg).npdOver, false);
  assert.equal(payroll({ year: 2027, fee: 200001, people: 1, regular: 0 }, cfg).npdOver, true);
  // 45 000 × 3: взносы 135 000 × 0,302 = 40 770 (в пределах базы 540 000 < 2 979 000 за человека)
  near(payroll({ year: 2026, fee: 45000, people: 3, regular: 1 }, cfg).gph.cost, 175770, 1e-6);
});

/* ================= Цель ================= */

test('goal: цель 0 — достижима без выездов; недостижимая цель — лучший вариант без «plan»', () => {
  const zero = goal({ year: 2027, goal: 0, stageSel: 2 }, cfg);
  assert.equal(zero.plan, true);
  assert.equal(zero.x.n, 0);
  const huge = goal({ year: 2027, goal: 1e9, stageSel: 2 }, cfg);
  assert.equal(huge.plan, false);
  assert.equal(huge.x.profit, Math.max(...huge.curve.map(c => c.profit)));   // лучший вариант = максимум кривой
  // без базы (стадия 0): предел показов — мощность одной труппы
  assert.equal(goal({ year: 2027, goal: 1e9, stageSel: 0 }, cfg).max, 55);
  // кривая монотонна по показам внутри мощности одной труппы (до порога НДС): вклад показа > 0
  const c = goal({ year: 2027, goal: 1e9, stageSel: 0 }, cfg).curve;
  for (let i = 1; i < c.length; i++) assert.ok(c[i].profit > c[i - 1].profit);
  // цель достигнута перебором: минимальное n — на единицу меньше не хватает
  const g = goal({ year: 2027, goal: 125000, stageSel: 0 }, cfg);
  // без базы: −60 000 + n × 7 550 ≥ 125 000 ⇒ n ≥ 24,5 ⇒ 25
  assert.equal(g.x.n, 25);
  near(g.x.profit, -60000 + 25 * 7550, 1e-6);                     // 128 750
  assert.ok(g.curve[24].profit < 125000);
});

test('goal: год меняет порог НДС в результате', () => {
  assert.equal(goal({ year: 2026, goal: 1e5, stageSel: 1 }, cfg).x.year, 2026);
  assert.equal(goal({ year: 2027, goal: 1e5, stageSel: 1 }, cfg).x.year, 2027);
});

/* ================= Денежный поток с дельтами ================= */

test('cashflow: правка выездов +2 показа и базы +10 000 — ручной расчёт трёх месяцев', () => {
  // вклад показа до порога мощности 7 550 ₽ (tour_unit.unit_small); старт 1 185 000
  // Дек: выезды 229 600 + 2×7 550 = 244 700; база 0 (правка только там, где база работает); фикс 60 000 → прибыль 184 700; вложения 600 000
  //      остаток 1 185 000 + 184 700 − 600 000 = 769 700
  // Янв: 90 600 + 15 100 = 105 700; прибыль 45 700; остаток 815 400
  // Фев: выезды 135 900 + 15 100 = 151 000; база 95 000 + 10 000 = 105 000; фикс 211 000 → прибыль 45 000; вложения 585 000
  //      остаток 815 400 + 45 000 − 585 000 = 275 400
  const r = cashflow({ startCapital: 1185000, tourDelta: 2, baseDelta: 10000 }, cfg);
  assert.deepEqual(r.rows.slice(0, 3).map(x => x.op), [184700, 45700, 45000]);
  assert.deepEqual(r.rows.slice(0, 3).map(x => x.net), [769700, 815400, 275400]);
  assert.equal(r.rows[0].shows, 30);
  assert.equal(r.rows[0].base, 0);
  assert.equal(r.rows[2].base, 105000);
});

test('cashflow: большая отрицательная правка не уводит показы и вклад ниже нуля', () => {
  // −20 показов: Янв 12 − 20 → 0 показов, вклад max(0, 90 600 − 20×7 550 = −60 400) = 0
  const r = cashflow({ startCapital: 0, tourDelta: -20, baseDelta: -1e9 }, cfg);
  assert.equal(r.rows[1].shows, 0);
  assert.equal(r.rows[1].tour, 0);
  assert.ok(r.rows.every(x => x.base >= 0 && x.tour >= 0 && x.shows >= 0));
  assert.equal(firstBadNumber(r), null);
  // нулевое финансирование: дно без финансирования = дно с финансированием (разница 0)
  assert.equal(r.minNoFinancing, r.min.net);
  assert.ok(r.gaps.length > 0);
});

/* ================= Гранты: «сегодня» инжектируется ================= */

test('grants: фиксированное «сегодня» — окно ПФКИ открыто до 07.12.2026 включительно', () => {
  const run = (now, launch = 0) => grants({ launch }, cfg, market, now);
  // 19.11.2026: дедлайн 07.12.2026 впереди → открыт
  const a = run(Date.UTC(2026, 10, 19));
  assert.equal(a.today, '2026-11-19');
  assert.equal(a.openNow, 1);
  assert.equal(a.programs[0].canApply, true);
  assert.equal(a.programs[0].verdict, 'Подача открыта — подавайте сейчас');
  // ровно 07.12.2026 00:00 UTC — дедлайн ≥ сегодня → ещё открыт; на секунду позже — закрыт
  assert.equal(run(Date.UTC(2026, 11, 7)).openNow, 1);
  assert.equal(run(Date.UTC(2026, 11, 7, 0, 0, 1)).openNow, 0);
  assert.equal(run(Date.UTC(2026, 11, 8)).programs[0].verdict, 'Окно закрыто');
  // итоги 30.04.2027: запуск 01.03.2027 — деньги позже запуска; 01.09.2027 — раньше
  assert.equal(run(Date.UTC(2026, 10, 19), 1).usable.length, 0);
  assert.equal(run(Date.UTC(2026, 10, 19), 3).usable.length, 1);
  // без now берётся дата среза данных cfg.as_of (воспроизводимо, без Date.now)
  assert.equal(grants({ launch: 0 }, cfg, market).today, cfg.as_of);
  // индекс запуска вне диапазона и NaN зажимаются
  assert.equal(grants({ launch: 99 }, cfg, market, 0).launchLabel, cfg.calc.launch_options[cfg.calc.launch_options.length - 1].label);
  assert.equal(grants({ launch: NaN }, cfg, market, 0).launchLabel, cfg.calc.launch_options[0].label);
});

/* ================= Сценарии и сравнение ================= */

test('сценарии: добавление, замена по имени, лимит, удаление, битые записи', () => {
  const mem = {};
  const st = { get: (k, d) => (k in mem ? mem[k] : d), set: (k, v) => { mem[k] = v; return true; } };
  let list = loadScenarios(st, 'taxes');
  assert.deepEqual(list, []);
  list = addScenario(list, { name: '  Рост   25 млн ', inputs: { revenue: 25e6 }, at: '2026-11-19T00:00:00Z', uid: 'a' }, 3, 40);
  assert.equal(list[0].name, 'Рост 25 млн');
  list = addScenario(list, { name: 'рост 25 МЛН', inputs: { revenue: 30e6 }, at: 't2', uid: 'b' }, 3, 40);   // то же имя — замена, id прежний
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'a');
  assert.equal(list[0].inputs.revenue, 30e6);
  list = addScenario(list, { name: '', inputs: {}, at: 't', uid: 'c' }, 3, 40);
  assert.equal(list[1].name, 'Сценарий 2');                          // пустое имя → запасное
  list = addScenario(list, { name: 'D', inputs: {}, at: 't', uid: 'd' }, 3, 40);
  list = addScenario(list, { name: 'E', inputs: {}, at: 't', uid: 'e' }, 3, 40);
  assert.deepEqual(list.map(s => s.id), ['c', 'd', 'e']);            // самый старый вытеснен
  assert.equal(sanitizeName('x'.repeat(80), 'f', 40).length, 40);
  saveScenarios(st, 'taxes', list);
  assert.equal(loadScenarios(st, 'taxes').length, 3);
  assert.deepEqual(removeScenario(list, 'd').map(s => s.id), ['c', 'e']);
  mem['scen.taxes'] = [{ id: 1 }, null, 'x', { id: 'ok', name: 'n', inputs: {} }];
  assert.deepEqual(loadScenarios(st, 'taxes').map(s => s.id), ['ok']);
  mem['scen.taxes'] = 'мусор';
  assert.deepEqual(loadScenarios(st, 'taxes'), []);
});

test('сравнение: текущий + несколько сохранённых рядом, разницы к текущему посчитаны', () => {
  const mod = registry.find(m => m.meta.id === 'taxes');
  const cur = { year: 2027, revenue: 3.6e6, costShare: 55, employees: 1.2e6, social: 0 };
  const scen = [
    { id: 'a', name: 'Рост', at: 't', inputs: { ...cur, revenue: 25e6 } },
    { id: 'b', name: 'Меньше', at: 't', inputs: { ...cur, revenue: 1e6 } }
  ];
  const cmp = buildComparison({ mod, cfg, ctx: { market, now: 0 }, scenarios: scen, currentInputs: cur });
  assert.deepEqual(cmp.cols.map(c => c.name), ['Текущий', 'Рост', 'Меньше']);
  const tax = cmp.rows.find(r => r.label.startsWith('Налог года'));
  // УСН 6%: 3,6 млн → 216 000; 25 млн с НДС → 25 000 000 × 100/105 × 6% = 1 428 571,43; 1 млн → 60 000
  assert.equal(tax.cells[0].text, fmtValue(216000, 'rub'));
  assert.equal(tax.cells[1].text, fmtValue(1428571.43, 'rub'));
  assert.equal(tax.cells[2].text, fmtValue(60000, 'rub'));
  assert.equal(tax.cells[0].delta, '');
  assert.equal(tax.cells[1].delta, '+' + fmtValue(1428571.43 - 216000, 'rub'));
  assert.ok(tax.cells[2].delta.startsWith('−'));
  const rev = cmp.inputRows.find(r => r.label.startsWith('Выручка'));
  assert.equal(rev.differs, true);
  assert.equal(cmp.inputRows.find(r => r.label.startsWith('Доля расходов')).differs, false);
  // форматы: нет значения → «нет данных»
  assert.equal(fmtValue(null, 'rub'), 'нет данных');
  assert.equal(fmtValue(NaN, 'int', 'не достигается'), 'не достигается');
  assert.equal(fmtValue(-1200, 'rub'), '−1 200 ₽');
});

test('сравнение работает для всех девяти калькуляторов (итоги — по текущим данным)', () => {
  const ctx = { market, now: Date.UTC(2026, 10, 19) };
  for (const mod of registry) {
    const { inputs } = runDefaults(mod, cfg, ctx);
    const cmp = buildComparison({ mod, cfg, ctx, scenarios: [{ id: 's', name: 'копия', at: 't', inputs }], currentInputs: inputs });
    assert.ok(cmp.rows.length >= 3, mod.meta.id);
    cmp.rows.forEach(r => r.cells.forEach(c => assert.ok(!/NaN|undefined|Infinity/.test(c.text), `${mod.meta.id}: ${c.text}`)));
    assert.ok(cmp.inputRows.every(r => !r.differs), `${mod.meta.id}: одинаковые входы не должны различаться`);
  }
});

/* ================= Тексты допущений и целостность данных ================= */

test('METHOD-тексты строятся из данных: ни «нет данных», ни NaN, ни остатков шаблона', () => {
  for (const mod of registry) {
    for (const year of cfg.years) {
      const lines = methodLines(mod.meta.id, cfg, year);
      assert.ok(lines.length >= 3, `${mod.meta.id}: пустые допущения`);
      lines.forEach(l => assert.ok(!/NaN|undefined|[{}]/.test(l), `${mod.meta.id}/${year}: ${l}`));
      // каждый плейсхолдер шаблона разрешается в значение (иначе в тексте появилось бы «нет данных»)
      const vars = methodVars(cfg, year);
      // параметры года (y.*) без проверенных данных (2028) честно дают «нет данных»; остальные плейсхолдеры обязаны разрешаться
      cfg.calc.$method[mod.meta.id].forEach(tpl => [...tpl.matchAll(/[{]([\w.$]+)(?:\|\w+)?[}]/g)].forEach(m => {
        const v = getPath(vars, m[1]);
        if (m[1].startsWith('y.') && v == null) assert.ok(methodLines(mod.meta.id, cfg, year).some(l => l.includes('нет данных')), `${mod.meta.id}/${year}: ${m[1]} без «нет данных»`);
        else assert.notEqual(v, null, `${mod.meta.id}: пусто ${m[1]}`);
      }));
    }
  }
  // значения совпадают с данными: порог года и гонорар кластера
  assert.ok(methodLines('basecamp', cfg, 2027).some(l => l.includes('20 млн')));
  assert.ok(methodLines('travel', cfg, 2027).some(l => l.includes('4 300')));
  // изменили допущение — текст изменился вместе с ним
  const c2 = build({ cfg: { 'travel_costs.salary_city_cluster': 4700 } });
  assert.ok(methodLines('travel', c2, 2027).some(l => l.includes('4 700')));
  // шаблон с неизвестным путём даёт «нет данных», а не «undefined»
  const c3 = structuredClone(cfg); c3.calc.$method.travel = ['x {no.such.path|rub} y'];
  assert.equal(methodLines('travel', c3, 2027)[0], 'x нет данных y');
});

const leaves = (root, prefix) => {
  const out = [];
  const walk = (n, p) => {
    if (n && typeof n === 'object' && !Array.isArray(n)) {
      if ('value' in n && ('confidence' in n || 'source_name' in n || 'unit' in n)) { out.push([p, n]); return; }
      for (const [k, v] of Object.entries(n)) if (!k.startsWith('$')) walk(v, p ? `${p}.${k}` : k);
    }
  };
  walk(root, prefix);
  return out;
};

test('целостность rates.json: у каждого значения источник, дата, надёжность; null только с no_data', () => {
  const all = leaves(rates.tax, 'tax');
  assert.ok(all.length >= 40);
  for (const [p, l] of all) {
    for (const k of ['source_name', 'unit', 'confidence', 'valid_from', 'legal_note', 'label']) assert.ok(k in l, `${p}: нет поля ${k}`);
    assert.ok(typeof l.source_name === 'string' && l.source_name.length > 3, `${p}: пустой источник`);
    assert.ok(['high', 'medium', 'low', 'model', 'no_data'].includes(l.confidence), `${p}: confidence ${l.confidence}`);
    if (l.value == null) {
      assert.equal(l.status, 'no_data', `${p}: null без status:no_data`);
      assert.equal(l.confidence, 'no_data', `${p}: no_data без confidence:no_data`);
    } else {
      assert.ok(l.fetched_at && /^\d{4}-\d{2}-\d{2}$/.test(l.fetched_at), `${p}: нет fetched_at`);
      assert.notEqual(l.status, 'no_data', `${p}: значение есть, но status:no_data`);
    }
    assert.match(l.legal_note, /Требует консультации со специалистом/, `${p}: нет юр-пометки`);
    assert.match(l.legal_note, /^(Проверено|Не проверено): \d{4}-\d{2}-\d{2} · /, `${p}: формат юр-пометки`);
  }
});

test('целостность config.json: допущения проекта — confidence:model с источником и датой; null нет', () => {
  const all = leaves(config, 'config');
  assert.ok(all.length >= 60);
  for (const [p, l] of all) {
    if (p.startsWith('config.calendar.')) continue;               // календарь (12 месяцев) — не допущение, а определение
    assert.equal(l.confidence, 'model', `${p}: допущение проекта должно быть model`);
    assert.ok(l.source_name && l.fetched_at && l.unit !== undefined, `${p}: нет источника/даты/единицы`);
    assert.notEqual(l.value, null, `${p}: null без no_data`);
    assert.match(l.legal_note, /требует подтверждения/);
  }
});

test('данные: ключевые константы проекта помечены как предположения и совпадают с задачей', () => {
  const c = cfg;
  assert.equal(c.base_costs.rent_per_m2, 1000);
  assert.equal(c.ticket.min, 300); assert.equal(c.ticket.max, 350);
  assert.equal(c.venue_share.school_garden, 10); assert.equal(c.venue_share.dk, 30);
  assert.equal(c.meta['base_costs.rent_per_m2'].confidence, 'model');
  assert.equal(c.rateMeta['gph_contributions_rate'].confidence, 'model');   // 30,2% — модельная, не ставка закона
  assert.equal(c.usn, 6);
  assert.equal(c.gphRate, 0.302);
});

test('в js/calculators нет бизнес-констант: допустимы только 0, 1, 2, 3, 100, 1e3 и 1e6 (единицы измерения)', () => {
  const dir = url('../js/calculators/');
  const ALLOWED = new Set(['0', '1', '2', '3', '100', '1e3', '1e6']);
  for (const f of readdirSync(dir).filter(n => n.endsWith('.js'))) {
    let s = readFileSync(new URL(f, dir), 'utf-8');
    s = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    s = s.replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/`(?:[^`\\]|\\.)*`/g, m => m.replace(/[^${}()+*\-/.,\w\s|?:<>=!&[\]]/g, ' '));
    s = s.replace(/\{\d+(,\d*)?\}/g, '');                                   // квантификаторы регулярных выражений
    const found = [...s.matchAll(/(?<![\w.$#])(\d+(?:\.\d+)?(?:e\d+)?)(?![\w])/g)].map(m => m[1]).filter(x => !ALLOWED.has(x));
    // тексты внутри шаблонных строк могут содержать цифры только как часть слов — их отфильтровал шаблон выше
    assert.deepEqual([...new Set(found)], [], `${f}: числовые литералы ${found.join(', ')}`);
  }
});

test('flatten: листья превращаются в значения, провенанс собирается отдельно', () => {
  const meta = {};
  const out = flatten({ a: { b: { value: 5, confidence: 'model', source_name: 's' } }, $raw: { value: 1 } }, meta);
  assert.equal(out.a.b, 5);
  assert.equal(meta['a.b'].confidence, 'model');
  assert.deepEqual(out.$raw, { value: 1 });
});


/* ================= Взносы 1% от дохода УСН без НДС ================= */

test('1% взносов ИП считается от дохода УСН без НДС: 20 000 001 ₽ (2026) — НДС 5/105 исключается из базы', () => {
  // выручка 20 000 001 ₽ > порога 20 млн: НДС в цене = 20 000 001 × 5/105 = 952 381,05; доход УСН = 19 047 619,95;
  // база 1% = 19 047 619,95 − 300 000 = 18 747 619,95 → допвзнос 187 476,20 (а не 197 000,01 от полной кассы)
  const vat = 20000001 * 5 / 105;
  const incomeUsn = 20000001 - vat;
  const r = taxes({ year: 2026, revenue: 20000001, costShare: 55, social: 0, employees: 0 }, cfg);
  near(r.vat, vat, 1e-6);
  near(r.ip.over, incomeUsn - 300000, 1e-6);
  near(r.ip.extra, (incomeUsn - 300000) * 0.01, 1e-6);
  near(r.ip.extra, 187476.2, 0.01);
  assert.ok(r.ip.extra < 197000.01, 'не от полной выручки с НДС');
  assert.equal(r.ip.capApplied, false);
  // ровно на пороге НДС нет — база совпадает с выручкой: (20 000 000 − 300 000) × 1% = 197 000
  const at = taxes({ year: 2026, revenue: T, costShare: 55, social: 0, employees: 0 }, cfg);
  assert.equal(at.vat, 0);
  near(at.ip.extra, 197000, 1e-6);
  // остаток владельца согласован с взносами: выручка − расходы − налог УСН − НДС − взносы ИП
  const x = r.now;
  near(x.netUsn6, 20000001 - x.costs - incomeUsn * 0.06 - vat - r.ip.total, 1e-6);
});

test('ставки 1% и ПСН читаются из rates.json: смена значения в данных меняет расчёт, в коде их нет', () => {
  const hi = build({ rates: { contributions_1pct_rate: 2 }, cfg: {} });
  near(taxes({ year: 2027, revenue: 3.6e6, costShare: 55, social: 0, employees: 0 }, hi).ip.extra, 66000, 1e-6);   // 2% × 3 300 000
  const pat = build({ rates: { patent_potential_nsk: 1000000, patent_tax_rate: 4 }, cfg: {} });
  near(taxes({ year: 2027, revenue: 3.6e6, costShare: 55, social: 0, employees: 0 }, pat).regimes.find(g => g.id === 'patent').tax, 40000, 1e-6);
  // ставка ПСН без источника не выдаётся за надёжную: низкая надёжность видна в метаданных
  assert.equal(cfg.rateMeta.patent_tax_rate.confidence, 'low');
  assert.match(cfg.rateMeta.contributions_1pct_threshold.note, /без НДС/);
});

/* ================= Главная цифра: тип величины ================= */

test('главная цифра: «+» только у итога со знаком; цена и налог без плюса; штуки без ₽', () => {
  assert.equal(formatHeadline('result', 3925), '+3 925 ₽');
  assert.equal(formatHeadline('result', -964900), '−964 900 ₽');
  assert.equal(formatHeadline('result', -0.4), '0 ₽');                       // отрицательный ноль не выводится
  assert.equal(formatHeadline('amount', 380), '380 ₽');
  assert.equal(formatHeadline('amount', 0), '0 ₽');
  assert.equal(formatHeadline('count', 2), '2');
  assert.equal(formatHeadline('amount', null, 'недостижима'), 'недостижима');
  assert.equal(formatHeadline('count', NaN), 'нет данных');
  for (const mod of registry) assert.ok(HEADLINE_KINDS.includes(mod.meta.headline), `${mod.meta.id}: нет meta.headline`);
  // цена билета, налог, стоимость команды — amount; гранты — count; прибыль/остаток — result
  const kind = Object.fromEntries(registry.map(m => [m.meta.id, m.meta.headline]));
  assert.deepEqual(kind, { travel: 'result', basecamp: 'result', goal: 'result', taxes: 'amount', payroll: 'amount', pricing: 'amount', parties: 'result', cashflow: 'result', grants: 'count' });
  // цена из маржи 35% (380 ₽) показывается без плюса, а количество грантов — целым числом без ₽
  const price = runCalc(registry.find(m => m.meta.id === 'pricing'), { margin: 35, audience: 45, venue: 0, route: 0 }, cfg, {});
  assert.equal(formatHeadline(kind.pricing, price.priceFromMargin), '380 ₽');
  const g = runCalc(registry.find(m => m.meta.id === 'grants'), { launch: 0 }, cfg, { market, now: Date.UTC(2026, 10, 19) });
  assert.doesNotMatch(formatHeadline(kind.grants, g.usable.length), /₽|\+/);
});

test('тепловая карта: малые отрицательные — «0к», а не «−0к»', () => {
  assert.equal(thousands(-400), '0к');
  assert.equal(thousands(-499), '0к');
  assert.equal(thousands(-12400), '−12к');
  assert.equal(thousands(0), '0к');
  assert.equal(thousands(45300), '45к');
  for (const v of [-1, -250, -499, 499]) assert.ok(!/−0к/.test(thousands(v)), String(v));
});

/* ================= Год 2028 и «до/после» порога ================= */

test('год 2028 в селекторе; где данных нет — честное «нет данных», расчёт без NaN', () => {
  assert.deepEqual(cfg.years, [2026, 2027, 2028]);
  for (const id of ['taxes', 'payroll', 'basecamp', 'goal']) {
    const mod = registry.find(m => m.meta.id === id);
    const ctx = { market, now: Date.UTC(2026, 10, 19) };
    const inputs = { ...runDefaults(mod, cfg, ctx).inputs, year: 2028 };
    assert.equal(firstBadNumber(runCalc(mod, inputs, cfg, ctx)), null, id);
  }
  const r = taxes({ year: 2028, revenue: 3.6e6, costShare: 55, social: 0, employees: 0 }, cfg);
  assert.equal(r.year, 2028);
  assert.equal(r.ipFixedNoData, true);                                              // фикс. взносы 2028 в данных нет
  assert.equal(r.threshold, T);                                                     // порог 2028 в данных есть
  assert.match(methodLines('taxes', cfg, 2028).join(' '), /нет данных/);
  // селектор года содержит 2028
  const yf = registry.find(m => m.meta.id === 'taxes').controls(cfg)[0];
  assert.ok(yf.options.some(o => String(o[0]) === '2028'));
});

test('«до» и «после» порога сравниваются по одному режиму (УСН «Доходы»); лучший режим — отдельно', () => {
  // с введённым потенциальным доходом патент (6% × 100 000 = 6 000) — лучший режим, но остаток считается по УСН «Доходы»
  const c = build({ rates: { patent_potential_nsk: 100000 }, cfg: {} });
  const r = taxes({ year: 2027, revenue: 3.6e6, costShare: 55, social: 0, employees: 0 }, c);
  assert.equal(r.before.best.id, 'patent');
  assert.equal(r.after.best.id, 'patent');
  for (const side of [r.before, r.after]) {
    const u = side.regimes.find(g => g.id === 'usn6');
    near(side.netUsn6, side.revenue - side.costs - u.tax - side.vat - side.ip.total, 1e-6);   // остаток — именно по usn6, не по лучшему
  }
  // после порога НДС и штраф взносов уменьшают остаток при том же режиме: сравнение «яблоко с яблоком»
  assert.equal(r.before.vat, 0);
  assert.ok(r.after.vat > 0);
});

/* ================= Данные: провенанс и юридические тексты ================= */

test('rates.cbr: единый формат провенанса (label, источник, даты, надёжность, юр-пометка); null только с no_data', () => {
  for (const [k, l] of Object.entries(rates.cbr)) {
    for (const f of ['value', 'unit', 'label', 'source_name', 'source_url', 'fetched_at', 'valid_from', 'valid_to', 'confidence', 'note', 'legal_note']) assert.ok(f in l, `cbr.${k}: нет поля ${f}`);
    assert.match(l.legal_note, /^(Проверено|Не проверено): \d{4}-\d{2}-\d{2} · /, `cbr.${k}: формат юр-пометки`);
    if (l.value == null) { assert.equal(l.status, 'no_data', k); assert.equal(l.confidence, 'no_data', k); assert.equal(l.fetched_at, null, k); }
    else { assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(l.fetched_at), `cbr.${k}: нет fetched_at`); assert.notEqual(l.status, 'no_data', k); }
  }
});

test('config.json: общий блок $provenance для допущений проекта; юридические тексты — в calc.$legal', () => {
  assert.equal(config.$provenance.confidence, 'model');
  for (const f of ['source_name', 'fetched_at', 'applies_to', 'note', 'legal_note']) assert.ok(config.$provenance[f], `$provenance.${f}`);
  for (const key of ['patent_nodata', 'patent_note', 'social_note', 'social_missing', 'social_reference', 'social_need_status']) assert.ok(config.calc.$legal[key], key);
  // тексты строятся из данных: подстановка значений, никаких «undefined»/«NaN»/остатков шаблона
  assert.equal(legalLine(cfg, 'social_note', { rate: 1, rateDR: 5 }), '1% «Доходы» / 5% «Д−Р» по 142-ОЗ; применимость проверить');
  assert.equal(legalLine(cfg, 'social_missing', { year: 2027 }), 'На 2027 год ставка не опубликована.');
  assert.equal(legalLine(cfg, 'social_reference', { refYear: 2026, refRate: 1 }), ' Ориентир 2026: 1% «Доходы» — вводите после публикации.');
  assert.match(legalLine(cfg, 'patent_nodata'), /90\.01 \/ 93\.29 \/ 85\.41/);
  assert.equal(legalLine(cfg, 'нет_такого_ключа'), 'нет данных');
});

test('в js/ui/calc-*.js и calc-panel.js нет бизнес-констант и юридических ссылок: цифры и законы — только из data/', () => {
  const files = [['../js/ui/', 'calc-ui.js'], ['../js/ui/', 'calc-dialog.js'], ['../js/ui/', 'calc-charts.js'], ['../js/', 'calc-panel.js']];
  const ALLOWED = new Set(['0', '1', '2', '3', '4', '100', '1e3', '1e6']);
  // геометрия отрисовки графиков (размеры SVG, отступы, шаг подписей): не бизнес-данные, перечислена явно
  const GEOMETRY = { 'calc-charts.js': new Set(['320', '150', '8', '12', '22', '3.5']), 'calc-panel.js': new Set(['36', '6']) };   // calc-panel: основание системы счисления и длина суффикса id сценария
  for (const [dir, f] of files) {
    const raw = readFileSync(new URL(f, url(dir)), 'utf-8');
    // юридические ссылки, ОКВЭД и номера законов в коде запрещены: они в data/config.json (calc.$legal) и rates.json
    for (const re of [/\d{2,3}-ОЗ/, /ОКВЭД/, /Ориентир\s+\$\{/, /ст\.\s*\d/, /НК РФ/]) assert.doesNotMatch(raw, re, `${f}: юридический текст ${re} в коде`);
    let src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
    src = src.replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/`(?:[^`\\]|\\.)*`/g, m => m.replace(/[^${}()+*\-/.,\w\s|?:<>=!&[\]]/g, ' '));
    src = src.replace(/\{\d+(,\d*)?\}/g, '');                                       // квантификаторы регулярных выражений
    const geo = GEOMETRY[f] || new Set();
    const found = [...src.matchAll(/(?<![\w.$#])(\d+(?:\.\d+)?(?:e\d+)?)(?![\w])/g)].map(m => m[1]).filter(x => !ALLOWED.has(x) && !geo.has(x));
    assert.deepEqual([...new Set(found)], [], `${f}: числовые литералы ${found.join(', ')}`);
  }
});
