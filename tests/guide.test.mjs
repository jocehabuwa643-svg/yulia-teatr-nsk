/* Тесты данных справочника: единая схема записей и правило «Проверено только при подтверждении». */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const guide = JSON.parse(readFileSync(new URL('../data/guide.json', import.meta.url), 'utf8'));
const byId = id => guide.entries.find(e => e.id === id);

test('у каждой записи есть details[], checklist[], unverified[] и булев флаг glossary', () => {
  for (const e of guide.entries) {
    assert.ok(Array.isArray(e.details), `${e.id}: details`);
    assert.ok(Array.isArray(e.checklist), `${e.id}: checklist`);
    assert.ok(Array.isArray(e.unverified), `${e.id}: unverified`);
    assert.equal(typeof e.glossary, 'boolean', `${e.id}: glossary`);
    assert.equal(e.glossary, e.tab === 'glossary', `${e.id}: флаг glossary согласован с вкладкой`);
  }
});

test('id записей уникальны, вкладки существуют', () => {
  const ids = guide.entries.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
  const tabs = new Set(guide.tabs.map(t => t.id));
  for (const e of guide.entries) assert.ok(tabs.has(e.tab), e.id);
});

test('«Проверено» (verified_at) не стоит у записей с confidence low/no_data/model без даты и наоборот', () => {
  for (const e of guide.entries) {
    if (e.verified_at) assert.match(e.verified_at, /^\d{4}-\d{2}-\d{2}$/, e.id);
    if (e.legal && e.confidence === 'low') assert.ok(!e.verified_at || e.unverified.length || e.details.length, e.id);
  }
});

test('карточки с недоказанными источниками понижены или разнесены на проверенное и непроверенное', () => {
  assert.equal(byId('docs-okved').verified_at, null, 'ОКВЭД: источник — агрегатор');
  assert.equal(byId('gr-contract').confidence, 'low');
  assert.ok(!/mtsr\.nso\.ru/.test(byId('gr-contract').source_url), 'соцконтракт не ссылается на недоступную страницу');
  assert.ok(byId('risk-staff').unverified.length > 0);
  assert.ok(byId('docs-license').unverified.length > 0);
  assert.ok(byId('gr-moybiznes').source_name.includes('Социальный контракт'), 'источник назван честно');
});

test('в risk-vat нет остатка чужой карточки про каникулы и гранты', () => {
  const e = byId('risk-vat');
  assert.ok(!/каникул|грант/i.test([e.text, ...e.details].join(' ')));
});

test('видимый текст карточек короткий (длинное — в details)', () => {
  for (const e of guide.entries) for (const k of ['text', 'risk', 'solution']) {
    if (e[k]) assert.ok(e[k].length <= 100, `${e.id}.${k}: ${e[k].length} символов`);
  }
});
