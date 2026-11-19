/* config.js — сборка единого cfg для калькуляторов из data/config.json + data/rates.json (чистый модуль, без DOM).
   • config.json: листья {value, unit, source_name, …, confidence:"model"} → «плоская» форма (cfg.base_costs.rent_per_m2 = 1000),
     совместимая с обзором, картой и чек-листом;
   • rates.json: годовые значения (узел years) → cfg.byYear[год]; null + status:"no_data" остаётся null;
   • overrides: ручные значения пользователя (хранятся в браузере) — допущения проекта и «нет данных».
   Тестируется напрямую (tests/*.test.mjs), поэтому здесь нет ни window, ни localStorage. */

export const isLeaf = n => !!n && typeof n === 'object' && !Array.isArray(n) && 'value' in n && ('confidence' in n || 'status' in n || 'source_name' in n);
const isYears = n => !!n && typeof n === 'object' && !Array.isArray(n) && n.years && typeof n.years === 'object';

/* Лист → значение; остальные узлы обходятся рекурсивно. meta[путь] = лист без value (для бейджей источника) */
export function flatten(node, meta, path = '') {
  if (isLeaf(node)) {
    if (meta) { const { value, ...rest } = node; meta[path] = rest; }
    return node.value;
  }
  if (Array.isArray(node)) return node.map((x, i) => flatten(x, meta, path ? `${path}.${i}` : String(i)));
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = k.startsWith('$') ? v : flatten(v, meta, path ? `${path}.${k}` : k);
    return out;
  }
  return node;
}

/* Применить переопределения к листьям клона по путям «a.b.c» (для config) или «ключ» / «ключ.год» (для rates) */
function setLeaf(root, path, value, manualSource) {
  const parts = path.split('.');
  let node = root;
  for (let i = 0; i < parts.length; i++) {
    if (node == null) return false;
    if (isYears(node) && parts[i] !== 'years') node = node.years;
    node = node[parts[i]];
  }
  if (!isLeaf(node)) return false;
  node.value = value;
  if (manualSource) { node.confidence = 'manual'; node.source_name = 'Ввод пользователя (только в этом браузере)'; node.status = undefined; node.manual = true; }
  else node.overridden = true;
  return true;
}

const yearsOf = (t, key, conv = v => v) => {
  const out = {};
  const node = t[key];
  if (!node) return out;
  const src = isYears(node) ? node.years : { all: node };
  for (const [y, leaf] of Object.entries(src)) out[y] = leaf && leaf.value != null ? conv(leaf.value) : null;
  return out;
};
const one = (t, key, d = null) => (t[key] && t[key].value != null ? t[key].value : d);

/* Выжимка из competitors.json: ориентиры цены праздника (цена часа, пакеты) — без расчётов */
export function partyBenchmarks(competitors) {
  const venues = (competitors && competitors.party_venues) || [];
  return venues.map(v => {
    const prices = (v.prices || []).filter(p => typeof p.value === 'number');
    const hour = prices.find(p => /час/i.test(p.unit || ''));
    const pk = prices.filter(p => /пакет/i.test(p.unit || ''));
    return { id: v.id, name: v.name, address: v.address || '', perHour: hour ? hour.value : null, packages: pk.map(p => p.value), packageMin: pk.length ? Math.min(...pk.map(p => p.value)) : null, packageMax: pk.length ? Math.max(...pk.map(p => p.value)) : null };
  }).filter(b => b.perHour != null || b.packages.length);
}

/* Главная функция. overrides = { cfg: {путь: число}, rates: {ключ.год: число|null} } */
export function buildCalcConfig({ rates, config, competitors }, overrides = {}) {
  const conf = structuredClone(config);
  const ratesTax = structuredClone((rates && rates.tax) || {});
  Object.entries((overrides && overrides.cfg) || {}).forEach(([p, v]) => setLeaf(conf, p, v, false));
  Object.entries((overrides && overrides.rates) || {}).forEach(([p, v]) => setLeaf(ratesTax, p, v, true));

  const meta = {};
  const flat = flatten(conf, meta);
  const t = ratesTax;
  // годы расчёта и год по умолчанию — из config.calc
  const years = (flat.calc && flat.calc.years) || [];
  const defYear = (flat.calc && flat.calc.default_year) || years[years.length - 1];
  const rateMeta = {};
  Object.entries(t).forEach(([k, node]) => {
    if (isYears(node)) Object.entries(node.years).forEach(([y, leaf]) => { const { value, ...rest } = leaf; rateMeta[`${k}.${y}`] = rest; });
    else if (isLeaf(node)) { const { value, ...rest } = node; rateMeta[k] = rest; }
  });

  const pctVal = key => (one(t, key) == null ? null : one(t, key));
  const byYear = {};
  years.forEach(y => {
    const g = key => { const m = yearsOf(t, key); return m[y] === undefined ? null : m[y]; };
    byYear[y] = {
      vatThreshold: g('vat_threshold'),
      vatBandLow: g('vat_band_special_low_upto'),
      vatBandHigh: g('vat_band_special_high_upto'),
      deflator: g('usn_deflator'),
      vatLow: pctVal('vat_rate_special_low'),
      vatHigh: pctVal('vat_rate_special_high'),
      vatGeneral: pctVal('vat_rate_general'),
      ipFixed: g('ip_fixed_contributions'),
      extraCap: g('ip_extra_contrib_cap'),
      mrot: g('mrot'),
      usnSocial: g('usn_nso_social_income'),
      usnSocialDR: g('usn_nso_social_income_minus_costs'),
      gphBase: g('gph_contributions_base_limit')
    };
  });

  const cfg = {
    ...flat,
    year: defYear, years,
    byYear,
    usn: one(t, 'usn_income_rate'),
    usnDR: one(t, 'usn_income_minus_costs_rate'),
    usnMinTax: one(t, 'usn_min_tax_rate'),
    contrib1pctThreshold: one(t, 'contributions_1pct_threshold'),
    contrib1pctRate: one(t, 'contributions_1pct_rate'),
    deductNoStaff: one(t, 'usn_deduction_no_staff_pct'),
    deductWithStaff: one(t, 'usn_deduction_with_staff_pct'),
    npdIndividuals: one(t, 'npd_rate_individuals') == null ? null : one(t, 'npd_rate_individuals') / 100,
    npdCompanies: one(t, 'npd_rate_companies') == null ? null : one(t, 'npd_rate_companies') / 100,
    npdLimit: one(t, 'npd_income_limit'),
    gphRate: (one(t, 'gph_contributions_rate') ?? 0) / 100,      // модельная ставка (доля)
    gphBaseRate: one(t, 'gph_contributions_base_rate'),            // % в пределах базы
    gphAboveRate: one(t, 'gph_contributions_above_base_rate'),     // % сверх базы
    patentPotential: one(t, 'patent_potential_nsk'),
    patentRate: one(t, 'patent_tax_rate'),
    meta, rateMeta
  };
  // совместимость со старым cfg: значения года по умолчанию на верхнем уровне
  const dp = byYear[defYear] || {};
  Object.assign(cfg, {
    usnSocial: dp.usnSocial ?? null, usnSocialDR: dp.usnSocialDR ?? null,
    vatThreshold: dp.vatThreshold, vatRate: dp.vatLow == null ? null : dp.vatLow / 100,
    ipFixed: dp.ipFixed ?? null, contributions1pctThreshold: cfg.contrib1pctThreshold
  });
  // блок выезда: константы + доли площадки + ГСМ + названия маршрутов
  const tc = flat.travel_costs || {};
  const routes = flat.routes_gas || [];
  cfg.travel = {
    ...tc,
    shareSchool: flat.venue_share.school_garden / 100,
    shareDk: flat.venue_share.dk / 100,
    gas: routes.map(r => r.gas),
    routeNames: routes.map(r => `${r.name} · ${r.km ? r.km + ' км · ' : ''}${r.gas} ₽`)
  };
  cfg.party_benchmarks = partyBenchmarks(competitors);
  // редактируемые допущения проекта: путь, подпись, единица, значение
  const orig = flatten(config, null);
  cfg.assumptions = Object.entries(meta)
    .filter(([p, m]) => m.editable && typeof getVal(flat, p) === 'number')
    .map(([p, m]) => ({ path: p, label: m.label || p, unit: m.unit || '', value: getVal(flat, p), original: getVal(orig, p), meta: m, overridden: !!(overrides && overrides.cfg && p in overrides.cfg) }));
  return cfg;
}
const getVal = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/* Источник значения для бейджа: id = ключ rates («vat_threshold.2027», «usn_income_rate») либо путь config с префиксом «c:» */
export function srcOf(cfg, id) {
  if (id.startsWith('c:')) return cfg.meta[id.slice(2)] || null;
  return cfg.rateMeta[id] || null;
}
