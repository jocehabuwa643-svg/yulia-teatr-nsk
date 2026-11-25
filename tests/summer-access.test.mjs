/* Тесты карточки «Допуск в сады и школы (старт)» и подключения блоков раздела «План запуска»:
   официальные источники, пометка «уточните» там, где требование неоднозначно, отметки «готово», разметка в #launch. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { accessItems, sanitizeAccessState, accessProgress, ruDate } from '../js/access-card.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const guide = JSON.parse(read('../data/guide.json'));
const block = guide.access_start;
const OFFICIAL = /^https:\/\/(www\.)?(consultant\.ru|gosuslugi\.ru|nalog\.gov\.ru|npd\.nalog\.ru)\//;

test('access_start: 4 пункта — медкнижка, справка о несудимости, ИП/НПД, договор; у каждого официальный источник', () => {
  const items = accessItems(block);
  assert.deepEqual(items.map(x => x.id), ['medbook', 'criminal', 'status', 'contract']);
  for (const x of items) {
    assert.ok(x.what.length > 20 && x.what.length <= 220, `${x.id}: «что это» — коротко`);
    assert.ok(x.sources.length >= 1, `${x.id}: есть источник`);
    for (const s of x.sources) {
      assert.match(s.source_url, OFFICIAL, `${x.id}: официальный домен`);
      assert.match(s.fetched_at, /^\d{4}-\d{2}-\d{2}$/, `${x.id}: дата проверки`);
    }
  }
  assert.match(block.checked_at, /^\d{4}-\d{2}-\d{2}$/);
});

test('неоднозначные требования помечены «уточните у заведующей»; ст. 351.1 ТК и срок справки — из источников', () => {
  const items = accessItems(block);
  const by = id => items.find(x => x.id === id);
  assert.match(by('medbook').clarify, /уточните у заведующей/i);
  assert.match(by('medbook').clarify, /2\.4\.3648-20/);
  assert.match(by('criminal').what, /351\.1/);
  assert.ok(by('criminal').sources.some(s => /cons_doc_LAW_34683/.test(s.source_url)), 'ТК РФ на consultant.ru');
  assert.ok(by('criminal').sources.some(s => /gosuslugi\.ru/.test(s.source_url)), 'Госуслуги');
  assert.ok(by('status').sources.some(s => /nalog/.test(s.source_url)), 'ФНС');
  assert.match(by('contract').what, /779/);
  for (const k of ['предмет', 'дата', 'цена', 'оплат', 'безопасност']) assert.match(by('contract').what, new RegExp(k, 'i'), `договор: ${k}`);
});

test('accessItems: битые записи и ссылки не-https отбрасываются', () => {
  const items = accessItems({ items: [null, { id: '', title: 'x' }, { id: 'a', title: 'A', sources: [{ source_url: 'javascript:alert(1)' }, { source_url: 'http://x.ru' }, { source_url: 'https://ok.ru/', source_name: 'ok' }] }] });
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].sources.map(s => s.source_url), ['https://ok.ru/']);
  assert.deepEqual(accessItems(null), []);
});

test('отметки «готово»: только известные id и true; прогресс', () => {
  const items = accessItems(block);
  const st = sanitizeAccessState({ medbook: true, criminal: 'да', evil: true }, items);
  assert.deepEqual(st, { medbook: true });
  assert.deepEqual(sanitizeAccessState([true], items), {});
  assert.deepEqual(accessProgress(items, st), { done: 1, total: 4, pct: 25 });
  assert.equal(ruDate('2026-11-24'), '24.11.2026');
  assert.equal(ruDate('bad'), '');
});

test('разметка: контейнеры и стили блоков — внутри раздела #launch, модуль подключён из app.js', () => {
  const html = read('../index.html');
  const start = html.indexOf('<section id="launch"');
  const end = html.indexOf('</section>', start);
  assert.ok(start > 0 && end > start);
  const launch = html.slice(start, end);
  assert.match(launch, /<link rel="stylesheet" href="css\/launch-extras\.css">/);
  assert.ok(launch.indexOf('id="accessStart"') < launch.indexOf('class="checklist-grid"'), 'допуск — перед планом на 30 дней');
  assert.ok(launch.indexOf('id="summerPlan"') > launch.indexOf('class="checklist-grid"'), 'летний сценарий — после плана');
  assert.match(read('../js/app.js'), /^import '\.\/launch-extras\.js';/m);
  // стили: только токены и transform/opacity в анимациях, тач-цели через --tap
  const css = read('../css/launch-extras.css');
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(css), 'без hex-цветов мимо токенов');
  assert.match(css, /min-height:var\(--tap\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test('компактность: «Что уточнить · источники» свёрнуты в <details>, перед печатью раскрываются; медкнижка — про электронную форму', () => {
  const js = read('../js/launch-extras.js');
  assert.match(js, /<details class="lx-more">/);
  assert.match(js, /beforeprint[\s\S]{0,200}details\.lx-more[\s\S]{0,80}\.open = true/);
  const css = read('../css/launch-extras.css');
  assert.match(css, /\.lx-more>summary\{[^}]*min-height:var\(--tap\)/, 'summary — тач-цель ≥ 44px');
  const med = block.items.find(x => x.id === 'medbook');
  assert.match(med.what, /электронн/);
  assert.match(med.clarify, /СП 2\.4\.3648-20/);
});
