/* market.js — раздел «Навигатор рынка»: карточки конкурентов с фильтрами по группам («что организуют» с источниками,
   цены по ТИПАМ — билет / выезд за ребёнка / пакет / час / абонемент, логика в competitor-prices.js), диаграмма цен за человека,
   спрос (только ручной ввод, без симуляции), сезонность и каникулы (модель проекта), образовательная сеть.
   Все числа берутся из data/*.json или вводятся пользователем; ничего не придумывается.
   Анимации — только transform/opacity (появление, рост столбцов); reduced-motion оставляет конечное состояние. */
import { $, $$, fmt, ic, icons, toast, store, isStale, enter, counter } from './ui/helpers.js';
import { state } from './state.js';
import { monthWindow, windowTitle, holidayStatus, holidayEndedInMonth } from './calendar.js';
import { openCompetitorDetail, setDetailFocus } from './competitor-detail.js';
import { KINDS, groupSummary, groupDate, observedCompare, perPersonRows, otherKindRows, priceText, confirmedGroups, planAssumptionGroups } from './competitor-prices.js';

/* ---------- Общие утилиты ---------- */

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* Ссылки допускаем только http(s): всё остальное (javascript:, data:) отбрасывается */
const safeUrl = u => (typeof u === 'string' && /^https?:\/\/\S+$/i.test(u.trim())) ? u.trim() : null;
const today = () => new Date().toISOString().slice(0, 10);
const ruDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : '—'; };
const CONF = { high: 'высокая', medium: 'средняя', low: 'низкая', model: 'предположение проекта', no_data: 'нет данных', manual: 'введено вручную' };

/* Порог устаревания из data/rates.json → thresholds_days (prices по умолчанию 30 дней) */
function thresholdDays(kind) {
  const t = state.DATA && state.DATA.rates && state.DATA.rates.thresholds_days;
  const v = t && t[kind];
  return Number.isFinite(v) ? v : ({ rates: 7, prices: 30, grants: 30 }[kind] || 30);
}

/* Бейдж свежести: «i · дата · надёжность» + отдельный бейдж «Данные устарели».
   Устаревшим считается значение старше порога либо помеченное stale:true. Предположения модели не «стареют». */
export function freshBadge(src, kind = 'prices') {
  if (!src) return '';
  const conf = src.confidence || 'medium';
  const days = thresholdDays(kind);
  const stale = src.stale === true || (conf !== 'model' && conf !== 'no_data' && !!src.fetched_at && isStale(src.fetched_at, days));
  const title = [src.source_name || src.name, src.source_url || src.url, `надёжность: ${CONF[conf] || conf}`, src.fetched_at ? `проверено ${ruDate(src.fetched_at)}` : ''].filter(Boolean).join('\n');
  const date = src.fetched_at ? ` · ${ruDate(src.fetched_at)}` : '';
  const label = conf === 'no_data' ? 'нет данных' : (conf === 'model' || conf === 'manual') ? CONF[conf] : `надёжность: ${CONF[conf] || conf}`;
  return `<span class="fb"><span class="fbadge" title="${esc(title)}"><span aria-hidden="true">i</span>${date} · ${esc(label)}</span>${stale ? `<span class="fbadge stale" title="Старше ${days} дн. — перепроверьте источник">Данные устарели</span>` : ''}</span>`;
}

/* Появление блоков при прокрутке: элементы получают .arm (скрыты opacity/transform), IntersectionObserver
   добавляет .shown. При reduce-motion market.css снимает скрытие — остаётся конечное видимое состояние. */
function armReveal(root, sel) {
  const items = $$(sel, root);
  if (!items.length || !window.IntersectionObserver) return;
  items.forEach((el, i) => { el.classList.add('arm'); el.style.setProperty('--i', Math.min(i, 12)); });
  const ob = new IntersectionObserver(entries => entries.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('shown'); ob.unobserve(e.target); }
  }), { threshold: .08 });
  items.forEach(el => ob.observe(el));
}

/* Рост столбцов: контейнер получает .pre (столбцы свёрнуты), при попадании в экран класс снимается */
function growOnEnter(box) {
  box.classList.add('pre');
  enter(box, () => requestAnimationFrame(() => requestAnimationFrame(() => box.classList.remove('pre'))));
}

/* ---------- Данные раздела ---------- */

let COMP = { groups: [] };      // competitors.json
let ALL = [];                    // плоский список карточек
let CFG = null;
let activeType = 'all';
const MANUAL_KEY = 'market.prices';     // { [id]: { value, date, url, kind } } — старые записи без kind считаются билетом
const DEMAND_KEY = 'market.demand';     // [ { id, q, shows, date, url } ]

const GROUPS_FALLBACK = [
  { type: 'outbound', label: 'Выездные', icon: 'drama' }, { type: 'studio', label: 'Студии', icon: 'users' },
  { type: 'party', label: 'Праздники и лофты', icon: 'cake' }, { type: 'benchmark', label: 'Ориентиры', icon: 'ticket' }
];
const STATUS = { public: 'Публичное предложение', historical: 'Прошлый выезд', mixed: 'Разночтения', reference: 'Ориентир', plan_benchmark: 'Ориентир бизнес-плана' };
const manualAll = () => { const v = store.get(MANUAL_KEY, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
const groupsList = () => (COMP.groups && COMP.groups.length ? COMP.groups : GROUPS_FALLBACK);

/* Плоский список: группа берётся из поля type записи (а не из позиции в массиве) */
function flatten(c) {
  const out = [];
  [c.outbound_performers, c.studio_scene, c.party_venues, c.stationary_benchmarks]
    .forEach(list => (list || []).forEach(x => { if (x && x.type && x.id) out.push(x); }));
  return out;
}
const groupOf = type => groupsList().find(g => g.type === type) || { type, label: type, icon: 'tag' };

/* Есть ли у карточки хоть одна цена (подтверждённая источником или введённая Юлией).
   Допущения бизнес-плана (confidence:model) ценой конкурента не считаются */
const hasPrice = c => confirmedGroups(c, manualAll()[c.id]).length > 0;

/* Ссылка «источник» с иконкой; без ссылки — пусто */
const srcLink = (u, text = 'источник') => { const s = safeUrl(u); return s ? `<a href="${esc(s)}" target="_blank" rel="noopener noreferrer">${text} ${ic('external-link')}</a>` : ''; };

/* ---------- Вход ---------- */

export function initMarket(cfg, competitors, market) {
  CFG = cfg;
  COMP = competitors || {};
  ALL = flatten(COMP);
  const mk = market || {};
  renderKpis();
  renderFilters();
  renderCards(true);
  bindCards();
  renderPriceChart();
  initDemand(mk.demand || {});
  renderSeason(mk.seasonality_model || { months: [] });
  renderHolidays(mk.school_calendar || { holidays: [] });
  NET_ROWS = mk.network_stats || []; NET_NOTE = mk.network_stats_note || '';
  renderLeads(NET_ROWS, NET_NOTE);
  icons();
}

/* ---------- KPI-плашки ---------- */

function renderKpis() {
  const total = ALL.length;
  const priced = ALL.filter(hasPrice).length;
  const fetched = COMP.fetched_at;
  const stale = fetched && isStale(fetched, thresholdDays('prices'));
  const tile = (icon, label, val, sub) => `<div class="mk-kpi"><span class="mk-kpi-ic">${ic(icon)}</span><small>${label}</small><b data-target="${val}">${val}</b><span class="mk-kpi-sub">${sub}</span></div>`;
  $('marketKpis').innerHTML =
    tile('users', 'В справочнике', total, 'конкурентов и ориентиров') +
    tile('tag', 'Есть цена', priced, 'с источником или введена вами') +
    tile('circle-help', 'Нет данных', total - priced, 'это не «бесплатно»') +
    `<div class="mk-kpi"><span class="mk-kpi-ic">${ic('calendar-days')}</span><small>Сверка с источниками</small><b class="d">${ruDate(fetched)}</b><span class="mk-kpi-sub">${stale ? 'Данные устарели' : `свежие, порог ${thresholdDays('prices')} дн.`}</span></div>`;
  // дата в шапке раздела — из данных (competitors.fetched_at), та же, что в плашке «Сверка с источниками»
  const stamp = $('marketStamp');
  if (stamp) stamp.textContent = fetched ? `Сверка с источниками: ${ruDate(fetched)}.` : 'Дата сверки с источниками: нет данных.';
  $$('#marketKpis b[data-target]').forEach(b => enter(b, () => counter(b)));
  armReveal($('marketKpis'), '.mk-kpi');
}

/* ---------- Фильтры и карточки ---------- */

function renderFilters() {
  const groups = groupsList().filter(g => ALL.some(c => c.type === g.type));
  const chips = [{ type: 'all', label: 'Все' }, ...groups];
  $('marketFilters').innerHTML = chips.map(g => {
    const n = g.type === 'all' ? ALL.length : ALL.filter(c => c.type === g.type).length;
    return `<button type="button" class="chip${g.type === activeType ? ' on' : ''}" data-type="${esc(g.type)}" aria-pressed="${g.type === activeType}">${esc(g.label)} <span class="chipn">${n}</span></button>`;
  }).join('');
  $('marketFilters').onclick = e => {
    const b = e.target.closest('[data-type]'); if (!b) return;
    activeType = b.dataset.type;
    cardsShown = CARDS_STEP;
    $$('#marketFilters .chip').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
    renderCards(false);
  };
}

const statusLine = c => STATUS[c.status] ? `<span class="stat st-${esc(c.status)}">${STATUS[c.status]}</span>` : '';

/* Недельная автопроверка сайта конкурента (scripts/fetch-competitors.mjs): компактная строка под ценами.
   Найденная на сайте цена подписана своим типом и сравнивается ТОЛЬКО с ценами карточки того же типа;
   расхождение — «цена на сайте другая». Без цены — «страница доступна / изменилась / недоступна». */
const OBS_TEXT = { ok: 'страница доступна', changed: 'страница изменилась', unavailable: 'страница недоступна', robots_disallowed: 'сайт запрещает автопроверку' };
function observedLine(c) {
  const st = c.check_status;
  if (!st || st === 'skipped' || st === 'skipped_policy') return '';
  const checked = ruDate(c.checked_at);
  const oc = observedCompare(c, manualAll()[c.id]);
  if (oc) {
    const was = oc.prev ? ` (раньше ${fmt(oc.prev.value)} ₽)` : '';
    const link = srcLink(oc.price.source_url, 'страница');
    return `<p class="obs obs-price"><span>автопроверка сайта ${checked}: <b>${esc(priceText(oc.price, false))}</b> · ${esc(oc.kindLabel)}${was}${link ? ' · ' + link : ''}${st === 'unavailable' ? ' · сейчас недоступна' : ''}</span>${oc.differs ? '<span class="fbadge stale" title="Цена, найденная на сайте, отличается от цены того же типа в карточке — проверьте вручную">цена на сайте другая</span>' : ''}</p>`;
  }
  const t = OBS_TEXT[st];
  if (!t) return '';
  const o = c.observed;
  const when = st === 'changed' && o && o.changed_at ? ` ${ruDate(o.changed_at)}` : '';
  return `<p class="obs obs-${esc(st)}">автопроверка: ${t}${when} · ${checked}</p>`;
}

/* Цены карточки по типам: одна строка на тип — «Билет · от 350 ₽/билет · 18.11.2026 · источник».
   «от» сохраняется, «нет данных» — не ноль; ручная цена помечена «введено вами». */
/* Сноска о допущении бизнес-плана: мелко, без «проверено», явно «не цена студии» */
function planNote(c) {
  const pg = planAssumptionGroups(c).filter(g => g.kind !== 'other');
  if (!pg.length) return '';
  const t = pg.map(g => `${KINDS[g.kind].short.toLowerCase()} ${groupSummary(g).text}`).join('; ');
  return `<p class="pplan"><span class="stat st-model">допущение бизнес-плана</span> ${esc(t)} — рабочая цифра проекта, не цена студии. Цену студии уточните у неё и введите ниже.</p>`;
}

function priceBlock(c) {
  const groups = confirmedGroups(c, manualAll()[c.id]).filter(g => g.kind !== 'other');
  if (!groups.length) {
    return `<p class="pnone"><b>Цена: нет данных</b>${c.price_note && String(c.price_note).length <= 90 ? ` · ${esc(c.price_note)}` : ''}</p>` + planNote(c) + observedLine(c);
  }
  const rows = groups.map(g => {
    const s = groupSummary(g);
    const first = g.items.find(p => p.manual) || g.items[0];
    const date = ruDate(groupDate(g));
    // в группах только подтверждённые цены и ручной ввод; вторичный источник подписан явно
    const conf = first.manual ? '<span class="stat st-manual">введено вами</span>' : first.confidence === 'medium' ? '<span class="stat st-model">вторичный источник</span>' : '';
    const stale = !first.manual && groupDate(g) && isStale(groupDate(g), thresholdDays('prices')) ? '<span class="fbadge stale">устарело</span>' : '';
    const link = srcLink(first.source_url);
    return `<li class="pk"><span class="pk-k">${esc(KINDS[g.kind].short)}</span><b class="pk-v">${esc(s.text)}${s.note ? `<small>${esc(s.note)} · всего ${s.count} ${plural(s.count, ['тариф', 'тарифа', 'тарифов'])}</small>` : s.count > 1 ? `<small>${s.count} ${plural(s.count, ['тариф', 'тарифа', 'тарифов'])}</small>` : ''}</b><span class="pk-m">${conf}${date !== '—' ? `<span>${first.manual ? 'введено' : first.confidence === 'medium' ? 'срез' : 'проверено'} ${date}</span>` : ''}${link}${stale}</span></li>`;
  }).join('');
  return `<ul class="pkinds" aria-label="Цены по типам">${rows}</ul>` + planNote(c) + observedLine(c);
}

/* Абзац карточки: короткий — как есть, длинный — вложенный <details>, чтобы не раздувать карточку */
function longP(label, text) {
  if (!text) return '';
  if (String(text).length <= 60) return `<p><b>${label}:</b> ${esc(text)}</p>`;
  return `<details class="mk-more mk-sub"><summary>${label}</summary><p>${esc(text)}</p></details>`;
}

/* Подпись даты события кейса: «21.11.2026» или пусто */
const caseLine = k => `<li><span>${esc(k.text)}</span><small>${k.date ? ruDate(k.date) + ' · ' : ''}${srcLink(k.source_url) || 'источник не указан'}</small></li>`;

/* Варианты типа для ручного ввода цены */
const KIND_OPTIONS = ['ticket', 'per_child', 'party_package', 'hour', 'subscription'];

function cardHtml(c) {
  const g = groupOf(c.type);
  const manual = manualAll()[c.id];
  const mk = manual && KINDS[manual.kind] ? manual.kind : 'ticket';
  const cases = Array.isArray(c.cases) ? c.cases.filter(k => k && k.text) : [];
  const details = [
    longP('Программа', c.program),
    longP('Заметка', c.note),
    longP('О цене', c.price_note),
    c.age ? `<p><b>Возраст:</b> ${esc(c.age)}</p>` : '',
    c.verify_note ? `<p class="tiny">${esc(c.verify_note)}</p>` : ''
  ].join('');
  return `<article class="card rival" data-id="${esc(c.id)}" data-type="${esc(c.type)}">
    <div class="rv-top">
      <span class="rv-ic">${ic(g.icon)}</span>
      <div class="rv-t"><h4>${esc(c.name)}</h4><span class="tiny">${esc(c.format || g.label)}${c.district && c.district !== '—' ? ' · ' + esc(c.district) : ''}</span></div>
    </div>
    <div class="rv-st">${statusLine(c)}${c.verified_at ? `<span class="stat">сверено ${ruDate(c.verified_at)}</span>` : ''}</div>
    ${c.address ? `<p class="rv-addr">${ic('map-pin')}<span>${esc(c.address)}</span></p>` : ''}
    ${cases.length ? `<div class="rv-cases"><b>Что организуют</b><ul>${cases.slice(0, 1).map(caseLine).join('')}</ul>${cases.length > 1 ? `<small class="tiny">ещё ${cases.length - 1} — в «Подробно»</small>` : ''}</div>` : ''}
    ${priceBlock(c)}
    ${details ? `<details class="mk-more"><summary>Подробнее</summary><div>${details}</div></details>` : ''}
    <details class="mk-more manual-form"><summary>${manual ? 'Изменить мою цену' : 'Ввести цену вручную'}</summary>
      <form class="mform" data-id="${esc(c.id)}" novalidate>
        <label class="mf"><span>Что это за цена</span><select name="kind">${KIND_OPTIONS.map(k => `<option value="${k}"${k === mk ? ' selected' : ''}>${esc(KINDS[k].label)}</option>`).join('')}</select></label>
        <div class="mrow">
          <label class="mf"><span>Цена, ₽</span><input name="value" type="number" inputmode="decimal" min="1" step="1" required value="${manual ? esc(manual.value) : ''}"></label>
          <label class="mf"><span>Дата проверки</span><input name="date" type="date" max="${today()}" required value="${esc(manual ? manual.date : today())}"></label>
        </div>
        <label class="mf"><span>Ссылка на источник</span><input name="url" type="url" inputmode="url" placeholder="https://…" value="${manual ? esc(manual.url || '') : ''}"></label>
        <p class="tiny">Сохраняется только в этом браузере и везде помечается «введено вами».</p>
        <p class="ferr" role="alert" hidden></p>
        <div class="toolrow"><button type="submit" class="btn small primary">Сохранить</button>${manual ? '<button type="button" class="btn small secondary" data-clear>Убрать</button>' : ''}</div>
      </form>
    </details>
    <button type="button" class="btn small primary rv-scheme" data-detail="${esc(c.id)}">${ic('layout-dashboard')}<span>Подробно: что делают и цены</span></button>
    ${safeUrl(c.source_url) ? `<a class="btn small secondary rv-src" target="_blank" rel="noopener noreferrer" href="${esc(safeUrl(c.source_url))}">Источник ${ic('external-link')}</a>` : ''}
  </article>`;
}

/* Компактность: сначала первые CARDS_STEP карточек, остальные — по кнопке «Показать ещё» (раскрытие сбрасывается при смене фильтра) */
const CARDS_STEP = 6;
let cardsShown = CARDS_STEP;

function renderCards(first) {
  const all = ALL.filter(c => activeType === 'all' || c.type === activeType);
  const list = all.slice(0, cardsShown);
  const rest = all.length - list.length;
  const box = $('marketCards');
  box.innerHTML = (list.map(cardHtml).join('') || '<div class="nodata"><strong>Нет данных</strong><span>В этой группе пока нет записей.</span></div>') +
    (rest > 0 ? `<button type="button" class="btn secondary rv-more" data-more>Показать ещё ${rest} ${ic('chevron-right')}</button>` : '');
  $('rivalsMeta').textContent = `Показано ${list.length} из ${all.length} · цены сравниваются только одного типа`;
  icons();
  // при смене фильтра карточки уже на экране — каскад сразу; при первой загрузке — по мере прокрутки
  if (first) armReveal(box, '.rival');
  else $$('.rival', box).forEach((el, i) => { el.style.setProperty('--i', Math.min(i, 12)); el.classList.add('arm'); requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('shown'))); });
}

/* Обновить одну карточку и зависимые блоки после ручного ввода цены */
function refreshAfterManual(id) {
  const c = ALL.find(x => x.id === id);
  const old = document.querySelector(`#marketCards .rival[data-id="${CSS.escape(id)}"]`);
  if (c && old) {
    const tmp = document.createElement('div'); tmp.innerHTML = cardHtml(c);
    const fresh = tmp.firstElementChild; fresh.classList.add('arm', 'shown');
    old.replaceWith(fresh);
  }
  renderKpis(); renderPriceChart(); icons();
}

function bindCards() {
  const box = $('marketCards');
  // «Подробно»: модалка конкурента (что организуют / цены по типам / условия / оценка по модели)
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-detail]'); if (!b) return;
    e.preventDefault();
    const c = ALL.find(x => x.id === b.dataset.detail); if (!c) return;
    setDetailFocus(b);
    openCompetitorDetail(c, manualAll()[c.id] || null);
  });
  box.addEventListener('submit', e => {
    const f = e.target.closest('.mform'); if (!f) return;
    e.preventDefault();
    const err = f.querySelector('.ferr');
    const fail = msg => { err.textContent = msg; err.hidden = false; };
    const v = Number(f.value.value), date = f.date.value, url = f.url.value.trim();
    const kind = KIND_OPTIONS.includes(f.kind.value) ? f.kind.value : 'ticket';
    if (f.value.value === '' || !Number.isFinite(v) || v <= 0) return fail('Введите цену числом больше нуля.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) return fail('Укажите дату проверки не позже сегодняшней.');
    if (url && !safeUrl(url)) return fail('Ссылка должна начинаться с http:// или https://');
    const all = manualAll(); all[f.dataset.id] = { value: Math.round(v), date, url: url || null, kind };
    if (!store.set(MANUAL_KEY, all)) return fail('Браузер не дал сохранить данные (приватный режим?).');
    toast('Цена сохранена в этом браузере');
    refreshAfterManual(f.dataset.id);
  });
  box.addEventListener('click', e => {
    // «Показать ещё»: дорисовать остальные карточки, фокус — на первую новую (клавиатура не теряет место)
    const more = e.target.closest('[data-more]');
    if (more) {
      const from = cardsShown;
      cardsShown = Infinity;
      renderCards(false);
      const next = $$('#marketCards .rival')[from];
      if (next) { next.setAttribute('tabindex', '-1'); next.focus({ preventScroll: true }); }
      return;
    }
    const b = e.target.closest('[data-clear]'); if (!b) return;
    const id = b.closest('.mform').dataset.id;
    const all = manualAll(); delete all[id]; store.set(MANUAL_KEY, all);
    toast('Ручная цена убрана');
    refreshAfterManual(id);
  });
}

/* ---------- Диаграмма цен «за человека» + отдельные таблицы других типов ---------- */

function renderPriceChart() {
  const tk = CFG && CFG.ticket;
  const unwrap = v => (v && typeof v === 'object' && 'value' in v) ? v.value : v; // значение может быть с провенансом
  const t = tk ? { min: unwrap(tk.min), max: unwrap(tk.max) } : null;
  const man = manualAll();
  const pp = perPersonRows(ALL, man);
  // общая шкала для обеих групп «за человека», чтобы столбцы можно было сопоставить глазами
  const max = Math.max(1, ...pp.ticket.map(r => r.value), ...pp.per_child.map(r => r.value), t && t.max ? t.max : 0);
  const bar = v => `<span class="pw" style="width:${v / max * 100}%"><span class="pfill"></span></span>`;
  const li = r => {
    const tag = r.manual ? 'manual' : r.confidence === 'low' ? 'low' : '';
    const stale = !r.manual && r.date && isStale(r.date, thresholdDays('prices'));
    const sub = [r.label, ruDate(r.date) !== '—' ? ruDate(r.date) : ''].filter(Boolean).join(' · ');
    const link = srcLink(r.url);
    return `<li class="prow ${tag}"><div class="pname">${esc(r.name)}<small>${esc(sub)}${link ? ' · ' + link : ''}</small></div><div class="ptrack" aria-hidden="true">${bar(r.value)}</div><div class="pval">${r.qualifier ? esc(r.qualifier) + ' ' : ''}${fmt(r.value)} ₽${r.manual ? '<small>введено вами</small>' : r.confidence === 'low' ? '<small>не подтверждено</small>' : ''}${stale ? '<small class="stl">устарело</small>' : ''}</div></li>`;
  };
  const mine = t && t.min && t.max
    ? `<li class="prow mine"><div class="pname">Ваш билет<small>план проекта, не рынок</small></div><div class="ptrack" aria-hidden="true"><span class="pw" style="width:${t.max / max * 100}%"><span class="pfill assume"></span></span></div><div class="pval">${fmt(t.min)}–${fmt(t.max)} ₽<small>ваш план</small></div></li>` : '';
  const grp = (title, note, rows, extra = '') => `<div class="pgrp"><h4 class="pgrp-h">${title}</h4><p class="pgrp-n">${note}</p><ul class="pbars" aria-label="${esc(title)}, рублей">${extra}${rows.map(li).join('')}</ul>${!rows.length ? '<p class="pnone"><b>Нет данных</b> · конкуренты не публикуют цену — запросите КП или введите вручную в карточке.</p>' : ''}</div>`;
  const nod = pp.none.length
    ? `<details class="mk-more wide"><summary>Без цены за человека (${pp.none.length})</summary><p class="pnod">${pp.none.map(esc).join(', ')}. «Нет данных» — не 0 ₽.</p></details>` : '';
  // другие типы цен — компактные таблицы, каждая сравнивается только внутри себя
  const other = otherKindRows(ALL, man);
  /* Ориентиры бизнес-плана (confidence:model) — не цены, проверенные на сайте студии: число рядом с именем
     реального конкурента не показываем, только перечисляем, у кого цены на сайте не подтверждены.
     Абонемент делится по единице: «за месяц» и «за абонемент из N занятий» между собой не сравниваются. */
  const otherLi = r => `<li><span>${esc(r.name)}<small>${r.manual ? 'введено вами' : ''}${ruDate(r.date) !== '—' ? (r.manual ? ' · ' : '') + ruDate(r.date) : ''}${r.url ? ' · ' + srcLink(r.url) : ''}</small></span><b>${esc(r.text)}</b></li>`;
  const otherUl = rows => `<ul class="plist">${rows.map(otherLi).join('')}</ul>`;
  const SUB_PER = [['month', 'За месяц занятий'], ['pack', 'Абонемент на несколько занятий']];
  const otherHtml = ['party_package', 'hour', 'subscription'].filter(k => other[k].length).map(k => {
    const real = other[k].filter(r => r.manual || r.confidence !== 'model');
    const model = other[k].filter(r => !r.manual && r.confidence === 'model');
    const body = !real.length ? ''
      : k === 'subscription'
        ? SUB_PER.map(([per, title]) => { const rows = real.filter(r => r.per === per); return rows.length ? `<p class="pgrp-n">${title}</p>${otherUl(rows)}` : ''; }).join('')
        : otherUl(real);
    const modelNote = model.length
      ? `<p class="pnod">Цены на сайтах не подтверждены${real.length ? '' : ' ни у кого'}: ${model.map(r => esc(r.name)).join(', ')}. Есть только ориентир бизнес-плана — уточните у студии или введите цену вручную в карточке.</p>` : '';
    return `<div class="pgrp pgrp-o"><h4 class="pgrp-h">${esc(KINDS[k].label)}</h4>${body}${modelNote}</div>`;
  }).join('');
  const box = $('priceChart');
  box.innerHTML = grp('Выездной спектакль, за ребёнка', 'Цена за одного зрителя на выезде в сад, школу или ДК.', pp.per_child, mine) +
    grp('Билет на спектакль или сеанс в зале', 'Билет у стационарных площадок — не выезд, но ориентир того, сколько семья платит за ребёнка.', pp.ticket) +
    nod +
    (otherHtml ? `<details class="mk-more wide"><summary>Другие типы цен — сравнивать только между собой</summary>${otherHtml}</details>` : '');
  $('priceMeta').innerHTML = `${freshBadge({ fetched_at: COMP.fetched_at, confidence: 'high', source_name: 'Сверка с сайтами конкурентов' })}<span>«от» — минимальная цена. «Нет данных» — не 0 ₽.</span>`;
  growOnEnter(box);
}

/* ---------- Спрос: только ручной ввод ---------- */

const demandAll = () => { const v = store.get(DEMAND_KEY, []); return Array.isArray(v) ? v : []; };

function initDemand(d) {
  const box = $('demandBox');
  const renderDemand = () => {
    const mine = demandAll();
    // Автоматические данные: после fetch-wordstat статус 'ok' и массив results [{ q, shows_30d }] (за 30 дней)
    const live = d.status === 'ok';
    const autoSrc = Array.isArray(d.results) ? d.results.map(x => ({ q: x && x.q, shows: x && x.shows_30d }))
      : (Array.isArray(d.queries) ? d.queries.filter(x => x && typeof x === 'object').map(x => ({ q: x.q, shows: x.shows })) : []);
    const auto = live
      ? autoSrc.filter(x => x.q && Number.isFinite(x.shows)).sort((x, y) => y.shows - x.shows)
        .map(x => ({ id: 'auto-' + x.q, q: x.q, shows: x.shows, date: d.fetched_at, url: d.source_url || null, auto: true })) : [];
    const rows = [...auto, ...mine];
    $('demandBadge').textContent = rows.length ? (auto.length ? (d.stale ? 'источник · устарело' : 'источник подключён') : `ручной ввод · ${rows.length}`) : 'нет источника';
    const max = Math.max(1, ...rows.map(r => r.shows));
    // Пометка устаревания: stale / stale_since из адаптера (при сбое обновления прежние данные остаются)
    // freshBadge сам рисует «Данные устарели» при stale === true; здесь добавляем дату начала устаревания
    const staleSince = d.stale && d.stale_since ? `<span class="tiny">устарело с ${ruDate(String(d.stale_since).slice(0, 10))}</span>` : '';
    const more = (d.note || d.stale_reason)
      ? `<details class="mk-more"><summary>Подробнее об источнике</summary><p>${esc(d.note || '')}${d.stale_reason ? ' Причина устаревания: ' + esc(d.stale_reason) : ''}</p></details>` : '';
    const autoMeta = auto.length
      ? `<div class="chartmeta">${freshBadge({ ...d, confidence: d.confidence || 'medium', stale: !!d.stale })}${staleSince}<span>Wordstat, запросов за 30 дней.</span>${more}</div>` : '';
    const sources = (d.sources || []).map(s => `<li><span class="dot" aria-hidden="true"></span><span><b>${esc(s.name)}</b> — не подключён<small>${esc(s.how)}</small></span></li>`).join('');
    const chart = rows.length
      ? `<ul class="pbars dbars" aria-label="Показы поисковых запросов: источник и ручной ввод">${rows.map(r => {
          const u = safeUrl(r.url);
          return `<li class="prow"><div class="pname">${esc(r.q)}<small>${ruDate(r.date)} · ${(r.auto && !u) ? 'Wordstat' : (u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">источник</a>` : 'ссылка не указана')}</small></div>
            <div class="ptrack" aria-hidden="true"><span class="pw" style="width:${r.shows / max * 100}%"><span class="pfill"></span></span></div>
            <div class="pval">${fmt(r.shows)}<small>${r.auto ? 'за 30 дн.' : 'показов/мес'}</small>${r.auto ? '' : `<button type="button" class="iconbtn" data-del="${esc(r.id)}" aria-label="Удалить запись «${esc(r.q)}»">${ic('trash-2')}</button>`}</div></li>`;
        }).join('')}</ul>${autoMeta}${mine.length ? '<div class="chartmeta"><span>Строки с кнопкой удаления введены вручную.</span></div>' : ''}`
      : `<div class="nodata nodata-line"><strong>Нет данных: источник спроса не подключён</strong><span>График не строится и не имитируется.</span></div>${sources ? `<details class="mk-more"><summary>Какие источники и как подключить</summary><ul class="srclist">${sources}</ul></details>` : ''}`;
    box.innerHTML = chart + `<details class="mk-more"><summary>Добавить значение вручную</summary>
      <form class="mform" id="demandForm" novalidate>
        <label class="mf"><span>Запрос</span><input name="q" type="text" maxlength="80" placeholder="например, выездной театр" required list="demandQueries"></label>
        <datalist id="demandQueries">${(d.queries || []).filter(x => typeof x === 'string').map(q => `<option value="${esc(q)}"></option>`).join('')}</datalist>
        <div class="mrow">
          <label class="mf"><span>Показов в месяц</span><input name="shows" type="number" inputmode="numeric" min="0" step="1" required></label>
          <label class="mf"><span>Дата данных</span><input name="date" type="date" max="${today()}" value="${today()}" required></label>
        </div>
        <label class="mf"><span>Ссылка на источник</span><input name="url" type="url" inputmode="url" placeholder="https://wordstat.yandex.ru/…"></label>
        <p class="ferr" role="alert" hidden></p>
        <div class="toolrow"><button type="submit" class="btn small primary">Добавить</button></div>
      </form></details>`;
    growOnEnter(box);
    icons();
  };
  renderDemand();
  box.addEventListener('submit', e => {
    const f = e.target.closest('#demandForm'); if (!f) return;
    e.preventDefault();
    const err = f.querySelector('.ferr');
    const fail = msg => { err.textContent = msg; err.hidden = false; };
    const q = f.q.value.trim(), shows = Number(f.shows.value), date = f.date.value, url = f.url.value.trim();
    if (!q) return fail('Введите поисковый запрос.');
    if (f.shows.value === '' || !Number.isFinite(shows) || shows < 0) return fail('Показы — число, ноль или больше.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) return fail('Укажите дату не позже сегодняшней.');
    if (url && !safeUrl(url)) return fail('Ссылка должна начинаться с http:// или https://');
    const arr = demandAll(); arr.push({ id: 'd' + Date.now(), q, shows: Math.round(shows), date, url: url || null });
    if (!store.set(DEMAND_KEY, arr)) return fail('Браузер не дал сохранить данные (приватный режим?).');
    toast('Значение сохранено в этом браузере');
    renderDemand();
  });
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    store.set(DEMAND_KEY, demandAll().filter(x => x.id !== b.dataset.del));
    toast('Запись удалена');
    renderDemand();
  });
}

/* ---------- Сезонность и каникулы (модель проекта) ---------- */

/* Номер месяца (1-12) по подписи модели «Янв»/«Январь»; не распознан — 0 */
const MON3 = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const monthNo = label => MON3.indexOf(String(label || '').trim().slice(0, 3).toLowerCase()) + 1;
const dm = d => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;

function renderSeason(s) {
  const raw = s.months || [];
  const box = $('seasonStrip');
  if (!raw.length) { box.innerHTML = '<div class="nodata"><strong>Нет данных</strong><span>Сезонность не загружена.</span></div>'; return; }
  // Ряд начинается с текущего месяца дня открытия: впереди — ближайшие 12 месяцев, текущий выделен
  const now = new Date();
  const byNo = new Map(raw.map(m => [monthNo(m.m), m]));
  const win = monthWindow(now, 0, 12);
  const months = win.map(w => ({ w, row: byNo.get(w.m) })).filter(x => x.row);
  const max = Math.max(...months.map(x => x.row.shows), 1);
  const peaks = new Set((s.peaks || []).map(p => monthNo(p.m)));
  box.innerHTML = months.map(({ w, row }) => {
    const cls = (peaks.has(w.m) ? ' peak' : '') + (w.current ? ' now' : '');
    return `<div class="seas-m${cls}"${w.current ? ' aria-current="date"' : ''}>
    <span class="seas-v">${row.shows}</span><span class="seas-t" aria-hidden="true"><span class="seas-f" style="height:${row.shows / max * 100}%"></span></span><b>${esc(row.m)}</b></div>`;
  }).join('');
  const cur = months.find(x => x.w.current);
  box.setAttribute('aria-label', `Сезонность выездов, ${windowTitle(win)}${cur ? `; сейчас ${cur.w.name.toLowerCase()} — ${cur.row.shows} показов по модели` : ''}`);
  const peakList = (s.peaks || []).map(p => `<li><span>${esc(p.m)}</span><b>${esc(p.why)}</b></li>`).join('');
  // Бейдж уже говорит «предположение проекта» — дублирующую плашку не рисуем; пояснения — в <details>
  $('chartMeta').innerHTML = `${freshBadge({ ...s, confidence: 'model' })}<span>${esc(windowTitle(win))} · текущий месяц обведён. Прогноз модели, не статистика рынка.</span>` +
    `<details class="mk-more wide"><summary>Как читать и ключевые месяцы</summary><p>${esc(s.note || 'Показы — из базового прогноза модели.')}. Тёмные столбцы — ключевые месяцы.</p>${peakList ? `<ul class="plist">${peakList}</ul>` : ''}</details>`;
  growOnEnter(box);
}

/* Подпись статуса каникул на день открытия: точные даты из seasonality.json, иначе — ориентир модели */
function holidayLine(h, st) {
  if (!st) return `${esc(h.approx)}${h.peak ? ' · ' + esc(h.peak) : ''}`;
  const span = `${dm(st.from)}–${dm(st.to)}`;
  if (st.state === 'now') return `идут сейчас, ${span} · ещё ${st.days} дн.`;
  if (st.state === 'next') return `через ${st.days} дн. · ${span}${h.peak ? ' · ' + esc(h.peak) : ''}`;
  return `прошли ${dm(st.to)}.${st.to.getFullYear()} · следующие: ${esc(h.approx)}, даты ещё не загружены`;
}

function renderHolidays(cal) {
  const hs = cal.holidays || [];
  const seas = state.DATA && state.DATA.seasonality;
  const now = new Date();
  const short = n => n.startsWith('Осен') ? 'осень' : n.startsWith('Зим') ? 'зима' : n.startsWith('Вес') ? 'весна' : n.startsWith('Лет') ? 'лето' : n.slice(0, 5).toLowerCase();
  // Сетка месяцев — от текущего: прошедшие в этом месяце каникулы зачёркнуты, текущий месяц подчёркнут
  const win = monthWindow(now, 0, 12);
  $('holidayCal').innerHTML = win.map(w => {
    const hit = hs.filter(h => (h.months || []).includes(w.m));
    const tags = hit.map(h => {
      const gone = holidayEndedInMonth(seas, h.name, w.y, w.m, now);
      return `<span${gone ? ' class="gone"' : ''}>${short(h.name)}${gone ? '<span class="sr-only"> (прошли)</span>' : ''}</span>`;
    }).join(' · ');
    const title = hit.length ? ` title="${esc(hit.map(h => h.name + ' — ' + h.approx).join('; '))}"` : '';
    return `<div class="hc${hit.length ? ' on' : ''}${w.current ? ' now' : ''}"${w.current ? ' aria-current="date"' : ''}${title}><b>${w.short[0].toUpperCase() + w.short.slice(1)}</b><small>${tags || '·'}</small></div>`;
  }).join('');
  // Список: сначала идущие, затем ближайшие по дате, прошедшие — в конце и приглушены
  const rank = st => !st ? 2 : st.state === 'now' ? 0 : st.state === 'next' ? 1 : 3;
  const rows = hs.map(h => ({ h, st: holidayStatus(seas, h.name, now) }))
    .sort((a, b) => rank(a.st) - rank(b.st) || (a.st && b.st && a.st.state === 'next' && b.st.state === 'next' ? a.st.days - b.st.days : 0));
  $('holidayList').innerHTML = rows.map(({ h, st }) => `<span class="hol${st ? ' ' + st.state : ''}"><b>${esc(h.name)}</b><span>${holidayLine(h, st)}${h.verified === false ? ' · не проверено' : ''}</span></span>`).join('') +
    `<p class="hcal-cap">${esc(windowTitle(win))} · на ${dm(now)}.${now.getFullYear()}</p>` +
    `<details class="mk-more wide"><summary>Откуда даты</summary><div class="chartmeta">${freshBadge({ ...cal, confidence: 'model' })}</div><p>${esc(cal.note || '')} <a href="https://do.nios.ru" target="_blank" rel="noopener noreferrer">do.nios.ru</a></p></details>`;
  growOnEnter($('holidayCal'));
}

/* ---------- Потенциальные клиенты (data/leads.json) + официальная сеть (market.json → network_stats) ---------- */

const LEADS_KEY = 'market.leads';        // { [placeId]: { school, kindergarten, culture, date } } — ручные правки Юлии
const LEADS_STALE_DAYS = 10;             // как в scripts/fetch-leads.mjs: старше — «Данные устарели»
/* Запасной список мест, когда leads.json ещё не получен: только названия для ручного ввода, никаких чисел */
const LEAD_PLACES_FALLBACK = [
  { id: 'novosibirsk', name: 'Новосибирск' }, { id: 'berdsk', name: 'Бердск' }, { id: 'iskitim', name: 'Искитим' },
  { id: 'kochenevo', name: 'Коченёво' }, { id: 'moshkovo', name: 'Мошково' }, { id: 'ordynskoe', name: 'Ордынское' }
];
let NET_ROWS = [], NET_NOTE = '';
const leadsManual = () => { const v = store.get(LEADS_KEY, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };
const hasNum = v => Number.isFinite(v) && v >= 0;
const plural = (n, f) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? f[2] : b > 1 && b < 5 ? f[1] : b === 1 ? f[0] : f[2]; };

/* Давность в днях и подпись «сегодня / вчера / N дн. назад» */
function agoLabel(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  const d = Math.max(0, Math.floor((Date.now() - t) / 864e5));
  return { days: d, text: d === 0 ? 'сегодня' : d === 1 ? 'вчера' : `${d} ${plural(d, ['день', 'дня', 'дней'])} назад` };
}

/* Эффективная строка места: ручная правка главнее данных; без чисел — строка «нет данных» */
function leadRow(p) {
  const m = leadsManual()[p.id];
  if (m && hasNum(m.school) && hasNum(m.kindergarten) && hasNum(m.culture)) {
    return { id: p.id, name: p.name, school: m.school, kindergarten: m.kindergarten, culture: m.culture, potential: m.school + m.kindergarten, manual: true, date: m.date, districts: null, stale: false };
  }
  if (hasNum(p.school)) return { ...p, potential: p.school + p.kindergarten, manual: false };
  return { id: p.id, name: p.name, nodata: true, reason: p.stale_reason || null };
}

/* Ячейка с числом: подпись для узкого экрана берётся из data-l (таблица раскладывается карточками) */
const leadCell = (label, v, cls = '') => `<td data-l="${label}" class="ld-c ${cls}">${hasNum(v) ? fmt(v) : '—'}</td>`;

function leadRowHtml(r) {
  if (r.nodata) return `<tr class="ld-empty"><th scope="row" class="ld-n"><span>${esc(r.name)}</span></th><td class="ld-nd" colspan="4">Нет данных${r.reason ? ` · ${esc(String(r.reason).slice(0, 90))}` : ''}</td></tr>`;
  const tag = r.manual
    ? `<span class="stat st-manual">вручную · ${ruDate(r.date)}</span>`
    : r.stale ? `<span class="fbadge stale" title="${esc(r.stale_reason || 'Не удалось обновить — показаны прежние данные')}">не обновилось</span>` : '';
  const dist = Array.isArray(r.districts) && r.districts.length
    ? `<details class="mk-more mk-sub ld-dist"><summary>По районам (${r.districts.length})</summary><ul class="ld-dl"><li class="ld-dh"><span></span><b>школ</b><b>садов</b><b>ДК</b></li>${r.districts.map(d => `<li><span>${esc(String(d.name).replace(/\s*район$/i, ''))}</span><b>${fmt(d.school)}</b><b>${fmt(d.kindergarten)}</b><b>${fmt(d.culture)}</b></li>`).join('')}</ul></details>` : '';
  return `<tr><th scope="row" class="ld-n"><span>${esc(r.name)}</span>${tag}${dist}</th>${leadCell('Школы', r.school)}${leadCell('Сады', r.kindergarten)}${leadCell('ДК и клубы', r.culture)}${leadCell('Для выезда', r.potential, 'pot')}</tr>`;
}

/* Форма ручной правки: выбор места и три числа; при смене места значения подставляются из текущей строки */
function leadFormHtml(rows, open) {
  const first = rows[0] || {};
  const v = k => (hasNum(first[k]) ? first[k] : '');
  return `<details class="mk-more manual-form ld-form"${open ? ' open' : ''}><summary>Скорректировать вручную</summary>
    <form class="mform" id="leadForm" novalidate>
      <label class="mf"><span>Населённый пункт</span><select name="place">${rows.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></label>
      <div class="mrow ld-nums">
        <label class="mf"><span>Школ</span><input name="school" type="number" inputmode="numeric" min="0" step="1" required value="${v('school')}"></label>
        <label class="mf"><span>Детских садов</span><input name="kindergarten" type="number" inputmode="numeric" min="0" step="1" required value="${v('kindergarten')}"></label>
        <label class="mf"><span>ДК и клубов</span><input name="culture" type="number" inputmode="numeric" min="0" step="1" required value="${v('culture')}"></label>
      </div>
      <p class="tiny">Числа сохраняются только в этом браузере и помечаются «вручную»; автоматические данные не меняются.</p>
      <p class="ferr" role="alert" hidden></p>
      <div class="toolrow"><button type="submit" class="btn small primary">Сохранить</button><button type="button" class="btn small secondary" data-lead-clear>Убрать правку места</button></div>
    </form></details>`;
}

/* Официальная сеть (market.json → network_stats): проверенные вручную данные по территориям — под спойлером */
function officialHtml(rows, note) {
  if (!rows.length) return '';
  const body = rows.map(n => {
    const u = safeUrl(n.url);
    // длинная сводка (>60 знаков) делится по «;» на короткие строки: каждая — отдельный блок, а не абзац из 5–8 строк
    const stat = (String(n.stat).length <= 60 ? [String(n.stat)] : String(n.stat).split(/;\s*/)).filter(Boolean).map(t => `<span class="netline">${esc(t)}</span>`).join('');
    return `<tr role="row"><td role="cell">${esc(n.area)}</td><td role="cell">${n.confidence === 'no_data' ? '<span class="netline muted">Нет данных.</span>' : ''}${stat}</td><td role="cell">${freshBadge({ confidence: n.confidence, fetched_at: COMP.fetched_at, source_url: n.url, source_name: n.area })}${u ? ` <a href="${esc(u)}" target="_blank" rel="noopener noreferrer">источник ${ic('external-link')}</a>` : ''}</td></tr>`;
  }).join('');
  return `<details class="mk-more wide ld-off"><summary>Официальные данные по территориям</summary>${note ? `<p class="tiny">${esc(note)}</p>` : ''}<div class="tablebox"><table class="net" role="table"><thead><tr role="row"><th scope="col" role="columnheader">Территория</th><th scope="col" role="columnheader">Подтверждённый масштаб</th><th scope="col" role="columnheader">Источник</th></tr></thead><tbody role="rowgroup">${body}</tbody></table></div></details>`;
}

/* Блок «Потенциальные клиенты»: итоги, давность, бейдж устаревания, охват, таблица по городам, ручная правка */
function renderLeads(netRows, note) {
  const box = $('networkStats');
  const art = box.closest('article');
  // заголовок и подпись блока задаёт JS: разметка index.html не меняется
  const h = art && art.querySelector('h3'), sub = art && art.querySelector('.rowline .tiny');
  if (h) h.textContent = 'Потенциальные клиенты';
  if (sub) sub.textContent = 'школы, сады и ДК · обновляется раз в неделю';

  const doc = state.DATA && state.DATA.leads;
  const places = doc && Array.isArray(doc.places) && doc.places.length ? doc.places : LEAD_PLACES_FALLBACK;
  const rows = places.map(leadRow);
  const withNums = rows.filter(r => !r.nodata);
  const off = officialHtml(netRows, note);

  // нет ни автоматических, ни ручных данных — компактная строка и ручной ввод, без больших пустых плиток
  if (!withNums.length) {
    const why = doc && doc.stale_reason ? ` ${esc(String(doc.stale_reason).slice(0, 140))}` : '';
    box.innerHTML = `<p class="pnone ld-none"><b>Нет данных</b> · автообновление раз в неделю ещё не получило данные (источник — OpenStreetMap).${why} Можно ввести числа вручную.</p>${leadFormHtml(rows, false)}${off}`;
    bindLeads(rows); icons(); return;
  }

  const sum = k => withNums.reduce((s, r) => s + r[k], 0);
  const ago = agoLabel(doc && doc.updated_at);
  const stale = !!doc && (doc.stale === true || (ago ? ago.days > LEADS_STALE_DAYS : true));
  const src = doc && Array.isArray(doc.sources) && doc.sources[0];
  const srcUrl = safeUrl(src && src.url);
  const anyManual = withNums.some(r => r.manual);
  const partial = !!(doc && Array.isArray(doc.stale_places) && doc.stale_places.length && !doc.stale);
  const tot = [['school', 'школ'], ['kindergarten', 'детсадов'], ['culture', 'ДК и клубов']].map(([k, l]) => `<div class="ld-t"><b>${fmt(sum(k))}</b><span>${l}</span></div>`).join('');
  box.innerHTML = `<div class="ld-head">
      <div class="ld-tot">${tot}<div class="ld-t pot"><b>${fmt(sum('potential'))}</b><span>учреждений для выезда</span></div></div>
      <p class="ld-meta tiny">${ago ? `Обновлено ${ago.text}` : 'Дата обновления неизвестна'}${stale ? ' · <span class="fbadge stale" title="Автообновление не удалось или данные старше 10 дней — числа могли измениться">Данные устарели</span>' : ''}${partial ? ' · часть мест не обновилась' : ''} · ${srcUrl ? `<a href="${esc(srcUrl)}" target="_blank" rel="noopener noreferrer">OpenStreetMap ${ic('external-link')}</a>` : 'OpenStreetMap'} (ODbL)${anyManual ? ' · есть ручные правки' : ''}</p>
      <p class="ld-cov tiny">По данным OpenStreetMap, возможны пропуски: реальных учреждений может быть больше. «Для выезда» = школы + детские сады; ДК и клубы — площадки, а не заказчики.</p>
    </div>
    <div class="tablebox ld-box"><table class="ld" role="table"><thead><tr><th scope="col">Населённый пункт</th><th scope="col">Школы</th><th scope="col">Сады</th><th scope="col">ДК и клубы</th><th scope="col">Для выезда</th></tr></thead><tbody>${rows.map(leadRowHtml).join('')}</tbody></table></div>
    ${leadFormHtml(rows, false)}${off}`;
  bindLeads(rows); icons();
}

/* Ручная правка: сохранение в localStorage и перерисовка блока; подстановка значений при смене места */
function bindLeads(rows) {
  const form = $('leadForm'); if (!form) return;
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  const err = form.querySelector('.ferr');
  const fail = msg => { err.textContent = msg; err.hidden = false; };
  form.place.addEventListener('change', () => {
    const r = byId[form.place.value] || {};
    ['school', 'kindergarten', 'culture'].forEach(k => { form[k].value = hasNum(r[k]) ? r[k] : ''; });
    err.hidden = true;
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const vals = {};
    for (const k of ['school', 'kindergarten', 'culture']) {
      const raw = form[k].value, v = Number(raw);
      if (raw === '' || !Number.isInteger(v) || v < 0 || v > 100000) return fail('Введите целые числа от 0 — по одному для школ, садов и ДК.');
      vals[k] = v;
    }
    const all = leadsManual(); all[form.place.value] = { ...vals, date: today() };
    if (!store.set(LEADS_KEY, all)) return fail('Браузер не дал сохранить данные (приватный режим?).');
    toast('Числа сохранены в этом браузере');
    renderLeads(NET_ROWS, NET_NOTE);
  });
  form.querySelector('[data-lead-clear]').addEventListener('click', () => {
    const all = leadsManual(), id = form.place.value;
    if (!all[id]) return fail('Для этого места ручной правки нет.');
    delete all[id]; store.set(LEADS_KEY, all);
    toast('Ручная правка убрана');
    renderLeads(NET_ROWS, NET_NOTE);
  });
}
