/* launch-extras.js — два блока раздела «План запуска» (#launch), рядом с чек-листом на 30 дней:
   • «Допуск в сады и школы (старт)» — #accessStart (перед чек-листом, на видном месте);
   • «Летний сценарий (июнь–август)» — #summerPlan (после чек-листа).
   Самоподключаемый модуль: подключён из js/app.js одной строкой импорта. Строит блоки лениво — когда раздел подошёл к экрану
   (или перед печатью) и данные уже загружены (state.DATA). Логика и расчёты — в чистых модулях summer.js и access-card.js.
   Отметки сохраняются через store (yulia.v2.launchx.*) — хелпер сам ловит ошибки хранилища. */
import { $, store, icons, enter } from './ui/helpers.js';
import { state } from './state.js';
import { summerDip, dipSentence, summerCashflow, priceAnchors, confidenceLabel, sanitizeSummerState, toggleFormat, buildTodo, todoProgress, fmtNum } from './summer.js';
import { accessItems, sanitizeAccessState, accessProgress, ruDate } from './access-card.js';
import { pluralRu } from './clients-model.js';

const KEY_SUMMER = 'launchx.summer';
const KEY_ACCESS = 'launchx.access';
const ICON_BY_FORMAT = { camps: 'school', parks: 'map-pin', birthdays: 'cake', intensive: 'drama' };

/* Экранирование текста из данных перед вставкой в HTML */
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ic = n => `<i data-lucide="${n}" aria-hidden="true"></i>`;

/* Ссылка на источник: открывается в новой вкладке, без передачи referrer */
const srcLink = s => `<a class="lx-src" href="${esc(s.source_url)}" target="_blank" rel="noopener noreferrer">${esc(s.source_name)}${ic('external-link')}</a>`;

/* Полоса прогресса в стиле чек-листа (.tally/.track из components.css; масштаб — transform через --p) */
const tally = (id, p) => `<div class="tally lx-tally"><span class="track"><span style="--p:${p.pct / 100}"></span></span><b id="${id}" aria-live="polite">${p.done} из ${p.total} · ${p.pct}%</b></div>`;
function setTally(root, id, p) {
  const b = root.querySelector('#' + id);
  if (!b) return;
  b.textContent = `${p.done} из ${p.total} · ${p.pct}%`;
  const bar = b.parentElement && b.parentElement.querySelector('.track > span');
  if (bar) bar.style.setProperty('--p', String(p.pct / 100));
}

/* ======================= Допуск в сады и школы ======================= */
function renderAccess(block) {
  const host = $('accessStart');
  if (!host) return;
  const items = accessItems(block);
  if (!items.length) { host.hidden = true; return; }
  let st = sanitizeAccessState(store.get(KEY_ACCESS, {}), items);
  const checked = ruDate(block.checked_at);

  host.innerHTML = `<article class="card lx-access" aria-labelledby="accessTitle">
    <div class="rowline">
      <h3 id="accessTitle">${ic('scroll')}${esc(block.title || 'Допуск в сады и школы')}</h3>
      ${checked ? `<span class="lx-checked">Ссылки проверены ${esc(checked)}</span>` : ''}
    </div>
    <p class="lx-intro">${esc(block.intro || '')}</p>
    <div class="lx-acc-list">${items.map(x => `
      <div class="lx-acc-item">
        <label class="checkrow lx-acc-row"><input type="checkbox" data-acc="${esc(x.id)}" ${st[x.id] ? 'checked' : ''}><span class="cbody"><strong>${esc(x.title)}</strong><small>${esc(x.what)}</small></span></label>
        ${x.clarify || x.sources.length ? `<details class="lx-more">
          <summary>${x.clarify ? 'Что уточнить' : 'Источники'}${x.sources.length ? ` · ${x.sources.length} ${pluralRu(x.sources.length, 'источник', 'источника', 'источников')}` : ''}</summary>
          ${x.clarify ? `<p class="lx-clarify"><b>Уточните:</b> ${esc(x.clarify)}</p>` : ''}
          ${x.sources.length ? `<p class="lx-srcs">${x.sources.map(srcLink).join('')}</p>` : ''}
        </details>` : ''}
      </div>`).join('')}
    </div>
    ${tally('accessCount', accessProgress(items, st))}
    ${block.disclaimer ? `<p class="tiny lx-note">${esc(block.disclaimer)}</p>` : ''}
  </article>`;

  host.onchange = e => {
    const t = e.target;
    if (!t.matches || !t.matches('input[data-acc]')) return;
    st = { ...st };
    if (t.checked) st[t.dataset.acc] = true; else delete st[t.dataset.acc];
    store.set(KEY_ACCESS, st);
    setTally(host, 'accessCount', accessProgress(items, st));
  };
}

/* ======================= Летний сценарий ======================= */

/* Полоски сезонности: 12 месяцев, лето выделено; высота — transform: scaleY (без анимации раскладки) */
function dipBars(dip) {
  const max = Math.max(...dip.months.map(r => r.factor), 1);
  return `<div class="lx-bars" role="img" aria-label="Коэффициенты сезонности по месяцам (модель проекта). ${esc(dip.months.map(r => `${r.name}: ${fmtNum(r.factor, 2)}`).join('; '))}">
    <span class="lx-avg" style="--y:${1 / max}" aria-hidden="true"></span>
    ${dip.months.map(r => `<span class="lx-bar${r.summer ? ' summer' : ''}${r.below ? ' below' : ''}" aria-hidden="true"><span class="lx-col" style="--h:${r.factor / max}"></span><span class="lx-m">${esc(r.name.slice(0, 3))}</span></span>`).join('')}
  </div>`;
}

/* Карточка выбранного формата: что это, кому писать, когда начинать, ориентир цены с источником */
function formatCard(f, data) {
  const anchors = priceAnchors(f, data);
  const priceList = anchors.items.map(a => `<li><span class="lx-pv">${fmtNum(a.value)} ${esc(a.unit)}</span> <span class="lx-pl">${esc(a.label)}</span>
      <span class="lx-ps">${a.source_url ? `<a href="${esc(a.source_url)}" target="_blank" rel="noopener noreferrer">${esc(a.source_name)}</a>` : esc(a.source_name)} · ${esc(confidenceLabel(a.confidence))}${a.fetched_at ? ' · ' + esc(a.fetched_at) : ''}</span></li>`).join('');
  return `<article class="lx-fmt" data-fmt="${esc(f.id)}">
    <h4>${ic(ICON_BY_FORMAT[f.id] || 'sun')}${esc(f.title)}</h4>
    <dl>
      <dt>Что это</dt><dd>${esc(f.what)}</dd>
      <dt>Кому писать</dt><dd>${esc(f.who)}</dd>
      <dt>Когда начинать</dt><dd>${esc(f.when)}${f.when_kind === 'advice' ? ' <span class="lx-tag">совет проекта, не факт</span>' : ''}</dd>
      <dt>Ориентир цены</dt><dd>${priceList ? `<ul class="lx-prices">${priceList}</ul>` : ''}${anchors.fallback ? `<p class="lx-fallback">${esc(anchors.fallback)}</p>` : ''}</dd>
    </dl>
  </article>`;
}

function renderSummer(summer, data) {
  const host = $('summerPlan');
  if (!host) return;
  const formats = summer && Array.isArray(summer.formats) ? summer.formats : [];
  if (!formats.length) { host.hidden = true; return; }
  let st = sanitizeSummerState(store.get(KEY_SUMMER, null), summer);
  const dip = summerDip(data.seasonality, summer.months || [6, 7, 8]);
  const cf = summerCashflow(data.config);

  host.innerHTML = `<article class="card lx-summer" aria-labelledby="summerTitle">
    <div class="rowline"><h3 id="summerTitle">${ic('sun')}${esc(summer.title || 'Летний сценарий')}</h3><span class="lx-tag">ориентир</span></div>
    <p class="lx-intro">${esc(summer.intro || '')}</p>
    <div class="lx-dip">
      ${dip.ok ? dipBars(dip) : ''}
      <p class="lx-dipline"><b>${esc(dipSentence(dip))}</b></p>
      ${cf.rows.length ? `<ul class="lx-cf">${cf.rows.map(r => `<li><b>${esc(r.m)}</b>${r.shows != null ? ` · ${fmtNum(r.shows)} ${pluralRu(r.shows, 'показ', 'показа', 'показов')} в модели` : ''}${r.note ? ` — ${esc(r.note)}` : ''}</li>`).join('')}</ul>` : ''}
      <p class="tiny lx-note">${esc(summer.dip_note || '')}${cf.source_name ? ` Показы — ${esc(cf.source_name)}.` : ''}</p>
    </div>
    <h4 class="lx-sub" id="summerFmtTitle">Форматы на каникулы</h4>
    <div class="lx-chips" role="group" aria-labelledby="summerFmtTitle">
      ${formats.map(f => `<button type="button" class="chip lx-chip${st.formats.includes(f.id) ? ' on' : ''}" data-fmt="${esc(f.id)}" aria-pressed="${st.formats.includes(f.id)}">${esc(f.title)}</button>`).join('')}
    </div>
    <div id="summerCards" class="lx-fmts"></div>
    <h4 class="lx-sub">Что сделать до мая</h4>
    <div id="summerTodo"></div>
    <p class="tiny lx-note">Сроки и подсказки — ${esc((summer.advice_source && summer.advice_source.source_name) || 'совет проекта')}. Цены — только из данных проекта с источником; где источника нет — «цену уточнить».</p>
  </article>`;

  const cards = host.querySelector('#summerCards');
  const todoBox = host.querySelector('#summerTodo');

  /* Перерисовка выбранных форматов и плана (чек-лист собирается из пунктов выбранных форматов) */
  const paint = () => {
    const chosen = formats.filter(f => st.formats.includes(f.id));
    cards.innerHTML = chosen.length ? chosen.map(f => formatCard(f, data)).join('')
      : '<p class="lx-empty">Выберите один или несколько форматов выше — появятся подсказки и план.</p>';
    const items = buildTodo(summer, st);
    todoBox.innerHTML = items.length ? `<div class="lx-todo">${items.map(t => `<label class="checkrow"><input type="checkbox" data-todo="${esc(t.id)}" ${t.done ? 'checked' : ''}><span class="cbody"><span class="days">до конца: ${esc(t.by)} · ${esc(t.formatTitle)}</span><strong>${esc(t.text)}</strong></span></label>`).join('')}</div>${tally('summerCount', todoProgress(items))}`
      : '<p class="lx-empty">План пуст: форматы не выбраны.</p>';
    icons();
  };

  host.onclick = e => {
    const b = e.target.closest && e.target.closest('button[data-fmt]');
    if (!b) return;
    st = toggleFormat(st, b.dataset.fmt);
    store.set(KEY_SUMMER, st);
    const on = st.formats.includes(b.dataset.fmt);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    paint();
  };
  host.onchange = e => {
    const t = e.target;
    if (!t.matches || !t.matches('input[data-todo]')) return;
    const done = { ...st.done };
    if (t.checked) done[t.dataset.todo] = true; else delete done[t.dataset.todo];
    st = { ...st, done };
    store.set(KEY_SUMMER, st);
    setTally(host, 'summerCount', todoProgress(buildTodo(summer, st)));
  };
  paint();
}

/* ======================= Запуск ======================= */
let built = false;
let tries = 0;

/* Строим один раз, когда данные готовы; пока данных нет — ждём (loadAll ещё идёт), не дольше ~2 минут */
function build() {
  if (built) return;
  const data = state.DATA;
  if (!data) { if (tries++ < 240) setTimeout(build, 500); return; }
  built = true;
  const guide = data.guide || {};
  try { if (guide.access_start) renderAccess(guide.access_start); else { const h = $('accessStart'); if (h) h.hidden = true; } }
  catch (e) { console.error('[Допуск в сады и школы]', e); const h = $('accessStart'); if (h) h.hidden = true; }
  try { if (guide.summer) renderSummer(guide.summer, data); else { const h = $('summerPlan'); if (h) h.hidden = true; } }
  catch (e) { console.error('[Летний сценарий]', e); const h = $('summerPlan'); if (h) h.hidden = true; }
  icons();
}

/* Самоподключение: раздел «План запуска» близко к экрану, переход по якорю или печать */
function arm() {
  const sec = $('launch');
  if (!sec) return;
  enter(sec, build, '1500px');
  /* перед печатью: строим блоки и раскрываем «Что уточнить · источники», чтобы на листе были ссылки */
  addEventListener('beforeprint', () => { build(); document.querySelectorAll('#accessStart details.lx-more').forEach(d => { d.open = true; }); });
  addEventListener('hashchange', () => { if (['#launch', '#summerPlan', '#accessStart'].includes(location.hash)) build(); });
  if (['#launch', '#summerPlan', '#accessStart'].includes(location.hash)) build();
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arm, { once: true });
  else arm();
}
