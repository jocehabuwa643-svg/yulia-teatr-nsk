/* tests/acceptance-round5.test.mjs — исправления по замечаниям приёмки (раунд 5):
   • допущения бизнес-плана (confidence:model) не выдаются за цены студий и не считаются в KPI «Есть цена»;
   • цена из вторичного источника не подписывается «проверено по источнику»;
   • «данные устарели» в «Клиентах и площадках» объяснено: что не обновилось и от какой даты показаны данные;
   • недельная автопроверка конкурентов продвигает checked_at, даже если страница не изменилась;
   • дата в шапке «Навигатора рынка» берётся из данных, а не зашита в разметку. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { confirmedGroups, planAssumptionGroups, isPlanAssumption, ticketPriceOf, groupPrices } from '../js/competitor-prices.js';
import { leadsMetaLine, placeStaleNote, nskDateTime, staleReasonText } from '../js/clients-model.js';
import { run, SAME_RUN_DAYS } from '../scripts/fetch-competitors.mjs';
import { auditFreshness } from '../scripts/data-freshness.mjs';

const J = n => JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url), 'utf-8'));
const LISTS = ['outbound_performers', 'studio_scene', 'party_venues', 'stationary_benchmarks'];
const all = d => LISTS.flatMap(k => d[k] || []);

/* ---------- Допущения бизнес-плана ---------- */
test('допущение плана: confirmedGroups убирает model-цены, planAssumptionGroups — только их', () => {
  const c = { prices: [
    { value: 3200, unit: '₽/абонемент', kind: 'subscription', confidence: 'model' },
    { value: 500, unit: '₽/билет', kind: 'ticket', confidence: 'high', fetched_at: '2026-11-21' }
  ] };
  assert.deepEqual(confirmedGroups(c).map(g => g.kind), ['ticket']);
  assert.deepEqual(planAssumptionGroups(c).map(g => g.kind), ['subscription']);
  assert.equal(isPlanAssumption({ confidence: 'model', manual: true }), false, 'ручной ввод — не допущение');
  // ручная цена Юлии того же типа остаётся ценой
  assert.equal(confirmedGroups(c, { value: 4000, kind: 'subscription' }).find(g => g.kind === 'subscription').items.length, 1);
});

test('реальные данные: студии только с допущениями плана — без подтверждённой цены, KPI «Есть цена» их не считает', () => {
  const list = all(J('competitors'));
  const studios = ['piligrimy', 'maskarad', 'shamshin-30', 'ddk-social'];
  for (const id of studios) {
    const c = list.find(x => x.id === id);
    if (!c) continue;   // карточку могли убрать — проверяем только существующие
    if (groupPrices(c).every(g => g.items.every(isPlanAssumption))) {
      assert.equal(confirmedGroups(c).length, 0, `${id}: допущение не цена студии`);
      assert.ok(planAssumptionGroups(c).length > 0, `${id}: допущение показывается сноской`);
    }
  }
  // «Есть цена» = карточки, где есть хоть одна не-model цена; каждая такая цена имеет ссылку на источник
  const priced = list.filter(c => confirmedGroups(c).length);
  for (const c of priced) for (const g of confirmedGroups(c)) for (const p of g.items) {
    assert.notEqual(p.confidence, 'model', c.id);
    assert.ok(/^https?:\/\//.test(p.source_url || ''), `${c.id}: у подтверждённой цены есть ссылка`);
  }
  assert.ok(priced.length < list.filter(c => groupPrices(c).length).length, 'допущения больше не завышают счётчик');
});

test('ticketPriceOf: вторичный источник не называется «проверено по источнику»; допущение плана ценой не считается', () => {
  const sec = ticketPriceOf({ prices: [{ value: 350, qualifier: 'от', kind: 'ticket', confidence: 'medium', fetched_at: '2026-11-18', source_url: 'https://afisha.example/x' }] });
  assert.equal(sec.value, 350);
  assert.doesNotMatch(sec.source, /проверено/);
  assert.match(sec.source, /вторичный/);
  const off = ticketPriceOf({ prices: [{ value: 322, kind: 'ticket', confidence: 'high', fetched_at: '2026-11-21' }] });
  assert.match(off.source, /официальный/);
  const plan = ticketPriceOf({ prices: [{ value: 300, kind: 'ticket', confidence: 'model' }] });
  assert.equal(plan.value, null);
  assert.equal(plan.confidence, 'no_data');
});

/* ---------- «Клиенты и площадки»: понятное «устарело» ---------- */
test('nskDateTime: время по Новосибирску (UTC+7); мусор — null', () => {
  assert.equal(nskDateTime('2026-11-21T03:22:01.963Z'), '21.11.2026, 10:22');
  assert.equal(nskDateTime('nope'), null);
  assert.equal(nskDateTime(null), null);
});

test('staleReasonText: 5xx и таймаут — «сервер карт не ответил»', () => {
  assert.equal(staleReasonText('Overpass maps.mail.ru (Бердск): HTTP 504'), 'сервер карт не ответил');
  assert.equal(staleReasonText('timeout'), 'сервер карт не ответил');
  assert.equal(staleReasonText('HTTP 400 bad query'), 'ошибка загрузки');
});

test('placeStaleNote: «последнее обновление не удалось — показаны данные от …»; свежее место — null', () => {
  const p = { name: 'Бердск', stale: true, fetched_at: '2026-11-21T03:22:01.963Z', stale_since: '2026-11-21T18:01:52.186Z', stale_reason: 'HTTP 504' };
  const n = placeStaleNote(p);
  assert.equal(n.badge, 'последнее обновление не удалось');
  assert.match(n.text, /не удалось — сервер карт не ответил/);
  assert.match(n.text, /Показаны данные от 21\.11\.2026, 10:22/);
  assert.doesNotMatch(n.text, /устарел/);
  assert.equal(placeStaleNote({ stale: false }), null);
});

test('leadsMetaLine: частичный сбой — какие места и от какой даты; без сбоя — «обновлено …»; без слова «устарели»', () => {
  const leads = J('leads');
  const line = leadsMetaLine(leads, 'OSM');
  assert.doesNotMatch(line, /устарел/);
  const failed = leads.places.filter(p => p.stale);
  if (failed.length) {
    for (const p of failed) assert.ok(line.includes(p.name), p.name);
    assert.match(line, /показаны данные от \d\d\.\d\d\.\d{4}, \d\d:\d\d/);
    assert.match(line, new RegExp(`обновлено ${leads.places.length - failed.length} из ${leads.places.length} мест`));
  }
  const fresh = { updated_at: '2026-11-21T03:22:01.963Z', places: [{ id: 'a', name: 'А', stale: false }] };
  assert.equal(leadsMetaLine(fresh, 'OSM'), 'OSM · обновлено 21.11.2026, 10:22 · возможны пропуски');
  // самая ранняя дата прежних данных выбирается по времени, а не по строке «дд.мм.гггг»
  const two = { updated_at: '2026-12-02T00:00:00Z', places: [
    { name: 'X', stale: true, fetched_at: '2026-11-30T00:00:00Z' },
    { name: 'Y', stale: true, fetched_at: '2026-10-05T00:00:00Z' }] };
  assert.match(leadsMetaLine(two, 'OSM'), /не обновилось ни одно место.*данные от 05\.10\.2026/);
  assert.equal(leadsMetaLine(null, 'OSM'), null);
});

/* ---------- Автопроверка конкурентов: checked_at продвигается раз в неделю ---------- */
test('run(): повтор в тот же день не трогает метки; недельный прогон с той же страницей продвигает checked_at и last_ok_at', async () => {
  assert.ok(SAME_RUN_DAYS < 1, 'окно идемпотентности меньше суток');
  const dir = mkdtempSync(join(tmpdir(), 'comp5-'));
  const deps = { getRobots: async () => ({ ok: true, text: '' }), getPage: async () => ({ status: 200, html: '<p>Спектакль для детей. Купить билет 777 ₽</p>' }) };
  const quiet = console.log; console.log = () => {};
  try {
    copyFileSync(new URL('../data/competitors.json', import.meta.url), join(dir, 'competitors.json'));
    const read = () => JSON.parse(readFileSync(join(dir, 'competitors.json'), 'utf-8'));
    const T0 = Date.parse('2026-11-23T02:30:00Z');
    await run({ now: new Date(T0), dataDir: dir, deps });
    const a = all(read()).filter(x => x.check_status === 'ok');
    assert.ok(a.length > 0, 'есть успешно проверенные сайты');
    await run({ now: new Date(T0 + 3 * 3600e3), dataDir: dir, deps });             // ручной повтор через 3 ч
    const b = all(read());
    for (const x of a) assert.equal(b.find(y => y.id === x.id).checked_at, x.checked_at, `${x.id}: повтор в тот же день без новых меток`);
    const T7 = T0 + 7 * 864e5;
    await run({ now: new Date(T7), dataDir: dir, deps });                          // следующий понедельник, страница та же
    const c = all(read());
    for (const x of a) {
      const y = c.find(z => z.id === x.id);
      assert.equal(y.checked_at, new Date(T7).toISOString(), `${x.id}: checked_at продвинулся`);
      assert.equal(y.observed.last_ok_at, new Date(T7).toISOString(), `${x.id}: last_ok_at продвинулся`);
    }
    // через 3 недели стабильных сайтов при еженедельных прогонах аудит не шумит
    const T21 = T0 + 21 * 864e5;
    await run({ now: new Date(T0 + 14 * 864e5), dataDir: dir, deps });
    await run({ now: new Date(T21), dataDir: dir, deps });
    const f = auditFreshness({ competitors: read() }, T21 + 2 * 864e5);
    assert.ok(!f.some(x => /не выполнялась|не ответил успешно/.test(x.message)), JSON.stringify(f));
  } finally {
    console.log = quiet;
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------- Шапка «Навигатора рынка» ---------- */
test('index.html: в шапке «Навигатора рынка» нет зашитой даты среза — её подставляет market.js из данных', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');
  assert.doesNotMatch(html, /Срез исследования: \d\d\.\d\d\.\d{4}/);
  assert.match(html, /id="marketStamp"/);
  const js = readFileSync(new URL('../js/market.js', import.meta.url), 'utf-8');
  assert.match(js, /marketStamp/);
});
