/* boot.js — КЛАССИЧЕСКИЙ (не модульный) скрипт. Грузится синхронно в <head>.
   Зачем он отдельно от ES-модулей:
   1) тема применяется до первой отрисовки — без мигания;
   2) заставка («Далее», выбор режима) и переключатель темы работают, даже если модули не загрузились
      (открытие по file://, сбой CDN, синтаксическая ошибка в модуле) — как раз этот сбой убивал «Далее»;
   3) сторожевой таймер показывает аккуратный баннер, если основное приложение так и не стартовало. */
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  var PFX = 'yulia.v2.'; // тот же префикс, что в js/ui/helpers.js (store)

  /* localStorage с защитой: приватный режим / запрет хранилища не должны ронять страницу */
  function lsGet(k, fallback) {
    try { var v = localStorage.getItem(PFX + k); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(PFX + k, JSON.stringify(v)); } catch (e) { /* хранилище недоступно — не критично */ }
  }
  function $(id) { return doc.getElementById(id); }
  function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  /* ---------- Тема ---------- */
  function applyTheme(dark, persist) {
    root.setAttribute('data-theme', dark ? 'dark' : 'light');
    var l = $('thLight'), d = $('thDark');
    if (l && d) { l.setAttribute('aria-pressed', String(!dark)); d.setAttribute('aria-pressed', String(dark)); }
    var metas = doc.querySelectorAll('meta[name=theme-color]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', dark ? '#0A0A0A' : '#F5F5F7');
    if (persist) lsSet('theme', dark ? 'dark' : 'light');
    // Модули (карта, графики) подписываются на это событие
    try { doc.dispatchEvent(new CustomEvent('yulia:theme', { detail: { dark: dark } })); } catch (e) { /* старый браузер */ }
  }

  // Применяем сохранённую тему и признак «заставка уже показывалась» до отрисовки <body>
  var savedTheme = lsGet('theme', null);
  var prefersDark = false;
  try { prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { /* без matchMedia */ }
  applyTheme(savedTheme ? savedTheme === 'dark' : prefersDark, false);
  if (lsGet('seen', 0) === 1) root.classList.add('veil-seen');

  /* ---------- Заставка ---------- */
  var veil, screen1, screen2, nextBtn, lastFocus = null;

  function setBackgroundInert(on) {
    ['main', 'topbar'].forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (on) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); }
      else { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
    });
  }

  /* Перезапуск титров и анимации логотипа: класс .play висит на экране #veil1 (общая шкала времени) */
  function replayLogo() {
    var scr = $('veil1');
    if (!scr) return;
    scr.classList.remove('play');
    void scr.getBoundingClientRect();
    scr.classList.add('play');
  }

  function showVeil() {
    if (!veil) return;
    lastFocus = doc.activeElement;
    root.classList.remove('veil-seen');
    veil.classList.remove('gone');
    veil.removeAttribute('hidden');
    screen1.hidden = false; screen1.classList.remove('leaving');
    screen2.hidden = true;
    doc.body.style.overflow = 'hidden';
    setBackgroundInert(true);
    replayLogo();
    // При reduced-motion кнопка видна сразу; иначе — после титров. Фокус ставим сразу: кнопка доступна с клавиатуры.
    setTimeout(function () { try { nextBtn.focus({ preventScroll: true }); } catch (e) { /* нет фокуса */ } }, 60);
  }

  function hideVeil() {
    if (!veil) return;
    veil.classList.add('gone');
    doc.body.style.overflow = '';
    setBackgroundInert(false);
    lsSet('seen', 1);
    root.classList.add('veil-seen');
    var target = lastFocus && doc.body.contains(lastFocus) ? lastFocus : $('replay');
    try { if (target) target.focus({ preventScroll: true }); } catch (e) { /* ок */ }
  }

  function goToThemeScreen() {
    if (!screen2.hidden) return;
    // Уход экрана 1 (opacity/transform), затем появление экрана 2 с пружиной
    screen1.classList.add('leaving');
    setTimeout(function () {
      screen1.hidden = true;
      screen2.hidden = false;
      screen2.classList.remove('enter'); void screen2.offsetWidth; screen2.classList.add('enter');
      var first = screen2.querySelector('.theme-card');
      if (first) { try { first.focus({ preventScroll: true }); } catch (e) { /* ок */ } }
    }, reducedMotion() ? 0 : 320);
  }

  function pickTheme(card) {
    var dark = card.getAttribute('data-pick') === 'dark';
    var cards = screen2.querySelectorAll('.theme-card');
    for (var i = 0; i < cards.length; i++) cards[i].setAttribute('aria-pressed', String(cards[i] === card));
    card.classList.add('picked');
    applyTheme(dark, true);
    setTimeout(hideVeil, reducedMotion() ? 0 : 520); // даём увидеть отклик выбора
  }

  /* ---------- Баннер «приложение не стартовало» ---------- */
  function showBootNotice() {
    if ($('bootNotice') || window.__yuliaModuleOk) return; // приложение уже работает — баннер ложный
    var isFile = location.protocol === 'file:';
    var box = doc.createElement('div');
    box.id = 'bootNotice';
    box.className = 'bootnotice';
    box.setAttribute('role', 'alert');
    var cmd = 'npx serve .';
    // Офлайн-файл появляется только после сборки; на сайте он доступен лишь после публикации
    var offline = isFile
      ? '<span>Офлайн-версия: после сборки откройте файл <b>_site/yulia-offline.html</b> (после публикации сайта его можно скачать и оттуда).</span>' +
        '<code>npm run build</code>' +
        '<span>Или запустите локальный сервер в папке проекта:</span>'
      : '<span>Если проблема остаётся — запустите локальный сервер в папке проекта:</span>';
    box.innerHTML =
      '<strong>' + (isFile ? 'Страница открыта как файл — часть функций отключена браузером' : 'Не удалось загрузить скрипты приложения') + '</strong>' +
      '<span>' + (isFile
        ? 'Браузер блокирует модули и чтение данных при открытии двойным кликом.'
        : 'Проверьте интернет и обновите страницу.') + '</span>' +
      offline +
      '<code>' + cmd + '</code>' +
      '<span class="bn-actions"><button type="button" class="btn small secondary" id="bootCopy">Скопировать команду</button>' +
      '<button type="button" class="btn small secondary" id="bootClose">Закрыть</button></span>';
    doc.body.insertBefore(box, doc.body.firstChild);
    $('bootClose').onclick = function () { box.parentNode && box.parentNode.removeChild(box); };
    $('bootCopy').onclick = function () {
      try { navigator.clipboard.writeText(cmd); $('bootCopy').textContent = 'Скопировано'; } catch (e) { $('bootCopy').textContent = 'Выделите и скопируйте вручную'; }
    };
  }
  window.__yuliaShowBootNotice = showBootNotice;

  function init() {
    veil = $('veil'); screen1 = $('veil1'); screen2 = $('veil2'); nextBtn = $('veilNext');

    // Переключатель темы в шапке
    var l = $('thLight'), d = $('thDark');
    if (l) l.addEventListener('click', function () { applyTheme(false, true); });
    if (d) d.addEventListener('click', function () { applyTheme(true, true); });
    applyTheme(root.getAttribute('data-theme') === 'dark', false); // синхронизировать aria-pressed

    if (veil && nextBtn) {
      nextBtn.addEventListener('click', goToThemeScreen);
      var cards = veil.querySelectorAll('.theme-card');
      for (var i = 0; i < cards.length; i++) (function (c) { c.addEventListener('click', function () { pickTheme(c); }); })(cards[i]);
      var replay = $('replay');
      if (replay) replay.addEventListener('click', showVeil);
      // Esc закрывает заставку (повторный просмотр или пропуск)
      doc.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && !veil.classList.contains('gone') && !root.classList.contains('veil-seen')) hideVeil();
        // Ловушка фокуса внутри модального окна заставки
        if (e.key === 'Tab' && !veil.classList.contains('gone')) {
          var f = veil.querySelectorAll('button:not([hidden]):not([disabled])');
          var vis = []; for (var j = 0; j < f.length; j++) if (f[j].offsetParent !== null) vis.push(f[j]);
          if (!vis.length) return;
          var first = vis[0], last = vis[vis.length - 1];
          if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      });
      if (lsGet('seen', 0) === 1) { veil.classList.add('gone'); veil.setAttribute('hidden', ''); }
      else { doc.body.style.overflow = 'hidden'; setBackgroundInert(true); replayLogo(); }
    }

    startWatchdog();
  }

  /* ---------- Сторожевой таймер запуска приложения ----------
     Раньше баннер показывался через фиксированные 3,5 с. На телефоне с медленной сетью бандл (~0,5 МБ)
     грузится 8–12 с, поэтому баннер «не удалось загрузить» появлялся при КАЖДОМ запуске и так и висел.
     Теперь сбой определяется по фактам:
     1) у <script> приложения сработал onerror — файл не загрузился (ловится сразу);
     2) скрипт загрузился, но приложение не подало признак жизни за 2 с — ошибка исполнения/старый браузер;
     3) запасной вариант: после window.load прошло 15 с, признака жизни нет и скрипт приложения не «висит» в загрузке
        (пока скрипт ещё качается — ждём дальше, но не дольше 90 с с начала).
     Как только приложение стартовало, уже показанный баннер убирается (hideBootNotice). */
  var APP_RE = /(?:js|assets)\/app\.js/;
  var appScriptState = 'none';   // none | pending | loaded | failed
  var t0 = Date.now();

  function isAppScript(t) { return !!(t && t.tagName === 'SCRIPT' && APP_RE.test(t.src || '')); }
  function appStarted() { return !!window.__yuliaModuleOk; }

  function hideBootNotice() {
    var box = $('bootNotice');
    if (box && box.parentNode) box.parentNode.removeChild(box);
  }
  window.__yuliaHideBootNotice = hideBootNotice;

  // Скрипт приложения в документе (статический type=module в режиме разработки или вставленный загрузчиком сборки)
  function findAppScript() {
    var list = doc.getElementsByTagName('script');
    for (var i = 0; i < list.length; i++) if (isAppScript(list[i])) return list[i];
    return null;
  }

  function check() {
    if (appStarted()) { hideBootNotice(); return; }
    if (appScriptState === 'failed') { showBootNotice(); return; }
    // Скрипт ещё качается (или загрузчик его пока не вставил) — медленная сеть, это не сбой
    var waitedTooLong = Date.now() - t0 > 90000;
    if (!waitedTooLong && (appScriptState === 'pending' || appScriptState === 'none')) { setTimeout(check, 5000); return; }
    showBootNotice();
  }

  function startWatchdog() {
    // Открыто как файл: модули браузер блокирует сразу, сеть ни при чём — короткое ожидание оправдано
    if (location.protocol === 'file:') {
      setTimeout(function () { if (!appStarted()) showBootNotice(); }, 3500);
      return;
    }
    var s = findAppScript();
    if (s && appScriptState === 'none') appScriptState = 'pending';
    // Отсчёт запасного таймера — от полной загрузки страницы, а не от её начала
    var arm = function () { setTimeout(function () {
      var el = findAppScript();
      if (el && appScriptState === 'none') appScriptState = 'pending';
      check();
    }, 15000); };
    if (doc.readyState === 'complete') arm(); else window.addEventListener('load', arm);
  }

  // Загрузчик сборки вставляет <script> позже — отмечаем момент, когда он появился в документе
  try {
    new MutationObserver(function (muts, obs) {
      if (appStarted()) { obs.disconnect(); return; }
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) if (isAppScript(added[j]) && appScriptState === 'none') { appScriptState = 'pending'; obs.disconnect(); return; }
      }
    }).observe(root, { childList: true, subtree: true });
  } catch (e) { /* без MutationObserver сработает запасной таймер */ }

  // Ошибка загрузки скрипта приложения — не ждём таймера: уже ясно, что приложение не стартует
  window.addEventListener('error', function (e) {
    if (isAppScript(e && e.target)) { appScriptState = 'failed'; showBootNotice(); }
  }, true);

  // Скрипт загрузился: даём ему 2 с на запуск; если признака жизни нет — ошибка исполнения.
  // Слушаем на document, а не на window: по спецификации событие load элемента до window не доходит даже в фазе перехвата
  doc.addEventListener('load', function (e) {
    if (!isAppScript(e && e.target)) return;
    appScriptState = 'loaded';
    setTimeout(function () { if (appStarted()) hideBootNotice(); else showBootNotice(); }, 2000);
  }, true);

  // Модули заметок, кейс-карточек, помещений и «Обновить сейчас» входят в бандл приложения (js/app.js) и стартуют
  // вместе со своими ленивыми разделами — отдельные запросы на старте страницы не нужны

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})();
