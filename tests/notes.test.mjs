/* tests/notes.test.mjs — заметки: чистая логика без DOM (normalize/sort/search/backup) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNote, sortNotes, searchNotes, nextId, backupDue } from '../js/notes.js';

test('normalizeNote: обрезает длинный текст, фиксирует типы, даёт id', () => {
  const n = normalizeNote({ text: 'а'.repeat(6000), pinned: 1, section: 'calc' }, 2);
  assert.equal(n.text.length, 5000);
  assert.equal(n.pinned, true);
  assert.equal(n.section, 'calc');
  const empty = normalizeNote(null, 4);
  assert.equal(empty.id, 5);
  assert.equal(empty.text, '');
});

test('sortNotes: закреплённые сверху, затем по свежести', () => {
  const list = [
    { id: 1, pinned: false, updated: 300 },
    { id: 2, pinned: true, updated: 100 },
    { id: 3, pinned: false, updated: 500 },
    { id: 4, pinned: true, updated: 400 }
  ];
  assert.deepEqual(sortNotes(list).map(n => n.id), [4, 2, 3, 1]);
  assert.equal(list[0].id, 1); // исходный массив не мутирован
});

test('searchNotes: регистронезависимо, пустой запрос — весь список', () => {
  const list = [
    { id: 1, text: 'Позвонить в ДК Горького' },
    { id: 2, text: 'проверить реквизит' },
    { id: 3, text: 'Кому позвонить завтра' }
  ];
  assert.deepEqual(searchNotes(list, 'позвонить').map(n => n.id), [1, 3]);
  assert.deepEqual(searchNotes(list, '').length, 3);
  assert.deepEqual(searchNotes(list, '   ').length, 3);
  assert.deepEqual(searchNotes(list, 'неттакого'), []);
});

test('nextId: max+1, для пустого списка — 1', () => {
  assert.equal(nextId([]), 1);
  assert.equal(nextId([{ id: 3 }, { id: 7 }]), 8);
});

test('backupDue: никогда не экспортировала → пора; недавно → не пора', () => {
  const now = Date.now();
  assert.equal(backupDue(null, now), true);
  assert.equal(backupDue(now - 13 * 864e5, now), false);
  assert.equal(backupDue(now - 14 * 864e5, now), true);
  assert.equal(backupDue(now - 40 * 864e5, now), true);
});
