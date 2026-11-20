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
    if ($('bootNotice')) return;
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

    // Сторожевой таймер: основное приложение (ES-модули) должно подать признак жизни
    setTimeout(function () { if (!window.__yuliaModuleOk) showBootNotice(); }, 3500);
  }

  // Ошибка загрузки/парсинга модуля — не ждём таймера, если уже ясно, что приложение не стартует
  window.addEventListener('error', function (e) {
    var t = e && e.target;
    if (t && t.tagName === 'SCRIPT' && /(?:js|assets)\/app\.js/.test(t.src || '')) showBootNotice();
  }, true);

  // Самоподключаемые модули (динамический импорт работает и из классического скрипта):
  // notes — заметки Юлии с автосейвом в IndexedDB; afford — аффорданс кнопок («пальчик»);
  // preset-cards — кейс-карточки «Рассчитай за 5 секунд» с FLIP-раскрытием
  import('./notes.js').catch(function () {});
  import('./afford.js').catch(function () {});
  import('./preset-cards.js').catch(function () {});

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})();
