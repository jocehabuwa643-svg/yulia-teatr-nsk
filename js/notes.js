/* notes.js — «Заметки Юлии»: создание/правка/удаление/закрепление/поиск, привязка к разделу,
   автосейв 400 мс в IndexedDB (fallback localStorage), экспорт/импорт, напоминание о бэкапе.
   Карточку в секции #launch строит initNotes() — её вызывает js/app.js при сборке раздела плана запуска. */
import { store2, autosave, requestPersistence, exportAll, importAll, downloadJSON } from './storage-idb.js';

const KEY = 'notes';
const BACKUP_EVERY_DAYS = 14;
let notes = [];
let ui = {};

/* ---------- чистая логика (тестируется без DOM) ---------- */
export function normalizeNote(n, i) {
  const id = (n && n.id != null) ? n.id : (i + 1);
  return {
    id,
    text: typeof (n && n.text) === 'string' ? n.text.slice(0, 5000) : '',
    pinned: !!(n && n.pinned),
    section: (n && typeof n.section === 'string') ? n.section.slice(0, 40) : '',
    updated: (n && n.updated) || (Date.now ? 0 : 0),
    created: (n && n.created) || 0
  };
}
export function sortNotes(list) {
  return [...list].sort((a, b) => (b.pinned - a.pinned) || ((b.updated || 0) - (a.updated || 0)));
}
export function searchNotes(list, q) {
  const s = (q || '').trim().toLowerCase();
  if (!s) return list;
  return list.filter(n => (n.text || '').toLowerCase().includes(s));
}
export function nextId(list) { return list.reduce((m, n) => Math.max(m, n.id || 0), 0) + 1; }
export function backupDue(lastBackupAt, now = Date.now()) {
  if (!lastBackupAt) return true;
  return (now - lastBackupAt) / 864e5 >= BACKUP_EVERY_DAYS;
}

/* ---------- DOM ---------- */
function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

function renderList() {
  const wrap = ui.list; if (!wrap) return;
  const q = ui.search ? ui.search.value : '';
  const shown = searchNotes(sortNotes(notes), q);
  wrap.innerHTML = '';
  if (!shown.length) {
    wrap.appendChild(el('p', 'tiny', q ? 'Ничего не найдено.' : 'Заметок пока нет — запишите первую: кому позвонить, что проверить перед показом.'));
    return;
  }
  for (const n of shown) {
    const row = el('div', 'note' + (n.pinned ? ' pinned' : ''));
    row.dataset.id = n.id;
    row.innerHTML = `
      <textarea rows="3" maxlength="5000" aria-label="Текст заметки">${escapeHtml(n.text)}</textarea>
      <div class="note-tools">
        <button class="ghostbtn note-pin" title="${n.pinned ? 'Открепить' : 'Закрепить'}" aria-label="${n.pinned ? 'Открепить заметку' : 'Закрепить заметку'}">${n.pinned ? '★' : '☆'}</button>
        <button class="ghostbtn note-del" title="Удалить" aria-label="Удалить заметку">✕</button>
      </div>`;
    const ta = row.querySelector('textarea');
    ta.addEventListener('input', () => updateNote(n.id, ta.value));
    row.querySelector('.note-pin').addEventListener('click', () => togglePin(n.id));
    row.querySelector('.note-del').addEventListener('click', () => removeNote(n.id));
    wrap.appendChild(row);
  }
}
function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

async function persist() {
  await store2.set(KEY, notes);
  markSaved();
}
const save = autosave(persist, 400);

function markSaved() {
  if (!ui.status) return;
  ui.status.textContent = 'Сохранено ✓';
  ui.status.classList.add('saved');
  clearTimeout(ui.status._t);
  ui.status._t = setTimeout(() => ui.status && ui.status.classList.remove('saved'), 1200);
}
function updateNote(id, text) {
  const n = notes.find(x => x.id === id); if (!n) return;
  n.text = text; n.updated = Date.now();
  save(notes);
}
function togglePin(id) {
  const n = notes.find(x => x.id === id); if (!n) return;
  n.pinned = !n.pinned; n.updated = Date.now();
  save(notes); renderList();
}
function removeNote(id) {
  notes = notes.filter(x => x.id !== id);
  save(notes); renderList();
}
function addNote() {
  notes.push({ id: nextId(notes), text: '', pinned: false, section: currentSection(), created: Date.now(), updated: Date.now() });
  save(notes); renderList();
  const rows = ui.list.querySelectorAll('.note textarea');
  if (rows.length) rows[rows.length - 1].focus();
}
function currentSection() {
  const s = [...document.querySelectorAll('main section')].find(sec => { const r = sec.getBoundingClientRect(); return r.top <= 120 && r.bottom > 120; });
  return s ? s.id : '';
}

async function doExport() {
  const data = await exportAll({ __notes: notes });
  downloadJSON(data, `yulia-backup-${new Date().toISOString().slice(0, 10)}.json`);
  await store2.set('lastBackupAt', Date.now());
  if (ui.backup) ui.backup.hidden = true;
  markSaved();
}
function doImport(file) {
  const r = new FileReader();
  r.onload = async () => {
    try {
      const keys = await importAll(JSON.parse(r.result));
      notes = normalize(await store2.get(KEY, []));
      renderList();
      if (ui.status) ui.status.textContent = `Импортировано ключей: ${keys.length}`;
    } catch (e) {
      if (ui.status) ui.status.textContent = 'Импорт не удался: ' + (e.message || 'файл не распознан');
    }
  };
  r.readAsText(file);
}
function normalize(raw) { return (Array.isArray(raw) ? raw : []).map(normalizeNote); }

/* ---------- инициализация ---------- */
export async function initNotes() {
  const launch = document.getElementById('launch');
  if (!launch || document.querySelector('#notesCard')) return [];
  notes = normalize(await store2.get(KEY, []));
  requestPersistence();

  const card = el('article', 'card notes rv in');
  card.id = 'notesCard';
  card.style.cssText = 'padding:clamp(18px,2vw,28px);margin-top:14px';
  card.innerHTML = `
    <div class="rowline">
      <h3>Заметки</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small secondary" data-act="add">＋ Заметка</button>
        <button class="btn small secondary" data-act="export">Экспорт</button>
        <label class="btn small secondary" style="position:relative;overflow:hidden">Импорт<input type="file" accept="application/json,.json" hidden data-act="import"></label>
      </div>
    </div>
    <p class="tiny" style="margin:6px 0 10px">Хранятся в этом браузере на этом устройстве (IndexedDB). Делайте резервную копию раз в 2 недели.</p>
    <input type="search" class="search" placeholder="Поиск по заметкам…" aria-label="Поиск по заметкам" style="max-width:100%;margin-bottom:10px">
    <div class="notes-list"></div>
    <p class="tiny saved-ind" aria-live="polite"></p>
    <div class="advice warn" data-backup hidden style="margin-top:10px">
      <strong>Резервная копия</strong>Прошло больше двух недель с последнего экспорта. Нажмите «Экспорт» и сохраните JSON-файл.
    </div>`;
  // вставляем после заметок Юлии (или в конец секции)
  const anchor = launch.querySelector('.notes') || launch.querySelector('.checklist-grid') || launch;
  anchor.insertAdjacentElement('afterend', card);

  ui = { list: card.querySelector('.notes-list'), status: card.querySelector('.saved-ind'), search: card.querySelector('input[type=search]'), backup: card.querySelector('[data-backup]') };
  card.querySelector('[data-act=add]').addEventListener('click', addNote);
  card.querySelector('[data-act=export]').addEventListener('click', doExport);
  card.querySelector('[data-act=import]').addEventListener('change', e => e.target.files[0] && doImport(e.target.files[0]));
  ui.search.addEventListener('input', renderList);
  renderList();

  const lastBackup = await store2.get('lastBackupAt', null);
  if (backupDue(lastBackup)) ui.backup.hidden = false;
  return notes;
}
