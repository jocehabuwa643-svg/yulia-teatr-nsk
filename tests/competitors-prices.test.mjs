/* Тесты логики цен конкурентов (js/competitor-prices.js) и честности data/competitors.json:
   цены разных типов не смешиваются, «от» сохраняется, ручной ввод помечен, оценка кассы — только по цене за человека,
   у каждой подтверждённой цены есть источник и дата, неподтверждённое в сравнение не входит. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  KINDS, kindOf, kindFromText, priceText, manualPrice, groupPrices, groupSummary, ticketPriceOf,
  observedCompare, perPersonRows, otherKindRows, revenueEstimate
} from '../js/competitor-prices.js';
import { buildCalcConfig } from '../js/calculators/config.js';
import { travelCalc } from '../js/calculators/travel.js';

const J = n => JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url), 'utf-8'));
const D = J('competitors');
const LISTS = ['outbound_performers', 'studio_scene', 'party_venues', 'stationary_benchmarks'];
const ALL = LISTS.flatMap(k => D[k]);
const byId = id => ALL.find(x => x.id === id);
const cfg = buildCalcConfig({ rates: J('rates'), config: J('config'), competitors: D });

/* ---------- Тип цены ---------- */
test('kindOf: явный kind главнее; без него — по единице (час / пакет / абонемент / билет)', () => {
  assert.equal(kindOf({ unit: '₽/билет', kind: 'per_child' }), 'per_child');
  assert.equal(kindOf({ unit: '₽/час' }), 'hour');
  assert.equal(kindOf({ unit: '₽/пакет' }), 'party_package');
  assert.equal(kindOf({ unit: '₽/мес' }), 'subscription');
  assert.equal(kindOf({ unit: '₽/абонемент' }), 'subscription');
  assert.equal(kindOf({ unit: '₽/чел.' }), 'ticket');
  assert.equal(kindOf({ unit: '₽', snippet: 'Купить билет От 300 руб.' }), 'ticket');
});

test('kindFromText: слово сразу после цены точнее; конец фразы обрывает окно', () => {
  const t1 = 'Стоимость 350 ₽ с ребёнка';
  assert.equal(kindFromText(t1, t1.indexOf('350')), 'per_child');
  const t2 = 'Аренда зала 3000 ₽ в час';
  assert.equal(kindFromText(t2, t2.indexOf('3000')), 'hour');
  const t3 = 'Билет на спектакль 400 ₽. Аренда зала';
  assert.equal(kindFromText(t3, t3.indexOf('400')), 'ticket');
  assert.equal(kindFromText('просто текст', 3), 'other');
});

/* ---------- Форматирование ---------- */
test('priceText: «от» не теряется, нет значения — «нет данных», а не ноль', () => {
  assert.match(priceText({ value: 500, qualifier: 'от', unit: '₽/билет' }), /^от 500 ₽\/билет$/);
  assert.match(priceText({ value: 1500, unit: '₽/мес' }), /^1\s500 ₽\/мес$/);
  assert.equal(priceText({ value: null }), 'нет данных');
  assert.equal(priceText(null), 'нет данных');
});

/* ---------- Ручной ввод ---------- */
test('manualPrice: старая запись без kind — билет; запись помечена «введено вами»', () => {
  const m = manualPrice({ value: 420, date: '2026-11-20', url: 'https://example.ru' });
  assert.equal(m.kind, 'ticket');
  assert.equal(m.manual, true);
  assert.equal(m.confidence, 'manual');
  assert.equal(m.label, 'введено вами');
  assert.equal(manualPrice({ value: 'abc' }), null);
  assert.equal(manualPrice({ value: 3000, kind: 'hour' }).unit, '₽/час');
  assert.equal(manualPrice({ value: 1, url: 'javascript:alert(1)' }).source_url, null);
});

test('groupPrices: ручная цена — первой в своей группе; прочие цены карточки не теряются', () => {
  const c = byId('obl-kukol');
  const g = groupPrices(c, { value: 450, date: '2026-11-21', kind: 'ticket' });
  assert.equal(g.length, 1);
  assert.equal(g[0].kind, 'ticket');
  assert.equal(g[0].items[0].manual, true);
  assert.equal(g[0].items.length, 1 + c.prices.length);
  assert.equal(groupSummary(g[0]).manual, true);
});

/* ---------- Главный «непонятный подсчёт»: смешение типов ---------- */
test('PlayPanda: час, пакеты и предоплата — разные группы; цены билета нет; кассу по 5 000 ₽/час не считаем', () => {
  const c = byId('playpanda');
  const kinds = groupPrices(c).map(g => g.kind);
  assert.deepEqual(kinds, ['party_package', 'hour', 'other']);
  const pk = groupPrices(c).find(g => g.kind === 'party_package');
  assert.match(groupSummary(pk).text, /^21\s000–29\s500 ₽\/пакет$/);
  assert.equal(groupSummary(pk).count, 4);
  const tp = ticketPriceOf(c, null);
  assert.equal(tp.value, null);
  const rev = revenueEstimate(c, cfg, null, travelCalc);
  assert.equal(rev.available, false);
  assert.ok(!perPersonRows([c]).ticket.length && !perPersonRows([c]).per_child.length);
});

test('ticketPriceOf: ручная цена другого типа (час) ценой билета не считается', () => {
  const c = byId('planetary-sugit');
  assert.equal(ticketPriceOf(c, { value: 9000, kind: 'hour', date: '2026-11-21' }).value, 300);
  assert.equal(ticketPriceOf(c, { value: 410, date: '2026-11-21' }).value, 410);
  assert.equal(ticketPriceOf(c, { value: 410, date: '2026-11-21' }).source, 'введено вами');
});

test('ticketPriceOf: берётся цена для диаграммы (детский билет), дата — из самой цены', () => {
  const tp = ticketPriceOf(byId('planetary-bolshoy'), null);
  assert.equal(tp.value, 322);
  assert.equal(tp.date, '2026-11-21');
  assert.match(tp.url, /^https:\/\/www\.nebo-nsk\.ru\//);
});

test('groupSummary: если минимальная цена «от» — диапазон тоже «от»', () => {
  const g = { kind: 'ticket', items: [{ value: 350, qualifier: 'от', unit: '₽/билет' }, { value: 400, qualifier: 'от', unit: '₽/билет' }] };
  assert.match(groupSummary(g).text, /^от 350–400 ₽\/билет$/);
});

/* ---------- Автонаблюдение сайта ---------- */
test('observedCompare: сравнение только с ценами того же типа', () => {
  const c = { prices: [{ value: 5000, unit: '₽/час', kind: 'hour' }], observed: { price: { value: 300, kind: 'ticket', qualifier: 'от' } } };
  const r = observedCompare(c, null);
  assert.equal(r.kind, 'ticket');
  assert.equal(r.differs, false);       // в карточке нет билета — сравнивать не с чем
  assert.equal(r.comparable, false);
  const c2 = { prices: [{ value: 300, unit: '₽/билет', kind: 'ticket' }], observed: { price: { value: 350, kind: 'ticket' } } };
  assert.equal(observedCompare(c2, null).differs, true);
  const c3 = { prices: [{ value: 300, unit: '₽/билет', kind: 'ticket' }], observed: { price: { value: 300, kind: 'ticket' } } };
  assert.equal(observedCompare(c3, null).differs, false);
  assert.equal(observedCompare({ prices: [] }, null), null);
});

test('СГУГиТ: «от 300 ₽» с сайта — это билет на лекцию и совпадает с карточкой (а не «цена выезда»)', () => {
  const c = byId('planetary-sugit');
  const r = observedCompare(c, null);
  assert.equal(r.kind, 'ticket');
  assert.equal(r.differs, false);
  assert.ok(c.prices.every(p => !/выезд/i.test(p.label)), 'ни одна цена не подписана как цена выезда');
});

/* ---------- Диаграмма и таблицы ---------- */
test('perPersonRows: только цены за человека; по одной-две строке на конкурента; без цены — в списке «нет данных»', () => {
  const r = perPersonRows(ALL, {});
  const names = [...r.ticket, ...r.per_child].map(x => x.id);
  assert.ok(!names.includes('playpanda'));
  assert.ok(!names.some(id => byId(id).type === 'studio'));
  assert.ok(r.ticket.every(x => Number.isFinite(x.value) && x.value > 0));
  assert.ok(r.none.includes('«Арт-Авеню»'));
  const sugit = r.ticket.filter(x => x.id === 'planetary-sugit');
  assert.deepEqual(sugit.map(x => x.value), [300]);
  // ручной ввод «выезд за ребёнка» уходит в свою группу и помечен
  const m = perPersonRows(ALL, { 'art-avenue': { value: 380, date: '2026-11-21', kind: 'per_child' } });
  assert.deepEqual(m.per_child.map(x => [x.id, x.value, x.manual]), [['art-avenue', 380, true]]);
});

test('otherKindRows: пакеты, часы и абонементы — отдельно; ориентиры плана помечены model', () => {
  const o = otherKindRows(ALL, {});
  assert.ok(o.party_package.some(x => x.id === 'playpanda'));
  assert.ok(o.hour.some(x => x.id === 'playpanda' && /5\s000 ₽\/час/.test(x.text)));
  assert.ok(o.subscription.length > 0 && o.subscription.every(x => x.confidence === 'model'));
});

/* ---------- Оценка кассы по модели ---------- */
test('revenueEstimate: касса = зрители × цена; помечено как «от», если цена «от»', () => {
  const c = { prices: [{ value: 350, unit: '₽/билет', kind: 'ticket', qualifier: 'от', chart: true }] };
  const r = revenueEstimate(c, cfg, null, travelCalc);
  assert.equal(r.available, true);
  assert.equal(r.fromPrice, true);
  assert.deepEqual(r.rows.map(x => x.gross), [30 * 350, 60 * 350, 100 * 350]);
  assert.ok(r.rows.every(x => Number.isFinite(x.profit) && x.be >= 1));
  assert.equal(revenueEstimate(c, null, null, travelCalc).available, false);
});

/* ---------- Честность данных ---------- */
test('data: у каждой цены валидный тип; подтверждённые — с источником и датой; «от» только «от»/«до»', () => {
  for (const x of ALL) {
    for (const p of x.prices || []) {
      assert.ok(KINDS[p.kind], `${x.id}: kind ${p.kind}`);
      assert.ok(Number.isFinite(p.value) && p.value > 0, `${x.id}: value`);
      assert.ok(p.fetched_at && p.confidence, `${x.id}: дата и надёжность`);
      if (p.confidence !== 'model') assert.ok(/^https:\/\//.test(p.source_url || ''), `${x.id}: ссылка у «${p.label}»`);
      assert.ok(p.qualifier == null || ['от', 'до'].includes(p.qualifier), `${x.id}: qualifier`);
      if (p.chart) assert.ok(['ticket', 'per_child'].includes(p.kind), `${x.id}: в диаграмму «за человека» попал тип ${p.kind}`);
    }
  }
});

test('data: неподтверждённые значения вынесены из prices и снабжены причиной', () => {
  for (const x of ALL) {
    for (const p of x.unconfirmed_prices || []) {
      assert.ok(p.reason && p.reason.length > 10, x.id);
      assert.ok(!(x.prices || []).some(q => q.value === p.value && q.label === p.label), `${x.id}: дубль в prices`);
    }
  }
  assert.equal(byId('prosto-fizika').prices.length, 0);
  assert.equal(byId('ognenny-cvetok').prices.length, 0);
});

test('data: кейсы «что организуют» — с текстом, ссылкой и датой проверки', () => {
  const withCases = ALL.filter(x => Array.isArray(x.cases) && x.cases.length);
  assert.ok(withCases.length >= 6);
  for (const x of withCases) {
    for (const k of x.cases) {
      assert.ok(k.text && k.text.length > 5, x.id);
      assert.ok(/^https:\/\//.test(k.source_url), x.id);
      assert.match(k.fetched_at, /^\d{4}-\d{2}-\d{2}$/, x.id);
      if (k.date) assert.match(k.date, /^\d{4}-\d{2}-\d{2}$/, x.id);
    }
  }
});

test('data: верхнеуровневая дата сверки совпадает с самой свежей verified_at', () => {
  const v = ALL.map(x => x.verified_at).filter(Boolean).sort();
  assert.ok(v.length > 0);
  assert.equal(D.fetched_at, v[v.length - 1]);
});
