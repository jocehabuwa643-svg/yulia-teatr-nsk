/* data-loader.js — загрузка data/*.json с кэшем, версией и graceful fallback.
   Никаких расчётов: только доставка данных и флаги свежести. */
import { store, toast } from './ui/helpers.js';

const FILES = ['rates', 'config', 'regions', 'competitors', 'market', 'meta', 'guide'];
const DATA_VERSION = 2;
const cacheKey = n => `data.v${DATA_VERSION}.${n}`;

async function fetchOne(name) {
  const url = `data/${name}.json`;
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    try { store.set(cacheKey(name), { t: Date.now(), d: json }); } catch (e) { /* квота — не критично */ }
    return { data: json, fromCache: false, error: null };
  } catch (e) {
    // fallback на последние известные значения из localStorage
    const cached = store.get(cacheKey(name), null);
    if (cached && cached.d) return { data: cached.d, fromCache: true, error: e.message };
    return { data: null, fromCache: false, error: e.message };
  }
}

/* Возвращает { rates, config, regions, competitors, market, meta, guide, health } */
export async function loadAll() {
  const entries = await Promise.all(FILES.map(fetchOne));
  const out = { health: { errors: [], cached: [] } };
  FILES.forEach((n, i) => {
    out[n] = entries[i].data;
    if (entries[i].error) { out.health.errors.push(n + ': ' + entries[i].error); if (entries[i].fromCache) out.health.cached.push(n); }
  });
  if (out.health.errors.length && !out.health.cached.length) {
    toast('Данные не загрузились — проверьте соединение');
  } else if (out.health.cached.length) {
    toast('Часть данных — из кэша браузера');
  }
  return out;
}

/* Возраст значения со встроенным провенансом (fetched_at) в днях; Infinity если даты нет */
export function ageDays(value) {
  if (!value || !value.fetched_at) return Infinity;
  const d = new Date(value.fetched_at);
  return isNaN(d) ? Infinity : (Date.now() - d.getTime()) / 864e5;
}

/* Собирает единый config для калькуляторов: JSON → плоская структура формул */
export function buildCalcConfig({ rates, config }) {
  const t = rates.tax || {};
  return {
    usn: (t.usn_income_rate && t.usn_income_rate.value) ?? 6,
    usnDR: (t.usn_income_minus_costs_rate && t.usn_income_minus_costs_rate.value) ?? 15,
    usnSocial: t.usn_nso_social_income && t.usn_nso_social_income.value,
    usnSocialDR: t.usn_nso_social_income_minus_costs && t.usn_nso_social_income_minus_costs.value,
    vatThreshold: (t.vat_threshold && t.vat_threshold.value) ?? 20000000,
    vatRate: ((t.vat_rate_in_price && t.vat_rate_in_price.value) ?? 5) / 100, // доля; в цене = касса × 5/105
    gphRate: ((t.gph_contributions_rate && t.gph_contributions_rate.value) ?? 30.2) / 100,
    ipFixed: t.ip_fixed_contributions && t.ip_fixed_contributions.value,           // может быть null → no_data
    patentPotential: t.patent_potential_nsk && t.patent_potential_nsk.value,       // null → no_data
    contributions1pctThreshold: (t.contributions_1pct_threshold && t.contributions_1pct_threshold.value) ?? 300000,
    npdCompanies: ((t.npd_rate_companies && t.npd_rate_companies.value) ?? 6) / 100,
    ...config,
    travel: {
      ...config.travel_costs,
      shareSchool: config.venue_share.school_garden / 100,
      shareDk: config.venue_share.dk / 100,
      gas: config.routes_gas.map(r => r.gas),
      routeNames: config.routes_gas.map(r => `${r.name} · ${r.km ? r.km + ' км · ' : ''}${r.gas} ₽`)
    }
  };
}
