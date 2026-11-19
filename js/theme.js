/* theme.js — подписчики смены темы: тайлы карты и графики.
   Саму тему (data-theme, localStorage, кнопки шапки) ведёт js/boot.js и сообщает событием `yulia:theme`. */
import { icons } from './ui/helpers.js';

const listeners = new Set();
export function onThemeChange(fn) { listeners.add(fn); }

let mapObj = null, tileLayer = null;
export function registerMap(map, tiles) { mapObj = map; tileLayer = tiles; }

export function isDark() { return document.documentElement.dataset.theme === 'dark'; }

/* CartoDB Positron — для светлой темы, Dark Matter — для тёмной */
export function tileUrl(dark) {
  return dark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
}

/* Единственная публичная точка смены темы из модулей: делегирует boot.js через клик по кнопкам шапки */
export function theme(dark) {
  const btn = document.getElementById(dark ? 'thDark' : 'thLight');
  if (btn) btn.click();
}

function onTheme(dark) {
  if (tileLayer && mapObj) {
    tileLayer.setUrl(tileUrl(dark));
    // Размер контейнера не меняется при смене темы, но пересчёт безопасен и чинит «серые» тайлы
    setTimeout(() => mapObj && mapObj.invalidateSize({ pan: false }), 50);
  }
  icons();
  listeners.forEach(fn => { try { fn(dark); } catch (e) { /* подписчик не должен ломать тему */ } });
}

export function initTheme() {
  document.addEventListener('yulia:theme', e => onTheme(!!(e.detail && e.detail.dark)));
}
