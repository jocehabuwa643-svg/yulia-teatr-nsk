/* client-map.js — карта клиентов в подразделе «Клиенты и площадки».
   Рисует объекты выбранного места из data/leads.json (OpenStreetMap, ODbL): школы (s),
   детские сады (d), ДК и клубы (c). Названия, которые OSM не знает, показываются как
   «объект без названия» — это данные источника, не ошибка. Карта ленивая: Leaflet подгружается
   тем же ensureLeaflet, что и карта прибыли; invalidateSize при каждом показе.
   ЦВЕТ: монохром — те же токены проекта, формы различают тип (круг/квадрат/романтик-маркер). */
import { $, ensureLeaflet } from './ui/helpers.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KIND = {
  s: { label: 'Школа', cls: 'clm-s' },
  d: { label: 'Детский сад', cls: 'clm-d' },
  c: { label: 'ДК / клуб', cls: 'clm-c' }
};

let mapObj = null, layer = null, curKey = null;

export function initClientMap(el, place) {
  if (!el) return;
  const p = place || currentDefaults();
  if (!p) { el.innerHTML = '<div class="nodata"><strong>Нет данных</strong><span>Места не загружены — проверьте data/leads.json.</span></div>'; return; }
  ensureLeaflet().then(L => {
    if (!L) { el.innerHTML = '<div class="nodata"><strong>Карта недоступна</strong><span>Leaflet не загрузился — счётчики выше остаются рабочими.</span></div>'; return; }
    if (!mapObj || !document.contains(el) || mapObj._container !== el) {
      if (mapObj) { try { mapObj.remove(); } catch (e) { /* уже снята */ } }
      el.innerHTML = '';
      mapObj = L.map(el, { scrollWheelZoom: false, attributionControl: true, dragging: true, zoomControl: true });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> · объекты OSM (ODbL)'
      }).addTo(mapObj);
      layer = L.layerGroup().addTo(mapObj);
    }
    drawObjects(L, p);
    // Размер диалога на телефоне нестабилен в момент открытия: серия invalidateSize,
    // иначе Leaflet остаётся «сломанным» (серый квадрат, маркеров не видно)
    [120, 350, 800, 1500].forEach(ms => setTimeout(() => { try { mapObj.invalidateSize({ pan: false }); mapObj.fitBounds((p.objects || []).map(o => o.ll).filter(a => Array.isArray(a)), { padding: [24, 24], maxZoom: 13, animate: false }); } catch (e) { /* карта пересоздана */ } }, ms));
  }).catch(() => {
    el.innerHTML = '<div class="nodata"><strong>Карта недоступна</strong><span>Leaflet не загрузился — счётчики выше остаются рабочими.</span></div>';
  });
}

function currentDefaults() {
  const l = (window.__yuliaData && window.__yuliaData.leads) || null;
  const places = (l && l.places) || [];
  return places[0] || null;
}

function drawObjects(L, p) {
  layer.clearLayers();
  const kinds = { s: [], d: [], c: [] };
  (p.objects || []).forEach(o => { (kinds[o.k] ? kinds[o.k] : kinds.s).push(o); });
  const icon = cls => L.divIcon({ className: 'clm-wrap', html: `<span class="clm-dot ${cls}"></span>`, iconSize: [16, 16], iconAnchor: [8, 8] });
  ['s', 'd', 'c'].forEach(k => {
    kinds[k].forEach(o => {
      if (!Array.isArray(o.ll) || o.ll.length !== 2) return;
      const name = o.n || `${KIND[k].label} · без названия в OSM`;
      const m = L.marker(o.ll, { icon: icon(KIND[k].cls), title: name, keyboard: false })
        .bindPopup(`<b>${esc(name)}</b><br><small>${KIND[k].label} · OpenStreetMap${p.name ? ' · ' + esc(p.name) : ''}</small>`);
      layer.addLayer(m);
    });
  });
  // Подгонка по объектам места
  const lls = (p.objects || []).map(o => o.ll).filter(a => Array.isArray(a) && a.length === 2);
  if (lls.length) mapObj.fitBounds(lls, { padding: [24, 24], maxZoom: 13, animate: false });
}

/* Легенда типов под картой (одна на вкладку) */
export function legendHTML() {
  return `<div class="clm-legend">
    <span><i class="clm-dot clm-s"></i>Школы</span>
    <span><i class="clm-dot clm-d"></i>Детские сады</span>
    <span><i class="clm-dot clm-c"></i>ДК и клубы</span>
    <span class="tiny">OpenStreetMap · возможны пропуски</span>
  </div>`;
}
