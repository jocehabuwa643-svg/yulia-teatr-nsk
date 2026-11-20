/* tests/calendar.test.mjs — календарь от текущей даты: подмены 2026-12-15, 2027-05-10, 2027-06-20 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { monthWindow, windowTitle, holidaysForYear, holidaysInMonth, factorFor } from '../js/calendar.js';

const seasonality = JSON.parse(readFileSync(new URL('../data/seasonality.json', import.meta.url), 'utf-8'));

test('2026-12-15: окно от октября 2026, текущий — декабрь 2026', () => {
  const win = monthWindow(new Date('2026-12-15T10:00:00'));
  assert.equal(win.length, 12);
  assert.equal(win[0].name, 'Октябрь');
  assert.equal(win[0].y, 2026);
  const cur = win.find(w => w.current);
  assert.equal(cur.name, 'Декабрь');
  assert.equal(cur.y, 2026);
  assert.equal(win[win.length - 1].name, 'Сентябрь');
  assert.equal(win[win.length - 1].y, 2027);
  assert.match(windowTitle(win), /Декабрь 2026 — Сентябрь 2027/);
  assert.equal(win.filter(w => w.future).length, 9);
});

test('2027-05-10: текущий — май 2027, история с марта; заголовок идёт от текущего месяца (как в тесте 2026-12-15)', () => {
  const win = monthWindow(new Date('2027-05-10T10:00:00'));
  const cur = win.find(w => w.current);
  assert.equal(cur.name, 'Май');
  assert.equal(cur.y, 2027);
  assert.equal(win[0].name, 'Март');
  assert.match(windowTitle(win), /Май 2027 — Февраль 2028/);
});

test('2027-06-20: текущий — июнь 2027, в окне летний лагерный сезон', () => {
  const win = monthWindow(new Date('2027-06-20T10:00:00'));
  const cur = win.find(w => w.current);
  assert.equal(cur.name, 'Июнь');
  assert.equal(factorFor(seasonality, cur.m), 1.25); // июнь — максимум модели
  assert.match(windowTitle(win), /Июнь 2027 — Март 2028/);
});

test('каникулы: 2026 загружен, 2027 — явная пометка «не загружен»', () => {
  const h26 = holidaysForYear(seasonality, 2026);
  assert.equal(h26.loaded, true);
  assert.ok(h26.items.length >= 3);
  const h27 = holidaysForYear(seasonality, 2027);
  assert.equal(h27.loaded, false);
  assert.match(h27.note, /не загружен/);
  const h99 = holidaysForYear(seasonality, 2031);
  assert.equal(h99.loaded, false);
});

test('пересечение каникул с месяцем: зимние накрывают декабрь и январь', () => {
  const h = holidaysForYear(seasonality, 2026);
  const dec = holidaysInMonth(h, 2026, 12);
  assert.ok(dec.some(x => x.name.startsWith('Зимние')));
  const jul = holidaysInMonth(h, 2026, 7);
  assert.ok(jul.some(x => x.name === 'Летние'));
  assert.equal(holidaysInMonth(h, 2026, 2).length, 0); // февраль без каникул
});

test('коэффициенты: декабрь — максимум, январь — минимум, все 12 на месте', () => {
  const fs = seasonality.months.map(m => factorFor(seasonality, m.m));
  assert.equal(fs.filter(f => f != null).length, 12);
  assert.equal(Math.max(...fs), factorFor(seasonality, 12));
  assert.equal(Math.min(...fs), factorFor(seasonality, 1));
});
