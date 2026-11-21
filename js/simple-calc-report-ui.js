/* simple-calc-report-ui.js — отдельный экран «Посчитать»: плашка-диалог с маленькой бухгалтерией и инфографикой.
   Расчётов здесь нет: buildReport() — в js/simple-calc-report.js. Здесь только разметка, анимация и управление диалогом.
   Анимируются только transform и opacity; при prefers-reduced-motion итог показывается сразу, числа без счёта.
   Диалог: нативный <dialog> + showModal() (фокус внутри, Tab не уходит наружу, Esc закрывает), role=dialog и aria-modal явно,
   клик вне плашки, «✕» и «← Изменить вводные» закрывают; фокус возвращается на кнопку «Посчитать». */
import { ic, icons, motionOK } from './ui/helpers.js';
import { ruNum } from './calculators/util.js';
import { buildReport, approxRub, roundStep, roundTo, monthsText, plural, PERIODS } from './simple-calc-report.js';

const NBSP = ' ';
const MINUS = '−';
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const COUNT_MS = 900;                                   // длительность счёта чисел: не дольше 900 мс (требование владельца)

/* Инлайн-иконки, которых нет в общем наборе icon-data.js */
const SVG = d => `<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
export const ICONS = {
  back: SVG('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>'),
  calc: SVG('<rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="16" x2="16" y1="14" y2="18"/><path d="M16 10h.01"/><path d="M12 10h.01"/><path d="M8 10h.01"/><path d="M12 14h.01"/><path d="M8 14h.01"/><path d="M12 18h.01"/><path d="M8 18h.01"/>'),
  up: SVG('<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>'),
  down: SVG('<path d="M16 17h6v-6"/><path d="m22 17-8.5-8.5-5 5L2 7"/>'),
  flat: SVG('<path d="M5 12h14"/>')
};
const STATUS = { plus: ['В плюсе', ICONS.up], zero: ['Около нуля', ICONS.flat], minus: ['В минусе', ICONS.down] };

/* Подписи чисел: «≈ 68 000 ₽» и со знаком «≈ +68 000 ₽» / «≈ −11 300 ₽» */
const plain = (v, cfg) => approxRub(v, cfg);
function signedApprox(v, cfg) {
  const r = roundTo(v, roundStep(cfg));
  return `≈${NBSP}${r > 0 ? '+' : r < 0 ? MINUS : ''}${ruNum(Math.abs(r), 0)}${NBSP}₽`;
}
const numText = (kind, v, cfg) => (kind === 'signed' ? signedApprox(v, cfg) : plain(v, cfg));

/* Число с анимацией: обёртка с итогом для скринридера (читается сразу) и видимая часть, которая «считает» от 0 */
const countNum = (kind, v, cfg, cls = '') => `<b class="scr-num ${cls}"><span class="sr">${esc(numText(kind, v, cfg))}</span><span aria-hidden="true" data-scr-count="${v}" data-kind="${kind}">${esc(numText(kind, v, cfg))}</span></b>`;

/* ---------- Блоки ---------- */
function statementHTML(r, cfg) {
  const rows = r.expenses.length
    ? r.expenses.map((e, i) => {
      const hundred = r.perHundred && r.perHundred.items.find(x => x.key === e.key);
      return `<li><span class="sw pt${i + 1}" aria-hidden="true"></span><span class="scr-lbl">${esc(e.label)}</span><span class="scr-amt">${esc(plain(e.amount, cfg))}</span>${hundred && r.revenue > 0 ? `<small>${hundred.rub}${NBSP}₽ с сотни</small>` : ''}</li>`;
    }).join('')
    : '<li class="scr-none">Расходов в расчёте нет.</li>';
  const per = (PERIODS.find(p => p.id === r.period) || PERIODS[1]).word;
  return `<section class="scr-sec scr-book" aria-label="Бухгалтерия за ${per}">
    <div class="scr-line scr-in"><span>Пришло денег</span>${countNum('plain', r.revenue, cfg)}</div>
    <div class="scr-line scr-out"><span>Ушло всего</span>${countNum('plain', r.expensesTotal, cfg)}</div>
    <ul class="scr-exp">${rows}</ul>
    <div class="scr-line scr-net"><span>Осталось вам</span><span class="scr-st" data-s="${r.status}">${STATUS[r.status][1]}${STATUS[r.status][0]}</span></div>
    ${countNum('signed', r.profit, cfg, 'scr-hero')}
    <p class="scr-verdict">${esc(r.verdict)}</p>
  </section>`;
}

/* «Куда ушла каждая сотня»: одна полоса, сегменты растут слева направо с каскадом (scaleX) */
function hundredHTML(r) {
  const h = r.perHundred;
  if (!h) return `<section class="scr-sec"><h3 class="scr-h">Куда ушла каждая сотня</h3><p class="scr-hint">Выручки нет — делить нечего.</p></section>`;
  const scale = Math.max(100, h.total);
  const segs = [...h.items.map((it, i) => ({ cls: `pt${i + 1}`, rub: it.rub, label: it.label })), ...(h.keep > 0 ? [{ cls: 'keep', rub: h.keep, label: 'Осталось вам' }] : [])]
    .filter(s => s.rub > 0);
  const bar = segs.map((s, i) => `<span class="seg ${s.cls}" style="--w:${(s.rub / scale * 100).toFixed(2)}%;--i:${i}" title="${esc(s.label)}: ${s.rub} ₽"><i>${s.rub / scale >= 0.09 ? s.rub : ''}</i></span>`).join('');
  const cap = h.total > 100
    ? `На каждые 100${NBSP}₽ выручки ушло <b>${h.total}${NBSP}₽</b> — это больше, чем пришло.`
    : `Из каждых 100${NBSP}₽ выручки вам остаётся <b>${h.keep}${NBSP}₽</b>.`;
  return `<section class="scr-sec"><h3 class="scr-h">Куда ушла каждая сотня</h3>
    <div class="scr-hbar" role="img" aria-label="${esc(segs.map(s => `${s.label}: ${s.rub} ₽`).join('; '))}">${bar}</div>
    <p class="scr-hint">${cap}</p></section>`;
}

/* Три столбика: выручка / расходы / прибыль. Минус — штриховка и подпись «в минусе», а не только цвет */
function columnsHTML(r, cfg) {
  const vals = [['Пришло', r.revenue, 'rev', 'plain'], ['Ушло', r.expensesTotal, 'exp', 'plain'], [r.profit < 0 ? 'В минусе' : 'Осталось', r.profit, r.profit < 0 ? 'neg' : 'pro', 'signed']];
  const max = Math.max(...vals.map(v => Math.abs(v[1])), 1);
  const cols = vals.map(([name, v, cls, kind], i) => `<div class="scr-col ${cls}" style="--i:${i}"><span class="cv">${esc(numText(kind, v, cfg))}</span><div class="cb"><i style="--h:${Math.max(Math.abs(v) / max * 100, v === 0 ? 0 : 2).toFixed(2)}%"></i></div><span class="cn">${name}</span></div>`).join('');
  return `<section class="scr-sec"><h3 class="scr-h">Выручка, расходы, прибыль</h3>
    <div class="scr-cols" role="img" aria-label="${esc(vals.map(v => `${v[0]}: ${numText(v[3], v[1], cfg)}`).join('; '))}">${cols}</div></section>`;
}

/* Накопление по месяцам (период длиннее месяца): нулевая линия, плюс вверх, минус — штриховкой вниз; метка «окупились» */
function cumulativeHTML(r, cfg) {
  const c = r.cumulative;
  if (!c) return '';
  const pos = Math.max(0, ...c.map(x => x.value)), neg = Math.max(0, ...c.map(x => -x.value));
  const total = Math.max(pos + neg, 1);
  const zeroAt = pos / total * 100;
  const first = c.findIndex(x => x.value >= 0);
  const last = c[c.length - 1];
  const bars = c.map((x, i) => {
    const h = (Math.abs(x.value) / total * 100).toFixed(2);
    const style = x.value >= 0 ? `bottom:${(100 - zeroAt).toFixed(2)}%;height:${h}%` : `top:${zeroAt.toFixed(2)}%;height:${h}%`;
    const flag = i === first && r.invest > 0 ? '<em class="flag">окупились</em>' : '';
    return `<div class="cm" style="--i:${i}">${flag}<i class="${x.value >= 0 ? 'up' : 'dn'}" style="${style}"></i><span class="mn">${x.m}</span></div>`;
  }).join('');
  const txt = r.invest > 0
    ? (first >= 0 ? `Вложения вернутся на ${first + 1}-м месяце; к концу сезона накоплено ${signedApprox(last.value, cfg)}.` : `К концу сезона вложения ещё не вернутся: ${signedApprox(last.value, cfg)}.`)
    : `К концу сезона накоплено ${signedApprox(last.value, cfg)}.`;
  return `<section class="scr-sec"><h3 class="scr-h">Накопление по месяцам</h3>
    <div class="scr-cum" style="--zero:${zeroAt.toFixed(2)}%" role="img" aria-label="Накопленная прибыль по месяцам сезона. ${esc(txt)}"><span class="zl" aria-hidden="true"><b>0</b></span>${bars}</div>
    <p class="scr-hint">Месяц сезона — по горизонтали. Штриховка вниз — ещё в минусе (вложения не вернулись), сплошное вверх — в плюсе. ${esc(txt)}</p></section>`;
}

/* «Когда окупится» и «сколько показов, чтобы выйти в ноль» */
function cardsHTML(r, cfg) {
  const pb = r.payback;
  let payMain, paySub;
  if (pb.state === 'none') { payMain = 'вложений нет'; paySub = 'Укажите вложения на старте — посчитаю, когда они вернутся.'; }
  else if (pb.state === 'never') { payMain = 'пока не окупается'; paySub = `Вложения ${plain(r.invest, cfg)}, а прибыли в месяц нет — при таких цифрах они не вернутся.`; }
  else { payMain = monthsText(pb.months, cfg); paySub = `Вложения ${plain(r.invest, cfg)} ÷ прибыль в месяц ${plain(r.profit / r.periodMonths, cfg)}; это ≈${NBSP}${ruNum(pb.shows, 0)} ${plural(pb.shows, 'показ', 'показа', 'показов')}.`; }
  const be = r.breakEven;
  let beMain, beSub = '';
  if (be.shows == null) { beMain = 'не выйти в ноль'; beSub = 'Каждый показ при таких ценах приносит убыток — больше показов не поможет.'; }
  else if (be.shows === 0) { beMain = 'с первого показа'; beSub = 'Постоянных расходов нет, каждый показ уже в плюсе.'; }
  else {
    beMain = `${ruNum(be.shows, 0)} ${plural(be.shows, 'показ', 'показа', 'показов')} в месяц`;
    beSub = r.period !== 'month' ? `Это ≈${NBSP}${ruNum(be.showsPerPeriod, 0)} ${plural(be.showsPerPeriod, 'показ', 'показа', 'показов')} за ${(PERIODS.find(p => p.id === r.period) || {}).word}.` : '';
  }
  if (be.kids) beSub += `${beSub ? ' ' : ''}На одном показе — от ${ruNum(be.kids, 0)} ${plural(be.kids, 'ребёнка', 'детей', 'детей')}.`;
  const run = r.run;
  const runTxt = run.months > 0 ? `За весь прокат (≈${NBSP}${ruNum(run.months, 1)} мес.): прибыль ${signedApprox(run.profit, cfg)}${r.invest > 0 ? `, с учётом вложений ${signedApprox(run.net, cfg)}` : ''}.` : '';
  return `<section class="scr-sec scr-cards">
    <div class="scr-card"><small>Когда окупится</small><b>${esc(payMain)}</b><p>${esc(paySub)}</p></div>
    <div class="scr-card"><small>Выйти в ноль</small><b>${esc(beMain)}</b><p>${esc(beSub)}</p></div>
    ${runTxt ? `<p class="scr-run">${esc(runTxt)}</p>` : ''}
  </section>`;
}

/* ---------- Анимация чисел ---------- */
function runCounts(root, cfg, state) {
  const els = [...root.querySelectorAll('[data-scr-count]')];
  if (!motionOK()) return;                                   // без анимации итог уже в разметке
  els.forEach(el => { el.textContent = numText(el.dataset.kind, 0, cfg); });
  const t0 = performance.now();
  const frame = now => {
    const p = Math.min(1, (now - t0) / COUNT_MS);
    const k = p >= 1 ? 1 : 1 - 2 ** (-10 * p);              // ease-out expo
    els.forEach(el => { el.textContent = numText(el.dataset.kind, Number(el.dataset.scrCount) * k, cfg); });
    if (p < 1) state.raf = requestAnimationFrame(frame);
  };
  state.raf = requestAnimationFrame(frame);
}

/* ---------- Открыть экран ----------
   input — вводы формы + новые поля; opener — кнопка «Посчитать» (туда вернётся фокус); onSave(report) → имя сохранённого сценария */
export function openReport({ input, cfg, ctx = {}, opener, onSave, modeLabel = '' }) {
  const r = buildReport(input, cfg, ctx);
  const per = (PERIODS.find(p => p.id === r.period) || PERIODS[1]);
  const dlg = document.createElement('dialog');
  dlg.className = 'scr';
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  dlg.setAttribute('aria-labelledby', 'scrTitle');
  dlg.setAttribute('aria-describedby', 'scrNote');
  dlg.innerHTML = `<div class="scr-box">
    <header class="scr-head">
      <div class="scr-hl"><p class="scr-kicker">${esc(modeLabel)}${modeLabel ? ' · ' : ''}итог за ${esc(per.word)}${r.period === 'season' ? ` (≈${NBSP}${ruNum(r.periodMonths, 1)} мес.)` : ''}</p>
        <h2 id="scrTitle" class="scr-title" tabindex="-1">${esc(r.title)}</h2></div>
      <button type="button" class="scr-x" data-close aria-label="Закрыть итог">${ic('x')}</button>
    </header>
    <div class="scr-body">
      <p class="scr-approx"><span class="scr-tag">ориентировочно</span> Суммы округлены до ${ruNum(roundStep(cfg), 0)}${NBSP}₽ — это примерные цифры, а не точный учёт.</p>
      ${statementHTML(r, cfg)}
      ${hundredHTML(r)}
      ${columnsHTML(r, cfg)}
      ${cumulativeHTML(r, cfg)}
      ${cardsHTML(r, cfg)}
      ${r.caveats.length ? `<ul class="scr-cav">${r.caveats.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      <p class="scr-note" id="scrNote">Это ориентировочный расчёт, не бухгалтерия: ставки и цены — из настроек проекта, реальные могут отличаться.</p>
    </div>
    <footer class="scr-foot">
      <button type="button" class="btn secondary scr-back" data-close>${ICONS.back}<span>Изменить вводные</span></button>
      <button type="button" class="btn secondary" data-save>${ic('bookmark')}<span>Сохранить</span></button>
      <button type="button" class="btn secondary" data-print>${ic('printer')}<span>Печать</span></button>
    </footer>
  </div>`;

  const state = { raf: 0 };
  let closed = false;
  const root = document.documentElement;
  const finish = () => {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(state.raf);
    root.classList.remove('scr-lock');
    dlg.remove();
    if (opener && opener.isConnected) try { opener.focus(); } catch (e) { /* кнопки уже нет — фокус не нужен */ }
  };
  dlg.addEventListener('close', finish);
  dlg.addEventListener('click', e => {
    if (e.target.closest('[data-close]')) { dlg.close(); return; }
    if (e.target.closest('[data-save]')) {
      const name = onSave ? onSave(r) : null;
      const b = e.target.closest('[data-save]');
      if (name) { b.querySelector('span').textContent = 'Сохранено'; b.setAttribute('aria-label', `Сохранено как «${name}»`); }
      return;
    }
    if (e.target.closest('[data-print]')) {
      // печатаем только плашку: правило @media print в simple-calc.css прячет всё остальное по классу на body
      document.body.classList.add('sc-printing');
      const done = () => { document.body.classList.remove('sc-printing'); removeEventListener('afterprint', done); };
      addEventListener('afterprint', done);
      window.print();
      return;
    }
    // клик вне плашки (по затемнению) — закрыть
    if (e.target === dlg) {
      const b = dlg.querySelector('.scr-box').getBoundingClientRect();
      if (e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom) dlg.close();
    }
  });

  // ловушка Tab: фокус ходит по кругу внутри плашки (и не уходит в адресную строку браузера)
  dlg.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const items = [...dlg.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(el => !el.disabled && el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1], at = document.activeElement;
    if (e.shiftKey && (at === first || at === dlg.querySelector('.scr-title'))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  });

  document.body.appendChild(dlg);
  root.classList.add('scr-lock');
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  icons();
  const title = dlg.querySelector('.scr-title');
  if (title) title.focus({ preventScroll: true });
  // поехали: класс .go запускает каскад полос и столбиков; без анимации — сразу итог
  if (motionOK()) { requestAnimationFrame(() => requestAnimationFrame(() => dlg.classList.add('go'))); runCounts(dlg, cfg, state); }
  else dlg.classList.add('go', 'still');
  return { dialog: dlg, report: r, close: () => dlg.close() };
}
