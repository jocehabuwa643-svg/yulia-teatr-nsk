/* tests/acceptance-round4.test.mjs — исправления по замечаниям приёмки (раунд 4):
   • «Данные обновлены/проверены» учитывает meta.checked_at (heartbeat ежедневного прогона) и пишет о молчащих лентах;
   • аудит свежести видит частичный сбой leads (крупные места не обновились) и сайты конкурентов, которые не отвечают;
   • абонемент «за месяц» и «за N занятий» различаются; ориентиры бизнес-плана помечены model;
   • тарифы PlayPanda подписаны так, как на сайте (описание → цена → название);
   • сторожевой таймер boot.js не показывает баннер на медленной сети и убирает его при старте приложения. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { dataFreshness, STALE_DAYS } from '../js/today.js';
import { auditFreshness } from '../scripts/data-freshness.mjs';
import { otherKindRows } from '../js/competitor-prices.js';

const J = n => JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url), 'utf-8'));
const at = (y, m, d, h = 10) => new Date(y, m - 1, d, h).getTime();
const DAY = 864e5;
const NOW = Date.parse('2026-11-21T12:00:00Z');
const iso = t => new Date(t).toISOString();

/* ---------- Свежесть на главной ---------- */
test('свежесть: свежий checked_at при старых generated_at/news — не «устарели», подпись «проверены»', () => {
  const meta = { generated_at: new Date(at(2026, 12, 30)).toISOString(), checked_at: new Date(at(2027, 1, 6, 4)).toISOString() };
  const news = { updated_at: new Date(at(2026, 12, 29)).toISOString(), stale: false };
  const f = dataFreshness({ meta, news }, at(2027, 1, 6, 12));
  assert.equal(f.stale, false, 'каникулы без новых курсов и новостей — проверка шла, данные не устарели');
  assert.equal(f.checked, true);
  assert.equal(f.label, '6 января');
  // без checked_at та же ситуация честно «устарели»
  const old = dataFreshness({ meta: { generated_at: meta.generated_at }, news }, at(2027, 1, 6, 12));
  assert.equal(old.stale, true);
  assert.ok(old.age > STALE_DAYS);
});

test('свежесть: checked_at не позже изменений — подпись «обновлены»; часть лент молчит — пояснение без «устарели»', () => {
  const t = new Date(at(2026, 11, 21, 18)).toISOString();
  const f = dataFreshness({ meta: { generated_at: t, checked_at: t }, news: { updated_at: t, sources_failed: 3, sources_total: 5 } }, at(2026, 11, 21, 20));
  assert.equal(f.checked, false);
  assert.equal(f.stale, false);
  assert.deepEqual(f.notes, ['не ответили 3 из 5 лент новостей']);
  const none = dataFreshness({ meta: { generated_at: t }, news: { updated_at: t, sources_failed: 0, sources_total: 5 } }, at(2026, 11, 21, 20));
  assert.deepEqual(none.notes, []);
});

/* ---------- Аудит свежести ---------- */
test('аудит leads: документ свежий, но крупные места не обновились — notice с долей объектов; давно — warning', () => {
  const leads = {
    updated_at: iso(NOW - DAY), stale: false,
    places: [
      { id: 'novosibirsk', name: 'Новосибирск', stale: true, updated_at: iso(NOW - 2 * DAY), items: new Array(90).fill({}) },
      { id: 'iskitim', name: 'Искитим', stale: false, updated_at: iso(NOW - DAY), items: new Array(10).fill({}) }
    ]
  };
  const f = auditFreshness({ leads }, NOW);
  assert.ok(f.some(x => x.file === 'leads.json' && x.level === 'notice' && /Новосибирск/.test(x.message) && /90%/.test(x.message)), JSON.stringify(f));
  leads.places[0].updated_at = iso(NOW - 15 * DAY);
  const g = auditFreshness({ leads }, NOW);
  assert.ok(g.some(x => x.file === 'leads.json' && x.level === 'warning' && /Новосибирск \(15 дн\.\)/.test(x.message)), JSON.stringify(g));
});

test('аудит конкурентов: прогоны идут, но все сайты unavailable дольше порога — warning', () => {
  const competitors = {
    outbound_performers: [{ check_status: 'unavailable', checked_at: iso(NOW - DAY), observed: { last_ok_at: iso(NOW - 20 * DAY) } }],
    party_venues: [{ check_status: 'unavailable', checked_at: iso(NOW - DAY) }]
  };
  const f = auditFreshness({ competitors }, NOW);
  assert.ok(f.some(x => x.file === 'competitors.json' && /ни один сайт конкурентов не ответил успешно/.test(x.message)), JSON.stringify(f));
  competitors.party_venues[0] = { check_status: 'ok', checked_at: iso(NOW - DAY) };
  assert.ok(!auditFreshness({ competitors }, NOW).some(x => /не ответил успешно/.test(x.message)));
});

/* ---------- Цены конкурентов ---------- */
test('абонемент: «₽/мес» и «₽/абонемент» помечены разной единицей (per) и в одном списке не сравниваются', () => {
  const list = [
    { id: 'a', name: 'А', prices: [{ value: 3200, unit: '₽/абонемент', kind: 'subscription', confidence: 'high', fetched_at: '2026-11-21' }] },
    { id: 'b', name: 'Б', prices: [{ value: 4800, unit: '₽/мес', kind: 'subscription', confidence: 'high', fetched_at: '2026-11-21' }] }
  ];
  const o = otherKindRows(list, {});
  assert.deepEqual(o.subscription.map(r => [r.id, r.per]), [['a', 'pack'], ['b', 'month']]);
});

test('PlayPanda: тарифы подписаны как на сайте; «Большой матч» — пакет выходного дня 4 ч за 26 000 ₽', () => {
  const pp = J('competitors').party_venues.find(x => x.id === 'playpanda');
  const by = v => pp.prices.find(p => p.value === v);
  assert.match(by(21000).label, /Стартовая лига/);
  assert.match(by(21000).label, /банкет на 20 мест/);
  assert.match(by(26000).label, /Большой матч/);
  assert.match(by(26000).label, /выходные/);
  assert.match(by(26000).label, /всего 4 ч/);
  assert.doesNotMatch(by(26000).label, /банкет на 20/);
  assert.match(by(29500).label, /Лига чемпионов/);
  assert.match(by(24500).label, /Высшая лига/);
  const weekend = pp.cases.find(c => /Большой матч/.test(c.text));
  assert.ok(weekend && /26\s000 ₽/.test(weekend.text), 'у пакета выходного дня цена на сайте есть');
  assert.ok(!pp.cases.some(c => /цена на сайте не указана/.test(c.text)));
});

/* ---------- Сторожевой таймер boot.js ---------- */
/* Минимальная песочница браузера: таймеры управляются вручную, события — через сохранённые обработчики */
function bootSandbox({ protocol = 'http:' } = {}) {
  const timers = []; let now = 0;
  const handlers = { win: {}, doc: {} };
  const nodes = {};
  const body = { firstChild: null, insertBefore(el) { nodes[el.id] = el; el.parentNode = body; }, removeChild(el) { delete nodes[el.id]; el.parentNode = null; }, style: {} };
  const scripts = [];
  const mkEl = () => ({ id: '', className: '', style: {}, setAttribute() {}, set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; }, classList: { add() {}, contains() { return false; } } });
  const doc = {
    readyState: 'complete', documentElement: { setAttribute() {}, getAttribute() { return null; }, classList: { add() {}, contains() { return false; } } },
    body, createElement: mkEl,
    getElementById: id => nodes[id] || (id === 'bootClose' || id === 'bootCopy' ? {} : null),
    getElementsByTagName: () => scripts, querySelectorAll: () => [],
    addEventListener: (t, fn) => { (handlers.doc[t] = handlers.doc[t] || []).push(fn); }
  };
  const win = {
    document: doc, location: { protocol }, localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false }),
    setTimeout: (fn, ms) => { timers.push({ at: now + ms, fn }); return timers.length; },
    addEventListener: (t, fn) => { (handlers.win[t] = handlers.win[t] || []).push(fn); },
    Date: { now: () => now }
  };
  win.window = win;
  const ctx = vm.createContext({ window: win, document: doc, location: win.location, localStorage: win.localStorage, setTimeout: win.setTimeout, Date: win.Date, navigator: {} });
  vm.runInContext(readFileSync(new URL('../js/boot.js', import.meta.url), 'utf-8'), ctx);
  const advance = ms => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift(); now = t.at; t.fn();
    }
    now = end;
  };
  return { win, doc, nodes, scripts, handlers, advance, fire: (where, type, target) => (handlers[where][type] || []).forEach(fn => fn({ target })) };
}

test('boot.js: медленная сеть — скрипт приложения ещё грузится 12 с, баннера нет; приложение стартовало — баннера нет', () => {
  const s = bootSandbox();
  const app = { tagName: 'SCRIPT', src: 'https://x/yulia-teatr-nsk/assets/app.js?b=1' };
  s.scripts.push(app);
  s.fire('win', 'load', s.doc);           // window.load — старт запасного отсчёта
  s.advance(12000);
  assert.ok(!s.nodes.bootNotice, 'на 12-й секунде загрузки баннера быть не должно (раньше он появлялся на 3,5 с)');
  s.advance(20000);
  assert.ok(!s.nodes.bootNotice, 'пока скрипт в загрузке — ждём');
  s.win.__yuliaModuleOk = true;
  s.fire('doc', 'load', app);
  s.advance(3000);
  assert.ok(!s.nodes.bootNotice);
});

test('boot.js: ошибка загрузки скрипта — баннер сразу; скрипт загрузился без старта — баннер через 2 с; старт убирает баннер', () => {
  const a = bootSandbox();
  const app = { tagName: 'SCRIPT', src: '/assets/app.js' };
  a.fire('win', 'error', app);
  assert.ok(a.nodes.bootNotice, 'onerror скрипта — сбой виден сразу');
  // приложение всё же стартовало (например, повторная попытка) — баннер убирается
  a.win.__yuliaModuleOk = true;
  a.win.__yuliaHideBootNotice();
  assert.ok(!a.nodes.bootNotice);

  const b = bootSandbox();
  b.fire('doc', 'load', app);
  b.advance(1900);
  assert.ok(!b.nodes.bootNotice);
  b.advance(200);
  assert.ok(b.nodes.bootNotice, 'скрипт загружен, но признака жизни нет — ошибка исполнения');
});
