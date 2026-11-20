/* tests/calendar-status.test.mjs — статус каникул относительно дня открытия (подмена даты) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { holidayKey, holidayStatus, holidayEndedInMonth, monthWindow } from '../js/calendar.js';

const seasonality = JSON.parse(readFileSync(new URL('../data/seasonality.json', import.meta.url), 'utf-8'));
const at = s => new Date(s + 'T10:00:00');

test('ключ каникул — первое слово названия', () => {
  assert.equal(holidayKey('Зимние (новогодние)'), 'зимние');
  assert.equal(holidayKey('Осенние'), 'осенние');
  assert.equal(holidayKey(''), '');
});

test('20.11.2026: осенние прошли, зимние — через 38 дней', () => {
  const now = at('2026-11-20');
  const autumn = holidayStatus(seasonality, 'Осенние', now);
  assert.equal(autumn.state, 'past');
  assert.equal(autumn.to.getDate(), 4);
  const winter = holidayStatus(seasonality, 'Зимние (новогодние)', now);
  assert.equal(winter.state, 'next');
  assert.equal(winter.days, 38);
});

test('31.12.2026: зимние идут, осталось 11 дней включая сегодня', () => {
  const st = holidayStatus(seasonality, 'Зимние', at('2026-12-31'));
  assert.equal(st.state, 'now');
  assert.equal(st.days, 11);
});

test('ноябрь 2026: осенние в ноябре уже закончились, в октябре 2027 точных дат нет', () => {
  const now = at('2026-11-20');
  assert.equal(holidayEndedInMonth(seasonality, 'Осенние', 2026, 11, now), true);
  assert.equal(holidayEndedInMonth(seasonality, 'Осенние', 2027, 10, now), false);
  assert.equal(holidayEndedInMonth(seasonality, 'Зимние', 2026, 12, now), false);
});

test('нет данных — статус null, без выдумывания', () => {
  assert.equal(holidayStatus(null, 'Осенние', at('2026-11-20')), null);
  assert.equal(holidayStatus(seasonality, 'Неизвестные', at('2026-11-20')), null);
});

test('окно месяцев от дня открытия начинается с текущего', () => {
  const win = monthWindow(at('2026-11-20'), 0, 12);
  assert.equal(win[0].m, 11);
  assert.equal(win[0].current, true);
  assert.equal(win[11].m, 10);
  assert.equal(win[11].y, 2027);
});
