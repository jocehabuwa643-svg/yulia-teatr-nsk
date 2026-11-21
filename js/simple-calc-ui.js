/* simple-calc-ui.js — раздел «Сколько я заработаю»: крупные поля, один большой результат, совет, сохранение и сравнение.
   Расчётов здесь нет: simpleProfit() — в js/simple-calc.js (она вызывает travel.calc и basecamp.baseMonth).
   Числовых констант тоже нет — шаги, диапазоны и значения по умолчанию лежат в data/config.json.
   Нажимаемое — явные <button>; ползунок, число и выбор — родные элементы (клавиатура и скринридер работают из коробки). */
import { $, ic, icons, toast, store, popNumber, fmt, rub, signed } from './ui/helpers.js';
import { askDialog } from './ui/calc-dialog.js';
import { srcTag } from './ui/calc-ui.js';
import { formatHeadline } from './calculators/headline.js';
import { clamp, getPath, ruNum } from './calculators/util.js';
import { loadScenarios, saveScenarios, addScenario, removeScenario, buildComparison } from './calculators/scenarios.js';
import { methodLines } from './calculators/method.js';
import { MODES, simpleFields, simpleDefaults, simpleProfit, makeSimpleModule } from './simple-calc.js';
import { state } from './state.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SCEN_ID = 'simple';
const STATE_KEY = 'profit.state';
const NBSP = ' ';
/* Иконки Lucide, которых нет в js/ui/icon-data.js (набор общий, его не трогаем): рисуем инлайн, без запроса к CDN */
const SVG = d => `<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const IC = {
  minus: SVG('<path d="M5 12h14"/>'),
  up: SVG('<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>'),
  down: SVG('<path d="M16 17h6v-6"/><path d="m22 17-8.5-8.5-5 5L2 7"/>'),
  chev: SVG('<path d="m6 9 6 6 6-6"/>')
};

/* Состояние раздела: режим и значения полей по каждому режиму (хранится в localStorage; без него — значения по умолчанию) */
let S = null;            // { mode, vals: { travel: {...}, studio: {...} }, more: bool }
let MOD = null;          // модуль для сравнения сценариев
let lastBig = null;      // текст большой цифры — «поп» только при изменении
const picked = new Set();

const cfgNow = () => state.CFG;                                             // конфиг читаем в момент расчёта: ручной ввод ставок виден сразу
const seasonRows = () => ((state.DATA && state.DATA.seasonality && state.DATA.seasonality.months) || []);
const fieldsOf = mode => simpleFields(cfgNow(), mode);
const allFields = mode => { const f = fieldsOf(mode); return [...f.main, ...f.details]; };

/* Восстановить состояние: сохранённые значения принимаются, только если подходят полю (число в границах, вариант из списка) */
function loadState() {
  const cfg = cfgNow();
  const saved = store.get(STATE_KEY, null);
  const out = { mode: saved && MODES.some(m => m.id === saved.mode) ? saved.mode : MODES[0].id, vals: {}, more: !!(saved && saved.more) };
  MODES.forEach(m => {
    const def = simpleDefaults(cfg, m.id);
    const sv = saved && saved.vals && saved.vals[m.id];
    const vals = { ...def };
    if (sv && typeof sv === 'object') allFields(m.id).forEach(f => {
      const v = sv[f.id];
      if (v === undefined) return;
      if (f.type === 'select') { if ((f.options || []).some(o => String(o[0]) === String(v))) vals[f.id] = v; }
      else if (v === null && f.optional) vals[f.id] = null;
      else if (v !== '' && v !== null && Number.isFinite(Number(v))) vals[f.id] = Number(v);
    });
    out.vals[m.id] = vals;
  });
  return out;
}
const persist = () => store.set(STATE_KEY, S);
const cur = () => S.vals[S.mode];

/* ==== Поля ==== */
const limits = f => ({ lo: f.min ?? 0, hi: f.softMax ?? f.max });

function fieldHTML(f) {
  const id = `scf-${f.id}`;
  const hint = f.hint ? `<p class="sc-hint" id="${id}-h">${esc(f.hint)}</p>` : '';
  const head = `<label class="sc-label" for="${id}">${esc(f.label)}</label>${hint}`;
  const desc = f.hint ? ` aria-describedby="${id}-h"` : '';
  if (f.type === 'select') {
    return `<div class="sc-field">${head}<div class="sc-selbox"><select class="sc-select" id="${id}" data-f="${f.id}"${desc}>${f.options.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select></div></div>`;
  }
  if (f.type === 'range') {
    return `<div class="sc-field">${head}
      <div class="sc-row">
        <button type="button" class="sc-step" data-step="-1" data-for="${f.id}" aria-label="Меньше: ${esc(f.label)}">${IC.minus}</button>
        <span class="sc-numbox"><input class="sc-num" id="${id}" data-f="${f.id}" type="number" inputmode="decimal" step="any" min="${f.min}" max="${f.softMax ?? f.max}"${desc}><span class="sc-suf" aria-hidden="true">${esc(f.suffix)}</span></span>
        <button type="button" class="sc-step" data-step="1" data-for="${f.id}" aria-label="Больше: ${esc(f.label)}">${ic('plus')}</button>
      </div>
      <input class="sc-range" id="${id}-r" data-r="${f.id}" type="range" min="${f.min}" max="${f.max}" step="${f.step}" aria-label="${esc(f.label)}, ползунок" tabindex="-1">
    </div>`;
  }
  // число без ползунка: налог, расходы, переопределения
  return `<div class="sc-field">${head}<span class="sc-numbox"><input class="sc-num" id="${id}" data-f="${f.id}" type="number" inputmode="decimal" step="any" min="0"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}${desc}><span class="sc-suf" aria-hidden="true">${esc(f.suffix || '')}</span></span></div>`;
}

/* Записать значения состояния в уже построенные поля */
function paintFields() {
  const v = cur();
  allFields(S.mode).forEach(f => {
    const el = $(`scf-${f.id}`);
    if (!el) return;
    const val = v[f.id];
    if (f.type === 'select') { el.value = String(val); return; }
    if (document.activeElement !== el) el.value = val == null ? '' : String(val);
    if (f.type === 'range') {
      const r = $(`scf-${f.id}-r`);
      const num = Number(val);
      r.value = String(clamp(Number.isFinite(num) ? num : f.min, f.min, f.max));
      r.style.setProperty('--fill', (f.max > f.min ? ((Number(r.value) - f.min) / (f.max - f.min)) * 100 : 0).toFixed(2) + '%');
    }
  });
}

function buildFields() {
  const f = fieldsOf(S.mode);
  $('scFields').innerHTML = f.main.map(fieldHTML).join('');
  $('scDetail').innerHTML = f.details.map(fieldHTML).join('');
  $('scMore').open = !!S.more;
  paintFields();
  icons();
}

/* ==== Результат ==== */
const ADV_NUM = v => signed(v);
function adviceLines(r, input) {
  const kids = Number(input.kids) || 0;
  const lines = [];
  r.advice.forEach(a => {
    const after = r.monthly + a.gain;
    if (a.kind === 'price') lines.push(a.zero
      ? `Если поднять цену билета до <b>${fmt(a.to)}${NBSP}₽</b>, месяц выйдет в плюс: <b>${ADV_NUM(after)}</b>.`
      : `Если поднять цену до <b>${fmt(a.to)}${NBSP}₽</b> — это <b>${ADV_NUM(a.gain)}</b> в месяц.`);
    if (a.kind === 'kids') lines.push(`Если на показе будет <b>${fmt(a.to)}</b> ${ruPlural(a.to, 'ребёнок', 'ребёнка', 'детей')} вместо ${fmt(kids)}, месяц выйдет в плюс: <b>${ADV_NUM(after)}</b>.`);
    if (a.kind === 'shows') lines.push(a.zero
      ? `При <b>${fmt(a.to)}</b> ${ruPlural(a.to, 'показе', 'показах', 'показах')} в неделю месяц выйдет в плюс: <b>${ADV_NUM(after)}</b>.`
      : `Если добавить 1 показ в неделю — это <b>${ADV_NUM(a.gain)}</b> в месяц.`);
    if (a.kind === 'none') lines.push(`Одним параметром до нуля не дойти: поднимите цену и число детей вместе или сократите расходы в «Уточнить расчёт».`);
  });
  return lines.slice(0, 2);
}
/* Склонение по числу: 1 ребёнок, 2 ребёнка, 5 детей */
function ruPlural(n, one, few, many) {
  const a = Math.abs(Math.round(n)), t = a % 100, u = a % 10;
  if (t > 10 && t < 20) return many;
  if (u === 1) return one;
  if (u > 1 && u < 5) return few;
  return many;
}

const STATUS = {
  plus: { icon: IC.up, text: 'В плюсе' },
  zero: { icon: IC.minus, text: 'Около нуля' },
  minus: { icon: IC.down, text: 'В минусе' }
};

/* Источники констант простого расчёта: путь в config → подпись, значение, плашка «предположение проекта» */
function sourceRows(mode) {
  const cfg = cfgNow();
  const paths = mode === 'travel'
    ? ['travel_costs.salary_city_single', 'travel_costs.salary_city_cluster', 'travel_costs.wear_per_show', 'venue_share.school_garden', 'tour_unit.ticket']
    : ['base_costs.rent_per_m2', 'base_costs.utilities_per_m2', 'base_costs.admin_month', 'base_costs.marketing_month', 'base_costs.weekend_fee', 'base_costs.party_variables'];
  const rows = paths.filter(p => cfg.meta[p]).map(p => `<li><span class="sl-name">${esc(cfg.meta[p].label || p)}</span> <b>${ruNum(getPath(cfg, p), 2)} ${esc(cfg.meta[p].unit || '')}</b><br>${srcTag(cfg.meta[p], cfg)}</li>`);
  ['usn_income_rate', 'gph_contributions_rate'].forEach(k => {
    const m = cfg.rateMeta[k]; if (!m) return;
    rows.push(`<li><span class="sl-name">${esc(m.label || k)}</span> <b>${ruNum(cfg.rateVals[k], 2)} ${esc(m.unit || '')}</b><br>${srcTag(m, cfg)}</li>`);
  });
  return `<ul class="srclist">${rows.join('')}</ul>`;
}

function resultHTML(r, input) {
  const cfg = cfgNow();
  const st = STATUS[r.status];
  const weekly = fmt(r.perWeek);
  const per = r.mode === 'travel';
  // подзаголовок: от чего зависит число
  const sub = r.empty ? '' : `при ${weekly} ${ruPlural(r.perWeek, 'показе', 'показах', 'показах')} в неделю · в среднем за год`;
  // три показателя; четвёртый смысл — свой у режима
  let beLabel, beVal;
  if (per) { beLabel = 'Окупается от'; beVal = `${fmt(r.breakEvenKids)} ${ruPlural(r.breakEvenKids, 'ребёнка', 'детей', 'детей')} на показе`; }
  else { beLabel = 'Точка безубыточности'; beVal = r.breakEvenShows == null ? 'не достигается' : r.breakEvenShows === 0 ? 'без показов уже в плюсе' : `${fmt(r.breakEvenShows)} ${ruPlural(r.breakEvenShows, 'показ', 'показа', 'показов')} в месяц`; }
  const kpis = [
    ['С одного показа', signed(r.perShow)],
    ['За год', signed(r.yearly)],
    [beLabel, beVal]
  ].map(([l, v]) => `<div class="sc-kpi"><small>${l}</small><b>${v}</b></div>`).join('');

  // «куда уходят деньги»: одна полоса из частей затрат и остатка
  const parts = [...r.parts.map(p => [p.label, p.v]), ['Остаток Юлии', Math.max(0, r.monthly)]];
  const total = parts.reduce((a, [, v]) => a + Math.max(0, v), 0);
  const bar = total > 0
    ? `<div class="costbar" role="img" aria-label="Куда уходит выручка за месяц">${parts.map(([, v], i) => `<span class="c${i + 1}" style="width:${Math.max(0, v) / total * 100}%"></span>`).join('')}</div>
       <ul class="sc-legend leg-mono">${parts.map(([l, v], i) => `<li class="s${i + 1}"><span class="sw" aria-hidden="true"></span>${esc(l)}<b>${rub(v)}</b></li>`).join('')}</ul>`
    : '<p class="sc-hint">Выручки нет — делить нечего.</p>';

  // предупреждения и пояснения
  const notes = [];
  if (r.empty === 'shows') notes.push(['Укажите хотя бы один показ в неделю', 'Без показов выручки нет: сейчас месяц показывает только постоянные расходы.']);
  else if (r.empty === 'kids') notes.push(['В зале 0 детей', 'Выручки нет, а команда и дорога стоят денег. Добавьте детей в зале.']);
  else if (r.empty === 'revenue') notes.push(['Выручки нет', 'Цена билета или число детей равны нулю.']);
  if (r.vatOver) notes.push(['Годовая выручка выше порога НДС', `Простой расчёт НДС не учитывает (порог ${r.vatThreshold != null ? rub(r.vatThreshold) : 'нет данных'}). Для точной картины откройте «Студия и база» в разделе «Все расчёты».`]);
  const warn = notes.map(([t, x]) => `<div class="advice warn"><strong>${esc(t)}</strong>${esc(x)}</div>`).join('');

  const adv = adviceLines(r, input);
  const advBox = adv.length ? `<div class="advice"><strong>Совет помощника</strong>${adv.map(l => `<p>${l}</p>`).join('')}</div>` : '';

  const season = r.season
    ? `<p class="sc-season">${ic('calendar-days')}<span>В среднем за год — столько, сколько показано. По сезонности модели: ${esc(r.season.hi.name.toLowerCase())} ≈ <b>${signed(r.season.hi.monthly)}</b>, ${esc(r.season.lo.name.toLowerCase())} ≈ <b>${signed(r.season.lo.monthly)}</b> в месяц. Факт спроса: нет данных.</span></p>`
    : '';

  const year = cfg.year;
  // исходные данные — только для печати: поля слева в документе скрыты
  const given = fieldsOf(r.mode).main.map(f => {
    const v = input[f.id];
    const text = f.type === 'select' ? ((f.options.find(o => String(o[0]) === String(v)) || [])[1] || '') : `${ruNum(Number(v) || 0, 2)} ${f.suffix || ''}`.trim();
    return `<li>${esc(f.label)}: <b>${esc(text)}</b></li>`;
  }).join('');
  return `<ul class="sc-printin" aria-hidden="true"><li><b>${esc((MODES.find(m => m.id === r.mode) || {}).label || '')}</b></li>${given}</ul>
    <div class="sc-top">
      <div class="sc-statusrow"><span class="sc-status" data-s="${r.status}">${st.icon}${st.text}</span><span class="sc-approx">ориентировочно</span></div>
      <div class="sc-biglabel">Чистыми в месяц</div>
      <div class="big-num sc-big${r.monthly < 0 ? ' negative' : ''}" data-big>${formatHeadline('result', r.monthly)}</div>
      ${sub ? `<p class="sc-sub">${sub}</p>` : ''}
    </div>
    <div class="sc-kpis">${kpis}</div>
    <h3 class="sc-h">Куда уходит выручка${r.revenueMonth > 0 ? ` · ${rub(r.revenueMonth)} в месяц` : ''}</h3>
    ${bar}
    ${warn}${advBox}${season}
    <p class="sc-honest">Ориентировочный расчёт. Налог — ${ruNum(Number(input.taxPct) || 0, 2)}% с выручки (УСН «Доходы» по умолчанию — предположение проекта). <span class="srcinfo"><span class="sbadge consult">Требует консультации</span></span> Итог зависит от загрузки зала, цены, числа показов${per ? ', маршрута и состава команды' : ', числа учеников и аренды'}.</p>
    <details class="sc-src"><summary>Откуда цифры</summary>
      <ul class="methodlist">${methodLines('simple', cfg, year).map(l => `<li>${l}</li>`).join('')}</ul>
      ${sourceRows(r.mode)}
    </details>`;
}

function stickyText(r) { return formatHeadline('result', r.monthly); }

function render() {
  const cfg = cfgNow();
  const input = { ...cur(), mode: S.mode };
  let r;
  try { r = simpleProfit(input, cfg, { seasonality: seasonRows() }); } catch (e) {
    console.error('[Сколько я заработаю]', e);
    $('scResult').innerHTML = `<div class="nodata"><strong>Не удалось построить результат</strong><span>${esc(e && e.message || e)}. Нажмите «Сбросить».</span></div>`;
    return;
  }
  const box = $('scResult');
  const openSrc = !!box.querySelector('.sc-src[open]');
  box.innerHTML = resultHTML(r, input);
  if (openSrc) box.querySelector('.sc-src').open = true;
  const big = box.querySelector('[data-big]');
  const text = big ? big.textContent.trim() : '';
  if (big && lastBig !== null && lastBig !== text) popNumber(big);
  lastBig = text;
  const sticky = $('scSticky');
  if (sticky) {
    sticky.querySelector('b').textContent = stickyText(r);
    sticky.dataset.s = r.status;
  }
  icons();
  renderCompare();
}

/* ==== Сценарии ==== */
const dateOf = at => { const d = new Date(at); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU'); };

function renderSaved() {
  const list = loadScenarios(store, SCEN_ID);
  const box = $('scSaved');
  list.forEach(s => { if (!picked.has('init')) picked.add(s.id); });
  picked.add('init');
  box.hidden = !list.length;
  box.innerHTML = list.length ? `<h3 class="sc-h">Мои сценарии</h3><ul class="scenul">${list.map(s => `<li>
      <label class="scen-check"><input type="checkbox" data-sel="${s.id}" ${picked.has(s.id) ? 'checked' : ''}><span>${esc(s.name)}</span></label>
      <small class="tiny">${dateOf(s.at)}</small>
      <button type="button" class="btn small secondary" data-open="${s.id}">Открыть</button>
      <button type="button" class="btn small secondary" data-del="${s.id}" aria-label="Удалить сценарий «${esc(s.name)}»">${ic('trash-2')}</button>
    </li>`).join('')}</ul>` : '';
  const cmpBtn = $('scCompareBtn');
  if (cmpBtn) cmpBtn.hidden = !list.length;
  icons();
}

function renderCompare() {
  const box = $('scCmp');
  if (!box || box.hidden) return;
  const scenarios = loadScenarios(store, SCEN_ID).filter(s => picked.has(s.id));
  const cmp = buildComparison({ mod: MOD, cfg: cfgNow(), ctx: {}, scenarios, currentInputs: { ...cur(), mode: S.mode } });
  const head = cmp.cols.map(c => `<th scope="col">${esc(c.name)}${c.at ? `<small>${dateOf(c.at)}</small>` : ''}</th>`).join('');
  const rows = cmp.rows.map(r => `<tr><th scope="row">${esc(r.label)}</th>${r.cells.map(c => `<td>${esc(c.text)}${c.delta ? `<small>${esc(c.delta)}</small>` : ''}</td>`).join('')}</tr>`).join('');
  box.innerHTML = `<div class="cmphead"><h3>Сравнение сценариев</h3><button type="button" class="btn small secondary" data-act="compare">${ic('x')}<span>Скрыть</span></button></div>
    ${scenarios.length ? '' : '<p class="tiny">Отметьте сохранённые сценарии — они появятся рядом с текущим.</p>'}
    <div class="tablebox"><table class="cmp"><caption class="sr">Показатели сценариев; под значением — разница с текущим</caption><thead><tr><th scope="col">Показатель</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
  icons();
}

async function saveScenario() {
  const cfg = cfgNow();
  const list = loadScenarios(store, SCEN_ID);
  const res = await askDialog({
    title: 'Сохранить сценарий',
    lead: 'Сохраняются текущие значения; итоги при сравнении пересчитываются по актуальным данным. Хранится только в этом браузере.',
    fields: [{ id: 'name', type: 'text', label: 'Название сценария', value: `Сценарий ${list.length + 1}`, maxLength: cfg.calc.scenarios.max_name_len, hint: 'Одинаковое имя обновляет уже сохранённый сценарий.' }],
    ok: 'Сохранить'
  });
  if (!res || !res.values) return;
  const uid = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const next = addScenario(list, { name: res.values.name, inputs: { ...cur(), mode: S.mode }, at: new Date().toISOString(), uid }, cfg.calc.scenarios.max_saved, cfg.calc.scenarios.max_name_len);
  saveScenarios(store, SCEN_ID, next);
  const added = next.find(s => s.name.toLowerCase() === String(res.values.name || '').trim().replace(/\s+/g, ' ').toLowerCase()) || next[next.length - 1];
  picked.add(added.id);
  renderSaved(); renderCompare();
  toast(`Сценарий «${added.name}» сохранён в этом браузере`);
}

/* ==== События ==== */
function setValue(id, raw, fromTyping) {
  const f = allFields(S.mode).find(x => x.id === id);
  if (!f) return;
  const v = cur();
  if (f.type === 'select') v[id] = f.options.find(o => String(o[0]) === String(raw)) ? (Number.isFinite(Number(raw)) ? Number(raw) : raw) : v[id];
  else if (raw === '' || raw == null) v[id] = f.optional ? null : (fromTyping ? '' : (f.min ?? 0));
  else { const n = Number(raw); if (Number.isFinite(n)) v[id] = f.type === 'range' ? clamp(n, limits(f).lo, limits(f).hi) : Math.max(0, n); }
  persist();
  paintFields();
  render();
}

function setMode(mode) {
  if (mode === S.mode) return;
  S.mode = mode;
  persist();
  document.querySelectorAll('.sc-mode').forEach(b => { const on = b.dataset.mode === mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  buildFields();
  render();
}

function bind(root) {
  root.addEventListener('input', e => {
    const t = e.target;
    if (t.matches('.sc-num')) {
      // печатаем цифрами: пересчёт сразу, без правки самого поля (курсор не прыгает)
      const f = allFields(S.mode).find(x => x.id === t.dataset.f);
      if (!f) return;
      const v = cur();
      if (t.value === '') v[f.id] = f.optional ? null : '';
      else if (Number.isFinite(Number(t.value))) v[f.id] = f.type === 'range' ? clamp(Number(t.value), limits(f).lo, limits(f).hi) : Math.max(0, Number(t.value));
      persist();
      if (f.type === 'range') { const r = $(`scf-${f.id}-r`); const n = Number(v[f.id]); r.value = String(clamp(Number.isFinite(n) ? n : f.min, f.min, f.max)); r.style.setProperty('--fill', (f.max > f.min ? ((Number(r.value) - f.min) / (f.max - f.min)) * 100 : 0).toFixed(2) + '%'); }
      render();
    } else if (t.matches('.sc-range')) setValue(t.dataset.r, t.value);
  });
  root.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('.sc-select')) setValue(t.dataset.f, t.value);
    else if (t.matches('.sc-num')) setValue(t.dataset.f, t.value);                 // на выходе из поля значение нормализуется
    else if (t.matches('[data-sel]')) { if (t.checked) picked.add(t.dataset.sel); else picked.delete(t.dataset.sel); renderCompare(); }
  });
  root.addEventListener('click', e => {
    const mode = e.target.closest('.sc-mode');
    if (mode) { setMode(mode.dataset.mode); return; }
    const step = e.target.closest('.sc-step');
    if (step) {
      const f = allFields(S.mode).find(x => x.id === step.dataset.for);
      if (!f) return;
      const now = Number(cur()[f.id]);
      setValue(f.id, clamp((Number.isFinite(now) ? now : f.min) + Number(step.dataset.step) * f.step, limits(f).lo, limits(f).hi));
      return;
    }
    const so = e.target.closest('[data-open]');
    if (so) {
      const s = loadScenarios(store, SCEN_ID).find(x => x.id === so.dataset.open);
      if (s) { S.mode = MODES.some(m => m.id === s.inputs.mode) ? s.inputs.mode : S.mode; S.vals[S.mode] = { ...simpleDefaults(cfgNow(), S.mode), ...s.inputs }; persist(); document.querySelectorAll('.sc-mode').forEach(b => { const on = b.dataset.mode === S.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); buildFields(); render(); toast(`Открыт сценарий «${s.name}»`); }
      return;
    }
    const sd = e.target.closest('[data-del]');
    if (sd) { saveScenarios(store, SCEN_ID, removeScenario(loadScenarios(store, SCEN_ID), sd.dataset.del)); picked.delete(sd.dataset.del); renderSaved(); renderCompare(); toast('Сценарий удалён'); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'reset') { S.vals[S.mode] = simpleDefaults(cfgNow(), S.mode); persist(); buildFields(); render(); toast('Значения сброшены'); }
    if (act.dataset.act === 'save') saveScenario();
    if (act.dataset.act === 'compare') {
      const box = $('scCmp');
      box.hidden = !box.hidden;
      $('scCompareBtn').setAttribute('aria-expanded', String(!box.hidden));
      renderCompare();
      if (!box.hidden) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    if (act.dataset.act === 'print') {
      // печатаем только этот раздел: правило @media print в index.html смотрит на data-print
      document.body.dataset.print = 'profit';
      const done = () => { delete document.body.dataset.print; removeEventListener('afterprint', done); };
      addEventListener('afterprint', done);
      window.print();
    }
    if (act.dataset.act === 'jump') $('scResult').scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  // «Уточнить расчёт» запоминается
  $('scMore').addEventListener('toggle', () => { S.more = $('scMore').open; persist(); });
}

/* Липкая полоса итога (телефон): видна, пока основной результат не на экране; поля она не перекрывает — у полей запас снизу */
function watchSticky() {
  const sticky = $('scSticky'), res = $('scResult');
  if (!sticky || !res || !('IntersectionObserver' in window)) return;
  new IntersectionObserver(([en]) => { sticky.classList.toggle('off', en.isIntersecting); sticky.tabIndex = en.isIntersecting ? -1 : 0; sticky.setAttribute('aria-hidden', String(en.isIntersecting)); }, { threshold: 0 }).observe(res);
}

/* ==== Сборка ==== */
export function initSimpleCalc() {
  const mount = $('profitApp');
  if (!mount || mount.dataset.ready) return;
  mount.dataset.ready = '1';
  S = loadState();
  MOD = makeSimpleModule(seasonRows());
  mount.innerHTML = `<div class="sc">
    <div class="sc-modes" role="group" aria-label="Режим расчёта">${MODES.map(m => `<button type="button" class="sc-mode${m.id === S.mode ? ' on' : ''}" data-mode="${m.id}" aria-pressed="${m.id === S.mode}">${ic(m.icon)}<span class="sc-mt">${esc(m.label)}</span><small>${esc(m.hint)}</small></button>`).join('')}</div>
    <div class="sc-grid">
      <article class="card sc-in">
        <div class="sc-fields" id="scFields"></div>
        <details class="sc-more" id="scMore"><summary>Уточнить расчёт<small>аренда, реквизит, реклама, гонорары, взносы</small></summary>
          <p class="sc-hint">Значения подставлены из предположений проекта. Меняйте, если знаете точнее.</p>
          <div class="sc-fields sc-detail" id="scDetail"></div>
        </details>
        <div class="sc-actions">
          <button type="button" class="btn small secondary" data-act="reset">${ic('rotate-ccw')}<span>Сбросить</span></button>
          <button type="button" class="btn small secondary" data-act="save">${ic('bookmark')}<span>Сохранить</span></button>
          <button type="button" class="btn small secondary" id="scCompareBtn" data-act="compare" aria-expanded="false" aria-controls="scCmp" hidden>${ic('git-compare-arrows')}<span>Сравнить</span></button>
          <button type="button" class="btn small secondary" data-act="print">${ic('printer')}<span>Печать / PDF</span></button>
        </div>
        <div class="scenlist" id="scSaved" hidden></div>
      </article>
      <article class="card sc-out" id="scResult" aria-live="polite"></article>
    </div>
    <section class="card compare sc-cmp" id="scCmp" aria-label="Сравнение сценариев" hidden></section>
    <button type="button" class="sc-sticky off" id="scSticky" data-act="jump" aria-hidden="true" tabindex="-1"><span>Чистыми в месяц</span><b></b><i class="sc-go">${IC.chev}</i></button>
  </div>`;
  buildFields();
  bind(mount);
  render();
  renderSaved();
  watchSticky();
}
