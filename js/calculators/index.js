/* calculators/index.js — реестр модулей-калькуляторов.
   Каждый модуль: meta (описание), controls(cfg) (спека ввода), calc(input, cfg) (чистая функция),
   render(input, cfg, result) → HTML строки результата. Никакой логики расчёта вне calc(). */
import * as travel from './travel.js';
import * as basecamp from './basecamp.js';
import * as goal from './goal.js';
import * as taxes from './taxes.js';
import * as payroll from './payroll.js';
import * as pricing from './pricing.js';
import * as parties from './parties.js';
import * as cashflow from './cashflow.js';
import * as grants from './grants.js';

export const registry = [travel, basecamp, goal, taxes, payroll, pricing, parties, cashflow, grants];
export { travel, basecamp, goal, taxes, payroll, pricing, parties, cashflow, grants };
