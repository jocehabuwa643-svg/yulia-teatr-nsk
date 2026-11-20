/* helpers.js — форматирование и DOM-хелперы без бизнес-логики */
import { ICON_DATA } from './icon-data.js';
export const $ = id => document.getElementById(id);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const fmt = v => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(v)).replace(/-/g, '−');
export const rub = v => fmt(v) + ' ₽';
export const signed = v => (Math.round(v) > 0 ? '+' : '') + rub(v);
export const pct = v => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(v) + '%';
export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const ic = n => `<i data-lucide="${n}" aria-hidden="true"></i>`;

/* ---------- Ленивая подгрузка внешних библиотек (Leaflet, Chart.js, Lucide) ----------
   Ничто из этого не блокирует первую отрисовку: скрипты вставляются динамически (async),
   версии зафиксированы. При сбое CDN промис отклоняется, а приложение работает дальше (иконки декоративны). */
const LIBS = {
  leafletCss: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  leafletJs: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  chartJs: 'https://cdn.jsdelivr.net/npm/chart.js@4.5.0/dist/chart.umd.min.js',
  lucideJs: 'https://unpkg.com/lucide@0.454.0/dist/umd/lucide.min.js'
};
const libPromises = {};
function loadOnce(key, make) {
  if (!libPromises[key]) libPromises[key] = new Promise((resolve, reject) => {
    const el = make();
    el.onload = () => resolve();
    el.onerror = () => { delete libPromises[key]; el.remove(); reject(new Error('не загрузилось: ' + LIBS[key])); };
    document.head.appendChild(el);
  });
  return libPromises[key];
}
function loadScript(key) {
  return loadOnce(key, () => { const s = document.createElement('script'); s.src = LIBS[key]; s.async = true; return s; });
}
function loadStyle(key) {
  return loadOnce(key, () => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = LIBS[key]; return l; });
}
export const ensureLeaflet = () => window.L ? Promise.resolve(window.L) : Promise.all([loadStyle('leafletCss'), loadScript('leafletJs')]).then(() => window.L);
export const ensureChart = () => window.Chart ? Promise.resolve(window.Chart) : loadScript('chartJs').then(() => window.Chart);

/* Выполнить в простое браузера (после первой отрисовки); запасной путь — setTimeout */
export function whenIdle(fn, timeout = 1500) {
  if (window.requestIdleCallback) requestIdleCallback(fn, { timeout });
  else setTimeout(fn, 120);
}

/* ---------- Иконки ----------
   <i data-lucide="имя"> заменяется встроенным SVG из js/ui/icon-data.js (геометрия Lucide, ISC) — синхронно, без внешней библиотеки:
   нет запроса к CDN, нет ~100 мс выполнения Lucide на главном потоке, иконки появляются сразу и работают офлайн.
   Запасной путь: если имени нет в наборе, полная Lucide подгружается лениво с CDN (иконки декоративны — без неё всё работает). */
const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_FRAME = { xmlns: SVG_NS, width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };

function iconSvg(name, src) {
  const parts = ICON_DATA[name];
  if (!parts) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const k in SVG_FRAME) svg.setAttribute(k, SVG_FRAME[k]);
  // атрибуты исходного <i> (aria-hidden, style, data-*) переносятся; классы дополняются служебными
  for (const a of src.attributes) if (a.name !== 'data-lucide' && a.name !== 'class') svg.setAttribute(a.name, a.value);
  svg.setAttribute('class', ['lucide', 'lucide-' + name, src.getAttribute('class')].filter(Boolean).join(' '));
  for (const [tag, attrs] of parts) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    svg.appendChild(el);
  }
  return svg;
}

let lucideAsked = false;
export function icons() {
  let unknown = false;
  document.querySelectorAll('i[data-lucide]').forEach(el => {
    const svg = iconSvg(el.getAttribute('data-lucide'), el);
    if (svg) el.replaceWith(svg); else unknown = true;
  });
  if (!unknown || lucideAsked) return;
  lucideAsked = true;
  whenIdle(() => loadScript('lucideJs').then(() => { try { window.lucide.createIcons(); } catch (e) { /* иконки декоративны */ } }).catch(() => { /* CDN недоступен — иконки декоративны */ }), 2500);
}

export const kv = (label, v) => `<div class="kv"><span>${label}</span><b>${v}</b></div>`;
export const minis = items => `<div class="ministats">${items.map(([s, v]) => `<div><small>${s}</small><b>${v}</b></div>`).join('')}</div>`;
export const resultHead = (s, v, sub) => `<div><div class="res-label">${s}</div><div class="big-num ${v < 0 ? 'negative' : ''}">${signed(v)}</div><p class="tiny">${sub}</p></div>`;
export const advice = (title, s, kind = '') => `<div class="advice ${kind}"><strong>${title}</strong>${s}</div>`;

export function costBar(parts) {
  const total = parts.reduce((a, [, v]) => a + Math.max(0, v), 0);
  const segs = total > 0 ? parts.map(([, v, cls]) => `<span class="${cls}" style="width:${Math.max(0, v) / total * 100}%"></span>`).join('') : '';
  const legend = parts.map(([l], i) => `<span class="s${i + 1}"><span class="sw"></span>${l}</span>`).join('');
  return `<div class="costbar" role="img" aria-label="Структура выручки">${segs}</div><div class="leg-mono">${legend}</div>`;
}

export function goalbar(l, v, target) {
  const p = target > 0 ? Math.max(0, v / target * 100) : 0;
  return `<div>${kv(l, pct(p))}<span class="track"><span style="width:${Math.min(100, p)}%"></span></span></div>`;
}

export function table(headers, rows) {
  return `<div class="tablebox"><table><thead><tr>${headers.map(x => `<th scope="col">${x}</th>`).join('')}</tr></thead><tbody>${rows.map(r => '<tr>' + r.map(x => `<td>${x}</td>`).join('') + '</tr>').join('')}</tbody></table></div>`;
}

/* Бейдж источника: «i · дата · confidence» + пометка устаревания */
export function srcBadge(src, staleDays = 7) {
  if (!src) return '';
  const stale = isStale(src.fetched_at, staleDays) && src.confidence !== 'model';
  const conf = { high: 'надёжность: высокая', medium: 'надёжность: средняя', low: 'надёжность: низкая', model: 'предположение модели', no_data: 'нет данных' }[src.confidence || 'medium'];
  const date = src.fetched_at ? `· ${src.fetched_at}` : '';
  const title = [src.source_name || src.name, src.source_url || '', conf].filter(Boolean).join('\n');
  return `<span class="srcinfo"><span class="sbadge${stale ? ' stale' : ''}" title="${title.replace(/"/g, '&quot;')}">i ${conf} ${date}${stale ? ' · устарело' : ''}</span></span>`;
}
export function isStale(dateStr, days) {
  if (!dateStr) return true;
  const d = new Date(dateStr);
  if (isNaN(d)) return true;
  return (Date.now() - d.getTime()) / 864e5 > days;
}

/* Тост для подтверждений действий */
export function toast(msg) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2400);
}

/* Живая проверка reduced-motion (пользователь может переключить настройку без перезагрузки) */
export const motionOK = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Счётчик KPI: ease-out-expo, 900 мс; при reduced-motion сразу конечное значение */
export function counter(el) {
  const v = +el.dataset.target;
  if (!motionOK() || !isFinite(v)) { el.textContent = fmt(v); return; }
  let start;
  const frame = t => {
    if (!start) start = t;
    const p = Math.min(1, (t - start) / 900);
    el.textContent = fmt(v * (p >= 1 ? 1 : 1 - 2 ** (-10 * p)));
    if (p < 1) requestAnimationFrame(frame); else el.textContent = fmt(v);
  };
  requestAnimationFrame(frame);
}

/* Акцент при смене значения: короткий opacity/translateY-«поп» (класс .pop из base.css).
   popNumber(el) — только анимация; popNumber(el, '12 000 ₽') — ещё и подставит текст, если он изменился.
   Возвращает true, если значение действительно поменялось. */
export function popNumber(el, value) {
  if (!el) return false;
  let changed = true;
  if (value != null) { changed = el.textContent !== String(value); if (changed) el.textContent = String(value); }
  if (!changed || !motionOK()) return changed;
  el.classList.remove('pop');
  void el.offsetWidth; // перезапуск CSS-анимации
  el.classList.add('pop');
  el.addEventListener('animationend', () => el.classList.remove('pop'), { once: true });
  return changed;
}
/* enter(el, fn[, margin]) — один раз вызвать fn, когда el попал в зону видимости; margin — упреждение («600px» = за 600px до вьюпорта) */
export function enter(el, fn, margin = '0px') {
  if (!window.IntersectionObserver) { fn(); return; }
  const ob = new IntersectionObserver(a => { if (a.some(x => x.isIntersecting)) { fn(); ob.disconnect(); } }, { threshold: margin === '0px' ? .05 : 0, rootMargin: margin });
  ob.observe(el);
}
export function initReveal(scope = document) {
  // Идемпотентно: обработанные элементы помечены, повторный вызов (после отрисовки разделов) берёт только новые
  const els = $$('.rv:not([data-rv])', scope);
  els.forEach(e => e.setAttribute('data-rv', ''));
  if (!window.IntersectionObserver || !motionOK()) { els.forEach(e => e.classList.add('in', 'rv-done')); return; }
  // Скрывать .rv (opacity:0) можно только когда скрипт реально работает — иначе при сбое контент останется невидимым
  document.documentElement.classList.add('js-ready');
  const ob = new IntersectionObserver(a => a.forEach(x => {
    if (!x.isIntersecting) return;
    x.target.classList.add('in');
    ob.unobserve(x.target);
    // после окончания появления снимаем каскадные задержки, чтобы hover отзывался сразу
    setTimeout(() => x.target.classList.add('rv-done'), 1200);
  }), { threshold: .08 });
  els.forEach(e => ob.observe(e));
}

/* ---------- Индикатор активного сегмента (переезжает через transform) ----------
   Для групп .seg и .seg-theme: подложка-«пилюля» двигается translateX + scaleX под активную кнопку.
   Активной считается кнопка с .on / aria-pressed="true" / aria-selected="true". */
const SEG_ACTIVE = 'button.on,button[aria-pressed="true"],button[aria-selected="true"],a.active';
function bindSegment(group) {
  if (group._seg) return;
  group._seg = true;
  const ind = document.createElement('span');
  ind.className = 'seg-ind';
  ind.setAttribute('aria-hidden', 'true');
  let placed = false;
  const place = () => {
    if (!ind.isConnected) group.prepend(ind);
    const btn = group.querySelector(SEG_ACTIVE);
    if (!btn || !btn.offsetWidth) { ind.style.opacity = '0'; return; }
    ind.style.opacity = '1';
    ind.style.transform = `translateX(${btn.offsetLeft}px) scaleX(${btn.offsetWidth / 100})`;
    if (!placed) { placed = true; requestAnimationFrame(() => requestAnimationFrame(() => group.classList.add('seg-ready'))); }
  };
  group.classList.add('has-ind');
  // Чтение геометрии (offsetLeft/offsetWidth) принудительно раскладывает страницу, поэтому все вызовы схлопываются в один на кадр:
  // иначе каждая мутация DOM давала отдельную синхронную раскладку в микрозадаче
  let queued = false;
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; place(); }); } };
  schedule();
  new MutationObserver(schedule).observe(group, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'aria-pressed', 'aria-selected'] });
  if (window.ResizeObserver) new ResizeObserver(schedule).observe(group);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
}

/* ---------- Заливка активной части ползунков (CSS-переменная --fill) ---------- */
function paintRange(r) {
  const min = +r.min || 0, max = r.max === '' ? 100 : +r.max, v = +r.value;
  r.style.setProperty('--fill', max > min ? ((v - min) / (max - min) * 100).toFixed(2) + '%' : '0%');
}

/* ---------- Прогресс-полоса через scaleX ----------
   Модули выставляют bar.style.width = 'N%'; мы переводим это в CSS-переменную --p,
   а CSS рисует transform: scaleX(var(--p)) — анимируется только transform. */
export function bindScaleBar(bar) {
  if (!bar || bar._scaleBound) return;
  bar._scaleBound = true;
  const sync = () => {
    const w = parseFloat(bar.style.width);
    if (isFinite(w)) bar.style.setProperty('--p', Math.max(0, Math.min(1, w / 100)).toFixed(4));
  };
  new MutationObserver(sync).observe(bar, { attributes: true, attributeFilter: ['style'] });
  // первое значение — через два кадра, чтобы полоса плавно «выросла» из нуля
  requestAnimationFrame(() => requestAnimationFrame(sync));
}

/* Единая точка запуска UI-улучшений: сегменты, ползунки, прогресс-полосы.
   Наблюдает DOM, поэтому подхватывает и элементы, которые разделы рисуют позже. */
export function initUI() {
  if (initUI.done) return;
  initUI.done = true;
  const scan = () => {
    $$('.seg,.seg-theme,.nav').forEach(bindSegment);
    $$('input[type=range]').forEach(paintRange);
    $$('.track > span').forEach(bindScaleBar);
    bindTapHints();
  };
  initTapCounter();
  let queued = false;
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; scan(); }); } })
    .observe(document.body, { childList: true, subtree: true });
  document.addEventListener('input', e => { if (e.target.matches && e.target.matches('input[type=range]')) paintRange(e.target); }, true);
  scan();
}

/* ---------- Подсказка «пальчик / нажмите» на главных действиях разделов ----------
   По одной цели на группу: к кнопке добавляется маленькая иконка руки (.taphint), которая дважды показывает жест «тап»,
   когда кнопка впервые попала в зону видимости; дальше — только при наведении мыши (CSS, @media(hover:hover)).
   Когда Юлия нажала такие кнопки TAP_LIMIT раз (счётчик в localStorage 'yulia.v2.tapHint'), авто-показ больше не включается.
   При reduced-motion анимация отключена глобально (base.css) — иконка не появляется вовсе. */
const TAP_TARGETS = [
  '.hero-cta .btn.primary',         // Обзор: «Открыть калькуляторы»
  '#calcnav .mode:not(.on)',        // Калькуляторы: переключатель калькулятора
  '#marketFilters .chip:not(.on)',  // Навигатор: фильтр групп
  '#areaMode',                      // Карта: режим «Города области»
  '#guideTabs .tab:not(.on)'        // Справочник: вкладки
];
const TAP_KEY = 'tapHint';
const TAP_LIMIT = 3;
const tapPlayed = new Set();        // индексы групп, где авто-показ уже был в этой сессии
let tapObserver = null;

const tapCount = () => { const n = store.get(TAP_KEY, 0); return Number.isFinite(n) ? n : 0; };
const veilOpen = () => { const v = document.getElementById('veil'); return !!v && !v.hidden && getComputedStyle(v).display !== 'none'; };

/* Проиграть жест на кнопке: пока открыта заставка — отложить; лимит нажатий исчерпан — не играть */
function playTap(host) {
  if (!host.isConnected || tapCount() >= TAP_LIMIT || !motionOK()) return;
  if (veilOpen()) { setTimeout(() => playTap(host), 1200); return; }
  const hint = host.querySelector(':scope > .taphint');
  if (!hint) return;
  hint.classList.remove('play');
  void hint.offsetWidth; // перезапуск CSS-анимации
  hint.classList.add('play');
  hint.addEventListener('animationend', () => hint.classList.remove('play'), { once: true });
}

function bindTapHints() {
  TAP_TARGETS.forEach((sel, gi) => {
    const root = document.querySelector(sel.split(' ')[0]);
    if (!root || root.matches('.has-tap') || root.querySelector('.has-tap')) return; // в группе уже есть подсказка
    const host = document.querySelector(sel);
    if (!host || !host.offsetParent) return;
    host.classList.add('has-tap');
    const hint = document.createElement('span');
    hint.className = 'taphint';
    hint.setAttribute('aria-hidden', 'true');
    hint.innerHTML = '<i data-lucide="pointer"></i>';
    host.appendChild(hint);
    icons();
    if (tapPlayed.has(gi) || tapCount() >= TAP_LIMIT) return;
    tapPlayed.add(gi);
    if (!window.IntersectionObserver) return;
    if (!tapObserver) tapObserver = new IntersectionObserver(list => list.forEach(x => {
      if (!x.isIntersecting) return;
      tapObserver.unobserve(x.target);
      setTimeout(() => playTap(x.target), 400);
    }), { threshold: .9 });
    tapObserver.observe(host);
  });
}

/* Нажатие на кнопку с подсказкой увеличивает счётчик; после лимита авто-показ прекращается */
function initTapCounter() {
  document.addEventListener('click', e => {
    const host = e.target.closest && e.target.closest('.has-tap');
    if (!host) return;
    const n = tapCount() + 1;
    store.set(TAP_KEY, n);
    const hint = host.querySelector(':scope > .taphint');
    if (hint) hint.classList.remove('play');
    if (n >= TAP_LIMIT && tapObserver) { tapObserver.disconnect(); }
  }, true);
}

/* localStorage с защитой и версией схемы */
export const store = {
  ok: true,
  get(k, f) { try { const v = localStorage.getItem('yulia.v2.' + k); return v === null ? f : JSON.parse(v); } catch (e) { this.ok = false; return f; } },
  set(k, v) { try { localStorage.setItem('yulia.v2.' + k, JSON.stringify(v)); return true; } catch (e) { this.ok = false; return false; } }
};
