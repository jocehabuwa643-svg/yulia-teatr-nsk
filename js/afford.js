/* ВНИМАНИЕ: модуль больше не подключается (ни из boot.js, ни из app.js). Он дублировал подсказку «пальчик» на тех же
   кнопках, что и .taphint из js/ui/helpers.js (bindTapHints), — оставлена одна система, с общим счётчиком нажатий.
   Файл сохранён как история решения.

   afford.js — аффорданс главного действия: «пальчик»-пульс на ключевых кнопках при первом
   входе, снимается после первого клика где-либо. Самоподключаемый, безопасен без DOM.
   prefers-reduced-motion — подсказка не показывается (CSS). */
(function () {
  'use strict';
  var PFX = 'yulia.v2.';
  function seen() { try { return localStorage.getItem(PFX + 'tapped') === '1'; } catch (e) { return true; } }
  function mark() { try { localStorage.setItem(PFX + 'tapped', '1'); } catch (e) {} }
  function reduced() { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return true; } }

  function addHints() {
    if (seen() || reduced()) return;
    var targets = [
      document.querySelector('.hero-cta .btn.primary'),
      document.querySelector('#calcnav .mode') ||
      document.querySelector('#calcnav button')
    ].filter(Boolean);
    targets.forEach(function (b, i) {
      if (!b.getBoundingClientRect().width) return; // невидимая — пропускаем
      var s = document.createElement('span');
      s.className = 'touch-hint';
      s.setAttribute('aria-hidden', 'true');
      s.innerHTML = '<i></i>';
      s.style.animationDelay = (i * 0.6) + 's';
      if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
      b.appendChild(s);
    });
    var off = function () {
      document.querySelectorAll('.touch-hint').forEach(function (h) { h.remove(); });
      mark();
      removeEventListener('pointerdown', off, true);
      removeEventListener('keydown', off, true);
    };
    addEventListener('pointerdown', off, true);
    addEventListener('keydown', off, true);
    // подстраховка: убрать через 20 секунд, чтобы не висела вечно
    setTimeout(off, 20000);
  }

  function boot() {
    // ждём, пока пройдёт заставка и построится интерфейс
    var tries = 0;
    var iv = setInterval(function () {
      if (seen()) { clearInterval(iv); return; }
      var veilGone = true;
      var veil = document.getElementById('veil');
      if (veil) veilGone = veil.classList.contains('gone');
      if (veilGone && (document.querySelector('.hero-cta') || document.querySelector('#calcnav'))) {
        clearInterval(iv);
        addHints();
      }
      if (++tries > 80) clearInterval(iv); // ~40 секунд — выходим
    }, 500);
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  }
})();
