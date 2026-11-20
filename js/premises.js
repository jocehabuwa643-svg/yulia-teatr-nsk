/* premises.js — слой «Помещения»: ручной список Юлии (адрес, м², цена, контакт, статус,
   ссылка, дата) + готовые ссылки на сохранённые поиски Авито/ЦИАН/Яндекс Недвижимости для
   района Богдана Хмельницкого и пригородов. Скрейпинг досок объявлений не используется
   (запрещён условиями сервисов) — только ручной ввод. Бейдж «новое» для объектов,
   добавленных после последнего визита. Данные — в IndexedDB (storage-idb). */
import { store2 } from './storage-idb.js';

const KEY = 'premises';
const STATUSES = [
  ['new', 'Новое'],
  ['seen', 'Осмотрела'],
  ['refused', 'Отказ']
];
const SEARCHES = [
  { name: 'Авито · Богдана Хмельницкого', url: 'https://www.avito.ru/novosibirsk/kvartiry/prodam-ASgBAgICAUSSA8YQ?pmax=90&q=%D0%91%D0%BE%D0%B3%D0%B4%D0%B0%D0%BD%D0%B0+%D0%A5%D0%BC%D0%B5%D0%BB%D1%8C%D0%BD%D0%B8%D1%86%D0%BA%D0%BE%D0%B3%D0%BE' },
  { name: 'Авито · нежилые помещения НСК', url: 'https://www.avito.ru/novosibirsk/kommercheskaya_nedvizhimost/prodam-ASgBAgICAkDgB~JU?pmax=130&s=104&pmin=40' },
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
async function addPremise() {
  const address = prompt('Адрес (например: Богдана Хмельницкого, 25):');
  if (address == null) return;
  const area = prompt('Площадь, м²:', '130');
  if (area == null) return;
  const price = prompt('Цена, ₽/мес:', '');
  if (price == null) return;
  const contact = prompt('Контакт (имя, телефон):', '');
  if (contact === null) return;
  const url = prompt('Ссылка на объявление (необязательно):', '');
  if (url === null) return;
  items.push({
    id: items.reduce((m, p) => Math.max(m, p.id || 0), 0) + 1,
    address: String(address).slice(0, 200),
    area: Math.max(0, +area || 0),
    price: Math.max(0, +price || 0),
    contact: String(contact).slice(0, 120),
    url: /^https?:\/\//.test(url) ? url : '',
    status: 'new',
    date: new Date().toISOString()
  });
  await persist(); render();
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

export async function initPremises() {
  const geo = document.getElementById('geo');
  if (!geo || document.getElementById('premisesCard')) return [];
  items = (await store2.get(KEY, [])) || [];
  if (!Array.isArray(items)) items = [];

  const card = document.createElement('article');
  card.className = 'card rv in';
  card.id = 'premisesCard';
  card.style.cssText = 'padding:clamp(18px,2vw,28px);margin-top:14px';
  geo.querySelector('.mapgrid').insertAdjacentElement('afterend', card);
  ui.body = card;
  render();
  return items;
}
