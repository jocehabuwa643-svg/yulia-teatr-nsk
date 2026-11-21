/* clients-view.js — подраздел «Клиенты и площадки»: вход-карточка на главной, открытие —
   полноэкранный диалог с тремя вкладками:
     1) Карта клиентов — объекты OSM выбранного места (школы/сады/ДК) + счётчики и районы из data/leads.json;
     2) Помещения — ручной список Юлии (premises.js монтируется сюда);
     3) Цены и аренда — ориентиры из config.json и competitors.json, каждая строка с источником и датой.
   Все числа — из данных или ручной ввод; «нет данных» показывается честно. Логика подсчётов и истории —
   в js/clients-model.js (чистые функции, покрыты тестами).

   Надёжность (жалоба «зависает и выкидывает с сайта»):
   - история: запись кладёт и снимает только «страж» (makeBackGuard) — history.back() вызывается лишь тогда,
     когда текущая запись наша; «назад» телефона закрывает подраздел и никогда не уводит со страницы;
   - карта: один экземпляр на всё время жизни страницы, точки — на canvas (js/client-map.js);
   - данные: если leads.json ещё не загружен общим загрузчиком (медленная сеть) — догружаем по требованию;
     вход-карточка показывает скелетон и обновляет числа, когда данные пришли;
   - фон под диалогом не прокручивается, фокус и позиция прокрутки возвращаются на место.
   Анимации — только transform/opacity; reduced-motion — без анимаций. */
import { fmt, ic, icons } from './ui/helpers.js';
import { state } from './state.js';
import { initPremises } from './premises.js';
import { mountClientMap, showPlace, refreshClientMap, legendHTML } from './client-map.js';
import { leadTotals, pickPlace, placeStat, districtRows, priceRows, confLabel, makeBackGuard } from './clients-model.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ruDate = d => { const t = new Date(d); return Number.isFinite(t.getTime()) ? t.toLocaleDateString('ru-RU') : '—'; };

const TABS = [
  ['map', 'map', 'Карта'],
  ['rooms', 'key-round', 'Помещения'],
  ['prices', 'tag', 'Цены и аренда']
];

let dlg = null, lastFocus = null, tab = 'map', premisesIn = false, placeId = null, scrollY0 = 0;
const guard = typeof history !== 'undefined' ? makeBackGuard(history) : null;

/* ---------- Данные leads.json ----------
   Основной путь — общий загрузчик (state.DATA.leads). Если его ещё нет (медленная сеть, клик раньше загрузки) —
   один запрос по требованию с таймаутом 10 с; результат кэшируется. */
let leadsReq = null;
function leadsNow() { return (state.DATA && state.DATA.leads && Array.isArray(state.DATA.leads.places)) ? state.DATA.leads : null; }
function loadLeads() {
  const have = leadsNow();
  if (have) return Promise.resolve(have);
  if (leadsReq) return leadsReq;
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ac && ac.abort(), 10000);
  leadsReq = fetch('data/leads.json', { cache: 'no-cache', signal: ac ? ac.signal : undefined })
    .then(r => (r.ok ? r.json() : null))
    .then(j => {
      // общий загрузчик мог успеть раньше — его данные главнее
      const now = leadsNow();
      if (now) return now;
      if (j && Array.isArray(j.places)) { if (state.DATA) state.DATA.leads = j; return j; }
      return null;
    })
    .catch(() => leadsNow())
    .finally(() => { clearTimeout(timer); if (!leadsNow()) leadsReq = null; });
  return leadsReq;
}

/* ---------- Вход-карточка на главной ----------
   Кнопка создаётся один раз; числа обновляются при каждом вызове (app.js зовёт после загрузки данных).
   Пока данных нет — скелетон той же высоты (без «прыжка» вёрстки). */
export function buildEntryCard() {
  const host = typeof document !== 'undefined' && document.getElementById('clientsEntry');
  if (!host) return;
  let btn = host.querySelector('#clientsOpen');
  if (!btn) {
    host.innerHTML = `
      <button type="button" class="card cl-entry" id="clientsOpen" aria-haspopup="dialog" aria-controls="clientsView">
        <span class="cl-ic">${ic('map-pin-check')}</span>
        <span class="cl-t"><small>Отдельный подраздел</small><span class="cl-h">Клиенты и площадки</span>
          <span class="cl-sub">Карта школ, садов и ДК · помещения · ориентиры аренды и цен</span></span>
        <span class="cl-go" aria-hidden="true">→</span>
        <span class="cl-stats" aria-live="polite"></span>
      </button>`;
    btn = host.querySelector('#clientsOpen');
    // обработчик клика получает Event — фокус возвращаем на саму кнопку, а не на объект события
    btn.addEventListener('click', () => openClients(btn));
    icons();
  }
  renderEntryStats(btn.querySelector('.cl-stats'));
}

function renderEntryStats(box) {
  if (!box) return;
  const leads = leadsNow();
  const t = leadTotals(leads);
  if (!t.ready) {
    box.classList.add('is-loading');
    box.innerHTML = ['школ и садов', 'ДК и клубов', 'мест на карте'].map(l => `<span><b class="cl-skel" aria-hidden="true"></b><small>${l}</small></span>`).join('');
    box.setAttribute('aria-label', leads === null && state.DATA ? 'Данные о клиентах не загрузились' : 'Загрузка данных о клиентах');
    return;
  }
  box.classList.remove('is-loading');
  box.removeAttribute('aria-label');
  box.innerHTML = `
    <span><b>${fmt(t.visit)}</b><small>школ и садов</small></span>
    <span><b>${fmt(t.culture)}</b><small>ДК и клубов</small></span>
    <span><b>${t.places}</b><small>мест на карте</small></span>`;
}

/* ---------- Диалог ---------- */
function ensureDialog() {
  if (dlg && document.contains(dlg)) return;
  dlg = document.createElement('dialog');
  dlg.id = 'clientsView';
  dlg.className = 'cl-dialog';
  dlg.setAttribute('aria-labelledby', 'clTitle');
  dlg.innerHTML = `
    <div class="cl-head">
      <button type="button" class="btn small secondary cl-back" data-cl-back><span aria-hidden="true">←</span> Назад</button>
      <button type="button" class="ghostbtn cl-x" data-cl-close aria-label="Закрыть раздел">✕</button>
      <h2 id="clTitle">Клиенты и площадки</h2>
      <p class="tiny" id="clMeta"></p>
    </div>
    <div class="cl-tabs" role="tablist" aria-label="Вкладки раздела">
      ${TABS.map(([id, icn, label]) => `<button type="button" class="tab${id === 'map' ? ' on' : ''}" role="tab" id="clTab-${id}" aria-controls="clPane-${id}" aria-selected="${id === 'map'}" data-cl-tab="${id}">${ic(icn)}<span>${label}</span></button>`).join('')}
    </div>
    <div class="cl-body">
      <div class="cl-pane" id="clPane-map" role="tabpanel" aria-labelledby="clTab-map" data-pane="map">
        <div class="cl-placebar"><label for="clPlace">Место</label><select id="clPlace"></select></div>
        <div class="cl-stat" id="clPlaceStat"></div>
        <div class="cl-mapwrap">
          <div id="clMap" class="cl-map" role="region" aria-label="Карта клиентов"></div>
          <p class="cl-tilewarn" hidden>Подложка карты недоступна — точки и подсказки работают без фона улиц.</p>
        </div>
        <div id="clLegend"></div>
        <div id="clDistricts"></div>
        <p class="hint" id="clNote"></p>
      </div>
      <div class="cl-pane" id="clPane-rooms" role="tabpanel" aria-labelledby="clTab-rooms" data-pane="rooms" hidden><div id="clRooms"></div></div>
      <div class="cl-pane" id="clPane-prices" role="tabpanel" aria-labelledby="clTab-prices" data-pane="prices" hidden><div id="clPrices"></div></div>
    </div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('[data-cl-back]').addEventListener('click', closeClients);
  dlg.querySelector('[data-cl-close]').addEventListener('click', closeClients);
  // клик вне содержимого (по подложке на широком экране): закрываем, только если нажатие и отпускание — на подложке
  let downOnDlg = false;
  dlg.addEventListener('pointerdown', e => { downOnDlg = e.target === dlg; });
  dlg.addEventListener('click', e => { if (e.target === dlg && downOnDlg) closeClients(); downOnDlg = false; });
  // единая точка закрытия: кнопки, Esc, «назад» телефона (CloseWatcher), программное dlg.close()
  dlg.addEventListener('close', onClosed);
  dlg.querySelectorAll('[data-cl-tab]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.clTab)));
  // стрелки влево/вправо по вкладкам (паттерн tablist)
  dlg.querySelector('.cl-tabs').addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const ids = TABS.map(t => t[0]);
    const i = (ids.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length;
    showTab(ids[i]);
    dlg.querySelector(`[data-cl-tab="${ids[i]}"]`).focus();
  });
  dlg.querySelector('#clPlace').addEventListener('change', e => renderPlace(e.target.value));
}

function showTab(id) {
  tab = id;
  dlg.querySelectorAll('[data-cl-tab]').forEach(b => { const on = b.dataset.clTab === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  dlg.querySelectorAll('.cl-pane').forEach(p => { p.hidden = p.dataset.pane !== id; });
  dlg.querySelector('.cl-body').scrollTop = 0;
  if (id === 'map') {
    // карта создаётся один раз; при повторном показе — один пересчёт размера
    mountClientMap(dlg.querySelector('#clMap')).then(m => { if (m) { showPlace(pickPlace((leadsNow() || {}).places, placeId)); refreshClientMap(); } });
  }
  if (id === 'rooms' && !premisesIn) {
    premisesIn = true;
    initPremises(dlg.querySelector('#clRooms')).then(() => icons()).catch(() => {
      premisesIn = false;
      dlg.querySelector('#clRooms').innerHTML = '<div class="nodata"><strong>Список не открылся</strong><span>Хранилище браузера недоступно (приватный режим?). Попробуйте ещё раз позже.</span></div>';
    });
  }
}

/* ---------- Данные вкладок ---------- */
function fillMeta() {
  const leads = leadsNow();
  const t = leadTotals(leads);
  const src = (leads && leads.sources) || [];
  const names = (Array.isArray(src) ? src : Object.values(src)).map(s => s && (s.name || s.id)).filter(Boolean).join(', ');
  dlg.querySelector('#clMeta').textContent = leads
    ? `${names || 'OpenStreetMap'} · обновлено ${t.updated ? ruDate(t.updated) : '—'}${t.stale ? ' · данные устарели' : ''} · возможны пропуски`
    : (leadsReq ? 'Загружаем данные…' : 'Данные о клиентах не загрузились — проверьте интернет и откройте раздел ещё раз.');
}

function fillMapTab() {
  const leads = leadsNow();
  const places = (leads && leads.places) || [];
  const sel = dlg.querySelector('#clPlace');
  sel.innerHTML = places.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  sel.disabled = !places.length;
  const p = pickPlace(places, placeId);
  if (p) sel.value = p.id;
  dlg.querySelector('#clNote').textContent = (leads && leads.note) || 'Объекты по данным OpenStreetMap (ODbL): часть учреждений может быть не нанесена.';
  if (!places.length) {
    dlg.querySelector('#clPlaceStat').innerHTML = leadsReq
      ? '<div class="nodata"><strong>Загружаем…</strong><span>Список школ, садов и ДК подгружается.</span></div>'
      : '<div class="nodata"><strong>Нет данных</strong><span>Список школ, садов и ДК не загрузился. Проверьте интернет и откройте раздел ещё раз.</span></div>';
    dlg.querySelector('#clLegend').innerHTML = '';
    dlg.querySelector('#clDistricts').innerHTML = '';
    return;
  }
  renderPlace(p.id);
}

function renderPlace(id) {
  const p = pickPlace((leadsNow() || {}).places, id);
  if (!p) return;
  placeId = p.id;
  const s = placeStat(p);
  dlg.querySelector('#clPlaceStat').innerHTML = `
    <span><b>${fmt(s.school)}</b><small>школ</small></span>
    <span><b>${fmt(s.kindergarten)}</b><small>детских садов</small></span>
    <span><b>${fmt(s.culture)}</b><small>ДК и клубов</small></span>
    <span class="cl-stat-sum"><b>${fmt(s.visit)}</b><small>потенциал выезда</small></span>
    ${p.stale ? '<span class="cd-badge stale">данные места устарели</span>' : ''}`;
  dlg.querySelector('#clLegend').innerHTML = legendHTML(p);
  const ds = districtRows(p);
  dlg.querySelector('#clDistricts').innerHTML = ds.length ? `
    <details class="cl-districts">
      <summary>По районам · ${ds.length}</summary>
      <div class="cl-dtable" role="table" aria-label="Районы: школы, сады, ДК">
        <div class="cl-drow cl-dhead" role="row"><span role="columnheader">Район</span><span role="columnheader">Школы</span><span role="columnheader">Сады</span><span role="columnheader">ДК</span></div>
        ${ds.map(d => `<div class="cl-drow" role="row"><span role="cell">${esc(d.name.replace(/ район$/, ''))}</span><span role="cell">${fmt(d.school)}</span><span role="cell">${fmt(d.kindergarten)}</span><span role="cell">${fmt(d.culture)}</span></div>`).join('')}
      </div>
    </details>` : '';
  if (tab === 'map') showPlace(p);
}

function fillPricesTab() {
  const rows = priceRows(state.CFG || {}, (state.DATA && state.DATA.competitors) || {});
  const srcLine = r => {
    const bits = [r.note];
    if (r.date) bits.push(`на ${ruDate(r.date)}`);
    return bits.filter(Boolean).map(esc).join(' · ');
  };
  dlg.querySelector('#clPrices').innerHTML = `
    <div class="cl-pricecard">
      ${rows.map(r => `<div class="cl-prow">
        <span class="cl-pk">${esc(r.k)}</span>
        <span class="cl-pv">${r.v == null ? '<span class="cd-none">нет данных</span>' : `<b>${esc(r.v)}</b>`}</span>
        <small class="cl-pn">${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">${srcLine(r)} ↗</a>` : srcLine(r)}
          <span class="cd-badge${r.conf === 'no_data' ? ' none' : ''}">${esc(confLabel(r.conf))}</span></small>
      </div>`).join('')}
    </div>
    <p class="hint">«Допущение проекта» — рабочая цифра бизнес-плана, её можно поменять в калькуляторах. Цены конкурентов — с публичных страниц на указанную дату; реальные тарифы аренды — только по запросу КП у собственника.</p>`;
}

/* ---------- Открытие/закрытие ---------- */
function lockScroll(on) {
  const root = document.documentElement;
  if (on) {
    scrollY0 = window.scrollY;
    root.style.setProperty('--cl-sbw', `${Math.max(0, innerWidth - root.clientWidth)}px`);
    root.classList.add('cl-lock');
  } else {
    root.classList.remove('cl-lock');
    root.style.removeProperty('--cl-sbw');
    if (Math.abs(window.scrollY - scrollY0) > 1) scrollTo({ top: scrollY0, left: 0, behavior: 'instant' });
  }
}

/* Ожидание снятия прошлой записи истории (быстрое повторное открытие): иначе запоздавший popstate
   закрыл бы только что открытый подраздел. Не дольше 500 мс. */
function waitHistory() {
  if (!guard || !guard.pending) return Promise.resolve();
  return new Promise(res => {
    const done = () => { removeEventListener('popstate', done); clearTimeout(t); res(); };
    const t = setTimeout(done, 500);
    addEventListener('popstate', done);
  });
}

let opening = false;
export async function openClients(fromEl) {
  // принимаем только элемент (обработчик click передаёт Event — его не считаем элементом фокуса)
  if (fromEl && fromEl.nodeType === 1 && typeof fromEl.focus === 'function') lastFocus = fromEl;
  else if (!lastFocus && document.activeElement && document.activeElement !== document.body) lastFocus = document.activeElement;
  if (opening || (dlg && dlg.open)) return;
  opening = true;
  try {
    await waitHistory();
    ensureDialog();
    if (!leadsNow()) loadLeads().then(() => { if (dlg.open) { fillMeta(); fillMapTab(); showTab(tab); } buildEntryCard(); });
    fillMeta(); fillMapTab(); fillPricesTab();
    lockScroll(true);
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    if (guard) guard.push();
    showTab('map');
    icons();
    dlg.querySelector('[data-cl-back]').focus({ preventScroll: true });
  } finally { opening = false; }
}

export function closeClients() { if (dlg && dlg.open) dlg.close(); }

/* Любое закрытие диалога сходится сюда: снять запись истории (только если она наша), вернуть прокрутку и фокус */
function onClosed() {
  if (guard) guard.release();
  lockScroll(false);
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
}

/* «Назад» браузера/телефона: если нашей записи больше нет — закрыть подраздел (без второго back) */
if (typeof window !== 'undefined' && guard) {
  addEventListener('popstate', e => {
    if (guard.onPop(e.state) && dlg && dlg.open) dlg.close();
    else guard.scrub();   // «вперёд» в старую запись после закрытия — снимаем с неё нашу метку
  });
  // после перезагрузки или восстановления вкладки в истории может остаться наша старая метка
  guard.scrub();
}

/* Самоподключаемый: скелетон карточки сразу после DOM; числа подставит app.js после загрузки данных
   (buildEntryCard идемпотентна — повторный вызов только обновляет счётчики). */
if (typeof document !== 'undefined') {
  const start = () => buildEntryCard();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
