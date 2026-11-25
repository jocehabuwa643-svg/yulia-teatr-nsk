/* crm.js — мини-CRM площадок (сады, школы, ДК): чистая логика без DOM.
   Статус работы с каждым объектом карты клиентов, короткая заметка и дата контакта; счётчики прогресса;
   шаблон первого сообщения; экспорт и импорт базы (JSON) со слиянием по ключу.
   Хранение — в браузере через store (ключ yulia.v2.crm) — делает js/crm-ui.js; здесь только функции над данными,
   поэтому модуль импортируется и браузером, и тестами node --test (tests/crm.test.mjs). */

/* ---------- Статусы ----------
   Порядок — путь работы с площадкой. id короткие: они лежат в localStorage и в файлах экспорта —
   менять их нельзя (старые файлы перестанут читаться). */
export const STATUSES = [
  { id: 'none', label: 'Не писала', short: 'Не писала' },
  { id: 'sent', label: 'Написала', short: 'Написала' },
  { id: 'talks', label: 'Переговоры', short: 'Переговоры' },
  { id: 'deal', label: 'Договорились', short: 'Договорились' },
  { id: 'refused', label: 'Отказ', short: 'Отказ' }
];
export const STATUS_IDS = STATUSES.map(s => s.id);
export const statusLabel = id => (STATUSES.find(s => s.id === id) || STATUSES[0]).label;

export const SCHEMA = 1;                 // версия схемы файла экспорта и записи в браузере
export const STORE_KEY = 'crm';          // store добавляет префикс yulia.v2.
export const NOTE_MAX = 500;             // предел заметки, символов
export const APP_ID = 'yulia-teatr-nsk'; // тот же идентификатор приложения, что в резервной копии js/storage-idb.js
export const FILE_KIND = 'crm';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- Ключ объекта ----------
   Ключ должен переживать обновление data/leads.json. Если у объекта появится OSM-идентификатор (id / osm,
   например «n123» или «way/456») — ключ по нему. Сейчас в leads.json идентификаторов нет, поэтому ключ —
   тип + нормализованное название + координаты, округлённые до 4 знаков (~10 м: мелкие правки точки в OSM
   не теряют запись). Проверено: в текущем leads.json все 800 ключей уникальны (tests/crm.test.mjs). */
export function normName(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[«»"'„“”`]/g, '')
    .replace(/[^0-9a-zа-я№]+/g, ' ')
    .trim();
}

export function objectKey(o) {
  if (!o) return '';
  const osm = o.osm != null ? o.osm : o.id;
  if (osm != null && String(osm).trim()) return 'osm:' + String(osm).trim();
  const k = o.k === 'd' || o.k === 'c' ? o.k : 's';
  const ll = Array.isArray(o.ll) ? o.ll : [];
  const c = Number.isFinite(ll[0]) && Number.isFinite(ll[1]) ? `${ll[0].toFixed(4)},${ll[1].toFixed(4)}` : '?';
  return `${k}:${normName(o.n)}@${c}`;
}

/* ---------- База ----------
   { v: 1, items: { [ключ]: { s, note, date, upd, name, k, place } } }
   s — статус, note — заметка, date — дата контакта «ГГГГ-ММ-ДД» или '', upd — время правки (epoch ms),
   name/k/place — подпись объекта, чтобы файл экспорта читался человеком и без leads.json. */
export function emptyDb() { return { v: SCHEMA, items: {} }; }

/* Одна запись из ненадёжного источника (localStorage, файл): исправимое — исправляем, мусор — null */
export function sanitizeRecord(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const s = STATUS_IDS.includes(r.s) ? r.s : null;
  if (!s) return null;
  const upd = Number(r.upd);
  if (!Number.isFinite(upd) || upd <= 0) return null;
  return {
    s,
    note: typeof r.note === 'string' ? r.note.slice(0, NOTE_MAX) : '',
    date: typeof r.date === 'string' && DATE_RE.test(r.date) && validDate(r.date) ? r.date : '',
    upd: Math.round(upd),
    name: typeof r.name === 'string' ? r.name.slice(0, 200) : '',
    k: r.k === 'd' || r.k === 'c' || r.k === 's' ? r.k : '',
    place: typeof r.place === 'string' ? r.place.slice(0, 60) : ''
  };
}

function validDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/* База из localStorage: повреждённая или чужая — пустая; битые записи отбрасываются по одной */
export function normalizeDb(raw) {
  const db = emptyDb();
  if (!raw || typeof raw !== 'object' || !raw.items || typeof raw.items !== 'object') return db;
  for (const [key, r] of Object.entries(raw.items)) {
    if (typeof key !== 'string' || !key || key.length > 300) continue;
    const rec = sanitizeRecord(r);
    if (rec) db.items[key] = rec;
  }
  return db;
}

/* Запись объекта (или пустая «Не писала») */
export function recordOf(db, key) {
  const r = db && db.items && db.items[key];
  return r || { s: 'none', note: '', date: '', upd: 0, name: '', k: '', place: '' };
}
export const statusOf = (db, key) => recordOf(db, key).s;

/* Изменение записи — новая база (исходная не меняется). meta — подпись объекта { name, k, place }.
   Запись со статусом «Не писала» не удаляется: её время правки нужно, чтобы импорт старого файла
   не вернул прежний статус. */
export function patchRecord(db, key, patch, now, meta = {}) {
  const prev = recordOf(db, key);
  const next = { ...prev, ...patch };
  if (meta.name != null) next.name = String(meta.name).slice(0, 200);
  if (meta.k) next.k = meta.k;
  if (meta.place) next.place = String(meta.place).slice(0, 60);
  next.upd = Math.max(Math.round(Number(now) || Date.now()), (prev.upd || 0) + 1);
  const rec = sanitizeRecord(next);
  if (!rec) return db;
  return { v: SCHEMA, items: { ...((db && db.items) || {}), [key]: rec } };
}

/* Смена статуса: дата контакта по умолчанию — сегодня (при смене на любой статус, кроме «Не писала») */
export function setStatus(db, key, s, today, now, meta) {
  if (!STATUS_IDS.includes(s)) return db;
  const prev = recordOf(db, key);
  if (prev.s === s && prev.upd) return db;
  const patch = { s };
  if (s !== 'none' && DATE_RE.test(today || '')) patch.date = today;
  return patchRecord(db, key, patch, now, meta);
}
export function setNote(db, key, note, now, meta) {
  return patchRecord(db, key, { note: String(note == null ? '' : note).slice(0, NOTE_MAX) }, now, meta);
}
export function setDate(db, key, date, now, meta) {
  const d = typeof date === 'string' && DATE_RE.test(date) && validDate(date) ? date : '';
  return patchRecord(db, key, { date: d }, now, meta);
}

/* Сегодняшняя дата устройства «ГГГГ-ММ-ДД» (Юля работает по местному времени — Новосибирск) */
export function todayISO(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---------- Счётчики прогресса ----------
   keys — ключи объектов текущего места; записи других мест в счёт не идут.
   contacted — все, кому уже писала (любой статус, кроме «Не писала»). */
export function countStatuses(db, keys) {
  const c = { none: 0, sent: 0, talks: 0, deal: 0, refused: 0, total: 0, contacted: 0 };
  for (const key of keys || []) {
    const s = statusOf(db, key);
    c[s] += 1;
    c.total += 1;
    if (s !== 'none') c.contacted += 1;
  }
  return c;
}

/* Строка прогресса: «Написала 12 · Переговоры 3 · Договорились 1 · Отказ 2 из 752» */
export function progressLine(c) {
  if (!c || !c.total) return 'Нет объектов';
  const parts = ['sent', 'talks', 'deal', 'refused'].filter(id => c[id] > 0).map(id => `${statusLabel(id)} ${c[id]}`);
  if (!parts.length) return `Пока никому не писала · ${c.total} ${pluralObj(c.total)} в списке`;
  return `${parts.join(' · ')} из ${c.total}`;
}
function pluralObj(n) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return 'объектов';
  if (b === 1) return 'объект';
  if (b >= 2 && b <= 4) return 'объекта';
  return 'объектов';
}

/* Доли полосы прогресса (0…1) по статусам — сумма не больше 1 */
export function progressShares(c) {
  const t = c && c.total ? c.total : 0;
  const out = {};
  for (const id of ['deal', 'talks', 'sent', 'refused']) out[id] = t ? c[id] / t : 0;
  return out;
}

/* ---------- Список: фильтры и поиск ----------
   rows — [{ key, n, k, ... }]; filter = { q, kind: 'all'|'s'|'d'|'c', status: 'all'|id }.
   Сортировка: сначала с активной работой (переговоры, написала, договорились), затем по названию;
   безымянные — в конце (в OSM у части объектов нет названия). */
const STATUS_ORDER = { talks: 0, sent: 1, deal: 2, none: 3, refused: 4 };
export function filterRows(rows, db, filter = {}) {
  const q = normName(filter.q || '');
  const kind = ['s', 'd', 'c'].includes(filter.kind) ? filter.kind : 'all';
  const st = STATUS_IDS.includes(filter.status) ? filter.status : 'all';
  const out = [];
  for (const r of rows || []) {
    if (kind !== 'all' && r.k !== kind) continue;
    const s = statusOf(db, r.key);
    if (st !== 'all' && s !== st) continue;
    if (q) {
      const rec = recordOf(db, r.key);
      const hay = normName(r.n) + ' ' + normName(rec.note);
      if (!hay.includes(q)) continue;
    }
    out.push({ ...r, s });
  }
  return out.sort((a, b) => (STATUS_ORDER[a.s] - STATUS_ORDER[b.s])
    || ((a.n ? 0 : 1) - (b.n ? 0 : 1))
    || a.n.localeCompare(b.n, 'ru', { numeric: true }));
}

/* Строки списка из объектов места: ключ и подпись для каждого объекта карты */
export function rowsOf(objs) {
  return (objs || []).map(o => ({ key: objectKey(o), n: typeof o.n === 'string' ? o.n.trim() : '', k: o.k, ll: o.ll }));
}

/* ---------- Шаблон первого сообщения ----------
   tpl — блок crm_templates из data/config.json (после сборки cfg — объект со значением):
   { sender, format, kindergarten:{ header_named, header_unnamed, body }, school:{…}, culture:{…} }.
   Подстановки: {name} — название объекта, {sender} — имя, {format} — формат. Нет шаблона — null. */
export const TPL_BY_KIND = { d: 'kindergarten', s: 'school', c: 'culture' };
/* Прямые кавычки из названий OSM ("Солнышко") → русские «ёлочки»; внутренние кавычки второго уровня — „лапки“ */
export function ruQuotes(str) {
  let depth = 0;
  return String(str).replace(/"/g, (_, i, all) => {
    const prev = i > 0 ? all[i - 1] : ' ';
    const opening = /[\s(«„\-—]/.test(prev) || i === 0;
    if (opening) { depth++; return depth > 1 ? '„' : '«'; }
    const ch = depth > 1 ? '“' : '»';
    depth = Math.max(0, depth - 1);
    return ch;
  });
}

export function fillTemplate(tpl, obj) {
  if (!tpl || typeof tpl !== 'object' || !obj) return null;
  const t = tpl[TPL_BY_KIND[obj.k] || 'school'];
  if (!t || typeof t.body !== 'string') return null;
  const name = typeof obj.n === 'string' ? ruQuotes(obj.n.trim()) : '';
  const vars = { name, sender: tpl.sender || '', format: tpl.format || '' };
  const put = s => String(s || '').replace(/\{(name|sender|format)\}/g, (_, k) => vars[k]);
  const header = name ? put(t.header_named) : put(t.header_unnamed);
  return [header, put(t.body)].filter(x => x && x.trim()).join('\n\n').replace(/[ \t]{2,}/g, ' ').trim();
}

/* ---------- Экспорт ---------- */
export function exportPayload(db, now = Date.now()) {
  const items = Object.entries((db && db.items) || {}).map(([key, r]) => ({ key, ...r }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return { app: APP_ID, kind: FILE_KIND, schema: SCHEMA, exported_at: new Date(now).toISOString(), count: items.length, items };
}
export function exportFileName(today) {
  return `yulia-crm-${DATE_RE.test(today || '') ? today : todayISO()}.json`;
}

/* ---------- Импорт ----------
   Возвращает { ok:true, items:[{key, rec}], skipped } или { ok:false, error } — текст ошибки для Юли.
   now — время устройства: правка «из будущего» (сбитые часы на другом устройстве, ручная правка файла)
   урезается до now, иначе такая запись навсегда побеждала бы при слиянии. Запас — сутки на разницу часов. */
const FUTURE_SLACK = 24 * 3600 * 1000;
export function parseImport(text, now = Date.now()) {
  let j;
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'Файл пустой.' };
  try { j = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { return { ok: false, error: 'Файл не читается: это не JSON или он повреждён.' }; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, error: 'В файле нет базы площадок.' };
  if (j.app !== APP_ID || j.kind !== FILE_KIND) {
    if (j.__app === APP_ID) return { ok: false, error: 'Это общая резервная копия помощника, а не база площадок. Её загружают в разделе заметок.' };
    return { ok: false, error: 'Это не файл базы площадок (ожидается yulia-crm-…json, выгруженный кнопкой «Экспорт базы»).' };
  }
  if (!Number.isInteger(j.schema) || j.schema < 1) return { ok: false, error: 'В файле не указана версия схемы.' };
  if (j.schema > SCHEMA) return { ok: false, error: 'Файл из более новой версии помощника. Обновите страницу (потяните вниз) и попробуйте снова.' };
  if (!Array.isArray(j.items)) return { ok: false, error: 'В файле нет списка записей.' };
  const items = [];
  let skipped = 0;
  for (const it of j.items) {
    const key = it && typeof it.key === 'string' && it.key.length <= 300 ? it.key : '';
    const rec = key ? sanitizeRecord(it) : null;
    if (rec && Number.isFinite(now) && rec.upd > now + FUTURE_SLACK) rec.upd = Math.round(now);
    if (rec) items.push({ key, rec }); else skipped += 1;
  }
  if (!items.length && j.items.length) return { ok: false, error: 'Ни одна запись в файле не прошла проверку — файл повреждён.' };
  return { ok: true, items, skipped };
}

/* Слияние: новые ключи добавляются; у существующих побеждает более поздняя правка (upd);
   при равенстве остаётся своя запись. Возвращает { db, added, updated, same } */
export function mergeImport(db, items) {
  const cur = { ...((db && db.items) || {}) };
  let added = 0, updated = 0, same = 0;
  for (const { key, rec } of items || []) {
    const have = cur[key];
    if (!have) { cur[key] = rec; added += 1; }
    else if (rec.upd > have.upd) { cur[key] = rec; updated += 1; }
    else same += 1;
  }
  return { db: { v: SCHEMA, items: cur }, added, updated, same };
}

/* Записи импорта, чьих ключей нет среди объектов data/leads.json (другая версия базы, удалённый объект).
   Они сохраняются (перенос между устройствами не теряет данных), но в списке и счётчиках не видны. */
export function countOrphans(items, knownKeys) {
  const known = knownKeys instanceof Set ? knownKeys : new Set(knownKeys || []);
  return (items || []).filter(it => it && !known.has(it.key)).length;
}

/* Итог импорта человеческим языком; orphans — сколько записей не нашлось среди площадок на карте */
export function importSummary(r, skipped = 0, orphans = 0) {
  const bits = [`Добавлено ${r.added}`, `обновлено ${r.updated}`];
  if (r.same) bits.push(`без изменений ${r.same}`);
  if (skipped) bits.push(`пропущено битых ${skipped}`);
  const text = bits.join(', ') + '.';
  if (!orphans) return text;
  return `${text} Не найдено в базе площадок: ${orphans} (сохранены, но не видны в списке — возможно, файл с другой версией базы).`;
}
