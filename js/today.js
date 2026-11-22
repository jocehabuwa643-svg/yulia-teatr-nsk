/* today.js — дайджест «Сегодня»: что важно именно в день открытия помощника.

   Блок #today наверху страницы собирается из уже загруженных data/*.json (без своих запросов):
   • дата открытия (день недели, число, месяц) и спрос текущего месяца по seasonality.json;
   • «Ближайшее» — школьные каникулы (seasonality.json), окна грантов (market.json), налоговые сроки (guide.json);
     прошедшее не показывается, текущее — «идёт сейчас»;
   • «Новости отрасли» — свежие записи data/news.json (js/news.js → freshNews);
   • дата обновления данных и бейдж «Данные устарели» (meta.json, курсы ЦБ, новости);
   • прогресс чек-листа запуска, если Юлия уже отметила хотя бы один шаг (localStorage yulia.v2.checks — только чтение).
   Нет данных для плитки — плитки нет (никаких пустых рамок и выдуманных значений).
   Чистые функции принимают now и проверяются tests/today.test.mjs; DOM трогают только renderToday/initToday. */
import { freshNews, relativeDay, TOPIC_LABELS } from './news.js';

const DAY = 864e5;
export const STALE_DAYS = 3;        // данные старше — бейдж «Данные устарели»
export const HORIZON_DAYS = 120;    // насколько вперёд смотрим в «Ближайшем»
export const EVENTS_MAX = 5;        // сколько событий в «Ближайшем»
export const NEWS_FIRST = 3;        // новостей видно сразу
export const NEWS_MAX = 10;         // новостей после «Ещё»
export const SEASON_HIGH = 1.15;    // коэффициент спроса: от этого — высокий
export const SEASON_LOW = 0.7;      // до этого — низкий

export const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
export const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];

/* ---------- Календарные дни (местное время устройства) ---------- */

/* Номер календарного дня: одинаков для любого момента внутри суток, переход через полночь и летнее время не мешают */
export function dayNum(y, m0, d) { return Math.round(Date.UTC(y, m0, d) / DAY); }
export function todayNum(now) { const x = new Date(now); return dayNum(x.getFullYear(), x.getMonth(), x.getDate()); }
/* Ключ дня 'YYYY-MM-DD' — по нему видно, что наступили новые сутки */
export function dayKey(now) {
  const x = new Date(now);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
/* 'YYYY-MM-DD' → номер дня; дата читается как календарная (без сдвига часового пояса), мусор → null */
export function isoDayNum(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1, d = +m[3];
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  return dayNum(y, mo, d);
}
/* Номер дня → «20 ноября» (с годом, если он не текущий) */
export function dayLabel(n, now) {
  const x = new Date(n * DAY);
  const y = x.getUTCFullYear();
  const base = `${x.getUTCDate()} ${MONTHS_GEN[x.getUTCMonth()]}`;
  return y === new Date(now).getFullYear() ? base : `${base} ${y}`;
}

/* Русское склонение: 1 день, 2 дня, 5 дней */
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
/* «сегодня» / «завтра» / «через 5 дней» */
export function inDays(n) {
  if (n <= 0) return 'сегодня';
  if (n === 1) return 'завтра';
  return `через ${n} ${plural(n, 'день', 'дня', 'дней')}`;
}

/* «пятница, 20 ноября» */
export function formatToday(now) {
  const x = new Date(now);
  return `${WEEKDAYS[x.getDay()]}, ${x.getDate()} ${MONTHS_GEN[x.getMonth()]}`;
}

/* ---------- Сезон ---------- */

/* Спрос текущего месяца по seasonality.json и ближайший пик. Нет данных месяца → null (плитка скрывается) */
export function seasonStatus(seasonality, now) {
  const months = seasonality && Array.isArray(seasonality.months) ? seasonality.months : [];
  const x = new Date(now);
  const cur = months.find(r => r && r.m === x.getMonth() + 1 && Number.isFinite(r.factor));
  if (!cur) return null;
  const level = cur.factor >= SEASON_HIGH ? 'high' : cur.factor <= SEASON_LOW ? 'low' : 'mid';
  const label = { high: 'Высокий спрос', low: 'Низкий спрос', mid: 'Средний спрос' }[level];
  // ближайший пиковый месяц впереди (в пределах года), считая от 1-го числа месяца
  let nextPeak = null;
  if (level !== 'high') {
    for (let i = 1; i <= 11; i++) {
      const d = new Date(x.getFullYear(), x.getMonth() + i, 1);
      const r = months.find(z => z && z.m === d.getMonth() + 1 && Number.isFinite(z.factor));
      if (r && r.factor >= SEASON_HIGH) {
        nextPeak = { month: MONTHS_NOM[d.getMonth()], note: r.note || '', days: dayNum(d.getFullYear(), d.getMonth(), 1) - todayNum(now) };
        break;
      }
    }
  }
  return {
    month: MONTHS_NOM[x.getMonth()], factor: cur.factor, level, label, note: cur.note || '',
    model: (cur.confidence || (seasonality.source && seasonality.source.confidence)) === 'model', nextPeak
  };
}

/* ---------- «Ближайшее» ---------- */

const MONTH_RE = '(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)';

/* Школьные каникулы из seasonality.json (все загруженные годы, без повторов) */
function holidayEvents(seasonality) {
  const out = [], seen = new Set();
  const years = (seasonality && seasonality.school_holidays) || {};
  for (const y of Object.keys(years)) {
    const h = years[y];
    if (!h || h.loaded === false || !Array.isArray(h.items)) continue;
    for (const it of h.items) {
      const from = isoDayNum(it && it.from), to = isoDayNum(it && it.to);
      if (from == null || to == null || to < from) continue;
      const key = `${it.name}|${from}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        kind: 'holiday', title: `${it.name} каникулы`, from, to,
        note: it.verified === false ? 'даты — ориентир' : '', url: h.source_url || null
      });
    }
  }
  return out;
}

/* Окна открытых грантов из market.json: последняя дата ДД.ММ.ГГГГ в поле window — срок подачи, results — итоги */
function grantEvents(market) {
  const progs = market && market.grants && Array.isArray(market.grants.programs) ? market.grants.programs : [];
  const dmy = s => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s); return m ? dayNum(+m[3], +m[2] - 1, +m[1]) : null; };
  const out = [];
  for (const p of progs) {
    if (!p || p.status !== 'open' || !p.name) continue;
    const dates = String(p.window || '').match(/\d{2}\.\d{2}\.\d{4}/g) || [];
    const deadline = dates.length ? dmy(dates[dates.length - 1]) : null;
    if (deadline != null) out.push({ kind: 'grant', title: `${p.name}: приём заявок`, from: deadline, to: deadline, deadline: true, note: '', url: p.url || null });
    const res = dmy(String(p.results || '').trim());
    if (res != null) out.push({ kind: 'grant', title: `${p.name}: итоги`, from: res, to: res, note: '', url: p.url || null });
  }
  return out;
}

/* Налоговые сроки из guide.json: карточки вкладки «Документы» категории «Налоги», фразы вида «… до 28 декабря …»
   (ежегодный срок — берётся ближайший) и «… до 31.12.2026 …» (разовый). Подпись — подлежащее фразы до «до» и до тире */
function taxEvents(guide, now) {
  const entries = guide && Array.isArray(guide.entries) ? guide.entries : [];
  const today = todayNum(now), year = new Date(now).getFullYear();
  const reDM = new RegExp(`^(.*?)\\s+до\\s+(\\d{1,2})\\s+${MONTH_RE}`, 'i');
  const reDMY = /^(.*?)\s+до\s+(\d{2})\.(\d{2})\.(\d{4})/i;
  // «Взнос 1% —» → «Взнос 1%»; «… ИП — по закону НСО действуют» → «… ИП»; «Фиксированные взносы платят» → «Фиксированные взносы»
  const subject = s => s.split(/\s[—–]\s/)[0].replace(/\s*[—–]\s*$/, '').replace(/\s+(платят|платится|действуют|действует|подают|подаётся)$/i, '').trim();
  const out = [];
  for (const e of entries) {
    if (!e || e.tab !== 'docs' || e.category !== 'Налоги') continue;
    const sentences = [e.text, ...(e.details || [])].filter(Boolean).join(' ').split(/(?<=\.)\s+/);
    for (const s of sentences) {
      let m = reDMY.exec(s), day = null;
      if (m) day = dayNum(+m[4], +m[3] - 1, +m[2]);
      else if ((m = reDM.exec(s))) {
        const mo = MONTHS_GEN.indexOf(m[3].toLowerCase());
        day = dayNum(year, mo, +m[2]);
        if (day < today) day = dayNum(year + 1, mo, +m[2]); // ежегодный срок уже прошёл — следующий год
      }
      if (day == null) continue;
      const title = subject(m[1]);
      if (title.length < 3) continue;
      // «… действуют до 31.12.2026», «Каникулы 0% … до …» — это дата окончания режима, а не срок подачи/оплаты
      const ends = /действу(ют|ет)|каникул/i.test(m[1]);
      // пояснение — заголовок карточки справочника («Страховые взносы ИП за себя»), чтобы короткая подпись не потеряла смысл
      out.push({ kind: 'tax', title: title.length > 64 ? title.slice(0, 63) + '…' : title, from: day, to: day, deadline: true, ends, note: e.title || '', url: e.source_url || null });
    }
  }
  return out;
}

/* Ближайшие события от сегодняшнего дня: идущие сейчас — первыми, затем по близости; прошедшие и дальше горизонта отброшены.
   Возвращает [{ kind, title, status: 'now'|'soon', days (до начала или сколько осталось), date ('20 ноября'), endDate, note, url }] */
export function upcomingEvents(data, now, { limit = EVENTS_MAX, horizon = HORIZON_DAYS } = {}) {
  const d = data || {};
  const today = todayNum(now);
  const all = [...holidayEvents(d.seasonality), ...grantEvents(d.market), ...taxEvents(d.guide, now)];
  const seen = new Set();
  return all
    .filter(ev => ev.to >= today && ev.from - today <= horizon)
    .filter(ev => { const k = `${ev.kind}|${ev.from}|${ev.title}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .map(ev => {
      const now_ = ev.from <= today && !ev.deadline;
      return {
        kind: ev.kind, title: ev.title, note: ev.note, url: ev.url, deadline: !!ev.deadline, ends: !!ev.ends,
        status: now_ ? 'now' : 'soon',
        days: now_ ? ev.to - today : ev.from - today,
        date: dayLabel(ev.from, now), endDate: ev.to !== ev.from ? dayLabel(ev.to, now) : ''
      };
    })
    .sort((a, b) => (a.status === b.status ? a.days - b.days : a.status === 'now' ? -1 : 1))
    .slice(0, limit);
}

/* ---------- Свежесть данных ---------- */

/* Дата последнего обновления данных и признак «устарели»: старше days дней, курс ЦБ помечен stale или ленты новостей не отвечают.
   Учитываются три метки: meta.generated_at (данные изменились), meta.checked_at (ежедневный прогон проверил источники,
   но нового не было — например, ЦБ не меняет курс в выходные и праздники) и news.updated_at.
   checked: true — самая поздняя метка именно проверка без изменений (подпись «проверены», а не «обновлены»).
   notes — пояснения без признака «устарели» (часть лент новостей не ответила при последнем прогоне).
   Нет ни одной даты → null (строка не показывается) */
export function dataFreshness(data, now, days = STALE_DAYS) {
  const d = data || {};
  const m = d.meta || {};
  const ts = s => { const v = Date.parse(s); return Number.isFinite(v) ? v : null; };
  const changed = [m.generated_at, d.news && d.news.updated_at].map(ts).filter(v => v !== null);
  const checkedAt = ts(m.checked_at);
  const stamps = checkedAt === null ? changed : changed.concat(checkedAt);
  if (!stamps.length) return null;
  const at = Math.max(...stamps);
  const checked = checkedAt !== null && checkedAt === at && (!changed.length || Math.max(...changed) < at);
  const age = todayNum(now) - todayNum(at);
  const reasons = [];
  if (age > days) reasons.push(`последнее обновление ${age} ${plural(age, 'день', 'дня', 'дней')} назад`);
  const cbr = d.rates && d.rates.cbr;
  if (cbr && Object.values(cbr).some(v => v && v.stale === true)) reasons.push('курсы ЦБ не обновились');
  if (d.news && d.news.stale === true) reasons.push('ленты новостей недоступны');
  // Часть лент не ответила — данные не устарели (прежние записи сохранены), но честно об этом говорим
  const notes = [];
  const nf = d.news && Number(d.news.sources_failed), nt = d.news && Number(d.news.sources_total);
  if (!(d.news && d.news.stale === true) && Number.isFinite(nf) && nf > 0 && Number.isFinite(nt) && nt > 0) {
    notes.push(`не ответили ${nf} из ${nt} лент новостей`);
  }
  return { at, label: dayLabel(todayNum(at), now), age, stale: reasons.length > 0, reasons, checked, notes };
}

/* ---------- Чек-лист ---------- */

/* Прогресс чек-листа запуска: steps — шаги config.checklist_30d, checks — массив отметок из localStorage.
   Ни одной отметки → null (Юлия ещё не начинала). Все отмечены → next = null */
export function checklistProgress(steps, checks) {
  const list = Array.isArray(steps) ? steps.map(s => (Array.isArray(s) ? { days: s[0], title: s[1] } : s || {})) : [];
  if (!list.length || !Array.isArray(checks)) return null;
  const done = list.filter((_, i) => checks[i] === true).length;
  if (!done) return null;
  const i = list.findIndex((_, k) => checks[k] !== true);
  return { done, total: list.length, pct: Math.round(done * 100 / list.length), next: i < 0 ? null : { title: list[i].title || '', days: list[i].days || '' } };
}

/* ---------- Сводка целиком ---------- */

/* Всё для отрисовки одним объектом; пустые части — null/[] (рендер их пропускает) */
export function buildDigest(data, { now = Date.now(), steps = [], checks = null } = {}) {
  const d = data || {};
  const news = freshNews(d.news, now).slice(0, NEWS_MAX);
  return {
    key: dayKey(now),
    date: formatToday(now),
    season: seasonStatus(d.seasonality, now),
    events: upcomingEvents(d, now),
    news,
    fresh: dataFreshness(d, now),
    checklist: checklistProgress(steps, checks)
  };
}

/* ---------- Отрисовка ---------- */

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ic = n => `<i data-lucide="${n}" aria-hidden="true"></i>`;
const safeUrl = u => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
const KIND_ICON = { holiday: 'school', grant: 'award', tax: 'receipt' };
const KIND_LABEL = { holiday: 'Каникулы', grant: 'Грант', tax: 'Налоги' };

/* Строка события: значок вида, название (ссылка на источник, если он есть), дата и «через N дней» / «идёт сейчас» */
function eventRow(ev) {
  const when = ev.status === 'now'
    ? `<span class="td-when now">идёт сейчас</span><span class="td-sub">до ${esc(ev.endDate || ev.date)}, ещё ${ev.days} ${plural(ev.days, 'день', 'дня', 'дней')}</span>`
    : `<span class="td-when">${esc(inDays(ev.days))}</span><span class="td-sub">${ev.ends ? 'действуют до ' : ev.deadline ? 'до ' : ''}${esc(ev.date)}${ev.endDate ? ' — ' + esc(ev.endDate) : ''}</span>`;
  const url = safeUrl(ev.url);
  const title = url
    ? `<a class="td-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(ev.title)}<span class="sr-only"> (источник, откроется в новой вкладке)</span></a>`
    : `<span class="td-name">${esc(ev.title)}</span>`;
  return `<li class="td-ev${ev.status === 'now' ? ' is-now' : ''}"><span class="td-kind" title="${KIND_LABEL[ev.kind] || ''}">${ic(KIND_ICON[ev.kind] || 'calendar')}<span class="sr-only">${KIND_LABEL[ev.kind] || ''}: </span></span>` +
    `<span class="td-what">${title}${ev.note ? `<span class="td-note">${esc(ev.note)}</span>` : ''}</span><span class="td-time">${when}</span></li>`;
}

/* Новость: ссылка на первоисточник, тема · источник · когда */
function newsRow(it, now, hidden) {
  const url = safeUrl(it.url);
  if (!url) return '';
  const meta = [TOPIC_LABELS[it.topic], it.source_name, relativeDay(it.published_at, now)].filter(Boolean).map(esc).join(' · ');
  return `<li${hidden ? ' class="td-more" hidden' : ''}><a class="td-news" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><span class="td-nt">${esc(it.title)}</span><span class="td-nm">${meta}</span>${ic('external-link')}<span class="sr-only"> (откроется в новой вкладке)</span></a></li>`;
}

/* HTML блока по готовой сводке (без DOM — удобно проверять) */
export function digestHtml(dg, now = Date.now()) {
  const tiles = [];
  // сезон — одна строка под датой (не отдельная плитка): спрос этого месяца, пояснение и ближайший пик
  let season = '';
  if (dg.season) {
    const s = dg.season;
    const parts = [s.note, s.nextPeak ? `пик — ${s.nextPeak.month}, ${inDays(s.nextPeak.days)}` : ''].filter(Boolean).map(esc);
    season = `<p class="td-season lvl-${s.level}"><b>${esc(s.label)} в ${esc(MONTHS_PREP[MONTHS_NOM.indexOf(s.month)] || s.month)}</b>` +
      (parts.length ? `<span>${parts.join(' · ')}</span>` : '') + (s.model ? '<small>прогноз модели проекта</small>' : '') + '</p>';
  }
  // чек-лист: только если Юлия его начала
  if (dg.checklist) {
    const c = dg.checklist;
    tiles.push(`<article class="td-tile td-checks" aria-labelledby="tdChecksH"><h3 id="tdChecksH" class="td-h">${ic('goal')}План на 30 дней</h3>` +
      `<p class="td-big">${c.done} из ${c.total} шагов</p><div class="td-bar" role="progressbar" aria-label="Выполнено шагов" aria-valuemin="0" aria-valuemax="${c.total}" aria-valuenow="${c.done}"><span style="transform:scaleX(${c.pct / 100})"></span></div>` +
      `<div class="td-foot">${c.next ? `<p class="td-sub">Дальше: <b>${esc(c.next.title)}</b>${c.next.days ? ` · ${esc(c.next.days)}` : ''}</p>` : '<p class="td-sub">Все шаги отмечены.</p>'}` +
      `<a class="btn small secondary td-go" href="#launch">К чек-листу${ic('arrow-right')}</a></div></article>`);
  }
  const side = tiles.length ? `<div class="td-side">${tiles.join('')}</div>` : '';
  const events = dg.events.length
    ? `<article class="td-tile td-events" aria-labelledby="tdEventsH"><h3 id="tdEventsH" class="td-h">${ic('calendar-days')}Ближайшее</h3><ul class="td-list">${dg.events.map(eventRow).join('')}</ul></article>`
    : '';
  const shown = dg.news.slice(0, NEWS_FIRST), rest = dg.news.slice(NEWS_FIRST);
  const news = dg.news.length
    ? `<article class="td-tile td-newsbox" aria-labelledby="tdNewsH"><h3 id="tdNewsH" class="td-h">${ic('bookmark')}Новости отрасли</h3>` +
      `<ul class="td-list td-nlist" id="tdNewsList">${shown.map(it => newsRow(it, now, false)).join('')}${rest.map(it => newsRow(it, now, true)).join('')}</ul>` +
      (rest.length ? `<button type="button" class="btn small secondary td-morebtn" aria-expanded="false" aria-controls="tdNewsList">Ещё ${rest.length}</button>` : '') + '</article>'
    : '';
  const f = dg.fresh;
  const fresh = f
    ? `<p class="td-fresh">${ic('database')}<span>Данные ${f.checked ? 'проверены' : 'обновлены'} ${esc(f.label)}</span>${f.stale ? `<span class="td-stale">Данные устарели</span><span class="sr-only">: </span><span class="td-why">${esc(f.reasons.join('; '))}</span>` : ''}${!f.stale && f.notes && f.notes.length ? `<span class="sr-only">. </span><span class="td-why">${esc(f.notes.join('; '))}</span>` : ''}</p>`
    : '';
  const body = [events, news, side].filter(Boolean);
  return `<div class="td-head"><div><p class="eyebrow"><span class="dash"></span>Сегодня</p><h2 class="td-date" id="todayTitle">${esc(dg.date)}</h2>${season}</div>${fresh}</div>` +
    (body.length ? `<div class="td-grid n${body.length}${events ? '' : ' no-events'}${news ? '' : ' no-news'}">${body.join('')}</div>` : '');
}

/* Отметки чек-листа из localStorage (формат checklist.js — массив boolean; только чтение) */
function readChecks(win) {
  try {
    const v = JSON.parse(win.localStorage.getItem('yulia.v2.checks') || 'null');
    return Array.isArray(v) ? v : null;
  } catch { return null; }
}

/* Подключает блок: рисует сразу и перерисовывает, когда наступили новые сутки (вкладка вернулась из фона, фокус окна,
   таймер на полночь) и когда в чек-листе поставили или сняли отметку.
   opts: { doc, win, now() — источник времени, steps — шаги чек-листа, onRender(el) — после отрисовки (иконки) }.
   Возвращает { render(force), destroy(), digest() } */
export function initToday(data, { doc = globalThis.document, win = globalThis.window, now = () => Date.now(), steps = [], onRender = null } = {}) {
  const el = doc && doc.getElementById('today');
  if (!el) return { render: () => {}, destroy: () => {}, digest: () => null };
  let last = null, midnight = 0;

  const render = (force = false) => {
    const t = now();
    const dg = buildDigest(data, { now: t, steps, checks: readChecks(win) });
    const sig = JSON.stringify(dg);
    if (!force && sig === last) return dg; // ничего не изменилось — DOM не трогаем
    last = sig;
    el.innerHTML = digestHtml(dg, t);
    el.removeAttribute('aria-busy');
    el.classList.add('ready');
    // «Ещё N» раскрывает остальные новости (до NEWS_MAX) и сворачивает обратно
    const more = el.querySelector('.td-morebtn');
    if (more) more.addEventListener('click', () => {
      const open = more.getAttribute('aria-expanded') !== 'true';
      el.querySelectorAll('.td-more').forEach(li => { li.hidden = !open; });
      more.setAttribute('aria-expanded', String(open));
      more.textContent = open ? 'Свернуть' : `Ещё ${el.querySelectorAll('.td-more').length}`;
    });
    if (typeof onRender === 'function') onRender(el);
    scheduleMidnight();
    return dg;
  };

  // таймер на начало следующих суток (+1 с): блок обновится, даже если вкладка всё это время открыта
  function scheduleMidnight() {
    win.clearTimeout(midnight);
    const x = new Date(now());
    const next = new Date(x.getFullYear(), x.getMonth(), x.getDate() + 1, 0, 0, 1).getTime();
    midnight = win.setTimeout(() => render(), Math.min(next - x.getTime(), 2147483000));
  }
  const onVisible = () => { if (doc.visibilityState !== 'hidden') render(); };
  const onChecks = e => { if (e.target && e.target.closest && e.target.closest('#checks')) render(); };

  doc.addEventListener('visibilitychange', onVisible);
  win.addEventListener('focus', onVisible);
  doc.addEventListener('change', onChecks);
  render(true);

  return {
    render,
    digest: () => buildDigest(data, { now: now(), steps, checks: readChecks(win) }),
    destroy() {
      win.clearTimeout(midnight);
      doc.removeEventListener('visibilitychange', onVisible);
      win.removeEventListener('focus', onVisible);
      doc.removeEventListener('change', onChecks);
    }
  };
}
