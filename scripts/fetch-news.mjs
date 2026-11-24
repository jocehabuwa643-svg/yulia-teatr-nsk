#!/usr/bin/env node
/* fetch-news.mjs — «Новости отрасли»: собирает публичные RSS/Atom-ленты (культура, гранты, налоги, регион, школы и сады),
   фильтрует по ключевым словам, копит записи за последние 60 дней (не больше 40) и пишет data/news.json.

   Правила проекта: таймаут 10 с и повторы с паузой (fetch-util), robots.txt каждого хоста проверяется перед запросом,
   сбой одной ленты не роняет остальные, при полном сбое прежние записи сохраняются и ставится stale:true.
   Ленты ведомств, которые не отвечают серверам GitHub (LOCAL_SOURCES, ci_unreachable), в GitHub Actions пропускаются
   (status:"skipped", без ::warning), а при локальном запуске качаются вместе с остальными (ALL_SOURCES).
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
export const MAX_ITEMS = 40;
/* не больше записей одного источника в файле: частые ленты (Клерк) не вытесняют редкие, но полезные (гранты, культура) */
export const MAX_PER_SOURCE = 6;          // потолок записей в файле
export const SUMMARY_MAX = 200;       // длина краткого описания, знаков
const FUTURE_TOLERANCE_MS = 864e5;    // дата «из будущего» больше чем на сутки — запись отбрасывается
const UA = 'Mozilla/5.0 (compatible; news-digest-bot/1.0)';
const DAY = 864e5;

/* Ленты, которые отвечают серверам GitHub Actions (ежедневный прогон data-refresh.yml). Каждая проверена: HTTP 200 и валидный RSS
   локально и с раннера ubuntu-latest (проба 24.11.2026, run 45381338114), robots.txt хоста ленту не запрещает — см. DATA_SOURCES.md, раздел 4а.
   filter: any — хотя бы одно слово из списка; all — каждая группа должна совпасть хотя бы одним словом; exclude — стоп-слова;
   titleOnly — искать только в заголовке (для широких лент с длинными описаниями, иначе много шума).
   Слово с префиксом «=» ищется целиком (для коротких: «=ип»), без префикса — как основа (подстрока).
   У всех лент берём только заголовок, ссылку на первоисточник, дату и короткий анонс — так разрешают условия изданий. */
// Общие стоп-слова городских лент: происшествия и «кинотеатр» (подстрока «театр» иначе ловит кинопрокат)
const CITY_NOISE = ['18+', 'пожар', 'погиб', '=дтп', 'полиц', 'мошенн', 'спасател', 'суд', 'умер', 'кинотеатр', 'кинопрокат'];
// Пушкинская карта — именно карта, а не Пушкинский музей или премия
const PUSHKIN_CARD = ['пушкинская карт', 'пушкинской карт', 'пушкинскую карт'];

export const SOURCES = [
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
    // Рубрика «Культура» делового издания НСО: театры, филармония, НОВАТ, фестивали (стандартная рубричная лента WordPress)
    key: 'infopro54_culture',
    name: 'Infopro54',
    url: 'https://infopro54.ru/category/news/society/culture/',
    feed_url: 'https://infopro54.ru/category/news/society/culture/feed/',
    topic: 'culture',
    filter: {
      titleOnly: true,
      any: ['театр', 'спектак', 'фестивал', 'филармон', 'новат', 'детск', '=дети', '=детей', 'школьник', 'конкурс', 'кукол', 'грант', ...PUSHKIN_CARD, 'дом культуры', '=дк'],
      exclude: ['кинотеатр', 'кинопрокат', 'архитектур']
    }
  },
  {
    // ГТРК «Новосибирск» (ВГТРК), ссылка на RSS стоит на самом сайте. Город: культура, дети, школы, конкурсы
    key: 'nsktv',
    name: 'Вести Новосибирск',
    url: 'https://www.nsktv.ru/',
    feed_url: 'https://www.nsktv.ru/rss.php',
    https: true,
    topic: 'city',
    filter: {
      titleOnly: true,
      any: ['театр', 'спектак', 'фестивал', 'культур', 'детск', '=дети', '=детей', 'детям', 'школьник', 'школьниц', 'пятиклассниц', 'конкурс', 'грант', ...PUSHKIN_CARD, 'дом культуры', '=дк', 'предприним', 'самозанят', '=мсп', 'малого бизнес'],
      exclude: CITY_NOISE
    }
  },
  {
    // Городское издание Новосибирска (штатная лента WordPress /feed/): театры, школы, детские сады
    key: 'nsknews',
    name: 'Новосибирские новости',
    url: 'https://nsknews.info/',
    feed_url: 'https://nsknews.info/feed/',
    topic: 'city',
    filter: {
      titleOnly: true,
      any: ['театр', 'спектак', 'фестивал', 'детсад', 'детский сад', 'детских сад', 'школ', 'детск', '=дети', '=детей', 'конкурс', 'грант', ...PUSHKIN_CARD, 'дом культуры', '=дк', 'предприним', 'самозанят', 'карантин', 'актрис', 'актер', 'актёр'],
      exclude: [...CITY_NOISE, 'спецопераци', '=сво', 'бойц', 'стадион', 'самбо']
    }
  },
  {
    // Региональная редакция АиФ (ссылка /rss/all.php на главной). Поток большой — только узкий фильтр по заголовку:
    // Пушкинская карта, самозанятые и предприниматели НСО, детские сады
    key: 'aif_nsk',
    name: 'АиФ-Новосибирск',
    url: 'https://nsk.aif.ru/',
    feed_url: 'https://nsk.aif.ru/rss/all.php',
    topic: 'city',
    filter: {
      titleOnly: true,
      any: ['театр', 'спектак', ...PUSHKIN_CARD, 'самозанят', 'предприним', '=мсп', 'малого бизнес', 'детсад', 'детских сад', 'детский сад', 'грант', 'фестивал', 'дом культуры', '=дк', 'карантин'],
      exclude: CITY_NOISE
    }
  },
  {
    // Рубрика «ПроБизнес» Infopro54: налоги, патент и отчётность предпринимателей НСО (дополняет общую ленту ФНС)
    key: 'infopro54_biz',
    name: 'Infopro54 · бизнес',
    url: 'https://infopro54.ru/category/news/biznes/probiznes/',
    feed_url: 'https://infopro54.ru/category/news/biznes/probiznes/feed/',
    topic: 'taxes',
    filter: {
      titleOnly: true,
      any: ['патент', 'налог', '=усн', '=ндс', 'отчетн', 'отчётн', 'самозанят', '=ккт', 'кассов', 'взнос', 'торговый сбор', 'рекламного сбора', 'рекламный сбор'],
      exclude: ['мошенн', 'похитил', '=компанию', '=компании', 'верховный суд']
    }
  },
  {
    // Газета «Культура»: федеральная театральная повестка и итоги грантов ПФКИ (у самого фонда RSS нет)
    key: 'portal_kultura',
    name: 'Газета «Культура»',
    url: 'https://portal-kultura.ru/',
    feed_url: 'https://portal-kultura.ru/rss/',
    topic: 'culture',
    filter: {
      titleOnly: true,
      any: ['детск', 'для детей', '=дети', '=детей', 'кукол', 'кукольн', 'сказк', 'юного зрител', 'юных зрител', '=тюз', 'грант', 'пфки', 'фонд культурных', 'президентск', ...PUSHKIN_CARD, 'новосибирск', 'театральных школ', 'школьн']
    }
  },
  {
    // Клерк.ру (лента объявлена на главной): УСН, ИП, самозанятые, ККТ — практичные изменения для ИП. Рекламу курсов отсекаем
    key: 'klerk',
    name: 'Клерк.ру',
    url: 'https://www.klerk.ru/',
    feed_url: 'https://www.klerk.ru/xml/index.xml',
    topic: 'taxes',
    filter: {
      titleOnly: true,
      any: ['=усн', 'упрощ', '=аусн', '=ип', 'самозанят', '=нпд', 'патент', '=ккт', 'онлайн-касс', 'малого бизнес', '=мсп', '=нко', 'торговый сбор', 'взносы ип', 'взносов ип'],
      exclude: ['курсы клерка', 'курсов клерка']
    }
  }
];

/* Ленты ведомств, которые НЕ отвечают зарубежным серверам GitHub Actions (502 / таймаут уже на robots.txt — логи Actions
   21–24.11.2026 и проба 24.11.2026), но открываются из российской сети. ci_unreachable: true — в GitHub Actions лента не
   запрашивается (одна строка в логе вместо ежедневного ::warning и минут ожидания таймаутов), её молчание не считается сбоем
   обновления; при локальном запуске (node scripts/refresh-local.mjs) качается как обычно. Проверить, не открылись ли они
   для GitHub, — переменная окружения NEWS_TRY_CI_UNREACHABLE=1 в шаге workflow. */
export const LOCAL_SOURCES = [
  {
    key: 'mk_nso',
    name: 'Минкультуры Новосибирской области',
    url: 'https://mk.nso.ru/',
    feed_url: 'https://mk.nso.ru/rss.xml',
    topic: 'culture',
    ci_unreachable: true,
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
    ci_unreachable: true,
    filter: {
      titleOnly: true,
      any: ['театр', 'спектак', 'культурн', 'учреждени культуры', 'сферы культуры', 'детского отдыха', 'детский досуг', 'досуг', 'предприним', 'малого бизнес', 'малого и среднего', '=мсп', 'самозанят', 'грант', 'субсид', 'пушкинск', '=нко', 'фестивал', 'дополнительного образования']
    }
  },
  {
    key: 'mkrf_news',
    name: 'Минкультуры России — новости министерства',
    url: 'https://culture.gov.ru/press/news/',
    feed_url: 'https://culture.gov.ru/rssall/rss.php?ID=2&lang=ru&TYPE=ministry&LIMIT=40&SECTION_ID=30',
    https: true,
    topic: 'culture',
    ci_unreachable: true,
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
    ci_unreachable: true,
    filter: {
      all: [['новосибирск', 'сибир']],
      any: ['театр', 'спектак', 'детск', 'кукол', 'грант', 'фестивал', 'пушкинск', 'конкурс']
    }
  }
];

/* Все ленты в порядке приоритета при дублях (из дублей остаётся запись ленты, стоящей выше):
   ведомства НСО — первыми, затем ФНС и СМИ, затем Минкультуры России */
export const ALL_SOURCES = [LOCAL_SOURCES[0], LOCAL_SOURCES[1], ...SOURCES, LOCAL_SOURCES[2], LOCAL_SOURCES[3]];

/* Пропускается ли лента в этом прогоне: в GitHub Actions ленты с ci_unreachable не запрашиваются
   (env — process.env или подмена в тестах; NEWS_TRY_CI_UNREACHABLE=1 — всё-таки попробовать) */
export const CI_SKIP_NOTE = 'источник недоступен с GitHub, используется при локальном запуске';
export function skipInThisRun(source, env = process.env) {
  return Boolean(source && source.ci_unreachable && env && env.GITHUB_ACTIONS && !env.NEWS_TRY_CI_UNREACHABLE);
}

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
  // гранты: ПФКИ и Фонд президентских грантов, конкурсы на субсидии (в т.ч. региональные конкурсы НСО)
  ['grants', ['грант', 'субсид', 'президентск', 'фонд культурных', '=пфки', 'конкурсн отбор', 'конкурс проектов', 'конкурса проектов']],
  // детский театр и смежное: кукольные и школьные театры, театральные студии, семейные спектакли, жанр «…-сказка» (опера-сказка, спектакль-сказка)
  ['industry', ['детский театр', 'детского театра', 'детских театр', 'кукольн', 'театр кукол', 'театр для детей', 'для детей', 'детский спектакл', 'детских спектакл', 'юного зрителя', 'юных зрител', '=тюз', 'детские праздник', 'аниматор',
    'школьный театр', 'школьного театра', 'школьных театр', 'театральная студия', 'театральной студии', 'театральных студий', 'семейный спектакл', 'семейного спектакл', '-сказк']]
];
/* Гранты по тексту анонса — только по фразам о самом конкурсе. Упоминание «грант/фонд» в теле новости о фестивале
   («проходит при поддержке Президентского фонда…») ещё не делает её новостью о грантах — такая метка вводила бы в заблуждение */
const GRANT_BODY = ['приём заявок', 'прием заявок', 'заявки принимаются', 'конкурсн отбор', 'конкурс проектов', 'получение грант', 'на соискание грант', 'итоги конкурса', 'грантового конкурса'];

/* Совпадение со списком слов; «=слово» — целое слово (как в фильтре лент) */
const hasAny = (text, words) => words.some(w => (w.startsWith('=') ? new RegExp(`(^|[^а-яёa-z0-9])${w.slice(1)}($|[^а-яёa-z0-9])`, 'i').test(text) : text.includes(w)));

/* Тема записи: налоговая лента — всегда taxes; гранты — по заголовку или по фразам о конкурсе в анонсе;
   индустрия — по словам в заголовке и анонсе; по умолчанию — тема источника */
export function classify(item, source) {
  if (source.topic === 'taxes') return 'taxes';
  const title = String(item.title || '').toLowerCase();
  const body = String(item.description || '').toLowerCase();
  const [, grantWords] = TOPIC_RULES[0], [, industryWords] = TOPIC_RULES[1];
  if (hasAny(title, grantWords) || hasAny(body, GRANT_BODY)) return 'grants';
  if (hasAny(`${title} ${body}`, industryWords)) return 'industry';
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
export function mergeItems(fresh, previous, now = Date.now(), { keepDays = KEEP_DAYS, max = MAX_ITEMS, perSource = Infinity } = {}) {
  const from = now - keepDays * DAY;
  const all = dedupe([...(fresh || []), ...(previous || [])])
    .filter(it => {
      const t = Date.parse(it.published_at);
      return Number.isFinite(t) && t >= from && t - now <= FUTURE_TOLERANCE_MS;
    });
  all.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at) || a.id.localeCompare(b.id));
  // потолок на источник: после сортировки оставляем самые свежие записи каждого источника
  const seen = new Map();
  const capped = all.filter(it => { const k = it.source_url || it.source || ''; const n = (seen.get(k) || 0) + 1; seen.set(k, n); return n <= perSource; });
  return capped.slice(0, max);
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
export function essence(doc) {
  return JSON.stringify({
    stale: doc.stale,
    sources_failed: doc.sources_failed || 0,
    // last_ok_at успешной ленты сдвигается каждый прогон — как и fetched_at, это не изменение «по существу»
    sources: (doc.sources || []).map(({ fetched_at, last_ok_at, ...s }) => s),
    items: doc.items
  });
}

/* Когда лента последний раз отвечала успешно (ok или empty). Сбой — переносим прежнее значение из прошлого файла
   (сопоставление по адресу ленты); у файла старого формата без last_ok_at берём fetched_at прошлого успешного прогона */
export function sourceLastOk(status, prevSources, nowIso) {
  // лента, пропущенная в этом прогоне (skipped), сейчас не отвечала — как и при сбое, переносим прежнее значение
  if (status.status !== 'error' && status.status !== 'skipped') return nowIso;
  const old = (Array.isArray(prevSources) ? prevSources : []).find(s => s && s.feed_url === status.feed_url);
  if (!old) return null;
  if (old.last_ok_at) return old.last_ok_at;
  return old.status && old.status !== 'error' ? old.fetched_at || null : null;
}

/* Собирает итоговый документ из результатов лент и прежнего файла (чистая функция) */
export function buildDoc(results, prev, now = Date.now()) {
  const nowIso = new Date(now).toISOString();
  // Пропущенные в этом прогоне ленты (skipped: недоступны с GitHub, качаются при локальном запуске) не считаются
  // ни успехом, ни сбоем: sources_total — сколько лент реально запрашивали, sources_skipped — сколько пропустили
  const attempted = results.filter(r => r.status.status !== 'skipped');
  const anyOk = attempted.some(r => r.status.status !== 'error');
  const fresh = results.flatMap(r => r.items);
  const prevItems = prev && Array.isArray(prev.items) ? prev.items : [];
  // прежние статусы ищем и среди обычных лент, и среди пропущенных в прошлый раз
  const prevSources = [...((prev && prev.sources) || []), ...((prev && prev.skipped_sources) || [])];
  // Частичный сбой честно виден в файле: сколько лент не ответило (весь файл при этом не stale — часть лент жива)
  const failed = attempted.filter(r => r.status.status === 'error').length;
  const doc = {
    updated_at: anyOk ? nowIso : (prev && prev.updated_at) || null,
    stale: !anyOk,
    sources_total: attempted.length,
    sources_failed: failed,
    sources_skipped: results.length - attempted.length,
    keep_days: KEEP_DAYS,
    max_items: MAX_ITEMS,
    // в sources — только запрошенные ленты (статусы ok/error/empty по схеме файла);
    // пропущенные в этом прогоне — отдельным списком skipped_sources, со своей пометкой и прежним last_ok_at
    sources: attempted.map(r => ({ ...r.status, last_ok_at: sourceLastOk(r.status, prevSources, nowIso) })),
    skipped_sources: results.filter(r => r.status.status === 'skipped').map(r => ({ ...r.status, last_ok_at: sourceLastOk(r.status, prevSources, nowIso) })),
    items: mergeItems(fresh, prevItems, now, { perSource: MAX_PER_SOURCE })
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
  // В GitHub Actions ленты ведомств, недоступные зарубежным серверам, не запрашиваем — статус skipped, одна строка в логе
  const skipped = ALL_SOURCES.filter(s => skipInThisRun(s));
  const toFetch = ALL_SOURCES.filter(s => !skipInThisRun(s));
  // ленты на разных хостах качаем параллельно; один хост (culture.gov.ru, infopro54.ru) — последовательно, чтобы не нагружать
  const byHost = new Map();
  for (const s of toFetch) {
    const h = new URL(s.feed_url).host;
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h).push(s);
  }
  const resultsByKey = new Map();
  for (const s of skipped) {
    resultsByKey.set(s.key, { status: { name: s.name, url: s.url, feed_url: s.feed_url, fetched_at: new Date(now).toISOString(), status: 'skipped', items: 0, note: CI_SKIP_NOTE }, items: [] });
  }
  await Promise.all([...byHost.values()].map(async group => {
    for (const s of group) resultsByKey.set(s.key, await fetchSource(s, now));
  }));
  const results = ALL_SOURCES.map(s => resultsByKey.get(s.key));
  for (const r of results) {
    const st = r.status;
    if (st.status === 'skipped') continue;
    console.log(`${st.status.padEnd(5)} ${st.name}: ${st.items} из ${st.total ?? 0}${st.error ? ' — ' + st.error : ''}`);
  }
  if (skipped.length) console.log(`skip  ${skipped.map(s => s.name).join('; ')}: ${CI_SKIP_NOTE}`);

  const doc = buildDoc(results, prev, now);
  // Неожиданно упавшие ленты (не заранее известные skipped) — заметная строка в сводке GitHub Actions.
  // Если упала лента из российской сети, помогает локальный прогон: node scripts/refresh-local.mjs (см. DATA_SOURCES.md)
  if (doc.sources_failed && process.env.GITHUB_ACTIONS) {
    const names = results.filter(r => r.status.status === 'error').map(r => r.status.name).join('; ');
    console.log(`::warning file=data/news.json::Не ответили ${doc.sources_failed} из ${doc.sources_total} лент: ${names}. Прежние записи сохранены; обновить из российской сети — node scripts/refresh-local.mjs`);
  }
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
