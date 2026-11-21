/* Тесты «Потенциальных клиентов»: разбор ответа Overpass (фикстура), агрегация, дубли, сохранение старых данных
   при сбое, stale, сборка leads.json и целостность реального data/leads.json. Сеть не используется. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  parseOverpass, elementToObject, dedupeObjects, aggregate, compactObjects, buildPlace, mergeKeepOld, looksBroken,
  buildDoc, totalsOf, leadsStale, buildQuery, normName, distM, PLACES, STALE_AFTER_DAYS
} from '../scripts/fetch-leads.mjs';

const NOW = '2026-11-21T03:00:00.000Z';
const NOW_MS = Date.parse(NOW);

/* Фикстура: узел-школа, контур-школа с center, детсад-relation, ДК, мусорный объект и объект без координат */
const PLAIN = {
  version: 0.6,
  elements: [
    { type: 'node', id: 1, lat: 54.7600, lon: 83.1000, tags: { amenity: 'school', name: 'Школа № 1' } },
    { type: 'way', id: 2, center: { lat: 54.7610, lon: 83.1010 }, tags: { amenity: 'school', name: 'Школа №2' } },
    { type: 'relation', id: 3, center: { lat: 54.7620, lon: 83.1020 }, tags: { amenity: 'kindergarten', name: 'Детский сад «Солнышко»' } },
    { type: 'node', id: 4, lat: 54.7630, lon: 83.1030, tags: { amenity: 'community_centre', name: 'ДК «Родина»' } },
    { type: 'node', id: 5, lat: 54.7640, lon: 83.1040, tags: { amenity: 'arts_centre' } },
    { type: 'node', id: 6, lat: 54.7650, lon: 83.1050, tags: { amenity: 'cafe', name: 'Кафе' } },
    { type: 'node', id: 7, tags: { amenity: 'school', name: 'Без координат' } }
  ]
};

test('parseOverpass: берёт школы, сады, ДК/арт-центры; отбрасывает чужие теги и объекты без координат', () => {
  const r = parseOverpass(PLAIN);
  assert.equal(r.ok, true);
  assert.equal(r.objects.length, 5);
  assert.deepEqual(r.objects.map(o => o.k), ['school', 'school', 'kindergarten', 'culture', 'culture']);
  assert.deepEqual(r.objects[1].ll, [54.761, 83.101]);   // координаты контура — из center
  assert.equal(r.objects[4].n, '');                      // без названия — пустое имя, но объект считается
  assert.deepEqual(r.districts, []);
});

test('parseOverpass: районы — граница админ-уровня 9 открывает группу, школа-relation не принимается за район', () => {
  const doc = {
    elements: [
      { type: 'relation', id: 100, center: { lat: 55, lon: 83 }, tags: { boundary: 'administrative', admin_level: '9', name: 'Ленинский район' } },
      { type: 'node', id: 1, lat: 55.0, lon: 83.0, tags: { amenity: 'school', name: 'Л-1' } },
      { type: 'relation', id: 5, center: { lat: 55.01, lon: 83.01 }, tags: { amenity: 'school', name: 'Л-2' } },
      { type: 'relation', id: 101, center: { lat: 55.1, lon: 83.1 }, tags: { boundary: 'administrative', admin_level: '9', name: 'Советский район' } },
      { type: 'node', id: 2, lat: 55.1, lon: 83.1, tags: { amenity: 'kindergarten', name: 'С-1' } }
    ]
  };
  const r = parseOverpass(doc);
  assert.equal(r.districts.length, 2);
  assert.equal(r.districts[0].name, 'Ленинский район');
  assert.equal(r.districts[0].objects.length, 2);
  assert.equal(r.districts[1].objects.length, 1);
  assert.equal(r.objects.length, 3);
});

test('parseOverpass: remark о таймауте/ошибке — ответ неполон и отвергается; мусор — не Overpass', () => {
  assert.equal(parseOverpass({ elements: [], remark: 'runtime error: Query timed out in "query" at line 3 after 50 seconds.' }).ok, false);
  assert.equal(parseOverpass({ elements: [], remark: 'runtime error: Query ran out of memory' }).ok, false);
  assert.equal(parseOverpass(null).ok, false);
  assert.equal(parseOverpass({ foo: 1 }).ok, false);
  assert.equal(parseOverpass({ elements: [] }).ok, true);
});

test('elementToObject: имя берётся из name → name:ru → official_name', () => {
  const base = { type: 'node', id: 9, lat: 1, lon: 2 };
  assert.equal(elementToObject({ ...base, tags: { amenity: 'school', 'name:ru': 'РУ' } }).n, 'РУ');
  assert.equal(elementToObject({ ...base, tags: { amenity: 'school', official_name: 'ОФ' } }).n, 'ОФ');
  assert.equal(elementToObject({ ...base, tags: { amenity: 'bank' } }), null);
});

test('dedupeObjects: точка и контур одного учреждения — один объект; детсад в здании школы и далёкий тёзка — нет', () => {
  const a = { id: 'n1', k: 'school', n: 'Школа № 7', ll: [55.0, 83.0] };
  const b = { id: 'w1', k: 'school', n: 'школа №7', ll: [55.0005, 83.0005] };       // ~60 м, то же имя
  const c = { id: 'n2', k: 'kindergarten', n: 'Школа № 7', ll: [55.0, 83.0] };      // другая категория
  const d = { id: 'n3', k: 'school', n: 'Школа № 7', ll: [55.2, 83.2] };            // далеко — другая школа
  const e = { id: 'n4', k: 'school', n: '', ll: [56, 84] };
  const f = { id: 'n5', k: 'school', n: '', ll: [56.00005, 84.00005] };             // безымянный дубль ближе 25 м
  const out = dedupeObjects([a, b, c, d, e, f]);
  assert.deepEqual(out.map(o => o.id), ['n1', 'n2', 'n3', 'n4']);
});

test('normName / distM: нормализация имён и расстояние', () => {
  assert.equal(normName('Школа «№ 7», Ёлка'), normName('школа 7 елка'));
  const m = distM([55, 83], [55.001, 83]);
  assert.ok(m > 100 && m < 125);
});

test('aggregate: счётчики категорий, потенциал на выезд = школы + сады (ДК отдельно), центр масс', () => {
  const objs = parseOverpass(PLAIN).objects;
  const a = aggregate(objs);
  assert.equal(a.school, 2);
  assert.equal(a.kindergarten, 1);
  assert.equal(a.culture, 2);
  assert.equal(a.potential, 3);
  assert.equal(a.ll.length, 2);
  assert.deepEqual(aggregate([]), { school: 0, kindergarten: 0, culture: 0, potential: 0, ll: null });
});

test('compactObjects: короткие коды категорий, стабильный порядок и предел', () => {
  const objs = parseOverpass(PLAIN).objects;
  const c = compactObjects(objs);
  assert.deepEqual(c.map(o => o.k).sort(), ['c', 'c', 'd', 's', 's']);
  assert.deepEqual(Object.keys(c[0]).sort(), ['k', 'll', 'n']);
  assert.equal(compactObjects(objs, 2).length, 2);
});

test('buildPlace: запись места со счётчиками, районами и провенансом', () => {
  const def = PLACES[1];
  const parsed = parseOverpass({
    elements: [
      { type: 'relation', id: 100, tags: { boundary: 'administrative', admin_level: '9', name: 'Я-район' } },
      { type: 'node', id: 1, lat: 55, lon: 83, tags: { amenity: 'school', name: 'А' } },
      { type: 'relation', id: 101, tags: { boundary: 'administrative', admin_level: '9', name: 'Б-район' } },
      { type: 'node', id: 2, lat: 55.1, lon: 83.1, tags: { amenity: 'kindergarten', name: 'Б' } }
    ]
  });
  const p = buildPlace(def, parsed, NOW);
  assert.equal(p.id, def.id);
  assert.equal(p.school, 1); assert.equal(p.kindergarten, 1); assert.equal(p.potential, 2);
  assert.equal(p.fetched_at, NOW);
  assert.equal(p.stale, false);
  assert.equal(p.source, 'osm-overpass');
  assert.deepEqual(p.districts.map(d => d.name), ['Б-район', 'Я-район']);  // сортировка по имени
  assert.equal(p.objects.length, 2);
});

test('mergeKeepOld: при сбое прежние числа сохраняются, ставится stale и причина; stale_since не сдвигается', () => {
  const def = PLACES[1];
  const old = buildPlace(def, parseOverpass(PLAIN), '2026-11-14T03:00:00.000Z');
  const a = mergeKeepOld(old, def, 'HTTP 504', NOW);
  assert.equal(a.stale, true);
  assert.equal(a.school, old.school);
  assert.equal(a.fetched_at, old.fetched_at);          // дата получения данных не подменяется
  assert.equal(a.stale_since, NOW);
  assert.match(a.stale_reason, /504/);
  const b = mergeKeepOld(a, def, 'таймаут', '2026-11-28T03:00:00.000Z');
  assert.equal(b.stale_since, NOW);                    // момент первого сбоя
  assert.match(b.stale_reason, /таймаут/);
});

test('mergeKeepOld: нет старых данных — «нет данных», а не нули', () => {
  const p = mergeKeepOld(null, PLACES[2], 'HTTP 502', NOW);
  assert.equal(p.status, 'no_data');
  assert.equal(p.school, undefined);
  assert.equal(p.stale, true);
  assert.ok(Array.isArray(p.coords));
});

test('looksBroken: пустой, ошибочный или резко меньший прежнего ответ — подозрителен', () => {
  const big = { potential: 100, culture: 10 };
  assert.equal(looksBroken(null, { ok: false, objects: [] }), true);
  assert.equal(looksBroken(null, { ok: true, objects: [] }), true);
  const few = { ok: true, objects: [{ k: 'school', n: 'A', ll: [1, 1] }] };
  assert.equal(looksBroken(big, few), true);
  assert.equal(looksBroken(null, few), false);
  assert.equal(looksBroken({ potential: 3, culture: 0 }, few), false);
});

test('buildDoc: частичный сбой — остальные места обновляются, документ не stale, перечислены stale_places', () => {
  const [d0, d1, d2] = PLACES;
  const oldDoc = buildDoc(null, [d0, d1, d2].map(def => ({ def, place: buildPlace(def, parseOverpass(PLAIN), '2026-11-14T03:00:00.000Z') })), { id: 'osm-overpass' }, '2026-11-14T03:00:00.000Z');
  const fresh = parseOverpass({ elements: [{ type: 'node', id: 1, lat: 1, lon: 1, tags: { amenity: 'school', name: 'Новая' } }] });
  const doc = buildDoc(oldDoc, [
    { def: d0, place: buildPlace(d0, fresh, NOW) },
    { def: d1, place: null, error: 'HTTP 504' },
    { def: d2, place: buildPlace(d2, fresh, NOW) }
  ], { id: 'osm-overpass' }, NOW);
  assert.equal(doc.updated_at, NOW);
  assert.equal(doc.stale, false);
  assert.equal(doc.partial, true);
  assert.deepEqual(doc.stale_places, [d1.id]);
  assert.equal(doc.places[0].school, 1);                              // обновилось
  assert.equal(doc.places[1].school, 2);                              // сохранилось прежнее
  assert.equal(doc.places[1].stale, true);
  assert.equal(doc.sources[0].status, 'partial');
  assert.equal(doc.totals.places_stale, 1);
  assert.equal(doc.totals.places_ok, 2);
  assert.equal(doc.totals.school, 1 + 2 + 1);
});

test('buildDoc: полный сбой — stale:true, updated_at остаётся прежним, данные не затираются', () => {
  const def = PLACES[0];
  const oldDoc = buildDoc(null, [{ def, place: buildPlace(def, parseOverpass(PLAIN), '2026-11-14T03:00:00.000Z') }], { id: 'osm-overpass' }, '2026-11-14T03:00:00.000Z');
  const doc = buildDoc(oldDoc, [{ def, place: null, error: 'исчерпан бюджет' }], { id: 'osm-overpass' }, NOW);
  assert.equal(doc.stale, true);
  assert.equal(doc.updated_at, '2026-11-14T03:00:00.000Z');
  assert.match(doc.stale_reason, /бюджет/);
  assert.equal(doc.places[0].school, 2);
  assert.equal(doc.sources[0].status, 'error');
  assert.equal(doc.stale_since, NOW);
});

test('buildDoc: первый запуск при полном сбое — пустые места без чисел и updated_at:null', () => {
  const doc = buildDoc(null, PLACES.map(def => ({ def, place: null, error: 'нет сети' })), { id: 'osm-overpass' }, NOW);
  assert.equal(doc.updated_at, null);
  assert.equal(doc.stale, true);
  assert.equal(doc.totals.potential, 0);
  assert.ok(doc.places.every(p => p.status === 'no_data'));
});

test('totalsOf: районы не складываются повторно, места без чисел пропускаются', () => {
  const t = totalsOf([
    { id: 'a', school: 2, kindergarten: 3, culture: 1, potential: 5, districts: [{ school: 2, kindergarten: 3, culture: 1, potential: 5 }] },
    { id: 'b', status: 'no_data', stale: true }
  ]);
  assert.deepEqual([t.school, t.kindergarten, t.culture, t.potential, t.places_ok, t.places_stale, t.places_total], [2, 3, 1, 5, 1, 1, 2]);
});

test('leadsStale: флаг stale или возраст больше порога; нет документа — устарело', () => {
  assert.equal(leadsStale(null, NOW_MS), true);
  assert.equal(leadsStale({ updated_at: NOW, stale: false }, NOW_MS), false);
  assert.equal(leadsStale({ updated_at: NOW, stale: true }, NOW_MS), true);
  const old = new Date(NOW_MS - (STALE_AFTER_DAYS + 1) * 864e5).toISOString();
  assert.equal(leadsStale({ updated_at: old, stale: false }, NOW_MS), true);
  assert.equal(leadsStale({ updated_at: null }, NOW_MS), true);
});

test('buildQuery: id области = 3600000000 + relation; для города — обход районов', () => {
  const q = buildQuery(PLACES[1]);
  assert.match(q, new RegExp(`area\\(${3600000000 + PLACES[1].relation}\\)`));
  assert.doesNotMatch(q, /foreach/);
  assert.match(buildQuery(PLACES[0]), /foreach\.ds/);
  assert.match(q, /out center tags/);
});

test('PLACES: все города запроса из ТЗ, id уникальны', () => {
  const names = PLACES.map(p => p.name);
  for (const n of ['Новосибирск', 'Бердск', 'Искитим', 'Коченёво', 'Мошково', 'Ордынское']) assert.ok(names.includes(n), n);
  assert.equal(new Set(PLACES.map(p => p.id)).size, PLACES.length);
});

/* Целостность реального файла (если он уже создан скриптом): честные поля и согласованные итоги */
test('data/leads.json: схема, итоги совпадают с суммой мест, у мест с числами есть источник и дата', () => {
  const file = new URL('../data/leads.json', import.meta.url);
  if (!existsSync(file)) return;
  const d = JSON.parse(readFileSync(file, 'utf-8'));
  assert.ok(Array.isArray(d.sources) && d.sources.length);
  assert.ok(Array.isArray(d.places) && d.places.length);
  assert.equal(typeof d.stale, 'boolean');
  let s = 0, k = 0, c = 0;
  for (const p of d.places) {
    assert.ok(p.id && p.name && p.source);
    if (!Number.isFinite(p.school)) { assert.equal(p.status, 'no_data'); continue; }
    assert.ok(p.fetched_at, p.id);
    assert.equal(p.potential, p.school + p.kindergarten, p.id);
    s += p.school; k += p.kindergarten; c += p.culture;
  }
  assert.equal(d.totals.school, s);
  assert.equal(d.totals.kindergarten, k);
  assert.equal(d.totals.culture, c);
});
