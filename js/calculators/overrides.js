/* overrides.js — ручные значения пользователя поверх данных (чистый модуль, хранилище передаётся снаружи).
   • rates: «нет данных» и ставки с источником — по ключам rates.json («patent_potential_nsk», «ip_fixed_contributions.2027»);
   • cfg: допущения проекта (confidence:"model") — по путям config.json («base_costs.rent_per_m2»).
   Всё хранится только в браузере и никогда не меняет файлы данных. */
import { num } from './util.js';

const RATES = 'ovr.rates', CFG = 'ovr.cfg', LEGACY_PATENT = 'ovr.patent';

const clean = obj => {
  const out = {};
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    Object.entries(obj).forEach(([k, v]) => { if (typeof v === 'number' && Number.isFinite(v)) out[k] = v; });
  }
  return out;
};

/* Прочитать оба набора; прежний ключ ovr.patent (одно число) переносится в rates */
export function readOverrides(storage) {
  const rates = clean(storage.get(RATES, {}));
  const cfg = clean(storage.get(CFG, {}));
  const legacy = storage.get(LEGACY_PATENT, null);
  if (typeof legacy === 'number' && Number.isFinite(legacy) && !('patent_potential_nsk' in rates)) rates.patent_potential_nsk = legacy;
  return { rates, cfg };
}

/* Установить значение; value = null/NaN/'' — снять переопределение. Возвращает новый набор */
export function setOverride(storage, kind, key, value) {
  const all = readOverrides(storage);
  const bag = kind === 'cfg' ? all.cfg : all.rates;
  const n = value === '' || value == null ? NaN : num(value, NaN);
  if (Number.isFinite(n) && n >= 0) bag[key] = n; else delete bag[key];
  storage.set(kind === 'cfg' ? CFG : RATES, bag);
  if (kind !== 'cfg' && key === 'patent_potential_nsk') storage.set(LEGACY_PATENT, null); // старый ключ больше не нужен
  return all;
}

/* Сбросить все допущения проекта (cfg) или все ручные ставки (rates) */
export function clearOverrides(storage, kind) {
  storage.set(kind === 'cfg' ? CFG : RATES, {});
  if (kind !== 'cfg') storage.set(LEGACY_PATENT, null);
  return readOverrides(storage);
}

/* Есть ли хоть одно переопределение (тогда конфиг пересобирается) */
export const hasOverrides = o => Object.keys(o.rates).length + Object.keys(o.cfg).length > 0;
