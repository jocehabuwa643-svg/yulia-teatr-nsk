/* Тесты мини-CRM площадок (js/crm.js): стабильные ключи объектов, статусы и даты, счётчики прогресса,
   фильтры списка, шаблон первого сообщения из data/config.json, экспорт/импорт со слиянием и понятными ошибками. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STATUSES, normName, objectKey, emptyDb, normalizeDb, sanitizeRecord, recordOf, statusOf, setStatus, setNote, setDate,
  todayISO, countStatuses, progressLine, progressShares, filterRows, rowsOf, fillTemplate, exportPayload, exportFileName,
  parseImport, mergeImport, importSummary, NOTE_MAX
} from '../js/crm.js';
import { validObjects } from '../js/clients-model.js';
import { buildCalcConfig } from '../js/calculators/config.js';

const leads = JSON.parse(readFileSync(new URL('../data/leads.json', import.meta.url), 'utf8'));
const config = JSON.parse(readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
const rates = JSON.parse(readFileSync(new URL('../data/rates.json', import.meta.url), 'utf8'));
const competitors = JSON.parse(readFileSync(new URL('../data/competitors.json', import.meta.url), 'utf8'));

const T0 = Date.UTC(2026, 10, 24, 5, 0, 0);
const meta = { name: 'Детский сад № 5', k: 'd', place: 'novosibirsk' };

/* ---------- Ключи ---------- */
test('objectKey: уникален для всех объектов leads.json и не зависит от порядка объектов', () => {
  const seen = new Set();
  let n = 0;
  for (const p of leads.places) {
    for (const o of validObjects(p)) { seen.add(objectKey(o)); n += 1; }
  }
  assert.equal(seen.size, n, 'ключи объектов должны быть уникальными');
  const p = leads.places[0];
  const a = rowsOf(validObjects(p)).map(r => r.key).sort();
  const b = rowsOf(validObjects({ objects: [...p.objects].reverse() })).map(r => r.key).sort();
  assert.deepEqual(a, b);
});

test('objectKey: переживает мелкие правки названия и сдвиг точки < 5 м; OSM-id главнее', () => {
  const o = { n: 'Детский сад «Солнышко» № 12', k: 'd', ll: [55.030112, 82.920041] };
  assert.equal(objectKey(o), objectKey({ ...o, n: '  детский  сад "Солнышко" №12 '.replace('№12', '№ 12') }));
  assert.equal(objectKey(o), objectKey({ ...o, ll: [55.030131, 82.920029] }));
  assert.notEqual(objectKey(o), objectKey({ ...o, k: 's' }));
  assert.equal(objectKey({ ...o, osm: 'way/123' }), 'osm:way/123');
  assert.equal(objectKey({ ...o, id: 'n55' }), 'osm:n55');
  assert.equal(normName('Ёлочка — «ДК»'), 'елочка дк');
  assert.equal(objectKey(null), '');
});

/* ---------- Статусы, заметка, дата ---------- */
test('setStatus: дата по умолчанию — сегодня; исходная база не меняется; «Не писала» сохраняет запись', () => {
  const db0 = emptyDb();
  const db1 = setStatus(db0, 'k1', 'sent', '2026-11-24', T0, meta);
  assert.deepEqual(db0.items, {});
  const r = recordOf(db1, 'k1');
  assert.equal(r.s, 'sent'); assert.equal(r.date, '2026-11-24'); assert.equal(r.name, 'Детский сад № 5'); assert.equal(r.k, 'd');
  const db2 = setDate(db1, 'k1', '2026-11-20', T0 + 1000);
  assert.equal(recordOf(db2, 'k1').date, '2026-11-20');
  const db3 = setStatus(db2, 'k1', 'none', '2026-11-25', T0 + 2000);
  assert.equal(statusOf(db3, 'k1'), 'none');
  assert.equal(recordOf(db3, 'k1').date, '2026-11-20', '«Не писала» не трогает дату');
  assert.ok(db3.items.k1.upd > db2.items.k1.upd);
  assert.equal(setStatus(db3, 'k1', 'bogus', '2026-11-25', T0), db3, 'неизвестный статус игнорируется');
});

test('setNote / setDate: заметка обрезается до 500 символов, некорректная дата — пусто', () => {
  let db = setNote(emptyDb(), 'k', 'x'.repeat(900), T0);
  assert.equal(recordOf(db, 'k').note.length, NOTE_MAX);
  db = setDate(db, 'k', '2026-02-30', T0 + 1);
  assert.equal(recordOf(db, 'k').date, '');
  db = setDate(db, 'k', '2026-02-28', T0 + 2);
  assert.equal(recordOf(db, 'k').date, '2026-02-28');
  assert.equal(todayISO(new Date(2026, 10, 4)), '2026-11-04');
});

test('upd растёт монотонно даже при одинаковом времени устройства', () => {
  let db = setNote(emptyDb(), 'k', 'a', T0);
  const u1 = db.items.k.upd;
  db = setNote(db, 'k', 'b', T0);
  assert.ok(db.items.k.upd > u1);
});

test('normalizeDb: битые данные localStorage — пустая база; битые записи отбрасываются по одной', () => {
  for (const raw of [null, 'x', [], { items: 5 }]) assert.deepEqual(normalizeDb(raw).items, {});
  const db = normalizeDb({ v: 1, items: { ok: { s: 'deal', upd: T0, note: 'n' }, bad: { s: 'zzz', upd: T0 }, noupd: { s: 'sent' } } });
  assert.deepEqual(Object.keys(db.items), ['ok']);
  assert.equal(sanitizeRecord({ s: 'talks', upd: T0, date: '24.11.2026' }).date, '');
});

/* ---------- Счётчики и фильтры ---------- */
test('countStatuses / progressLine / progressShares: только объекты текущего места', () => {
  let db = emptyDb();
  db = setStatus(db, 'a', 'sent', '2026-11-24', T0);
  db = setStatus(db, 'b', 'talks', '2026-11-24', T0);
  db = setStatus(db, 'c', 'deal', '2026-11-24', T0);
  db = setStatus(db, 'other-place', 'deal', '2026-11-24', T0);
  const c = countStatuses(db, ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(c, { none: 2, sent: 1, talks: 1, deal: 1, refused: 0, total: 5, contacted: 3 });
  assert.equal(progressLine(c), 'Написала 1 · Переговоры 1 · Договорились 1 из 5');
  assert.equal(progressLine(countStatuses(emptyDb(), ['a', 'b'])), 'Пока никому не писала · 2 объекта в списке');
  assert.equal(progressLine(countStatuses(db, [])), 'Нет объектов');
  const sh = progressShares(c);
  assert.equal(sh.deal, 0.2);
  assert.ok(Object.values(sh).reduce((a, b) => a + b, 0) <= 1);
});

test('filterRows: поиск по названию и заметке, фильтр по типу и статусу, порядок «в работе — сверху»', () => {
  const rows = [
    { key: 'k1', n: 'Школа № 1', k: 's' }, { key: 'k2', n: 'Детский сад «Ёлочка»', k: 'd' },
    { key: 'k3', n: '', k: 'd' }, { key: 'k4', n: 'ДК Энергия', k: 'c' }
  ];
  let db = setStatus(emptyDb(), 'k4', 'talks', '2026-11-24', T0);
  db = setNote(db, 'k3', 'это сад «Радуга», вход со двора', T0);
  assert.deepEqual(filterRows(rows, db, {}).map(r => r.key), ['k4', 'k2', 'k1', 'k3']);
  assert.deepEqual(filterRows(rows, db, { kind: 'd' }).map(r => r.key), ['k2', 'k3']);
  assert.deepEqual(filterRows(rows, db, { status: 'talks' }).map(r => r.key), ['k4']);
  assert.deepEqual(filterRows(rows, db, { status: 'none', kind: 's' }).map(r => r.key), ['k1']);
  assert.deepEqual(filterRows(rows, db, { q: 'елочка' }).map(r => r.key), ['k2']);
  assert.deepEqual(filterRows(rows, db, { q: 'радуга' }).map(r => r.key), ['k3'], 'поиск по заметке (своё название безымянного)');
});

/* ---------- Шаблон ---------- */
test('шаблон из config.json: лист crm_templates с провенансом; подставляет название, имя и формат', () => {
  const leaf = config.crm_templates;
  assert.equal(leaf.confidence, 'model');
  assert.match(leaf.source_name, /Шаблон проекта/);
  const cfg = buildCalcConfig({ rates, config, competitors });
  const tpl = cfg.crm_templates;
  const kg = fillTemplate(tpl, { n: 'Детский сад № 5', k: 'd' });
  assert.match(kg, /^Заведующей · Детский сад № 5\n\n/);
  assert.match(kg, /Меня зовут Юлия/);
  assert.match(kg, /выездным интерактивным спектаклем/);
  assert.doesNotMatch(kg, /\{|\}/);
  assert.match(fillTemplate(tpl, { n: 'Лицей № 9', k: 's' }), /^Директору \/ заместителю директора по воспитательной работе · Лицей № 9/);
  assert.match(fillTemplate(tpl, { n: 'ДК Энергия', k: 'c' }), /^Директору · ДК Энергия/);
  assert.match(fillTemplate(tpl, { n: '', k: 'd' }), /^Заведующей детским садом\n\n/, 'без названия — общее обращение');
  assert.match(fillTemplate(tpl, { n: '', k: 'c' }), /^Директору дома культуры/);
  for (const k of ['kindergarten', 'school', 'culture']) assert.ok(tpl[k].body.length < 700, `${k}: шаблон короткий`);
  assert.equal(fillTemplate(null, { n: 'x', k: 'd' }), null);
  assert.equal(fillTemplate({ sender: 'Юлия' }, { n: 'x', k: 'd' }), null);
});

/* ---------- Экспорт / импорт ---------- */
test('экспорт → импорт в пустую базу: всё переносится без потерь', () => {
  let db = setStatus(emptyDb(), 'a', 'deal', '2026-11-24', T0, meta);
  db = setNote(db, 'a', 'созвон в пятницу', T0 + 5);
  db = setStatus(db, 'b', 'refused', '2026-11-23', T0);
  const file = exportPayload(db, T0);
  assert.equal(file.app, 'yulia-teatr-nsk'); assert.equal(file.kind, 'crm'); assert.equal(file.schema, 1);
  assert.equal(file.count, 2); assert.equal(file.exported_at, new Date(T0).toISOString());
  const p = parseImport(JSON.stringify(file));
  assert.equal(p.ok, true); assert.equal(p.skipped, 0);
  const r = mergeImport(emptyDb(), p.items);
  assert.deepEqual([r.added, r.updated, r.same], [2, 0, 0]);
  assert.deepEqual(r.db.items, db.items);
  assert.equal(exportFileName('2026-11-24'), 'yulia-crm-2026-11-24.json');
});

test('слияние: более поздняя правка побеждает, при равенстве — своя запись', () => {
  const mine = normalizeDb({ items: {
    a: { s: 'sent', upd: 100, note: 'телефон' },
    b: { s: 'talks', upd: 300, note: 'моё новее' },
    c: { s: 'deal', upd: 200, note: 'одинаково' }
  } });
  const theirs = [
    { key: 'a', rec: sanitizeRecord({ s: 'talks', upd: 200, note: 'ноутбук новее' }) },
    { key: 'b', rec: sanitizeRecord({ s: 'refused', upd: 250 }) },
    { key: 'c', rec: sanitizeRecord({ s: 'refused', upd: 200 }) },
    { key: 'd', rec: sanitizeRecord({ s: 'sent', upd: 50 }) }
  ];
  const r = mergeImport(mine, theirs);
  assert.deepEqual([r.added, r.updated, r.same], [1, 1, 2]);
  assert.equal(r.db.items.a.note, 'ноутбук новее');
  assert.equal(r.db.items.b.s, 'talks');
  assert.equal(r.db.items.c.s, 'deal');
  assert.equal(r.db.items.d.s, 'sent');
  assert.equal(mine.items.a.s, 'sent', 'исходная база не меняется');
  assert.equal(importSummary(r), 'Добавлено 1, обновлено 1, без изменений 2.');
  assert.equal(importSummary({ added: 0, updated: 0, same: 0 }, 3), 'Добавлено 0, обновлено 0, пропущено битых 3.');
});

test('импорт: понятные ошибки для пустого, битого, чужого и более нового файла; битые записи пропускаются', () => {
  assert.match(parseImport('').error, /пустой/);
  assert.match(parseImport('{oops').error, /не JSON/);
  assert.match(parseImport('[1,2]').error, /нет базы/);
  assert.match(parseImport(JSON.stringify({ hello: 1 })).error, /не файл базы площадок/);
  assert.match(parseImport(JSON.stringify({ __app: 'yulia-teatr-nsk', notes: [] })).error, /резервная копия/);
  assert.match(parseImport(JSON.stringify({ app: 'yulia-teatr-nsk', kind: 'crm', schema: 9, items: [] })).error, /более новой версии/);
  assert.match(parseImport(JSON.stringify({ app: 'yulia-teatr-nsk', kind: 'crm', items: [] })).error, /версия схемы/);
  assert.match(parseImport(JSON.stringify({ app: 'yulia-teatr-nsk', kind: 'crm', schema: 1, items: {} })).error, /нет списка/);
  assert.match(parseImport(JSON.stringify({ app: 'yulia-teatr-nsk', kind: 'crm', schema: 1, items: [{ key: 'x', s: '??', upd: 1 }] })).error, /повреждён/);
  const ok = parseImport('﻿' + JSON.stringify({ app: 'yulia-teatr-nsk', kind: 'crm', schema: 1, items: [
    { key: 'x', s: 'sent', upd: T0, note: 'ok' }, { key: '', s: 'sent', upd: T0 }, { key: 'y', s: 'sent' }, null
  ] }));
  assert.equal(ok.ok, true); assert.equal(ok.items.length, 1); assert.equal(ok.skipped, 3);
  const empty = parseImport(JSON.stringify({ app: 'yulia-teatr-nsk', kind: 'crm', schema: 1, items: [] }));
  assert.equal(empty.ok, true); assert.equal(empty.items.length, 0);
});

test('статусы: пять фиксированных, в порядке работы', () => {
  assert.deepEqual(STATUSES.map(s => s.label), ['Не писала', 'Написала', 'Переговоры', 'Договорились', 'Отказ']);
});

test('импорт: правка «из будущего» (сбитые часы) урезается до текущего времени и не побеждает навсегда', () => {
  const now = T0;
  const file = JSON.stringify({ app: 'yulia-teatr-nsk', kind: 'crm', schema: 1, items: [
    { key: 'a', s: 'deal', upd: now + 400 * 24 * 3600 * 1000 },
    { key: 'b', s: 'sent', upd: now + 3600 * 1000 }
  ] });
  const p = parseImport(file, now);
  assert.equal(p.ok, true);
  assert.equal(p.items.find(i => i.key === 'a').rec.upd, now);
  assert.equal(p.items.find(i => i.key === 'b').rec.upd, now + 3600 * 1000);   // разница часов в пределах суток — как есть
});

/* ---------- Приёмка: кавычки в названиях из OSM ---------- */
test('шаблон: прямые кавычки из названия OSM заменяются на «ёлочки» (вложенные — „лапки“)', async () => {
  const { ruQuotes } = await import('../js/crm.js');
  assert.equal(ruQuotes('МБДОУ "Солнышко"'), 'МБДОУ «Солнышко»');
  assert.equal(ruQuotes('Школа "Лицей "Мир""'), 'Школа «Лицей „Мир“»');
  assert.equal(ruQuotes('Без кавычек'), 'Без кавычек');
  const tpl = buildCalcConfig({ rates, config, competitors }).crm_templates;
  const kg = fillTemplate(tpl, { n: 'Детский сад "Солнышко"', k: 'd' });
  assert.match(kg, /^Заведующей · Детский сад «Солнышко»\n\n/);
  assert.doesNotMatch(kg, /"/);
});
