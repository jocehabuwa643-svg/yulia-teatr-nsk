/* competitor-detail.js — модалка «Схема по блокам» для карточки конкурента.
   Четыре блока: Что проводят · Цена билета · Аренда площадки · Ориентировочная выручка.
   Правило данных: только то, что есть в data/*.json или введено Юлией; нет значения — «нет данных».
   «Ориентировочная выручка» — это ОЦЕНКА МОДЕЛИ ПРОЕКТА (travelCalc по цене билета конкурента),
   а не данные конкурента: помечено в интерфейсе. Афиша — прямая ссылка на источник (авто-скрейп
   афиш запрещён условиями площадок), рядом «проверено X дней назад» из недельного fetch-competitors. */
import { $, fmt, ic, icons, isStale } from './ui/helpers.js';
import { state } from './state.js';
import { travelCalc } from './calculators/travel.js';

const ruDate = d => { try { return new Date(d).toLocaleDateString('ru-RU'); } catch (e) { return '—'; } };

const NBSP = ' ';
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const THRESHOLD = () => (state.DATA && state.DATA.rates && state.DATA.rates.thresholds_days) || { prices: 30 };

/* Цена билета: ручной ввод Юлии → подтверждённая цена карточки → наблюдение с сайта → null */
export function ticketPriceOf(c, manual) {
  const m = manual && Number.isFinite(manual.value) ? manual : null;
  const listed = (c.prices || []).filter(p => Number.isFinite(p.value));
  const obs = c.observed && c.observed.price && Number.isFinite(c.observed.price.value) ? c.observed.price : null;
  const first = listed[0] || null;
  const chosen = m || first || obs;
  return {
    value: chosen ? chosen.value : null,
    source: m ? 'введено вами' : first ? 'из исследования рынка' : obs ? 'найдено на сайте (авто)' : null,
    date: (m && m.date) || (first && first.date) || (obs && c.checked_at) || c.fetched_at || null,
    qualifier: chosen && chosen.qualifier ? chosen.qualifier : null
  };
}

/* Аренда площадки: только проверенные ориентиры из data/*.json; нет данных — честная пометка.
   Схема 70/30 для ДК и аренда 1 000 ₽/м² — допущения проекта (confidence: model). */
export function rentInfoOf(c, cfg) {
  const t = c.type;
  if (t === 'outbound') {
    return { title: 'Аренда площадки', items: [
      { k: 'Зал ДК (сценарий проекта)', v: `доля площадки ${cfg.venue_share.dk}% от кассы`, note: 'схема 70/30 — не публичный тариф', confidence: 'model' },
      { k: 'Сад / школа', v: `оргсбор ${cfg.venue_share.school_garden}% от кассы`, note: 'зал даёт учреждение', confidence: 'model' }
    ] };
  }
  if (t === 'party') {
    const rest = (c.prices || []).filter(p => Number.isFinite(p.value));
    return { title: 'Аренда / тарифы площадки', items: rest.length
      ? rest.map(p => ({ k: p.label || 'Тариф', v: `${fmt(p.value)} ${p.unit || '₽'}`, note: p.qualifier || null, confidence: c.confidence || 'medium' }))
      : [{ k: 'Тарифы', v: null, note: 'нет данных — прайс не опубликован, запросить КП', confidence: 'no_data' }] };
  }
  if (t === 'studio') {
    return { title: 'Стоимость занятий (ориентир)', items: [
      { k: 'Соцформат ДДК', v: '1 500 ₽/мес.', note: 'архивная запись 2019 года', confidence: 'low' },
      { k: 'Частные студии района', v: '4 800–8 100 ₽/мес.', note: 'ориентиры бизнес-плана, не оферта', confidence: 'model' }
    ] };
  }
  return { title: 'Аренда площадки', items: [{ k: 'Стационарная площадка', v: null, note: 'условия аренды — только по запросу КП', confidence: 'no_data' }] };
}

/* Ориентировочная выручка: оценка модели проекта при цене билета конкурента.
   Считаем тем же калькулятором выезда, которым Юлия считает свои сценарии. */
export function revenueEstimate(c, cfg, manual) {
  const tp = ticketPriceOf(c, manual);
  if (!Number.isFinite(tp.value) || tp.value <= 0) return { available: false, reason: 'нет подтверждённой цены билета' };
  const audiences = [30, 60, 100];
  const dk = c.type === 'party' || c.format && /ДК|зал/i.test(c.format) ? 1 : 0;
  const rows = audiences.map(n => {
    const r = travelCalc({ n, p: tp.value, k: 1, r: 0, dk: 0, own: 0 }, cfg);
    return { n, gross: r.gross, profit: r.profit, be: r.be };
  });
  return { available: true, price: tp, rows, note: dk ? 'при залe ДК считайте отдельную калькуляцию (доля 30%)' : null };
}

/* Модель экрана: блоки для разметки */
export function detailModel(c, cfg, manual) {
  const g = c.format || '';
  const src = safeSrc(c.source_url);
  const checked = c.checked_at ? { date: c.checked_at, stale: isStale(c.checked_at, THRESHOLD().prices), status: c.check_status } : null;
  return {
    name: c.name, format: g, district: c.district, address: c.address, status: c.status,
    program: c.program || null,
    age: c.age || null,
    note: c.note || null,
    ticket: ticketBlock(c, cfg, manual),
    rent: rentInfoOf(c, cfg),
    revenue: revenueEstimate(c, cfg, manual),
    source: { url: c.source_url, name: c.source_name || 'источник', fetchedAt: c.fetched_at, checked },
    manual
  };
}
function safeSrc(u) { return /^https?:\/\//.test(String(u || '')) ? u : null; }

function ticketBlock(c, cfg, manual) {
  const tp = ticketPriceOf(c, manual);
  const rest = (c.prices || []).filter(p => Number.isFinite(p.value));
  const items = [];
  if (tp.value != null) items.push({ k: 'Цена билета', v: `${tp.qualifier ? tp.qualifier + ' ' : ''}${fmt(tp.value)} ₽`, note: tp.source ? tp.source + (tp.date ? ' · ' + ruDate(tp.date) : '') : null, confidence: mConf(c, manual) });
  rest.slice(tp.value != null ? 1 : 0).forEach(p => items.push({ k: p.label || 'Тариф', v: `${p.qualifier ? p.qualifier + ' ' : ''}${fmt(p.value)} ${p.unit || '₽'}`, note: null, confidence: c.confidence || 'medium' }));
  if (!items.length) items.push({ k: 'Цена билета', v: null, note: 'нет данных — «нет данных» не значит «бесплатно»', confidence: 'no_data' });
  return { title: 'Цена билета', items };
}
function mConf(c, manual) { return manual ? 'manual' : (c.confidence || 'medium'); }

/* ---------- Разметка и диалог ---------- */

function blockHTML(title, items) {
  const rows = items.map(it => `<div class="cd-row"><span class="cd-k">${esc(it.k)}</span><span class="cd-v">${it.v != null ? `<b>${esc(it.v)}</b>` : '<b class="cd-none">нет данных</b>'}${it.note ? `<small>${esc(it.note)}${it.confidence ? badge(it.confidence) : ''}</small>` : (it.confidence ? `<small>${badge(it.confidence)}</small>` : '')}</span></div>`).join('');
  return `<div class="cd-block"><h4>${esc(title)}</h4>${rows}</div>`;
}
function badge(conf) {
  const m = { model: 'допущение проекта', manual: 'введено вами', no_data: 'нет данных', high: 'официальный источник', medium: 'вторичный источник', low: 'низкая надёжность' };
  return ` <span class="cd-badge${conf === 'no_data' ? ' none' : ''}">${m[conf] || conf}</span>`;
}

export function detailHTML(c, cfg, manual) {
  const m = detailModel(c, cfg, manual);
  const rev = m.revenue;
  const revHTML = rev.available
    ? `<div class="cd-row"><span class="cd-k">Выручка дня при цене ${fmt(rev.price.value)} ₽</span></div>
       <table class="cd-table"><thead><tr><th>Зрителей</th><th>Касса дня</th><th>Чистыми (модель)</th></tr></thead>
       <tbody>${rev.rows.map(r => `<tr><td>${r.n}</td><td>${fmt(r.gross)} ₽</td><td><b>${r.profit >= 0 ? '+' : '−'}${fmt(Math.abs(r.profit))} ₽</b></td></tr>`).join('')}</tbody></table>
       <p class="cd-note">Оценка модели проекта (гонорары, взносы, дорога, налог — как в калькуляторе выезда), не данные конкурента. Безубыточность: ${rev.rows[0].be} зрителей за день.${rev.note ? ' ' + esc(rev.note) : ''}</p>`
    : `<div class="cd-row"><span class="cd-k">Ориентировочная выручка</span><span class="cd-v"><b class="cd-none">нет данных</b><small>${esc(rev.reason)}</small></span></div>`;
  const checked = m.source.checked;
  const checkedHTML = checked
    ? `<span class="cd-badge${checked.stale ? ' stale' : ''}">проверено ${ruDate(checked.date)}${checked.stale ? ' · устарело' : ''}</span>`
    : `<span class="cd-badge">срез ${ruDate(m.source.fetchedAt)}</span>`;
  return `
    <div class="cd-head">
      <div><h3>${esc(m.name)}</h3><p class="tiny">${esc(m.format || '')}${m.district && m.district !== '—' ? ' · ' + esc(m.district) : ''}${m.address ? ' · ' + esc(m.address) : ''}</p></div>
      <button type="button" class="ghostbtn" data-cd-close aria-label="Закрыть схему">✕</button>
    </div>
    <div class="cd-status">${statusWord(m.status)} ${checkedHTML}${m.source.url ? ` <a class="chip" href="${esc(m.source.url)}" target="_blank" rel="noopener noreferrer">Афиша и цены на источнике ↗</a>` : ''}</div>
    <div class="cd-blocks">
      <div class="cd-block"><h4>Что проводят</h4><div class="cd-row"><span class="cd-v">${m.program ? `<b>${esc(m.program)}</b>` : '<b class="cd-none">нет данных</b>'}${m.age ? `<small>возраст: ${esc(m.age)}</small>` : ''}${m.note ? `<small>${esc(m.note)}</small>` : ''}</span></div></div>
      ${blockHTML(m.ticket.title, m.ticket.items)}
      ${blockHTML(m.rent.title, m.rent.items)}
      <div class="cd-block"><h4>Ориентировочная выручка с мероприятия</h4>${revHTML}</div>
    </div>
    <p class="cd-foot">Источник: ${esc(m.source.name)} · срез ${ruDate(m.source.fetchedAt)}. Недельная автопроверка сайтов — scripts/fetch-competitors.mjs (robots.txt соблюдается; 2ГИС/VK/Яндекс не сканируются по их правилам).</p>`;
}
function statusWord(s) { return { public: '<span class="stat st-public">публичное предложение</span>', historical: '<span class="stat st-historical">прошлый выезд</span>', mixed: '<span class="stat st-mixed">разночтения</span>', reference: '<span class="stat st-reference">ориентир</span>' }[s] || ''; }

let dlg = null, lastFocus = null;
export function openCompetitorDetail(c, manual) {
  const cfg = state.CFG;
  if (!dlg || !document.contains(dlg)) {
    dlg = document.createElement('dialog');
    dlg.className = 'cd-dialog';
    dlg.setAttribute('aria-label', 'Схема по блокам: конкурент');
    document.body.appendChild(dlg);
  }
  dlg.innerHTML = detailHTML(c, cfg, manual) || '';
  dlg.querySelector('[data-cd-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }, { once: true });
  if (typeof dlg.showModal === 'function') dlg.showModal();
  icons();
  const back = lastFocus; dlg.addEventListener('close', () => { if (back) back.focus(); }, { once: true });
}
export function setDetailFocus(el) { lastFocus = el; }
