/* router.js — навигация по секциям: якоря, активная ссылка, мобильное меню */
import { $, $$ } from './ui/helpers.js';

const PAGES = [
  ['overview', 'Обзор'], ['calc', 'Расчёты'], ['market', 'Навигатор'],
  ['geo', 'Карта'], ['guide', 'Справочник'], ['launch', 'Чек-лист']
];

export function initNav() {
  const nav = document.querySelector('.nav'), mob = $('mobnav');
  nav.innerHTML = mob.innerHTML = PAGES.map(([id, t], i) => `<a class="${i ? '' : 'active'}" href="#${id}">${t}</a>`).join('');
  $('menubtn').onclick = () => {
    const on = mob.classList.toggle('open');
    $('menubtn').setAttribute('aria-expanded', String(on));
  };
  mob.onclick = e => {
    if (e.target.tagName === 'A') { mob.classList.remove('open'); $('menubtn').setAttribute('aria-expanded', 'false'); }
  };
  let busy = false;
  function navbar() {
    let id = 'overview';
    PAGES.forEach(([k]) => { const el = $(k); if (el && el.getBoundingClientRect().top < 160) id = k; });
    $$('#mobnav a,.nav a').forEach(a => {
      a.classList.toggle('active', a.hash === '#' + id);
      if (a.hash === '#' + id) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    });
    busy = false;
  }
  addEventListener('scroll', () => { if (!busy) { busy = true; requestAnimationFrame(navbar); } }, { passive: true });
  navbar();
}
