/* market.js — раздел «Навигатор рынка»: карточки конкурентов с фильтрами по группам, диаграмма цен билетов,
   спрос (только ручной ввод, без симуляции), сезонность и каникулы (модель проекта), образовательная сеть.
   Все числа берутся из data/*.json или вводятся пользователем; ничего не придумывается.
   Анимации — только transform/opacity (появление, рост столбцов); reduced-motion оставляет конечное состояние. */
import { $, $$, fmt, ic, icons, toast, store, isStale, enter, counter } from './ui/helpers.js';
import { state } from './state.js';

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
const MANUAL_KEY = 'market.prices';     // { [id]: { value, date, url } }
const DEMAND_KEY = 'market.demand';     // [ { id, q, shows, date, url } ]

const GROUPS_FALLBACK = [
  { type: 'outbound', label: 'Выездные', icon: 'drama' }, { type: 'studio', label: 'Студии', icon: 'users' },
  { type: 'party', label: 'Праздники и лофты', icon: 'cake' }, { type: 'benchmark', label: 'Ориентиры', icon: 'ticket' }
];
const STATUS = { public: 'Публичное предложение', historical: 'Прошлый выезд', mixed: 'Разночтения', reference: 'Ориентир', plan_benchmark: 'Ориентир плана' };
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

/* Числовая цена карточки с учётом ручного ввода: ручное значение главнее данных */
function priceOf(c) {
  const m = manualAll()[c.id];
  if (m && Number.isFinite(m.value)) return { manual: true, value: m.value, date: m.date, url: m.url };
  const p = (c.prices || []).find(x => Number.isFinite(x.value));
  return p ? { manual: false, ...p } : null;
}

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
  renderNetwork(mk.network_stats || []);
  icons();
}

/* ---------- KPI-плашки ---------- */

function renderKpis() {
  const total = ALL.length;
  const priced = ALL.filter(c => priceOf(c)).length;
  const fetched = COMP.fetched_at;
  const stale = fetched && isStale(fetched, thresholdDays('prices'));
  const tile = (icon, label, val, sub) => `<div class="mk-kpi"><span class="mk-kpi-ic">${ic(icon)}</span><small>${label}</small><b data-target="${val}">${val}</b><span class="mk-kpi-sub">${sub}</span></div>`;
  $('marketKpis').innerHTML =
    tile('users', 'В справочнике', total, 'конкурентов и ориентиров') +
    tile('tag', 'Есть цена', priced, 'подтверждена или введена вами') +
    tile('circle-help', 'Нет данных', total - priced, 'это не «бесплатно»') +
    `<div class="mk-kpi"><span class="mk-kpi-ic">${ic('calendar-days')}</span><small>Срез данных</small><b class="d">${ruDate(fetched)}</b><span class="mk-kpi-sub">${stale ? 'Данные устарели' : `свежие, порог ${thresholdDays('prices')} дн.`}</span></div>`;
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
    $$('#marketFilters .chip').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
    renderCards(false);
  };
}

const statusLine = c => STATUS[c.status] ? `<span class="stat st-${esc(c.status)}">${STATUS[c.status]}</span>` : '';

/* Блок цены: подтверждённая / введённая вручную / «нет данных» */
function priceBlock(c) {
  const p = priceOf(c);
  const src = safeUrl(p && p.manual ? p.url : (p && p.source_url) || c.source_url);
  const a = src ? `<a href="${esc(src)}" target="_blank" rel="noopener noreferrer">источник ${ic('external-link')}</a>` : '';
  if (!p) {
    return `<div class="pbox none"><span class="pv">Цена: нет данных</span><span class="ps">${c.price_note && String(c.price_note).length <= 90 ? esc(c.price_note) : 'Проверенного значения нет — детали в «Подробнее» или введите вручную'}</span></div>`;
  }
  const q = p.qualifier ? esc(p.qualifier) + ' ' : '';
  if (p.manual) {
    const stale = isStale(p.date, thresholdDays('prices'));
    return `<div class="pbox manual"><span class="pv">${fmt(p.value)} ₽</span><span class="ps">введено вручную · ${ruDate(p.date)} · ${a || 'ссылка не указана'}</span>${stale ? '<span class="fbadge stale">Данные устарели</span>' : ''}</div>`;
  }
  return `<div class="pbox"><span class="pv">${q}${fmt(p.value)} ${esc(p.unit)}</span><span class="ps">${esc(p.label || '')}${a ? ' · ' + a : ''}</span>${freshBadge(p)}</div>`;
}

/* Абзац карточки: короткий — как есть, длинный — вложенный <details>, чтобы не раздувать карточку */
function longP(label, text) {
  if (!text) return '';
  if (String(text).length <= 90) return `<p><b>${label}:</b> ${esc(text)}</p>`;
  return `<details class="mk-more mk-sub"><summary>${label}</summary><p>${esc(text)}</p></details>`;
}

function cardHtml(c) {
  const g = groupOf(c.type);
  const manual = manualAll()[c.id];
  const link = safeUrl(c.source_url);
  const rest = (c.prices || []).filter(p => Number.isFinite(p.value));
  const details = [
    longP('Программа', c.program),
    longP('Заметка', c.note),
    longP('О цене', c.price_note),
    c.age ? `<p><b>Возраст:</b> ${esc(c.age)}</p>` : '',
    rest.length ? `<ul class="plist">${rest.map(p => `<li><span>${esc(p.label)}</span><b>${p.qualifier ? esc(p.qualifier) + ' ' : ''}${fmt(p.value)} ${esc(p.unit)}</b></li>`).join('')}</ul>` : ''
  ].join('');
  return `<article class="card rival" data-id="${esc(c.id)}" data-type="${esc(c.type)}">
    <div class="rv-top">
      <span class="rv-ic">${ic(g.icon)}</span>
      <div class="rv-t"><h4>${esc(c.name)}</h4><span class="tiny">${esc(c.format || g.label)}${c.district && c.district !== '—' ? ' · ' + esc(c.district) : ''}</span></div>
    </div>
    <div class="rv-st">${statusLine(c)}${manual ? '<span class="stat st-manual">введено вручную</span>' : ''}</div>
    ${c.address ? `<p class="rv-addr">${ic('map-pin')}<span>${esc(c.address)}</span></p>` : ''}
    ${priceBlock(c)}
    ${details ? `<details class="mk-more"><summary>Подробнее</summary><div>${details}</div></details>` : ''}
    <details class="mk-more manual-form"><summary>Ввести цену вручную</summary>
      <form class="mform" data-id="${esc(c.id)}" novalidate>
        <div class="mrow">
          <label class="mf"><span>Цена, ₽ за человека</span><input name="value" type="number" inputmode="decimal" min="1" step="1" required value="${manual ? esc(manual.value) : ''}"></label>
          <label class="mf"><span>Дата проверки</span><input name="date" type="date" max="${today()}" required value="${esc(manual ? manual.date : today())}"></label>
        </div>
        <label class="mf"><span>Ссылка на источник</span><input name="url" type="url" inputmode="url" placeholder="https://…" value="${manual ? esc(manual.url || '') : ''}"></label>
        <p class="ferr" role="alert" hidden></p>
        <div class="toolrow"><button type="submit" class="btn small primary">Сохранить</button>${manual ? '<button type="button" class="btn small secondary" data-clear>Убрать</button>' : ''}</div>
      </form>
    </details>
    ${link ? `<a class="chip tag rv-src" target="_blank" rel="noopener noreferrer" href="${esc(link)}">Источник ${ic('external-link')}</a>` : '<span class="tiny rv-src">Ссылки на источник нет</span>'}
  </article>`;
}

function renderCards(first) {
  const list = ALL.filter(c => activeType === 'all' || c.type === activeType);
  const box = $('marketCards');
  box.innerHTML = list.map(cardHtml).join('') || '<div class="nodata"><strong>Нет данных</strong><span>В этой группе пока нет записей.</span></div>';
  $('rivalsMeta').textContent = `Показано ${list.length} из ${ALL.length} · «нет данных» — не бесплатно`;
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
  box.addEventListener('submit', e => {
    const f = e.target.closest('.mform'); if (!f) return;
    e.preventDefault();
    const err = f.querySelector('.ferr');
    const fail = msg => { err.textContent = msg; err.hidden = false; };
    const v = Number(f.value.value), date = f.date.value, url = f.url.value.trim();
    if (f.value.value === '' || !Number.isFinite(v) || v <= 0) return fail('Введите цену числом больше нуля.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today()) return fail('Укажите дату проверки не позже сегодняшней.');
    if (url && !safeUrl(url)) return fail('Ссылка должна начинаться с http:// или https://');
    const all = manualAll(); all[f.dataset.id] = { value: Math.round(v), date, url: url || null };
    if (!store.set(MANUAL_KEY, all)) return fail('Браузер не дал сохранить данные (приватный режим?).');
    toast('Цена сохранена в этом браузере');
    refreshAfterManual(f.dataset.id);
  });
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-clear]'); if (!b) return;
    const id = b.closest('.mform').dataset.id;
    const all = manualAll(); delete all[id]; store.set(MANUAL_KEY, all);
    toast('Ручная цена убрана');
    refreshAfterManual(id);
  });
}

/* ---------- Диаграмма цен билетов ---------- */

function priceRows() {
  const rows = [];
  ALL.forEach(c => {
    const m = manualAll()[c.id];
    const tp = (c.prices || []).filter(p => p.chart && Number.isFinite(p.value));
    if (m && Number.isFinite(m.value)) {
      rows.push({ name: c.name, sub: 'введено вручную · ' + ruDate(m.date), value: m.value, tag: 'manual', stale: isStale(m.date, thresholdDays('prices')) });
    } else if (tp.length) {
      tp.forEach(p => rows.push({ name: c.name, sub: p.label, value: p.value, q: p.qualifier, tag: p.confidence === 'low' ? 'low' : '', stale: p.stale === true || (!!p.fetched_at && isStale(p.fetched_at, thresholdDays('prices'))) }));
    } else if (c.type === 'outbound' || c.type === 'benchmark') {
      rows.push({ name: c.name, sub: c.type === 'outbound' ? 'выездной' : 'площадка-ориентир', value: null });
    }
  });
  return rows;
}

function renderPriceChart() {
  const tk = CFG && CFG.ticket;
  const unwrap = v => (v && typeof v === 'object' && 'value' in v) ? v.value : v; // значение может быть с провенансом
  const t = tk ? { min: unwrap(tk.min), max: unwrap(tk.max) } : null;
  const all = priceRows();
  const priced = all.filter(r => r.value != null).sort((a, b) => b.value - a.value);
  const empty = all.filter(r => r.value == null);
  const max = Math.max(1, ...priced.map(r => r.value), t && t.max ? t.max : 0);
  const li = (r, cls, valHtml, fill) => `<li class="prow ${cls}"><div class="pname">${esc(r.name)}<small>${esc(r.sub || '')}</small></div><div class="ptrack" aria-hidden="true">${fill}</div><div class="pval">${valHtml}</div></li>`;
  const mine = t && t.min && t.max
    ? li({ name: 'Ваш билет', sub: 'предположение проекта' }, 'mine', `${fmt(t.min)}–${fmt(t.max)} ₽<small>предположение</small>`, `<span class="pw" style="width:${t.max / max * 100}%"><span class="pfill assume"></span></span>`) : '';
  const rows = priced.map(r => li(r, r.tag, `${r.q ? esc(r.q) + ' ' : ''}${fmt(r.value)} ₽${r.tag === 'manual' ? '<small>вручную</small>' : r.tag === 'low' ? '<small>не подтверждено</small>' : ''}${r.stale ? '<small class="stl">устарело</small>' : ''}`, `<span class="pw" style="width:${r.value / max * 100}%"><span class="pfill"></span></span>`));
  const nod = empty.map(r => li(r, 'nod', '<span class="muted">нет данных</span>', '<span class="pw dash"></span>'));
  const box = $('priceChart');
  box.innerHTML = `<ul class="pbars" aria-label="Цены билетов у конкурентов в рублях">${mine}${rows.join('')}${nod.join('')}</ul>`;
  const stale = COMP.fetched_at && isStale(COMP.fetched_at, thresholdDays('prices'));
  $('priceMeta').innerHTML = `${freshBadge({ fetched_at: COMP.fetched_at, confidence: 'medium', source_name: 'Исследование рынка (срез 18.11.2026)', stale })}<span>«Нет данных» — не 0 ₽.</span>`;
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
      : `<div class="nodata"><strong>Нет данных — подключите источник</strong><span>Wordstat и 2ГИС дают спрос только через официальный API с ключом. Без ключа график не строится и не имитируется.</span><ul class="srclist">${sources}</ul></div>`;
    box.innerHTML = chart + `<details class="mk-more" ${rows.length ? '' : 'open'}><summary>Добавить значение вручную</summary>
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

function renderSeason(s) {
  const months = s.months || [];
  const box = $('seasonStrip');
  if (!months.length) { box.innerHTML = '<div class="nodata"><strong>Нет данных</strong><span>Сезонность не загружена.</span></div>'; return; }
  const max = Math.max(...months.map(m => m.shows), 1);
  const peaks = new Set((s.peaks || []).map(p => String(p.m).slice(0, 3).toLowerCase()));
  box.innerHTML = months.map(m => `<div class="seas-m${peaks.has(String(m.m).slice(0, 3).toLowerCase()) ? ' peak' : ''}">
    <span class="seas-v">${m.shows}</span><span class="seas-t" aria-hidden="true"><span class="seas-f" style="height:${m.shows / max * 100}%"></span></span><b>${esc(m.m)}</b></div>`).join('');
  const peakList = (s.peaks || []).map(p => `<li><span>${esc(p.m)}</span><b>${esc(p.why)}</b></li>`).join('');
  // Бейдж уже говорит «предположение проекта» — дублирующую плашку не рисуем; пояснения — в <details>
  $('chartMeta').innerHTML = `${freshBadge({ ...s, confidence: 'model' })}<span>Прогноз модели, не статистика рынка.</span>` +
    `<details class="mk-more wide"><summary>Как читать и ключевые месяцы</summary><p>${esc(s.note || 'Показы — из базового прогноза модели.')}. Тёмные столбцы — ключевые месяцы.</p>${peakList ? `<ul class="plist">${peakList}</ul>` : ''}</details>`;
  growOnEnter(box);
}

function renderHolidays(cal) {
  const names = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
  const hs = cal.holidays || [];
  const short = n => n.startsWith('Осен') ? 'осень' : n.startsWith('Зим') ? 'зима' : n.startsWith('Вес') ? 'весна' : n.startsWith('Лет') ? 'лето' : n.slice(0, 5).toLowerCase();
  $('holidayCal').innerHTML = names.map((n, i) => {
    const hit = hs.filter(h => (h.months || []).includes(i + 1));
    return `<div class="hc${hit.length ? ' on' : ''}" ${hit.length ? `title="${esc(hit.map(h => h.name + ' — ' + h.approx).join('; '))}"` : ''}><b>${n}</b><small>${hit.map(h => short(h.name)).join(' · ') || '·'}</small></div>`;
  }).join('');
  $('holidayList').innerHTML = hs.map(h => `<span class="chip">${esc(h.name)} — ${esc(h.approx)}${h.peak ? ' · ' + esc(h.peak) : ''}${h.verified === false ? ' · не проверено' : ''}</span>`).join('') +
    `<details class="mk-more wide"><summary>Откуда даты</summary><div class="chartmeta">${freshBadge({ ...cal, confidence: 'model' })}</div><p>${esc(cal.note || '')} <a href="https://do.nios.ru" target="_blank" rel="noopener noreferrer">do.nios.ru</a></p></details>`;
  growOnEnter($('holidayCal'));
}

/* ---------- Образовательная сеть ---------- */

function renderNetwork(rows) {
  const body = rows.map(n => {
    const u = safeUrl(n.url);
    return `<tr><td>${esc(n.area)}</td><td>${n.confidence === 'no_data' ? '<span class="muted">Нет данных.</span> ' : ''}${esc(n.stat)}</td><td>${freshBadge({ confidence: n.confidence, fetched_at: COMP.fetched_at, source_url: n.url, source_name: n.area })}${u ? ` <a href="${esc(u)}" target="_blank" rel="noopener noreferrer">источник ${ic('external-link')}</a>` : ''}</td></tr>`;
  }).join('');
  $('networkStats').innerHTML = rows.length
    ? `<div class="tablebox"><table><thead><tr><th scope="col">Территория</th><th scope="col">Подтверждённый масштаб</th><th scope="col">Источник</th></tr></thead><tbody>${body}</tbody></table></div>`
    : '<div class="nodata"><strong>Нет данных</strong><span>Сеть учреждений не загружена.</span></div>';
}
