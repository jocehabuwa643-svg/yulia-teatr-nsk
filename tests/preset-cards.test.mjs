/* tests/preset-cards.test.mjs — модель экрана шаблона (js/preset-detail.js + cases() из js/preset-cards.js).
   Числа сверяются с существующими калькуляторами, а не с самим кодом экрана. Запуск: node --test */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCalcConfig } from '../js/calculators/config.js';
import { travelCalc } from '../js/calculators/travel.js';
import { baseMonth } from '../js/calculators/basecamp.js';
import { calc as goalCalc } from '../js/calculators/goal.js';
import { cases } from '../js/preset-cards.js';
import { barShares, travelDetail, fmtN } from '../js/preset-detail.js';

const J = n => JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url), 'utf-8'));
const cfg = buildCalcConfig({ rates: J('rates'), config: J('config'), competitors: J('competitors') });
const list = cases(cfg);

test('шаблоны: все 8 на месте, у каждого есть модель экрана', () => {
  assert.equal(list.length, 8);
  list.forEach(c => assert.ok(c.d, `нет модели у ${c.key}`));
  assert.deepEqual(list.map(c => c.key), ['t0', 't1', 't2', 't3', 't4', 't5', 'base', 'goal']);
});

test('выездные: выручка и чистая прибыль экрана = travelCalc, расходы = выручка − прибыль', () => {
  cfg.presets_travel.forEach((p, i) => {
    const r = travelCalc({ n: p.n, p: p.p, k: p.k, r: p.r, dk: p.dk, own: p.own }, cfg);
    const f = list[i].d.flow;
    assert.equal(f.revenue, r.gross);
    assert.equal(f.net, r.profit);
    const costs = f.costs.reduce((a, x) => a + x.v, 0);
    assert.ok(Math.abs(costs - r.cost) < 1e-6, `${p.name}: строки расходов ${costs} ≠ ${r.cost}`);
    const segs = f.segs.reduce((a, x) => a + x.v, 0);
    assert.ok(Math.abs(segs - r.cost) < 1e-6, `${p.name}: сегменты полосы ${segs} ≠ ${r.cost}`);
  });
});

test('выездные: убыточный шаблон честно назван недостижимым и показывает чего не хватает', () => {
  const i = cfg.presets_travel.findIndex(p => p.name.startsWith('Опасная'));
  const d = list[i].d;
  assert.ok(d.flow.net < 0);
  assert.equal(d.verdict.level, 'bad');
  assert.match(d.verdict.text, /не меньше \d+ зрителей/);
});

test('выездные: «сколько показов для цели» = цель ÷ прибыль показа, вверх; труппа вытягивает cap показов', () => {
  const p = cfg.presets_travel[0];
  const r = travelCalc({ n: p.n, p: p.p, k: p.k, r: p.r, dk: p.dk, own: p.own }, cfg);
  const shows = Math.ceil(cfg.goals.short_target / r.per);
  const d = travelDetail(p, r, cfg);
  assert.ok(d.verdict.text.includes(fmtN(shows)), d.verdict.text);
  assert.equal(d.verdict.level, shows <= cfg.tour_unit.capacity_per_troupe ? 'ok' : 'warn');
  // дешёвый показ: нужно больше показов, чем тянет одна труппа → предупреждение, а не «достижимо»
  const cheap = { ...r, per: 100 };
  assert.equal(travelDetail(p, cheap, cfg).verdict.level, 'warn');
});

test('база: выручка/прибыль = baseMonth стадии «Разгон»; недостающее до цели закрывается выездами из goalCalc', () => {
  const st = cfg.stages[1];
  const b = baseMonth({ area: 130, rent: cfg.base_costs.rent_per_m2, s: st.students, p: st.subscription, w: st.weekend_shows, a: st.weekend_audience, h: st.parties, c: st.party_check }, cfg);
  const d = list.find(c => c.key === 'base').d;
  assert.equal(d.flow.revenue, b.gross);
  assert.equal(d.flow.net, b.profit);
  const g = goalCalc({ goal: cfg.goals.short_target, stageSel: 2 }, cfg);
  if (b.profit < cfg.goals.short_target) assert.ok(d.verdict.text.includes(fmtN(g.x.n)));
});

test('цель: стадия карточки «Разгон» = stages[1]; итог экрана = goalCalc', () => {
  const g = goalCalc({ goal: cfg.goals.short_target, stageSel: 2 }, cfg);
  const c = list.find(x => x.key === 'goal');
  assert.equal(c.headline, `${g.x.n} показов`);
  assert.equal(c.d.flow.revenue, g.x.g);
  assert.equal(c.d.flow.net, g.x.profit);
  assert.equal(c.d.verdict.level, g.plan ? 'ok' : 'bad');
  assert.match(c.d.condition, /125\s?000/);
});

test('полоса «куда ушли деньги»: доли в сумме ≤ 100%, при убытке расходы занимают всю ширину, остатка нет', () => {
  list.forEach(c => {
    const sh = barShares(c.d.flow);
    const sum = sh.reduce((a, s) => a + s.share, 0);
    assert.ok(sum <= 1 + 1e-9, `${c.key}: ${sum}`);
    sh.forEach(s => assert.ok(Number.isFinite(s.share) && s.share >= 0));
    if (c.d.flow.net < 0) assert.ok(!sh.some(s => s.net));
  });
});

test('нет NaN и «undefined» в текстах моделей', () => {
  list.forEach(c => {
    const txt = JSON.stringify(c.d);
    assert.ok(!/NaN|undefined|Infinity/.test(txt), `${c.key}: ${txt.match(/.{20}(NaN|undefined|Infinity).{20}/)}`);
  });
});
