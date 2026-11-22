/* competitor-detail.js — окно «Подробно» по конкуренту.
   Блоки: Что организуют (кейсы с датой и источником) · Цены по типам (билет / выезд за ребёнка / пакет / час / абонемент —
   каждый тип отдельно, «от» сохраняется, у каждой цены дата и ссылка) · Автопроверка сайта · «Если бы вы продавали
   по его цене» — оценка по ВАШЕЙ модели выезда, не выручка конкурента (подписано, формула простыми словами).
   Правило данных: только data/competitors.json и ручной ввод Юлии; нет значения — «нет данных», не ноль.
   Закрытие: ✕, Esc, клик по фону и «назад» телефона (своя запись истории без смены адреса — с сайта не выкидывает). */
import { fmt, ic, icons, isStale } from './ui/helpers.js';
import { state } from './state.js';
import { travelCalc } from './calculators/travel.js';
import { KINDS, confirmedGroups, planAssumptionGroups, priceText, ruDate as isoRu, safeUrl, ticketPriceOf as tpOf, observedCompare, revenueEstimate as revEst } from './competitor-prices.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ruDate = d => isoRu(d) || '—';
const THRESHOLD = () => (state.DATA && state.DATA.rates && state.DATA.rates.thresholds_days) || { prices: 30 };
const CONF = { model: 'ориентир плана, не оферта', manual: 'введено вами', no_data: 'нет данных', high: 'официальный источник', medium: 'вторичный источник', low: 'не подтверждено' };
const link = (u, text = 'источник') => { const s = safeUrl(u); return s ? `<a href="${esc(s)}" target="_blank" rel="noopener noreferrer">${text} ${ic('external-link')}</a>` : ''; };
const badge = conf => `<span class="cd-badge${conf === 'no_data' ? ' none' : ''}">${esc(CONF[conf] || conf)}</span>`;

/* Цена за человека для сравнения (переэкспорт для обратной совместимости) */
export const ticketPriceOf = (c, manual) => tpOf(c, manual);

/* Оценка кассы по модели проекта при цене конкурента — тем же калькулятором выезда, что у Юлии */
export const revenueEstimate = (c, cfg, manual) => revEst(c, cfg, manual, travelCalc);

/* ---------- Разметка блоков ---------- */

/* Что организуют: программа, реальные кейсы с датой и ссылкой, возраст, заметки */
function whatHTML(c) {
  const cases = (Array.isArray(c.cases) ? c.cases : []).filter(k => k && k.text);
  const head = c.program ? `<p class="cd-prog">${esc(c.program)}</p>` : '';
  const list = cases.length
    ? `<ul class="cd-cases">${cases.map(k => `<li><span>${esc(k.text)}</span><small>${k.date ? `<b>${ruDate(k.date)}</b> · ` : ''}${link(k.source_url) || 'источник не указан'}${k.fetched_at ? ` · проверено ${ruDate(k.fetched_at)}` : ''}</small></li>`).join('')}</ul>`
    : '<p class="cd-none-line"><b class="cd-none">Нет проверенных кейсов</b> — по открытым источникам не найдено.</p>';
  const extra = [c.age ? `возраст: ${esc(c.age)}` : '', c.note ? esc(c.note) : ''].filter(Boolean).map(t => `<p class="cd-note">${t}</p>`).join('');
  return `<section class="cd-block"><h4>Что организуют</h4>${head}${list}${extra}</section>`;
}

/* Цены по типам: каждая группа — свой подзаголовок; внутри — подпись, цена с «от», дата, источник, надёжность */
/* Подпись даты цены: ручной ввод — «введено», вторичный источник — «срез», официальный — «проверено» */
const dateWord = p => (p.manual ? 'введено' : p.confidence === 'medium' ? 'срез' : 'проверено');

function pricesHTML(c, manual) {
  // в группах — только подтверждённые цены и ручной ввод; допущения бизнес-плана идут отдельной сноской ниже
  const groups = confirmedGroups(c, manual);
  const body = groups.length ? groups.map(g => `<div class="cd-kind"><h5>${esc(g.label)}<small>${esc(g.per)}</small></h5>${g.items.map(p => {
    const stale = !p.manual && p.fetched_at && isStale(p.fetched_at, THRESHOLD().prices);
    return `<div class="cd-row"><span class="cd-k">${esc(p.label || 'Тариф')}</span><span class="cd-v"><b>${esc(priceText(p))}</b><small>${p.fetched_at ? `${dateWord(p)} ${ruDate(p.fetched_at)}` : 'дата не указана'}${p.valid_from ? ` · действует с ${ruDate(p.valid_from)}` : ''}${p.source_url ? ' · ' + link(p.source_url) : ''} ${badge(p.manual ? 'manual' : p.confidence || 'medium')}${stale ? ' <span class="cd-badge stale">устарело</span>' : ''}</small></span></div>`;
  }).join('')}</div>`).join('')
    : `<div class="cd-row"><span class="cd-k">Цена</span><span class="cd-v"><b class="cd-none">нет данных</b><small>«нет данных» не значит «бесплатно» — запросите КП или введите цену в карточке</small></span></div>`;
  const note = c.price_note ? `<p class="cd-note">${esc(c.price_note)}</p>` : '';
  // допущения бизнес-плана: обычным текстом, без «проверено», с явной пометкой «не цена студии»
  const plan = planAssumptionGroups(c);
  const planHTML = plan.length ? `<div class="cd-plan"><h5>Допущение бизнес-плана — не цена студии</h5>${plan.map(g => g.items.map(p => `<div class="cd-row"><span class="cd-k">${esc(p.label || g.label)}</span><span class="cd-v"><span class="cd-plan-v">${esc(priceText(p))}</span><small>рабочая цифра проекта; на сайте студии не сверялась ${badge('model')}</small></span></div>`).join('')).join('')}</div>` : '';
  // значения прежнего исследования, не подтверждённые при сверке — показываем честно, но в сравнение не берём
  const un = (Array.isArray(c.unconfirmed_prices) ? c.unconfirmed_prices : []).filter(p => Number.isFinite(p.value));
  const unHTML = un.length ? `<details class="cd-more"><summary>Не подтверждено (${un.length}) — в сравнение не входит</summary>${un.map(p => `<div class="cd-row"><span class="cd-k">${esc(p.label || 'Тариф')}</span><span class="cd-v"><b class="cd-strike">${esc(priceText(p))}</b><small>${esc(p.reason || 'не подтверждено')}</small></span></div>`).join('')}</details>` : '';
  return `<section class="cd-block"><h4>Цены по типам</h4><p class="cd-note cd-note-top">Сравнивайте только цены одного типа: билет в зал, выезд за ребёнка, пакет праздника, час аренды и абонемент — разные вещи.</p>${body}${planHTML}${note}${unHTML}</section>`;
}

/* Автопроверка сайта (еженедельно): статус страницы и найденная цена с типом */
function observedHTML(c, manual) {
  const st = c.check_status;
  if (!st) return '';
  const when = c.checked_at ? ruDate(c.checked_at) : '—';
  const stale = c.checked_at && isStale(c.checked_at, THRESHOLD().prices);
  const text = { ok: 'страница доступна', changed: 'страница изменилась — проверьте цены вручную', unavailable: 'страница недоступна, показаны прежние данные', robots_disallowed: 'сайт запрещает автопроверку (robots.txt)', skipped_policy: 'площадка запрещает автоматический сбор — проверяется только вручную', skipped: 'нет ссылки для проверки' }[st] || st;
  const oc = observedCompare(c, manual);
  const price = oc ? `<div class="cd-row"><span class="cd-k">Найдено на сайте (${esc(oc.kindLabel)})</span><span class="cd-v"><b>${esc(priceText(oc.price, false))}</b><small>${oc.differs ? '<span class="cd-badge stale">отличается от карточки</span> ' : ''}${oc.comparable ? '' : 'в карточке нет цены этого типа · '}${badge('low')}</small></span></div>` : '';
  return `<section class="cd-block"><h4>Автопроверка сайта</h4><div class="cd-row"><span class="cd-k">${when}</span><span class="cd-v"><b>${esc(text)}</b>${stale ? '<small><span class="cd-badge stale">проверка устарела</span></small>' : ''}</span></div>${price}</section>`;
}

/* «Если бы вы продавали по его цене»: только при цене за человека; явная подпись и формула */
function revenueHTML(c, manual) {
  const rev = revenueEstimate(c, state.CFG, manual);
  if (!rev.available) return `<section class="cd-block"><h4>Ваша касса по цене конкурента</h4><div class="cd-row"><span class="cd-k">Оценка</span><span class="cd-v"><b class="cd-none">не считается</b><small>${esc(rev.reason)}</small></span></div></section>`;
  const p = rev.price;
  return `<section class="cd-block"><h4>Ваша касса по цене конкурента</h4>
    <p class="cd-warn">${ic('circle-help')}<span>Оценка по <b>вашей</b> модели выезда, а не выручка конкурента: его расходы и число зрителей неизвестны.</span></p>
    <p class="cd-note cd-note-top">Цена: <b>${esc(priceText(p, false))}</b> (${esc(KINDS[p.kind] ? KINDS[p.kind].short : 'за человека')}, ${esc(p.source)}${p.date ? `, ${p.confidence === 'medium' ? 'срез' : p.confidence === 'manual' ? 'введено' : 'проверено'} ${ruDate(p.date)}` : ''}).${rev.fromPrice ? ' Это цена «от» — минимальная, реальная может быть выше.' : ''}</p>
    <div class="cd-tablebox"><table class="cd-table"><thead><tr><th scope="col">Зрителей</th><th scope="col">Касса</th><th scope="col">Вам чистыми</th></tr></thead>
    <tbody>${rev.rows.map(r => `<tr><td>${r.n}</td><td>${fmt(r.gross)} ₽</td><td><b>${r.profit >= 0 ? '+' : '−'}${fmt(Math.abs(r.profit))} ₽</b></td></tr>`).join('')}</tbody></table></div>
    <p class="cd-note">Как считается: касса = зрители × цена. Вам чистыми = касса минус ваши расходы на один показ в городе из калькулятора выезда (гонорары и взносы, бензин, износ, печать, оргсбор сада или школы, налог). Окупается от ${rev.rows[0].be} зрителей.</p></section>`;
}

function statusWord(s) { return { public: '<span class="stat st-public">публичное предложение</span>', historical: '<span class="stat st-historical">прошлый выезд</span>', mixed: '<span class="stat st-mixed">разночтения</span>', reference: '<span class="stat st-reference">ориентир</span>', plan_benchmark: '<span class="stat st-plan_benchmark">ориентир бизнес-плана</span>' }[s] || ''; }

/* Полная разметка окна */
export function detailHTML(c, cfg, manual) {
  const src = safeUrl(c.source_url);
  return `
    <div class="cd-head">
      <div class="cd-title"><h3 id="cdTitle">${esc(c.name)}</h3><p class="tiny">${esc(c.format || '')}${c.district && c.district !== '—' ? ' · ' + esc(c.district) : ''}</p>${c.address ? `<p class="tiny cd-addr">${esc(c.address)}</p>` : ''}</div>
      <button type="button" class="cd-x" data-cd-close aria-label="Закрыть">${ic('x')}</button>
    </div>
    <div class="cd-status">${statusWord(c.status)}${c.verified_at ? `<span class="cd-badge">сверено с источником ${ruDate(c.verified_at)}</span>` : `<span class="cd-badge">срез ${ruDate(c.fetched_at)}</span>`}${src ? `<a class="chip cd-src" href="${esc(src)}" target="_blank" rel="noopener noreferrer">Сайт или страница ${ic('external-link')}</a>` : ''}</div>
    <div class="cd-blocks">
      ${whatHTML(c)}
      ${pricesHTML(c, manual)}
      ${observedHTML(c, manual)}
      ${revenueHTML(c, manual)}
    </div>
    <p class="cd-foot">Источник карточки: ${esc(c.source_name || 'исследование рынка')}${c.verify_note ? '. ' + esc(c.verify_note) : ''}. Сайты конкурентов проверяются раз в неделю с соблюдением robots.txt; 2ГИС, VK и Яндекс автоматически не сканируются по их правилам.</p>`;
}

/* ---------- Диалог ---------- */

let dlg = null, lastFocus = null, pushed = false;

/* Закрытие из любого пути (✕, фон, Esc, «назад»): снимаем свою запись истории, если она ещё наша */
function closeDetail() {
  if (!dlg || !dlg.open) return;
  dlg.close();
}
function onClose() {
  if (pushed) { pushed = false; try { if (history.state && history.state.cdOpen) history.back(); } catch (e) { /* file:// */ } }
  const back = lastFocus; lastFocus = null;
  if (back && document.contains(back)) back.focus({ preventScroll: true });
}
/* «Назад» телефона: браузер уже снял запись — просто закрываем окно без второго back() */
function onPop() { if (dlg && dlg.open && pushed) { pushed = false; dlg.close(); } }

function ensureDialog() {
  if (dlg && document.contains(dlg)) return dlg;
  dlg = document.createElement('dialog');
  dlg.className = 'cd-dialog';
  dlg.setAttribute('aria-labelledby', 'cdTitle');
  document.body.appendChild(dlg);
  // клик по фону (сам dialog) закрывает; нажатие, начатое внутри окна, — нет
  let downOnDlg = false;
  dlg.addEventListener('pointerdown', e => { downOnDlg = e.target === dlg; });
  dlg.addEventListener('click', e => {
    if (e.target === dlg && downOnDlg) return closeDetail();
    if (e.target.closest('[data-cd-close]')) closeDetail();
  });
  dlg.addEventListener('close', onClose);
  addEventListener('popstate', onPop);
  return dlg;
}

export function openCompetitorDetail(c, manual) {
  const d = ensureDialog();
  d.innerHTML = detailHTML(c, state.CFG, manual);
  if (!d.open) {
    if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    try { history.pushState({ ...(history.state || {}), cdOpen: true }, '', location.href); pushed = true; } catch (e) { pushed = false; }
  }
  d.scrollTop = 0;
  icons();
  const x = d.querySelector('[data-cd-close]'); if (x) x.focus({ preventScroll: true });
}
export function setDetailFocus(el) { lastFocus = el; }

