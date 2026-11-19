/* state.js — общее состояние приложения: загруженные данные и собранный конфиг калькуляторов.
   Модули разделов читают отсюда, чтобы не передавать одно и то же через все вызовы. */
export const state = {
  DATA: null,   // результат loadAll(): rates, config, regions, competitors, market, meta, guide, health
  CFG: null     // плоский конфиг для формул (buildCalcConfig)
};

/* Есть ли минимально необходимые данные для расчётов и обзора */
export function hasCoreData() {
  const d = state.DATA;
  return !!(d && d.config && d.rates && d.config.travel_costs && d.config.cashflow_12m);
}
