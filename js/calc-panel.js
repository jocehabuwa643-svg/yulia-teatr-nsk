/* calc-panel.js — раздел «Калькуляторы»: вкладки, поля ввода, пресеты, именованные сценарии со сравнением,
   ручной ввод через <dialog>, допущения проекта, печать. Расчётов здесь нет: calc() — в js/calculators/*,
   отрисовка результата — в js/ui/calc-ui.js. Числовых констант тоже нет — всё из cfg (data/*.json). */
import { $, $$, ic, icons, toast, store, popNumber } from './ui/helpers.js';
import { fieldHTML, readInputs, rangeValues, writeInputs, renderResult, bindNumberSync, sourcesHTML, methodHTML } from './ui/calc-ui.js';
import { askDialog } from './ui/calc-dialog.js';
import { registry } from './calculators/index.js';
import { runCalc } from './calculators/run.js';
import { defaultsOf } from './calculators/util.js';
import { loadScenarios, saveScenarios, addScenario, removeScenario, buildComparison } from './calculators/scenarios.js';
import { readOverrides, setOverride, clearOverrides, hasOverrides } from './calculators/overrides.js';
import { buildCalcConfig } from './calculators/config.js';
import { state } from './state.js';

const lastHeadline = {};            // текст большой цифры по калькуляторам — «поп» только при изменении
const picked = {};                  // выбранные для сравнения сценарии: { calcId: Set(id) }
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Группы допущений проекта в диалоге: по первому сегменту пути в config.json */
const GROUPS = { ticket: 'Цена билета', venue_share: 'Доли площадок', travel_costs: 'Выезд: расходы', base_costs: 'База и студия', tour_unit: 'Модель выездов', phases_budget: 'Бюджет запуска' };

function presetChips(mod, cfg) {
  if (mod.meta.id === 'travel') return `<div class="chips" id="quick" role="group" aria-label="Пресеты выезда">${cfg.presets_travel.map((s, i) => `<button type="button" class="chip" data-preset="${i}">${s.name}</button>`).join('')}</div>`;
  if (mod.meta.id === 'basecamp') return `<div class="chips" id="basePresets" role="group" aria-label="Стадии базы">${cfg.stages.map((s, i) => `<button type="button" class="chip" data-stage="${i}">${i === 1 ? s.name + ' · база на Богдашке' : s.name}</button>`).join('')}</div>`;
  return '';
}

const calcCtx = () => ({ market: state.DATA && state.DATA.market, now: Date.now() });   // «сегодня» — только здесь, в слое UI
const uid = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* Поля калькулятора с DOM-id вида «калькулятор__поле» (имена полей у разных калькуляторов совпадают) */
const fieldsOf = m => m.controls(state.CFG).map(f => ({ ...f, dom: `${m.meta.id}__${f.id}` }));

/* Текущее значение полей калькулятора */
function currentInputs(id) {
  const mod = registry.find(m => m.meta.id === id);
  return readInputs(fieldsOf(mod));
}
const activeCalcId = () => registry[Math.max(0, [...$('calcpanels').children].findIndex(p => !p.hidden))].meta.id;

/* ==== Сценарии ==== */
function scenDate(at) { const d = new Date(at); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ru-RU'); }

function renderScenList(id) {
  const list = loadScenarios(store, id);
  const sel = picked[id] || (picked[id] = new Set(list.map(s => s.id)));
  const box = $('scen-' + id);
  if (!box) return;
  box.innerHTML = list.length
    ? `<h4 class="subh">Мои сценарии <span class="tiny">отметьте, что сравнивать</span></h4><ul class="scenul">${list.map(s => `<li>
        <label class="scen-check"><input type="checkbox" data-scen-sel="${s.id}" ${sel.has(s.id) ? 'checked' : ''}><span>${esc(s.name)}</span></label>
        <small class="tiny">${scenDate(s.at)}</small>
        <button type="button" class="btn small secondary" data-scen-open="${s.id}">Открыть</button>
        <button type="button" class="btn small secondary" data-scen-del="${s.id}" aria-label="Удалить сценарий «${esc(s.name)}»">${ic('trash-2')}</button>
      </li>`).join('')}</ul>`
    : '<p class="tiny">Сохранённых сценариев нет: подберите значения и нажмите «Сохранить сценарий» — их можно сравнить таблицей рядом.</p>';
  icons();
}

/* Таблица сравнения: текущий + отмеченные сценарии; итоги пересчитываются по текущим данным */
function renderCompare(id) {
  const mod = registry.find(m => m.meta.id === id);
  const box = $('cmp-' + id);
  if (!box || box.hidden) return;
  const sel = picked[id] || new Set();
  const scenarios = loadScenarios(store, id).filter(s => sel.has(s.id));
  const cmp = buildComparison({ mod, cfg: state.CFG, ctx: calcCtx(), scenarios, currentInputs: currentInputs(id) });
  const head = cmp.cols.map(c => `<th scope="col">${esc(c.name)}${c.at ? `<small>${scenDate(c.at)}</small>` : ''}</th>`).join('');
  const rows = cmp.rows.map(r => `<tr><th scope="row">${esc(r.label)}</th>${r.cells.map(c => `<td>${esc(c.text)}${c.delta ? `<small>${esc(c.delta)}</small>` : ''}</td>`).join('')}</tr>`).join('');
  const inRows = cmp.inputRows.map(r => `<tr class="${r.differs ? 'differs' : ''}"><th scope="row">${esc(r.label)}</th>${r.cells.map(t => `<td>${esc(t)}</td>`).join('')}</tr>`).join('');
  box.innerHTML = `<div class="cmphead"><h3>Сравнение сценариев · ${esc(mod.meta.title)}</h3>
      <div class="toolrow"><button type="button" class="btn small secondary" data-act="print">${ic('printer')}<span>Печать / PDF</span></button><button type="button" class="btn small secondary" data-act="compare">${ic('x')}<span>Скрыть</span></button></div></div>
    ${scenarios.length ? '' : '<p class="tiny">Отметьте сохранённые сценарии выше — они появятся рядом с текущим.</p>'}
    <div class="tablebox"><table class="cmp"><caption class="sr">Показатели сценариев; под значением — разница с текущим</caption><thead><tr><th scope="col">Показатель</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <details><summary>Входные данные сценариев</summary><div class="tablebox"><table class="cmp"><thead><tr><th scope="col">Поле</th>${head}</tr></thead><tbody>${inRows}</tbody></table></div></details>`;
  icons();
}

async function saveScenario(id) {
  const mod = registry.find(m => m.meta.id === id);
  const cfg = state.CFG;
  const list = loadScenarios(store, id);
  const res = await askDialog({
    title: 'Сохранить сценарий',
    lead: `Калькулятор «${esc(mod.meta.title)}». Сохраняются текущие значения полей; итоги при сравнении пересчитываются по актуальным данным.`,
    fields: [{ id: 'name', type: 'text', label: 'Название сценария', value: `Сценарий ${list.length + 1}`, maxLength: cfg.calc.scenarios.max_name_len, hint: 'Одинаковое имя обновляет уже сохранённый сценарий.' }],
    ok: 'Сохранить'
  });
  if (!res || !res.values) return;
  const next = addScenario(list, { name: res.values.name, inputs: currentInputs(id), at: new Date().toISOString(), uid: uid() }, cfg.calc.scenarios.max_saved, cfg.calc.scenarios.max_name_len);
  saveScenarios(store, id, next);
  const added = next.find(s => s.name.toLowerCase() === (res.values.name || '').trim().replace(/\s+/g, ' ').toLowerCase()) || next[next.length - 1];
  (picked[id] || (picked[id] = new Set())).add(added.id);
  renderScenList(id);
  renderCompare(id);
  toast(`Сценарий «${added.name}» сохранён в этом браузере`);
}

/* ==== Ручной ввод и допущения ==== */
function rebuildConfig() { state.CFG = buildCalcConfig(state.DATA, readOverrides(store)); }

async function manualFill(key) {
  const cfg = state.CFG;
  const m = cfg.rateMeta[key] || {};
  const cur = readOverrides(store).rates[key];
  const res = await askDialog({
    title: m.label || key,
    lead: `Значение хранится только в этом браузере и не меняет файлы данных. Источник: ${esc(m.source_name || 'не указан')}. Требует консультации со специалистом.`,
    fields: [{ id: 'v', label: m.label || key, unit: m.unit || '', value: cur != null ? cur : '', hint: esc(m.note || '') }],
    ok: 'Сохранить', extra: cur != null ? 'Убрать мой ввод' : null
  });
  if (!res) return;
  setOverride(store, 'rates', key, res.extra ? null : res.values.v);
  rebuildConfig();
  registry.forEach(mod => rerender(mod.meta.id));
  syncGlobalBar();
  toast(res.extra ? 'Ручное значение убрано' : 'Значение сохранено в этом браузере');
}

async function editAssumptions() {
  const cfg = state.CFG;
  const ov = readOverrides(store);
  const fields = cfg.assumptions.map(a => ({
    id: a.path, type: 'number', label: a.label, unit: a.unit, value: a.value, group: GROUPS[a.path.split('.')[0]] || 'Прочее',
    hint: a.overridden ? `Исходное значение: ${a.original}` : ''
  }));
  const res = await askDialog({
    title: 'Допущения проекта',
    lead: 'Это предположения (confidence: model), а не данные источника. Измените значение — расчёты и обзор пересчитаются после перезагрузки страницы. Хранится только в этом браузере.',
    fields, ok: 'Сохранить и перезагрузить', extra: Object.keys(ov.cfg).length ? 'Вернуть исходные' : null
  });
  if (!res) return;
  if (res.extra) clearOverrides(store, 'cfg');
  else cfg.assumptions.forEach(a => { const v = res.values[a.path]; setOverride(store, 'cfg', a.path, v === a.original ? null : v); });
  location.reload();
}

function syncGlobalBar() {
  const n = Object.keys(readOverrides(store).rates).length;
  const b = $('calcResetManual');
  if (b) { b.hidden = n === 0; b.querySelector('span').textContent = `Сбросить ручной ввод (${n})`; }
}

/* ==== Сборка раздела ==== */
export function initCalc(cfg) {
  const nav = $('calcnav');
  const panels = $('calcpanels');
  nav.innerHTML = registry.map((m, i) => `<button type="button" id="tab-${m.meta.id}" class="mode ${i ? '' : 'on'}" role="tab" aria-controls="calc-${m.meta.id}" aria-selected="${i === 0}" aria-pressed="${i === 0}" tabindex="${i ? -1 : 0}" title="${esc(m.meta.title)}">${ic(m.meta.icon)}<span class="mode-t">${esc(m.meta.short || m.meta.title)}</span></button>`).join('');
  nav.insertAdjacentHTML('beforebegin', `<div class="toolrow calcglobal" id="calcglobal">
      <button type="button" class="btn small secondary" data-gact="assume">${ic('sliders-horizontal')}<span>Допущения проекта</span></button>
      <button type="button" class="btn small secondary" id="calcResetManual" data-gact="resetmanual" hidden>${ic('rotate-ccw')}<span>Сбросить ручной ввод</span></button>
    </div>`);

  const activate = (i, focus) => {
    $$('#calcpanels > div').forEach((p, j) => { p.hidden = j !== i; });
    $$('#calcnav .mode').forEach((m, j) => { m.classList.toggle('on', i === j); m.setAttribute('aria-pressed', String(i === j)); m.setAttribute('aria-selected', String(i === j)); m.tabIndex = i === j ? 0 : -1; });
    if (focus) $$('#calcnav .mode')[i].focus();
    store.set('calc.tab', registry[i].meta.id);
  };
  nav.onclick = e => { const b = e.target.closest('button'); if (b) activate([...nav.children].indexOf(b)); };
  nav.onkeydown = e => {           // стрелки/Home/End — переключение вкладок с клавиатуры
    const i = [...nav.children].findIndex(b => b === document.activeElement);
    if (i < 0) return;
    const n = registry.length;
    const next = { ArrowRight: (i + 1) % n, ArrowDown: (i + 1) % n, ArrowLeft: (i + n - 1) % n, ArrowUp: (i + n - 1) % n, Home: 0, End: n - 1 }[e.key];
    if (next == null) return;
    e.preventDefault(); activate(next, true);
  };

  panels.innerHTML = registry.map((m, i) => {
    const fields = fieldsOf(m);
    return `<div id="calc-${m.meta.id}" class="calcgrid" role="tabpanel" aria-labelledby="tab-${m.meta.id}" ${i ? 'hidden' : ''}>
      <article class="card rv calc-in">
        <h3 class="calc-title">${esc(m.meta.title)}</h3>
        <details class="calcmore"><summary>О расчёте: что считает и когда нужен</summary><div class="calcdesc"><span><b>Что считает:</b> ${m.meta.what.replace(/^Считает:\s*/, '')}</span><span><b>Когда:</b> ${m.meta.when.replace(/^Когда:\s*/, '')}</span></div>${m.meta.more ? `<p class="tiny">${m.meta.more}</p>` : ''}</details>
        ${presetChips(m, cfg)}
        <div class="controls">${fields.map(fieldHTML).join('')}</div>
        <div class="toolrow">
          <button type="button" class="btn small secondary" data-act="reset">${ic('rotate-ccw')}<span>Сбросить</span></button>
          <button type="button" class="btn small secondary" data-act="save">${ic('bookmark')}<span>Сохранить сценарий</span></button>
          <button type="button" class="btn small secondary" data-act="compare" aria-expanded="false" aria-controls="cmp-${m.meta.id}">${ic('git-compare-arrows')}<span>Сравнить сценарии</span></button>
          <button type="button" class="btn small secondary" data-act="print">${ic('printer')}<span>Печать / PDF</span></button>
        </div>
        <div class="scenlist" id="scen-${m.meta.id}"></div>
        <details><summary>Допущения и источники данных</summary><div id="meth-${m.meta.id}"></div></details>
      </article>
      <article class="card result rv" id="res-${m.meta.id}" aria-live="polite"></article>
      <section class="card compare" id="cmp-${m.meta.id}" aria-label="Сравнение сценариев" hidden></section>
    </div>`;
  }).join('');

  // Восстановить последние значения полей (удобство; без них — значения по умолчанию)
  registry.forEach(m => { const saved = store.get('calc.in.' + m.meta.id, null); if (saved && typeof saved === 'object') writeInputs(fieldsOf(m), saved); });
  const tab = store.get('calc.tab', null);
  const ti = registry.findIndex(m => m.meta.id === tab);
  if (ti > 0) activate(ti);

  // Пресеты
  $('calc-travel').querySelector('#quick').onclick = e => {
    const b = e.target.closest('[data-preset]'); if (!b) return;
    const s = cfg.presets_travel[+b.dataset.preset];
    writeInputs(fieldsOf(registry.find(m => m.meta.id === 'travel')), { kids: s.n, ticket: s.p, cluster: s.k, route: s.r, venue: s.dk, cast: s.own });
    rerender('travel');
  };
  $('calc-basecamp').querySelector('#basePresets').onclick = e => {
    const b = e.target.closest('[data-stage]'); if (!b) return;
    const m = cfg.stages[+b.dataset.stage];
    writeInputs(fieldsOf(registry.find(x => x.meta.id === 'basecamp')), { area: cfg.calc.base_area_default, rent: cfg.base_costs.rent_per_m2, students: m.students, sub: m.subscription, week: m.weekend_shows, party: m.parties, attendance: m.weekend_audience, eventprice: m.party_check });
    rerender('basecamp');
  };

  // Ввод: ползунок и число — через синхронизацию; select — по change
  bindNumberSync(panels, () => rerender(activeCalcId()));
  panels.addEventListener('change', e => { if (e.target.matches('select')) rerender(activeCalcId()); });

  // Кнопки панели (делегирование): сброс, сценарии, печать, ручной ввод
  panels.addEventListener('click', e => {
    const id = activeCalcId();
    const fill = e.target.closest('[data-fill]');
    if (fill) { manualFill(fill.dataset.fill); return; }
    const so = e.target.closest('[data-scen-open]');
    if (so) {
      const s = loadScenarios(store, id).find(x => x.id === so.dataset.scenOpen);
      if (s) { writeInputs(fieldsOf(registry.find(m => m.meta.id === id)), s.inputs); rerender(id); toast(`Открыт сценарий «${s.name}»`); }
      return;
    }
    const sd = e.target.closest('[data-scen-del]');
    if (sd) {
      saveScenarios(store, id, removeScenario(loadScenarios(store, id), sd.dataset.scenDel));
      (picked[id] || new Set()).delete(sd.dataset.scenDel);
      renderScenList(id); renderCompare(id); toast('Сценарий удалён');
      return;
    }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'reset') {
      const mod = registry.find(m => m.meta.id === id);
      writeInputs(fieldsOf(mod), defaultsOf(fieldsOf(mod)));
      rerender(id);
    }
    if (act === 'save') saveScenario(id);
    if (act === 'compare') {
      const box = $('cmp-' + id);
      const open = box.hidden;
      box.hidden = !open;
      panels.querySelectorAll(`#calc-${id} [data-act=compare][aria-expanded]`).forEach(x => x.setAttribute('aria-expanded', String(open)));
      if (open) {
        renderCompare(id);
        if (!loadScenarios(store, id).length) toast('Сначала сохраните хотя бы один сценарий — текущий сравнится с ним');
        box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
    if (act === 'print') window.print();
  });
  panels.addEventListener('change', e => {
    const c = e.target.closest('[data-scen-sel]'); if (!c) return;
    const id = activeCalcId();
    const set = picked[id] || (picked[id] = new Set());
    if (c.checked) set.add(c.dataset.scenSel); else set.delete(c.dataset.scenSel);
    renderCompare(id);
  });

  // Глобальная полоса: допущения проекта и сброс ручного ввода
  $('calcglobal').addEventListener('click', e => {
    const b = e.target.closest('[data-gact]'); if (!b) return;
    if (b.dataset.gact === 'assume') editAssumptions();
    if (b.dataset.gact === 'resetmanual') {
      clearOverrides(store, 'rates'); rebuildConfig();
      registry.forEach(m => rerender(m.meta.id)); syncGlobalBar(); toast('Ручной ввод сброшен');
    }
  });
  syncGlobalBar();
  registry.forEach(m => { renderScenList(m.meta.id); rerender(m.meta.id); });

  // печать: «Подробнее» результата раскрывается (график и расходы нужны в документе), после печати возвращается как было
  let printOpened = [];
  addEventListener('beforeprint', () => { printOpened = $$('details.res-more:not([open])'); printOpened.forEach(d => { d.open = true; }); });
  addEventListener('afterprint', () => { printOpened.forEach(d => { d.open = false; }); printOpened = []; });
}

/* Пересчёт и перерисовка одного калькулятора */
export function rerender(id) {
  const mod = registry.find(m => m.meta.id === id);
  const cfg = state.CFG;
  const fields = fieldsOf(mod);
  rangeValues(fields);
  const inputs = readInputs(fields);
  store.set('calc.in.' + id, inputs);
  const el = $('res-' + id);
  let result;
  const wasOpen = !!el.querySelector('details.res-more[open]');      // раскрытое «Подробнее» остаётся раскрытым после пересчёта
  try {
    result = runCalc(mod, inputs, cfg, calcCtx());
    el.innerHTML = renderResult(mod, inputs, cfg, result, state.DATA);
    const more = el.querySelector('details.res-more');
    if (more && wasOpen) more.open = true;
  } catch (e) {
    console.error(`[калькулятор ${id}]`, e);
    el.innerHTML = `<div class="nodata"><strong>Не удалось построить результат</strong><span>${esc(e && e.message || e)}. Нажмите «Сбросить» или проверьте значения полей.</span></div>`;
    return;
  }
  const year = inputs.year != null ? inputs.year : cfg.year;
  const meth = $('meth-' + id);
  if (meth) meth.innerHTML = `<h4 class="subh">Как считается</h4>${methodHTML(id, cfg, year)}<h4 class="subh">Значения и источники</h4>${sourcesHTML(mod, cfg, year)}`;
  // большая цифра: акцент «поп» (transform/opacity) только если значение реально изменилось
  const big = el.querySelector('.big-num');
  const text = big ? big.textContent.trim() : '';
  if (big && lastHeadline[id] !== undefined && lastHeadline[id] !== text) popNumber(big);
  lastHeadline[id] = text;
  renderCompare(id);
  icons();
}

/* Ручные значения и допущения: пересобрать конфиг до первого расчёта (вызывается из app.js до initCalc) */
export function applyOverrides() {
  const ov = readOverrides(store);
  if (hasOverrides(ov)) state.CFG = buildCalcConfig(state.DATA, ov);
}
