/* Аудит 24.11.2026, часть C: архив закрытых/непрофильных мест в «Навигаторе» и спокойная подпись блока «Спрос по запросам».
   Проверяем данные (competitors.json, regions.json, market.json) и чистую логику (competitor-prices.js, fetch-competitors.mjs). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isArchived, activeCompetitors, archivedList, perPersonRows, otherKindRows, COMPETITOR_LISTS } from '../js/competitor-prices.js';
import { priceRows } from '../js/clients-model.js';
import { run } from '../scripts/fetch-competitors.mjs';

const J = n => JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url), 'utf-8'));
const ARCH_IDS = ['kukly-smeyutsya', 'marmeladnaya', 'bachetta'];

/* ---------- Данные ---------- */

test('competitors.json: три места в архиве с причиной, датой и источником', () => {
  const d = J('competitors');
  const arch = archivedList(d);
  for (const id of ARCH_IDS) {
    const x = arch.find(a => a.id === id);
    assert.ok(x, `${id} в архиве`);
    assert.equal(x.archived, true, id);
    assert.match(x.archived_at, /^\d{4}-\d{2}-\d{2}$/, id);
    assert.ok(x.archived_reason && x.archived_reason.length > 5, id);
    assert.match(x.archived_source_url || '', /^https:\/\//, `${id}: ссылка на подтверждение`);
    assert.ok(x.name, `${id}: имя сохранено — поиск по id не ломается`);
  }
  assert.match(arch.find(a => a.id === 'bachetta').archived_reason, /непрофильный: художественная студия/);
  assert.match(arch.find(a => a.id === 'marmeladnaya').archived_reason, /закрыт по данным владельца, 24\.11\.2026/);
  assert.match(arch.find(a => a.id === 'kukly-smeyutsya').archived_reason, /закрыт по данным владельца, 24\.11\.2026/);
});

test('архивные места не входят в действующие группы, счётчики, диаграмму и сравнения', () => {
  const d = J('competitors');
  for (const k of COMPETITOR_LISTS) for (const x of d[k] || []) assert.ok(!ARCH_IDS.includes(x.id), `${x.id} не в ${k}`);
  const active = activeCompetitors(d);
  assert.ok(active.length > 0);
  assert.ok(!active.some(x => ARCH_IDS.includes(x.id)));
  // даже если запись с archived:true окажется в группе — диаграмма и сравнения её отбрасывают
  const leaked = [...active, { ...archivedList(d)[0], type: 'outbound', prices: [{ value: 300, kind: 'per_child', unit: '₽/ребёнок', confidence: 'high', fetched_at: '2026-11-20', source_url: 'https://example.ru' }] }];
  const pp = perPersonRows(leaked, {});
  assert.ok(![...pp.ticket, ...pp.per_child].some(r => ARCH_IDS.includes(r.id)));
  assert.ok(!pp.none.some(n => /Куклы смеются|Мармеладная|Бачетта/.test(n)));
  const other = otherKindRows(leaked, {});
  assert.ok(!Object.values(other).flat().some(r => ARCH_IDS.includes(r.id)));
});

test('«Клиенты и площадки → Цены и аренда»: архивных мест нет в строках цен', () => {
  const rows = priceRows({}, J('competitors'));
  assert.ok(!rows.some(r => /Куклы смеются|Мармеладная|Бачетта/.test(r.k)));
});

test('archivedList: записи с archived:true внутри групп тоже попадают в архив, без повторов', () => {
  const doc = { archived: [{ id: 'a', archived: true }], studio_scene: [{ id: 'a', archived: true }, { id: 'b', archived: true }, { id: 'c' }] };
  assert.deepEqual(archivedList(doc).map(x => x.id), ['a', 'b']);
  assert.deepEqual(activeCompetitors(doc).map(x => x.id), ['c']);
  assert.equal(isArchived({ archived: 'yes' }), false, 'только строгое true');
  assert.deepEqual(archivedList(null), []);
});

test('regions.json: «Мармеладная страна» больше не числится действующим конкурентом со статусом «уточнить»', () => {
  const home = J('regions').points.find(p => p.id === 'home');
  assert.doesNotMatch(home.rivals, /статус уточнить/);
  assert.match(home.rivals, /Мармеладная страна[^.]*закрыта/);
});

test('fetch-competitors: архивные записи не проверяются (сухой прогон без сети)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'audit-market-'));
  try {
    copyFileSync(new URL('../data/competitors.json', import.meta.url), join(dir, 'competitors.json'));
    const asked = [];
    // сеть подменена: robots.txt «недоступен», страницы не запрашиваются — записываем, к кому обращались
    const getRobots = async origin => { asked.push(String(origin)); return { ok: false, error: 'нет сети в тесте' }; };
    const getPage = async url => { asked.push(String(url)); throw new Error('нет сети в тесте'); };
    const doc = await run({ now: new Date('2026-11-24T04:00:00Z'), dataDir: dir, deps: { getRobots, getPage } });
    for (const x of doc.archived) assert.equal(x.checked_at, archivedList(J('competitors')).find(a => a.id === x.id).checked_at, `${x.id}: метка проверки не менялась`);
    assert.ok(!asked.some(u => /kuklysmeutsa|marmelad|bachetta/i.test(u)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- Спрос ---------- */

test('market.json → demand: нейтральная подпись «Оценочный ориентир», инструкция Вордстата, чисел без источника нет', () => {
  const d = J('market').demand;
  assert.equal(d.estimate_label, 'Оценочный ориентир · требует проверки через Яндекс Вордстат');
  assert.match(d.check_url, /^https:\/\/wordstat\.yandex\.ru\/?$/);
  assert.match(d.check_region, /Новосибирск/);
  assert.ok(Array.isArray(d.check_steps) && d.check_steps.length >= 2);
  if (d.status !== 'ok') {
    assert.equal(d.confidence, 'model', 'без источника — ориентир, не статистика');
    assert.ok(!Array.isArray(d.results) || !d.results.length, 'без источника результатов-чисел нет');
    assert.ok(d.queries.every(q => typeof q === 'string'), 'запросы — без чисел');
  }
});

test('интерфейс: заглушки «нет источника» в блоке спроса больше нет', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');
  const js = readFileSync(new URL('../js/market.js', import.meta.url), 'utf-8');
  assert.doesNotMatch(html, /id="demandBadge">нет источника/);
  assert.doesNotMatch(js, /'нет источника'/);
  assert.doesNotMatch(js, /Нет данных: источник спроса не подключён/);
  assert.match(js, /Оценочный ориентир · требует проверки через Яндекс Вордстат/);
  assert.match(html, /id="marketArchive"/);
});
