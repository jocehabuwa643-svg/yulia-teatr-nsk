/* preset-detail.js — отдельный экран шаблона: «что будет при таком варианте».
   Две части. 1) Чистые функции (без DOM): travelDetail / baseDetail / goalDetail собирают модель экрана
   из результатов существующих калькуляторов — никаких новых формул и цен; единственное преобразование —
   «сколько показов нужно для цели» = цель ÷ прибыль показа (округление вверх), мощность труппы — из config.
   2) Экран: полноэкранный на телефоне, широкая плашка на десктопе; role=dialog, aria-modal, фокус внутрь и возврат,
   Esc, клик вне, «назад» браузера (history.pushState без смены адреса — якоря и router.js не затрагиваются).
   Анимация только transform/opacity; prefers-reduced-motion — итог сразу, числа без счёта. */

export const fmtN = v => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(v)).replace(/-/g, '−');
export const rub = v => fmtN(v) + ' ₽';
export const signed = v => (Math.round(v) > 0 ? '+' : '') + rub(v);
export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct1 = x => String(Math.round(x * 1000) / 10).replace('.', ',');
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const plural = (n, a, b, c) => { const m = Math.abs(n) % 100, d = m % 10; return m > 10 && m < 20 ? c : d === 1 ? a : d > 1 && d < 5 ? b : c; };

/* ================= Чистая часть: модель экрана ================= */

/* Месячная цель из конфигурации (с правками Юлии, если они есть) */
const targetOf = cfg => cfg.goals.short_target;

/* Выездной шаблон. p — пресет, r — результат travelCalc (за выезд-день). */
export function travelDetail(p, r, cfg) {
  const target = targetOf(cfg), cap = cfg.tour_unit.capacity_per_troupe;
  const costs = [
    { label: 'Оплата актёров', v: r.salary },
    { label: 'Взносы за актёров', v: r.social },
    { label: 'Бензин и дорога', v: r.fuel },
    { label: 'Износ реквизита и печать', v: r.wear + r.print },
    { label: p.dk ? 'Доля зала ДК' : 'Оргсбор площадки', v: r.fee },
    { label: 'Налог (УСН)', v: r.tax }
  ];
  const segs = [
    { label: 'Актёры и взносы', v: r.salary + r.social },
    { label: 'Дорога и реквизит', v: r.fuel + r.wear + r.print },
    { label: 'Площадка и налог', v: r.fee + r.tax }
  ];
  const needs = [
    ['Детей на показе', fmtN(p.n)],
    ['Цена билета', rub(p.p)],
    ['Показов в день', fmtN(r.k)],
    ['Площадка', `${p.dk ? 'зал ДК' : 'сад / школа'} · ${pct1(r.rate)}% от выручки`],
    ['Маршрут', cfg.routes_gas[p.r].name],
    ['Состав', p.own ? 'основатели (взносы 0% в модели)' : 'актёры по ГПХ']
  ];
  let verdict;
  if (r.per <= 0) {
    verdict = {
      level: 'bad', title: 'Так не получится: выезд в минусе',
      text: `Каждый показ уносит ${rub(-r.per)}. Чтобы выйти в ноль, нужно не меньше ${fmtN(r.be)} зрителей за день, а при таких вводных их ${fmtN(p.n * r.k)}. Поднимите цену, объедините группы или возьмите площадку ближе.`
    };
  } else {
    const shows = Math.ceil(target / r.per), troupes = Math.ceil(shows / cap), days = Math.ceil(shows / r.k);
    const tail = 'Считаем только выезды, без аренды студии и постоянных расходов проекта.';
    verdict = troupes <= 1 ? {
      level: 'ok', title: 'Достижимо',
      text: `Чтобы набрать ${rub(target)} чистыми в месяц, нужно примерно ${fmtN(shows)} ${plural(shows, 'показ', 'показа', 'показов')} (около ${fmtN(days)} ${plural(days, 'выездного дня', 'выездных дней', 'выездных дней')}). Одна труппа вытягивает до ${fmtN(cap)} показов в месяц. ${tail}`
    } : {
      level: 'warn', title: 'Одной труппой не набрать',
      text: `Для ${rub(target)} чистыми нужно примерно ${fmtN(shows)} ${plural(shows, 'показ', 'показа', 'показов')} в месяц, а одна труппа вытягивает до ${fmtN(cap)}. Понадобится ${troupes} ${plural(troupes, 'труппа', 'труппы', 'трупп')} или выше цена билета. ${tail}`
    };
  }
  return {
    period: 'за выездной день', condition: `Выезд: ${fmtN(p.n)} детей по ${fmtN(p.p)} ₽${r.k > 1 ? `, ${r.k} ${plural(r.k, 'показ', 'показа', 'показов')} в день` : ''}`,
    lead: 'Что будет за один выездной день при таком варианте и хватит ли этого на месячную цель.',
    needs, flow: { revenueLabel: 'Выручка дня', revenue: r.gross, costs, segs, net: r.profit, netLabel: 'Чистыми за день' },
    verdict
  };
}

/* Студия без выездов. st — стадия, b — baseMonth, g — goalCalc для той же стадии. */
export function baseDetail(stage, b, g, cfg) {
  const target = targetOf(cfg), short = target - b.profit;
  const costs = [
    { label: 'Оплата преподавателей', v: b.teachers },
    { label: 'Ведущие и реквизит выходных', v: b.week },
    { label: 'Расходы на праздники', v: b.party },
    { label: 'Аренда, коммуналка, админ., реклама', v: b.fixed },
    { label: 'Налог (УСН)', v: b.tax }
  ];
  const segs = [
    { label: 'Преподаватели и ведущие', v: b.teachers + b.week + b.party },
    { label: 'Аренда и постоянные', v: b.fixed },
    { label: 'Налог', v: b.tax }
  ];
  const needs = [
    ['Учеников', `${fmtN(stage.students)} × ${rub(stage.subscription)} в месяц`],
    ['Показов выходного дня', `${fmtN(stage.weekend_shows)} × ${fmtN(stage.weekend_audience)} зрителей`],
    ['Детских праздников', `${fmtN(stage.parties)} × ${rub(stage.party_check)}`],
    ['Помещение', `${fmtN(cfg.calc.base_area_default)} м² · аренда ${rub(cfg.base_costs.rent_per_m2)} за м²`]
  ];
  let verdict;
  if (b.profit >= target) {
    verdict = { level: 'ok', title: 'Достижимо без выездов', text: `Студия сама даёт ${signed(b.profit)} в месяц — это не меньше цели ${rub(target)}.` };
  } else if (g.plan) {
    verdict = {
      level: 'warn', title: 'Одной студии мало — нужны выезды',
      text: `Студия даёт ${signed(b.profit)} в месяц, до цели ${rub(target)} не хватает ${rub(short)}. Закрыть разрыв помогут примерно ${fmtN(g.x.n)} ${plural(g.x.n, 'выездной показ', 'выездных показа', 'выездных показов')} в месяц (${g.x.t} ${plural(g.x.t, 'труппа', 'труппы', 'трупп')}).`
    };
  } else {
    verdict = {
      level: 'bad', title: 'Цель на этой стадии недостижима',
      text: `Студия даёт ${signed(b.profit)} в месяц, а с выездами на этой стадии максимум около ${signed(g.x.profit)}. До цели ${rub(target)} не хватает ${rub(target - g.x.profit)} — нужна стадия «зрелость» или цель ниже.`
    };
  }
  return {
    period: 'за месяц', condition: `Студия без выездов, стадия «${stage.name}»`,
    lead: `Что даёт студия за месяц на стадии «${stage.name}»: только занятия, показы выходного дня и праздники.`,
    needs, flow: { revenueLabel: 'Выручка студии', revenue: b.gross, costs, segs, net: b.profit, netLabel: 'Чистыми за месяц' },
    verdict
  };
}

/* «Хочу X ₽ чистыми»: g — goalCalc, b — baseMonth стадии (или null), stName — имя стадии. */
export function goalDetail(g, b, stName, cfg) {
  const target = g.goal, x = g.x, total = x.g - x.profit;
  const baseCosts = b ? b.fixed + b.teachers + b.week + b.party : 0;
  const rest = total - baseCosts;
  const segs = b && rest >= 0
    ? [{ label: 'Расходы студии', v: baseCosts }, { label: 'Выезды, налоги, взносы', v: rest }]
    : [{ label: 'Расходы и налоги', v: total }];
  const costs = segs.map(s => ({ ...s }));
  const needs = [
    ['Выездных показов', `${fmtN(x.n)} в месяц`],
    ['Зрителей на выездах', `${fmtN(x.n * x.aud)} (около ${fmtN(x.aud)} на показ)`],
    ['Учеников студии', fmtN(g.students)],
    ['Выездных трупп', fmtN(x.t)],
    ['Стадия', stName]
  ];
  if (x.reg) needs.push(['НДС', 'оборот выше порога — налог учтён в расходах']);
  const verdict = g.plan
    ? { level: 'ok', title: 'Цель достижима', text: `При таких вводных плановая прибыль ${signed(x.profit)} в месяц — не меньше цели ${rub(target)}. Это расчёт по модели: реальный месяц зависит от заполняемости и числа выездов.` }
    : { level: 'bad', title: 'Цель выше мощности этой стадии', text: `Лучшее, что даёт эта стадия, — около ${signed(x.profit)} в месяц. До ${rub(target)} не хватает ${rub(target - x.profit)}. Нужна зрелая студия, больше трупп или цель пониже.` };
  return {
    period: 'за месяц', condition: `Хочу ${rub(target)} чистыми в месяц`,
    lead: `Что понадобится, чтобы получать ${rub(target)} чистыми в месяц на стадии «${stName}».`,
    needs, flow: { revenueLabel: 'Выручка месяца', revenue: x.g, costs, segs, net: x.profit, netLabel: 'Чистыми за месяц' },
    verdict
  };
}

/* Доли для полосы «куда ушли деньги»: база — большее из выручки и расходов (при убытке расходы шире выручки) */
export function barShares(flow) {
  const spent = flow.segs.reduce((a, s) => a + Math.max(0, s.v), 0);
  const net = Math.max(0, flow.net);
  const base = Math.max(flow.revenue, spent + net, 1);
  const items = flow.segs.filter(s => s.v > 0).map(s => ({ label: s.label, v: s.v, share: s.v / base, net: false }));
  if (net > 0) items.push({ label: flow.netLabel, v: net, share: net / base, net: true });
  return items;
}

/* ================= Экран ================= */

let st = null;   // { dlg, key, list, opts, opener, scrollY, pushed, closing, done, resolve, focusBack, onPop, onNativeClose }

const ICON = { ok: '✓', warn: '!', bad: '✕' };

function bodyHTML(c) {
  const d = c.d;
  if (!d) {
    return `<h2 id="pdTitle" class="pd-title" tabindex="-1">${esc(c.title)}</h2>
      <p id="pdLead" class="pd-lead">Не удалось посчитать этот шаблон: не хватает данных. Основной расчёт доступен в калькуляторе.</p>
      <p class="pd-approx">Ориентировочно. Это не бухгалтерская отчётность.</p>
      <div class="pd-actions"><button type="button" class="btn primary" data-pd="tune">Открыть калькулятор</button>
      <button type="button" class="btn secondary" data-pd="back">← Назад в меню</button></div>`;
  }
  const f = d.flow, shares = barShares(f), costTotal = f.revenue - f.net;
  const lossNote = f.net < 0 ? `<p class="pd-loss"><b>В минусе на ${rub(-f.net)}.</b> Расходы больше выручки, поэтому остатка нет.</p>` : '';
  const steps = [
    ['rev', f.revenueLabel, f.revenue, 'rub'],
    ['cost', 'Расходы и налоги', costTotal, 'rub'],
    ['net', f.netLabel, f.net, 'signed']
  ].map(([k, l, v, kind], i) => `<div class="pd-step pd-${k} pd-in" style="--i:${i + 2}">
      <span class="pd-step-l">${esc(l)}</span>
      <b class="pd-count" data-v="${Math.round(v)}" data-kind="${kind}" aria-hidden="true">${kind === 'signed' ? signed(v) : rub(v)}</b>
      <span class="pd-sr">${kind === 'signed' ? signed(v) : rub(v)}</span>
    </div>${i < 2 ? '<span class="pd-flow" aria-hidden="true">→</span>' : ''}`).join('');
  const bar = shares.length
    ? `<div class="pd-bar" role="img" aria-label="Куда ушли деньги: ${esc(shares.map(s => `${s.label} ${Math.round(s.share * 100)}%`).join(', '))}">${shares.map((s, i) =>
      `<span class="pd-seg ${s.net ? 'net' : 'e' + (i % 3)}" style="flex:${s.share} 1 0;--i:${i}"></span>`).join('')}</div>
      <ul class="pd-legend">${shares.map((s, i) => `<li><i class="pd-sw ${s.net ? 'net' : 'e' + (i % 3)}" aria-hidden="true"></i><span>${esc(s.label)}</span><b>${rub(s.v)}</b><em>${Math.round(s.share * 100)}%</em></li>`).join('')}</ul>`
    : '<p class="pd-lead">Выручки нет, показывать нечего.</p>';
  const costRows = f.costs.filter(x => x.v > 0).map(x => `<li><span>${esc(x.label)}</span><b>${rub(x.v)}</b></li>`).join('');
  const others = st.list.filter(x => x.key !== c.key).map(x =>
    `<li><button type="button" class="pd-other" data-pd-key="${esc(x.key)}"><span>${esc(x.title)}</span><b>${esc(x.headline)}</b><small>${esc(x.headlineNote)}</small></button></li>`).join('');
  return `<p class="pd-kicker2 pd-in" style="--i:0">Шаблон · ${esc(d.period)}</p>
    <h2 id="pdTitle" class="pd-title pd-in" style="--i:0" tabindex="-1">${esc(c.title)}</h2>
    <p id="pdLead" class="pd-cond pd-in" style="--i:1">${esc(d.condition)}</p>
    <p class="pd-lead pd-in" style="--i:1">${esc(d.lead)}</p>
    <p class="pd-approx pd-in" style="--i:1"><span aria-hidden="true">≈</span> Ориентировочно: цифры приблизительные, это не бухгалтерская отчётность.</p>

    <section class="pd-sec" aria-labelledby="pdH1"><h3 id="pdH1">Что для этого нужно</h3>
      <ul class="pd-needs">${d.needs.map(([k, v], i) => `<li class="pd-in" style="--i:${i + 1}"><span>${esc(k)}</span><b>${esc(v)}</b></li>`).join('')}</ul></section>

    <section class="pd-sec" aria-labelledby="pdH2"><h3 id="pdH2">Итог ${esc(d.period)}: выручка, расходы, чистыми</h3>
      <div class="pd-steps">${steps}</div>${lossNote}</section>

    <section class="pd-sec" aria-labelledby="pdH3"><h3 id="pdH3">Куда ушли деньги</h3>${bar}
      <details class="pd-more"><summary>Все расходы по строкам</summary><ul class="pd-costs">${costRows || '<li><span>Расходов нет</span><b>0 ₽</b></li>'}</ul></details></section>

    <section class="pd-sec pd-verdict pd-${d.verdict.level}" aria-labelledby="pdH4"><h3 id="pdH4">Достижимо ли это</h3>
      <p class="pd-vt"><i aria-hidden="true">${ICON[d.verdict.level]}</i>${esc(d.verdict.title)}</p>
      <p>${esc(d.verdict.text)}</p>${c.advice ? `<p class="pd-advice"><b>Совет помощника:</b> ${esc(c.advice)}</p>` : ''}</section>

    <div class="pd-actions">
      <button type="button" class="btn primary" data-pd="tune">Подогнать вводные</button>
      <button type="button" class="btn secondary" data-pd="others" aria-expanded="false" aria-controls="pdOthers">К другим шаблонам</button>
      <button type="button" class="btn secondary" data-pd="back">← Назад в меню</button>
    </div>
    <div id="pdOthers" class="pd-others" hidden><h3>Другие шаблоны</h3><ul>${others}</ul></div>`;
}

/* Анимированный счётчик: тик по rAF, в конце — точное значение. Без анимации — сразу итог. */
function runCounters(root) {
  const els = [...root.querySelectorAll('.pd-count')];
  const fmt = (el, v) => (el.dataset.kind === 'signed' ? signed(v) : rub(v));
  const fin = el => { el.textContent = fmt(el, +el.dataset.v); };
  if (reduced()) { els.forEach(fin); return; }
  const t0 = performance.now(), D = 900;
  els.forEach((el, i) => {
    const v = +el.dataset.v, delay = 250 + i * 160;
    el.textContent = fmt(el, 0);
    const tick = now => {
      if (!el.isConnected || !st) return;
      const k = Math.min(1, Math.max(0, (now - t0 - delay) / D)), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(el, v * e);
      if (k < 1) requestAnimationFrame(tick); else fin(el);
    };
    requestAnimationFrame(tick);
  });
}

function render(key, focusTitle) {
  const c = st.list.find(x => x.key === key) || st.list[0];
  st.key = c.key;
  const scroll = st.dlg.querySelector('.pd-scroll');
  scroll.querySelector('.pd-body').innerHTML = bodyHTML(c);
  scroll.scrollTop = 0;
  runCounters(scroll);
  if (focusTitle) { const t = scroll.querySelector('#pdTitle'); if (t) t.focus({ preventScroll: true }); }
}

function restoreFocus(s) {
  const target = s.opts.focusTarget ? s.opts.focusTarget(s.key) : null;
  if (target && document.contains(target)) target.focus({ preventScroll: true });
  else if (s.opener && document.contains(s.opener)) s.opener.focus({ preventScroll: true });
}

/* Разборка экрана (идемпотентна). Положение прокрутки основной страницы возвращается ровно прежнее. */
function teardown() {
  if (!st) return;
  const s = st;
  st = null;
  removeEventListener('popstate', s.onPop);
  s.dlg.removeEventListener('close', s.onNativeClose);
  try { if (s.dlg.open) s.dlg.close(); } catch (e) { /* уже закрыт */ }
  s.dlg.remove();
  document.documentElement.classList.remove('pd-lock');
  document.documentElement.style.removeProperty('--pd-sbw');
  scrollTo({ top: s.scrollY, left: 0, behavior: 'instant' });
  if (s.focusBack !== false) restoreFocus(s);
  if (s.resolve) s.resolve();
}

/* Закрытие: сначала снимаем запись истории (она и есть «назад» телефона), затем разбираем экран.
   Promise выполняется после полного закрытия. */
function closeScreen({ focus = true } = {}) {
  if (!st) return Promise.resolve();
  const s = st;
  if (s.closing) return s.done;
  s.closing = true;
  s.focusBack = focus;
  s.done = new Promise(res => { s.resolve = res; });
  if (s.pushed && history.state && history.state.pdOpen) {
    history.back();   // придёт popstate → teardown
    // страховка: если popstate не пришёл — закрываем сами
    setTimeout(() => { if (st === s) { s.pushed = false; teardown(); } }, 400);
  } else teardown();
  return s.done;
}

/* Открыть экран шаблона. opts: { list, key, opener, onTune(c), focusTarget(key) } */
export function openPresetDetail(opts) {
  if (st) return;   // быстрый повторный клик: экран уже открыт или закрывается
  const dlg = document.createElement('dialog');
  dlg.className = 'pd';
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  dlg.setAttribute('aria-labelledby', 'pdTitle');
  dlg.setAttribute('aria-describedby', 'pdLead');
  dlg.innerHTML = `<div class="pd-head">
      <button type="button" class="btn primary pd-back" data-pd="back"><span aria-hidden="true">←</span> Назад в меню</button>
      <button type="button" class="pd-x" data-pd="close" aria-label="Закрыть">✕</button>
    </div>
    <div class="pd-scroll"><div class="pd-body"></div></div>`;
  const sbw = innerWidth - document.documentElement.clientWidth;
  const s = st = { dlg, key: opts.key, list: opts.list, opts, opener: opts.opener || document.activeElement, scrollY: window.scrollY, pushed: false, closing: false };
  // запись истории без смены адреса: «назад» закрывает экран, якоря и hashchange не затронуты
  try { history.pushState({ pdOpen: true }, '', location.href); s.pushed = true; } catch (e) { s.pushed = false; }
  // «назад» браузера/телефона: запись уже снята — просто разбираем экран
  s.onPop = () => { s.pushed = false; s.closing = true; if (!s.done) s.done = new Promise(res => { s.resolve = res; }); teardown(); };
  addEventListener('popstate', s.onPop);
  // системное закрытие диалога — через общий путь
  s.onNativeClose = () => { if (st === s && !s.closing) closeScreen(); };
  dlg.addEventListener('close', s.onNativeClose);
  // Esc
  dlg.addEventListener('cancel', e => { e.preventDefault(); closeScreen(); });
  // клик вне плашки: закрываем, только если и нажатие, и отпускание были на подложке (выделение текста не закрывает)
  let downOnDlg = false;
  dlg.addEventListener('pointerdown', e => { downOnDlg = e.target === dlg; });
  dlg.addEventListener('click', e => {
    if (e.target === dlg) { if (downOnDlg) closeScreen(); return; }
    const b = e.target.closest('[data-pd],[data-pd-key]');
    if (!b) return;
    if (b.dataset.pdKey) { render(b.dataset.pdKey, true); return; }
    const a = b.dataset.pd;
    if (a === 'back' || a === 'close') closeScreen();
    else if (a === 'tune') { const c = s.list.find(x => x.key === s.key); // после закрытия даём браузеру закончить возврат прокрутки по истории, затем штатный переход к калькулятору
      closeScreen({ focus: false }).then(() => setTimeout(() => opts.onTune && opts.onTune(c), 80)); }
    else if (a === 'others') {
      const box = dlg.querySelector('#pdOthers'), open = box.hidden;
      box.hidden = !open; b.setAttribute('aria-expanded', String(open));
      // прокручиваем только внутреннюю область экрана (scrollIntoView потянул бы и основную страницу)
      if (open) { const sc = dlg.querySelector('.pd-scroll'); sc.scrollTo({ top: sc.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' }); }
    }
  });
  document.body.appendChild(dlg);
  document.documentElement.classList.add('pd-lock');
  if (sbw > 0) document.documentElement.style.setProperty('--pd-sbw', sbw + 'px');
  render(opts.key, false);
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  // фокус внутрь: на крупную кнопку «Назад в меню»
  const back = dlg.querySelector('.pd-back'); if (back) back.focus({ preventScroll: true });
}

export function isDetailOpen() { return !!st; }
