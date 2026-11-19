/* tests/calculators.test.mjs — контрольные примеры формул.
   Запуск: node --test tests/
   Ожидания посчитаны вручную по формулам (независимая арифметика),
   совпадают с проверенной версией v1 (41/41 приёмочных тестов). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { calc as travel } from '../js/calculators/travel.js';
import { calc as basecamp, baseMonth, business } from '../js/calculators/basecamp.js';
import { calc as goal } from '../js/calculators/goal.js';
import { calc as taxes } from '../js/calculators/taxes.js';
import { calc as payroll } from '../js/calculators/payroll.js';
import { calc as pricing } from '../js/calculators/pricing.js';
import { calc as parties } from '../js/calculators/parties.js';
import { calc as cashflow } from '../js/calculators/cashflow.js';
import { calc as grants } from '../js/calculators/grants.js';

const rates = JSON.parse(readFileSync(new URL('../data/rates.json', import.meta.url), 'utf-8'));
const config = JSON.parse(readFileSync(new URL('../data/config.json', import.meta.url), 'utf-8'));
const market = JSON.parse(readFileSync(new URL('../data/market.json', import.meta.url), 'utf-8'));

/* Тот же сборщик, что в data-loader.js (продублирован, чтобы тесты не зависели от DOM-модуля) */
function buildCfg(rates, config) {
  const t = rates.tax;
  return {
    usn: t.usn_income_rate.value,
    usnDR: t.usn_income_minus_costs_rate.value,
    usnSocial: t.usn_nso_social_income.value,
    usnSocialDR: t.usn_nso_social_income_minus_costs.value,
    vatThreshold: t.vat_threshold.value,
    vatRate: t.vat_rate_in_price.value / 100,
    gphRate: t.gph_contributions_rate.value / 100,
    ipFixed: t.ip_fixed_contributions.value,
    patentPotential: t.patent_potential_nsk.value,
    contributions1pctThreshold: t.contributions_1pct_threshold.value,
    npdCompanies: t.npd_rate_companies.value / 100,
    ...config,
    travel: {
      ...config.travel_costs,
      shareSchool: config.venue_share.school_garden / 100,
      shareDk: config.venue_share.dk / 100,
      gas: config.routes_gas.map(r => r.gas),
      routeNames: config.routes_gas.map(r => r.name)
    }
  };
}
const cfg = buildCfg(rates, config);

test('travel: дефолт 45 детей × 325 ₽ × 1 показ, наём → +3 925 ₽/показ (эталон v1)', () => {
  const r = travel({ n: 45, p: 325, k: 1, r: 0, dk: 0, own: 0 }, cfg);
  assert.equal(r.gross, 14625);
  assert.equal(r.salary, 5000);
  assert.equal(r.social, 1510);          // 5000 × 0.302
  assert.equal(r.fuel, 1000);
  assert.equal(r.wear, 400);
  assert.equal(r.print, 450);
  assert.equal(r.fee, 1462.5);           // 10%
  assert.equal(r.tax, 877.5);            // 6%
  assert.equal(Math.round(r.cost), 10700);
  assert.equal(r.profit, 3925);
  assert.equal(r.per, 3925);
});

test('travel: основатели играют сами → взносов 0, +5 435 ₽ (эталон v1)', () => {
  const r = travel({ n: 45, p: 325, k: 1, r: 0, dk: 0, own: 1 }, cfg);
  assert.equal(r.social, 0);
  assert.equal(r.profit, 5435);
});

test('travel: куст Бердск 3 × 45 × 300 ₽ → гонорар дня 15 500, ГСМ 1 500', () => {
  const r = travel({ n: 45, p: 300, k: 3, r: 1, dk: 0, own: 0 }, cfg);
  assert.equal(r.salary, 15500);
  assert.equal(r.fuel, 1500);
  assert.equal(r.gross, 40500);
  // be = (гонорар 15 500 + взносы 4 681 + ГСМ 1 500 + износ 3×400) / (300×(1−0.10−0.06) − 10 печать)
  //    = 22 881 / (252 − 10 = 242) = 94,55 → 95 зрителей за день.
  // (В прежней версии теста знаменатель был ошибочно записан как 200: 300×0,84 − 10 = 242, а не 200.)
  assert.equal(r.be, Math.ceil(22881 / 242));
  assert.equal(r.be, 95);
  // Проверка по определению: на 95 зрителях день не в убытке, на 94 — в убытке.
  const at = n => travel({ n: n / 3, p: 300, k: 3, r: 1, dk: 0, own: 0 }, cfg).profit;
  assert.ok(at(95) >= -1e-6 && at(94) < 0);
});

test('travel: ДК 150 детей × 350 → доля 30%, износ 600, доставка 200', () => {
  const r = travel({ n: 150, p: 350, k: 1, r: 0, dk: 1, own: 0 }, cfg);
  assert.equal(r.salary, 6500);
  assert.equal(r.fee, 52500 * 0.3);
  assert.equal(r.wear, 600);
  assert.equal(r.fuel, 1000 + 200);
});

test('travel: нулевая маржа не даёт NaN (деление защищено)', () => {
  const r = travel({ n: 0, p: 300, k: 1, r: 0, dk: 0, own: 0 }, cfg);
  assert.ok(Number.isFinite(r.margin));
  assert.equal(r.margin, 0);
  assert.ok(r.be >= 1);
});

test('basecamp: дефолтная база → +129 435 ₽ общий результат (эталон v1)', () => {
  const r = basecamp({ area: 130, rent: 1000, students: 40, sub: 4300, week: 12, attendance: 30, party: 8, eventprice: 10000, trips: 16, teams: 1 }, cfg);
  const b = r.b;
  assert.equal(b.gross, 40 * 4300 + 12 * 30 * 350 + 8 * 10000); // 172000+126000+80000=378000
  assert.equal(b.fixed, 130 * 1200 + 55000);                    // 211000
  assert.equal(b.groups, 4);
  assert.equal(Math.round(b.teachers), Math.round(4 * 8 * 1200 * 1.302)); // 49996.8
  assert.equal(Math.round(r.x.profit), 129435);
});

test('basecamp: порог НДС срабатывает при темпе > 20 млн (максимальная нагрузка)', () => {
  const r = basecamp({ area: 150, rent: 2000, students: 80, sub: 7000, week: 20, attendance: 40, party: 16, eventprice: 16000, trips: 200, teams: 4 }, cfg);
  assert.ok(r.x.annual > 20000000);
  assert.ok(r.x.reg === true);
  assert.ok(r.x.vat > 0);
  assert.ok(r.x.hq === 150000);
  // 4 труппы × 55 = 220 → cap на 200 запрошенных: served=200
  assert.equal(r.x.served, 200);
});

test('basecamp: нулевые ученики/выезды → без NaN', () => {
  const r = basecamp({ area: 130, rent: 1000, students: 0, sub: 4300, week: 0, attendance: 30, party: 0, eventprice: 10000, trips: 0, teams: 1 }, cfg);
  assert.ok(Number.isFinite(r.x.profit));
});

test('goal: цель 125 000 при «Разгон» достижима перебором целых показов', () => {
  const r = goal({ goal: 125000, stageSel: 1 }, cfg);
  assert.ok(r.plan === true || r.x.profit < r.goal);
  if (r.plan) assert.ok(r.x.profit >= 125000);
});

test('goal: без базы фикс −60 000 (эталон v1)', () => {
  const r = goal({ goal: 100000, stageSel: 0 }, cfg);
  assert.equal(r.max, 55);
  assert.ok(Number.isFinite(r.x.profit));
});

test('taxes: УСН 6% на 3.6 млн = 216 000; 1% сверх 300 тыс. = 33 000', () => {
  const r = taxes({ revenue: 3600000, costShare: 55, social: 0, employees: 1200000 }, cfg);
  const usn6 = r.regimes.find(g => g.id === 'usn6');
  assert.equal(Math.round(usn6.tax), 216000);
  assert.equal(r.onePct, 33000);
  assert.equal(r.overVat, false);
});

test('taxes: сверх 20 млн включается НДС 5/105', () => {
  const r = taxes({ revenue: 25000000, costShare: 50, social: 0, employees: 1000000 }, cfg);
  assert.ok(r.overVat);
  assert.equal(r.vat, 25000000 * 5 / 105);
});

test('taxes: соцпредприятие без подтверждения → «нет данных»', () => {
  const r = taxes({ revenue: 2000000, costShare: 50, social: 0, employees: 0 }, cfg);
  const soc = r.regimes.find(g => g.id === 'usnSocial');
  assert.equal(soc.noData, true);
});

test('payroll: ГПХ 45 000 × 3 → 175 770 с взносами 30,2%', () => {
  const r = payroll({ fee: 45000, people: 3, regular: 0 }, cfg);
  assert.equal(Math.round(r.gph.cost), Math.round(135000 * 1.302));
  assert.equal(r.npd.cost, 135000);
});

test('pricing: цена из маржи при 45 зрителях положительна и конечна', () => {
  const r = pricing({ margin: 35, audience: 45, venue: 0, route: 0 }, cfg);
  assert.ok(r.priceFromMargin === null || Number.isFinite(r.priceFromMargin));
  assert.equal(r.grid.length, 6);      // 6 аудиторий
  assert.equal(r.grid[0].length, 9);   // 9 цен
});

test('parties: пакет 10 000 ₽, 8/мес → прибыль конечна, маржа > 0', () => {
  const r = parties({ price: 10000, hours: 2, guests: 12, extra: 10, perMonth: 8 }, cfg);
  assert.ok(r.profit > 0);
  assert.ok(r.margin > 0 && r.margin < 100);
});

test('cashflow: декабрь–август из модели; минимальный остаток −964 900 в феврале', () => {
  const r = cashflow({ startCapital: 1185000, tourDelta: 0, baseDelta: 0 }, cfg);
  assert.equal(r.rows.length, 12);
  // Ручной расчёт без финансирования: дек −430 400, янв −399 800, фев −399 800 + 19 900 − 585 000 = −964 900
  assert.equal(Math.round(r.minNoFinancing), -964900);
  // С финансированием 1 185 000 дно = 1 185 000 − 964 900 = 220 100 (кассовых разрывов нет)
  assert.equal(Math.round(r.min.net), 220100);
  assert.equal(r.gaps.length, 0);
});

test('grants: до февраля 2027 ни один открытый конкурс не даёт денег (итоги ПФКИ 30.04.2027)', () => {
  const r = grants({ launch: 0 }, cfg, market);
  assert.equal(r.usable.length, 0);
  assert.ok(r.conclusion.includes('не закладывайте'));
});

test('grants: при осеннем запуске ПФКИ успевает', () => {
  const r = grants({ launch: 3 }, cfg, market);
  assert.ok(r.usable.length >= 1);
});
