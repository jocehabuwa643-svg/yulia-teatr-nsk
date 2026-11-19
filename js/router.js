/* router.js — навигация по секциям: якоря, scroll-spy с aria-current, мобильное меню, тень шапки */
import { $, $$, initUI } from './ui/helpers.js';

const PAGES = [
  ['overview', 'Обзор'], ['calc', 'Расчёты'], ['market', 'Навигатор'],
  ['geo', 'Карта'], ['guide', 'Справочник'], ['launch', 'Чек-лист']
];
/* Раздел «Схемы» не вынесен в меню, но при его просмотре подсвечиваем соседний пункт — «Расчёты» */
const SPY_ALIAS = { schemes: 'calc' };
const DESKTOP_MIN = 1061; // с этой ширины показывается горизонтальное меню, а не бургер

export function initNav() {
  const nav = document.querySelector('.nav'), mob = $('mobnav'), btn = $('menubtn'), top = $('topbar');
  nav.innerHTML = mob.innerHTML = PAGES.map(([id, t], i) => `<a class="${i ? '' : 'active'}" href="#${id}"${i ? '' : ' aria-current="location"'}>${t}</a>`).join('');

  /* доступные имена кнопок шапки: подписи-спаны скрываются на узких экранах */
  const label = (id, text) => { const el = $(id); if (el && !el.getAttribute('aria-label')) el.setAttribute('aria-label', text); };
  label('thLight', 'Светлая тема'); label('thDark', 'Тёмная тема'); label('replay', 'Показать заставку');

  /* ---------- мобильное меню ---------- */
  function setMenu(open, returnFocus) {
    mob.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    if (!open && returnFocus) btn.focus();
  }
  btn.onclick = () => setMenu(!mob.classList.contains('open'));
  mob.onclick = e => { if (e.target.closest('a')) setMenu(false); };
  // Esc — закрыть и вернуть фокус на кнопку, если он был внутри меню
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && mob.classList.contains('open')) setMenu(false, top.contains(document.activeElement));
  });
  // клик/тап вне шапки закрывает меню
  document.addEventListener('pointerdown', e => {
    if (mob.classList.contains('open') && !top.contains(e.target)) setMenu(false);
  });
  // при расширении до десктопа меню сбрасывается
  matchMedia(`(min-width:${DESKTOP_MIN}px)`).addEventListener('change', e => { if (e.matches) setMenu(false); });
  setMenu(false);

  /* ---------- якорные переходы: фокус на раздел для клавиатуры и скринридеров ---------- */
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || a.hash.length < 2) return;
    const target = document.getElementById(a.hash.slice(1));
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });

  /* ---------- scroll-spy ---------- */
  const spyIds = ['overview', 'calc', 'schemes', 'market', 'geo', 'guide', 'launch']; // в порядке следования на странице
  let busy = false;
  function current() {
    const atBottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 4;
    if (atBottom) return PAGES[PAGES.length - 1][0];
    let id = PAGES[0][0];
    const line = (top.offsetHeight || 60) + 90; // секция «активна», когда её верх поднялся выше этой линии
    spyIds.forEach(k => { const el = $(k); if (el && el.getBoundingClientRect().top < line) id = SPY_ALIAS[k] || k; });
    return id;
  }
  function spy() {
    busy = false;
    const id = current();
    $$('#mobnav a,.nav a').forEach(a => {
      const on = a.hash === '#' + id;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    });
    top.classList.toggle('scrolled', scrollY > 8);
  }
  addEventListener('scroll', () => { if (!busy) { busy = true; requestAnimationFrame(spy); } }, { passive: true });
  addEventListener('resize', () => { if (!busy) { busy = true; requestAnimationFrame(spy); } });
  spy();

  /* сегменты, ползунки и прогресс-полосы: подключаем единые анимационные хелперы */
  initUI();
}
