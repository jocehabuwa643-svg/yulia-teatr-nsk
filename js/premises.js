/* premises.js — слой «Помещения»: ручной список Юлии (адрес, м², цена, контакт, статус,
   ссылка, дата) + готовые ссылки на сохранённые поиски Авито/ЦИАН/Яндекс Недвижимости для
   района Богдана Хмельницкого и пригородов. Скрейпинг досок объявлений не используется
   (запрещён условиями сервисов) — только ручной ввод. Бейдж «новое» для объектов,
   добавленных после последнего визита. Данные — в IndexedDB (storage-idb). */
import { store2 } from './storage-idb.js';
import { toast } from './ui/helpers.js';

const KEY = 'premises';
const STATUSES = [
  ['new', 'Новое'],
  ['seen', 'Осмотрела'],
  ['refused', 'Отказ']
];
const SEARCHES = [
  /* Аренда коммерческих помещений (раньше ссылки вели на ПРОДАЖУ квартир и помещений — не тот поиск).
     Категория «Коммерческая недвижимость → Сдам» проверена 21.11.2026 (ответ 200, объявления аренды). */
  { name: 'Авито · аренда у Богдана Хмельницкого', url: 'https://www.avito.ru/novosibirsk/kommercheskaya_nedvizhimost/sdam-ASgBAgICAUSwCNRW?q=%D0%91%D0%BE%D0%B3%D0%B4%D0%B0%D0%BD%D0%B0+%D0%A5%D0%BC%D0%B5%D0%BB%D1%8C%D0%BD%D0%B8%D1%86%D0%BA%D0%BE%D0%B3%D0%BE' },
  { name: 'Авито · аренда помещений НСК', url: 'https://www.avito.ru/novosibirsk/kommercheskaya_nedvizhimost/sdam-ASgBAgICAUSwCNRW' },
  { name: 'ЦИАН · Калининский район', url: 'https://www.cian.ru/cat.php?deal_type=lease&engine_version=2&offer_type=offices&region=4908&room1=1' },
  { name: 'Яндекс Недвижимость · аренда НСК', url: 'https://realty.ya.ru/arenda/kommercheskaya/' }
];

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtDate = iso => { try { return new Date(iso).toLocaleDateString('ru-RU'); } catch (e) { return '—'; } };

function statusMeta(s) { return STATUSES.find(x => x[0] === s) || STATUSES[0]; }

let items = [];
let ui = {};

function cardHTML() {
  const list = items.length ? items.map(p => {
    const sm = statusMeta(p.status);
    const isNew = p.status === 'new';
    return `<div class="pr-row ${p.status}" data-id="${p.id}">
      <div class="pr-main">
        <strong>${esc(p.address || 'Без адреса')}${p.area ? ` · ${esc(p.area)} м²` : ''}${p.price ? ` · ${esc(p.price)} ₽/мес` : ''}${isNew ? ' <span class="pr-badge">новое</span>' : ''}</strong>
        <small>${p.contact ? esc(p.contact) + ' · ' : ''}добавлено ${fmtDate(p.date)}${p.url ? ` · <a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">объявление ↗</a>` : ''}</small>
      </div>
      <div class="pr-tools">
        <select aria-label="Статус помещения">${STATUSES.map(s => `<option value="${s[0]}" ${s[0] === p.status ? 'selected' : ''}>${s[1]}</option>`).join('')}</select>
        <button type="button" class="note-del" aria-label="Удалить помещение">✕</button>
      </div>
      <span class="pr-status">${sm[1]}</span>
    </div>`;
  }).join('') : '<p class="tiny">Пока пусто. Добавьте вариант вручную — или откройте сохранённые поиски ниже и выпишите интересные.</p>';
  const searches = `<div class="pr-searches">${SEARCHES.map(s => `<a class="chip" href="${s.url}" target="_blank" rel="noopener noreferrer">${esc(s.name)} ↗</a>`).join('')}</div>
    <p class="hint" style="margin-top:8px">Доски объявлений не сканируются автоматически (запрещено условиями сервисов) — только сохранённые поиски и ручной ввод.</p>`;
  return `
    <div class="rowline"><h3>Помещения · ручной список</h3><button type="button" class="btn small secondary" data-act="add">＋ Добавить</button></div>
    <div class="pr-list">${list}</div>
    ${items.length ? '' : searches}`;
}

function bind() {
  ui.body.querySelector('[data-act=add]').addEventListener('click', addPremise);
  ui.body.querySelectorAll('.pr-row').forEach(row => {
    const id = +row.dataset.id;
    row.querySelector('select').addEventListener('change', e => setStatus(id, e.target.value));
    row.querySelector('.note-del').addEventListener('click', () => removePremise(id));
  });
}

async function persist() { await store2.set(KEY, items); }

/* Добавление: инлайн-форма вместо prompt(). Причины: браузер может блокировать нативные
   диалоги (после случайного «запретить диалоги» prompt молча возвращает null и кнопка
   «не работает»), в headless/встроенных просмотрах prompt вообще недоступен. Форма —
   надёжный путь без блокировки потока. */
let adding = false;
function addPremise() {
  if (adding) { ui.body.querySelector('.pr-form')?.remove(); adding = false; return; }
  adding = true;
  const form = document.createElement('form');
  form.className = 'pr-form';
  form.novalidate = true;
  form.innerHTML = `
    <div class="pr-form-grid">
      <label class="mf"><span>Адрес *</span><input name="address" type="text" maxlength="200" required placeholder="Богдана Хмельницкого, 25"></label>
      <label class="mf"><span>Площадь, м²</span><input name="area" type="number" inputmode="numeric" min="0" step="1" placeholder="130"></label>
      <label class="mf"><span>Цена, ₽/мес</span><input name="price" type="number" inputmode="numeric" min="0" step="500" placeholder="130000"></label>
      <label class="mf"><span>Контакт</span><input name="contact" type="text" maxlength="120" placeholder="Анна, +7-913-…"></label>
      <label class="mf"><span>Ссылка на объявление</span><input name="url" type="url" inputmode="url" placeholder="https://…"></label>
      <p class="ferr" role="alert" hidden></p>
      <div class="toolrow"><button type="submit" class="btn small primary">Сохранить</button><button type="button" class="btn small secondary" data-pr-cancel>Отмена</button></div>
    </div>`;
  ui.body.insertBefore(form, ui.body.querySelector('.pr-list'));
  form.querySelector('[data-pr-cancel]').addEventListener('click', () => { adding = false; form.remove(); });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const f = form.elements;
    const err = form.querySelector('.ferr');
    const fail = m => { err.textContent = m; err.hidden = false; };
    const address = f.address.value.trim();
    if (!address) return fail('Укажите адрес — хотя бы улицу и дом.');
    const url = f.url.value.trim();
    if (url && !/^https?:\/\//.test(url)) return fail('Ссылка должна начинаться с http:// или https://');
    items.push({
      id: items.reduce((m, p) => Math.max(m, p.id || 0), 0) + 1,
      address: address.slice(0, 200),
      area: Math.max(0, Math.round(+f.area.value || 0)),
      price: Math.max(0, Math.round(+f.price.value || 0)),
      contact: f.contact.value.trim().slice(0, 120),
      url,
      status: 'new',
      date: new Date().toISOString()
    });
    adding = false;
    persist().then(() => { render(); toast('Помещение добавлено'); });
  });
}
async function setStatus(id, status) {
  const p = items.find(x => x.id === id); if (!p) return;
  p.status = status;
  await persist(); render();
}
async function removePremise(id) {
  items = items.filter(x => x.id !== id);
  await persist(); render();
}
function render() { ui.body.innerHTML = cardHTML(); bind(); }

export async function initPremises(mountEl) {
  const geo = mountEl || document.getElementById('geo');
  if (!geo || document.getElementById('premisesCard')) return [];
  items = (await store2.get(KEY, [])) || [];
  if (!Array.isArray(items)) items = [];

  const card = document.createElement('article');
  card.className = 'card rv in';
  card.id = 'premisesCard';
  card.style.cssText = 'padding:clamp(18px,2vw,28px);margin-top:14px';
  geo.appendChild(card);
  ui.body = card;
  render();
  return items;
}
