/* preset-cards.js — «Рассчитай за 5 секунд»: карточки-кейсы в начале раздела калькуляторов.
   Каскадное мерцание (shimmer) привлекает внимание, останавливается при наведении/фокусе.
   Быстрый расчёт — на самой карточке. Клик открывает отдельный экран шаблона (js/preset-detail.js):
   «что будет при таком варианте», кнопка «← Назад в меню», Esc/клик вне/«назад» браузера, фокус возвращается на карточку.
   Запускается из js/app.js при сборке раздела калькуляторов (initPresetCards(CFG)). prefers-reduced-motion — без анимаций. */
import { travelCalc } from './calculators/travel.js';
import { calc as baseCalc, baseMonth } from './calculators/basecamp.js';
import { calc as goalCalc } from './calculators/goal.js';
import { buildCalcConfig } from './calculators/config.js';
import { fmtN, rub, signed, esc, travelDetail, baseDetail, goalDetail, openPresetDetail } from './preset-detail.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let CFG = null;

/* Модель экрана шаблона; сбой расчёта не ломает карточку — экран честно скажет, что данных нет */
const safeDetail = fn => { try { return fn(); } catch (e) { return null; } };

/* Кейсы: пресет + как считать + что показать. Числа — только через calc() из конфигурации. */
export function cases(cfg) {
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
      d: safeDetail(() => travelDetail(p, r, cfg)),
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
    d: safeDetail(() => baseDetail(st, b, goalCalc({ goal: cfg.goals.short_target, stageSel: 2 }, cfg), cfg)),
    advice: `Стадия «Разгон»: выезды сверху добавляют ≈${fmtN(cfg.tour_unit.unit_small)} ₽ с показа, до ${cfg.tour_unit.capacity_per_troupe} в месяц на труппу.`
  });
  // Цель
  // stageSel 2 = cfg.stages[1] = «Разгон» (0 — без базы, i — cfg.stages[i-1]); подпись карточки говорит именно «Разгон»
  const g = goalCalc({ goal: cfg.goals.short_target, stageSel: 2 }, cfg);
  out.push({
    key: 'goal', title: `Хочу ${fmtN(cfg.goals.short_target)} ₽ чистыми`, calcId: 'goal', presetIndex: -1,
    params: 'цель в месяц · стадия «Разгон» · 130 м²',
    headline: `${g.x.n} показов`, headlineNote: `плюс ${g.students} учеников и ${g.x.t} ${g.x.t === 1 ? 'труппа' : 'труппы'}`,
    bar: null,
    detail: `<div class="pc-kv"><span>Плановая прибыль</span><b>${signed(g.x.profit)}</b></div>
             <div class="pc-kv"><span>Зрителей на выездах</span><b>${fmtN(g.x.n * g.x.aud)}</b></div>
             <div class="pc-kv"><span>Выручка месяца</span><b>${rub(g.x.g)}</b></div>`,
    d: safeDetail(() => goalDetail(g, g.model ? baseMonth(g.model, cfg) : null, cfg.stages[1].name, cfg)),
    advice: g.plan ? 'Цель достижима на этой стадии: детали на экране шаблона.' : 'Цель выше мощности стадии: зрелая база или ниже цель.'
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

export async function initPresetCards(cfg = null) {
  const mount = document.getElementById('presetCards');
  if (!mount || mount.children.length) return;
  // Конфигурация приложения (с правками Юлии) — если передана; иначе собираем из файлов данных
  if (cfg) CFG = cfg;
  else {
    const [rates, config, competitors] = await Promise.all([
      fetch('data/rates.json').then(r => r.json()),
      fetch('data/config.json').then(r => r.json()),
      fetch('data/competitors.json').then(r => r.json()).catch(() => ({}))
    ]);
    CFG = buildCalcConfig({ rates, config, competitors });
  }
  let list;
  try { list = cases(CFG); } catch (e) {
    // нет данных или сбой расчёта — честная подпись вместо пустого места
    mount.innerHTML = '<p class="pc-empty">Шаблоны сейчас недоступны: не удалось посчитать по данным. Откройте нужный калькулятор ниже.</p>';
    return;
  }
  mount.innerHTML = list.map(c => `<button type="button" class="pc-card rv in" data-key="${c.key}" aria-haspopup="dialog"></button>`).join('');
  [...mount.querySelectorAll('.pc-card')].forEach((card, i) => {
    const c = list[i];
    card._case = c;
    card.innerHTML = cardHTML(c);
    // клик открывает отдельный экран шаблона; повторный быстрый клик игнорируется самим экраном
    card.addEventListener('click', () => { stopShimmer(); openPresetDetail({ list, key: c.key, opener: card, onTune: openInCalc, focusTarget: k => mount.querySelector(`.pc-card[data-key="${k}"]`) }); });
  });
  // мерцание останавливается при взаимодействии с любой карточки
  mount.addEventListener('pointerenter', stopShimmer, { once: true, capture: true });
  mount.addEventListener('focusin', stopShimmer, { once: true, capture: true });
}
