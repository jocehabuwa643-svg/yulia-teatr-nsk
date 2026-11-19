/* run.js — единая точка запуска расчёта калькулятора (UI, сравнение сценариев и тесты идут через неё).
   «Сегодня» (now) и данные рынка передаются снаружи: внутри расчётов нет Date.now(), поэтому всё воспроизводимо. */
import { defaultsOf } from './util.js';

/* Поля формы → вход calc() (travel.fromForm) → результат */
export function runCalc(mod, inputs, cfg, ctx = {}) {
  const calcInput = mod.fromForm ? mod.fromForm(inputs) : inputs;
  return mod.calc(calcInput, cfg, ctx.market, ctx.now);
}

/* Результат с входами по умолчанию (значения def из спецификации полей) */
export function runDefaults(mod, cfg, ctx = {}) {
  const inputs = defaultsOf(mod.controls(cfg));
  return { inputs, result: runCalc(mod, inputs, cfg, ctx) };
}

/* Ключевые показатели результата для таблицы сравнения (у модуля может не быть summary → пусто) */
export const summaryOf = (mod, result) => (typeof mod.summary === 'function' ? mod.summary(result) : []);
