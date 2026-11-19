/* theme.js — единая точка смены темы: DOM, мета, тайлы карты, графики */
import { $, store, icons } from './ui/helpers.js';

const listeners = new Set();
export function onThemeChange(fn) { listeners.add(fn); }

let mapObj = null, tileLayer = null;
export function registerMap(map, tiles) { mapObj = map; tileLayer = tiles; }

export function isDark() { return document.documentElement.dataset.theme === 'dark'; }

export function theme(dark, persist = true) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const light = $('thLight'), darkBtn = $('thDark');
  if (light && darkBtn) {
    light.setAttribute('aria-pressed', String(!dark));
    darkBtn.setAttribute('aria-pressed', String(dark));
  }
  document.querySelectorAll('meta[name=theme-color]').forEach(m => { m.content = dark ? '#0A0A0A' : '#F5F5F7'; });
  if (persist) store.set('theme', dark ? 'dark' : 'light');
  if (tileLayer && mapObj) {
    tileLayer.setUrl(dark
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png');
    setTimeout(() => mapObj && mapObj.invalidateSize({ pan: false }), 50);
  }
  icons();
  listeners.forEach(fn => { try { fn(dark); } catch (e) { /* подписчик не должен ломать тему */ } });
}

export function initTheme() {
  theme(store.get('theme', 'light') === 'dark', false);
  $('thLight').onclick = () => theme(false);
  $('thDark').onclick = () => theme(true);
}
