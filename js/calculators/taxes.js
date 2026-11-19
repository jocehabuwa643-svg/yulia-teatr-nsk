/* taxes.js — сравнение налоговых режимов на одних данных.
   Только ставки из rates.json; null → колонка «нет данных». НДС 5% — только сверх порога. */
export const meta = {
  id: 'taxes',
  icon: 'scale',
  title: 'Налоги и режимы',
  what: 'Считает: налоговую нагрузку года по режимам бок о бок и лучший вариант',
  when: 'Когда: выбираете режим до регистрации или при росте выручки'
};

export const controls = cfg => [
  { type: 'range', id: 'revenue', label: 'Выручка за год', min: 500000, max: 30000000, step: 100000, def: 3600000, suffix: '₽', wide: true },
  { type: 'range', id: 'costShare', label: 'Доля расходов в выручке', min: 10, max: 80, step: 1, def: 55, suffix: '%' },
  { type: 'select', id: 'social', label: 'Статус социального предприятия (реестр МСП)', options: [[0, 'Нет / не подтверждён'], [1, 'Да, подтверждён']] },
  { type: 'range', id: 'employees', label: 'Гонорары команды за год (ГПХ)', min: 0, max: 6000000, step: 50000, def: 1200000, suffix: '₽' }
];

export function calc({ revenue, costShare, social, employees }, cfg) {
  const costs = revenue * costShare / 100;
  const base = revenue - costs;
  const overVat = revenue > cfg.vatThreshold;
  const vat = overVat ? revenue * cfg.vatRate / 1.05 : 0;      // НДС в цене: касса × 5/105
  const vatSaved = vat * cfg.usn / 100;                          // УСН не облагает НДС-часть
  const onePct = Math.max(0, revenue - cfg.contributions1pctThreshold) * 0.01;

  const regimes = [];
  regimes.push({
    id: 'usn6', name: 'УСН «Доходы»', rate: cfg.usn,
    tax: revenue * cfg.usn / 100 - vatSaved, note: 'Базовая ставка; взносы уменьшают налог — здесь не учтено',
    noData: false
  });
  regimes.push({
    id: 'usn15', name: `УСН «Доходы − расходы»`, rate: cfg.usnDR,
    tax: Math.max(0, base) * cfg.usnDR / 100, note: `Расходы ${costShare}% должны подтверждаться документами`,
    noData: false
  });
  regimes.push({
    id: 'usnSocial', name: 'УСН соцпредприятие НСО', rate: cfg.usnSocial,
    tax: cfg.usnSocial != null && social ? Math.max(0, social ? (cfg.usnSocial / 100) * revenue - vatSaved : 0) : null,
    rateDR: cfg.usnSocialDR,
    note: cfg.usnSocial != null && social ? `${cfg.usnSocial}% «Доходы» / ${cfg.usnSocialDR}% «Д−Р» по 142-ОЗ; применимость проверить` : 'нет данных по ставке',
    noData: cfg.usnSocial == null || !social
  });
  regimes.push({
    id: 'patent', name: 'Патент НСО', rate: null,
    tax: cfg.patentPotential != null ? cfg.patentPotential * 0.06 : null,
    note: cfg.patentPotential != null ? 'Потенциальный доход × 6%' : 'Потенциальный доход по 90.01/93.29 не внесён — введите вручную',
    noData: cfg.patentPotential == null
  });

  const withTax = regimes.filter(r => r.tax != null);
  const best = withTax.length ? withTax.reduce((a, b) => (a.tax <= b.tax ? a : b)) : null;
  return {
    revenue, costs, overVat, vat, vatSaved, onePct, ipFixed: cfg.ipFixed, regimes, best,
    warning: overVat ? `Годовая выручка выше порога ${cfg.vatThreshold / 1e6} млн ₽: в цену включается НДС ${cfg.vatRate * 100}% (5/105), для УСН он исключается из дохода` : null,
    ipFixedNoData: cfg.ipFixed == null
  };
}
