/* preset-cards.js — «Рассчитай за 5 секунд»: карточки-кейсы в начале раздела калькуляторов.
   Каскадное мерцание (shimmer) привлекает внимание, останавливается при наведении/фокусе.
   Клик — карточка FLIP-раскрывается на том же месте в полную панель результата;
   остальные сжимаются в компактную ленту. Esc/клик-вне закрывают, фокус возвращается.
   Самоподключаемый модуль (dynamic import из boot.js). prefers-reduced-motion — без анимаций. */
import { travelCalc } from './calculators/travel.js';
import { calc as baseCalc, baseMonth } from './calculators/basecamp.js';
import { calc as goalCalc } from './calculators/goal.js';
import { buildCalcConfig } from './calculators/config.js';

const fmtN = v => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(v)).replace(/-/g, '−');
const rub = v => fmtN(v) + ' ₽';
const signed = v => (Math.round(v) > 0 ? '+' : '') + rub(v);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let CFG = null;

/* Кейсы: пресет + как считать + что показать. Числа — только через calc() из конфигурации. */
function cases(cfg) {
  const out = cfg.presets_travel.map((p, i) => {
    const r = travelCalc({ n: p.n, p: p.p, k: p.k, r: p.r, dk: p.dk, own: p.own }, cfg);
    return {
      key: 't' + i, title: p.name, calcId: 'travel', presetIndex: i,
      params: `${p.n} детей × ${p.p} ₽${p.k > 1 ? ' × ' + p.k + ' показа' : ''}${p.dk ? ' · зал ДК' : ''}${p.r ? ' · ' + cfg.routes_gas[p.r].name : ''}${p.own ? ' · основатели' : ''}`,
      headline: signed(r.per), headlineNote: 'чистыми с показа',
      bar: [r.salary + r.social, r.fuel + r.wear + r.print, r.fee + r.tax, Math.max(0, r.profit)],
      detail: `<div class="pc-kv"><span>Выручка дня</span><b>${rub(r.gross)}</b></div>
               <div class="pc-kv"><span>Прибыль дня</span><b>${signed(r.profit)}</b></div>
               <div class="pc-kv"><span>Маржа</span><b>${r.gross > 0 ? Math.round(100 * r.profit / r.gross) : 0}%</b></div>
               <div class="pc-kv"><span>Безубыточность</span><b>${r.be} зрит./день</b></div>`,
      advice: r.profit < 0 ? 'Убыточный сценарий: объедините группы или поднимите минимальную кассу.' : r.margin < 25 ? 'Запас небольшой: второй показ по тому же адресу снизит транспорт.' : 'Хороший запас — фиксируйте число детей письменно.'
    };
  });
  // «База на Богдашке» — стадия «Разгон»
  const st = cfg.stages[1];
  const m = { area: 130, rent: cfg.base_costs.rent_per_m2, s: st.students, p: st.subscription, w: st.weekend_shows, a: st.weekend_audience, h: st.parties, c: st.party_check };
  const b = baseMonth(m, cfg);
  out.push({
    key: 'base', title: 'База на Богдашке · «Разгон»', calcId: 'basecamp', presetIndex: 1,
    params: `${st.students} учеников · ${st.weekend_shows} показов выходных · ${st.parties} праздников · 130 м²`,
    headline: signed(b.profit), headlineNote: 'база за месяц, без выездов',
    bar: [b.teachers + b.week + b.party, b.fixed, b.tax, Math.max(0, b.profit)],
    detail: `<div class="pc-kv"><span>Выручка базы</span><b>${rub(b.gross)}</b></div>
             <div class="pc-kv"><span>Аренда и фикс</span><b>${rub(b.fixed)}</b></div>
             <div class="pc-kv"><span>ФОТ и праздники</span><b>${rub(b.teachers + b.week + b.party)}</b></div>
             <div class="pc-kv"><span>Рентабельность</span><b>${b.gross > 0 ? Math.round(100 * b.profit / b.gross) : 0}%</b></div>`,
    advice: 'Стадия «Разгон»: выезды сверху добавляют ≈7 550 ₽ с показа до 55 в месяц.'
  });
  // Цель
  const g = goalCalc({ goal: cfg.goals.short_target, stageSel: 1 }, cfg);
  out.push({
    key: 'goal', title: `Хочу ${fmtN(cfg.goals.short_target)} ₽ чистыми`, calcId: 'goal', presetIndex: -1,
    params: 'цель в месяц · стадия «Разгон» · 130 м²',
    headline: `${g.x.n} показов`, headlineNote: `плюс ${g.students} учеников и ${g.x.t} ${g.x.t === 1 ? 'труппа' : 'труппы'}`,
    bar: null,
    detail: `<div class="pc-kv"><span>Плановая прибыль</span><b>${signed(g.x.profit)}</b></div>
             <div class="pc-kv"><span>Зрителей на выездах</span><b>${fmtN(g.x.n * g.x.aud)}</b></div>
             <div class="pc-kv"><span>Выручка месяца</span><b>${rub(g.x.g)}</b></div>`,
    advice: g.plan ? 'Цель достижима на этой стадии — план выше.' : 'Цель выше мощности стадии: зрелая база или ниже цель.'
  });
  return out;
}

const BAR_LABELS = ['ФОТ и взносы', 'Транспорт и реквизит', 'Налоги и доли', 'Остаток Юлии'];

function cardHTML(c) {
  const bar = c.bar ? `<div class="pc-bar" role="img" aria-label="Структура выручки">${c.bar.map((v, i) =>
    `<span class="pc-s${i + 1}" style="width:${Math.max(0, v) / Math.max(1, c.bar.reduce((a, x) => a + Math.max(0, x), 0)) * 100}%"></span>`).join('')}</div>
    <div class="pc-legend">${BAR_LABELS.map((l, i) => `<span class="pc-l${i + 1}">${l}</span>`).join('')}</div>` : '';
  return `<div class="pc-top"><h3>${esc(c.title)}</h3><span class="pc-arrow" aria-hidden="true">→</span></div>
    <p class="pc-params">${esc(c.params)}</p>
    <div class="pc-num">${c.headline}<small>${esc(c.headlineNote)}</small></div>
    ${bar}`;
}

let expandedKey = null, lastFocus = null;

function flipExpand(card, c) {
  lastFocus = card;
  const container = document.getElementById('presetCards');
  container.classList.add('compact');
  document.querySelectorAll('.pc-card.expanded').forEach(x => x.classList.remove('expanded'));
  card.classList.add('expanded');
  card.setAttribute('aria-expanded', 'true');
  expandedKey = c.key;
  stopShimmer();
  const panel = `
    ${cardHTML(c)}
    <div class="pc-detail">${c.detail}</div>
    <p class="pc-advice"><b>Совет помощника:</b> ${esc(c.advice)}</p>
    <div class="pc-actions">
      <button class="btn small primary" data-open>Изменить параметры</button>
      <button class="btn small secondary" data-close>Закрыть</button>
    </div>`;
  // FLIP: первый кадр — старый размер, затем анимируем к раскрытому
  const first = card.getBoundingClientRect();
  card.innerHTML = panel;
  card.querySelector('[data-open]').addEventListener('click', () => openInCalc(c));
  card.querySelector('[data-close]').addEventListener('click', e => { e.stopPropagation(); collapse(card); });
  const last = card.getBoundingClientRect();
  if (!reduced() && last.height && first.height) {
    card.animate([
      { transform: `scaleY(${first.height / last.height}) scaleX(${first.width / last.width})`, transformOrigin: 'top left', opacity: .6 },
      { transform: 'none', opacity: 1 }
    ], { duration: 380, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
  card.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' });
  card.querySelector('[data-close]').focus();
}

function collapse(card) {
  const c = card._case;
  const container = document.getElementById('presetCards');
  card.classList.remove('expanded');
  card.setAttribute('aria-expanded', 'false');
  expandedKey = null;
  const first = card.getBoundingClientRect();
  card.innerHTML = cardHTML(c);
  const last = card.getBoundingClientRect();
  if (!reduced() && first.height && last.height) {
    card.animate([
      { transform: `scaleY(${first.height / last.height}) scaleX(${first.width / last.width})`, transformOrigin: 'top left' },
      { transform: 'none' }
    ], { duration: 260, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
  if (!container.querySelector('.expanded')) container.classList.remove('compact');
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

function openInCalc(c) {
  // штатный поток: вкладка + пресет-чип (обработчики calc-panel применяют значения и пересчитывают)
  const tab = document.getElementById('tab-' + c.calcId);
  if (tab) tab.click();
  if (c.calcId === 'travel' && c.presetIndex >= 0) {
    const chip = document.querySelector(`#calc-travel #quick [data-preset="${c.presetIndex}"]`);
    if (chip) chip.click();
  } else if (c.calcId === 'basecamp' && c.presetIndex >= 0) {
    const chip = document.querySelector(`#calc-basecamp #basePresets [data-stage="${Math.max(0, c.presetIndex)}"]`);
    if (chip) chip.click();
  }
  const panel = document.querySelector('#calcpanels > div:not([hidden])');
  if (panel) panel.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
}

function stopShimmer() {
  const c = document.getElementById('presetCards');
  if (c) c.classList.add('no-shimmer');
}

export async function initPresetCards() {
  const mount = document.getElementById('presetCards');
  if (!mount || mount.children.length) return;
  const [rates, config, competitors] = await Promise.all([
    fetch('data/rates.json').then(r => r.json()),
    fetch('data/config.json').then(r => r.json()),
    fetch('data/competitors.json').then(r => r.json()).catch(() => ({}))
  ]);
  CFG = buildCalcConfig({ rates, config, competitors });
  const list = cases(CFG);
  mount.innerHTML = list.map(c => `<button class="pc-card rv in" data-key="${c.key}" aria-expanded="false" aria-controls="pcPanel"></button>`).join('');
  [...mount.querySelectorAll('.pc-card')].forEach((card, i) => {
    const c = list[i];
    card._case = c;
    card.innerHTML = cardHTML(c);
    card.addEventListener('click', () => (expandedKey === c.key ? collapse(card) : flipExpand(card, c)));
  });
  // мерцание останавливается при взаимодействии с любой карточки
  mount.addEventListener('pointerenter', stopShimmer, { once: true, capture: true });
  mount.addEventListener('focusin', stopShimmer, { once: true, capture: true });
  // Esc и клик вне — закрыть
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && expandedKey) {
      const card = mount.querySelector('.expanded');
      if (card) collapse(card);
    }
  });
  document.addEventListener('click', e => {
    if (!expandedKey) return;
    if (!e.target.closest('#presetCards')) {
      const card = mount.querySelector('.expanded');
      if (card) collapse(card);
    }
  }, true);
}

if (typeof document !== 'undefined') {
  const start = () => initPresetCards().catch(() => { /* данные не готовы — карточек не будет, калькуляторы работают */ });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
