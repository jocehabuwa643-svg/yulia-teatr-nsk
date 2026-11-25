/* Тесты «Летнего сценария (июнь–август)»: просадка лета из seasonality.json, ориентиры цен только из данных с источником,
   состояние выбора форматов и план «Что сделать до мая». */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summerDip, dipSentence, summerCashflow, resolvePriceRef, priceAnchors, sanitizeSummerState, toggleFormat, buildTodo, todoProgress } from '../js/summer.js';

const load = n => JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url), 'utf8'));
const guide = load('guide');
const seasonality = load('seasonality');
const config = load('config');
const competitors = load('competitors');
const data = { guide, seasonality, config, competitors };
const summer = guide.summer;

test('summerDip: лето из seasonality.json — ниже среднего июль и август, самый слабый — август', () => {
  const dip = summerDip(seasonality);
  assert.ok(dip.ok);
  assert.deepEqual(dip.summer.map(r => r.m), [6, 7, 8]);
  const factor = m => seasonality.months.find(r => r.m === m).factor;
  // ожидание строится из самих данных, а не из зашитых чисел
  assert.deepEqual(dip.below.map(r => r.m), [6, 7, 8].filter(m => factor(m) < 1));
  const lowest = [6, 7, 8].reduce((lo, m) => (factor(m) < factor(lo) ? m : lo), 6);
  assert.equal(dip.lowest.m, lowest);
  assert.equal(dip.months.length, 12);
  const s = dipSentence(dip);
  assert.match(s, /август/);
  assert.match(s, /1,0/);
});

test('summerDip: пустые/битые данные не роняют блок', () => {
  assert.equal(summerDip(null).ok, false);
  assert.equal(summerDip({ months: [{ m: 'x' }] }).ok, false);
  assert.match(dipSentence(summerDip(null)), /нет/i);
  assert.match(dipSentence(summerDip({ months: [{ m: 6, name: 'Июнь', factor: 1.2 }] })), /не ниже среднего/);
});

test('summerCashflow: летние строки модели cashflow_12m с показами и заметками, как в данных', () => {
  const cf = summerCashflow(config);
  assert.deepEqual(cf.rows.map(r => r.m), ['Июнь', 'Июль', 'Август']);
  const src = config.cashflow_12m.value.months;
  for (const r of cf.rows) assert.equal(r.shows, src.find(x => x.m === r.m).shows);
  assert.equal(cf.confidence, config.cashflow_12m.confidence);
  assert.deepEqual(summerCashflow({}).rows, []);
});

test('guide.json → summer: 4 формата, у каждого что/кому/когда, чек-лист до мая; цифр цен в тексте нет', () => {
  assert.ok(summer && Array.isArray(summer.formats));
  assert.deepEqual(summer.formats.map(f => f.id), ['camps', 'parks', 'birthdays', 'intensive']);
  for (const f of summer.formats) {
    for (const k of ['title', 'what', 'who', 'when']) assert.ok(typeof f[k] === 'string' && f[k].length > 10, `${f.id}.${k}`);
    assert.equal(f.when_kind, 'advice', `${f.id}: сроки — совет проекта, не факт`);
    assert.ok(Array.isArray(f.todo) && f.todo.length >= 2, `${f.id}.todo`);
    for (const t of f.todo) assert.ok(['март', 'апрель', 'май'].includes(t.by), `${t.id}.by`);
    // никаких выдуманных цен прямо в тексте: числа с ₽ запрещены, цены — только через price_refs
    assert.ok(!/\d[\d\s]*₽/.test(JSON.stringify(f)), `${f.id}: цена в тексте`);
  }
  const ids = summer.formats.flatMap(f => f.todo.map(t => t.id));
  assert.equal(new Set(ids).size, ids.length, 'id пунктов плана уникальны');
  assert.equal(summer.advice_source.confidence, 'model');
});

test('resolvePriceRef: config с провенансом, допущение ползунка, конкурент с источником; архивные места пропускаются', () => {
  const t = resolvePriceRef({ from: 'config', path: 'ticket.min' }, data);
  assert.equal(t.value, config.ticket.min.value);
  assert.equal(t.confidence, config.ticket.min.confidence);
  assert.ok(t.source_name);

  const p = resolvePriceRef({ from: 'config', path: 'calc.controls.parties.price.def', assumption: true, label: 'x' }, data);
  assert.equal(p.value, config.calc.controls.parties.price.def);
  assert.equal(p.confidence, 'model');
  assert.match(p.source_name, /Допущение проекта/);
  // без флага assumption голое число не выдаётся за цену
  assert.equal(resolvePriceRef({ from: 'config', path: 'calc.controls.parties.price.def' }, data), null);

  const c = resolvePriceRef({ from: 'competitors', group: 'party_venues', id: 'playpanda', label_has: 'Стартовая лига' }, data);
  const src = competitors.party_venues.find(x => x.id === 'playpanda').prices.find(x => x.label.includes('Стартовая лига'));
  assert.equal(c.value, src.value);
  assert.match(c.source_url, /^https:\/\//);

  const archived = { competitors: { party_venues: [{ id: 'old', archived: true, prices: [{ label: 'a', value: 1, source_url: 'https://x' }] }] } };
  assert.equal(resolvePriceRef({ from: 'competitors', group: 'party_venues', id: 'old' }, archived), null);
  assert.equal(resolvePriceRef({ from: 'config', path: 'nope.nope' }, data), null);
  assert.equal(resolvePriceRef({ from: 'elsewhere' }, data), null);
});

test('priceAnchors: у каждого формата есть ориентир из данных или честное «цену уточнить»', () => {
  for (const f of summer.formats) {
    const a = priceAnchors(f, data);
    assert.ok(a.items.length || /уточнить/i.test(a.fallback), f.id);
    for (const it of a.items) {
      assert.ok(Number.isFinite(it.value) && it.value > 0, `${f.id}: значение`);
      assert.ok(it.source_name, `${f.id}: источник`);
    }
  }
  const parks = summer.formats.find(f => f.id === 'parks');
  assert.equal(priceAnchors(parks, data).items.length, 0);
  assert.match(priceAnchors(parks, data).fallback, /уточнить/i);
  assert.match(priceAnchors({ price_refs: [] }, data).fallback, /уточнить/i);
});

test('состояние: чистка мусора, формат по умолчанию, переключение без мутаций', () => {
  const def = sanitizeSummerState(null, summer);
  assert.deepEqual(def.formats, summer.default_formats);
  assert.deepEqual(def.done, {});
  const dirty = sanitizeSummerState({ formats: ['camps', 'camps', 'evil', 5], done: { 'camps-list': true, 'x': true, 'camps-offer': 'yes' } }, summer);
  assert.deepEqual(dirty.formats, ['camps']);
  assert.deepEqual(dirty.done, { 'camps-list': true });
  assert.deepEqual(sanitizeSummerState([1, 2], summer).formats, summer.default_formats);
  assert.deepEqual(sanitizeSummerState({ formats: [] }, summer).formats, [], 'пустой выбор сохраняется');

  const st = { formats: ['camps'], done: {} };
  const on = toggleFormat(st, 'parks');
  assert.deepEqual(on.formats, ['camps', 'parks']);
  assert.deepEqual(st.formats, ['camps'], 'исходное состояние не мутировано');
  assert.deepEqual(toggleFormat(on, 'camps').formats, ['parks']);
});

test('план «до мая»: пункты выбранных форматов по срокам март → апрель → май, прогресс', () => {
  const st = { formats: ['birthdays', 'camps'], done: { 'camps-list': true } };
  const items = buildTodo(summer, st);
  const expected = summer.formats.filter(f => st.formats.includes(f.id)).reduce((n, f) => n + f.todo.length, 0);
  assert.equal(items.length, expected);
  const rank = { 'март': 0, 'апрель': 1, 'май': 2 };
  for (let i = 1; i < items.length; i++) assert.ok(rank[items[i - 1].by] <= rank[items[i].by], 'сроки по порядку');
  assert.equal(items.find(x => x.id === 'camps-list').done, true);
  assert.ok(items.every(x => x.formatTitle));
  const p = todoProgress(items);
  assert.equal(p.done, 1);
  assert.equal(p.total, expected);
  assert.equal(p.pct, Math.round(100 / expected));
  assert.deepEqual(buildTodo(summer, { formats: [], done: {} }), []);
  assert.deepEqual(todoProgress([]), { done: 0, total: 0, pct: 0 });
});
