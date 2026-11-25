/* crm-ui.js — вкладка «Список» подраздела «Клиенты и площадки»: мини-CRM площадок.
   Список объектов выбранного места (школы, сады, ДК из data/leads.json) с поиском, фильтрами по типу и статусу,
   счётчиком прогресса; карточка объекта — статус, заметка, дата контакта, «Скопировать шаблон сообщения»;
   экспорт и импорт базы (JSON) для переноса между телефоном и ноутбуком.
   Логика и проверка данных — в js/crm.js (чистые функции, tests/crm.test.mjs); здесь — только DOM и хранение.
   Хранение — localStorage через store (ключ yulia.v2.crm), каждое чтение и запись в try/catch внутри store.
   Подраздел — модальный <dialog>: всё, что должно быть видно или кликабельно (тост, поле выбора файла,
   ссылка скачивания, запасной textarea для копирования), создаётся внутри диалога — элементы вне его инертны. */
import { fmt, ic, icons, store } from './ui/helpers.js';
import { state } from './state.js';
import { validObjects, pluralRu } from './clients-model.js';
import {
  STATUSES, STORE_KEY, NOTE_MAX, normalizeDb, recordOf, statusOf, statusLabel, setStatus, setNote, setDate, todayISO,
  countStatuses, progressLine, progressShares, filterRows, rowsOf, fillTemplate, exportPayload, exportFileName,
  parseImport, mergeImport, importSummary, countOrphans, ruQuotes
} from './crm.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ruDate = iso => (iso ? iso.split('-').reverse().join('.') : '');
const PAGE = 200;                                    // строк за один рендер; дальше — «Показать ещё»
const KIND_LABEL = { s: 'Школа', d: 'Детский сад', c: 'ДК / клуб' };
const KIND_SHORT = { s: 'Школа', d: 'Сад', c: 'ДК' };

let root = null, hooks = {}, db = null, place = null, rows = [], rowsFor = null, allPlaces = [];
let filter = { q: '', kind: 'all', status: 'all' }, shown = PAGE, cardKey = null, listScroll = 0, noteTimer = 0;
const listeners = new Set();

/* ---------- Хранение ---------- */
function load() { db = normalizeDb(store.get(STORE_KEY, null)); return db; }
function dbNow() { return db || load(); }
function save(next) {
  if (next === db) return true;
  db = next;
  const ok = store.set(STORE_KEY, db);
  if (!ok) say('Не удалось сохранить: память браузера недоступна (приватный режим или переполнена). Сделайте экспорт базы.', true);
  listeners.forEach(fn => { try { fn(); } catch (e) { /* подписчик не должен ломать сохранение */ } });
  return ok;
}

/* Подписка на изменения базы (карта перекрашивает точки) */
export function onCrmChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/* Статус объекта по ключу — для раскраски точек на карте */
export function crmStatus(key) { return statusOf(dbNow(), key); }

/* Изменения из другой вкладки браузера (тот же телефон/ноутбук) — перечитать базу */
if (typeof window !== 'undefined') {
  addEventListener('storage', e => {
    if (e.key !== 'yulia.v2.' + STORE_KEY) return;
    load();
    listeners.forEach(fn => { try { fn(); } catch (err) { /* не критично */ } });
    if (root) { renderList(); if (cardKey) renderCard(); }
  });
}

/* ---------- Каркас вкладки ---------- */
export function mountCrm(el, opts = {}) {
  if (!el) return;
  hooks = opts;
  if (root === el && el.firstChild) return;
  root = el;
  dbNow();
  el.innerHTML = `
    <div class="crm-listview">
      <div class="crm-head">
        <div class="cl-placebar"><label for="crmPlace">Место</label><select id="crmPlace"></select></div>
        <div class="crm-io" role="group" aria-label="Перенос базы между устройствами">
          <button type="button" class="ghostbtn crm-iob" data-crm-export>${ic('save')}<span>Экспорт базы (JSON)</span></button>
          <button type="button" class="ghostbtn crm-iob" data-crm-import>${ic('archive')}<span>Импорт базы (JSON)</span></button>
          <input type="file" accept="application/json,.json" data-crm-file hidden>
        </div>
      </div>
      <p class="crm-msg" role="status" aria-live="polite" hidden></p>
      <div class="crm-progress">
        <p class="crm-pline" id="crmPLine"></p>
        <div class="crm-bar" role="img" id="crmBar"></div>
      </div>
      <div class="crm-tools">
        <label class="crm-search"><span class="crm-sr">Поиск по названию или заметке</span>
          <input type="search" id="crmQ" placeholder="Поиск: название или заметка" autocomplete="off" enterkeyhint="search"></label>
        <div class="crm-kinds" role="group" aria-label="Тип объекта">
          ${[['all', 'Все'], ['d', 'Сады'], ['s', 'Школы'], ['c', 'ДК']].map(([id, l]) => `<button type="button" class="crm-kind" data-crm-kind="${id}" aria-pressed="${id === 'all'}">${l}</button>`).join('')}
        </div>
        <label class="crm-stsel"><span>Статус</span><select id="crmStatus"></select></label>
      </div>
      <p class="crm-found" id="crmFound"></p>
      <ul class="crm-list" id="crmList"></ul>
      <button type="button" class="btn secondary crm-more" id="crmMore" hidden></button>
      <p class="hint crm-hint">Статусы, заметки и даты хранятся только в этом браузере. Чтобы перенести их на другое устройство — «Экспорт базы», затем «Импорт базы» там. При импорте у одинаковых площадок остаётся более поздняя правка.</p>
    </div>
    <section class="crm-card" id="crmCard" hidden aria-labelledby="crmCardTitle"></section>
    <div class="crm-toast" role="status" aria-live="polite"></div>`;

  // Место: общий выбор с вкладкой «Карта» (clients-view синхронизирует оба списка)
  el.querySelector('#crmPlace').addEventListener('change', e => { if (hooks.onPlace) hooks.onPlace(e.target.value); });
  // Поиск — с короткой задержкой, чтобы не перерисовывать 700 строк на каждую букву
  let qt = 0;
  el.querySelector('#crmQ').addEventListener('input', e => {
    clearTimeout(qt);
    qt = setTimeout(() => { filter.q = e.target.value; shown = PAGE; renderList(); }, 160);
  });
  el.querySelectorAll('[data-crm-kind]').forEach(b => b.addEventListener('click', () => {
    filter.kind = b.dataset.crmKind; shown = PAGE;
    el.querySelectorAll('[data-crm-kind]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderList();
  }));
  el.querySelector('#crmStatus').addEventListener('change', e => { filter.status = e.target.value; shown = PAGE; renderList(); });
  el.querySelector('#crmMore').addEventListener('click', () => { shown += PAGE; renderList(true); });
  // Строки списка — делегирование: один обработчик на весь список
  el.querySelector('#crmList').addEventListener('click', e => {
    const b = e.target.closest('[data-crm-key]');
    if (b) openCard(b.dataset.crmKey);
  });
  el.querySelector('[data-crm-export]').addEventListener('click', doExport);
  const file = el.querySelector('[data-crm-file]');
  el.querySelector('[data-crm-import]').addEventListener('click', () => { file.value = ''; file.click(); });
  file.addEventListener('change', () => { if (file.files && file.files[0]) doImport(file.files[0]); });
  // Карточка: делегирование кликов и ввода
  const card = el.querySelector('#crmCard');
  card.addEventListener('click', onCardClick);
  card.addEventListener('input', onCardInput);
  card.addEventListener('change', onCardChange);
  card.addEventListener('focusout', e => { if (e.target.matches('textarea')) flushNote(); });
  icons();
}

/* ---------- Место ---------- */
export function setCrmPlace(p, places) {
  place = p || null;
  if (!root) return;
  const sel = root.querySelector('#crmPlace');
  const list = Array.isArray(places) ? places : [];
  allPlaces = list;                                  // все места — чтобы при импорте узнать записи без объекта на карте
  sel.innerHTML = list.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
  sel.disabled = !list.length;
  if (place) sel.value = place.id;
  if (!place || rowsFor !== place.id) {
    rows = place ? rowsOf(validObjects(place)) : [];
    rowsFor = place ? place.id : null;
    shown = PAGE;
    if (cardKey && !rows.some(r => r.key === cardKey)) closeCard(false);
  }
  renderList();
}

/* ---------- Прогресс ---------- */
function renderProgress() {
  const c = countStatuses(dbNow(), rows.map(r => r.key));
  root.querySelector('#crmPLine').innerHTML = `<b>${esc(progressLine(c))}</b>${c.contacted ? ` <small>· отмечено ${c.contacted * 100 / c.total < 1 ? 'меньше 1' : fmt(c.contacted * 100 / c.total)}% площадок</small>` : ''}`;
  const sh = progressShares(c);
  const bar = root.querySelector('#crmBar');
  bar.innerHTML = ['deal', 'talks', 'sent', 'refused'].map(id => sh[id] > 0
    ? `<span class="crm-seg-${id}" style="width:${Math.max(sh[id] * 100, 0.6).toFixed(2)}%"></span>` : '').join('');
  bar.setAttribute('aria-label', `Прогресс: ${progressLine(c)}`);
  // счётчики в выборе статуса
  const sel = root.querySelector('#crmStatus');
  sel.innerHTML = `<option value="all">Все статусы (${fmt(c.total)})</option>`
    + STATUSES.map(s => `<option value="${s.id}">${s.label} (${fmt(c[s.id])})</option>`).join('');
  sel.value = filter.status;
  return c;
}

/* ---------- Список ---------- */
/* Название для списка и карточки: прямые кавычки OSM ("Солнышко") → «Солнышко», как в шаблоне сообщения */
function rowTitle(r) { return r.n ? ruQuotes(r.n) : `${KIND_LABEL[r.k] || 'Объект'} · без названия в OSM`; }

function renderList(append) {
  if (!root) return;
  const list = root.querySelector('#crmList');
  if (!place) {
    renderProgress();
    root.querySelector('#crmFound').textContent = '';
    list.innerHTML = '<li class="nodata"><strong>Нет данных</strong><span>Список школ, садов и ДК не загрузился. Проверьте интернет и откройте раздел ещё раз.</span></li>';
    root.querySelector('#crmMore').hidden = true;
    return;
  }
  renderProgress();
  const d = dbNow();
  const found = filterRows(rows, d, filter);
  const from = append ? list.children.length : 0;
  const to = Math.min(found.length, shown);
  root.querySelector('#crmFound').textContent = found.length
    ? `Найдено ${fmt(found.length)}${found.length > to ? ` · показано ${fmt(to)}` : ''}`
    : '';
  const html = found.slice(from, to).map(r => {
    const rec = recordOf(d, r.key);
    const bits = [KIND_SHORT[r.k], statusLabel(r.s)];
    if (rec.date) bits.push(ruDate(rec.date));
    const note = rec.note ? `<small class="crm-rnote">${esc(rec.note.length > 90 ? rec.note.slice(0, 90) + '…' : rec.note)}</small>` : '';
    return `<li><button type="button" class="crm-row" data-crm-key="${esc(r.key)}">
      <i class="crm-dot crm-st-${r.s}" aria-hidden="true"></i>
      <span class="crm-rt"><b${r.n ? '' : ' class="crm-noname"'}>${esc(rowTitle(r))}</b><small>${esc(bits.join(' · '))}</small>${note}</span>
      <span class="crm-chev" aria-hidden="true">›</span></button></li>`;
  }).join('');
  if (append) list.insertAdjacentHTML('beforeend', html);
  else list.innerHTML = html || `<li class="nodata"><strong>Ничего не найдено</strong><span>Измените поиск или фильтры.</span></li>`;
  const more = root.querySelector('#crmMore');
  more.hidden = found.length <= to;
  more.textContent = `Показать ещё (${fmt(Math.min(PAGE, found.length - to))} из ${fmt(found.length - to)})`;
}

/* ---------- Карточка объекта ---------- */
function rowByKey(key) { return rows.find(r => r.key === key) || null; }
export const crmCardOpen = () => !!(root && cardKey && !root.querySelector('#crmCard').hidden);

export function openCard(key) {
  if (!root) return false;
  const r = rowByKey(key);
  if (!r) return false;
  const body = root.closest('.cl-body');
  if (!crmCardOpen()) listScroll = body ? body.scrollTop : 0;
  cardKey = key;
  root.querySelector('.crm-listview').hidden = true;
  root.querySelector('#crmCard').hidden = false;
  renderCard();
  if (body) body.scrollTop = 0;
  const h = root.querySelector('#crmCardTitle');
  if (h) h.focus({ preventScroll: true });
  return true;
}

export function closeCard(focusRow = true) {
  if (!root) return;
  flushNote();
  const key = cardKey;
  cardKey = null;
  root.querySelector('#crmCard').hidden = true;
  root.querySelector('.crm-listview').hidden = false;
  renderList();
  const body = root.closest('.cl-body');
  if (body) body.scrollTop = listScroll;
  if (focusRow && key) {
    const b = root.querySelector(`[data-crm-key="${CSS.escape(key)}"]`);
    if (b) b.focus({ preventScroll: true });
  }
}

function tplNow() { return (state.CFG && state.CFG.crm_templates) || null; }

function renderCard() {
  const r = rowByKey(cardKey);
  const box = root.querySelector('#crmCard');
  if (!r) { closeCard(false); return; }
  const rec = recordOf(dbNow(), r.key);
  const text = fillTemplate(tplNow(), r);
  const who = { d: 'заведующей сада', s: 'директору или заместителю по воспитательной работе', c: 'директору ДК' }[r.k] || '';
  box.innerHTML = `
    <button type="button" class="btn small secondary crm-back" data-crm-back><span aria-hidden="true">←</span> К списку</button>
    <h3 id="crmCardTitle" tabindex="-1"${r.n ? '' : ' class="crm-noname"'}>${esc(rowTitle(r))}</h3>
    <p class="tiny crm-sub">${esc(KIND_LABEL[r.k] || '')}${place ? ' · ' + esc(place.name) : ''} · OpenStreetMap${r.n ? '' : ' · своё название можно записать в заметку'}</p>
    <fieldset class="crm-status">
      <legend>Статус</legend>
      <div class="crm-segs" role="radiogroup" aria-label="Статус работы с площадкой">
        ${STATUSES.map(s => `<button type="button" class="crm-sb" role="radio" aria-checked="${rec.s === s.id}" tabindex="${rec.s === s.id ? 0 : -1}" data-crm-st="${s.id}">
          <i class="crm-dot crm-st-${s.id}" aria-hidden="true"></i><span>${s.label}</span></button>`).join('')}
      </div>
    </fieldset>
    <div class="crm-fields">
      <label class="crm-f"><span>Дата контакта</span><input type="date" data-crm-date value="${esc(rec.date)}" max="2100-12-31"></label>
      <label class="crm-f crm-fnote"><span>Заметка <small data-crm-count>${rec.note.length}/${NOTE_MAX}</small></span>
        <textarea data-crm-note rows="3" maxlength="${NOTE_MAX}" placeholder="Кто ответил, телефон, о чём договорились">${esc(rec.note)}</textarea></label>
    </div>
    <div class="crm-actions">
      <button type="button" class="btn crm-copy" data-crm-copy${text ? '' : ' disabled'}>${ic('copy')}<span>Скопировать шаблон сообщения</span></button>
      ${hooks.onShowOnMap ? `<button type="button" class="ghostbtn crm-onmap" data-crm-map>${ic('map-pin')}<span>Показать на карте</span></button>` : ''}
    </div>
    ${text ? `<details class="crm-tpl"><summary>Текст шаблона — ${esc(who)}</summary><p class="crm-tpltext">${esc(text).replace(/\n/g, '<br>')}</p>
      <small class="crm-tplsrc">Шаблон проекта из data/config.json · проверьте текст перед отправкой</small></details>`
      : '<p class="hint">Шаблоны сообщений не загрузились (нет data/config.json). Откройте раздел при подключении к интернету.</p>'}
    <p class="crm-saved tiny" data-crm-saved>${rec.upd ? 'Сохранено ' + new Date(rec.upd).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : 'Ещё не отмечали'}</p>`;
  // стрелки по сегментам статуса (паттерн radiogroup)
  box.querySelector('.crm-segs').addEventListener('keydown', e => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const ids = STATUSES.map(s => s.id);
    const cur = statusOf(dbNow(), cardKey);
    const i = (ids.indexOf(cur) + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : ids.length - 1)) % ids.length;
    applyStatus(ids[i]);
    const b = box.querySelector(`[data-crm-st="${ids[i]}"]`);
    if (b) b.focus();
    e.preventDefault();
  });
  icons();
}

function metaOf(r) { return { name: r.n, k: r.k, place: place ? place.id : '' }; }

function applyStatus(id) {
  const r = rowByKey(cardKey);
  if (!r) return;
  flushNote();
  save(setStatus(dbNow(), r.key, id, todayISO(), Date.now(), metaOf(r)));
  const rec = recordOf(dbNow(), r.key);
  const box = root.querySelector('#crmCard');
  box.querySelectorAll('[data-crm-st]').forEach(b => {
    const on = b.dataset.crmSt === rec.s;
    b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1;
  });
  const di = box.querySelector('[data-crm-date]');
  if (di && di.value !== rec.date) di.value = rec.date;
  markSaved(rec);
  renderProgress();
}

function markSaved(rec) {
  const s = root.querySelector('[data-crm-saved]');
  if (s && rec.upd) s.textContent = 'Сохранено ' + new Date(rec.upd).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

function flushNote() {
  if (!noteTimer) return;
  clearTimeout(noteTimer); noteTimer = 0;
  const ta = root && root.querySelector('[data-crm-note]');
  const r = rowByKey(cardKey);
  if (!ta || !r) return;
  if (recordOf(dbNow(), r.key).note === ta.value) return;
  save(setNote(dbNow(), r.key, ta.value, Date.now(), metaOf(r)));
  markSaved(recordOf(dbNow(), r.key));
}

function onCardClick(e) {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.hasAttribute('data-crm-back')) closeCard();
  else if (t.dataset.crmSt) applyStatus(t.dataset.crmSt);
  else if (t.hasAttribute('data-crm-copy')) copyTemplate();
  else if (t.hasAttribute('data-crm-map') && hooks.onShowOnMap) { const k = cardKey; flushNote(); hooks.onShowOnMap(k); }
}
function onCardInput(e) {
  if (!e.target.matches('[data-crm-note]')) return;
  const n = root.querySelector('[data-crm-count]');
  if (n) n.textContent = `${e.target.value.length}/${NOTE_MAX}`;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(flushNote, 500);
}
function onCardChange(e) {
  if (!e.target.matches('[data-crm-date]')) return;
  const r = rowByKey(cardKey);
  if (!r) return;
  save(setDate(dbNow(), r.key, e.target.value, Date.now(), metaOf(r)));
  markSaved(recordOf(dbNow(), r.key));
}

/* ---------- Копирование шаблона ----------
   navigator.clipboard (нужен https и фокус), запасной путь — textarea + execCommand внутри диалога */
async function copyText(text) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* пробуем запасной способ */ }
  try {
    const host = root.closest('dialog') || document.body;
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
    host.appendChild(ta);
    ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

async function copyTemplate() {
  const r = rowByKey(cardKey);
  const text = r && fillTemplate(tplNow(), r);
  if (!text) { toastIn('Шаблон не загрузился'); return; }
  const ok = await copyText(text);
  if (ok) toastIn('Скопировано — вставьте в мессенджер или почту');
  else {
    // копирование запрещено браузером — раскрываем текст, чтобы выделить вручную
    const d = root.querySelector('.crm-tpl');
    if (d) d.open = true;
    toastIn('Не получилось скопировать — выделите текст шаблона вручную');
  }
}

/* ---------- Экспорт / импорт ---------- */
function doExport() {
  try {
    const data = exportPayload(dbNow());
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = exportFileName(todayISO());
    a.hidden = true;
    (root.closest('dialog') || document.body).appendChild(a);
    a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    say(data.count ? `Файл ${a.download} сохранён: ${fmt(data.count)} ${pluralRu(data.count, 'запись', 'записи', 'записей')}. Откройте его на другом устройстве кнопкой «Импорт базы».` : `Файл ${a.download} сохранён. База пока пустая — отметьте статус хотя бы у одной площадки.`);
  } catch (e) {
    say('Не удалось сохранить файл: браузер запретил скачивание. Попробуйте другой браузер.', true);
  }
}

function doImport(f) {
  if (f.size > 5 * 1024 * 1024) { say('Файл слишком большой для базы площадок (больше 5 МБ) — это не тот файл.', true); return; }
  const read = typeof f.text === 'function' ? f.text() : new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsText(f); });
  hideToast();                                       // итог прошлого импорта не должен спорить с новым сообщением
  read.then(text => {
    const p = parseImport(text);
    if (!p.ok) { say(`Импорт не выполнен: ${p.error}`, true); return; }
    const r = mergeImport(dbNow(), p.items);
    if (r.added || r.updated) save(r.db);
    // записи, ключей которых нет ни у одного объекта мест (data/leads.json), — честно называем в итоге
    const known = new Set();
    allPlaces.forEach(pl => rowsOf(validObjects(pl)).forEach(x => known.add(x.key)));
    const orphans = known.size ? countOrphans(p.items, known) : 0;
    say(`Импорт из ${f.name}: ${importSummary(r, p.skipped, orphans)}`);
    toastIn(`Добавлено ${r.added}, обновлено ${r.updated}`);
    renderList();
    if (cardKey) renderCard();
  }).catch(() => say('Файл не прочитался. Выберите его ещё раз.', true));
}

/* Сообщение под кнопками экспорта/импорта (остаётся на экране, читается экранным диктором) */
function say(text, bad) {
  if (!root) return;
  const m = root.querySelector('.crm-msg');
  m.hidden = false;
  m.textContent = text;
  m.classList.toggle('is-bad', !!bad);
  if (bad) hideToast();                              // ошибка не должна соседствовать с «успешным» тостом
}

/* Спрятать тост сразу (без ожидания таймера) */
function hideToast() {
  const t = root && root.querySelector('.crm-toast');
  if (!t) return;
  clearTimeout(t._t);
  t.classList.remove('show');
}

/* Короткий тост внутри диалога (общий тост страницы под модальным диалогом не виден) */
function toastIn(text) {
  const t = root && root.querySelector('.crm-toast');
  if (!t) return;
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2400);
}
