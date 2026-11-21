/* clients-view.js — подраздел «Клиенты и площадки»: вход-карточка на главной, открытие —
   полноэкранный диалог с тремя вкладками:
     1) Карта клиентов — объекты OSM выбранного места (школы/сады/ДК) + счётчики из data/leads.json;
     2) Помещения — ручной список Юлии (premises.js монтируется сюда);
     3) Цены и аренда — проверенные ориентиры из data/*.json (аренда, 70/30, тарифы, билеты).
   Все числа — из данных или ручной ввод; «нет данных» показывается честно. Диалог: native <dialog>,
   «← Назад», Esc, клик вне; карта инициализируется лениво при первом открытии, invalidateSize при показе.
   Анимации — только transform/opacity; reduced-motion — без анимаций. */
import { $, fmt, ic, icons, toast } from './ui/helpers.js';
import { state } from './state.js';
import { initPremises } from './premises.js';
import { initClientMap } from './client-map.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ruDate = d => { try { return new Date(d).toLocaleDateString('ru-RU'); } catch (e) { return '—'; } };

const TABS = [
  ['map', 'map', 'Карта клиентов'],
  ['rooms', 'key-round', 'Помещения'],
  ['prices', 'tag', 'Цены и аренда']
];

let dlg = null, lastFocus = null, tab = 'map', premisesIn = false;

/* Данные для вход-карточки: сумма потенциала по всем местам из leads.json */
function leadTotals() {
  const places = (state.DATA && state.DATA.leads && state.DATA.leads.places) || [];
  const t = places.reduce((a, p) => ({ school: a.school + (p.school || 0), kindergarten: a.kindergarten + (p.kindergarten || 0), culture: a.culture + (p.culture || 0) }), { school: 0, kindergarten: 0, culture: 0 });
  return { places, ...t, updated: state.DATA && state.DATA.leads && state.DATA.leads.updated_at };
}

/* ---------- Вход-карточка на главной ---------- */
export function buildEntryCard() {
  const host = document.getElementById('clientsEntry');
  if (!host || host.children.length) return;
  const t = leadTotals();
  host.innerHTML = `
    <button type="button" class="card cl-entry rv" id="clientsOpen" aria-haspopup="dialog" aria-controls="clientsView">
      <span class="cl-ic">${ic('map-pin-check')}</span>
      <span class="cl-t"><small>Отдельный подраздел</small><h3>Клиенты и площадки</h3>
        <span class="tiny">Карта школ, садов и ДК · контакты · ориентиры аренды и цен</span></span>
      <span class="cl-stats">
        <span><b>${fmt(t.school + t.kindergarten)}</b><small>клиенты выезда</small></span>
        <span><b>${fmt(t.culture)}</b><small>ДК и клубы</small></span>
        <span><b>${t.places.length}</b><small>городов</small></span>
      </span>
      <span class="cl-go" aria-hidden="true">→</span>
    </button>`;
  host.querySelector('#clientsOpen').addEventListener('click', openClients);
}

/* ---------- Диалог ---------- */
function ensureDialog() {
  if (dlg && document.contains(dlg)) return;
  dlg = document.createElement('dialog');
  dlg.id = 'clientsView';
  dlg.className = 'cl-dialog';
  dlg.setAttribute('aria-label', 'Клиенты и площадки');
  dlg.innerHTML = `
    <div class="cl-head">
      <button type="button" class="btn small secondary" data-cl-back>← Назад</button>
      <div><h2>Клиенты и площадки</h2><p class="tiny" id="clMeta"></p></div>
      <button type="button" class="ghostbtn" data-cl-close aria-label="Закрыть раздел">✕</button>
    </div>
    <div class="cl-tabs" role="tablist" aria-label="Вкладки раздела">
      ${TABS.map(([id, icn, label]) => `<button type="button" class="tab${id === 'map' ? ' on' : ''}" role="tab" aria-pressed="${id === 'map'}" data-cl-tab="${id}">${ic(icn)}${label}</button>`).join('')}
    </div>
    <div class="cl-body">
      <div class="cl-pane" data-pane="map">
        <div class="cl-mapwrap"><div id="clMap" class="cl-map" role="region" aria-label="Карта клиентов"></div></div>
        <div class="cl-placebar"><label for="clPlace" class="tiny">Место</label><select id="clPlace"></select><span class="tiny" id="clPlaceStat"></span></div>
        <p class="hint" id="clNote"></p>
      </div>
      <div class="cl-pane" data-pane="rooms" hidden><div id="clRooms"></div></div>
      <div class="cl-pane" data-pane="prices" hidden><div id="clPrices"></div></div>
    </div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('[data-cl-back]').addEventListener('click', closeClients);
  dlg.querySelector('[data-cl-close]').addEventListener('click', closeClients);
  dlg.addEventListener('click', e => { if (e.target === dlg) closeClients(); });
  dlg.addEventListener('close', () => { if (lastFocus) lastFocus.focus(); });
  dlg.querySelectorAll('[data-cl-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.clTab)));
}

function showTab(id) {
  tab = id;
  dlg.querySelectorAll('[data-cl-tab]').forEach(b => { const on = b.dataset.clTab === id; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  dlg.querySelectorAll('.cl-pane').forEach(p => { p.hidden = p.dataset.pane !== id; });
  if (id === 'map') setTimeout(() => initClientMap(dlg.querySelector('#clMap')), 60);
  if (id === 'rooms' && !premisesIn) {
    premisesIn = true;
    initPremises(dlg.querySelector('#clRooms')).then(() => icons()).catch(() => {});
  }
}

/* ---------- Данные вкладок ---------- */
function fillMeta() {
  const t = leadTotals();
  const src = (state.DATA && state.DATA.leads && state.DATA.leads.sources) || {};
  const names = Object.keys(src).map(k => src[k].name || k).join(', ');
  const upd = t.updated ? ruDate(t.updated) : '—';
  const stale = state.DATA && state.DATA.leads && state.DATA.leads.stale;
  $('clMeta').textContent = `Источник: ${names || 'OpenStreetMap'} · обновлено ${upd}${stale ? ' · данные устарели' : ''} · возможны пропуски`;
}

function fillMapTab() {
  const places = leadTotals().places;
  const sel = dlg.querySelector('#clPlace');
  sel.innerHTML = places.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  sel.onchange = () => renderPlace(sel.value);
  renderPlace(places[0] && places[0].id);
  const n = (state.DATA && state.DATA.leads && state.DATA.leads.note) || 'Объекты по данным OpenStreetMap (ODbL): часть учреждений может быть не нанесена.';
  dlg.querySelector('#clNote').textContent = n;
}

let currentPlace = null;
function renderPlace(id) {
  const p = leadTotals().places.find(x => x.id === id);
  if (!p) return;
  currentPlace = p;
  dlg.querySelector('#clPlaceStat').textContent = `школы ${p.school || 0} · сады ${p.kindergarten || 0} · ДК ${p.culture || 0} → потенциал выезда ${p.potential || (p.school || 0) + (p.kindergarten || 0)}`;
  initClientMap(dlg.querySelector('#clMap'), p);
}

function fillPricesTab() {
  const cfg = state.CFG || {};
  const comp = (state.DATA && state.DATA.competitors) || {};
  const party = (comp.party_venues || []).find(v => v.id === 'playpanda' || /PlayPanda|Панда/i.test(v.name || ''));
  const rows = [
    ['Аренда базы (план)', `${fmt((cfg.base_costs || {}).rent_per_m2 || 0)} ₽/м²` , 'допущение проекта · ставка без КУ', 'model'],
    ['Коммунальные', `${fmt((cfg.base_costs || {}).utilities_per_m2 || 0)} ₽/м²`, 'допущение проекта', 'model'],
    ['Зал ДК (сценарий)', `${fmt(cfg.venue_share && cfg.venue_share.dk || 0)}% от кассы`, 'схема 70/30 — не публичный тариф', 'model'],
    ['Сад / школа', `${fmt(cfg.venue_share && cfg.venue_share.school_garden || 0)}% от кассы`, 'оргсбор за зал учреждения', 'model'],
    ['Билет выезда (план)', `${cfg.ticket ? cfg.ticket.min + '–' + cfg.ticket.max : '300–350'} ₽`, 'допущение проекта; медианы рынка нет', 'model'],
    ['Абонемент студии (план)', '4 200–4 400 ₽/мес.', 'допущение проекта', 'model'],
  ];
  if (party && Number.isFinite(party.hour_rate)) rows.push([`PlayPanda · час`, `${fmt(party.hour_rate)} ₽/час`, 'публичный прайс, конкурент', party.confidence || 'medium']);
  (comp.studio_prices_benchmarks || []).forEach(b => rows.push([b.name || 'Студия', b.price_note || '—', 'ориентир бизнес-плана, не оферта', 'low']));
  dlg.querySelector('#clPrices').innerHTML = `
    <div class="cl-pricecard">
      ${rows.map(([k, v, note, conf]) => `<div class="cd-row"><span class="cd-k">${esc(k)}</span><span class="cd-v"><b>${esc(v)}</b><small>${esc(note)} <span class="cd-badge${conf === 'no_data' ? ' none' : ''}">${conf === 'model' ? 'допущение проекта' : conf === 'manual' ? 'введено вами' : conf}</span></small></span></div>`).join('')}
    </div>
    <p class="hint">Всё, что помечено «допущение проекта», редактируется в калькуляторах. Реальные тарифы аренды — только по запросу КП у собственника.</p>`;
}

/* ---------- Открытие/закрытие ----------
   Интеграция с историей браузера: при открытии кладём pushState — тогда кнопка «назад»
   браузера закрывает ПОДРАЗДЕЛ, а не уводит с сайта (жалоба владельца: «сайт закрывается»).
   Один источник истины: settle() снимает пуш; все пути закрытия сходятся в close-событие диалога. */
let pushed = false;
function settle() { if (pushed) { pushed = false; try { history.back(); } catch (e) { /* file:// */ } } }
export function openClients(fromEl) {
  if (fromEl && typeof fromEl.focus === 'function') lastFocus = fromEl;
  ensureDialog();
  fillMeta(); fillMapTab(); fillPricesTab();
  if (typeof dlg.showModal === 'function') dlg.showModal();
  showTab('map');
  setTimeout(() => dlg.querySelector('#clMap') && initClientMap(dlg.querySelector('#clMap'), currentPlace), 80);
  if (!pushed) {
    try { history.pushState({ cl: 1 }, ''); pushed = true; } catch (e) { /* file:// или лимит истории */ }
  }
  icons();
}
export function closeClients() { if (dlg && dlg.open) dlg.close(); else settle(); }
/* «назад» браузера при открытом подразделе — закрыть его (close-событие → settle) */
/* «назад» браузера при открытом подразделе — закрыть его. ВАЖНО: сначала снимаем пуш,
   иначе close-событие вызовет settle() и будет ВТОРОЙ history.back() → выкидывает с сайта. */
addEventListener('popstate', () => { if (dlg && dlg.open) { pushed = false; dlg.close(); } });
/* любое закрытие диалога (кнопки, Esc, клик вне, программное) — снять пуш */
addEventListener('close', e => { if (e.target === dlg) settle(); }, true);

/* Самоподключаемый: строит вход-карточку после DOM */
if (typeof document !== 'undefined') {
  const start = () => buildEntryCard();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else setTimeout(start, 300);
}
