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
  headline: 'amount',            // тип главной цифры: result — со знаком, amount — сумма/цена без плюса, count — целое число
  title: 'Налоги и режимы',
  short: 'Налоги',                 // короткое имя для ленты переключателей
  what: 'Считает: налоговую нагрузку года по режимам и порог НДС',
  when: 'Когда: выбираете режим до регистрации',
  more: 'Считает: налоговую нагрузку года по режимам, переход через порог НДС и взносы ИП. Когда это нужно: выбираете режим до регистрации или выручка подходит к порогу НДС.'
};

export const controls = cfg => [
  yearField(cfg, { wide: true }),
  rangeField(cfg, 'taxes', 'revenue', 'Выручка за год', { wide: true }),
  rangeField(cfg, 'taxes', 'costShare', 'Доля расходов в выручке'),
  rangeField(cfg, 'taxes', 'employees', 'Гонорары команды за год (ГПХ)'),
  // переключатель штата для вычета взносов из УСН «Доходы» (ст. 346.21 п. 3.1 НК РФ): до 100% без работников, до 50% с ними
  { type: 'select', id: 'staff', label: 'Работники и выплаты физлицам (для вычета взносов)', wide: true, def: 'auto', options: STAFF_OPTIONS },
  { type: 'select', id: 'social', label: 'Статус социального предприятия (реестр МСП)', options: [[0, 'Нет / не подтверждён'], [1, 'Да, подтверждён']], wide: true }
];

/* Варианты переключателя штата. «auto» — по полю гонораров: есть выплаты команде по ГПХ → считаем, что штат есть */
export const STAFF_OPTIONS = [
  ['auto', 'По гонорарам команды: есть выплаты — до 50% налога'],
  [0, 'Работаю одна, без работников — вычет до 100% налога'],
  [1, 'Есть работники / штат — вычет до 50% налога']
];
/* Есть ли штат для лимита вычета: явный выбор переключателя, иначе — по сумме гонораров (поведение до переключателя) */
export function hasStaff(staff, employees) {
  if (staff === 0 || staff === '0') return false;
  if (staff === 1 || staff === '1') return true;
  return nonNeg(employees) > 0;
}

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
  // 1% взносов ИП — от дохода УСН (без НДС), а не от кассы: допущение проекта, см. contributions_1pct_threshold в rates.json
  const ip = ipContributions(usnIncome, p, cfg);
  const gphContribs = ctx.employees * cfg.gphRate;            // модельная ставка взносов с гонораров
  // пул вычета: взносы ИП за себя (фикс + 1% сверх порога) + при штате взносы за работников (модель — с гонораров ГПХ);
  // лимит — % налога из rates.json: без работников до 100%, с работниками / выплатами физлицам до 50% (ст. 346.21 п. 3.1 НК РФ)
  const staff = ctx.staff == null ? ctx.employees > 0 : !!ctx.staff;
  const pool = ip.total + (staff ? gphContribs : 0);
  const dedPct = staff ? cfg.deductWithStaff : cfg.deductNoStaff;

  const regimes = [];
  // --- УСН «Доходы»
  const usn6 = usnIncome * share(cfg.usn);
  const ded6 = dedPct == null ? 0 : Math.min(pool, usn6 * share(dedPct));
  regimes.push({
    id: 'usn6', name: 'УСН «Доходы»', rate: cfg.usn, lost,
    tax: lost ? null : usn6, taxAfterContrib: lost ? null : usn6 - ded6, deduction: ded6, dedPct, staff,
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
  // соцпредприятие — тот же объект «Доходы» по сниженной ставке: вычет взносов по тому же правилу и лимиту, что у usn6
  const soc = regimes[regimes.length - 1];
  if (soc.tax != null) {
    soc.deduction = dedPct == null ? 0 : Math.min(pool, soc.tax * share(dedPct));
    soc.taxAfterContrib = soc.tax - soc.deduction;
    soc.dedPct = dedPct; soc.staff = staff;
  }
  // --- Патент НСО: потенциальный доход × ставка (нет данных → ручной ввод)
  const pot = cfg.patentPotential;
  regimes.push({
    id: 'patent', name: 'Патент НСО', rate: cfg.patentRate,
    tax: pot != null && cfg.patentRate != null ? pot * share(cfg.patentRate) : null,
    noData: pot == null
  });

  // налог К УПЛАТЕ по режиму: УСН — после вычета/учёта взносов (taxAfterContrib), патент — без вычета (в модели не считается)
  regimes.forEach(g => { g.pay = g.tax == null ? null : Math.max(0, g.taxAfterContrib != null ? g.taxAfterContrib : g.tax); });
  const withTax = regimes.filter(r => r.tax != null);
  // best — по налогу ДО вычета взносов (прежняя логика, на ней держится сравнение сценариев «Налог года»);
  // bestPay — по налогу К УПЛАТЕ: его показывает шапка калькулятора, карточки и смета
  const best = withTax.length ? withTax.reduce((a, b) => (a.tax <= b.tax ? a : b)) : null;
  const bestPay = withTax.length ? withTax.reduce((a, b) => (a.pay <= b.pay ? a : b)) : null;
  return {
    revenue: rev, costs, vat, vatState: vs.state, vatRate: vs.rate, bandUnknown: vs.bandUnknown, usnLost: lost,
    usnIncome, ip, gphContribs, pool, dedPct, staff, regimes, best, bestPay,
    // детализация УСН «Доходы»: налог 6% → вычет взносов → налог к уплате (не меньше 0: вычет ограничен % налога ≤ 100%)
    usn6Tax: usn6, usn6Deduction: ded6, usn6Pay: Math.max(0, usn6 - ded6),
    // ОСТАТОК ВЛАДЕЛЬЦА (показывается в интерфейсе): выручка − расходы − налог к уплате (после вычета) − НДС − взносы ИП
    ownerNet: rev - costs - Math.max(0, usn6 - ded6) - vat - ip.total,
    // остаток без вычета взносов (полный налог + полные взносы) — только для «точки перехода НДС» (сравнение берегов порога)
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
    employees: nonNeg(input.employees),
    staff: hasStaff(input.staff, input.employees)
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
    regimes: now.regimes, best: now.best, bestPay: now.bestPay, now, before, after, crossing,
    // выбрано «Работаю одна», но есть гонорары по ГПХ: по НК лимит вычета в этом случае 50% (см. note в rates.json)
    staffConflict: (input.staff === 0 || input.staff === '0') && ctx.employees > 0,
    gphContribs: now.gphContribs, dedPct: now.dedPct, staff: now.staff, social: ctx.social,
    usn6Tax: now.usn6Tax, usn6Deduction: now.usn6Deduction, usn6Pay: now.usn6Pay, ownerNet: now.usnLost ? null : now.ownerNet,
    socialYear: p.usnSocial != null ? p.year : lastSocialYear(cfg),
    warning: over ? `Годовая выручка выше порога ${ruNum(T / 1e6)} млн ₽ (${p.year}): в цену включается НДС ${ruNum(now.vatRate)}%, для УСН он исключается из дохода` : null
  };
}

/* Ключевые показатели для сравнения сценариев */
export const summary = r => [
  { label: 'Налог года (лучший режим, до вычета взносов)', v: r.best ? r.best.tax : null, t: 'rub', empty: 'нет данных' },
  { label: 'Режим', v: r.best ? r.best.name : null, t: 'text', empty: 'нет данных' },
  { label: 'Налог к уплате (лучший режим, после вычета взносов)', v: r.bestPay ? r.bestPay.pay : null, t: 'rub', empty: 'нет данных' },
  { label: 'НДС за год', v: r.vat, t: 'rub' },
  { label: 'Взносы ИП (с 1% сверх порога)', v: r.ip.total, t: 'rub' },
  { label: 'Остаток владельца (УСН «Доходы», с вычетом взносов)', v: r.ownerNet, t: 'rub', empty: 'УСН недоступна' },
  { label: 'Точка перехода НДС (выручка)', v: r.crossing ? r.crossing.breakEven : null, t: 'rub', empty: 'нет данных' }
];
