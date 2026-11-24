/* Тесты чистой логики подраздела «Клиенты и площадки» (js/clients-model.js):
   подсчёты вход-карточки, выбор места, отбор объектов карты, строки «Цены и аренда» с провенансом
   и страж истории — главное: history.back() никогда не уводит за начальную запись. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leadTotals, pickPlace, placeStat, validObjects, kindCounts, boundsOf, districtRows, priceRows, confLabel, makeBackGuard, HIST_KEY } from '../js/clients-model.js';
import { buildCalcConfig } from '../js/calculators/config.js';

const leads = JSON.parse(readFileSync(new URL('../data/leads.json', import.meta.url), 'utf8'));
const config = JSON.parse(readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
const competitors = JSON.parse(readFileSync(new URL('../data/competitors.json', import.meta.url), 'utf8'));
const rates = JSON.parse(readFileSync(new URL('../data/rates.json', import.meta.url), 'utf8'));

/* ---------- Подсчёты ---------- */
test('leadTotals: совпадает с суммой по местам и с totals из файла', () => {
  const t = leadTotals(leads);
  const sum = k => leads.places.reduce((a, p) => a + (p[k] || 0), 0);
  assert.equal(t.ready, true);
  assert.equal(t.places, leads.places.length);
  assert.equal(t.school, sum('school'));
  assert.equal(t.kindergarten, sum('kindergarten'));
  assert.equal(t.culture, sum('culture'));
  assert.equal(t.visit, t.school + t.kindergarten);
  if (leads.totals) assert.equal(t.visit, leads.totals.potential);
});

test('leadTotals: нет данных — нули и ready=false, без исключений', () => {
  for (const v of [null, undefined, {}, { places: null }, { places: [] }]) {
    const t = leadTotals(v);
    assert.equal(t.ready, false);
    assert.equal(t.visit, 0);
    assert.equal(t.places, 0);
  }
});

test('leadTotals: без totals считает сумму; мусорные значения — как 0; stale места поднимает флаг', () => {
  const t = leadTotals({ places: [{ school: 2, kindergarten: '3', culture: null }, { school: 'x', kindergarten: 1, culture: 4, stale: true }] });
  assert.deepEqual([t.school, t.kindergarten, t.culture, t.visit, t.stale], [2, 4, 4, 6, true]);
});

test('pickPlace: по id, иначе первое, пустой список — null', () => {
  assert.equal(pickPlace(leads.places, 'berdsk').id, 'berdsk');
  assert.equal(pickPlace(leads.places, 'nope').id, leads.places[0].id);
  assert.equal(pickPlace([], 'berdsk'), null);
  assert.equal(pickPlace(undefined), null);
});

test('placeStat: потенциал из файла, иначе школы + сады', () => {
  assert.equal(placeStat({ school: 3, kindergarten: 4, potential: 7 }).visit, 7);
  assert.equal(placeStat({ school: 3, kindergarten: 4 }).visit, 7);
  assert.equal(placeStat(null), null);
});

/* ---------- Объекты карты ---------- */
test('validObjects: отбрасывает битые координаты, нормализует тип и название', () => {
  const p = { objects: [
    { n: ' Школа №1 ', k: 's', ll: [55, 83] },
    { n: '', k: 'd', ll: [55.1, 83.1] },
    { k: 'zzz', ll: [55.2, 83.2] },
    { k: 's', ll: [NaN, 83] }, { k: 's', ll: [95, 83] }, { k: 's', ll: [55] }, null, { k: 's' }
  ] };
  const v = validObjects(p);
  assert.equal(v.length, 3);
  assert.equal(v[0].n, 'Школа №1');
  assert.equal(v[2].k, 's');
  assert.deepEqual(kindCounts(v), { s: 2, d: 1, c: 0 });
});

test('validObjects: все места leads.json рисуемые, число точек = числу объектов', () => {
  for (const p of leads.places) {
    const v = validObjects(p);
    assert.equal(v.length, p.objects.length, p.id);
    const c = kindCounts(v);
    // точек на карте не больше, чем в счётчиках места (OSM без координат не рисуется)
    assert.ok(c.s <= p.school && c.d <= p.kindergarten && c.c <= p.culture, p.id);
  }
});

test('boundsOf: границы и вырожденные случаи', () => {
  assert.deepEqual(boundsOf([{ ll: [1, 2] }, { ll: [3, 0] }]), [[1, 0], [3, 2]]);
  assert.equal(boundsOf([{ ll: [1, 2] }]), null);
  assert.equal(boundsOf([{ ll: [1, 2] }, { ll: [1, 2] }]), null);
  assert.equal(boundsOf([]), null);
});

test('districtRows: районы Новосибирска отсортированы по потенциалу', () => {
  const rows = districtRows(pickPlace(leads.places, 'novosibirsk'));
  assert.ok(rows.length > 0);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].visit >= rows[i].visit);
  assert.deepEqual(districtRows({}), []);
});

/* ---------- Цены и аренда ---------- */
test('priceRows: числа из config/competitors, у каждой строки есть источник и уровень достоверности', () => {
  const cfg = buildCalcConfig({ rates, config, competitors });
  const rows = priceRows(cfg, competitors);
  const byK = k => rows.find(r => r.k === k);
  assert.match(byK('Аренда базы (план)').v, new RegExp(String(config.base_costs.rent_per_m2.value).replace(/\B(?=(\d{3})+(?!\d))/g, '\\s')));
  assert.equal(byK('Доля ДК от кассы').v, `${config.venue_share.dk.value}%`);
  const subs = config.stages.value.map(s => s.subscription);
  assert.ok(byK('Абонемент студии (план)').v.includes(String(Math.min(...subs)).slice(0, 1)));
  for (const r of rows) {
    assert.ok(r.k, 'подпись');
    assert.ok(r.conf, `уровень достоверности: ${r.k}`);
    assert.ok(r.note, `источник/пояснение: ${r.k}`);
  }
  // цена конкурента — с датой среза и ссылкой на источник
  const panda = rows.find(r => /PlayPanda/.test(r.k));
  assert.ok(panda && /5\s000/.test(panda.v) && panda.date && panda.url);
});

test('priceRows: нет конфигурации — «нет данных», а не выдуманные числа', () => {
  const rows = priceRows({}, {});
  assert.ok(rows.length >= 6);
  for (const r of rows) { assert.equal(r.v, null, r.k); assert.equal(r.conf, 'no_data', r.k); }
  assert.equal(confLabel('no_data'), 'нет данных');
});

test('priceRows: значение, изменённое в калькуляторе, помечено «введено вами»', () => {
  const cfg = buildCalcConfig({ rates, config, competitors }, { cfg: { 'base_costs.rent_per_m2': 1300 } });
  const r = priceRows(cfg, competitors).find(x => x.k === 'Аренда базы (план)');
  assert.equal(r.conf, 'manual');
  assert.match(r.v, /1\s300/);
});

/* ---------- Страж истории ----------
   Модель истории браузера: массив записей + индекс; back() асинхронный (как в браузере) — popstate приходит позже.
   Проверяем инвариант: индекс никогда не уходит ниже стартового (то есть страница не покидает сайт). */
function fakeHistory(startLen = 1) {
  const entries = Array.from({ length: startLen }, () => ({ state: null }));
  let idx = startLen - 1, minIdx = idx, queue = [];
  const listeners = [];
  const h = {
    get state() { return entries[idx].state; },
    get index() { return idx; },
    get minIdx() { return minIdx; },
    pushState(st) { entries.length = idx + 1; entries.push({ state: st }); idx++; },
    replaceState(st) { entries[idx].state = st; },
    back() { queue.push(-1); },
    onpop(fn) { listeners.push(fn); },
    flush() { while (queue.length) { const d = queue.shift(); idx += d; minIdx = Math.min(minIdx, idx); listeners.forEach(fn => fn(entries[idx] ? entries[idx].state : undefined)); } }
  };
  return h;
}

/* Модель диалога, связанная со стражем так же, как в clients-view.js */
function harness(startLen = 1) {
  const h = fakeHistory(startLen);
  const g = makeBackGuard(h);
  const d = { open: false };
  const start = h.index;
  const onClosed = () => g.release();
  const close = () => { if (d.open) { d.open = false; onClosed(); } };
  h.onpop(st => { if (g.onPop(st) && d.open) close(); else g.scrub(); });
  const open = () => { if (d.open) return; d.open = true; g.push(); };
  return { h, g, d, open, close, start, nativeClose: close };
}

test('страж: открыть → закрыть кнопкой → один back, остаёмся на стартовой записи', () => {
  const x = harness(1);
  x.open(); assert.equal(x.h.index, x.start + 1);
  x.close(); x.h.flush();
  assert.equal(x.h.index, x.start);
  assert.equal(x.h.minIdx, x.start);
});

test('страж: «назад» браузера при открытом (popstate) — закрывает без второго back', () => {
  const x = harness(1);
  x.open();
  x.h.back(); x.h.flush();
  assert.equal(x.d.open, false);
  assert.equal(x.h.index, x.start);
  assert.equal(x.h.minIdx, x.start);
});

test('страж: Android CloseWatcher закрыл диалог сам — ровно один back', () => {
  const x = harness(1);
  x.open();
  x.nativeClose(); x.h.flush();
  assert.equal(x.h.index, x.start);
  assert.equal(x.h.minIdx, x.start);
});

test('страж: запись уже снята кем-то (рассинхрон) — закрытие НЕ вызывает back и не уходит с сайта', () => {
  const x = harness(1);
  x.open();
  x.h.replaceState(null);           // например, другой модуль заменил запись
  x.close(); x.h.flush();
  assert.equal(x.h.minIdx, x.start);
  assert.equal(x.g.pending, false);
});

test('страж: 10 циклов подряд разными способами — история не уходит за начальную запись', () => {
  const x = harness(1);
  for (let i = 0; i < 10; i++) {
    x.open();
    if (i % 3 === 0) x.close();
    else if (i % 3 === 1) x.h.back();
    else x.nativeClose();
    x.h.flush();
    assert.equal(x.d.open, false, `цикл ${i}`);
    assert.equal(x.h.index, x.start, `цикл ${i}`);
  }
  assert.equal(x.h.minIdx, x.start);
  // back при закрытом диалоге — обычная навигация, страж в неё не вмешивается
  assert.equal(x.g.token, null);
});

test('страж: повторное открытие при уже стоящей записи не кладёт вторую', () => {
  const h = fakeHistory(1);
  const g = makeBackGuard(h);
  g.push(); const i1 = h.index;
  g.push();
  assert.equal(h.index, i1);
});

test('страж: старая метка после перезагрузки снимается scrub, back по ней не вызывается', () => {
  const h = fakeHistory(1);
  h.pushState({ [HIST_KEY]: 'old-token', other: 1 });
  const g = makeBackGuard(h);
  assert.equal(g.release(), false);
  assert.equal(g.scrub(), true);
  assert.deepEqual(h.state, { other: 1 });
});

test('страж: pushState недоступен (file://) — подраздел работает без записи', () => {
  const g = makeBackGuard({ state: null, pushState() { throw new Error('SecurityError'); }, back() { throw new Error('не должен вызываться'); }, replaceState() {} });
  assert.equal(g.push(), false);
  assert.equal(g.release(), false);
});

/* ---------- Перезагрузка с открытым подразделом: запасная запись ----------
   История после перезагрузки: [A (старт), B (наша старая метка, текущая)]. Открытие должно занять B, а не класть C:
   тогда «назад» из открытого подраздела закрывает его (уходит на A), и следующего лишнего шага на том же адресе нет. */
function reloadedHarness() {
  const h = fakeHistory(1);
  h.pushState({ [HIST_KEY]: 'old-token' });          // запись от прошлой загрузки страницы
  const g = makeBackGuard(h);
  const d = { open: false };
  const close = () => { if (d.open) { d.open = false; g.release(); } };
  h.onpop(st => { if (g.onPop(st) && d.open) close(); else g.scrub(); });
  const open = () => { if (d.open) return; d.open = true; g.push(); };
  g.scrub();                                         // как при загрузке clients-view.js
  return { h, g, d, open, close };
}

test('страж: после перезагрузки открытие занимает запасную запись, новую не кладёт', () => {
  const x = reloadedHarness();
  assert.equal(x.g.spare, true);
  const len = x.h.index;
  x.open();
  assert.equal(x.h.index, len, 'запись не добавилась');
  assert.ok(x.g.isOurs(x.h.state));
});

test('страж: после перезагрузки «назад» закрывает подраздел за один шаг и остаётся на сайте', () => {
  const x = reloadedHarness();
  x.open();
  x.h.back(); x.h.flush();
  assert.equal(x.d.open, false);
  assert.equal(x.h.index, 0, 'стартовая запись A — следующий «назад» уже уводит с сайта, лишнего шага нет');
});

test('страж: занятую запасную запись кнопка закрывает без back(); повторные циклы не копят записей', () => {
  const x = reloadedHarness();
  let backs = 0; const origBack = x.h.back; x.h.back = () => { backs++; origBack(); };
  for (let i = 0; i < 5; i++) {
    x.open(); x.close(); x.h.flush();
    assert.equal(x.h.index, 1, `цикл ${i}`);
    assert.equal(x.g.pending, false);
    assert.equal(x.h.state, null, 'метка снята');
  }
  assert.equal(backs, 0, 'back() ни разу не вызывался');
});

/* ---------- Подписи к числам ---------- */
test('countWord: согласование с числом (1 школа, 2 школы, 5 школ, 11 школ, 21 школа)', async () => {
  const { countWord, pluralRu } = await import('../js/clients-model.js');
  assert.equal(countWord('school', 1), 'школа');
  assert.equal(countWord('school', 2), 'школы');
  assert.equal(countWord('school', 5), 'школ');
  assert.equal(countWord('school', 11), 'школ');
  assert.equal(countWord('school', 21), 'школа');
  assert.equal(countWord('kindergarten', 2), 'детских сада');
  assert.equal(countWord('kindergarten', 1), 'детский сад');
  assert.equal(countWord('kindergarten', 0), 'детских садов');
  assert.equal(countWord('culture', 0), 'ДК и клубов');
  assert.equal(countWord('places', 6), 'мест на карте');
  assert.equal(pluralRu(112, 'a', 'b', 'c'), 'c');
  assert.equal(pluralRu(1.5, 'a', 'b', 'c'), 'c');
});
