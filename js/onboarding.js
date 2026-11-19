/* onboarding.js — полноэкранная заставка: два экрана, выбор темы, повторный запуск */
import { $, $$, store } from './ui/helpers.js';
import { theme } from './theme.js';

export function initVeil() {
  const veil = $('veil');
  const show = () => {
    veil.classList.remove('gone');
    document.body.style.overflow = 'hidden';
    $('veil1').hidden = false;
    $('veil2').hidden = true;
  };
  const hide = () => {
    veil.classList.add('gone');
    document.body.style.overflow = '';
    store.set('seen', 1);
  };
  $('veilNext').onclick = () => { $('veil1').hidden = true; $('veil2').hidden = false; };
  $$('.theme-card').forEach(b => b.onclick = () => { theme(b.dataset.pick === 'dark'); hide(); });
  $('replay').onclick = show;

  if (store.get('seen', 0) === 1) veil.classList.add('gone');
  else document.body.style.overflow = 'hidden';
}
