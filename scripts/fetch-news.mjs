#!/usr/bin/env node
/* fetch-news.mjs — «Новости отрасли»: собирает публичные RSS/Atom-ленты (культура, гранты, налоги, регион),
   фильтрует по ключевым словам, копит записи за последние 60 дней (не больше 40) и пишет data/news.json.

   Правила проекта: таймаут 10 с и повторы с паузой (fetch-util), robots.txt каждого хоста проверяется перед запросом,
   сбой одной ленты не роняет остальные, при полном сбое прежние записи сохраняются и ставится stale:true.
   Новости НЕ выдумываются: в файл попадает только то, что реально пришло из лент (заголовок, ссылка, дата источника).
   Чистые функции (parseFeed, filterItems, dedupe, normalize, mergeItems, robotsAllows) экспортируются для тестов.
   Запуск: node scripts/fetch-news.mjs (DATA_DIR=… — сухой прогон на копии данных). */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DATA_DIR, fetchRetry, readJson, writeJsonIfChanged } from './fetch-util.mjs';

/* ---------- Настройки ---------- */
export const KEEP_DAYS = 60;          // сколько дней хранить записи
export const MAX_ITEMS = 40;          // потолок записей в файле
export const SUMMARY_MAX = 200;       // длина краткого описания, знаков
const FUTURE_TOLERANCE_MS = 864e5;    // дата «из будущего» больше чем на сутки — запись отбрасывается
const UA = 'Mozilla/5.0 (compatible; news-digest-bot/1.0)';
const DAY = 864e5;

/* Ленты. Каждая проверена вручную (HTTP 200, валидный RSS) и по robots.txt — см. DATA_SOURCES.md, раздел «Новости отрасли».
   filter: any — хотя бы одно слово из списка; all — каждая группа должна совпасть хотя бы одним словом; exclude — стоп-слова;
   titleOnly — искать только в заголовке (для широких лент с длинными описаниями, иначе много шума).
   Слово с префиксом «=» ищется целиком (для коротких: «=ип»), без префикса — как основа (подстрока). */
export const SOURCES = [
  {
    key: 'mk_nso',
    name: 'Минкультуры Новосибирской области',
    url: 'https://mk.nso.ru/',
    feed_url: 'https://mk.nso.ru/rss.xml',
    topic: 'culture',
    filter: {
      any: ['театр', 'спектак', 'детск', '=дети', '=детей', 'детям', 'школьник', 'грант', 'субсид', 'конкурс', 'фестивал', 'пушкинск', 'кукол', 'творческ', '=нко', 'премия', 'господдержк']
    }
  },
  {
    key: 'nso_gov',
    name: 'Правительство Новосибирской области',
    url: 'https://www.nso.ru/',
    feed_url: 'https://www.nso.ru/rss.xml',
    topic: 'city',
    filter: {
      titleOnly: true,
      any: ['театр', 'спектак', 'культурн', 'учреждени культуры', 'сферы культуры', 'детского отдыха', 'детский досуг', 'досуг', 'предприним', 'малого бизнес', 'малого и среднего', '=мсп', 'самозанят', 'грант', 'субсид', 'пушкинск', '=нко', 'фестивал', 'дополнительного образования']
    }
  },
  {
    key: 'fns_54',
    name: 'ФНС России (УФНС по Новосибирской области)',
    url: 'https://www.nalog.gov.ru/rn54/',
    feed_url: 'https://www.nalog.gov.ru/rn54/rss/',
    https: true,
    topic: 'taxes',
    filter: {
      any: ['=усн', 'упрощ', '=ип', 'индивидуальн', 'предприним', 'патент', 'самозанят', '=нпд', 'налог на профессиональный', 'страхов', 'взнос', '=ндс', 'малого', '=мсп', '=ккт', 'онлайн-касс', 'контрольно-кассов', 'декларац', '=енс', 'единый налоговый', 'налоговый вычет', 'имущественн']
    }
  },
  {
    key: 'mkrf_news',
    name: 'Минкультуры России — новости министерства',
    url: 'https://culture.gov.ru/press/news/',
    feed_url: 'https://culture.gov.ru/rssall/rss.php?ID=2&lang=ru&TYPE=ministry&LIMIT=40&SECTION_ID=30',
    https: true,
    topic: 'culture',
    filter: {
      titleOnly: true,
      any: ['детск', 'для детей', 'юных зрител', 'кукол', 'грант', 'субсид', 'пушкинск', 'президентск', 'фонд культурных', '=нко', 'негосударствен', 'театрам', 'театров', 'новосибирск']
    }
  },
  {
    key: 'mkrf_regions',
    name: 'Минкультуры России — культурная жизнь регионов',
    url: 'https://culture.gov.ru/press/news/',
    feed_url: 'https://culture.gov.ru/rssall/rss.php?ID=34&lang=ru&TYPE=news&LIMIT=40',
    https: true,
    topic: 'culture',
    filter: {
      all: [['новосибирск', 'сибир']],
      any: ['театр', 'спектак', 'детск', 'кукол', 'грант', 'фестивал', 'пушкинск', 'конкурс']
    }
  }
];

/* ---------- Сущности и теги ---------- */
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–',
  hellip: '…', ldquo: '“', rdquo: '”', bdquo: '„', lsquo: '‘', rsquo: '’', sbquo: '‚', copy: '©', reg: '®',
  trade: '™', middot: '·', bull: '•', shy: '', thinsp: ' ', ensp: ' ', emsp: ' ', minus: '−', times: '×',
  deg: '°', numero: '№', euro: '€', rub: '₽', zwnj: '', zwj: ''
};

/* Декодирует именованные и числовые HTML-сущности. Неизвестные оставляет как есть */
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      // недопустимые кодовые точки не превращаем в символ — оставляем исходную запись
      if (!Number.isFinite(code) || code < 1 || code > 0x10FFFF || (code >= 0xD800 && code <= 0xDFFF)) return m;
      return String.fromCodePoint(code);
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/* Удаляет HTML: скрипты/стили целиком, блочные теги → пробел, прочие теги без следа; пробелы схлопываются */
export function stripTags(s) {
  return String(s)
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?(p|div|br|li|ul|ol|h[1-6]|tr|td|table|section|article|blockquote)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Текст узла XML → чистая строка: раскрыть CDATA, декодировать сущности, убрать теги, декодировать повторно
   (ленты часто экранируют HTML дважды: &amp;laquo;) */
export function cleanText(raw) {
  if (raw == null) return '';
  const unwrapped = String(raw).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  return decodeEntities(stripTags(decodeEntities(unwrapped))).replace(/\s+/g, ' ').trim();
}

/* ---------- Парсер RSS 2.0 / RSS 1.0 (RDF) / Atom без зависимостей ---------- */
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Содержимое первого тега name (без префикса пространства имён, т.е. <title>, но не <media:title>) */
function tagInner(block, name) {
  const re = new RegExp(`<${escRe(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escRe(name)}\\s*>`, 'i');
  const m = block.match(re);
  return m ? m[1] : null;
}

/* Значение атрибута в строке открывающего тега */
function attr(tag, name) {
  const m = tag.match(new RegExp(`\\s${escRe(name)}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? decodeEntities(m[2] !== undefined ? m[2] : m[3]) : null;
}

/* Ссылка Atom: <link rel="alternate" href> или <link href> без rel */
function atomLink(block) {
  const links = block.match(/<link\b[^>]*>/gi) || [];
  let fallback = null;
  for (const l of links) {
    const href = attr(l, 'href');
    if (!href) continue;
    const rel = attr(l, 'rel');
    if (!rel || rel === 'alternate') return href;
    if (!fallback && rel !== 'self' && rel !== 'enclosure') fallback = href;
  }
  return fallback;
}

/* Разбирает текст ленты. Возвращает { format, title, items:[{title, link, description, date}] }.
   date — исходная строка даты или null. Бросает Error, если это не RSS/Atom (битый ответ, HTML-заглушка). */
export function parseFeed(xml) {
  const text = String(xml || '').replace(/^﻿/, '');
  // комментарии убираем до поиска блоков, чтобы закомментированный <item> не попал в выдачу
  const src = text.replace(/<!--[\s\S]*?-->/g, '');
  let format = null;
  if (/<rss[\s>]/i.test(src)) format = 'rss';
  else if (/<rdf:RDF[\s>]/i.test(src)) format = 'rdf';
  else if (/<feed[\s>]/i.test(src)) format = 'atom';
  if (!format) throw new Error('ответ не похож на RSS/Atom');

  const isAtom = format === 'atom';
  const blockRe = isAtom ? /<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/gi : /<item\b[^>]*>([\s\S]*?)<\/item\s*>/gi;
  // заголовок ленты — до первого элемента
  const head = src.split(isAtom ? /<entry\b/i : /<item\b/i)[0];
  const title = cleanText(tagInner(head, 'title'));

  const items = [];
  for (const m of src.matchAll(blockRe)) {
    const b = m[1];
    let link;
    if (isAtom) link = atomLink(b);
    else {
      link = cleanText(tagInner(b, 'link'));
      // RSS без <link>: guid с isPermaLink (по умолчанию true) тоже ссылка
      if (!link) {
        const g = b.match(/<guid\b([^>]*)>([\s\S]*?)<\/guid\s*>/i);
        if (g && !/isPermaLink\s*=\s*["']false["']/i.test(g[1])) link = cleanText(g[2]);
      }
    }
    const description = isAtom
      ? (tagInner(b, 'summary') ?? tagInner(b, 'content') ?? '')
      : (tagInner(b, 'description') ?? tagInner(b, 'content:encoded') ?? '');
    const date = isAtom
      ? (tagInner(b, 'published') ?? tagInner(b, 'updated'))
      : (tagInner(b, 'pubDate') ?? tagInner(b, 'dc:date'));
    items.push({
      title: cleanText(tagInner(b, 'title')),
      link: link ? link.trim() : null,
      description: cleanText(description),
      date: date ? cleanText(date) : null
    });
  }
  return { format, title, items };
}

/* ---------- Фильтр по ключевым словам ---------- */
const WORD_CH = 'a-zа-яё0-9';

/* Совпадение одного ключевого слова: «=слово» — целиком, иначе — как основа (подстрока). Текст уже в нижнем регистре */
export function matchKeyword(text, kw) {
  const k = String(kw).toLowerCase();
  if (k.startsWith('=')) {
    const w = escRe(k.slice(1));
    return new RegExp(`(?<![${WORD_CH}])${w}(?![${WORD_CH}])`, 'u').test(text);
  }
  return text.includes(k);
}

/* Проверяет запись по фильтру источника. Без фильтра пропускает всё */
export function passesFilter(item, filter) {
  if (!filter) return true;
  const text = (filter.titleOnly ? String(item.title || '') : `${item.title || ''} ${item.description || ''}`).toLowerCase().replace(/ё/g, 'е');
  const has = list => list.some(k => matchKeyword(text, String(k).replace(/ё/g, 'е')));
  if (filter.exclude && filter.exclude.length && has(filter.exclude)) return false;
  if (filter.all && !filter.all.every(group => has(Array.isArray(group) ? group : [group]))) return false;
  if (filter.any && filter.any.length && !has(filter.any)) return false;
  return true;
}

/* Оставляет записи, прошедшие фильтр */
export function filterItems(items, filter) {
  return (items || []).filter(it => passesFilter(it, filter));
}

/* ---------- Нормализация ---------- */
/* Стабильный id записи: sha1 от нормализованной ссылки, первые 12 знаков */
export function stableId(url) {
  return createHash('sha1').update(canonicalUrl(url)).digest('hex').slice(0, 12);
}

/* Каноническая ссылка для сравнения: без якоря, без utm-меток, без схемы и «www.», без завершающего «/» */
export function canonicalUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (/^utm_|^from$|^yclid$|^fbclid$/i.test(k)) u.searchParams.delete(k);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    return (host + u.pathname.replace(/\/+$/, '') + (u.search || '')).toLowerCase();
  } catch {
    return String(url).trim().toLowerCase();
  }
}

/* Обрезка текста по границе слова с многоточием */
export function truncate(s, max = SUMMARY_MAX) {
  const t = String(s || '').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:—–-]+$/, '') + '…';
}

/* Дата из RSS/Atom → ISO UTC или null */
export function parseDate(s) {
  if (!s) return null;
  const t = Date.parse(String(s).trim());
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const TOPIC_RULES = [
  ['grants', ['грант', 'субсид', 'президентск', 'фонд культурных', 'конкурсн отбор', 'конкурс проектов']],
  ['industry', ['детский театр', 'детского театра', 'детских театр', 'кукольн', 'театр кукол', 'театр для детей', 'для детей', 'детский спектакл', 'детских спектакл', 'юного зрителя', '=тюз', 'детские праздник', 'аниматор']]
];

/* Тема записи: налоговая лента — всегда taxes; иначе гранты/индустрия по словам, по умолчанию — тема источника */
export function classify(item, source) {
  if (source.topic === 'taxes') return 'taxes';
  const text = `${item.title} ${item.description || ''}`.toLowerCase();
  for (const [topic, words] of TOPIC_RULES) if (words.some(w => text.includes(w))) return topic;
  return source.topic || 'industry';
}

/* Сырая запись ленты → запись news.json или null (нет заголовка/ссылки/даты, дата из будущего) */
export function normalize(raw, source, now = Date.now()) {
  if (!raw || !raw.title || !raw.link) return null;
  let url = raw.link;
  if (!/^https?:\/\//i.test(url)) {
    // относительная ссылка — достраиваем от адреса ленты
    try { url = new URL(url, source.feed_url).href; } catch { return null; }
  }
  if (source.https) url = url.replace(/^http:\/\//i, 'https://');
  const published = parseDate(raw.date);
  if (!published) return null;
  if (Date.parse(published) - now > FUTURE_TOLERANCE_MS) return null;
  return {
    id: stableId(url),
    title: truncate(raw.title, 240),
    summary: truncate(raw.description || '', SUMMARY_MAX),
    url,
    source_name: source.name,
    source_url: source.url,
    published_at: published,
    topic: classify(raw, source)
  };
}

/* ---------- Дедупликация, окно хранения ---------- */
/* Нормализованный заголовок → множество слов длиной от 3 знаков */
function titleTokens(t) {
  return new Set(String(t).toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').split(' ').filter(w => w.length > 2));
}

/* Похожесть заголовков: максимум из коэффициента Жаккара и коэффициента вложения (пересечение / меньший заголовок).
   Вложение ловит перепечатку одной новости разными ведомствами с дописанным хвостом («… «Из Сибири с Джазом»»);
   для коротких заголовков (меньше 5 слов) учитывается только Жаккар, иначе совпадали бы случайные пары */
export function titleSimilarity(a, b) {
  const A = titleTokens(a), B = titleTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const jaccard = inter / (A.size + B.size - inter);
  const minSize = Math.min(A.size, B.size);
  const overlap = minSize >= 5 ? inter / minSize : 0;
  return Math.max(jaccard, overlap);
}

/* Убирает дубли: одинаковая каноническая ссылка или заголовки похожи ≥ 0.8 (см. titleSimilarity).
   Из дублей остаётся первая встреченная запись (вызывающий кладёт приоритетные первыми) */
export function dedupe(items, threshold = 0.8) {
  const out = [];
  const seen = new Set();
  for (const it of items || []) {
    const key = canonicalUrl(it.url);
    if (seen.has(key)) continue;
    if (out.some(o => titleSimilarity(o.title, it.title) >= threshold)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

/* Свежие записи + накопленные: дедуп (свежие приоритетнее), окно KEEP_DAYS, сортировка по дате (новые выше), потолок MAX_ITEMS */
export function mergeItems(fresh, previous, now = Date.now(), { keepDays = KEEP_DAYS, max = MAX_ITEMS } = {}) {
  const from = now - keepDays * DAY;
  const all = dedupe([...(fresh || []), ...(previous || [])])
    .filter(it => {
      const t = Date.parse(it.published_at);
      return Number.isFinite(t) && t >= from && t - now <= FUTURE_TOLERANCE_MS;
    });
  all.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at) || a.id.localeCompare(b.id));
  return all.slice(0, max);
}

/* ---------- robots.txt ---------- */
/* Разрешён ли путь (с query) для агента «*». Правила: длиннейшее совпадение побеждает, при равенстве — Allow;
   поддерживаются «*» и «$». Группа выбирается по User-agent: * (свой агент мы не называем). */
export function robotsAllows(robotsTxt, pathWithQuery) {
  const lines = String(robotsTxt || '').split(/\r?\n/).map(l => l.replace(/#.*/, '').trim());
  const rules = [];
  let inStar = false, lastWasAgent = false;
  for (const line of lines) {
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1].toLowerCase(), value = m[2].trim();
    if (field === 'user-agent') {
      // подряд идущие User-agent образуют одну группу
      if (!lastWasAgent) inStar = false;
      if (value === '*') inStar = true;
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!inStar) continue;
    if ((field === 'allow' || field === 'disallow') && value) rules.push({ allow: field === 'allow', pattern: value });
  }
  let best = null;
  for (const r of rules) {
    const re = new RegExp('^' + r.pattern.split('*').map(escRe).join('.*').replace(/\\\$$/, '$'));
    if (!re.test(pathWithQuery)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

/* ---------- Сеть ---------- */
const robotsCache = new Map();

/* Загружает robots.txt хоста (кэш на прогон). 4xx — ограничений нет; сеть/5xx — считаем недоступным (не запрашиваем ленту) */
async function robotsFor(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  let res;
  try {
    const r = await fetchRetry(`${origin}/robots.txt`, { headers: { 'User-Agent': UA } }, { retries: 2, label: `${origin}/robots.txt` });
    res = { ok: true, text: await r.text() };
  } catch (e) {
    const m = /HTTP (\d{3})/.exec(e.message);
    res = m && +m[1] >= 400 && +m[1] < 500 ? { ok: true, text: '' } : { ok: false, error: e.message };
  }
  robotsCache.set(origin, res);
  return res;
}

/* Одна лента: robots → загрузка → разбор → фильтр → нормализация. Не бросает: возвращает статус и записи */
export async function fetchSource(source, now = Date.now()) {
  const fetched_at = new Date(now).toISOString();
  const base = { name: source.name, url: source.url, feed_url: source.feed_url, fetched_at };
  try {
    const u = new URL(source.feed_url);
    const robots = await robotsFor(u.origin);
    if (!robots.ok) throw new Error(`robots.txt недоступен: ${robots.error}`);
    if (!robotsAllows(robots.text, u.pathname + u.search)) throw new Error('путь запрещён robots.txt');
    const r = await fetchRetry(source.feed_url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' }
    }, { label: source.name });
    const feed = parseFeed(await r.text());
    const items = filterItems(feed.items, source.filter).map(it => normalize(it, source, now)).filter(Boolean);
    return { status: { ...base, status: items.length ? 'ok' : 'empty', items: items.length, total: feed.items.length }, items };
  } catch (e) {
    return { status: { ...base, status: 'error', items: 0, error: String(e.message || e).slice(0, 200) }, items: [] };
  }
}

/* Сравнение без меток времени: если по существу ничего не изменилось, файл не переписываем (нет пустых коммитов бота) */
function essence(doc) {
  return JSON.stringify({
    stale: doc.stale,
    sources: (doc.sources || []).map(({ fetched_at, ...s }) => s),
    items: doc.items
  });
}

/* Собирает итоговый документ из результатов лент и прежнего файла (чистая функция) */
export function buildDoc(results, prev, now = Date.now()) {
  const nowIso = new Date(now).toISOString();
  const anyOk = results.some(r => r.status.status !== 'error');
  const fresh = results.flatMap(r => r.items);
  const prevItems = prev && Array.isArray(prev.items) ? prev.items : [];
  const doc = {
    updated_at: anyOk ? nowIso : (prev && prev.updated_at) || null,
    stale: !anyOk,
    keep_days: KEEP_DAYS,
    max_items: MAX_ITEMS,
    sources: results.map(r => r.status),
    items: mergeItems(fresh, prevItems, now)
  };
  if (!anyOk) {
    // полный сбой: записи — прежние, отметка времени первого сбоя не сдвигается
    doc.stale_since = (prev && prev.stale_since) || nowIso;
    doc.stale_reason = 'все ленты недоступны';
  }
  return doc;
}

/* ---------- Точка входа ---------- */
async function main() {
  const file = join(DATA_DIR, 'news.json');
  let prev = null;
  if (existsSync(file)) {
    try { prev = readJson(file); } catch (e) { console.error(`news.json не читается (${e.message}) — начинаем с пустого списка`); }
  }
  const now = Date.now();
  // ленты на разных хостах качаем параллельно; один хост (culture.gov.ru) — последовательно, чтобы не нагружать
  const byHost = new Map();
  for (const s of SOURCES) {
    const h = new URL(s.feed_url).host;
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push(s);
  }
  const resultsByKey = new Map();
  await Promise.all([...byHost.values()].map(async group => {
    for (const s of group) resultsByKey.set(s.key, await fetchSource(s, now));
  }));
  const results = SOURCES.map(s => resultsByKey.get(s.key));
  for (const r of results) {
    const st = r.status;
    console.log(`${st.status.padEnd(5)} ${st.name}: ${st.items} из ${st.total ?? 0}${st.error ? ' — ' + st.error : ''}`);
  }

  const doc = buildDoc(results, prev, now);
  if (prev && essence(prev) === essence(doc)) {
    console.log(`news.json: без изменений по существу (${doc.items.length} записей)`);
    return;
  }
  writeJsonIfChanged(file, doc);
  console.log(`news.json: ${doc.items.length} записей${doc.stale ? ' (stale — ленты недоступны, оставлены прежние)' : ''}`);
}

/* Запуск только как скрипт; при импорте из тестов сеть не трогаем */
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(e => { console.error('fetch-news:', e && e.message ? e.message : e); process.exit(1); });
}
