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

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Типы объектов и их отрисовка. Цвета не зависят от темы и различимы на светлой и тёмной подложке:
   школа — тёмная точка со светлым кольцом, сад — серая с тёмным кольцом, ДК — светлая с тёмным кольцом.
   Те же цвета в легенде (.clm-dot в css/restructure.css). */
export const KIND = {
  s: { label: 'Школа', plural: 'Школы', fill: '#1C1C1E', stroke: '#F5F5F7' },
  d: { label: 'Детский сад', plural: 'Детские сады', fill: '#8E8E93', stroke: '#1C1C1E' },
  c: { label: 'ДК / клуб', plural: 'ДК и клубы', fill: '#F5F5F7', stroke: '#1C1C1E' }
};

let L = null, mapObj = null, layer = null, renderer = null, ro = null, host = null;
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

function draw() {
  layer.clearLayers();
  drawnId = place ? place.id : null;
  needFit = true;
  if (!place) return;
  const objs = validObjects(place);
  const where = place.name ? ' · ' + esc(place.name) : '';
  // Порядок отрисовки: ДК снизу, затем сады, школы сверху (их больше всего)
  ['c', 'd', 's'].forEach(k => {
    const K = KIND[k];
    objs.filter(o => o.k === k).forEach(o => {
      const name = o.n || `${K.label} · без названия в OSM`;
      L.circleMarker(o.ll, { renderer, radius: 6, weight: 2, color: K.stroke, fillColor: K.fill, fillOpacity: 1, opacity: 1 })
        .bindPopup(`<b>${esc(name)}</b><br><small>${K.label}${where} · OpenStreetMap</small>`, { autoPanPadding: [16, 16] })
        .addTo(layer);
    });
  });
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
  mapObj = null; layer = null; renderer = null; host = null; drawnId = null; needFit = true; tileOk = false;
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
  </div>`;
}
