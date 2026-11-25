/* simple-calc-report.js — экран «Посчитать»: небольшая бухгалтерия за выбранный период (чистый модуль, без DOM).
   Формул здесь НЕТ: выручку, прибыль и статьи расходов в месяц считает simpleProfit() (travel.calc / basecamp.baseMonth).
   Модуль только переводит месячный итог в неделю / месяц / сезон, считает окупаемость вложений простым делением
   (вложения ÷ чистая прибыль в месяц) и готовит подачу: округление до шага из config и подписи простыми словами.
   Константы — только из data/config.json (simple_calc.*, calendar.*); в коде 0, 1 и определение процента (доля × 100). */
import { num, nonNeg, safeDiv, ruNum } from './calculators/util.js';
import { simpleProfit, statusOf } from './simple-calc.js';

const NBSP = ' ';
const MINUS = '−';

/* Периоды и единицы проката */
export const PERIODS = [
  { id: 'week', label: 'Неделя', word: 'неделю' },
  { id: 'month', label: 'Месяц', word: 'месяц' },
  { id: 'season', label: 'Сезон', word: 'сезон' }
];
export const RUN_UNITS = [
  { id: 'weeks', label: 'недель' },
  { id: 'months', label: 'месяцев' }
];

/* Статьи расходов в порядке подачи: ключ совпадает с simpleProfit().articles */
export const ARTICLES = [
  { key: 'rent', label: 'Помещение' },
  { key: 'venue', label: 'Доля площадки' },
  { key: 'actors', label: 'Оплата актёров' },
  { key: 'tax', label: 'Налоги' },
  { key: 'road', label: 'Дорога' },
  { key: 'ads', label: 'Реклама и свои расходы' },
  { key: 'other', label: 'Прочее' }
];

const sc = cfg => cfg.simple_calc || {};
const fin = v => (Number.isFinite(v) ? v : 0);

/* Длина сезона в месяцах: явная настройка проекта (допущение); нет настройки — год целиком */
export function seasonMonths(cfg) {
  const v = num(sc(cfg).season_months);
  return v > 0 ? v : num((cfg.calendar || {}).months_per_year);
}

/* Значения по умолчанию новых полей. Прокат по умолчанию — весь сезон; вложений нет */
export function reportDefaults(cfg) {
  return { title: '', runN: seasonMonths(cfg), runUnit: 'months', invest: 0, period: 'month' };
}

/* Только допустимые значения новых полей (из хранилища или сценария могло прийти что угодно) */
export function normalizeReport(raw, cfg) {
  const d = reportDefaults(cfg);
  const r = raw && typeof raw === 'object' ? raw : {};
  const cap = num(sc(cfg).input_cap);
  const nn = (v, def) => (v === '' || v == null || !Number.isFinite(Number(v)) ? def : Math.min(cap, Math.max(0, Number(v))));
  return {
    title: typeof r.title === 'string' ? r.title.slice(0, titleMax(cfg)) : d.title,
    runN: nn(r.runN, d.runN),
    runUnit: RUN_UNITS.some(u => u.id === r.runUnit) ? r.runUnit : d.runUnit,
    invest: nn(r.invest, d.invest),
    period: PERIODS.some(p => p.id === r.period) ? r.period : d.period
  };
}
export const titleMax = cfg => num(((cfg.calc || {}).scenarios || {}).max_name_len, 1000);   // как у имени сценария; нет настройки — без обрезки на практике

/* ---------- Подача: округление до шага из config и подписи ---------- */
export const roundStep = cfg => Math.max(1, num(sc(cfg).report_round_rub, 1));
export const roundTo = (v, step) => Math.round(fin(v) / step) * step;
/* «≈ 12 300 ₽» / «≈ −4 500 ₽»; ноль после округления без минуса */
export function approxRub(v, cfg) {
  const r = roundTo(v, roundStep(cfg));
  return `≈${NBSP}${r < 0 ? MINUS : ''}${ruNum(Math.abs(r), 0)}${NBSP}₽`;
}
/* Склонение по числу: 1 показ, 2 показа, 5 показов */
export function plural(n, one, few, many) {
  const a = Math.abs(Math.round(n)), t = a % 100, u = a % 10;
  if (t > 10 && t < 20) return many;
  if (u === 1) return one;
  if (u > 1 && u < 5) return few;
  return many;
}
/* Срок в месяцах → «≈ 4 мес.», «меньше месяца», «≈ 2 года» */
export function monthsText(m, cfg) {
  const mpy = num((cfg.calendar || {}).months_per_year);
  if (m == null || !Number.isFinite(m)) return 'пока не окупается';
  if (m <= 0) return 'вложений нет';
  if (m < 1) return 'меньше месяца';
  if (m >= 2 * mpy) { const y = Math.round(m / mpy); return `≈${NBSP}${ruNum(y, 0)}${NBSP}${plural(y, 'год', 'года', 'лет')}`; }
  const r = Math.ceil(m);
  return `≈${NBSP}${r}${NBSP}мес.`;
}

/* Целые доли суммой ровно в total: метод наибольших остатков (чтобы «сотня» сходилась до рубля) */
export function splitInt(values, total) {
  const base = values.map(v => Math.floor(Math.max(0, v)));
  let left = total - base.reduce((a, x) => a + x, 0);
  const order = values.map((v, i) => [Math.max(0, v) - base[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < order.length && left > 0; k++, left--) base[order[k][1]] += 1;
  return base;
}

/* ---------- Главная функция ----------
   input — вводы формы (см. simpleFields) + title, runN, runUnit, invest, period; cfg — единый конфиг; ctx — как у simpleProfit */
export function buildReport(input, cfg, ctx = {}) {
  const cap = num(sc(cfg).input_cap);
  const rep = normalizeReport(input, cfg);
  // защита от переполнения: суммы и количества не больше технического предела (процент и индексы — тоже, это безвредно)
  const skip = new Set(['title', 'mode', 'runUnit', 'period']);
  const clean = {};
  Object.entries(input || {}).forEach(([k, v]) => {
    if (skip.has(k) || v == null || v === '') { clean[k] = v; return; }
    const n = Number(v);
    clean[k] = Number.isFinite(n) ? Math.min(cap, Math.max(0, n)) : 0;
  });
  clean.mode = input && input.mode === 'studio' ? 'studio' : 'travel';
  const base = simpleProfit(clean, cfg, ctx);

  // перевод месячного итога в период: неделя = месяц × месяцев ÷ недель в году; сезон = месяц × длина сезона
  const months = num(cfg.calendar.months_per_year), weeks = num(cfg.calendar.weeks_per_year);
  const seasonM = seasonMonths(cfg);
  const toMonth = { week: safeDiv(months, weeks, 0), month: 1, season: seasonM };      // доля месяца в периоде
  const f = toMonth[rep.period] ?? 1;
  const periodMonths = f;

  const revenue = fin(base.revenueMonth * f);
  const profit = fin(base.monthly * f);
  const expenses = ARTICLES
    .map(a => ({ key: a.key, label: a.label, amount: fin(Math.max(0, num((base.articles || {})[a.key])) * f) }))
    .filter(e => e.amount > 0.5);
  const expensesTotal = expenses.reduce((a, e) => a + e.amount, 0);

  // «каждая сотня»: сколько рублей из 100 ₽ выручки ушло на статью и сколько осталось (целыми, сумма сходится)
  let perHundred = null;
  if (revenue > 0) {
    const ratio = expenses.map(e => 100 * e.amount / revenue);
    const keep = Math.max(0, 100 * profit / revenue);
    const spent = Math.round(ratio.reduce((a, x) => a + x, 0));
    const total = profit >= 0 ? 100 : spent;
    const ints = splitInt(profit >= 0 ? [...ratio, keep] : ratio, total);
    perHundred = {
      total,
      items: expenses.map((e, i) => ({ key: e.key, label: e.label, rub: ints[i] ?? 0 })),
      keep: profit >= 0 ? (ints[expenses.length] ?? 0) : 0,
      spent: profit >= 0 ? 100 - (ints[expenses.length] ?? 0) : spent
    };
  }

  // вложения: окупаемость = вложения ÷ чистая прибыль в месяц (простое деление, без дисконтирования)
  const invest = nonNeg(rep.invest);
  const monthly = fin(base.monthly);
  let payback;
  if (invest <= 0) payback = { state: 'none', months: 0, shows: 0 };
  else if (monthly <= 0) payback = { state: 'never', months: null, shows: null };
  else { const m = fin(invest / monthly); payback = { state: 'ok', months: m, shows: Math.ceil(fin(m * base.showsMonth)) }; }

  // выход в ноль: показов в месяц (выезды без своих постоянных расходов: каждый показ в плюсе — 0; убыточный показ — недостижимо)
  let beShows = base.breakEvenShows;
  if (beShows == null && base.mode === 'travel' && base.fixedOther <= 0) beShows = base.perShow > 0 ? 0 : null;
  const breakEven = { shows: beShows, kids: base.breakEvenKids, showsPerPeriod: beShows == null ? null : Math.ceil(fin(beShows * f)) };

  // прокат целиком: «сколько идёт спектакль» в месяцах (недели переводятся через календарь)
  const runMonths = fin(rep.runUnit === 'weeks' ? safeDiv(rep.runN * months, weeks, 0) : rep.runN);
  const run = { n: rep.runN, unit: rep.runUnit, months: runMonths, revenue: fin(base.revenueMonth * runMonths), profit: fin(monthly * runMonths), net: fin(monthly * runMonths - invest) };

  // накопление по месяцам — только когда период длиннее месяца: старт с минусом на сумму вложений
  let cumulative = null;
  if (periodMonths > 1) {
    const n = Math.max(1, Math.round(periodMonths));
    cumulative = Array.from({ length: n }, (_, i) => ({ m: i + 1, value: fin(monthly * (i + 1) - invest) }));
  }

  const status = statusOf(profit, revenue, cfg);
  const caveats = [];
  if (base.empty === 'shows') caveats.push('Показов нет — выручки нет, считаются только постоянные расходы.');
  else if (base.empty === 'kids') caveats.push('В зале 0 детей — выручки нет, а команда и дорога стоят денег.');
  else if (base.empty === 'revenue') caveats.push('Выручки нет: цена билета или число детей равны нулю.');
  if (base.vatOver) caveats.push('Годовая выручка выше порога НДС — НДС здесь не учтён.');
  if (invest > 0) caveats.push('Вложения на старте — разовые, в прибыль периода не входят: они считаются отдельно, в окупаемости.');
  if (rep.period === 'season') caveats.push(`Длина сезона — ${ruNum(seasonM, 1)} мес. — допущение проекта, не факт; месяцы считаются одинаковыми, без сезонных скачков.`);
  if (rep.period === 'week') caveats.push('Неделя — это средняя доля месяца; реальные недели отличаются.');
  caveats.push('Налог и взносы — предположения проекта, нужна консультация бухгалтера.');

  const out = {
    mode: base.mode, period: rep.period, periodMonths,
    title: String(rep.title).replace(/\s+/g, ' ').trim() || 'Мой спектакль',
    revenue, expenses, expensesTotal: fin(expensesTotal), profit, status, perHundred,
    perPeriod: { shows: fin(base.showsMonth * f), perShow: fin(base.perShow), week: fin(base.monthly * toMonth.week), month: monthly, season: fin(monthly * seasonM) },
    invest, payback, breakEven, run, cumulative, caveats, empty: base.empty,
    profitAfterInvest: fin(profit - invest), margin: revenue > 0 ? fin(100 * profit / revenue) : 0
  };
  out.shown = shownBook(out, cfg);
  out.verdict = verdictText(out, cfg);
  return out;
}

/* Подача бухгалтерии из ОДНОЙ точки округления: «Пришло», «Ушло всего», строки расходов и «Осталось» сходятся до рубля.
   Пришло и Ушло округляются до шага подачи; строки расходов делят округлённое «Ушло» методом наибольших остатков
   (в единицах шага), поэтому их сумма ровно равна «Ушло»; «Осталось» = Пришло − Ушло, а не отдельно округлённая прибыль. */
export function shownBook(r, cfg) {
  const step = roundStep(cfg);
  const revenue = roundTo(r.revenue, step);
  const expensesTotal = roundTo(r.expensesTotal, step);
  const units = splitInt(r.expenses.map(e => fin(e.amount) / step), Math.round(expensesTotal / step));
  const items = r.expenses.map((e, i) => ({ key: e.key, label: e.label, amount: (units[i] ?? 0) * step }));
  return { step, revenue, expensesTotal, profit: revenue - expensesTotal, items };
}

/* Одна фраза-вывод простыми словами */
export function verdictText(r, cfg) {
  const shownProfit = r.shown ? r.shown.profit : r.profit;          // та же цифра, что в «Осталось вам»
  const per = (PERIODS.find(p => p.id === r.period) || PERIODS[1]).word;
  if (r.empty === 'shows' || r.empty === 'revenue' || r.empty === 'kids') return 'Пока нечего считать: нет выручки. Укажите, сколько детей приходит и сколько показов в неделю.';
  if (r.status === 'minus') return `За ${per} получается в минусе: расходы больше выручки примерно на ${approxRub(-shownProfit, cfg).replace('≈' + NBSP, '')}. Поднимите цену или число детей, либо сократите расходы.`;
  if (r.status === 'zero') return `За ${per} выходите примерно в ноль: выручка почти равна расходам.`;
  const pm = monthsText(r.payback.months, cfg);
  const tail = r.payback.state === 'ok' ? ` Вложения вернутся ${pm === 'меньше месяца' ? 'меньше чем за месяц' : 'примерно за ' + pm.replace('≈' + NBSP, '')}` : (r.payback.state === 'never' ? ' Вложения пока не окупаются.' : '');
  const s = `За ${per} остаётся примерно ${approxRub(shownProfit, cfg).replace('≈' + NBSP, '')} чистыми.${tail}`;
  return s.endsWith('.') ? s : s + '.';
}
