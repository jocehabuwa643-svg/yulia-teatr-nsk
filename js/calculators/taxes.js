/* taxes.js — сравнение налоговых режимов на одних данных, с переходом через порог НДС.
   Только ставки из rates.json (по году расчёта); значение no_data → колонка «нет данных» + ручной ввод.
   Результат считается дважды: «до порога» (выручка не выше порога) и «после порога» (ваша выручка либо порог + 1 ₽),
   плюс точка перехода: при какой выручке после НДС вы зарабатываете столько же, сколько на пороге. */
import { num, nonNeg, share, clamp, rangeField, yearField, ruNum } from './util.js';
import { yearParams, vatStatus, vatInPrice, ipContributions, crossingMonth } from './tax-core.js';

export const meta = {
  id: 'taxes',
  sources: ['usn_income_rate', 'usn_income_minus_costs_rate', 'usn_min_tax_rate', 'usn_nso_social_income*', 'usn_nso_social_income_minus_costs*', 'vat_threshold*', 'vat_rate_special_low', 'vat_rate_special_high', 'vat_rate_general', 'vat_band_special_low_upto*', 'vat_band_special_high_upto*', 'ip_fixed_contributions*', 'contributions_1pct_threshold', 'contributions_1pct_rate', 'ip_extra_contrib_cap*', 'usn_deduction_no_staff_pct', 'usn_deduction_with_staff_pct', 'patent_potential_nsk', 'patent_tax_rate'],
  icon: 'scale',
  title: 'Налоги и режимы',
  what: 'Считает: налоговую нагрузку года по режимам, переход через порог НДС и взносы ИП',
  when: 'Когда: выбираете режим до регистрации или выручка подходит к порогу НДС'
};

export const controls = cfg => [
  yearField(cfg, { wide: true }),
  rangeField(cfg, 'taxes', 'revenue', 'Выручка за год', { wide: true }),
  rangeField(cfg, 'taxes', 'costShare', 'Доля расходов в выручке'),
  rangeField(cfg, 'taxes', 'employees', 'Гонорары команды за год (ГПХ)'),
  { type: 'select', id: 'social', label: 'Статус социального предприятия (реестр МСП)', options: [[0, 'Нет / не подтверждён'], [1, 'Да, подтверждён']], wide: true }
];

/* Последний год, за который известна ставка соцпредприятия (по cfg.byYear) */
export function lastSocialYear(cfg) {
  const by = cfg.byYear || {};
  const years = Object.keys(by).filter(y => by[y] && by[y].usnSocial != null).sort();
  return years.length ? years[years.length - 1] : null;
}

/* Налоги и взносы при годовой выручке rev. ctx: p (параметры года), cfg, costShare, social, employees */
export function scenario(rev0, ctx) {
  const { p, cfg } = ctx;
  const rev = nonNeg(rev0);
  const vs = vatStatus(rev, p);
  const lost = vs.state === 'lost';
  // выше верхней границы право на УСН утрачивается: НДС по общей ставке (верхняя оценка — вычеты входного НДС не моделируются)
  const vat = vs.state === 'exempt' ? 0 : vatInPrice(rev, vs.rate);
  const costs = rev * share(ctx.costShare);
  const usnIncome = rev - (lost ? 0 : vat);                   // НДС исключается из дохода УСН
  const ip = ipContributions(rev, p, cfg);
  const gphContribs = ctx.employees * cfg.gphRate;            // модельная ставка взносов с гонораров
  // пул вычета: взносы ИП за себя + взносы с гонораров; лимит — % налога (без работников выше, с выплатами физлицам ниже)
  const pool = ip.total + (ctx.employees > 0 ? gphContribs : 0);
  const dedPct = ctx.employees > 0 ? cfg.deductWithStaff : cfg.deductNoStaff;

  const regimes = [];
  // --- УСН «Доходы»
  const usn6 = usnIncome * share(cfg.usn);
  const ded6 = dedPct == null ? 0 : Math.min(pool, usn6 * share(dedPct));
  regimes.push({
    id: 'usn6', name: 'УСН «Доходы»', rate: cfg.usn, lost,
    tax: lost ? null : usn6, taxAfterContrib: lost ? null : usn6 - ded6, deduction: ded6, dedPct,
    noData: false
  });
  // --- УСН «Доходы − расходы» (минимальный налог — % от доходов)
  const base15 = Math.max(0, usnIncome - costs);
  const usn15 = Math.max(base15 * share(cfg.usnDR), usnIncome * share(cfg.usnMinTax));
  const base15c = Math.max(0, usnIncome - costs - pool);
  const usn15c = Math.max(base15c * share(cfg.usnDR), usnIncome * share(cfg.usnMinTax));
  regimes.push({
    id: 'usn15', name: 'УСН «Доходы − расходы»', rate: cfg.usnDR, lost,
    tax: lost ? null : usn15, taxAfterContrib: lost ? null : usn15c, minTax: cfg.usnMinTax,
    noData: false
  });
  // --- УСН соцпредприятия НСО: ставка зависит от года; на 2027 данных нет
  const socRate = p.usnSocial;
  regimes.push({
    id: 'usnSocial', name: 'УСН соцпредприятие НСО', rate: socRate, rateDR: p.usnSocialDR, lost,
    tax: !lost && ctx.social && socRate != null ? Math.max(0, usnIncome * share(socRate)) : null,
    needStatus: !ctx.social,                                    // ставка применяется только при подтверждённом статусе
    noData: socRate == null || !ctx.social                       // налог посчитать нельзя: нет ставки года либо статуса
  });
  // --- Патент НСО: потенциальный доход × ставка (нет данных → ручной ввод)
  const pot = cfg.patentPotential;
  regimes.push({
    id: 'patent', name: 'Патент НСО', rate: cfg.patentRate,
    tax: pot != null && cfg.patentRate != null ? pot * share(cfg.patentRate) : null,
    noData: pot == null
  });

  const withTax = regimes.filter(r => r.tax != null);
  const best = withTax.length ? withTax.reduce((a, b) => (a.tax <= b.tax ? a : b)) : null;
  return {
    revenue: rev, costs, vat, vatState: vs.state, vatRate: vs.rate, bandUnknown: vs.bandUnknown, usnLost: lost,
    usnIncome, ip, gphContribs, pool, dedPct, regimes, best,
    // остаток владельца при УСН «Доходы» без вычета взносов: выручка − расходы − налог − НДС − взносы ИП
    netUsn6: rev - costs - usn6 - vat - ip.total
  };
}

/* Выручка за порогом, при которой остаток владельца (УСН «Доходы») снова равен остатку на пороге.
   Бисекция на [порог + проба; верх 5%-диапазона]: на этом участке остаток растёт при расходах ниже ~90% выручки.
   null — точка внутри диапазона не достигается (расходы слишком велики). */
export function breakEvenRevenue(ctx) {
  const { p, cfg } = ctx;
  const T = p.vatThreshold;
  if (T == null) return null;
  const be = cfg.calc.breakeven;
  const target = scenario(T, ctx).netUsn6;
  let lo = T + cfg.calc.threshold_probe_rub;
  let hi = p.vatBandLow != null ? Math.min(p.vatBandLow, T * be.search_max_multiple) : T * be.search_max_multiple;
  if (scenario(hi, ctx).netUsn6 < target) return null;
  for (let i = 0; i < be.iterations && hi - lo > be.tolerance_rub; i++) {
    const mid = (lo + hi) / 2;
    if (scenario(mid, ctx).netUsn6 >= target) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

export function calc(input, cfg) {
  const p = yearParams(cfg, input.year);
  const ctx = {
    p, cfg,
    costShare: clamp(nonNeg(input.costShare), 0, 100),
    social: num(input.social) ? 1 : 0,
    employees: nonNeg(input.employees)
  };
  const revenue = nonNeg(input.revenue);
  const T = p.vatThreshold;
  const months = cfg.calendar.months_per_year;
  const probe = cfg.calc.threshold_probe_rub;
  const over = T != null && revenue > T;
  // «до порога»: доход не выше порога; «после порога»: ваша выручка, а если порог не превышен — порог + 1 ₽ (для сравнения)
  const before = scenario(T == null ? revenue : Math.min(revenue, T), ctx);
  const after = scenario(T == null ? revenue : (over ? revenue : T + probe), ctx);
  const now = scenario(revenue, ctx);
  const month = T == null ? null : crossingMonth(revenue, T, months);
  const crossing = T == null ? null : {
    threshold: T, over, headroom: T - revenue,
    month,                                                      // месяц, в котором равномерная выручка пересекает порог
    vatFromMonth: month != null && month < months ? month + 1 : null, // НДС — с 1-го числа следующего месяца
    vatFirstYear: month != null ? vatInPrice(revenue * (months - month) / months, after.vatRate) : 0,
    breakEven: breakEvenRevenue(ctx)
  };
  return {
    year: p.year, revenue, threshold: T, bandLow: p.vatBandLow, bandHigh: p.vatBandHigh,
    costs: now.costs, overVat: over, vat: now.vat, vatState: now.vatState, vatRate: now.vatRate,
    vatSaved: now.vat * share(cfg.usn),                         // УСН не облагает НДС-часть
    onePct: now.ip.extra, ip: now.ip, ipFixed: now.ip.fixedNoData ? null : now.ip.fixed,
    ipFixedNoData: now.ip.fixedNoData, ipCapNoData: now.ip.capNoData,
    regimes: now.regimes, best: now.best, now, before, after, crossing,
    gphContribs: now.gphContribs, dedPct: now.dedPct, social: ctx.social,
    socialYear: p.usnSocial != null ? p.year : lastSocialYear(cfg),
    warning: over ? `Годовая выручка выше порога ${ruNum(T / 1e6)} млн ₽ (${p.year}): в цену включается НДС ${ruNum(now.vatRate)}%, для УСН он исключается из дохода` : null
  };
}

/* Ключевые показатели для сравнения сценариев */
export const summary = r => [
  { label: 'Налог года (лучший режим)', v: r.best ? r.best.tax : null, t: 'rub', empty: 'нет данных' },
  { label: 'Режим', v: r.best ? r.best.name : null, t: 'text', empty: 'нет данных' },
  { label: 'НДС за год', v: r.vat, t: 'rub' },
  { label: 'Взносы ИП (с 1% сверх порога)', v: r.ip.total, t: 'rub' },
  { label: 'Точка перехода НДС (выручка)', v: r.crossing ? r.crossing.breakEven : null, t: 'rub', empty: 'нет данных' }
];
