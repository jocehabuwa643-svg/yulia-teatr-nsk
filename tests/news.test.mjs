/* Тесты «Новостей отрасли»: парсер RSS/Atom, фильтр ключевых слов, дедуп, окно хранения 60 дней / 40 записей,
   сборка news.json при сбоях лент, robots.txt и отбор свежих новостей для дайджеста и плашки (js/news.js).
   Сеть не используется: всё на строках-фикстурах и инъекции «сейчас». */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {
  parseFeed, cleanText, decodeEntities, stripTags, filterItems, passesFilter, matchKeyword, dedupe, normalize,
  mergeItems, buildDoc, robotsAllows, canonicalUrl, stableId, truncate, parseDate, titleSimilarity, classify,
  SOURCES, KEEP_DAYS, MAX_ITEMS, SUMMARY_MAX
} from '../scripts/fetch-news.mjs';
import { freshNews, pickUnseen, relativeDay, isNewsUsable, initNews, TOPIC_LABELS } from '../js/news.js';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const DAY = 864e5;
const iso = ms => new Date(ms).toISOString();
const SRC = { key: 't', name: 'Тестовый источник', url: 'https://example.ru/', feed_url: 'https://example.ru/rss.xml', topic: 'culture' };

/* ---------- Парсер ---------- */
const RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
<title>Лента &amp; новости</title>
<item>
  <title><![CDATA[Грант для «детского театра» <b>открыт</b>]]></title>
  <link>https://example.ru/news/1</link>
  <media:title>НЕ ЭТОТ заголовок</media:title>
  <description>&lt;p&gt;Приём заявок&amp;nbsp;до 1&amp;nbsp;декабря&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;</description>
  <pubDate>Thu, 19 Nov 2026 17:00:31 GMT</pubDate>
</item>
<!-- <item><title>Закомментировано</title><link>https://example.ru/x</link></item> -->
<item>
  <title>Без ссылки, но с guid</title>
  <guid isPermaLink="true">https://example.ru/news/2</guid>
  <description><![CDATA[<img src="x.jpg" /> Текст &laquo;в кавычках&raquo; &#8212; тире &#x2116;]]></description>
  <pubDate>Wed, 18 Nov 2026 10:00:00 +0300</pubDate>
</item>
<item><title>Нет даты</title><link>https://example.ru/news/3</link></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">Атом-лента</title>
  <link rel="self" href="https://example.org/feed.atom"/>
  <entry>
    <title type="html">Спектакль &amp;laquo;Репка&amp;raquo;</title>
    <link rel="enclosure" href="https://example.org/a.mp3"/>
    <link rel="alternate" type="text/html" href="https://example.org/post?a=1&amp;b=2"/>
    <id>tag:example.org,2026:1</id>
    <updated>2026-11-19T08:00:00Z</updated>
    <published>2026-11-18T08:00:00+07:00</published>
    <summary type="html">&lt;p&gt;Кукольный театр для детей&lt;/p&gt;</summary>
  </entry>
  <entry>
    <title>Только updated и content</title>
    <link href="https://example.org/post2"/>
    <updated>2026-11-17T00:00:00Z</updated>
    <content type="html"><![CDATA[<div>Содержимое</div>]]></content>
  </entry>
</feed>`;

test('parseFeed: RSS — CDATA, сущности, теги, guid как ссылка, без даты, комментарии', () => {
  const f = parseFeed(RSS);
  assert.equal(f.format, 'rss');
  assert.equal(f.title, 'Лента & новости');
  assert.equal(f.items.length, 3, 'закомментированный <item> не попадает');
  const [a, b, c] = f.items;
  assert.equal(a.title, 'Грант для «детского театра» открыт');
  assert.equal(a.link, 'https://example.ru/news/1');
  assert.equal(a.description, 'Приём заявок до 1 декабря', 'дважды экранированный HTML и <script> вычищены');
  assert.equal(a.date, 'Thu, 19 Nov 2026 17:00:31 GMT');
  assert.equal(b.link, 'https://example.ru/news/2');
  assert.equal(b.description, 'Текст «в кавычках» — тире №');
  assert.equal(c.date, null);
});

test('parseFeed: Atom — alternate-ссылка, &amp; в href, published приоритетнее updated, content вместо summary', () => {
  const f = parseFeed(ATOM);
  assert.equal(f.format, 'atom');
  assert.equal(f.title, 'Атом-лента');
  assert.equal(f.items.length, 2);
  assert.equal(f.items[0].title, 'Спектакль «Репка»');
  assert.equal(f.items[0].link, 'https://example.org/post?a=1&b=2');
  assert.equal(f.items[0].date, '2026-11-18T08:00:00+07:00');
  assert.equal(f.items[0].description, 'Кукольный театр для детей');
  assert.equal(f.items[1].link, 'https://example.org/post2');
  assert.equal(f.items[1].date, '2026-11-17T00:00:00Z');
  assert.equal(f.items[1].description, 'Содержимое');
});

test('parseFeed: RDF (RSS 1.0) разбирается как RSS', () => {
  const f = parseFeed('<rdf:RDF xmlns:rdf="x"><channel><title>R</title></channel><item><title>Один</title><link>https://e.ru/1</link><dc:date>2026-11-19T00:00:00Z</dc:date></item></rdf:RDF>');
  assert.equal(f.format, 'rdf');
  assert.equal(f.items[0].date, '2026-11-19T00:00:00Z');
});

test('parseFeed: пустая лента — ноль записей; битый ответ (HTML, пусто, мусор) — исключение', () => {
  assert.deepEqual(parseFeed('<rss version="2.0"><channel><title>Пусто</title></channel></rss>').items, []);
  assert.throws(() => parseFeed('<!doctype html><html><body>404</body></html>'), /RSS\/Atom/);
  assert.throws(() => parseFeed(''), /RSS\/Atom/);
  assert.throws(() => parseFeed(null), /RSS\/Atom/);
  // незакрытый <item> просто не даёт записи, а не роняет разбор
  assert.deepEqual(parseFeed('<rss><channel><item><title>Оборвано').items, []);
});

test('decodeEntities / stripTags / cleanText: граничные случаи', () => {
  assert.equal(decodeEntities('&amp;lt; &#x41; &#65; &unknown; &#0; &#xD800;'), '&lt; A A &unknown; &#0; &#xD800;');
  assert.equal(stripTags('<p>Раз</p><p>два<br/>три</p><style>.a{}</style>'), 'Раз два три');
  assert.equal(cleanText(undefined), '');
  assert.equal(cleanText('<![CDATA[a &amp; b]]>'), 'a & b');
});

/* ---------- Фильтр ---------- */
test('matchKeyword: «=слово» — целиком (ИП не находится в «типа»), иначе — основа', () => {
  assert.equal(matchKeyword('новые правила для ип в 2027 году', '=ип'), true);
  assert.equal(matchKeyword('типичная ошибка', '=ип'), false);
  assert.equal(matchKeyword('детского театра', 'детск'), true);
});

test('filterItems: any / all / exclude / titleOnly, ё = е', () => {
  const items = [
    { title: 'Детский спектакль в Новосибирске', description: '' },
    { title: 'Совещание по ЖКХ', description: 'упомянут театр' },
    { title: 'Ремонт дороги', description: '' },
    { title: 'Ёлка для детей в Сибири', description: '' }
  ];
  assert.deepEqual(filterItems(items, { any: ['театр', 'спектак'] }).map(i => i.title), ['Детский спектакль в Новосибирске', 'Совещание по ЖКХ']);
  assert.deepEqual(filterItems(items, { titleOnly: true, any: ['театр', 'спектак'] }).map(i => i.title), ['Детский спектакль в Новосибирске']);
  assert.deepEqual(filterItems(items, { all: [['новосибирск', 'сибир']], any: ['детск', 'для детей'] }).map(i => i.title), ['Детский спектакль в Новосибирске', 'Ёлка для детей в Сибири']);
  assert.deepEqual(filterItems(items, { any: ['елка'] }).map(i => i.title), ['Ёлка для детей в Сибири']);
  assert.equal(passesFilter(items[0], { any: ['спектак'], exclude: ['новосибирск'] }), false);
  assert.equal(filterItems(items, null).length, 4);
  assert.deepEqual(filterItems(undefined, { any: ['x'] }), []);
});

test('у каждой ленты в SOURCES есть имя, https-адреса, тема из списка и непустой фильтр', () => {
  const topics = new Set(['grants', 'taxes', 'culture', 'city', 'industry']);
  assert.ok(SOURCES.length >= 3 && SOURCES.length <= 8);
  for (const s of SOURCES) {
    assert.ok(s.name && s.key, s.key);
    assert.match(s.feed_url, /^https:\/\//, s.key);
    assert.match(s.url, /^https:\/\//, s.key);
    assert.ok(topics.has(s.topic), s.key);
    assert.ok(s.filter && ((s.filter.any && s.filter.any.length) || (s.filter.all && s.filter.all.length)), s.key);
  }
  assert.equal(new Set(SOURCES.map(s => s.key)).size, SOURCES.length, 'ключи уникальны');
});

/* ---------- Нормализация ---------- */
test('normalize: формат записи, https-апгрейд, обрезка описания, отбраковка без даты/ссылки/из будущего', () => {
  const src = { ...SRC, https: true, topic: 'taxes' };
  const long = 'слово '.repeat(80);
  const n = normalize({ title: 'Новое для ИП', link: 'http://example.ru/a', description: long, date: 'Thu, 19 Nov 2026 17:00:31 GMT' }, src, NOW);
  assert.deepEqual(Object.keys(n).sort(), ['id', 'published_at', 'source_name', 'source_url', 'summary', 'title', 'topic', 'url'].sort());
  assert.equal(n.url, 'https://example.ru/a');
  assert.equal(n.published_at, '2026-11-19T17:00:31.000Z');
  assert.equal(n.topic, 'taxes');
  assert.ok(n.summary.length <= SUMMARY_MAX && n.summary.endsWith('…'));
  assert.match(n.id, /^[0-9a-f]{12}$/);
  assert.equal(normalize({ title: 'Без даты', link: 'https://e.ru/1', date: null }, SRC, NOW), null);
  assert.equal(normalize({ title: 'Плохая дата', link: 'https://e.ru/1', date: 'вчера' }, SRC, NOW), null);
  assert.equal(normalize({ title: '', link: 'https://e.ru/1', date: iso(NOW) }, SRC, NOW), null);
  assert.equal(normalize({ title: 'Нет ссылки', link: null, date: iso(NOW) }, SRC, NOW), null);
  assert.equal(normalize({ title: 'Из будущего', link: 'https://e.ru/f', date: iso(NOW + 3 * DAY) }, SRC, NOW), null);
  // относительная ссылка достраивается от адреса ленты
  assert.equal(normalize({ title: 'Относительная', link: '/news/7', date: iso(NOW) }, SRC, NOW).url, 'https://example.ru/news/7');
});

test('classify: гранты и детский театр распознаются, налоговая лента — всегда taxes', () => {
  assert.equal(classify({ title: 'Открыт приём заявок на грант' }, SRC), 'grants');
  assert.equal(classify({ title: 'Кукольный театр показал премьеру' }, SRC), 'industry');
  assert.equal(classify({ title: 'Выставка в музее' }, SRC), 'culture');
  assert.equal(classify({ title: 'Грант' }, { topic: 'taxes' }), 'taxes');
});

test('canonicalUrl / stableId: id не зависит от схемы, www, utm и якоря', () => {
  const a = stableId('http://www.example.ru/news/1/?utm_source=x#top');
  const b = stableId('https://example.ru/news/1');
  assert.equal(a, b);
  assert.notEqual(stableId('https://example.ru/news/2'), b);
  assert.equal(canonicalUrl('https://example.ru/a?id=5&utm_medium=y'), 'example.ru/a?id=5');
});

test('truncate и parseDate', () => {
  assert.equal(truncate('коротко', 200), 'коротко');
  assert.ok(truncate('а'.repeat(500), 200).length <= 200);
  assert.equal(parseDate('Fri, 20 Nov 2026 11:30:00 +0000'), '2026-11-20T11:30:00.000Z');
  assert.equal(parseDate(''), null);
  assert.equal(parseDate('не дата'), null);
});

/* ---------- Дедуп и окно ---------- */
const mk = (n, daysAgo, extra = {}) => ({
  id: `id${n}`, title: `Новость n${n}x q${n}y z${n}w событие${n}`, // уникальные слова — дедуп по заголовку их не склеит
  summary: '', url: `https://example.ru/n/${n}`, source_name: 'И', source_url: 'https://example.ru/',
  published_at: iso(NOW - daysAgo * DAY), topic: 'culture', ...extra
});

test('dedupe: одинаковая ссылка (с разной схемой) и похожий заголовок — одна запись, первая сохраняется', () => {
  const a = mk(1, 1);
  const sameUrl = { ...mk(2, 1), url: 'http://www.example.ru/n/1/' };
  const similar = { ...mk(3, 1), title: 'В Новосибирске открылся XVIII Международный молодёжный джазовый фестиваль' };
  const similar2 = { ...mk(4, 1), title: 'В Новосибирске стартует XVIII Международный молодёжный джазовый фестиваль «Из Сибири с Джазом»' };
  const out = dedupe([a, sameUrl, similar, similar2]);
  assert.deepEqual(out.map(i => i.id), ['id1', 'id3']);
  assert.ok(titleSimilarity(similar.title, similar2.title) >= 0.8);
  assert.ok(titleSimilarity('Выставка в музее', 'Концерт в филармонии') < 0.8);
  // короткие заголовки сравниваются только по Жаккару
  assert.ok(titleSimilarity('Грант открыт', 'Грант открыт сегодня для всех желающих') < 0.8);
  assert.deepEqual(dedupe([]), []);
});

test('mergeItems: окно 60 дней, максимум 40, сортировка по дате, свежие приоритетнее накопленных', () => {
  const prev = Array.from({ length: 50 }, (_, i) => mk(i, i * 1.5)); // от 0 до 73,5 дня назад
  const freshCopy = { ...mk(0, 0), title: prev[0].title, summary: 'обновлено' };
  const out = mergeItems([freshCopy], prev, NOW);
  assert.equal(out.length, MAX_ITEMS);
  assert.ok(out.every(i => NOW - Date.parse(i.published_at) <= KEEP_DAYS * DAY));
  for (let i = 1; i < out.length; i++) assert.ok(Date.parse(out[i - 1].published_at) >= Date.parse(out[i].published_at));
  assert.equal(out[0].summary, 'обновлено');
  // без потолка видно, что старше 60 дней отрезано
  const all = mergeItems([], prev, NOW, { max: 1000 });
  assert.equal(all.length, prev.filter(i => NOW - Date.parse(i.published_at) <= KEEP_DAYS * DAY).length);
  assert.deepEqual(mergeItems([], [], NOW), []);
  // запись с битой датой в накопленных не ломает слияние
  assert.equal(mergeItems([], [{ ...mk(99, 1), published_at: 'нет' }], NOW).length, 0);
});

/* ---------- Сборка файла при сбоях ---------- */
const st = (status) => ({ status: { name: 'И', url: 'u', feed_url: 'f', fetched_at: iso(NOW), status, items: 0 }, items: [] });

test('buildDoc: частичный сбой — не stale; полный сбой — прежние записи сохраняются, stale:true, stale_since не сдвигается', () => {
  const prev = { updated_at: iso(NOW - 2 * DAY), stale: false, items: [mk(1, 2)] };
  const okRes = { ...st('ok'), items: [mk(2, 0)] };
  const d1 = buildDoc([okRes, st('error')], prev, NOW);
  assert.equal(d1.stale, false);
  assert.equal(d1.updated_at, iso(NOW));
  assert.deepEqual(d1.items.map(i => i.id), ['id2', 'id1']);
  assert.equal(d1.sources.length, 2);

  const d2 = buildDoc([st('error'), st('error')], prev, NOW);
  assert.equal(d2.stale, true);
  assert.equal(d2.updated_at, prev.updated_at, 'время последнего успеха не подменяется');
  assert.deepEqual(d2.items.map(i => i.id), ['id1']);
  assert.equal(d2.stale_since, iso(NOW));
  const d3 = buildDoc([st('error')], d2, NOW + DAY);
  assert.equal(d3.stale_since, iso(NOW), 'отметка первого сбоя сохраняется');

  // пустые ленты — не сбой
  assert.equal(buildDoc([st('empty')], null, NOW).stale, false);
  // первый запуск при полном сбое: пустой список, честный stale
  const d4 = buildDoc([st('error')], null, NOW);
  assert.deepEqual(d4.items, []);
  assert.equal(d4.updated_at, null);
  assert.equal(d4.stale, true);
});

/* ---------- robots.txt ---------- */
test('robotsAllows: группа *, длиннейшее совпадение, Allow при равенстве, * и $', () => {
  const google = 'User-agent: *\nDisallow: /\nAllow: /$\nAllow: /topics/\n\nUser-agent: Googlebot\nAllow: /rss';
  assert.equal(robotsAllows(google, '/rss/search?q=театр'), false);
  assert.equal(robotsAllows(google, '/topics/abc'), true);
  assert.equal(robotsAllows(google, '/'), true);
  const fns = 'User-agent: Googlebot\nDisallow: /rn*/rss_region/\n\nUser-agent: *\nDisallow: /rn*/rss_region/\nDisallow: /rn*/search/';
  assert.equal(robotsAllows(fns, '/rn54/rss/'), true);
  assert.equal(robotsAllows(fns, '/rn54/rss_region/'), false);
  const mk = 'User-Agent: *\nDisallow: /*t=\nDisallow: /bitrix/';
  assert.equal(robotsAllows(mk, '/rssall/rss.php?ID=2&lang=ru&TYPE=ministry'), true, 'регистр важен: TYPE= не t=');
  assert.equal(robotsAllows(mk, '/news?t=1'), false);
  assert.equal(robotsAllows('', '/any'), true);
  assert.equal(robotsAllows('User-agent: a\nUser-agent: *\nDisallow: /x', '/x/1'), false, 'подряд идущие User-agent — одна группа');
});

/* ---------- Файл данных ---------- */
test('data/news.json: схема, id уникальны, не больше 40 записей, даты ISO, ссылки http(s), темы из списка', () => {
  const file = new URL('../data/news.json', import.meta.url);
  assert.ok(existsSync(file), 'data/news.json есть в репозитории');
  const d = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(typeof d.stale, 'boolean');
  assert.ok(Array.isArray(d.sources) && Array.isArray(d.items));
  assert.ok(d.items.length <= MAX_ITEMS);
  for (const s of d.sources) {
    assert.ok(['ok', 'error', 'empty'].includes(s.status), s.name);
    assert.ok(s.name && s.url && s.feed_url && s.fetched_at, s.name);
  }
  const ids = new Set();
  for (const it of d.items) {
    assert.ok(!ids.has(it.id), 'дубль id ' + it.id); ids.add(it.id);
    assert.ok(it.title && it.source_name && it.source_url, it.id);
    assert.match(it.url, /^https?:\/\//);
    assert.ok(!Number.isNaN(Date.parse(it.published_at)) && it.published_at.endsWith('Z'), it.id);
    assert.ok(Object.prototype.hasOwnProperty.call(TOPIC_LABELS, it.topic), it.topic);
    assert.ok(it.summary.length <= SUMMARY_MAX);
    assert.ok(!/<[a-z!/]/i.test(it.title + it.summary), 'без HTML: ' + it.id);
  }
});

/* ---------- UI: чистые функции js/news.js ---------- */
const data = (items, extra = {}) => ({ updated_at: iso(NOW - DAY), stale: false, items, ...extra });

test('freshNews: окно 14 дней от инъецированного now, сортировка, отбраковка битых записей', () => {
  const items = [mk(1, 20), mk(2, 3), mk(3, 0.1), mk(4, 13.9), { ...mk(5, 1), url: 'javascript:alert(1)' }, { ...mk(6, 1), published_at: 'x' }, { ...mk(7, -3) }];
  const out = freshNews(data(items), NOW);
  assert.deepEqual(out.map(i => i.id), ['id3', 'id2', 'id4']);
  assert.deepEqual(freshNews(data(items), NOW, 30).map(i => i.id), ['id3', 'id2', 'id4', 'id1']);
  // тот же файл через месяц — свежего нет
  assert.deepEqual(freshNews(data(items), NOW + 30 * DAY), []);
  assert.deepEqual(freshNews(null, NOW), []);
  assert.deepEqual(freshNews({ items: [] }, NOW), []);
});

test('isNewsUsable: stale старше 14 дней — не показываем; stale свежий — показываем', () => {
  const items = [mk(1, 1)];
  assert.equal(isNewsUsable(data(items), NOW), true);
  assert.equal(isNewsUsable(data(items, { stale: true, updated_at: iso(NOW - 15 * DAY) }), NOW), false);
  assert.equal(isNewsUsable(data(items, { stale: true, updated_at: iso(NOW - 2 * DAY) }), NOW), true);
  assert.equal(isNewsUsable(data(items, { stale: true, updated_at: null }), NOW), false);
  assert.equal(freshNews(data(items, { stale: true, updated_at: iso(NOW - 20 * DAY) }), NOW).length, 0);
});

test('pickUnseen: только непоказанные, не больше 3', () => {
  const items = [mk(1, 0), mk(2, 0), mk(3, 0), mk(4, 0), mk(5, 0)];
  assert.deepEqual(pickUnseen(items, ['id1', 'id3']).map(i => i.id), ['id2', 'id4', 'id5']);
  assert.deepEqual(pickUnseen(items, items.map(i => i.id)), []);
  assert.deepEqual(pickUnseen(items, null, 2).map(i => i.id), ['id1', 'id2']);
});

test('relativeDay: сегодня / вчера / N дней назад с правильным склонением', () => {
  const noon = new Date(2026, 10, 20, 12, 0, 0).getTime(); // местный полдень — без граничных эффектов часового пояса
  assert.equal(relativeDay(iso(noon - 3600e3), noon), 'сегодня');
  assert.equal(relativeDay(iso(noon - DAY), noon), 'вчера');
  assert.equal(relativeDay(iso(noon - 2 * DAY), noon), '2 дня назад');
  assert.equal(relativeDay(iso(noon - 5 * DAY), noon), '5 дней назад');
  assert.equal(relativeDay('не дата', noon), '');
  assert.ok(relativeDay(iso(noon - 10 * DAY), noon).length > 0);
});

test('initNews без DOM или без свежих новостей — ничего не вешает и возвращает пустой список', () => {
  const r1 = initNews(data([mk(1, 1)]), { now: NOW, doc: null, win: null });
  assert.deepEqual(r1.items.map(i => i.id), ['id1']);
  assert.equal(r1.show(), false);
  const r2 = initNews(data([mk(1, 40)]), { now: NOW, doc: null, win: null });
  assert.deepEqual(r2.items, []);
});
