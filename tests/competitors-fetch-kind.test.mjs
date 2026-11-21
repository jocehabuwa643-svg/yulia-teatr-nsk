/* Недельная проверка конкурентов: тип извлечённой цены на сохранённых фрагментах разметки (tests/fixtures/competitors —
   тестовые входы, не данные сайтов) и полный прогон run() на копии данных без сети:
   ручные/проверенные цены не меняются, недоступные сайты честно помечаются, прежние наблюдения сохраняются. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { htmlToText, extractPrice, buildCheck, run } from '../scripts/fetch-competitors.mjs';

const FIX = n => readFileSync(new URL(`./fixtures/competitors/${n}.html`, import.meta.url), 'utf-8');
const price = n => extractPrice(htmlToText(FIX(n)));
const NOW = '2026-11-23T02:30:00.000Z';

/* ---------- Парсинг фрагментов ---------- */
test('афиша лекций: «От 300 руб.» рядом с «Купить билет» — билет, квалификатор «от»; телефон и ИНН не цена', () => {
  const r = price('planetarium-afisha');
  assert.equal(r.value, 300);
  assert.equal(r.qualifier, 'от');
  assert.equal(r.kind, 'ticket');
});

test('прайс площадки с несколькими пакетами — неоднозначно: цену не выдумываем и билетом не называем', () => {
  const r = price('party-packages');
  assert.equal(r.value, null);
  assert.equal(r.reason, 'ambiguous');
  assert.ok(r.values.includes(21000) && r.values.includes(26000));
});

test('выездной спектакль «350 ₽ с ребёнка» — тип «выезд за ребёнка»', () => {
  const r = price('outbound-per-child');
  assert.equal(r.value, 350);
  assert.equal(r.kind, 'per_child');
});

test('абонемент студии — тип «абонемент», не билет', () => {
  const r = price('studio-subscription');
  assert.equal(r.value, 4800);
  assert.equal(r.kind, 'subscription');
});

test('одно число у билета и у часа аренды — тип «прочее», не угадываем', () => {
  const r = price('mixed-kinds');
  assert.equal(r.value, 400);
  assert.equal(r.kind, 'other');
});

test('buildCheck: тип цены сохраняется в наблюдении вместе с датой и ссылкой', () => {
  const r = buildCheck(null, 'https://example.ru/afisha', 200, FIX('planetarium-afisha'), NOW);
  assert.equal(r.observed.price.kind, 'ticket');
  assert.equal(r.observed.price.fetched_at, NOW);
  assert.equal(r.observed.price.source_url, 'https://example.ru/afisha');
  assert.equal(r.observed.price.confidence, 'low');
});

/* ---------- Полный прогон на копии данных ---------- */
test('run(): ручные и проверенные цены не меняются; сбой сайта — unavailable с прежними данными; площадки с запретом не запрашиваются', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'comp-'));
  try {
    copyFileSync(new URL('../data/competitors.json', import.meta.url), join(dir, 'competitors.json'));
    const before = JSON.parse(readFileSync(join(dir, 'competitors.json'), 'utf-8'));
    const asked = [];
    const deps = {
      getRobots: async () => ({ ok: true, text: '' }),
      getPage: async url => {
        asked.push(url);
        if (/nik-show/.test(url)) throw new Error('HTTP 503');
        // любая другая страница «показывает» другую цену билета — это должно попасть только в observed
        return { status: 200, html: '<p>Купить билет 999 ₽</p>' };
      }
    };
    await run({ now: new Date(NOW), dataDir: dir, deps });
    const after = JSON.parse(readFileSync(join(dir, 'competitors.json'), 'utf-8'));
    const lists = ['outbound_performers', 'studio_scene', 'party_venues', 'stationary_benchmarks'];
    const pick = d => lists.flatMap(k => d[k]);
    for (const [a, b] of pick(before).map((x, i) => [x, pick(after)[i]])) {
      assert.deepEqual(b.prices, a.prices, `${a.id}: prices не трогаются`);
      assert.deepEqual(b.cases, a.cases, `${a.id}: cases не трогаются`);
      assert.equal(b.verified_at, a.verified_at, `${a.id}: verified_at не трогается`);
      assert.deepEqual(b.unconfirmed_prices, a.unconfirmed_prices, a.id);
    }
    const nik = pick(after).find(x => x.id === 'nikolya');
    assert.equal(nik.check_status, 'unavailable');
    assert.equal(nik.observed.content_hash, pick(before).find(x => x.id === 'nikolya').observed.content_hash);
    const pp = pick(after).find(x => x.id === 'playpanda');
    assert.equal(pp.observed.price.value, 999);
    assert.equal(pp.observed.price.kind, 'ticket');
    assert.ok(!asked.some(u => /2gis|vk\.|yandex|zoon/.test(u)), 'запрещённые площадки не запрашивались');
    assert.equal(pick(after).find(x => x.id === 'art-avenue').check_status, 'skipped_policy');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
