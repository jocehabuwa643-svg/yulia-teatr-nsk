/* map.js — Leaflet: монохромные тайлы CartoDB, два масштаба, карточка локации.
   Прибыль дня в карточке считается калькулятором выездов на лету. */
import { $, signed, reduced, enter } from './ui/helpers.js';
import { registerMap, isDark } from './theme.js';
import { travelCalc } from './calculators/travel.js';

let mapObj = null, tileLayer = null, marks = {}, selected = 'home', zone = null, tileSuccess = false;
let D = null; // regions.json

export function initMap(regionsData, calcConfig, presetsTravel) {
  D = regionsData;
  const points = buildPoints(regionsData, calcConfig);
  $('location').innerHTML = points.map(p => `<option value="${p.id}">${p.n}</option>`).join('');
  $('location').onchange = () => {
    const o = points.find(p => p.id === $('location').value);
    setMapMode(o.g === 2);
    locDetails(o.id, true, points, calcConfig);
  };
  $('cityMode').onclick = () => setMapMode(false, points);
  $('areaMode').onclick = () => setMapMode(true, points);
  locDetails('home', false, points, calcConfig);

  enter($('map'), () => {
    if (!window.L) {
      $('map').style.display = 'none';
      const w = $('mapwarning'); w.hidden = false;
      w.textContent = 'Карта не загрузилась. Все карточки доступны в списке локаций.';
      return;
    }
    mapObj = L.map('map', { zoomControl: false, scrollWheelZoom: false, attributionControl: true });
    L.control.zoom({ zoomInTitle: 'Приблизить', zoomOutTitle: 'Отдалить' }).addTo(mapObj);
    tileLayer = L.tileLayer(isDark()
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      { maxZoom: 19, subdomains: 'abcd', attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">Участники OpenStreetMap</a> · <a href="https://carto.com/attributions" target="_blank" rel="noopener">© CARTO</a>' }
    ).addTo(mapObj);
    registerMap(mapObj, tileLayer);
    tileLayer.on('tileload', () => { tileSuccess = true; $('mapwarning').hidden = true; });
    tileLayer.on('tileerror', () => {
      if (!tileSuccess) { const w = $('mapwarning'); w.hidden = false; w.textContent = 'Подложка карты недоступна. Метки, масштаб и список локаций продолжают работать.'; }
    });
    zone = L.circle(points[0].ll, { radius: D.home_zone_radius_m, weight: 1, color: '#8E8E93', fillColor: '#8E8E93', fillOpacity: .12 })
      .addTo(mapObj).bindTooltip('Зона поиска · не граница рынка');
    zone.on('click', () => locDetails('home', false, points, calcConfig));
    points.filter(p => p.id !== 'home').forEach(p => {
      const cls = ['pin-home', 'pin-city', 'pin-reg', 'pin-arc'][p.g];
      const marker = L.marker(p.ll, {
        title: p.n, alt: p.n,
        icon: L.divIcon({ className: '', html: `<div class="pin ${cls}"></div>`, iconSize: [20, 20], iconAnchor: [8, 20] })
      }).addTo(mapObj).bindTooltip(p.n);
      marker.on('click', () => locDetails(p.id, false, points, calcConfig));
      marks[p.id] = marker;
    });
    setMapMode(points.find(p => p.id === selected)?.g === 2, points);
    mapObj.invalidateSize({ pan: false });
    if (window.ResizeObserver) new ResizeObserver(() => mapObj && mapObj.invalidateSize({ pan: false })).observe($('map'));
    addEventListener('resize', () => mapObj && mapObj.invalidateSize({ pan: false }));
  });
}

/* Гастрольные точки собираются из region_routes + прибыль дня куста по калькулятору */
function buildPoints(D, cfg) {
  const points = D.points.map(p => ({ ...p }));
  const gastro = { n: 45, p: 300, k: 3, r: 1, dk: 0, own: 0 }; // куст 3 × 45 по 300 ₽
  D.region_routes.forEach(r => {
    const input = { ...gastro, r: r.route_index };
    const t = travelCalc(input, cfg);
    points.push({
      id: 'r' + r.route_index, g: 2, r: r.route_index, n: r.n, ll: r.ll,
      address: r.net, aud: r.pop + ' (ориентир из плана, не детская аудитория)',
      dist: cfg.routes_gas[r.route_index].km + ' км в одну сторону',
      be: t.be + ' детей за день', rivals: r.rivals,
      tourProfit: t.profit,
      steps: [
        r.route_index === 5 ? 'Запросить смету сводного зала на 150–250 зрителей.' : 'Согласовать опорное учреждение и две соседние группы.',
        `В режиме 3 × 45 по 300 ₽ подтвердить минимум ${t.be} оплат на день.`,
        r.route_index === 5 ? 'Сравнить 70/30 в ДК с тремя школьными показами до выезда.' : 'Закрепить часы трёх показов, питание, монтаж и возвраты.'
      ],
      url: r.url
    });
  });
  return points;
}

function locDetails(id, pan, points, cfg) {
  const p = points.find(o => o.id === id);
  if (!p) return;
  selected = id;
  $('location').value = id;
  const type = ['Домашний район', 'Городская площадка', 'Гастрольный маршрут', 'Архив / изменённый статус'][p.g];
  const tour = p.g === 2 ? travelCalc({ n: 45, p: 300, k: 3, r: p.r ?? +String(id).slice(1), dk: 0, own: 0 }, cfg) : (p.tourProfit !== undefined ? { profit: p.tourProfit } : null);
  $('locDetails').innerHTML = `
    <div class="eyebrow" style="margin-top:6px"><span class="dash"></span>${type}</div>
    <h3>${p.n}</h3><p>${p.address}</p>
    <div class="locdata">
      <div><small>${p.g === 2 ? 'Население' : 'Расстояние / район'}</small><b>${p.g === 2 ? p.aud.replace(' (ориентир из плана, не детская аудитория)', '') : p.dist}</b></div>
      <div><small>${p.g === 2 ? 'Плечо в одну сторону' : 'Безубыточность'}</small><b>${p.g === 2 ? p.dist : p.be}</b></div>
    </div>
    ${tour ? `<p><b>Прибыль дня:</b> <b>${signed(tour.profit)}</b> · куст 3 × 45 по 300 ₽</p>` : ''}
    <p><b>Аудитория:</b> ${p.aud}.</p><p><b>Альтернативы:</b> ${p.rivals}</p>
    <strong style="font-size:13px;display:block;margin:10px 0 4px">Как начать разговор</strong>
    <ol>${p.steps.map(s => `<li>${s}</li>`).join('')}</ol>
    ${p.url ? `<a target="_blank" href="${p.url}" rel="noopener noreferrer">Карточка или первоисточник ↗</a>` : '<span class="hint">Источник: гастрольная модель из бизнес-плана.</span>'}
    ${p.be && p.be.includes('¹') ? `<p class="hint" style="margin-top:8px">${D.footnote || ''}</p>` : ''}`;
  Object.keys(marks).forEach(k => {
    const el = marks[k].getElement();
    const pin = el && el.querySelector('.pin');
    if (pin) pin.classList.toggle('sel', k === id);
  });
  if (mapObj && pan) mapObj.setView(p.ll, p.g === 2 ? 9 : 15, { animate: !reduced });
}

function setMapMode(reg, points) {
  if (!points) points = buildPoints(D, MAP_CFG);
  $('cityMode').classList.toggle('on', !reg);
  $('areaMode').classList.toggle('on', reg);
  $('cityMode').setAttribute('aria-pressed', String(!reg));
  $('areaMode').setAttribute('aria-pressed', String(reg));
  if (mapObj) {
    const arr = reg ? [points[0], ...points.filter(x => x.g === 2)] : points.filter(x => x.g !== 2);
    mapObj.fitBounds(arr.map(p => p.ll), { padding: [22, 22], maxZoom: reg ? 9 : 12, animate: false });
    setTimeout(() => mapObj && mapObj.invalidateSize({ pan: false }), 60);
  }
  locDetails(reg ? 'r1' : 'home', false, points, MAP_CFG);
}

let MAP_CFG = null;
export function setMapConfig(cfg) { MAP_CFG = cfg; }
export function getMapObj() { return mapObj; }
