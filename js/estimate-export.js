/* estimate-export.js — «Смета в 1 клик»: текстовая выжимка для мессенджера и чистый лист А4 для «Сохранить в PDF».
   Чистая часть (buildCalcEstimate, buildOverviewEstimate, estimateText, estimateHTML) не трогает DOM и проверяется в node.
   Числа берутся только из объекта результата калькулятора (js/calculators/*) или из строк денежного потока «Обзора»;
   если поля в результате нет (null, NaN) — строка в смету не попадает. Своих цифр модуль не придумывает. */
import { fmtValue, fieldText } from './calculators/scenarios.js';
import { ruNum } from './calculators/util.js';

const NOTE = 'Ориентировочный расчёт по данным и допущениям проекта: ставки, цены и расходы требуют проверки.';
const APP = 'Бизнес-помощник Юлии · детский театр, Новосибирск';

/* ==== Строки сметы ====
   kind: param — параметр; revenue — выручка; cost — расходы (итог); item — статья расходов; tax — налог;
   profit — прибыль/итог; be — безубыточность/окупаемость; info — справочная строка */
const row = (kind, label, v, t = 'rub', unit = '') => ({ kind, label, v, t, unit });
const isNum = v => typeof v === 'number' && Number.isFinite(v);
/* Строка выводится, только если значение реально есть: число конечно, текст не пуст */
const present = r => (r.t === 'text' ? r.v != null && String(r.v).trim() !== '' : isNum(r.v));
/* Статья расходов с нулём — шум в смете (например, взносы при игре основателей): не выводится */
const useful = r => present(r) && !(r.kind === 'item' && r.v === 0);
const sum = (arr, k) => arr.reduce((s, x) => s + (isNum(x[k]) ? x[k] : 0), 0);

/* Значение строки → текст по-русски (₽, штуки, проценты) с единицей */
export function valueText(r) {
  const base = fmtValue(r.v, r.t);
  return r.unit ? `${base} ${r.unit}` : base;
}

/* Дата «дд.мм.гггг» без зависимости от локали среды (часы — локальные, как видит пользователь) */
export function ruDate(d) {
  const t = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(t.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${p(t.getDate())}.${p(t.getMonth() + 1)}.${t.getFullYear()}`;
}

/* ==== Сопоставление «результат калькулятора → строки сметы» ====
   Подписи повторяют подписи результата в интерфейсе (js/ui/calc-ui.js), значения — поля calc() без пересчёта. */
const ROWS = {
  travel: r => {
    const day = r.k === 1 ? 'показа' : 'дня';
    return [
      row('revenue', `Выручка ${day}`, r.gross),
      row('cost', `Расходы ${day} без налога`, isNum(r.cost) && isNum(r.tax) ? r.cost - r.tax : null),
      row('item', 'Гонорар команды', r.salary),
      row('item', 'Взносы с гонораров (модель)', r.social),
      row('item', 'Транспорт и ГСМ', r.fuel),
      row('item', 'Износ реквизита', r.wear),
      row('item', 'Печать для зрителей', r.print),
      row('item', `Доля площадки${isNum(r.rate) ? ` (${ruNum(r.rate * 100, 1)}%)` : ''}`, r.fee),
      row('tax', `Налог УСН${isNum(r.usn) ? ` ${ruNum(r.usn, 2)}%` : ''}`, r.tax),
      row('profit', `Чистая прибыль ${day}`, r.profit),
      r.k > 1 ? row('profit', 'Чистая прибыль одного показа', r.per) : null,
      // при нулевой выручке маржа не определена (в расчёте 0%) — строку не выводим, чтобы не путать с «в ноль»
      row('info', 'Маржа', isNum(r.gross) && r.gross > 0 ? r.margin : null, 'pct'),
      row('be', 'Точка безубыточности', r.be, 'int', 'чел. за день')
    ];
  },
  basecamp: r => {
    const b = r.b || {}, x = r.x || {};
    const baseCost = [b.fixed, b.teachers, b.week, b.party].every(isNum) ? b.fixed + b.teachers + b.week + b.party : null;
    return [
      row('revenue', 'Выручка за месяц (база и выезды)', x.g),
      row('info', 'В том числе выручка базы', b.gross),
      row('cost', 'Расходы базы без налога', baseCost),
      row('item', 'Аренда, КУ, администрация и реклама', b.fixed),
      row('item', 'Педагоги студии с взносами', b.teachers),
      row('item', 'Спектакли выходного дня', b.week),
      row('item', 'Праздники: переменные расходы', b.party),
      row('cost', 'Штаб после порога НДС', x.hq ? x.hq : null),
      row('tax', 'Налог УСН базы', b.tax),
      row('tax', 'НДС в цене', x.vat ? x.vat : null),
      row('info', 'Выезды: прибыль после своих расходов', x.tourProfit),
      row('profit', 'Чистая прибыль месяца', x.profit),
      row('info', 'Годовой темп выручки', x.annual),
      isNum(r.payback) ? row('be', 'Окупаемость вложений', r.payback, 'int', 'мес.') : row('be', 'Окупаемость вложений', 'не достигается при этой прибыли', 'text')
    ];
  },
  goal: r => {
    const x = r.x || {};
    return [
      row('info', 'Цель: чистыми в месяц', r.goal),
      row('revenue', 'Выручка за месяц', x.g),
      row('tax', 'НДС в цене', x.vat ? x.vat : null),
      row('profit', 'Плановая прибыль', x.profit),
      row('be', 'Нужно выездных показов в месяц', x.n, 'int'),
      row('be', 'Учеников студии', r.students, 'int'),
      row('be', 'Гастрольных трупп', x.t, 'int'),
      row('info', 'Цель достижима', r.plan ? 'да' : 'нет — показан лучший вариант', 'text')
    ];
  },
  taxes: r => {
    const regimes = Array.isArray(r.regimes) ? r.regimes : [];
    const taxRows = [];
    // УСН «Доходы» — цепочкой, как в плашках калькулятора: налог → −вычет взносов ИП → налог к уплате
    const usn6 = regimes.find(g => g.id === 'usn6');
    if (usn6 && isNum(usn6.tax)) {
      const lim = isNum(r.dedPct) ? ` (до ${ruNum(r.dedPct)}% налога${r.staff ? ', есть штат' : ', без работников'})` : '';
      taxRows.push(row('tax', `${usn6.name}: налог ${isNum(usn6.rate) ? ruNum(usn6.rate, 2) + '% ' : ''}до вычета`, r.usn6Tax));
      taxRows.push(row('tax', `${usn6.name}: вычет взносов ИП${lim}`, isNum(r.usn6Deduction) && r.usn6Deduction > 0 ? -r.usn6Deduction : null));
      // 1% сверх порога по закону уменьшает налог следующего года (платится до 1 июля) — в смете это явное допущение
      const onePct = r.ip && isNum(r.ip.extra) && r.ip.extra > 0 ? r.ip.extra : null;
      if (onePct != null) taxRows.push(row('info', 'Допущение: 1% взносов учтён в вычете того же года (в первый год налог к уплате может быть выше на эту сумму)', onePct));
      taxRows.push(row('tax', `${usn6.name}: налог к уплате`, r.usn6Pay));
    }
    // остальные режимы — налог к уплате (после вычета / учёта взносов, если расчёт его дал)
    regimes.forEach(g => {
      if (g.id === 'usn6' || !isNum(g.tax)) return;
      const pay = isNum(g.pay) ? g.pay : g.tax;
      taxRows.push(row('tax', pay !== g.tax ? `${g.name}: к уплате (до вычета ${fmtValue(g.tax, 'rub')})` : g.name, pay));
    });
    const ip = r.ip || {};
    const best = r.bestPay || r.best;
    return [
      row('revenue', 'Выручка за год', r.revenue),
      row('cost', 'Расходы за год', r.costs),
      row('cost', 'Взносы ИП за себя', ip.total),
      row('cost', 'Взносы с гонораров команды', r.gphContribs ? r.gphContribs : null),
      ...taxRows,
      row('tax', 'НДС за год', r.vat ? r.vat : null),
      row('profit', 'Лучший режим (налог к уплате)', best ? `${best.name} · ${fmtValue(isNum(best.pay) ? best.pay : best.tax, 'rub')}` : null, 'text'),
      // тот же остаток, что на экране: налог УСН «Доходы» уже уменьшен на вычет взносов ИП (null — УСН недоступна)
      row('profit', 'Остаток владельца на УСН «Доходы» (с вычетом взносов)', r.ownerNet),
      row('be', 'Точка перехода через порог НДС (выручка)', r.crossing ? r.crossing.breakEven : null)
    ];
  },
  payroll: r => [
    row('info', 'Гонорары команды в месяц', r.gross),
    row('cost', r.gph ? r.gph.name : 'ГПХ', r.gph ? r.gph.cost : null),
    row('cost', r.npd ? r.npd.name : 'НПД', r.npd ? r.npd.cost : null),
    row('cost', r.staff ? r.staff.name : 'Штат', r.staff ? r.staff.cost : null),
    row('profit', 'Дешевле всего в месяц', r.cheapest),
    row('info', 'Лимит самозанятого превышен', r.npdOver ? 'да' : 'нет', 'text')
  ],
  pricing: r => [
    row('cost', 'Прямые расходы показа', r.direct),
    row('revenue', 'Цена билета из маржи', isNum(r.priceFromMargin) ? r.priceFromMargin : 'недостижима при этой марже', isNum(r.priceFromMargin) ? 'rub' : 'text'),
    row('profit', 'Прибыль показа при этой цене', r.profitAtPrice),
    row('info', 'Маржа при этой цене', r.actualMargin, 'pct'),
    row('be', 'Цена безубыточности', r.priceBreakEven)
  ],
  parties: r => [
    row('revenue', 'Выручка пакета', r.revenue),
    row('cost', 'Расходы праздника без налога', isNum(r.variables) && isNum(r.fee) ? r.variables + r.fee : null),
    row('item', 'Переменные расходы праздника', r.variables),
    row('item', 'Гонорар с взносами и реквизит', r.fee),
    row('tax', 'Налог УСН', r.tax),
    row('profit', 'Прибыль праздника', r.profit),
    row('info', 'Маржа', isNum(r.revenue) && r.revenue > 0 ? r.margin : null, 'pct'),
    row('revenue', 'Выручка за месяц', r.revenueMonth),
    row('profit', 'Прибыль за месяц', r.perMonth)
  ],
  cashflow: r => {
    const rows = Array.isArray(r.rows) ? r.rows : [];
    const last = rows[rows.length - 1];
    const min = r.min || {};
    return [
      row('info', 'Начальное финансирование', r.startCapital),
      row('revenue', `Вклад выездов за ${rows.length} мес.`, rows.length ? sum(rows, 'tour') : null),
      row('revenue', `Вклад базы за ${rows.length} мес.`, rows.length ? sum(rows, 'base') : null),
      row('cost', 'Постоянные расходы', rows.length ? sum(rows, 'fixed') : null),
      row('cost', 'Вложения', r.capTotal),
      row('profit', 'Операционная прибыль за период', r.yearOp),
      row('profit', last ? `Остаток на конец (${last.m})` : 'Остаток на конец', last ? last.net : null),
      row('be', min.m ? `Минимальный остаток (${min.m})` : 'Минимальный остаток', min.net),
      row('be', 'Месяцев в минусе', Array.isArray(r.gaps) ? r.gaps.length : null, 'int'),
      row('be', 'Дно без финансирования', r.minNoFinancing)
    ];
  },
  grants: r => [
    row('info', 'Планируемый запуск', r.launchLabel, 'text'),
    row('be', 'Конкурсов с деньгами до запуска', Array.isArray(r.usable) ? r.usable.length : null, 'int'),
    row('info', 'Конкурсов открыто сейчас', r.openNow, 'int'),
    row('profit', 'Вывод', r.conclusion, 'text')
  ]
};

/* Смета калькулятора: заголовок, параметры (подписи полей + выбранные значения) и строки итога */
export function buildCalcEstimate({ mod, fields, inputs, result, date }) {
  const id = mod && mod.meta ? mod.meta.id : '';
  const title = mod && mod.meta ? mod.meta.title : 'Расчёт';
  const params = (fields || [])
    .filter(f => inputs && inputs[f.id] !== undefined && inputs[f.id] !== '')
    .map(f => ({ label: f.label, text: fieldText(f, inputs[f.id]) }));
  const map = ROWS[id];
  const rows = map && result ? map(result).filter(Boolean).filter(useful) : [];
  return { title, date: ruDate(date), params, rows, note: NOTE };
}

/* Смета «Обзора»: сводка денежного потока периода и бюджета запуска.
   rows — строки денежного потока, как их считает overview.js (m, tour, base, fixed, cap, op, net, projected);
   budget — числа бюджета фаз (total, phase1, phase2, phase1_fixed_month, phase2_fixed_month);
   zeroShows — показов в месяц для операционного нуля; payIdx — индекс месяца окупаемости (−1 — не наступает) */
export function buildOverviewEstimate({ rows = [], budget = {}, zeroShows = null, payIdx = -1, date }) {
  const first = rows[0], last = rows[rows.length - 1];
  const low = rows.length ? rows.reduce((m, x) => (x.net < m.net ? x : m), rows[0]) : null;
  const projected = rows.filter(x => x.projected).map(x => x.m);
  const params = [
    first && last ? { label: 'Период', text: `${first.m} – ${last.m} (${rows.length} мес.)` } : null,
    isNum(budget.total) ? { label: 'Бюджет запуска (две фазы)', text: fmtValue(budget.total, 'rub') } : null,
    isNum(budget.phase1) ? { label: 'Фаза 1: подготовка выездов', text: fmtValue(budget.phase1, 'rub') } : null,
    isNum(budget.phase2) ? { label: 'Фаза 2: открытие студии', text: fmtValue(budget.phase2, 'rub') } : null,
    isNum(budget.phase1_fixed_month) ? { label: 'Постоянные расходы фазы 1', text: `${fmtValue(budget.phase1_fixed_month, 'rub')}/мес.` } : null,
    isNum(budget.phase2_fixed_month) ? { label: 'Постоянные расходы фазы 2', text: `${fmtValue(budget.phase2_fixed_month, 'rub')}/мес.` } : null
  ].filter(Boolean);
  const out = rows.length ? [
    row('revenue', 'Вклад выездов', sum(rows, 'tour')),
    row('revenue', 'Вклад базы', sum(rows, 'base')),
    row('cost', 'Постоянные расходы', sum(rows, 'fixed')),
    row('cost', 'Вложения', sum(rows, 'cap')),
    row('profit', 'Операционная прибыль за период', sum(rows, 'op')),
    row('profit', `Баланс на конец (${last.m})`, last.net),
    row('be', `Наименьший баланс (${low.m})`, low.net),
    row('be', 'Операционный ноль', zeroShows, 'int', 'показов в месяц'),
    payIdx >= 0 && rows[payIdx] ? row('be', 'Окупаемость', `${payIdx + 1}-й месяц (${rows[payIdx].m})`, 'text') : row('be', 'Окупаемость', `за ${rows.length} мес. не наступает`, 'text')
  ].filter(useful) : [];
  const note = projected.length ? `${NOTE} Месяцы ${projected.join(', ')} — проекция модели.` : NOTE;
  return { title: 'Обзор: деньги первого года', date: ruDate(date), params, rows: out, note };
}

/* ==== Текст для мессенджера ==== */
export function estimateText(est) {
  const lines = [`Смета · ${est.title}${est.date ? ` · ${est.date}` : ''}`];
  if (est.params.length) {
    lines.push('', 'Параметры:');
    est.params.forEach(p => lines.push(`— ${p.label}: ${p.text}`));
  }
  if (est.rows.length) {
    lines.push('');
    est.rows.forEach(r => lines.push(`${r.kind === 'item' ? '   · ' : ''}${r.label}: ${valueText(r)}`));
  }
  lines.push('', est.note);
  return lines.join('\n');
}

/* ==== Лист А4 для печати / PDF ==== */
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function estimateHTML(est) {
  const params = est.params.length
    ? `<h2>Параметры</h2><table class="est-params"><tbody>${est.params.map(p => `<tr><th scope="row">${esc(p.label)}</th><td>${esc(p.text)}</td></tr>`).join('')}</tbody></table>`
    : '';
  const rows = est.rows.length
    ? `<h2>Итог</h2><table class="est-total"><tbody>${est.rows.map(r => `<tr class="est-${r.kind}"><th scope="row">${esc(r.label)}</th><td>${esc(valueText(r))}</td></tr>`).join('')}</tbody></table>`
    : '<p>Нет данных для сметы.</p>';
  return `<header class="est-head"><p class="est-app">${esc(APP)}</p><h1>Смета — ${esc(est.title)}${est.date ? ` — ${esc(est.date)}` : ''}</h1></header>${params}${rows}<p class="est-note">${esc(est.note)}</p>`;
}

/* ==== Действия в браузере ==== */

/* Копирование в буфер: Clipboard API, а без него (http, старый WebView) — скрытое поле и execCommand.
   Возвращает true, если текст скопирован */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch (e) { /* разрешение не выдано — пробуем запасной путь */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

/* Скопировать смету и сообщить результат (notify — тост приложения) */
export async function copyEstimate(est, notify) {
  const ok = await copyText(estimateText(est));
  if (notify) notify(ok ? 'Скопировано — вставьте в мессенджер' : 'Не удалось скопировать: браузер запретил доступ к буферу обмена');
  return ok;
}

/* Печать сметы: лист #estSheet в конце body и класс body.est-printing — правила @media print в css/calc.css
   скрывают всё остальное. После печати лист и класс убираются, страница остаётся как была */
export function printEstimate(est) {
  const old = document.getElementById('estSheet');
  if (old) old.remove();
  const sheet = document.createElement('article');
  sheet.id = 'estSheet';
  sheet.className = 'est-sheet';
  sheet.setAttribute('aria-hidden', 'true');
  sheet.innerHTML = estimateHTML(est);
  document.body.appendChild(sheet);
  document.body.classList.add('est-printing');
  // уборка — по afterprint, а где он не приходит (часть мобильных браузеров) — по выходу из режима печати
  const mq = window.matchMedia ? matchMedia('print') : null;
  const onMq = e => { if (!e.matches) done(); };
  const done = () => {
    document.body.classList.remove('est-printing');
    sheet.remove();
    removeEventListener('afterprint', done);
    if (mq && mq.removeEventListener) mq.removeEventListener('change', onMq);
  };
  addEventListener('afterprint', done);
  if (mq && mq.addEventListener) mq.addEventListener('change', onMq);
  window.print();
}
