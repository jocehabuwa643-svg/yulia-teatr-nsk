/* client-map.js — карта клиентов в подразделе «Клиенты и площадки».
   Рисует объекты выбранного места из data/leads.json (OpenStreetMap, ODbL): школы (s), детские сады (d),
   ДК и клубы (c). Названия, которых нет в OSM, показываются как «без названия в OSM» — это данные источника.

   Жизненный цикл (детерминированный, исправление «зависает и вылетает» на телефоне):
   - карта создаётся ОДИН раз — при первом показе вкладки «Карта» (mountClientMap);
   - смена места — только перерисовка одного слоя (showPlace), без пересоздания карты;
   - размер отслеживает ОДИН ResizeObserver: invalidateSize в следующем кадре, подгонка границ — когда
     у контейнера впервые появился ненулевой размер (никаких серий setTimeout).
   Прежняя версия на каждое открытие создавала 3 раза по ~720 DOM-маркеров L.divIcon (Новосибирск), каждый —
   отдельный GPU-слой (translate3d): ~745 композитных слоёв и 12 таймеров fitBounds. Теперь все точки — L.circleMarker
   на одном canvas-рендерере: один слой, один элемент <canvas>.
   Подложка — как у основной карты (js/map.js): тайлы OpenStreetMap (CARTO без ключа отдаёт водяной знак),
   монохром CSS-фильтром по теме (css/restructure.css, .cl-map .leaflet-tile-pane). Трафик — один человек,
   с атрибуцией и без массовой выгрузки, в рамках правил tile.openstreetmap.org. */
import { ensureLeaflet, reduced } from './ui/helpers.js';
import { validObjects, kindCounts, boundsOf } from './clients-model.js';
import { objectKey, statusLabel, ruQuotes } from './crm.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Типы объектов и их отрисовка. Цвета не зависят от темы и различимы на светлой и тёмной подложке:
   школа — тёмная точка со светлым кольцом, сад — серая с тёмным кольцом, ДК — светлая с тёмным кольцом.
   Те же цвета в легенде (.clm-dot в css/restructure.css). */
export const KIND = {
  s: { label: 'Школа', plural: 'Школы', fill: '#1C1C1E', stroke: '#F5F5F7' },
  d: { label: 'Детский сад', plural: 'Детские сады', fill: '#8E8E93', stroke: '#1C1C1E' },
  c: { label: 'ДК / клуб', plural: 'ДК и клубы', fill: '#F5F5F7', stroke: '#1C1C1E' }
};

/* Статус мини-CRM (js/crm.js) поверх типа: цвет обводки + толщина/размер, «Договорились» — ещё и значок ✓,
   «Отказ» — бледная пунктирная точка. Так статус читается не только цветом. Те же обозначения — в легенде
   (.crm-dot в css/restructure.css). Цвета подобраны контрастными к серой подложке в обеих темах. */
export const STATUS_STYLE = {
  sent: { color: '#2563EB', weight: 3, radius: 7 },
  talks: { color: '#C2410C', weight: 4, radius: 8 },
  deal: { color: '#FFFFFF', fillColor: '#15803D', weight: 2, radius: 9 },
  refused: { opacity: 0.45, fillOpacity: 0.35, dashArray: '2 3', radius: 5 }
};

let L = null, mapObj = null, layer = null, renderer = null, ro = null, host = null;
/* Связь с мини-CRM: статус по ключу объекта и действие «Открыть карточку» из подсказки точки */
let statusFn = () => 'none', openCardFn = null, byKey = new Map();
let place = null, drawnId = null, needFit = true, rafId = 0, tileOk = false;

/* Сообщение вместо карты (Leaflet не загрузился / нет мест) */
function nodata(el, title, text) {
  el.innerHTML = `<div class="nodata"><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`;
}

/* Создать карту один раз. Повторные вызовы с тем же контейнером ничего не пересоздают. */
export function mountClientMap(el) {
  if (!el) return Promise.resolve(null);
  if (mapObj && host === el && document.contains(el)) return Promise.resolve(mapObj);
  return ensureLeaflet().then(lib => {
    if (!lib) { nodata(el, 'Карта недоступна', 'Библиотека карты не загрузилась. Счётчики и районы ниже остаются рабочими.'); return null; }
    if (mapObj && host === el) return mapObj;          // гонка двух вызовов: карта уже создана первым
    if (mapObj) destroyClientMap();                    // контейнер сменился (диалог пересоздан)
    L = lib; host = el;
    el.innerHTML = '';
    renderer = L.canvas({ padding: 0.4, tolerance: 10 });   // tolerance — запас касания вокруг точки
    mapObj = L.map(el, {
      preferCanvas: true, renderer,
      scrollWheelZoom: false, zoomControl: true, attributionControl: true,
      zoomAnimation: !reduced, fadeAnimation: !reduced, markerZoomAnimation: false,
      tapTolerance: 20
    });
    const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> · объекты OSM (ODbL)'
    }).addTo(mapObj);
    tiles.on('tileload', () => { tileOk = true; setTileWarn(false); });
    tiles.on('tileerror', () => { if (!tileOk) setTileWarn(true); });
    layer = L.layerGroup().addTo(mapObj);
    mapObj.on('popupopen', e => {
      const b = e.popup.getElement() && e.popup.getElement().querySelector('[data-crm-open]');
      if (b && openCardFn) b.addEventListener('click', ev => { ev.preventDefault(); openCardFn(b.dataset.crmOpen); }, { once: true });
    });
    // Стартовый вид — центр области, пока не пришёл размер и не нарисовано место
    mapObj.setView([55.03, 82.92], 9, { animate: false });
    // Один наблюдатель размера: диалог на телефоне раскрывается не мгновенно
    if ('ResizeObserver' in window) {
      ro = new ResizeObserver(() => scheduleResize());
      ro.observe(el);
    }
    if (place) draw();
    return mapObj;
  }).catch(() => {
    nodata(el, 'Карта недоступна', 'Библиотека карты не загрузилась. Счётчики и районы ниже остаются рабочими.');
    return null;
  });
}

/* Предупреждение о недоступной подложке — точки остаются, без фона улиц */
function setTileWarn(on) {
  const w = host && host.parentElement && host.parentElement.querySelector('.cl-tilewarn');
  if (w) w.hidden = !on;
}

/* Пересчёт размера в следующем кадре (схлопывает серию событий в один вызов) */
function scheduleResize() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    if (!mapObj || !host) return;
    const r = host.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;           // вкладка скрыта / диалог закрыт — ждём
    mapObj.invalidateSize({ pan: false, animate: false });
    if (needFit) fit();
  });
}

/* Вызывается после показа вкладки/диалога: тот же единый путь пересчёта размера */
export function refreshClientMap() { scheduleResize(); }

/* Показать место: перерисовка слоя только при смене места */
export function showPlace(p) {
  place = p || null;
  if (!mapObj) return;
  if (place && place.id === drawnId) { scheduleResize(); return; }
  draw();
}

/* Подключение мини-CRM: функция статуса по ключу и открытие карточки */
export function setCrmHooks({ status, openCard } = {}) {
  if (typeof status === 'function') statusFn = status;
  if (typeof openCard === 'function') openCardFn = openCard;
}

/* Статусы изменились — перерисовать точки, не сдвигая вид карты */
export function refreshStatuses() {
  if (!mapObj || !place) return;
  draw(true);
}

/* Показать объект на карте по ключу CRM и открыть его подсказку */
export function focusObject(key) {
  const m = byKey.get(key);
  if (!mapObj || !m) return false;
  needFit = false;
  // вкладка карты только что стала видимой — сначала актуальный размер, иначе центр уедет
  mapObj.invalidateSize({ pan: false, animate: false });
  mapObj.setView(m.getLatLng(), Math.max(mapObj.getZoom(), 15), { animate: false });
  m.openPopup();
  return true;
}

function popupHTML(o, K, where, key, st) {
  const name = o.n ? ruQuotes(o.n) : `${K.label} · без названия в OSM`;  // кавычки OSM → «ёлочки», как в списке
  const stLine = st && st !== 'none' ? `<br><small class="crm-popst">Статус: <b>${esc(statusLabel(st))}</b></small>` : '';
  const btn = openCardFn ? `<br><button type="button" class="crm-popbtn" data-crm-open="${esc(key)}">Открыть карточку</button>` : '';
  return `<b>${esc(name)}</b><br><small>${K.label}${where} · OpenStreetMap</small>${stLine}${btn}`;
}

function draw(keepView) {
  layer.clearLayers();
  byKey = new Map();
  drawnId = place ? place.id : null;
  if (!keepView) needFit = true;
  if (!place) return;
  const objs = validObjects(place);
  const where = place.name ? ' · ' + esc(place.name) : '';
  // Порядок отрисовки: ДК снизу, затем сады, школы сверху (их больше всего)
  ['c', 'd', 's'].forEach(k => {
    const K = KIND[k];
    objs.filter(o => o.k === k).forEach(o => {
      const key = objectKey(o);
      let st = 'none';
      try { st = statusFn(key) || 'none'; } catch (e) { st = 'none'; }
      const S = STATUS_STYLE[st] || {};
      const m = L.circleMarker(o.ll, { renderer, radius: 6, weight: 2, color: K.stroke, fillColor: K.fill, fillOpacity: 1, opacity: 1, ...S })
        .bindPopup(popupHTML(o, K, where, key, st), { autoPanPadding: [16, 16] })
        .addTo(layer);
      byKey.set(key, m);
      // «Договорились» — значок ✓ поверх точки (таких объектов единицы — DOM-маркер не нагружает карту)
      if (st === 'deal') {
        L.marker(o.ll, {
          icon: L.divIcon({ className: 'crm-dealmark', html: '✓', iconSize: [18, 18], iconAnchor: [9, 9] }),
          interactive: false, keyboard: false
        }).addTo(layer);
      }
    });
  });
  if (keepView) return;
  scheduleResize();
}

/* Подгонка вида под объекты места (без анимации — на слабом телефоне анимация 700 точек дорогая) */
function fit() {
  if (!place || !mapObj) return;
  const r = host.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  needFit = false;
  const b = boundsOf(validObjects(place));
  if (b) mapObj.fitBounds(b, { padding: [20, 20], maxZoom: 14, animate: false });
  else if (Array.isArray(place.coords)) mapObj.setView(place.coords, 12, { animate: false });
}

/* Полная разборка (смена контейнера). В обычной работе не вызывается: карта живёт, пока жива страница. */
export function destroyClientMap() {
  if (ro) { try { ro.disconnect(); } catch (e) { /* уже отключён */ } ro = null; }
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  if (mapObj) { try { mapObj.remove(); } catch (e) { /* уже снята */ } }
  mapObj = null; layer = null; renderer = null; host = null; drawnId = null; needFit = true; tileOk = false; byKey = new Map();
}

/* Совместимость со старым вызовом initClientMap(el, place): создать карту (однажды) и показать место */
export function initClientMap(el, p) {
  if (p !== undefined) place = p;
  return mountClientMap(el).then(m => { if (m) showPlace(place); return m; });
}

/* Число точек каждого типа на карте — для легенды */
export function mapCounts(p) { return kindCounts(validObjects(p)); }

/* Легенда типов под картой: цвета совпадают с точками, числа — точки с координатами на карте */
export function legendHTML(p) {
  const c = p ? mapCounts(p) : null;
  const n = k => (c ? ` <b>${c[k]}</b>` : '');
  return `<div class="clm-legend" aria-label="Обозначения на карте">
    <span><i class="clm-dot clm-s" aria-hidden="true"></i>${KIND.s.plural}${n('s')}</span>
    <span><i class="clm-dot clm-d" aria-hidden="true"></i>${KIND.d.plural}${n('d')}</span>
    <span><i class="clm-dot clm-c" aria-hidden="true"></i>${KIND.c.plural}${n('c')}</span>
  </div>
  <div class="clm-legend crm-legend" aria-label="Статусы площадок на карте">
    <span><i class="crm-dot crm-st-sent" aria-hidden="true"></i>Написала — синее кольцо</span>
    <span><i class="crm-dot crm-st-talks" aria-hidden="true"></i>Переговоры — толстое оранжевое</span>
    <span><i class="crm-dot crm-st-deal" aria-hidden="true"></i>Договорились — зелёная с ✓</span>
    <span><i class="crm-dot crm-st-refused" aria-hidden="true"></i>Отказ — бледная</span>
  </div>`;
}
