/* guide.js — раздел «Справочник»: вкладки (role=tablist), чек-листы с прогрессом,
   карточки «риск → решение», шаблоны с копированием, словарь, поиск (ё = е), архив исследования.
   Формат записей: {id, tab, category, title, text, details[], checklist[], unverified[], glossary, risk, solution,
   template{fields[],body}, legal, source_name, source_url, verified_at, confidence}. */
import { $, $$, icons, popNumber, toast } from './ui/helpers.js';
import { state } from './state.js';
import { loadArchive } from './data-loader.js';

const KEY_CHECKS = 'yulia.v2.guide.checks';   // { "<entryId>#<i>": true }
const KEY_FIELDS = 'yulia.v2.guide.fields';   // { "<entryId>": { key: value } }
const KEY_TAB = 'yulia.v2.guide.tab';

const ui = { tab: 'docs', q: '' };
let checks = {};
let fields = {};

/* ---------- безопасное хранилище (localStorage может быть недоступен) ---------- */
/* Единый формат: всё хранится как JSON (строки тоже). Старая запись без кавычек («docs»)
   читается как есть, если fallback — строка, и при следующем сохранении станет JSON. */
function load(key, fallback) {
  let raw = null;
  try { raw = localStorage.getItem(key); } catch (e) { return fallback; }
  if (raw === null) return fallback;
  try { const v = JSON.parse(raw); return v ?? fallback; } catch (e) { return typeof fallback === 'string' ? raw : fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* хранилище недоступно: состояние живёт до перезагрузки */ }
}

/* ---------- утилиты ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').toLocaleLowerCase('ru').replaceAll('ё', 'е');
/* Простая морфология: у слов длиннее 5 букв отбрасываем до 3 последних (окончание), но оставляем ≥5 букв:
   «самозанятый» → «самозаня» находит «самозанятые», «самозанятого». Короткие слова ищутся как есть. */
const stem = w => (w.length > 5 ? w.slice(0, Math.max(5, w.length - 3)) : w);
const queryStems = q => norm(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(stem);
const fmtDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; };
const checkKey = (id, i) => `${id}#${i}`;
const entryById = id => state.DATA.guide.entries.find(e => e.id === id);

/* Прогресс по списку записей: [отмечено, всего] */
function progress(entries) {
  let done = 0, total = 0;
  for (const e of entries) (e.checklist || []).forEach((_, i) => { total++; if (checks[checkKey(e.id, i)]) done++; });
  return [done, total];
}

/* Текст для поиска: всё, что видит пользователь в карточке */
function haystack(e) {
  const tpl = e.template ? e.template.fields.map(f => f.label).join(' ') : '';
  return norm([e.title, e.text, e.category, e.risk, e.solution, (e.details || []).join(' '), (e.checklist || []).join(' '), (e.unverified || []).join(' '), tpl, e.source_name].join(' '));
}

/* ---------- пометка достоверности ---------- */
function note(e) {
  if (e.legal) {
    const verified = e.verified_at ? `Проверено: ${fmtDate(e.verified_at)}` : 'Не проверено';
    const src = e.source_url
      ? `<a href="${esc(e.source_url)}" target="_blank" rel="noopener noreferrer">${esc(e.source_name || 'Источник')}</a>`
      : esc(e.source_name || 'Источник не найден');
    const low = e.confidence === 'low' || e.confidence === 'no_data' || !e.verified_at;
    const unv = (e.unverified || []).length ? '<span>Часть утверждений не проверена: см. «Подробнее»</span>' : '';
    return `<div class="g-note${low ? ' g-note--warn' : ''}"><span>${verified}</span><span>Источник: ${src}</span>${unv}<span>Требует консультации со специалистом</span></div>`;
  }
  if (e.confidence === 'model' && !e.glossary) return '<div class="g-note"><span>Предположение проекта</span><span>Можно менять под себя</span></div>';
  return '';
}

/* ---------- блоки карточки ---------- */
function checklistHtml(e) {
  if (!e.checklist || !e.checklist.length) return '';
  return `<ul class="g-checks">${e.checklist.map((t, i) => {
    const k = checkKey(e.id, i), on = !!checks[k];
    return `<li><label class="g-check"><input type="checkbox" data-k="${esc(k)}"${on ? ' checked' : ''}><span class="g-box" aria-hidden="true"></span><span class="g-lbl">${esc(t)}</span></label></li>`;
  }).join('')}</ul>`;
}

function detailsHtml(e) {
  const unv = (e.unverified || []).length ? `<p><b>Не проверено:</b> ${esc(e.unverified.join('; '))}.</p>` : '';
  if (!(e.details && e.details.length) && !unv) return '';
  return `<details class="g-more"><summary>Подробнее</summary>${(e.details || []).map(d => `<p>${esc(d)}</p>`).join('')}${unv}</details>`;
}

/* Подставляет значения полей в тело шаблона; пустое поле → [Название поля] */
function fillTemplate(e) {
  const v = fields[e.id] || {};
  const byKey = Object.fromEntries(e.template.fields.map(f => [f.key, f.label]));
  return e.template.body.replace(/\{\{(\w+)\}\}/g, (_, k) => (v[k] && v[k].trim()) ? v[k].trim() : `[${byKey[k] || k}]`);
}

function templateHtml(e) {
  const v = fields[e.id] || {};
  const inputs = e.template.fields.map(f => {
    const id = `gf-${e.id}-${f.key}`;
    return `<div class="g-field"><label for="${esc(id)}">${esc(f.label)}</label><input id="${esc(id)}" type="text" data-e="${esc(e.id)}" data-f="${esc(f.key)}" value="${esc(v[f.key] || '')}" placeholder="${esc(f.placeholder || '')}" autocomplete="off"></div>`;
  }).join('');
  return `<details class="g-tpl"><summary>Заполнить и скопировать</summary>
    <div class="g-fields">${inputs}</div>
    <pre class="g-preview" id="gp-${esc(e.id)}" aria-label="Готовый текст">${esc(fillTemplate(e))}</pre>
    <div class="g-actions"><button type="button" class="btn secondary" data-copy="${esc(e.id)}">Скопировать</button><button type="button" class="btn secondary" data-clear="${esc(e.id)}">Очистить поля</button></div>
  </details>`;
}

function riskHtml(e) {
  return `<div class="g-risk"><div><small>Риск</small><p>${esc(e.risk)}</p></div><div class="g-arrow" aria-hidden="true">↓</div><div><small>Что делать</small><p>${esc(e.solution)}</p></div></div>`;
}

function cardHtml(e, showTab) {
  const tabTitle = showTab ? (state.DATA.guide.tabs.find(t => t.id === e.tab) || {}).title : '';
  const head = `<div class="g-cat">${esc(tabTitle ? `${tabTitle} · ${e.category}` : e.category)}</div>`;
  if (e.glossary) return `<article class="g-card g-term" id="g-${esc(e.id)}">${head}<h3>${esc(e.title)}</h3><p>${esc(e.text)}</p></article>`;
  return `<article class="g-card" id="g-${esc(e.id)}">${head}<h3>${esc(e.title)}</h3>
    ${e.risk ? riskHtml(e) : ''}${e.text ? `<p class="g-text">${esc(e.text)}</p>` : ''}
    ${checklistHtml(e)}${detailsHtml(e)}${e.template ? templateHtml(e) : ''}${note(e)}</article>`;
}

/* ---------- вкладки ---------- */
function renderTabs() {
  const tabs = state.DATA.guide.tabs;
  $('guideTabs').innerHTML = tabs.map(t => {
    const [d, n] = progress(state.DATA.guide.entries.filter(e => e.tab === t.id));
    const on = !queryStems(ui.q).length && ui.tab === t.id;
    return `<button type="button" class="tab${on ? ' on' : ''}" role="tab" id="gt-${t.id}" data-tab="${t.id}" aria-selected="${on}" aria-controls="entries" tabindex="${ui.tab === t.id ? 0 : -1}">${esc(t.title)}${n ? `<span class="g-count" data-count="${t.id}">${d}/${n}</span>` : ''}</button>`;
  }).join('');
}

/* Стрелки, Home и End переключают вкладку (roving tabindex) */
function onTabKey(e) {
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
  const btns = $$('#guideTabs [role="tab"]');
  const cur = btns.indexOf(document.activeElement);
  if (cur < 0) return;
  e.preventDefault();
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : (cur + (e.key === 'ArrowRight' ? 1 : -1) + btns.length) % btns.length;
  ui.q = ''; $('q').value = '';
  selectTab(btns[next].dataset.tab);
  $(`gt-${ui.tab}`).focus();
}

function selectTab(id) {
  ui.tab = id;
  save(KEY_TAB, id);
  view();
}

/* ---------- основной вывод ---------- */
function view() {
  const g = state.DATA.guide;
  renderTabs();
  const box = $('entries');
  box.setAttribute('role', 'tabpanel');
  const stems = queryStems(ui.q);
  const q = stems.length > 0;
  const tab = g.tabs.find(t => t.id === ui.tab) || g.tabs[0];
  /* При поиске панель — «Результаты поиска» (вкладки не выбраны); иначе — панель выбранной вкладки */
  if (q) { box.removeAttribute('aria-labelledby'); box.setAttribute('aria-label', 'Результаты поиска по справочнику'); }
  else { box.removeAttribute('aria-label'); box.setAttribute('aria-labelledby', `gt-${tab.id}`); }
  const rows = q ? g.entries.filter(e => { const h = haystack(e); return stems.every(w => h.includes(w)); }) : g.entries.filter(e => e.tab === tab.id);

  if (q) $('found').textContent = `Поиск по всем разделам · найдено ${rows.length}`;
  else {
    const [d, n] = progress(rows);
    $('found').textContent = `${tab.title} · карточек: ${rows.length}${n ? ` · выполнено ${d} из ${n}` : ''}`;
  }

  if (!rows.length) { box.innerHTML = '<p class="hint">Ничего не найдено. Попробуйте «лицензия», «касса», «НДС» или «грант».</p>'; return; }

  const intro = q ? '' : `<p class="g-intro">${esc(tab.intro)}</p>${progressBar(rows)}`;
  const cls = !q && tab.id === 'glossary' ? 'g-grid g-grid--terms' : 'g-grid';
  box.innerHTML = `${intro}<div class="${cls}">${rows.map(e => cardHtml(e, !!q)).join('')}</div>`;
  icons();
}

function progressBar(rows) {
  const [d, n] = progress(rows);
  if (!n) return '';
  return `<div class="g-prog"><span class="track g-track" role="progressbar" aria-label="Прогресс вкладки" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${d}"><span id="gProgBar" style="transform:scaleX(${d / n})"></span></span><b id="gProgNum">${d}/${n}</b></div>`;
}

/* Обновляет прогресс без перерисовки карточек (фокус и раскрытые блоки не сбрасываются) */
function refreshProgress() {
  const g = state.DATA.guide;
  const tab = g.tabs.find(t => t.id === ui.tab);
  if (!queryStems(ui.q).length && tab) {
    const rows = g.entries.filter(e => e.tab === tab.id);
    const [d, n] = progress(rows);
    const bar = $('gProgBar'), num = $('gProgNum');
    if (bar) { bar.style.transform = `scaleX(${n ? d / n : 0})`; bar.parentElement.setAttribute('aria-valuenow', String(d)); }
    if (num) popNumber(num, `${d}/${n}`);
    $('found').textContent = `${tab.title} · карточек: ${rows.length} · выполнено ${d} из ${n}`;
  }
  for (const t of g.tabs) {
    const el = document.querySelector(`[data-count="${t.id}"]`);
    if (el) { const [d, n] = progress(g.entries.filter(e => e.tab === t.id)); el.textContent = `${d}/${n}`; }
  }
}

/* ---------- копирование ---------- */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* пробуем запасной способ */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

/* ---------- события карточек (делегирование) ---------- */
function onChange(ev) {
  const cb = ev.target.closest('input[type="checkbox"][data-k]');
  if (!cb) return;
  if (cb.checked) checks[cb.dataset.k] = true; else delete checks[cb.dataset.k];
  save(KEY_CHECKS, checks);
  refreshProgress();
}

function onInput(ev) {
  const inp = ev.target.closest('input[data-e][data-f]');
  if (!inp) return;
  const id = inp.dataset.e;
  (fields[id] ||= {})[inp.dataset.f] = inp.value;
  save(KEY_FIELDS, fields);
  const entry = entryById(id), pre = $(`gp-${id}`);
  if (entry && pre) pre.textContent = fillTemplate(entry);
}

async function onClick(ev) {
  const copyBtn = ev.target.closest('[data-copy]');
  const clearBtn = ev.target.closest('[data-clear]');
  if (copyBtn) {
    const entry = entryById(copyBtn.dataset.copy);
    if (!entry) return;
    toast(await copyText(fillTemplate(entry)) ? 'Текст скопирован' : 'Не удалось скопировать: выделите текст вручную');
  } else if (clearBtn) {
    const id = clearBtn.dataset.clear;
    delete fields[id];
    save(KEY_FIELDS, fields);
    $$(`input[data-e="${id}"]`).forEach(i => { i.value = ''; });
    const entry = entryById(id);
    if (entry) $(`gp-${id}`).textContent = fillTemplate(entry);
    toast('Поля очищены');
  }
}

/* Числовые ячейки архива (цифры, пробелы, знаки ₽ % – ,. и «руб.») получают класс num: выравнивание вправо в CSS */
function markNumericCells(root) {
  $$('td', root).forEach(td => {
    const t = td.textContent.trim();
    if (/\d/.test(t) && /^[\d\s .,%₽\-–—]+(руб[.]?)?$/u.test(t)) td.classList.add('num');
  });
}

/* ---------- вход ---------- */
export function initGuide(guide) {
  /* Без данных нового формата показываем понятное сообщение вместо пустого экрана */
  if (!guide || !Array.isArray(guide.tabs) || !guide.tabs.length) {
    $('guideTabs').innerHTML = '';
    $('entries').innerHTML = '<p class="hint">Справочник недоступен: нет данных. Загрузите data/guide.json.</p>';
    return;
  }
  checks = load(KEY_CHECKS, {});
  fields = load(KEY_FIELDS, {});
  const saved = load(KEY_TAB, 'docs');
  ui.tab = guide.tabs.some(t => t.id === saved) ? saved : guide.tabs[0].id;

  const tabs = $('guideTabs');
  tabs.setAttribute('role', 'tablist');
  tabs.onclick = e => {
    const b = e.target.closest('[role="tab"]'); if (!b) return;
    ui.q = ''; $('q').value = '';
    selectTab(b.dataset.tab);
  };
  tabs.onkeydown = onTabKey;
  const box = $('entries');
  box.addEventListener('change', onChange);
  box.addEventListener('input', onInput);
  box.addEventListener('click', onClick);
  $('q').oninput = () => { ui.q = $('q').value; view(); };
  view();

  loadArchive()
    .then(html => { $('archiveBody').innerHTML = html; markNumericCells($('archiveBody')); })
    .catch(() => { $('archiveBody').innerHTML = '<p class="hint">Архив недоступен без сети.</p>'; });
}
