/* tap-hints.js — подсказка «пальчик»: ОДИН палец обходит все нажимаемые элементы раздела.

   Модель «обход» (sweep):
   • Когда Юля заходит в раздел (прокрутила, раскрыла вкладку, появились новые кнопки), палец пробегает по ВСЕМ нажимаемым
     элементам, которые сейчас целиком в окне: сверху вниз, слева направо; на каждом — одно короткое касание с волной.
     Где пальца не было — это не кнопка. Не больше 14 целей за обход; остальные получат обход позже, при прокрутке.
   • Всегда ровно один палец (один слой на всю страницу): между кнопками он плавно перелетает, в конце исчезает.
   • Прокрутка/ресайз/нажатие прерывают обход; продолжается после ~600 мс покоя. Повтор — через 8–12 с покоя,
     пока раздел на экране и кнопки не нажаты. Нажатая кнопка выпадает из обхода навсегда (localStorage, до 200 записей).
   • Не запускается: пока открыта заставка, вкладка скрыта, фокус в поле ввода, открыт диалог или плашка новостей,
     при prefers-reduced-motion.
   • Слой fixed + pointer-events:none + aria-hidden; двигается только transform/opacity (CSS-переход, rAF не нужен).
   • bindTapHints() вызывается при каждой перестройке DOM — она лишь помечает «грязно»; пересчёт идёт по таймеру покоя.

   Чистая логика (без DOM) экспортирована отдельно и покрыта tests/tap-hints.test.mjs. */

/* ---------- Параметры ---------- */
export const SIZE = 56;                          // размер руки, px
export const TIP_X = 0.33, TIP_Y = 0.07;         // где на иконке кончик указательного пальца (доля размера)
export const MAX_TARGETS = 14;                   // целей за один обход
export const FLY_MS = 450;                       // перелёт между кнопками (совпадает с transition в CSS)
export const TAP_MS = 520;                       // одно касание (совпадает с @keyframes tftap)
export const REPEAT_MIN = 8000, REPEAT_MAX = 12000;   // пауза между обходами
export const REPEAT_MORE_MS = 1800;                    // пауза, если в окне остались ещё не обойдённые цели (лимит обхода)
export const CALM_MOTION_MS = 600;               // покой после прокрутки перед (пере)запуском обхода
export const CALM_DOM_MS = 300;                  // покой после перестройки DOM перед пересчётом
export const RESCAN_MIN_MS = 1500;               // не пересчитывать цели чаще
export const FRESH_MS = 6000;                    // «вход в раздел» повторяет обход, если цель показана давнее этого
export const DONE_MAX = 200;                     // записей в localStorage
const DONE_KEY = 'yulia.v2.tapDone';
const DEBUG_KEY = 'yulia.v2.tapDebug';

/* ---------- Чистая логика ---------- */

/* Из чего состоит «кнопкоподобный» класс и что точно не обходим */
const BTN_CLASSES = ['btn', 'chip', 'tab', 'mode', 'mmode', 'pc-card'];
const EXCLUDE_SEL = '#veil,#topbar,#mobnav,.skip,.newsflash,.leaflet-container,.tap-finger,dialog,[inert],[hidden],[aria-hidden="true"]';
const TEXT_SEL = 'p,li,td,th,dd,dt,small,figcaption,blockquote,.src,.source,.note,.muted,.hint';

/* Ссылка-строка: текст ссылки — почти весь текст её контейнера (карточка новости, пункт списка), а не слово внутри абзаца */
function isLinkRow(el) {
  const par = el.parentElement;
  if (!par) return false;
  const own = String(el.textContent || '').trim().length;
  const all = String(par.textContent || '').trim().length;
  return own > 0 && own >= all * 0.85;
}

/* Нажимаемый ли элемент основного контента (без проверки геометрии — её делает DOM-слой) */
export function isSweepTarget(el) {
  if (!el || !el.isConnected) return false;
  const tag = String(el.tagName || '').toLowerCase();
  const cls = c => !!(el.classList && el.classList.contains(c));
  const attr = n => (el.getAttribute ? el.getAttribute(n) : null);
  // служебное, закрытое, отключённое
  if (el.disabled === true || attr('aria-disabled') === 'true') return false;
  if (el.closest && el.closest(EXCLUDE_SEL)) return false;
  if (el.closest && !el.closest('#main')) return false;          // только основной контент
  const btnLike = BTN_CLASSES.some(cls);
  const role = attr('role');
  let ok = false;
  if (tag === 'button' || tag === 'summary') ok = true;
  else if (role === 'tab' || role === 'button') ok = true;
  else if (cls('mode') || cls('tab') || cls('mmode') || cls('pc-card')) ok = true;
  else if (tag === 'label') {                                          // label-кнопки (импорт файла) и строки-чекбоксы чек-листа
    ok = cls('btn') || cls('chip') || !!(el.querySelector && el.querySelector('input[type=checkbox],input[type=radio]'));
  }
  else if (tag === 'a') {
    if (attr('href') === null || attr('href') === undefined) return false;
    // inline-ссылка внутри текста («источник» мелким шрифтом, без своего класса) — не кнопка;
    // ссылка-компонент со своим классом (td-link, td-news) и ссылка-строка списка (весь текст — ссылка) — нажимаемые
    const classed = !!(el.classList && el.classList.length > 0);
    if (!btnLike && !classed && el.closest && el.closest(TEXT_SEL) && !isLinkRow(el)) return false;
    ok = true;
  }
  // span.chip и прочие метки — не нажимаются
  return ok;
}

/* Стабильный ключ «нажимала»: путь + текст (числа в тексте обезличены, чтобы счётчики не меняли ключ) */
export function stableKey(path, text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().replace(/\d+/g, '#').slice(0, 30);
  return String(path || '') + '|' + t;
}

/* Добавляет ключ в список «нажимала»: без дублей, в хвосте остаются последние max записей */
export function pushDone(list, key, max = DONE_MAX) {
  const out = (Array.isArray(list) ? list : []).filter(k => k !== key);
  out.push(key);
  return out.slice(-max);
}

/* Порядок обхода: «строки» сверху вниз, внутри строки — слева направо. items: {top,left,width,height,...} */
export function sweepOrder(items) {
  const arr = [...items].sort((a, b) => a.top - b.top || a.left - b.left);
  const rows = [];
  for (const it of arr) {
    const cy = it.top + it.height / 2;
    const row = rows.find(r => Math.abs(r.cy - cy) <= Math.min(r.h, it.height) * 0.5);
    if (row) row.items.push(it); else rows.push({ cy, h: it.height, items: [it] });
  }
  rows.sort((a, b) => a.cy - b.cy);
  return rows.flatMap(r => r.items.sort((a, b) => a.left - b.left));
}

/* Вложенные цели: если одна нажимаемая внутри другой — оставляем внешнюю (палец один, касание одно) */
export function dedupeNested(items, contains) {
  return items.filter(b => !items.some(a => a !== b && contains(a, b)));
}

/* Не больше max целей за обход (первые по порядку) */
export function limitTargets(list, max = MAX_TARGETS) { return list.slice(0, max); }

/* Если целей больше лимита — сначала те, что ещё не показывались (остальные не застрянут навсегда), порядок обхода сохраняется.
   ordered — цели в порядке обхода [{key}], swept — Map ключ→время */
export function pickTargets(ordered, swept, max = MAX_TARGETS) {
  if (ordered.length <= max) return ordered;
  const fresh = ordered.filter(t => !swept.has(t.key));
  const old = ordered.filter(t => swept.has(t.key));
  const chosen = new Set(fresh.concat(old).slice(0, max));
  return ordered.filter(t => chosen.has(t));
}

/* Целиком ли прямоугольник в безопасной области окна (под шапкой, не у самых краёв) */
export function inSafeArea(r, safe) {
  return r.left >= safe.left && r.right <= safe.right && r.top >= safe.top && r.bottom <= safe.bottom;
}

/* Видимая часть прямоугольника внутри безопасной области (пересечение) или null, если пересечения нет */
export function clipRect(r, safe) {
  const left = Math.max(r.left, safe.left), right = Math.min(r.right, safe.right);
  const top = Math.max(r.top, safe.top), bottom = Math.min(r.bottom, safe.bottom);
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/* Цель «достаточно видна»: по вертикали целиком, по горизонтали ≥ minShare ширины (вкладки/чипы в ряду с прокруткой по краю экрана).
   Возвращает видимую часть или null */
export function visiblePart(r, safe, minShare = 0.6) {
  const v = clipRect(r, safe);
  if (!v || r.width <= 0 || r.height <= 0) return null;
  if (v.height < r.height - 0.5) return null;                  // по вертикали — только целиком
  return v.width >= r.width * minShare ? v : null;
}

/* Точка касания и позиция слоя пальца. rect — цель; anchor — необязательный прямоугольник «подписи действия»
   (у больших карточек). Касание — у правой нижней трети; палец целиком внутри окна.
   inside=false → кончик пришлось бы вынести за кнопку (она у самого края) — такую цель пропускаем до прокрутки. */
export function fingerPoint(rect, o = {}) {
  const size = o.size || SIZE, tx = o.tipX == null ? TIP_X : o.tipX, ty = o.tipY == null ? TIP_Y : o.tipY;
  const vw = o.vw || 360, vh = o.vh || 640, m = o.margin == null ? 6 : o.margin, safeTop = o.safeTop || 0;
  const w = rect.width, h = rect.height;
  const left = rect.left, top = rect.top, right = left + w, bottom = top + h;
  let x, y;
  if (o.anchor) {                                    // подпись действия большой карточки
    x = o.anchor.left + o.anchor.width / 2;
    y = o.anchor.top + o.anchor.height / 2;
  } else {
    if (w <= 64) x = left + w / 2;                   // маленькая — по центру
    else if (w > 360) x = right - Math.min(56, w * 0.2);   // широкая — у правого края
    else x = left + w * 0.72;                        // обычная — правая треть
    x = Math.min(x, right - 10);
    y = h > 100 ? bottom - Math.min(34, h * 0.3) : top + h * 0.68;
  }
  // палец целиком в окне
  const minX = m + size * tx, maxX = vw - m - size * (1 - tx);
  const minY = Math.max(m, safeTop) + size * ty, maxY = vh - m - size * (1 - ty);
  const cx = Math.max(minX, Math.min(maxX, x));
  const cy = Math.max(minY, Math.min(maxY, y));
  const inside = cx >= left && cx <= right && cy >= top + 2 && cy <= bottom - 2;
  return { x: cx, y: cy, tx: cx - size * tx, ty: cy - size * ty, inside };
}

/* Пауза до следующего повтора обхода (r — число [0,1), подставляется для тестов) */
export function nextRepeatDelay(r) {
  const v = typeof r === 'number' ? r : Math.random();
  return Math.round(REPEAT_MIN + v * (REPEAT_MAX - REPEAT_MIN));
}

/* Нужно ли запускать обход сейчас.
   targets — цели в окне [{key}], swept — Map ключ→время последнего показа, entered — вошла в новый раздел */
export function shouldSweep({ now, nextRepeatAt, targets, swept, entered, freshMs = FRESH_MS }) {
  if (!targets || !targets.length) return false;
  if (targets.some(t => !swept.has(t.key))) return true;               // есть ни разу не показанные
  if (now >= nextRepeatAt) return true;                                // пришло время повтора
  if (entered && targets.some(t => now - swept.get(t.key) > freshMs)) return true;   // вход в раздел
  return false;
}

/* Мешает ли что-то показывать палец (флаги собирает DOM-слой) */
export function isBlocked(f) {
  return !!(f.hidden || f.veil || f.reduced || f.typing || f.dialog || f.news || f.pointerDown);
}

/* Спокоен ли экран: с последнего движения прошло достаточно времени */
export function isCalm(now, lastMotion, lastDom, dirty) {
  if (now - lastMotion < CALM_MOTION_MS) return false;
  return !(dirty && now - lastDom < CALM_DOM_MS);
}

/* ---------- DOM-слой ---------- */

const CAND_SEL = '#main button,#main a[href],#main summary,#main [role=tab],#main [role=button],#main .mode,#main .pc-card,#main .tab,#main .mmode,#main label';
const STATE_CLASSES = new Set(['on', 'active', 'expanded', 'selected', 'open', 'is-open', 'done', 'checked', 'show', 'cv-vis', 'is-active']);
const HAND = '<svg viewBox="0 0 24 24" width="' + SIZE + '" height="' + SIZE + '" fill="none" stroke="var(--tf-stroke,#1c1c1e)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path fill="var(--tf-fill,#fff)" d="M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10"/>' +
  '<path fill="var(--tf-fill,#fff)" d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>' +
  '<path d="M22 14a8 8 0 0 1-8 8"/><path d="M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1"/></svg>';

let started = false;
let layer = null, hand = null;           // единственный слой с пальцем
let sweep = null;                        // текущий обход {list,i,timer}
let doneSet = null;                      // Set ключей «нажимала»
let cands = null, candsStale = true;     // кэш кандидатов (пересобирается при «грязном» DOM)
let dirty = true, dirtyAt = 0, lastScan = 0;
let lastMotion = 0, rescan = true, pointerDown = false, entered = false;
let nextRepeatAt = 0, timer = 0;
const swept = new Map();                 // ключ → время последнего касания (в памяти страницы)
const inView = new Set();                // разделы, которые сейчас «заметно видны»
const observed = new WeakSet();
let io = null;

const nowMs = () => performance.now();
const motionOK = () => { try { return !matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
const debugOn = () => { try { return localStorage.getItem(DEBUG_KEY) === '1'; } catch (e) { return false; } };

function readDone() {
  if (doneSet) return doneSet;
  try { doneSet = new Set(JSON.parse(localStorage.getItem(DONE_KEY) || '[]')); } catch (e) { doneSet = new Set(); }
  return doneSet;
}
function writeDone(key) {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(DONE_KEY) || '[]'); } catch (e) { list = []; }
  list = pushDone(list, key, DONE_MAX);
  doneSet = new Set(list);
  try { localStorage.setItem(DONE_KEY, JSON.stringify(list)); } catch (e) { /* хранилище недоступно — живёт в памяти */ }
}

/* Ключ элемента: ближайший предок с id + тег.класс[data-act] + текст/aria-label */
function keyOf(el) {
  let host = el.parentElement;
  while (host && !host.id) host = host.parentElement;
  const cls = [...el.classList].filter(c => !STATE_CLASSES.has(c)).slice(0, 2).join('.');
  const act = el.getAttribute('data-act');
  const path = (host ? '#' + host.id : '') + '>' + el.tagName.toLowerCase() + (cls ? '.' + cls : '') + (act ? '[' + act + ']' : '');
  const text = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '');
  return stableKey(path, el.classList.contains('pc-card') ? ((el.querySelector('h3') || el).textContent || '') : text);
}

function veilOpen() {
  const v = document.getElementById('veil');
  if (!document.documentElement.classList.contains('veil-seen')) return true;
  return !!v && !v.hidden && !v.classList.contains('gone') && getComputedStyle(v).display !== 'none';
}

/* Собирает флаги «мешает ли» */
function blockFlags() {
  const a = document.activeElement;
  const typing = !!a && a !== document.body && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable) &&
    !(a.tagName === 'INPUT' && /^(button|checkbox|radio|submit|reset|file|range)$/i.test(a.type));
  return {
    hidden: document.hidden, veil: veilOpen(), reduced: !motionOK(), typing, pointerDown,
    dialog: !!document.querySelector('dialog[open],[role=dialog]:not(#veil):not([hidden]),[aria-modal="true"]:not(#veil):not([hidden])'),
    news: !!document.querySelector('.newsflash.show:not(.hiding)')
  };
}

/* Безопасная область: под липкой шапкой, без самых краёв */
function safeArea() {
  const top = document.getElementById('topbar');
  let t = 0;
  if (top) { const r = top.getBoundingClientRect(); if (r.bottom > 0 && r.top <= 1) t = r.bottom; }
  return { top: t + 4, bottom: innerHeight - 4, left: 2, right: innerWidth - 2 };
}

/* Якорь точки касания: у больших карточек — подпись действия (стрелка) */
function anchorOf(el) {
  if (!el.classList.contains('pc-card')) return null;
  const a = el.querySelector('.pc-arrow');
  if (!a) return null;
  const r = a.getBoundingClientRect();
  return r.width ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
}

/* Точка касания цели или null: цель видна (вертикально целиком, по горизонтали ≥60%), не перекрыта,
   кончик пальца попадает именно на неё. Прямоугольник читается один раз на вызов */
function targetPoint(el, safe, r) {
  const rect = r || el.getBoundingClientRect();
  let v = visiblePart(rect, safe);
  if (!v) return null;
  // цель в контейнере с прокруткой (полоса вкладок/чипов): видна только часть внутри контейнера
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    if (p.scrollWidth <= p.clientWidth + 1 && p.scrollHeight <= p.clientHeight + 1) continue;
    const cs = getComputedStyle(p);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const pr = p.getBoundingClientRect();
    v = clipRect(v, { left: pr.left, right: pr.right, top: pr.top, bottom: pr.bottom });
    if (!v || v.width < rect.width * 0.6 || v.height < rect.height - 0.5) return null;
  }
  const pt = fingerPoint(v, { vw: innerWidth, vh: innerHeight, safeTop: safe.top, anchor: anchorOf(el) });
  if (!pt.inside) return null;
  const hit = document.elementFromPoint(pt.x, pt.y);              // не перекрыта шапкой/списком/плашкой, и кончик — на цели
  return hit && (hit === el || el.contains(hit)) ? pt : null;
}

/* Собирает цели, которые сейчас в окне (по вертикали целиком). Прямоугольники читаются один раз на цель */
function collect() {
  if (candsStale || !cands) { cands = [...document.querySelectorAll(CAND_SEL)]; candsStale = false; }
  const safe = safeArea();
  const out = [];
  for (const el of cands) {
    if (!el.isConnected) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10 || !visiblePart(r, safe)) continue;      // дёшево отсекаем до дорогих проверок
    if (!isSweepTarget(el)) continue;
    if (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true })) continue;
    const key = keyOf(el);
    if (readDone().has(key)) continue;                                           // уже нажимала — выпала из обхода
    if (!targetPoint(el, safe, r)) continue;
    out.push({ el, key, left: r.left, top: r.top, width: r.width, height: r.height });
  }
  return out;
}

/* ---------- Палец ---------- */

function ensureLayer() {
  if (layer && layer.isConnected) return;
  layer = document.createElement('div');
  layer.className = 'tap-finger';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = '<span class="tf-hand">' + HAND + '</span>';
  hand = layer.firstChild;
  document.body.appendChild(layer);
}

function place(pt, snap) {
  if (snap) layer.style.transition = 'none';
  layer.style.transform = 'translate3d(' + pt.tx.toFixed(1) + 'px,' + pt.ty.toFixed(1) + 'px,0)';
  if (snap) { void layer.offsetWidth; layer.style.transition = ''; }
}

function pointFor(t) {
  const el = t.el;
  return el.isConnected ? targetPoint(el, safeArea()) : null;
}

function endSweep() {
  if (!sweep) return;
  clearTimeout(sweep.timer);
  sweep = null;
  if (layer) layer.classList.remove('on');
  if (hand) hand.classList.remove('tap');
}

function finishSweep() {
  const more = sweep && sweep.more;
  endSweep();
  /* целей в окне больше лимита — следующий обход почти сразу, чтобы хвост не ждал 8–12 с */
  nextRepeatAt = nowMs() + (more ? REPEAT_MORE_MS : nextRepeatDelay());
}

function abortSweep() { endSweep(); rescan = true; }

function step() {
  const s = sweep;
  if (!s) return;
  if (s.i >= s.list.length) { finishSweep(); return; }
  const t = s.list[s.i];
  const pt = pointFor(t);
  if (!pt) { s.i++; step(); return; }                       // цель ушла/перекрыта — следующая
  if (!s.shown) {                                           // первый шаг: палец «вырастает» чуть ниже цели
    place({ tx: pt.tx, ty: pt.ty + 26 }, true);
    layer.classList.add('on');
    s.shown = true;
  }
  place(pt, false);                                         // плавный перелёт (CSS transition transform)
  s.timer = setTimeout(() => {
    if (sweep !== s) return;
    if (!pointFor(t)) { s.i++; step(); return; }
    hand.classList.remove('tap'); void hand.offsetWidth; hand.classList.add('tap');   // одно касание с волной
    swept.set(t.key, nowMs());
    if (debugOn()) (window.__tapSweepLog = window.__tapSweepLog || []).push({ at: Math.round(nowMs()), key: t.key, tag: t.el.tagName.toLowerCase(), cls: t.el.className, text: (t.el.textContent || '').trim().slice(0, 30) });
    s.timer = setTimeout(() => { if (sweep === s) { s.i++; step(); } }, TAP_MS);
  }, FLY_MS + 30);
}

function startSweep(targets) {
  const dedup = dedupeNested(targets, (a, b) => a.el.contains(b.el));
  const list = pickTargets(sweepOrder(dedup), swept, MAX_TARGETS);
  if (!list.length) return;
  ensureLayer();
  sweep = { list, i: 0, timer: 0, shown: false, more: dedup.length > list.length };
  if (debugOn()) (window.__tapSweepLog = window.__tapSweepLog || []).push({ at: Math.round(nowMs()), start: list.length, total: targets.length });
  step();
}

/* ---------- Планировщик ---------- */

function observeSections() {
  if (!window.IntersectionObserver) return;
  if (!io) {
    io = new IntersectionObserver(list => {
      for (const x of list) {
        const big = x.isIntersecting && (x.intersectionRatio >= 0.35 || x.intersectionRect.height >= innerHeight * 0.35);
        if (big) { if (!inView.has(x.target)) { inView.add(x.target); entered = true; } } else inView.delete(x.target);
      }
    }, { threshold: [0, 0.15, 0.35, 0.6] });
  }
  document.querySelectorAll('#main > section,#main section.section').forEach(s => { if (!observed.has(s)) { observed.add(s); io.observe(s); } });
}

function tick() {
  timer = setTimeout(tick, 300);
  const now = nowMs();
  const blocked = isBlocked(blockFlags());
  if (blocked) { lastMotion = now; if (sweep) abortSweep(); return; }     // мешает — ждём покоя после снятия блокировки
  if (sweep) return;
  if (!isCalm(now, lastMotion, dirtyAt, dirty)) return;
  const due = now >= nextRepeatAt;
  const want = rescan || entered || due || (dirty && now - lastScan >= RESCAN_MIN_MS);
  if (!want) return;
  if (dirty) { candsStale = true; observeSections(); }
  dirty = false; rescan = false; lastScan = now;
  const targets = collect();
  const go = shouldSweep({ now, nextRepeatAt, targets, swept, entered });
  entered = false;
  if (go) startSweep(targets);
  else if (due) nextRepeatAt = now + nextRepeatDelay();
}

/* Движение страницы (прокрутка, колесо, касание, ресайз) прерывает обход */
function onMotion() {
  lastMotion = nowMs();
  rescan = true;
  if (sweep) abortSweep();
}

/* Нажала кнопку — она больше не показывается; обход прерывается и начнётся заново позже */
function onClick(e) {
  const t = e.target && e.target.closest ? e.target.closest(CAND_SEL) : null;
  if (t && isSweepTarget(t)) writeDone(keyOf(t));
  if (sweep) endSweep();
  nextRepeatAt = nowMs() + 3000 + Math.random() * 2000;
  dirty = true; dirtyAt = nowMs(); rescan = true; lastMotion = nowMs();
}

/* Точка входа: помечает DOM «грязным» (дёшево), первый вызов запускает планировщик */
export function bindTapHints() {
  dirty = true;
  dirtyAt = nowMs();
  if (started) return;
  started = true;
  readDone();
  timer = setTimeout(tick, 300);
  window.addEventListener('scroll', onMotion, { passive: true, capture: true });
  window.addEventListener('wheel', onMotion, { passive: true });
  window.addEventListener('touchmove', onMotion, { passive: true });
  window.addEventListener('resize', onMotion, { passive: true });
  window.addEventListener('pointerdown', () => { pointerDown = true; if (sweep) abortSweep(); }, { passive: true, capture: true });
  const up = () => { pointerDown = false; lastMotion = nowMs(); };
  window.addEventListener('pointerup', up, { passive: true, capture: true });
  window.addEventListener('pointercancel', up, { passive: true, capture: true });
  document.addEventListener('click', onClick, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden && sweep) abortSweep(); });
}
