/* tap-hints.js — подсказка «пальчик / нажмите» на главных кнопках.

   Как работает:
   • Кнопка доскроллена до зоны видимости → через ~0,5 с «палец» мягко показывает жест тапа (два касания, ~2,4 с);
     пока кнопка на экране, жест повторяется каждые 8–12 секунд (случайно, чтобы не было «метронома»).
   • У каждой важной кнопки свой палец. В группах однотипных кнопок (калькуляторы, вкладки, фильтры, готовые кейсы)
     палец обходит кнопки по очереди — иначе на экране было бы 9 пальцев сразу.
   • Нажала кнопку — для неё (для группы — для всей группы) подсказка больше не показывается (запоминается в localStorage).
   • Палец рисуется отдельным слоем поверх страницы (position:fixed, двигается только transform/opacity):
     его не обрезают контейнеры с прокруткой (вкладки, чипы), и он не сдвигает вёрстку.
   • prefers-reduced-motion — подсказка не показывается. Пока открыта заставка, вкладка скрыта или у кнопки disabled — пауза.
   • Слой aria-hidden и pointer-events:none: клики и скринридеры его не замечают. */

const SIZE = 56;                       // размер руки, px (было 15)
const TIP_X = 0.33, TIP_Y = 0.07;      // где на иконке кончик указательного пальца (доля размера)
const PLAY_MS = 2400;                  // длительность жеста (совпадает с @keyframes tftap)
const REPEAT_MIN = 8000, REPEAT_MAX = 12000;   // пауза между показами на одной кнопке
const FIRST_DELAY = 500;               // пауза после появления кнопки на экране до первого жеста
const DONE_KEY = 'yulia.v2.tapDone';

/* Что подсвечиваем. each — у каждой найденной кнопки свой палец; rotate — один палец обходит группу по очереди.
   skip — состояния «уже выбрано/открыто», на которые подсказывать бессмысленно. */
const SPECS = [
  { sel: '.hero-cta .btn', mode: 'each' },                         // Обзор: «Открыть калькуляторы», «План на 30 дней»
  { sel: '.pc-card', mode: 'rotate' },                              // Готовые кейсы «Рассчитай за 5 секунд»
  { sel: '#calcnav .mode', mode: 'rotate' },                        // Переключатель из 9 калькуляторов
  { sel: '#calcpanels > div:not([hidden]) [data-act=save]', mode: 'each' },// «Сохранить сценарий» активного калькулятора
  { sel: '#marketFilters .chip', mode: 'rotate' },                  // Навигатор рынка: фильтры
  { sel: '.rv-more', mode: 'each' },                                // «Показать ещё N»
  { sel: '#areaMode', mode: 'each' },                               // Карта: режим «Города области»
  { sel: '#guideTabs .tab', mode: 'rotate' },                       // Справочник: вкладки
  { sel: '#liveDataBox .btn', mode: 'each' },                       // «Обновить данные»
  { sel: '#notesCard [data-act=add]', mode: 'each' }                // «＋ Заметка»
];

const HAND = '<svg viewBox="0 0 24 24" width="' + SIZE + '" height="' + SIZE + '" fill="none" stroke="var(--tf-stroke,#1c1c1e)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path fill="var(--tf-fill,#fff)" d="M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10"/>' +
  '<path fill="var(--tf-fill,#fff)" d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>' +
  '<path d="M22 14a8 8 0 0 1-8 8"/><path d="M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1"/></svg>';

const units = [];            // {key, spec, items:Set<Element>, nextAt, cursor, done, el?}
const visible = new Set();   // кнопки, которые сейчас видны на экране
let io = null, started = false, timer = 0, playing = 0;
let loaded = null;           // Set ключей «уже нажимала»

const rand = (a, b) => a + Math.random() * (b - a);
const motionOK = () => { try { return !matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

function readDone() {
  if (loaded) return loaded;
  try { loaded = new Set(JSON.parse(localStorage.getItem(DONE_KEY) || '[]')); } catch (e) { loaded = new Set(); }
  return loaded;
}
function writeDone(key) {
  const s = readDone(); s.add(key);
  try { localStorage.setItem(DONE_KEY, JSON.stringify([...s].slice(-60))); } catch (e) { /* хранилище недоступно */ }
}

function veilOpen() {
  const v = document.getElementById('veil');
  if (!document.documentElement.classList.contains('veil-seen')) return true;
  return !!v && !v.hidden && !v.classList.contains('gone') && getComputedStyle(v).display !== 'none';
}

/* Кнопка годится для подсказки: на экране, доступна, не в «выбранном» состоянии */
function usable(el) {
  if (!el.isConnected || !el.offsetParent || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
  if (el.closest('[inert],[hidden]')) return false;
  if (el.classList.contains('on') || el.getAttribute('aria-selected') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.getAttribute('aria-expanded') === 'true') return false;
  return true;
}

/* Один жест: слой поверх страницы, привязанный к кнопке на время показа */
function play(unit, host) {
  playing++;
  const layer = document.createElement('div');
  layer.className = 'tap-finger';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = '<span class="tf-hand">' + HAND + '</span>';
  document.body.appendChild(layer);
  const t0 = performance.now();
  const stop = () => { cancelAnimationFrame(raf); layer.remove(); playing = Math.max(0, playing - 1); unit.busy = false; };
  let raf = 0;
  unit.busy = true;
  const frame = now => {
    if (!host.isConnected || now - t0 > PLAY_MS + 80 || document.hidden) { stop(); return; }
    const r = host.getBoundingClientRect();
    // кнопка уехала с экрана — палец убираем, не оставляем висеть
    if (r.bottom < 0 || r.top > innerHeight || !r.width) { stop(); return; }
    let px = r.left + Math.max(26, r.width * 0.72);
    px = Math.min(px, r.right - 10);
    px = Math.max(8 + SIZE * TIP_X, Math.min(innerWidth - 8 - SIZE * (1 - TIP_X), px));
    const py = r.top + r.height * 0.68;
    layer.style.transform = 'translate3d(' + (px - SIZE * TIP_X).toFixed(1) + 'px,' + (py - SIZE * TIP_Y).toFixed(1) + 'px,0)';
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}

/* Следующая кнопка группы для показа: идём по кругу среди видимых и пригодных */
function pickTarget(unit) {
  const list = [...unit.items].filter(el => visible.has(el) && usable(el));
  if (!list.length) return null;
  if (unit.spec.mode === 'each') return list[0];
  unit.cursor = (unit.cursor + 1) % list.length;
  return list[unit.cursor];
}

function tick() {
  timer = setTimeout(tick, 700);
  if (document.hidden || veilOpen() || !motionOK()) return;
  const now = performance.now();
  for (const unit of units) {
    if (unit.done || unit.busy) continue;
    const host = pickTarget(unit);
    if (!host) { unit.nextAt = 0; continue; }          // ничего не видно — таймер сбрасывается
    if (!unit.nextAt) { unit.nextAt = now + FIRST_DELAY + playing * 900; continue; }
    if (now < unit.nextAt || playing >= 2) continue;    // не больше двух пальцев на экране одновременно
    play(unit, host);
    unit.nextAt = now + PLAY_MS + rand(REPEAT_MIN, REPEAT_MAX);
  }
}

function unitFor(spec, el) {
  const key = spec.mode === 'each' ? spec.sel + '|' + (el.textContent || '').trim().slice(0, 24) : spec.sel;
  let u = units.find(x => x.key === key);
  if (!u) {
    u = { key, spec, items: new Set(), nextAt: 0, cursor: -1, done: readDone().has(key), busy: false };
    units.push(u);
  }
  return u;
}

/* Подцепляет новые кнопки (вызывается из initUI при каждой перестройке DOM) */
export function bindTapHints() {
  if (!window.IntersectionObserver) return;
  if (!io) io = new IntersectionObserver(list => list.forEach(x => { if (x.isIntersecting) visible.add(x.target); else visible.delete(x.target); }), { threshold: 0.6 });
  for (const spec of SPECS) {
    document.querySelectorAll(spec.sel).forEach(el => {
      if (el._tapBound) return;
      el._tapBound = true;
      unitFor(spec, el).items.add(el);
      io.observe(el);
    });
  }
  if (!started) {
    started = true;
    timer = setTimeout(tick, 700);
    // нажала кнопку с подсказкой — для неё подсказка больше не нужна
    document.addEventListener('click', e => {
      const t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      for (const u of units) {
        if (u.done) continue;
        for (const el of u.items) {
          if (el === t || el.contains(t)) { u.done = true; writeDone(u.key); return; }
        }
      }
    }, true);
  }
}
