/* Приёмка, раунд 6: цены шоу Николя (выезд за программу), запасные зеркала Overpass, согласованность источников карточек */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KINDS, kindOf, perPersonRows, otherKindRows, groupPrices, PER_PERSON } from '../js/competitor-prices.js';
import { DEFAULT_ENDPOINTS } from '../scripts/fetch-leads.mjs';

const D = JSON.parse(readFileSync(new URL('../data/competitors.json', import.meta.url), 'utf-8'));
const ALL = ['outbound_performers', 'stationary_benchmarks', 'studio_scene', 'party_venues'].flatMap(k => D[k] || []);
const byId = id => ALL.find(x => x.id === id);

test('Николя: опубликованные цены шоу — тип «выезд за программу», со ссылкой на страницу шоу и датой', () => {
  const nik = byId('nikolya');
  const pk = nik.prices.filter(p => p.kind === 'outbound_package');
  assert.ok(pk.length >= 3);
  assert.ok(pk.some(p => p.value === 9000 && /Школа экспериментов/.test(p.label)), 'сумма на кнопке «Школы экспериментов»');
  assert.ok(pk.some(p => p.value === 8000 && /45 мин/.test(p.label)), 'базовое шоу 45 мин');
  for (const p of nik.prices) {
    assert.match(p.source_url, /^https:\/\/nsk\.nik-show\.ru\/show\/showing\//);
    assert.match(p.fetched_at, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(p.chart, false, 'в диаграмму «за человека» не попадает');
  }
  assert.ok(!/не опубликованы/.test(nik.price_note), 'ложное «цен нет» убрано');
});

test('Николя: цена за программу не попадает в сравнение «за человека», но видна среди других типов', () => {
  assert.ok(!PER_PERSON.has('outbound_package'));
  const pp = perPersonRows(ALL, {});
  assert.ok(![...pp.ticket, ...pp.per_child].some(r => r.id === 'nikolya'));
  assert.ok(pp.none.includes(byId('nikolya').name));
  const other = otherKindRows(ALL, {});
  assert.ok(other.outbound_package.some(r => r.id === 'nikolya' && /8\s000–12\s000/.test(r.text)));
  assert.ok(KINDS.outbound_package.label);
  assert.equal(kindOf({ unit: '₽/шоу' }), 'outbound_package');
  assert.deepEqual(groupPrices(byId('nikolya'), null).map(g => g.kind), ['outbound_package', 'other']);
});

test('Николя: в списке шоу есть «Все включено»', () => {
  assert.ok(byId('nikolya').cases.some(c => /Все включено/.test(c.text)));
});

test('PlayPanda: пояснение к пакетам не утверждает «все по 3 ч» — «Большой матч» 4 ч', () => {
  assert.match(byId('playpanda').price_note, /Большой матч[^.]*4 ч/);
});

test('Карточки, сверенные с официальным сайтом, подписаны официальным источником, а не срезом исследования', () => {
  for (const id of ['playpanda', 'nikolya', 'planetary-sugit']) {
    const c = byId(id);
    assert.ok(!/Исследование рынка/.test(c.source_name), id);
    assert.ok(c.fetched_at >= '2026-11-21', id);
  }
});

test('fetch-leads: по умолчанию несколько независимых эндпоинтов Overpass, без закрытого robots.txt overpass-api.de', () => {
  const hosts = new Set(DEFAULT_ENDPOINTS.map(u => new URL(u).host));
  assert.ok(hosts.size >= 3);
  assert.ok(hosts.has('maps.mail.ru'));
  assert.ok(!hosts.has('overpass-api.de'));
  assert.ok(DEFAULT_ENDPOINTS.every(u => /^https:\/\//.test(u)));
});
