/* method.js — тексты «Допущения и источники» из шаблонов data/config.json (calc.$method) со значениями из cfg.
   Чистый модуль без DOM: текст не может разойтись с данными — числа подставляются при каждом открытии раздела.
   Синтаксис шаблона: {путь|формат}. Путь — в cfg (travel_costs.salary_dk), «y.» — параметры года расчёта
   (y.vatThreshold), «d.» — производные величины (d.gph — модельные взносы, %). Формат: rub, num, pct, mln, txt.
   Неизвестное значение превращается в «нет данных» — в тексте никогда не бывает undefined/NaN. */
import { getPath, num, ruNum } from './util.js';
import { yearParams } from './tax-core.js';

const NBSP = ' ';
const FMT = {
  rub: v => `${ruNum(v, 0)}${NBSP}₽`,
  num: v => ruNum(v, 2),
  pct: v => `${ruNum(v, 2)}%`,
  mln: v => `${ruNum(v / 1e6, 2)}${NBSP}млн${NBSP}₽`,
  txt: v => String(v)
};

/* Набор переменных для подстановки: cfg + параметры года + производные (всё считается из данных) */
export function methodVars(cfg, year) {
  const y = yearParams(cfg, year);
  const tu = cfg.tour_unit || {};
  const rate = y.vatLow;
  return {
    ...cfg,
    y,
    d: {
      gph: num(cfg.gphRate) * 100,                                   // модельные взносы, %
      usn: cfg.usn,                                                  // УСН «Доходы», %
      vatFrac: rate == null ? null : `${rate}/${100 + rate}`,       // «5/105» — НДС «в цене»
      tourSmallRevenue: num(tu.aud_small) * num(tu.ticket),
      tourLargeRevenue: num(tu.aud_large) * num(tu.ticket),
      partyCheckMin: Math.min(...(cfg.stages || []).map(s => s.party_check)),
      partyCheckMax: Math.max(...(cfg.stages || []).map(s => s.party_check)),
      maxShows: num(cfg.calc && cfg.calc.goal_max_shows_with_base),
      npdCompanies: num(cfg.npdCompanies) * 100,                     // НПД с ИП и юрлиц, %
      npdIndividuals: num(cfg.npdIndividuals) * 100                  // НПД с физлиц, %
    }
  };
}

/* Подставляет значения в одну строку шаблона */
export function fillTemplate(tpl, vars) {
  return String(tpl).replace(/\{([\w.$]+)(?:\|(\w+))?\}/g, (_, path, fmt) => {
    const v = getPath(vars, path);
    if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return 'нет данных';
    if (fmt && FMT[fmt]) return typeof v === 'number' || fmt === 'txt' ? FMT[fmt](v) : String(v);
    return typeof v === 'number' ? FMT.num(v) : String(v);
  });
}

/* Строки «Допущений» калькулятора id: шаблоны лежат в cfg.calc.$method[id] (массив строк) */
export function methodLines(id, cfg, year) {
  const tpls = (cfg.calc && cfg.calc.$method && cfg.calc.$method[id]) || [];
  const vars = methodVars(cfg, year);
  return tpls.map(t => fillTemplate(t, vars));
}
