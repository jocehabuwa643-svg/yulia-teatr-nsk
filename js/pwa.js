/* pwa.js — «приложение на рабочем столе»: регистрация сервис-воркера (sw.js), плашка «Установить», инструкции для iPhone
   и браузеров без системного окна установки, плашка «Доступна новая версия», пометка «нет сети — сохранённые данные».
   Подключается одной строкой из js/app.js (import './pwa.js') и запускается сам, только в браузере.
   Чистые функции (detectPlatform, installMode, canRegister, shouldAutoShow, copyFor, formatSavedDate) не трогают DOM
   и проверяются тестами tests/pwa.test.mjs.
   Правила показа: не сразу — после первого действия (+ACTION_DELAY_MS) или через AUTO_DELAY_MS; не поверх заставки,
   открытых диалогов, мобильного меню и плашки новостей (на узком экране ждём, пока она уйдёт); «Не сейчас» — тишина 14 дней;
   уже установлено (display-mode: standalone, appinstalled, getInstalledRelatedApps) — не предлагаем. */

const PFX = 'yulia.v2.pwa.';
export const DISMISS_DAYS = 14;
export const ACTION_DELAY_MS = 8000;   // пауза после первого осмысленного действия
export const AUTO_DELAY_MS = 20000;    // показ без действий — через столько после закрытия заставки
const RETRY_MS = 3000;                 // повтор, если сейчас мешает диалог/новости
const UPDATE_CHECK_MS = 30 * 60e3;     // проверка новой версии при возврате на вкладку — не чаще
const DAY = 864e5;
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];
const MSG_DATA_FALLBACK = 'yulia-sw:data-fallback';

/* ---------- Чистые функции ---------- */

/* Платформа по user-agent: 'standalone' (уже открыто как приложение), 'ios', 'android', 'desktop' */
export function detectPlatform({ ua = '', platform = '', maxTouchPoints = 0, standalone = false } = {}) {
  if (standalone) return 'standalone';
  // iPadOS 13+ представляется «Macintosh», но у него есть сенсорный экран
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && maxTouchPoints > 1) || (platform === 'MacIntel' && maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  if (/Mobi|Windows Phone|HarmonyOS/i.test(ua)) return 'android';
  return 'desktop';
}

/* Как устанавливать: 'none' (уже приложение), 'prompt' (системное окно браузера), 'ios' (Поделиться → Домой), 'manual' (меню браузера) */
export function installMode(platform, hasPrompt) {
  if (platform === 'standalone') return 'none';
  if (hasPrompt) return 'prompt';
  if (platform === 'ios') return 'ios';
  return 'manual';
}

/* Сервис-воркер регистрируем только по https или на локальном сервере (file:// и офлайн-файл — нет) */
export function canRegister(loc) {
  if (!loc) return false;
  if (loc.protocol === 'https:') return true;
  return loc.protocol === 'http:' && LOCAL_HOSTS.indexOf(loc.hostname) >= 0;
}

/* Показывать ли плашку установки сама собой (из меню «Установить приложение» — всегда) */
export function shouldAutoShow({ mode, platform, now = Date.now(), dismissedAt = 0, installed = false } = {}) {
  if (mode === 'none' || installed) return false;
  if (dismissedAt && now - dismissedAt < DISMISS_DAYS * DAY) return false;
  // на компьютере без системного окна (Firefox, Safari) инструкцию сами не навязываем — только по пункту меню
  if (mode === 'manual' && platform === 'desktop') return false;
  return true;
}

/* Дата сохранённых данных «21.11, 14:05» из заголовка Date; пустая строка, если даты нет */
export function formatSavedDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  try { return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return d.toISOString().slice(0, 16).replace('T', ' '); }
}

/* Значки для инструкций (inline SVG, цвет — currentColor) */
const SVG = (body) => `<svg class="pwa-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
export const GLYPHS = {
  share: SVG('<path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>'),
  plus: SVG('<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>'),
  dots: SVG('<circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/>'),
  install: SVG('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
  refresh: SVG('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  offline: SVG('<path d="M2 2l20 20"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 4.2-2.6"/><path d="M19 12.9a10 10 0 0 0-2.4-1.7"/><path d="M12 20h.01"/>')
};

/* Тексты плашки для каждого случая. steps — список шагов с HTML (значки из GLYPHS) */
export function copyFor(kind, platform, extra = {}) {
  const device = platform === 'desktop' ? 'компьютер' : 'телефон';
  if (kind === 'prompt') return {
    title: `Установить на ${device}`,
    text: 'Откроется как приложение — с ярлыком на рабочем столе, без адресной строки. Работает и без интернета.',
    steps: [], primary: 'Установить', secondary: 'Не сейчас'
  };
  if (kind === 'ios') return {
    title: 'Ярлык на экран «Домой»',
    text: 'Помощник откроется как приложение — с красивым значком, без адресной строки.',
    steps: [
      `Нажмите «Поделиться» ${GLYPHS.share} — внизу экрана (на iPad — вверху).`,
      `Выберите «На экран „Домой“» ${GLYPHS.plus} — пролистайте список, если не видно.`,
      'Нажмите «Добавить» — значок появится на рабочем столе.'
    ],
    primary: 'Понятно', secondary: ''
  };
  if (kind === 'manual' && platform === 'desktop') return {
    title: 'Ярлык на рабочий стол',
    text: 'Как сохранить помощник отдельным приложением:',
    steps: [
      `Chrome и Edge: значок «Установить» ${GLYPHS.install} справа в адресной строке или меню ${GLYPHS.dots} → «Установить приложение».`,
      'Safari на Mac: меню «Файл» → «Добавить в Dock».',
      'Firefox: перетащите адрес сайта из адресной строки на рабочий стол — появится ярлык.'
    ],
    primary: 'Понятно', secondary: ''
  };
  if (kind === 'manual') return {
    title: 'Ярлык на рабочий стол',
    text: 'Помощник будет открываться с рабочего стола, как приложение. Добавить ярлык — пара касаний в меню браузера.',
    steps: [
      `Откройте меню браузера ${GLYPHS.dots} (три точки или три полоски).`,
      `Выберите «Добавить на главный экран» ${GLYPHS.plus} (или «Установить приложение», «Ярлык на рабочий стол»).`,
      'Нет такого пункта? Откройте сайт в Chrome — там помощник ставится одной кнопкой.'
    ],
    primary: 'Понятно', secondary: ''
  };
  if (kind === 'update') return {
    title: 'Доступна новая версия',
    text: 'Обновление помощника уже загружено. Нажмите «Обновить» — страница перезагрузится за секунду.',
    steps: [], primary: 'Обновить', secondary: 'Позже'
  };
  if (kind === 'offline') {
    const when = formatSavedDate(extra.date);
    return {
      title: 'Нет сети',
      text: `Показаны сохранённые данные${when ? ' от ' + when : ''}. Когда интернет появится, они обновятся сами.`,
      steps: [], primary: 'Понятно', secondary: ''
    };
  }
  if (kind === 'online') return {
    title: 'Сеть вернулась',
    text: 'Можно загрузить свежие данные.',
    steps: [], primary: 'Обновить', secondary: 'Позже'
  };
  return { title: '', text: '', steps: [], primary: 'Понятно', secondary: '' };
}

/* ---------- Работа со страницей ---------- */

export function initPwa({ win = globalThis.window, doc = globalThis.document } = {}) {
  if (!win || !doc || win.__yuliaPwa) return null;
  win.__yuliaPwa = true;
  const loc = win.location;
  // офлайн-файл (file://) — ни сервис-воркера, ни установки
  if (!loc || loc.protocol === 'file:') return null;

  const nav = win.navigator;
  const root = doc.documentElement;
  const lsGet = (k, f) => { try { const v = win.localStorage.getItem(PFX + k); return v === null ? f : JSON.parse(v); } catch { return f; } };
  const lsSet = (k, v) => { try { win.localStorage.setItem(PFX + k, JSON.stringify(v)); } catch { /* хранилище недоступно */ } };
  const mq = q => { try { return win.matchMedia(q).matches; } catch { return false; } };
  const isStandalone = () => mq('(display-mode: standalone)') || mq('(display-mode: minimal-ui)') || nav.standalone === true;
  const narrow = () => mq('(max-width: 600px)');
  const reducedMotion = () => mq('(prefers-reduced-motion: reduce)');

  let platform = detectPlatform({ ua: nav.userAgent || '', platform: nav.platform || '', maxTouchPoints: nav.maxTouchPoints || 0, standalone: isStandalone() });
  let deferredPrompt = null;
  let relatedInstalled = false;
  const mode = () => installMode(platform, !!deferredPrompt);

  /* ---------- Плашка (одна на всё: установка, обновление, офлайн) ---------- */
  const PRIORITY = { install: 1, offline: 2, online: 2, update: 3 };
  let sheet = null, sheetKind = '', returnFocus = null, waitingWorker = null, retryTimer = 0, yielded = false;

  /* Что мешает показу прямо сейчас: заставка, модальные окна, открытое меню, плашка новостей на узком экране, фоновая вкладка */
  function blocked() {
    if (!root.classList.contains('veil-seen')) return true;
    const veil = doc.getElementById('veil');
    if (veil && !veil.classList.contains('gone') && !veil.hasAttribute('hidden')) return true;
    if (doc.querySelector('dialog[open], .bootnotice')) return true;
    const mob = doc.getElementById('mobnav');
    if (mob && mob.classList.contains('open')) return true;
    // на узком экране — по очереди с плашкой новостей и системным тостом (они живут там же, внизу)
    if (narrow() && doc.querySelector('.newsflash, .toast.show')) return true;
    return doc.visibilityState === 'hidden';
  }

  function hide(remember) {
    if (!sheet) return;
    const box = sheet, focusBack = returnFocus;
    if (remember && sheetKind === 'install') lsSet('dismissedAt', Date.now());
    sheet = null; sheetKind = ''; returnFocus = null;
    if (box.contains(doc.activeElement) && focusBack && focusBack.isConnected) { try { focusBack.focus(); } catch { /* ок */ } }
    box.classList.remove('show');
    win.setTimeout(() => box.remove(), reducedMotion() ? 0 : 320);
  }

  /* Сборка и показ. kind: install-режим ('prompt' | 'ios' | 'manual') или 'update' | 'offline' | 'online'.
     compact — автопоказ: шаги инструкции свёрнуты под кнопкой «Как добавить», плашка занимает минимум места */
  function render(kind, { focus = false, extra = {}, compact = false } = {}) {
    const group = (kind === 'prompt' || kind === 'ios' || kind === 'manual') ? 'install' : kind;
    if (sheet && PRIORITY[sheetKind] > PRIORITY[group]) return false; // важная плашка уже на экране
    if (sheet) { sheet.remove(); sheet = null; }
    const c = copyFor(kind, platform, extra);
    const folded = compact && c.steps.length > 0;
    const box = doc.createElement('section');
    box.className = 'pwa-sheet pwa-' + group;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'false');
    box.setAttribute('aria-labelledby', 'pwaTitle');
    box.setAttribute('aria-describedby', 'pwaText');
    const art = group === 'install'
      ? '<img class="pwa-ic" src="icons/icon-192.png" alt="" width="48" height="48" decoding="async">'
      : `<span class="pwa-ic pwa-ic-glyph" aria-hidden="true">${group === 'update' || group === 'online' ? GLYPHS.refresh : GLYPHS.offline}</span>`;
    box.innerHTML =
      `<div class="pwa-row">${art}<div class="pwa-body"><h2 class="pwa-title" id="pwaTitle">${c.title}</h2>` +
      `<p class="pwa-text" id="pwaText">${c.text}</p></div></div>` +
      (c.steps.length ? `<ol class="pwa-steps" id="pwaSteps"${folded ? ' hidden' : ''}>${c.steps.map(s => `<li>${s}</li>`).join('')}</ol>` : '') +
      `<div class="pwa-actions"><button type="button" class="pwa-btn pwa-primary"${folded ? ' aria-expanded="false" aria-controls="pwaSteps"' : ''}>${folded ? 'Как добавить' : c.primary}</button>` +
      (folded || c.secondary ? `<button type="button" class="pwa-btn pwa-secondary">${folded ? 'Не сейчас' : c.secondary}</button>` : '') + '</div>';
    doc.body.appendChild(box);
    sheet = box; sheetKind = group;
    // «Нет сети» на экране — сами следим, когда сеть вернётся (см. watchOnline)
    if (group === 'offline') watchOnline();

    const primary = box.querySelector('.pwa-primary');
    const secondary = box.querySelector('.pwa-secondary');
    let open = !folded;
    primary.addEventListener('click', () => {
      // свёрнутая инструкция: первое нажатие раскрывает шаги, второе («Понятно») закрывает
      if (!open) {
        open = true;
        box.querySelector('.pwa-steps').hidden = false;
        primary.textContent = c.primary;
        primary.setAttribute('aria-expanded', 'true');
        return;
      }
      onPrimary(kind);
    });
    if (secondary) secondary.addEventListener('click', () => hide(true));
    box.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); hide(true); } });

    // кадр между вставкой и .show — чтобы сработал переход transform/opacity
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => box.classList.add('show')));
    if (focus) { try { primary.focus({ preventScroll: true }); } catch { primary.focus(); } }
    syncYield();
    return true;
  }

  async function onPrimary(kind) {
    if (kind === 'prompt' && deferredPrompt) {
      const ev = deferredPrompt;
      deferredPrompt = null;
      hide(false);
      try {
        await ev.prompt();
        const choice = await ev.userChoice;
        if (choice && choice.outcome === 'accepted') lsSet('installed', 1);
        else lsSet('dismissedAt', Date.now());
      } catch (e) { console.warn('[pwa] окно установки не открылось', e); }
      syncMenu();
      return;
    }
    if (kind === 'update') {
      hide(false);
      if (waitingWorker) { reloadOnSwitch = true; waitingWorker.postMessage({ type: 'SKIP_WAITING' }); }
      else win.location.reload();
      return;
    }
    if (kind === 'online') { hide(false); win.location.reload(); return; }
    // «Понятно» в инструкциях считается как «Не сейчас»: сами не напоминаем 14 дней
    hide(true);
  }

  /* На узком экране плашка новостей и наша — по очереди: пока новости видны, наша прячется (не удаляется) */
  function syncYield() {
    if (!sheet) return;
    const y = narrow() && !!doc.querySelector('.newsflash');
    if (y === yielded) return;
    yielded = y;
    sheet.classList.toggle('pwa-yield', y);
    if (y) sheet.setAttribute('aria-hidden', 'true'); else sheet.removeAttribute('aria-hidden');
  }

  /* Показ с ожиданием: если сейчас мешает диалог/новости — повтор через RETRY_MS */
  function showWhenFree(kind, opts) {
    win.clearTimeout(retryTimer);
    // «Нет сети» из события offline ждал очереди, а сеть уже вернулась — показывать устаревшую плашку незачем
    if (kind === 'offline' && !(opts && opts.extra && opts.extra.date) && nav.onLine !== false) return;
    if (blocked()) { retryTimer = win.setTimeout(() => showWhenFree(kind, opts), RETRY_MS); return; }
    render(typeof kind === 'function' ? kind() : kind, opts);
  }

  /* ---------- Автопоказ установки ---------- */
  let armed = false, autoTimer = 0;
  function autoInstall() {
    if (sheet) return;
    const m = mode();
    if (!shouldAutoShow({ mode: m, platform, dismissedAt: lsGet('dismissedAt', 0), installed: lsGet('installed', 0) === 1 || relatedInstalled })) return;
    showWhenFree(() => mode(), { compact: true });
  }
  function onActivity(e) {
    if (armed) return;
    const veil = doc.getElementById('veil');
    if (!root.classList.contains('veil-seen') || (e && e.target && e.target.nodeType === 1 && veil && veil.contains(e.target))) return;
    armed = true;
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(t => win.removeEventListener(t, onActivity, true));
    win.clearTimeout(autoTimer);
    autoTimer = win.setTimeout(autoInstall, ACTION_DELAY_MS);
  }
  function armAuto() {
    if (platform === 'standalone') return;
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(t => win.addEventListener(t, onActivity, { capture: true, passive: true }));
    // без действий — через AUTO_DELAY_MS (отсчёт идёт и под заставкой, но показ всё равно ждёт её закрытия)
    autoTimer = win.setTimeout(() => { armed = true; autoInstall(); }, AUTO_DELAY_MS);
  }

  /* ---------- Пункт «Установить приложение» в меню и шапке ---------- */
  const NAV_ID = 'pwaNavBtn', HEAD_ID = 'pwaHeadBtn';
  function openFromMenu(e) {
    const mob = doc.getElementById('mobnav'), menuBtn = doc.getElementById('menubtn');
    // закрываем мобильное меню (его логика — в router.js, через ту же кнопку)
    if (mob && mob.classList.contains('open') && menuBtn) menuBtn.click();
    returnFocus = (e && e.currentTarget && e.currentTarget.id === HEAD_ID) ? e.currentTarget : (menuBtn || null);
    const ret = returnFocus;
    if (sheet && sheetKind === 'install') hide(false);
    render(mode(), { focus: true });
    returnFocus = ret;
  }
  function syncMenu() {
    const show = platform !== 'standalone';
    const mob = doc.getElementById('mobnav');
    let navBtn = doc.getElementById(NAV_ID);
    if (show && mob && !navBtn) {
      navBtn = doc.createElement('button');
      navBtn.type = 'button';
      navBtn.id = NAV_ID;
      navBtn.className = 'pwa-navbtn';
      navBtn.innerHTML = `${GLYPHS.install}<span>Установить приложение</span>`;
      navBtn.addEventListener('click', openFromMenu);
      mob.appendChild(navBtn);
    } else if (!show && navBtn) navBtn.remove();
    const tools = doc.querySelector('.headtools');
    let headBtn = doc.getElementById(HEAD_ID);
    if (show && tools && !headBtn) {
      headBtn = doc.createElement('button');
      headBtn.type = 'button';
      headBtn.id = HEAD_ID;
      headBtn.className = 'ghostbtn pwa-headbtn';
      headBtn.setAttribute('aria-label', 'Установить приложение');
      headBtn.title = 'Установить приложение — ярлык на рабочем столе';
      headBtn.innerHTML = `${GLYPHS.install}<span>Установить</span>`;
      headBtn.addEventListener('click', openFromMenu);
      tools.insertBefore(headBtn, doc.getElementById('replay') || tools.firstChild);
    } else if (!show && headBtn) headBtn.remove();
  }

  /* ---------- Сервис-воркер: регистрация, обновление, сообщения ---------- */
  let reloadOnSwitch = false, lastUpdateCheck = Date.now();
  function offerUpdate(worker) {
    waitingWorker = worker;
    showWhenFree('update');
  }
  async function registerSw() {
    if (!('serviceWorker' in nav) || !canRegister(loc)) return;
    try {
      const reg = await nav.serviceWorker.register('sw.js', { scope: './' });
      if (reg.waiting && nav.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => {
          // есть активный воркер → это обновление, а не первая установка
          if (w.state === 'installed' && nav.serviceWorker.controller) offerUpdate(w);
        });
      });
      // вернулись на вкладку спустя время — проверяем, не вышла ли новая версия
      doc.addEventListener('visibilitychange', () => {
        if (doc.visibilityState === 'visible' && Date.now() - lastUpdateCheck > UPDATE_CHECK_MS) {
          lastUpdateCheck = Date.now();
          reg.update().catch(() => { /* нет сети — проверим позже */ });
        }
      });
    } catch (e) { console.warn('[pwa] сервис-воркер не зарегистрирован', e); }
  }

  if ('serviceWorker' in nav) {
    nav.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadOnSwitch) { reloadOnSwitch = false; win.location.reload(); }
    });
    // данные пришли из кэша сервис-воркера — честная пометка «нет сети»
    nav.serviceWorker.addEventListener('message', e => {
      const d = e.data || {};
      if (d.type === MSG_DATA_FALLBACK && !fallbackShown) {
        fallbackShown = true;
        watchOnline();
        showWhenFree('offline', { extra: { date: d.date } });
      }
    });
    try { nav.serviceWorker.startMessages(); } catch { /* старый браузер — сообщения придут после загрузки */ }
  }

  /* Сеть пропала/вернулась во время работы.
     Событие online в части браузеров (и под сервис-воркером в эмуляции) приходит с задержкой или не приходит вовсе,
     а после запасного ответа воркера (5xx, слабая сеть) navigator.onLine и вовсе остаётся true. Поэтому, пока висит
     «Нет сети», сами проверяем сеть: лёгкий запрос data/meta.json?t=… мимо кэша. Свежий ответ без пометки X-SW-Fallback —
     сеть вернулась. Пауза между проверками растёт 4 → 8 → 16 → 30 с, чтобы не тратить трафик на слабой сети. */
  let fallbackShown = false, onlineTimer = 0, probeDelay = 0, probing = false;
  const PROBE_MIN_MS = 4000, PROBE_MAX_MS = 30000, PROBE_TIMEOUT_MS = 8000;
  function stopWatch() { win.clearTimeout(onlineTimer); onlineTimer = 0; probeDelay = 0; }
  function onOnline() {
    stopWatch();
    fallbackShown = false; // следующий запасной ответ снова покажет плашку
    if (sheet && sheetKind === 'offline') render('online');
  }
  /* Одна проверка сети: true — пришёл настоящий ответ сервера (не копия из кэша воркера) */
  async function probeNetwork() {
    if (nav.onLine === false || typeof win.fetch !== 'function') return false;
    const ctl = typeof win.AbortController === 'function' ? new win.AbortController() : null;
    const t = ctl ? win.setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS) : 0;
    try {
      const res = await win.fetch('data/meta.json?t=' + Date.now(), { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
      return !!res && res.ok && !res.headers.get('X-SW-Fallback');
    } catch { return false; } finally { win.clearTimeout(t); }
  }
  function scheduleProbe() {
    probeDelay = probeDelay ? Math.min(probeDelay * 2, PROBE_MAX_MS) : PROBE_MIN_MS;
    onlineTimer = win.setTimeout(async () => {
      onlineTimer = 0;
      // плашку закрыли сами — следить больше не за чем (при следующем сбое воркер пришлёт сообщение снова)
      if (!sheet || sheetKind !== 'offline') { stopWatch(); fallbackShown = false; return; }
      if (probing) { scheduleProbe(); return; }
      probing = true;
      const ok = await probeNetwork();
      probing = false;
      if (ok) onOnline(); else scheduleProbe();
    }, probeDelay);
  }
  function watchOnline() {
    if (onlineTimer) return;
    probeDelay = 0;
    scheduleProbe();
  }
  win.addEventListener('offline', () => { watchOnline(); if (!sheet || sheetKind === 'install') showWhenFree('offline'); });
  win.addEventListener('online', onOnline);

  /* ---------- Установка: события браузера ---------- */
  win.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); // своё ненавязчивое окно вместо мини-панели браузера
    deferredPrompt = e;
    // если уже открыта инструкция «через меню» — заменяем её кнопкой установки
    if (sheet && sheetKind === 'install') render('prompt');
  });
  win.addEventListener('appinstalled', () => {
    lsSet('installed', 1);
    deferredPrompt = null;
    if (sheet && sheetKind === 'install') hide(false);
  });
  // запустили как приложение позже (например, в окне Chrome сменился режим) — убираем предложения
  try {
    win.matchMedia('(display-mode: standalone)').addEventListener('change', ev => {
      if (ev.matches) { platform = 'standalone'; if (sheet && sheetKind === 'install') hide(false); syncMenu(); }
    });
  } catch { /* старый браузер */ }

  /* Уже установлено как приложение (Chrome на Android умеет сказать об этом через related_applications) */
  if (typeof nav.getInstalledRelatedApps === 'function') {
    nav.getInstalledRelatedApps().then(list => { relatedInstalled = !!(list && list.length); }).catch(() => { /* не поддерживается */ });
  }

  /* ---------- Старт ---------- */
  const start = () => {
    syncMenu();
    // меню собирает router.js (innerHTML) — если пункт пропал, возвращаем его
    const mob = doc.getElementById('mobnav');
    if (mob && typeof win.MutationObserver === 'function') new win.MutationObserver(() => { if (!doc.getElementById(NAV_ID)) syncMenu(); }).observe(mob, { childList: true });
    // плашка новостей появилась/ушла — уступаем ей место на узком экране
    if (typeof win.MutationObserver === 'function') new win.MutationObserver(syncYield).observe(doc.body, { childList: true });
    win.addEventListener('resize', syncYield, { passive: true });
    armAuto();
    if (nav.onLine === false) { watchOnline(); showWhenFree('offline'); }
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  // регистрация — после загрузки страницы: не конкурирует с первой отрисовкой и данными
  if (doc.readyState === 'complete') registerSw();
  else win.addEventListener('load', registerSw, { once: true });

  return { show: kind => render(kind || mode(), { focus: true }), hide, mode, platform: () => platform };
}

/* Самозапуск только в браузере: в тестах (node) модуль импортируется без побочных эффектов */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  try { window.__yuliaPwaApi = initPwa(); } catch (e) { console.error('[pwa]', e); }
}
