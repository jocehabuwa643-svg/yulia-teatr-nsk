/* calc-panel.js — раздел «Калькуляторы»: вкладки, поля ввода, пресеты, сценарии, печать. */
import { $, $$, rub, ic, icons, toast, store } from './ui/helpers.js';
import { fieldHTML, readInputs, rangeValues, renderResult } from './ui/calc-ui.js';
import { registry } from './calculators/index.js';
import { state } from './state.js';

const lastHeadline = {};

/* ==== Тексты допущений (провенанс) по калькуляторам ==== */
const METHOD = {
  travel: 'Число зрителей задано на один показ. В городе команда получает 5 000 ₽ за одиночный показ или 4 300 ₽ за каждый в кластере; в ДК 6 500 ₽ за показ. При гастролях гарантированный гонорар дня 15 500 ₽ (два актёра по 6 000 ₽ и техник 3 500 ₽). ГСМ делятся на весь день; для ДК в городе добавлена доставка 200 ₽. Износ 400 ₽/показ, в ДК 600 ₽. Полиграфия 10 ₽/зритель. Наём: модельная надбавка 30,2%. Комиссия площадки и УСН — с валовой кассы. Личные взносы ИП и постоянные расходы здесь не списываются. Ставки — из data/config.json (предположения проекта) и data/rates.json.',
  basecamp: 'Фикс: площадь × (ставка + 200 ₽ КУ) + 35 000 ₽ администрирования + 20 000 ₽ рекламы. Группа до 10 учеников: 8 уроков × 1 200 ₽ × 1,302. Выходной: билет 350 ₽, гонорар 3 500 ₽ × 1,302 + 300 ₽ реквизита + 3% кассы. Праздник: переменные 2 953 ₽. УСН 6%, льготы и вычеты не заложены. До 55 выездов: 50 × 325 ₽ и 7 550 ₽ вклада с показа. С 56-го: модель гастролей с 55 зрителями, 17 875 ₽ выручки, 7 965,12 ₽ вклада до поправки на НДС (≈7 165 ₽ после неё). Мощность 55 показов/труппа. НДС в цене по 5/105 и штаб 150 000 ₽ при темпе выше 20 млн ₽/год (228-ФЗ). Цена воспроизводства доп. комплекта 180–220 тыс. ₽.',
  goal: 'Обратная задача решается прямым перебором целых показов на точной модели базы+выездов (функция монотонна по числу показов). Ученики и загрузка выходных зафиксированы стадией. До февраля — одна труппа до 55 показов, после открытия — до 200.',
  taxes: 'Ставки и пороги — только из data/rates.json с источниками и датами. Отсутствующие значения (патент, фиксированные взносы ИП) честно показываются как «нет данных» и вводятся вручную. НДС 5% — только при годовой выручке сверх порога 20 млн ₽ (228-ФЗ). Вычет взносов из УСН, НДФЛ и региональные нюансы — консультация со специалистом.',
  payroll: 'Считаются взносы заказчика по модельной ставке 30,2% (rates.json). НПД: исполнитель платит налог сам, заказчик взносов не платит — но схема законна только при реальной самостоятельности подрядчика. НДФЛ сознательно не считается: проверенной ставки в data/ нет.',
  pricing: 'Цена из маржи: P = прямые расходы ÷ (зрители × (1 − доля переменных − маржа)). Тепловая карта считается тем же калькулятором выезда по сетке «цена × аудитория».',
  parties: 'Переменные праздника 2 953 ₽ и ФОТ по формуле выходного показания — из модели проекта. Ориентир рынка: PlayPanda, 5 000 ₽/час, пакеты 21 000–26 000 ₽ (data/competitors.json).',
  cashflow: 'Декабрь–август — базовый прогноз модели (9 месяцев). Сентябрь–ноябрь — проекция для 12-месячного графика, помечена звёздочкой. Вклад выездов: базовый прогноз месяца + правка показов × вклад показа из config (7 550 ₽).',
  grants: 'Только конкурсы с проверенными окнами из data/market.json (срез 18.11.2026). Даты парсятся из строк окна и итогов.'
};

function presetChips(mod, cfg) {
  if (mod.meta.id === 'travel') return `<div class="chips" id="quick" role="group" aria-label="Пресеты выезда">${cfg.presets_travel.map((s, i) => `<button class="chip" data-preset="${i}">${s.name}</button>`).join('')}</div>`;
  if (mod.meta.id === 'basecamp') return `<div class="chips" id="basePresets" role="group" aria-label="Стадии базы">${cfg.stages.map((s, i) => `<button class="chip" data-stage="${i}">${i === 1 ? s.name + ' · база на Богдашке' : s.name}</button>`).join('')}</div>`;
  return '';
}

export function initCalc(cfg) {
  $('calcnav').innerHTML = registry.map((m, i) => `<button class="mode ${i ? '' : 'on'}" role="tab" aria-selected="${i === 0}" aria-pressed="${i === 0}">${ic(m.meta.icon)}${m.meta.title}<small>${m.meta.when}</small></button>`).join('');
  $('calcnav').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const i = [...$('calcnav').children].indexOf(b);
    $$('#calcpanels > div').forEach((p, j) => p.hidden = j !== i);
    $$('#calcnav .mode').forEach((m, j) => { m.classList.toggle('on', i === j); m.setAttribute('aria-pressed', String(i === j)); m.setAttribute('aria-selected', String(i === j)); });
  };
  $('calcpanels').innerHTML = registry.map((m, i) => {
    const fields = m.controls(cfg);
    return `<div id="calc-${m.meta.id}" class="calcgrid" role="tabpanel" ${i ? 'hidden' : ''}>
      <article class="card rv">
        <div class="calcdesc"><b>Что считает:</b> ${m.meta.what}</div>
        <div class="calcdesc"><b>Когда использовать:</b> ${m.meta.when}</div>
        ${presetChips(m, cfg)}
        <div class="controls">${fields.map(fieldHTML).join('')}</div>
        <div class="toolrow">
          <button class="btn small secondary" data-act="reset">${ic('rotate-ccw')}<span>Сбросить</span></button>
          <button class="btn small secondary" data-act="save">${ic('bookmark')}<span>Сохранить сценарий</span></button>
          <button class="btn small secondary" data-act="compare">${ic('git-compare-arrows')}<span>Сравнить с сохранённым</span></button>
          <button class="btn small secondary" data-act="print">${ic('printer')}<span>Печать / PDF</span></button>
        </div>
        <details><summary>Допущения и источники данных</summary><p>${METHOD[m.meta.id] || ''}</p></details>
      </article>
      <article class="card result rv" id="res-${m.meta.id}" aria-live="polite"></article>
    </div>`;
  }).join('');

  // Пресеты
  const travelPanel = $('calc-travel');
  travelPanel.querySelector('#quick').onclick = e => {
    const b = e.target.closest('[data-preset]'); if (!b) return;
    const s = cfg.presets_travel[+b.dataset.preset];
    Object.entries({ kids: s.n, ticket: s.p, cluster: s.k, route: s.r, venue: s.dk, cast: s.own }).forEach(([k, v]) => { const el = $(k); if (el) el.value = v; });
    rerender('travel');
  };
  const basePanel = $('calc-basecamp');
  basePanel.querySelector('#basePresets').onclick = e => {
    const b = e.target.closest('[data-stage]'); if (!b) return;
    const m = cfg.stages[+b.dataset.stage];
    Object.entries({ area: 130, rent: 1000, students: m.students, sub: m.subscription, week: m.weekend_shows, party: m.parties, attendance: m.weekend_audience, eventprice: m.party_check }).forEach(([k, v]) => { const el = $(k); if (el) el.value = v; });
    rerender('basecamp');
  };

  // Ввод
  $('calcpanels').addEventListener('input', e => { if (e.target.matches('input,select')) rerender(activeCalcId()); });
  $('calcpanels').addEventListener('change', e => { if (e.target.matches('select')) rerender(activeCalcId()); });

  // Тулбар
  $('calcpanels').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = activeCalcId();
    if (b.dataset.act === 'reset') {
      const mod = registry.find(m => m.meta.id === id);
      mod.controls(state.CFG).forEach(f => { const el = $(f.id); if (el) el.value = f.def != null ? f.def : (f.options ? f.options[0][0] : ''); });
      rerender(id);
    }
    if (b.dataset.act === 'save') {
      store.set('scen.' + id, { inputs: currentInputs(id), headline: lastHeadline[id], at: new Date().toISOString() });
      toast('Сценарий сохранён в этом браузере');
    }
    if (b.dataset.act === 'compare') {
      const saved = store.get('scen.' + id, null);
      const cur = lastHeadline[id];
      if (!saved || !saved.headline) { toast('Сначала сохраните сценарий'); return; }
      const el = $('res-' + id);
      el.insertAdjacentHTML('afterbegin', `<div class="advice warn"><strong>Сравнение с сохранённым (${new Date(saved.at).toLocaleDateString('ru-RU')})</strong>Сохранённый: <b>${saved.headline}</b> · Текущий: <b>${cur || '—'}</b></div>`);
    }
    if (b.dataset.act === 'print') window.print();
    // «Ввести вручную» для no_data
    if (b.dataset.fill) {
      const v = prompt('Введите проверенное значение (₽/год):');
      if (v != null && !isNaN(+v) && +v >= 0) {
        store.set('ovr.' + b.dataset.fill, +v);
        applyOverrides(); rerender(id); toast('Значение сохранено (переопределение в этом браузере)');
      }
    }
  });

  registry.forEach(m => rerender(m.meta.id));
}

function activeCalcId() { return registry[[...$('calcpanels').children].findIndex(p => !p.hidden)].meta.id; }
function currentInputs(id) {
  const mod = registry.find(m => m.meta.id === id);
  return readInputs(mod.controls(state.CFG));
}
export function rerender(id) {
  const mod = registry.find(m => m.meta.id === id);
  const fields = mod.controls(state.CFG);
  rangeValues(fields);
  const inputs = readInputs(fields);
  // travel читает n/p/k/r/dk/own, а поля формы называются kids/ticket/… — маппинг в fromForm модуля
  const calcInput = mod.fromForm ? mod.fromForm(inputs) : inputs;
  const result = mod.calc(calcInput, state.CFG, state.DATA.market);
  const el = $('res-' + id);
  el.innerHTML = renderResult(mod, inputs, state.CFG, result, state.DATA);
  const big = el.querySelector('.big-num');
  lastHeadline[id] = big ? big.textContent.trim() : rub(result.profit ?? 0);
  icons();
}

/* Ручные переопределения «нет данных» (только в этом браузере) */
export function applyOverrides() {
  const patent = store.get('ovr.patent', null);
  if (patent != null) state.CFG.patentPotential = patent;
}
