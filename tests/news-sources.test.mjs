/* Тесты списка лент «Новостей отрасли» (scripts/fetch-news.mjs): адреса и темы всех лент, флаг ci_unreachable у лент,
   которые не отвечают серверам GitHub, пропуск таких лент в GitHub Actions без ::warning и без счёта в sources_failed,
   фильтры и классификация на реальных заголовках новых лент (взяты из лент 23–24.11.2026). Сеть не используется. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCES, LOCAL_SOURCES, ALL_SOURCES, skipInThisRun, CI_SKIP_NOTE, passesFilter, classify, normalize, buildDoc
} from '../scripts/fetch-news.mjs';
import { TOPIC_LABELS } from '../js/news.js';

const NOW = Date.parse('2026-11-24T12:00:00Z');
const iso = ms => new Date(ms).toISOString();
const byKey = Object.fromEntries(ALL_SOURCES.map(s => [s.key, s]));

// Хосты, которые по логам Actions и пробе 24.11.2026 не отвечают раннерам GitHub (502 / таймаут)
const CI_UNREACHABLE_HOSTS = ['mk.nso.ru', 'www.nso.ru', 'nso.ru', 'culture.gov.ru', 'www.economy.gov.ru'];

/* ---------- Список лент ---------- */
test('у каждой ленты валидный https-адрес ленты и сайта, тема из известных, непустой фильтр, уникальный ключ', () => {
  for (const s of ALL_SOURCES) {
    const feed = new URL(s.feed_url);
    assert.equal(feed.protocol, 'https:', s.key);
    assert.equal(new URL(s.url).protocol, 'https:', s.key);
    assert.ok(s.name && s.key, s.key);
    assert.ok(Object.hasOwn(TOPIC_LABELS, s.topic), `${s.key}: тема ${s.topic} без подписи на сайте`);
    assert.ok(s.filter && ((s.filter.any && s.filter.any.length) || (s.filter.all && s.filter.all.length)), s.key);
  }
  assert.equal(new Set(ALL_SOURCES.map(s => s.key)).size, ALL_SOURCES.length, 'ключи уникальны');
  assert.equal(new Set(ALL_SOURCES.map(s => s.feed_url)).size, ALL_SOURCES.length, 'одна лента не подключена дважды');
  assert.equal(ALL_SOURCES.length, SOURCES.length + LOCAL_SOURCES.length, 'ALL_SOURCES — это SOURCES и LOCAL_SOURCES без потерь');
});

test('ленты, недоступные из GitHub, помечены ci_unreachable и вынесены в LOCAL_SOURCES; доступные — без флага', () => {
  for (const s of ALL_SOURCES) {
    const unreachable = CI_UNREACHABLE_HOSTS.includes(new URL(s.feed_url).host);
    assert.equal(Boolean(s.ci_unreachable), unreachable, s.key);
    assert.equal(LOCAL_SOURCES.includes(s), unreachable, s.key);
  }
  assert.ok(LOCAL_SOURCES.length >= 1 && SOURCES.length >= 5, 'есть и локальные, и доступные из CI ленты');
});

test('по темам есть хотя бы одна доступная из CI лента: культура, регион, налоги', () => {
  const topics = new Set(SOURCES.map(s => s.topic));
  for (const t of ['culture', 'city', 'taxes']) assert.ok(topics.has(t), t);
});

/* ---------- Пропуск в GitHub Actions ---------- */
test('skipInThisRun: в GitHub Actions пропускаются только ci_unreachable; локально и с NEWS_TRY_CI_UNREACHABLE — нет', () => {
  const ci = { GITHUB_ACTIONS: 'true' };
  assert.equal(skipInThisRun(byKey.mk_nso, ci), true);
  assert.equal(skipInThisRun(byKey.nsktv, ci), false);
  assert.equal(skipInThisRun(byKey.mk_nso, {}), false, 'локальный запуск качает всё');
  assert.equal(skipInThisRun(byKey.mk_nso, { ...ci, NEWS_TRY_CI_UNREACHABLE: '1' }), false);
  assert.deepEqual(ALL_SOURCES.filter(s => skipInThisRun(s, ci)).map(s => s.key).sort(), LOCAL_SOURCES.map(s => s.key).sort());
});

test('buildDoc: пропущенные ленты — не сбой (sources_failed не растёт), last_ok_at сохраняется, документ не stale', () => {
  const st = (s, status, extra = {}) => ({ status: { name: s.name, url: s.url, feed_url: s.feed_url, fetched_at: iso(NOW), status, items: 0, ...extra }, items: [] });
  const prev = { updated_at: iso(NOW - 864e5), stale: false, items: [], sources: [{ feed_url: byKey.mk_nso.feed_url, status: 'ok', last_ok_at: iso(NOW - 3 * 864e5) }] };
  const doc = buildDoc([st(byKey.mk_nso, 'skipped', { note: CI_SKIP_NOTE }), st(byKey.nsktv, 'ok'), st(byKey.klerk, 'error', { error: 'HTTP 503' })], prev, NOW);
  assert.equal(doc.stale, false);
  assert.equal(doc.sources_total, 2, 'считаются только запрошенные ленты');
  assert.equal(doc.sources_failed, 1, 'сбой — только настоящий');
  assert.equal(doc.sources_skipped, 1);
  assert.equal(doc.sources[0].last_ok_at, iso(NOW - 3 * 864e5), 'у пропущенной ленты — прежний last_ok_at');
  assert.equal(doc.sources[0].note, CI_SKIP_NOTE);
  // все запрошенные ленты упали, пропущенные не спасают — честный stale
  const allDown = buildDoc([st(byKey.mk_nso, 'skipped'), st(byKey.nsktv, 'error')], prev, NOW);
  assert.equal(allDown.stale, true);
});

/* ---------- Фильтры и темы на реальных заголовках ---------- */
const pass = (key, title) => passesFilter({ title, description: '' }, byKey[key].filter);
const topicOf = (key, title, description = '') => normalize({ title, link: 'https://example.ru/n/1', description, date: iso(NOW) }, byKey[key], NOW).topic;

test('фильтры новых лент: полезное проходит, происшествия и кинопрокат — нет', () => {
  assert.ok(pass('nsknews', 'Театр «Старый дом» открыл камерную сцену на Зыряновской'));
  assert.ok(pass('nsknews', 'Детсад на 120 мест строят в экоквартале «На Кедровой» под Новосибирском'));
  assert.ok(!pass('nsknews', 'Пожары за неделю забрали две жизни в Новосибирске (18+)'));
  assert.ok(pass('nsktv', 'Пятиклассницы из Бердска победили в конкурсе «Мы — гордость Родины»'));
  assert.ok(!pass('nsktv', 'Семейная комедия «Дедмобиль» вышла в прокат кинотеатров Новосибирска'));
  assert.ok(pass('aif_nsk', 'Лимит Пушкинской карты на кино увеличен до конца года'));
  assert.ok(pass('aif_nsk', 'В Новосибирской области начали оплачивать больничные самозанятым'));
  assert.ok(!pass('portal_kultura', '«Вас много, а Жанна одна»: Пушкинский музей заступился за маркизу де Помпадур'));
  assert.ok(pass('infopro54_culture', 'Создатели шоу-спектакля «Гэтсби» в Новосибирске пошли на мировое'));
  assert.ok(!pass('infopro54_culture', '«Сумерки» стали лидером кинопроката в Новосибирске спустя 18 лет после премьеры'));
  assert.ok(pass('infopro54_biz', 'Патенты для бизнеса в Новосибирской области подорожают в 2027 году'));
  assert.ok(pass('klerk', 'Лимиты УСН в 2027 году: таблица изменений, НДС и новые правила для бизнеса'));
  assert.ok(!pass('klerk', '7 причин выбрать курсы Клерка: обучение у практиков, диплом и помощь с карьерой'));
});

test('классификация реальных заголовков новых лент', () => {
  assert.equal(topicOf('portal_kultura', 'Подведены итоги первого грантового конкурса ПФКИ'), 'grants');
  assert.equal(topicOf('portal_kultura', 'В Томске прошла премьера оперы-сказки «Теремок» композитора Алексея Пиоттуха'), 'industry');
  assert.equal(topicOf('infopro54_culture', 'Московский ансамбль современной музыки выступит в Филармонии'), 'culture');
  assert.equal(topicOf('nsknews', 'Театр «Старый дом» открыл камерную сцену на Зыряновской'), 'city');
  assert.equal(topicOf('nsktv', 'Школьный театр из Бердска показал премьеру'), 'industry');
  assert.equal(topicOf('klerk', 'Самозанятые могут формировать пенсионный стаж добровольными взносами'), 'taxes');
  assert.equal(topicOf('infopro54_biz', 'Патенты для бизнеса в Новосибирской области подорожают в 2027 году'), 'taxes');
  // упоминание фонда в теле новости о фестивале — ещё не грант (прежнее правило не сломано)
  assert.equal(topicOf('infopro54_culture', 'Новосибирская филармония приглашает на «Белый фестиваль»', 'Проект поддержан Президентским фондом культурных инициатив'), 'culture');
});

test('запись новой ленты: имя источника и ссылка на сайт источника попадают в news.json', () => {
  const n = normalize({ title: 'Лимит Пушкинской карты на кино увеличен до конца года', link: 'https://nsk.aif.ru/culture/x', date: iso(NOW) }, byKey.aif_nsk, NOW);
  assert.equal(n.source_name, 'АиФ-Новосибирск');
  assert.equal(n.source_url, 'https://nsk.aif.ru/');
  assert.equal(n.url, 'https://nsk.aif.ru/culture/x');
});

/* Потолок на источник: частая лента не вытесняет остальные, самые свежие записи источника сохраняются */
import { mergeItems as mergeCap, MAX_PER_SOURCE as CAP } from '../scripts/fetch-news.mjs';
test('mergeItems с perSource: не больше CAP записей одного источника, редкий источник сохраняется', () => {
  const now = Date.parse('2026-11-24T12:00:00Z');
  // разные по словам заголовки, чтобы склейка похожих заголовков (dedupe) не объединила записи
  const W = ['налог', 'патент', 'театр', 'грант', 'школа', 'садик', 'премьера', 'фестиваль', 'аренда', 'лимит', 'взносы', 'отчёт', 'касса', 'билет', 'сцена', 'кукла', 'зритель', 'конкурс', 'ремонт', 'выезд', 'музыка', 'танец', 'студия', 'семья', 'каникулы', 'карта', 'ярмарка', 'лекция', 'выставка', 'опера', 'цирк'];
  const mk = (src, i) => ({ id: `${src}${i}`, title: W[i % W.length] + ' ' + W[(i * 7 + 3) % W.length] + ' ' + i, url: `https://${src}.example/${i}`, source_url: `https://${src}.example/`, published_at: new Date(now - i * 3600e3).toISOString() });
  const many = Array.from({ length: 20 }, (_, i) => mk('klerk', i));
  const rare = [mk('pfki', 30)];
  const out = mergeCap(many, rare, now, { perSource: CAP });
  assert.equal(out.filter(x => x.source_url === 'https://klerk.example/').length, CAP);
  assert.equal(out[0].id, 'klerk0');
  assert.ok(out.some(x => x.id === 'pfki30'));
});
