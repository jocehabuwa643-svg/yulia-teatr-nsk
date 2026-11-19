/* helpers.js — форматирование и DOM-хелперы без бизнес-логики */
export const $ = id => document.getElementById(id);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const fmt = v => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(v)).replace(/-/g, '−');
export const rub = v => fmt(v) + ' ₽';
export const signed = v => (Math.round(v) > 0 ? '+' : '') + rub(v);
export const pct = v => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(v) + '%';
export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const ic = n => `<i data-lucide="${n}" aria-hidden="true"></i>`;
export function icons() { try { window.lucide && window.lucide.createIcons(); } catch (e) { /* CDN недоступен — иконки декоративны */ } }

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

/* Появление при прокрутке + счётчики */
export function counter(el) {
  const v = +el.dataset.target;
  if (reduced || !isFinite(v)) { el.textContent = fmt(v); return; }
  let start;
  const frame = t => { if (!start) start = t; const p = Math.min(1, (t - start) / 750); el.textContent = fmt(v * (1 - (1 - p) ** 3)); if (p < 1) requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
}
export function enter(el, fn) {
  if (!window.IntersectionObserver) { fn(); return; }
  const ob = new IntersectionObserver(a => { if (a.some(x => x.isIntersecting)) { fn(); ob.disconnect(); } }, { threshold: .05 });
  ob.observe(el);
}
export function initReveal(scope = document) {
  const els = $$('.rv', scope);
  if (!window.IntersectionObserver || reduced) { els.forEach(e => e.classList.add('in')); return; }
  // Скрывать .rv (opacity:0) можно только когда скрипт реально работает — иначе при сбое контент останется невидимым
  document.documentElement.classList.add('js-ready');
  const ob = new IntersectionObserver(a => a.forEach(x => { if (x.isIntersecting) { x.target.classList.add('in'); ob.unobserve(x.target); } }), { threshold: .08 });
  els.forEach(e => ob.observe(e));
}

/* localStorage с защитой и версией схемы */
export const store = {
  ok: true,
  get(k, f) { try { const v = localStorage.getItem('yulia.v2.' + k); return v === null ? f : JSON.parse(v); } catch (e) { this.ok = false; return f; } },
  set(k, v) { try { localStorage.setItem('yulia.v2.' + k, JSON.stringify(v)); return true; } catch (e) { this.ok = false; return false; } }
};
