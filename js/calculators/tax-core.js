/* tax-core.js — общее налоговое ядро: год → параметры, статус НДС по доходу, взносы ИП.
   Читает только готовый cfg (из config.js); ни одной ставки здесь нет. */
import { num, nonNeg, share } from './util.js';

/* Параметры года: cfg.byYear[год]; если год неизвестен — год по умолчанию */
export function yearParams(cfg, year) {
  const y = cfg.byYear && cfg.byYear[num(year)] ? num(year) : cfg.year;
  return { year: y, ...cfg.byYear[y] };
}

/* Статус НДС для УСН при доходе нарастающим итогом.
   exempt — доход не выше порога (ст. 145): НДС нет; low/high — пониженные ставки без вычетов;
   lost — доход выше верхней границы: право на УСН утрачивается (общие ставки, вычеты здесь не моделируются).
   Ровно порог = освобождён; порог + 1 ₽ = плательщик (закон говорит «превысили»). */
export function vatStatus(income, p) {
  const inc = nonNeg(income);
  if (p.vatThreshold == null || !(inc > p.vatThreshold)) return { state: 'exempt', rate: 0, bandUnknown: false };
  if (p.vatBandLow == null) return { state: 'low', rate: p.vatLow, bandUnknown: true };
  if (inc <= p.vatBandLow) return { state: 'low', rate: p.vatLow, bandUnknown: false };
  if (p.vatBandHigh != null && inc <= p.vatBandHigh) return { state: 'high', rate: p.vatHigh, bandUnknown: false };
  if (p.vatBandHigh == null) return { state: 'high', rate: p.vatHigh, bandUnknown: true };
  return { state: 'lost', rate: p.vatGeneral, bandUnknown: false, usnLost: true };
}
/* НДС «в цене»: касса × ставка / (100 + ставка), т.е. 5/105 для 5% и 7/107 для 7% */
export const vatInPrice = (gross, ratePct) => (num(ratePct) > 0 ? nonNeg(gross) * ratePct / (100 + ratePct) : 0);

/* Месяц, в котором равномерная выручка пересечёт порог (1…12), либо null, если не пересечёт.
   НДС начинается с 1-го числа СЛЕДУЮЩЕГО месяца (ст. 145 п. 5). */
export function crossingMonth(annualRevenue, threshold, months) {
  const a = nonNeg(annualRevenue);
  if (threshold == null || !(a > threshold) || !(months > 0)) return null;
  return Math.min(months, Math.ceil(threshold / (a / months)));
}

/* Взносы ИП за себя: фиксированные + 1% сверх порога (с потолком года).
   fixed = null → нет данных (считаем 0 и поднимаем флаг fixedNoData). */
export function ipContributions(revenue, p, cfg) {
  const rev = nonNeg(revenue);
  const over = Math.max(0, rev - cfg.contrib1pctThreshold);
  let extra = over * share(cfg.contrib1pctRate);
  const capApplied = p.extraCap != null && extra > p.extraCap;
  if (capApplied) extra = p.extraCap;
  const fixed = p.ipFixed == null ? 0 : p.ipFixed;
  return { fixed, extra, over, capApplied, total: fixed + extra, fixedNoData: p.ipFixed == null, capNoData: p.extraCap == null };
}

/* Взносы работодателя с выплат по ГПХ физлицам за год: тариф в пределах базы и ниже сверх базы.
   perPerson — выплаты одному исполнителю за год (по базе считается на человека). Модельная надбавка уже в cfg.gphRate. */
export function gphContributions(gross, cfg, p, people = 1) {
  const g = nonNeg(gross);
  const n = Math.max(1, num(people, 1));
  const each = g / n;
  const base = p.gphBase;
  if (base == null || !(each > base)) return g * cfg.gphRate;
  // сверх предельной базы — сниженный тариф (+ модельная надбавка за травматизм, как и в основном тарифе)
  const addOn = cfg.gphRate - share(cfg.gphBaseRate);
  return n * (base * cfg.gphRate + (each - base) * (share(cfg.gphAboveRate) + addOn));
}
