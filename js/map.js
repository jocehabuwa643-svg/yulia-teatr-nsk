/* map.js — карта прибыли: Leaflet, два режима, карточка локации. «Прибыль дня» считает калькулятор выездов
   (travelCalc) на лету по выбранному сценарию из config.presets_travel; население — из regions.json (с источником)
   либо «нет данных» + ручной ввод. Анимации — только transform/opacity.
   Подложка: проверено 19.11.2026 — тайлы CARTO (Positron / Dark Matter) без API-ключа отдают водяной знак
   «API KEY REQUIRED» (ETag wm-*), а ключ в статическом сайте был бы публичным. Поэтому берём стандартные тайлы
   OpenStreetMap (ключ не нужен) и делаем их монохромными CSS-фильтром: светлая тема — grayscale, тёмная — инверсия
   (css/market.css, .mapstage .leaflet-tile-pane). Смена темы работает чисто на CSS по [data-theme] — без JS. */
import { $, $$, fmt, signed, ic, icons, toast, store, reduced, enter, ensureLeaflet } from './ui/helpers.js';
import { travelCalc } from './calculators/travel.js';
import { state } from './state.js';
import { freshBadge } from './market.js';

let mapObj = null, tileLayer = null, zoneLayer = null, tileOk = false;
let D = null;            // regions.json
let CFG_REF = null;      // запасной конфиг, если state.CFG ещё не собран
let PTS = [];            // все точки: данные карты + маршруты области
let marks = {};          // id → маркер Leaflet
let selected = 'home';
let areaMode = false;    // false — «Новосибирск и Богдана Хмельницкого», true — «Города области»
let scenIdx = 0;         // выбранный сценарий из presets_travel
const MANUAL_KEY = 'map.manual'; // { [id]: { population, traffic, date, url } }

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = u => (typeof u === 'string' && /^https?:\/\/\S+$/i.test(u.trim())) ? u.trim() : null;
const today = () => new Date().toISOString().slice(0, 10);
const ruDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : '—'; };
const cfg = () => state.CFG || CFG_REF;
/* Значения конфига могут быть либо массивом, либо объектом с провенансом {value, source_name, …} — берём value */
const U = x => (x && !Array.isArray(x) && typeof x === 'object' && 'value' in x) ? x.value : x;
const presets = () => { const a = cfg() && U(cfg().presets_travel); return Array.isArray(a) ? a : []; };
const routes = () => { const a = cfg() && U(cfg().routes_gas); return Array.isArray(a) ? a : []; };
const TYPES = ['Домашний район', 'Городская площадка', 'Гастрольный маршрут', 'Архив / изменённый статус'];
const PIN = ['pin-home', 'pin-city', 'pin-reg', 'pin-arc'];
const manualAll = () => { const v = store.get(MANUAL_KEY, {}); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; };

/* ---------- Сценарий и расчёт прибыли дня ---------- */

/* Подпись сценария строится из параметров пресета, а не из констант: «куст 3 × 45 по 300 ₽» */
/* Название пресета вроде «Куст в Бердске» привязано к своему маршруту, а на карте маршрут подставляется по точке —
   поэтому подпись собирается только из параметров показа */
function scenarioLabel(pr) { return `${pr.k > 1 ? 'куст ' : ''}${pr.k} × ${pr.n} по ${fmt(pr.p)} ₽${pr.dk ? ' · зал ДК' : ''}${pr.own ? ' · основатели' : ''}`; }

/* Расчёт по тем же входам и той же функции, что в калькуляторе «Выездной спектакль» */
function scenarioCalc(p) {
  const c = cfg(), pr = presets()[scenIdx];
  if (!c || !pr || p.route_index == null || !routes()[p.route_index]) return null;
  return travelCalc({ n: pr.n, p: pr.p, k: pr.k, r: p.route_index, dk: pr.dk, own: pr.own }, c);
}

/* Сценарий по умолчанию — «куст» (3 показа подряд) из presets_travel; иначе первый пресет */
function defaultScenario() {
  const i = presets().findIndex(x => x.k === 3);
  return i >= 0 ? i : 0;
}

/* ---------- Точки ---------- */

/* Точки карты + гастрольные маршруты области (их данные берутся из region_routes, плечо — из routes_gas) */
function buildPoints() {
  const pts = (D.points || []).map(p => ({ ...p }));
  (D.region_routes || []).forEach(r => pts.push({
    id: 'r' + r.route_index, g: 2, route_index: r.route_index, n: r.n, ll: r.ll, address: r.net,
    population: r.population || null, traffic: r.traffic || null, rivals: r.rivals, url: r.url, src: r.src, steps: r.steps || []
  }));
  return pts;
}
const byId = id => PTS.find(p => p.id === id);

/* ---------- Вход ---------- */

export function initMap(regionsData, calcConfig) {
  D = regionsData || { points: [], region_routes: [], home_zone_radius_m: 1250 };
  if (calcConfig) CFG_REF = calcConfig;
  PTS = buildPoints();
  scenIdx = defaultScenario();

  // Список локаций — запасной путь, работает и без карты
  $('location').innerHTML = PTS.map(p => `<option value="${esc(p.id)}">${esc(p.n)}</option>`).join('');
  $('location').onchange = () => {
    const p = byId($('location').value); if (!p) return;
    setMode(p.g === 2, p.id, true);
  };
  $('cityMode').onclick = () => setMode(false, null, true);
  $('areaMode').onclick = () => setMode(true, null, true);
  $('oblastMode').onclick = () => setMode('oblast', null, true);
  renderScenario();
  setMode(false, 'home', false);

  // Карта создаётся лениво — когда блок попал в зону видимости
  // Leaflet (css+js) подгружается за ~600px до блока карты; при сбое CDN buildMap покажет плашку-запасной путь
  enter($('map'), () => ensureLeaflet().catch(() => null).then(buildMap), '600px');
}

/* Переключатель режимов: 'city' | 'area' | 'oblast'. Подгоняет карту, выбирает локацию */
function setMode(reg, id, fit) {
  areaMode = reg;
  const oblast = reg === 'oblast';
  $('cityMode').classList.toggle('on', reg === false);
  $('areaMode').classList.toggle('on', reg === true);
  if ($('oblastMode')) $('oblastMode').classList.toggle('on', oblast);
  $('cityMode').setAttribute('aria-pressed', String(reg === false));
  $('areaMode').setAttribute('aria-pressed', String(reg === true));
  if ($('oblastMode')) $('oblastMode').setAttribute('aria-pressed', String(oblast));
  const target = oblast ? 'home' : (id || (reg ? ((PTS.find(p => p.g === 2) || {}).id) : 'home')) || 'home';
  if (mapObj) fitMode();
  showLocation(target, { pan: false });
  if (fit && mapObj) setTimeout(invalidate, 60);
}

function fitMode() {
  let arr;
  if (areaMode === 'oblast') {
    // вся Новосибирская область: наши точки + места потенциальных клиентов из leads.json (OSM)
    const extra = (state.DATA && state.DATA.leads && state.DATA.leads.places || [])
      .map(p => p.coords).filter(a => Array.isArray(a) && a.length === 2);
    arr = [...PTS.map(p => p.ll), ...extra];
    if (!arr.length) arr = PTS.map(p => p.ll);
  } else {
    arr = areaMode ? PTS.filter(p => p.id === 'home' || p.g === 2) : PTS.filter(p => p.g !== 2);
    arr = arr.map(p => p.ll);
  }
  if (!arr.length) return;
  mapObj.fitBounds(arr, { padding: [22, 22], maxZoom: areaMode === 'oblast' ? 8 : areaMode ? 9 : 12, animate: !reduced });
}

function invalidate() { if (mapObj) mapObj.invalidateSize({ pan: false }); }

/* ---------- Leaflet ---------- */

function buildMap() {
  if (!window.L) {
    $('map').style.display = 'none';
    const w = $('mapwarning'); w.hidden = false;
    w.textContent = 'Карта не загрузилась. Все карточки доступны в списке локаций.';
    return;
  }
  mapObj = L.map('map', { zoomControl: false, scrollWheelZoom: false, keyboard: true, attributionControl: true, dragging: !L.Browser.mobile });
  L.control.zoom({ zoomInTitle: 'Приблизить', zoomOutTitle: 'Отдалить' }).addTo(mapObj);
  tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">Участники OpenStreetMap</a>'
  }).addTo(mapObj);
  tileLayer.on('tileload', () => { tileOk = true; $('mapwarning').hidden = true; });
  tileLayer.on('tileerror', () => {
    if (!tileOk) { const w = $('mapwarning'); w.hidden = false; w.textContent = 'Подложка карты недоступна. Метки, масштаб и список локаций продолжают работать.'; }
  });

  // Зона поиска вокруг домашнего района: стиль задаёт CSS (.mk-zone), цвета берутся из токенов
  const home = byId('home');
  if (home) {
    zoneLayer = L.circle(home.ll, { radius: D.home_zone_radius_m, weight: 1, className: 'mk-zone' }).addTo(mapObj)
      .bindTooltip('Зона поиска · не граница рынка');
    zoneLayer.on('click', () => showLocation('home', { fromMap: true }));
    const zEl = zoneLayer.getElement && zoneLayer.getElement();
    if (zEl) {
      zEl.setAttribute('tabindex', '0'); zEl.setAttribute('role', 'button');
      zEl.setAttribute('aria-label', 'Зона поиска: Богдашка, домашняя зона');
      zEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showLocation('home', { fromMap: true }); } });
    }
  }

  // Маркеры: область 44×44 для касания, внутри — метка по группе
  PTS.filter(p => p.id !== 'home').forEach(p => {
    const marker = L.marker(p.ll, {
      title: p.n, keyboard: true, riseOnHover: true,
      icon: L.divIcon({ className: 'mk-pinwrap', html: `<span class="pinhit"><span class="pin ${PIN[p.g] || 'pin-city'}"></span></span>`, iconSize: [44, 44], iconAnchor: [22, 22] })
    }).addTo(mapObj).bindTooltip(p.n, { direction: 'top', offset: [0, -10] });
    marker.on('click', () => showLocation(p.id, { fromMap: true }));
    // Элемент маркера создаётся при добавлении на карту — атрибуты ставим на 'add' (и сразу, если уже добавлен)
    const label = `${p.n} — ${TYPES[p.g] || 'локация'}. Открыть карточку`;
    const a11y = () => {
      const el = marker.getElement();
      if (!el) return;
      el.setAttribute('role', 'button'); el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', label); el.setAttribute('title', p.n);
      el.setAttribute('aria-current', String(p.id === selected));
      if (!el.dataset.kb) { // Enter/Space открывают карточку; preventDefault на keydown гасит keypress, поэтому Leaflet не дублирует click
        el.dataset.kb = '1';
        el.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); showLocation(p.id, { fromMap: true }); } });
      }
    };
    marker.on('add', a11y);
    a11y();
    marks[p.id] = marker;
  });

  // Спрос по области: круги по местам из leads.json (OpenStreetMap) — размер = школы+сады («потенциал на выезд»).
  // Только данные источника, без выдуманных коэффициентов; OSM неполон — пометка в подсказке.
  const leadsPlaces = (state.DATA && state.DATA.leads && state.DATA.leads.places) || [];
  leadsPlaces.forEach(p => {
    if (!Array.isArray(p.coords) || p.coords.length !== 2) return;
    const pot = (p.school || 0) + (p.kindergarten || 0);
    if (!pot) return;
    const rad = 8 + Math.sqrt(pot) * 2.2; // масштаб радиуса от потенциала, пиксели
    const ring = L.circleMarker(p.coords, {
      radius: Math.min(rad, 26), color: '#8E8E93', weight: 1.6,
      fillColor: '#1C1C1E', fillOpacity: .28, title: p.name
    }).addTo(mapObj);
    ring.bindTooltip(`<b>${p.name}</b>: школы ${p.school || 0} + сады ${p.kindergarten || 0} → потенциал ${pot}${p.culture ? ` · ДК ${p.culture}` : ''}<br><small>по данным OpenStreetMap, возможны пропуски${p.updated_at ? ' · обновлено ' + new Date(p.updated_at).toLocaleDateString('ru-RU') : ''}</small>`, { direction: 'top' });
    ring.on('click', () => { const o = $('location'); if (o) { o.value = ''; } toast(`${p.name}: ${pot} учреждений для выезда (OSM)`); });
    marks['leads-' + p.id] = ring;
  });

  fitMode();
  markSelected();
  invalidate();
  // Пересчёт размера при любом изменении контейнера (окно, раскладка, режим); без ResizeObserver — по resize окна
  if (window.ResizeObserver) {
    let raf = 0;
    new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(invalidate); }).observe($('map'));
  } else {
    addEventListener('resize', invalidate);
  }
  addEventListener('orientationchange', () => setTimeout(invalidate, 200));
}

function markSelected() {
  Object.keys(marks).forEach(k => {
    const el = marks[k].getElement();
    const pin = el && el.querySelector('.pin');
    if (pin) pin.classList.toggle('sel', k === selected);
    if (el) el.setAttribute('aria-current', String(k === selected));
  });
}

/* ---------- Выбор сценария ---------- */

function renderScenario() {
  const box = $('mapScenario');
  const list = presets();
  if (!list.length) { box.innerHTML = ''; return; }
  box.innerHTML = `<span class="mapscen-t">Сценарий для прибыли дня</span><div class="chips">${list.map((p, i) =>
    `<button type="button" class="chip${i === scenIdx ? ' on' : ''}" data-i="${i}" aria-pressed="${i === scenIdx}">${esc(scenarioLabel(p))}</button>`).join('')}</div>`;
  box.onclick = e => {
    const b = e.target.closest('[data-i]'); if (!b) return;
    scenIdx = +b.dataset.i;
    $$('#mapScenario .chip').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); });
    showLocation(selected, { pan: false });
  };
}

/* ---------- Карточка локации ---------- */

/* Счётчик прибыли: рост от нуля до значения; при reduce-motion — сразу конечное значение */
function countUp(el, v) {
  if (reduced || !isFinite(v)) { el.textContent = signed(v); return; }
  let t0;
  const frame = t => {
    if (!t0) t0 = t;
    const k = Math.min(1, (t - t0) / 700);
    el.textContent = signed(v * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(frame); else el.textContent = signed(v);
  };
  requestAnimationFrame(frame);
}

function tile(label, value, sub, cls = '') {
  return `<div class="lt ${cls}"><small>${label}</small><b>${value}</b>${sub ? `<span class="lt-sub">${sub}</span>` : ''}</div>`;
}

/* Население/трафик: значение из данных с бейджем источника, введённое вручную, либо «нет данных» */
function metricTile(label, field, p) {
  const m = manualAll()[p.id];
  const own = m && Number.isFinite(m[field]) ? m[field] : null;
  if (own != null) return tile(label, `${fmt(own)}<span class="u"> ${field === 'population' ? 'чел.' : 'чел./день'}</span>`, `введено вручную · ${ruDate(m.date)}${safeUrl(m.url) ? ` · <a href="${esc(safeUrl(m.url))}" target="_blank" rel="noopener noreferrer">источник</a>` : ''}`);
  const v = p[field];
  if (v && Number.isFinite(v.value)) {
    const u = safeUrl(v.source_url);
    return tile(label, `${fmt(v.value)}<span class="u"> ${esc(v.unit || '')}</span>`, `${freshBadge(v)}${v.note ? ' ' + esc(v.note) : ''}${u ? ` <a href="${esc(u)}" target="_blank" rel="noopener noreferrer">источник</a>` : ''}`);
  }
  return tile(label, '<span class="muted">нет данных</span>', 'источника нет — можно ввести вручную', 'nd');
}

function showLocation(id, opts = {}) {
  const p = byId(id);
  if (!p) return;
  selected = id;
  $('location').value = id;
  const calc = scenarioCalc(p);
  const pr = presets()[scenIdx];
  const route = p.route_index != null ? routes()[p.route_index] || null : null;
  const label = pr ? scenarioLabel(pr) : '';

  // Плитки: прибыль дня (главная), затем население/трафик для области либо район/безубыточность для города
  const tiles = [];
  if (calc) {
    tiles.push(`<div class="lt profit${calc.profit < 0 ? ' neg' : ''}"><small>Прибыль дня</small><b class="pnum" data-v="${Math.round(calc.profit)}">${signed(calc.profit)}</b><span class="lt-sub">${esc(label)} · безубыточность ${calc.be} оплат</span></div>`);
  } else {
    tiles.push(tile('Прибыль дня', '<span class="muted">нет расчёта</span>', esc(p.be || 'зависит от сметы площадки'), 'profit nd'));
  }
  if (route) tiles.push(tile('Плечо', route.km ? `${fmt(route.km)}<span class="u"> км</span>` : '<span class="u">в городе</span>', `в одну сторону · ГСМ ${fmt(route.gas)} ₽`));
  if (p.g === 2) {
    tiles.push(metricTile('Население', 'population', p));
    tiles.push(metricTile('Трафик', 'traffic', p));
  } else {
    tiles.push(tile('Район', esc(p.dist || '—'), ''));
    tiles.push(tile('Аудитория', `<span class="small">${esc(p.aud || 'нет данных')}</span>`, ''));
    const mp = manualAll()[p.id];
    if (mp && (Number.isFinite(mp.population) || Number.isFinite(mp.traffic))) {
      if (Number.isFinite(mp.population)) tiles.push(metricTile('Население', 'population', p));
      if (Number.isFinite(mp.traffic)) tiles.push(metricTile('Трафик', 'traffic', p));
    }
  }

  // Три шага захода; плейсхолдеры {be}/{scenario} подставляются из расчёта, шаг без расчёта пропускается
  const steps = (p.steps || []).map(s => {
    if (/\{(be|scenario)\}/.test(s)) {
      if (!calc) return null;
      return s.replace('{be}', calc.be).replace('{scenario}', label);
    }
    return s;
  }).filter(Boolean);

  const mm = manualAll()[p.id] || {};
  const link = safeUrl(p.url);
  $('locDetails').innerHTML = `<div class="loc">
    <div class="eyebrow" style="margin-top:6px"><span class="dash"></span>${TYPES[p.g] || 'Локация'}</div>
    <h3>${esc(p.n)}</h3><p class="loc-addr">${ic('map-pin')}<span>${esc(p.address || '')}</span></p>
    <div class="loc-tiles">${tiles.join('')}</div>
    <details class="mk-more"><summary>Ввести население или трафик вручную</summary>
      <form class="mform" id="mapManual" novalidate>
        <div class="mrow">
          <label class="mf"><span>Население, чел.</span><input name="population" type="number" inputmode="numeric" min="0" step="1" value="${Number.isFinite(mm.population) ? mm.population : ''}"></label>
          <label class="mf"><span>Трафик, чел./день</span><input name="traffic" type="number" inputmode="numeric" min="0" step="1" value="${Number.isFinite(mm.traffic) ? mm.traffic : ''}"></label>
        </div>
        <label class="mf"><span>Ссылка на источник</span><input name="url" type="url" inputmode="url" placeholder="https://…" value="${esc(mm.url || '')}"></label>
        <p class="ferr" role="alert" hidden></p>
        <div class="toolrow"><button type="submit" class="btn small primary">Сохранить</button>${Object.keys(mm).length ? '<button type="button" class="btn small secondary" data-clear>Убрать</button>' : ''}</div>
      </form>
    </details>
    ${steps.length ? `<strong class="loc-h">Как начать разговор</strong><ol class="loc-steps">${steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    ${p.rivals ? `<details class="mk-more"><summary>Альтернативы и конкуренты</summary><p>${esc(p.rivals)}</p></details>` : ''}
    <div class="loc-src">${freshBadge(p.src)}${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Карточка или первоисточник ${ic('external-link')}</a>` : '<span class="tiny">Источник: гастрольная модель из бизнес-плана.</span>'}</div>
    ${p.be && String(p.be).includes('¹') ? `<p class="hint">${esc(D.footnote || '')}</p>` : ''}
  </div>`;
  icons();
  const num = $('locDetails').querySelector('.pnum');
  if (num) countUp(num, +num.dataset.v);
  bindManual(p);

  markSelected();
  if (mapObj && opts.pan) mapObj.setView(p.ll, p.g === 2 ? 9 : 15, { animate: !reduced });
  // На узком экране карточка ниже карты: после клика по метке показываем её
  if (opts.fromMap && innerWidth < 900) $('locDetails').scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
}

/* Ручной ввод населения/трафика для выбранной локации */
function bindManual(p) {
  const f = $('mapManual'); if (!f) return;
  f.addEventListener('submit', e => {
    e.preventDefault();
    const err = f.querySelector('.ferr');
    const fail = msg => { err.textContent = msg; err.hidden = false; };
    const pop = f.population.value === '' ? null : Number(f.population.value);
    const tr = f.traffic.value === '' ? null : Number(f.traffic.value);
    const url = f.url.value.trim();
    if (pop == null && tr == null) return fail('Введите хотя бы одно значение.');
    if ([pop, tr].some(v => v != null && (!Number.isFinite(v) || v < 0))) return fail('Значения — числа, ноль или больше.');
    if (url && !safeUrl(url)) return fail('Ссылка должна начинаться с http:// или https://');
    const all = manualAll();
    all[p.id] = { ...(pop != null ? { population: Math.round(pop) } : {}), ...(tr != null ? { traffic: Math.round(tr) } : {}), date: today(), url: url || null };
    if (!store.set(MANUAL_KEY, all)) return fail('Браузер не дал сохранить данные (приватный режим?).');
    toast('Значения сохранены в этом браузере');
    showLocation(p.id, { pan: false });
  });
  const clr = f.querySelector('[data-clear]');
  if (clr) clr.onclick = () => { const all = manualAll(); delete all[p.id]; store.set(MANUAL_KEY, all); toast('Ручные значения убраны'); showLocation(p.id, { pan: false }); };
}

/* ---------- Публичный API ---------- */

export function setMapConfig(c) { CFG_REF = c; }
export function getMapObj() { return mapObj; }
