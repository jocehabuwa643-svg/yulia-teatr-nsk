/* simple-calc.js — «Сколько я заработаю»: простой калькулятор приблизительной средней доходности (чистый модуль, без DOM).
   Формул здесь НЕТ: прибыль показа считает travel.calc(), прибыль студии и праздников — basecamp.baseMonth().
   Этот модуль только переводит простые вводы («детей в зале», «показов в неделю») во входы этих функций,
   собирает месячный и годовой итог и подбирает подсказки подстановкой. Константы — из data/config.json
   и data/rates.json (cfg); в коде только 0, 1 и определения (процент = доля × 100). */
import { num, nonNeg, share, safeDiv, getPath, ruNum } from './calculators/util.js';
import { calc as travelCalc } from './calculators/travel.js';
import { baseMonth } from './calculators/basecamp.js';

/* Режимы: два крупных переключателя */
export const MODES = [
  { id: 'travel', label: 'Выезжаю в школы и сады', hint: 'Спектакль приезжает к детям', icon: 'route' },
  { id: 'studio', label: 'Студия и праздники у себя', hint: 'Зал на Богдашке: показы, праздники, ученики', icon: 'building-2' }
];

/* Спецификация одного поля из cfg.calc.controls.simple: диапазон, шаг, значение по умолчанию (def_from — путь в cfg) */
function spec(cfg, id, studio) {
  const s = (cfg.calc && cfg.calc.controls && cfg.calc.controls.simple && cfg.calc.controls.simple[id]) || {};
  const path = studio && s.def_from_studio ? s.def_from_studio : s.def_from;     // у студии свой билет: выходного дня, а не выездной
  const fromPath = path ? getPath(cfg, path) : undefined;
  const def = studio && s.def_studio != null ? s.def_studio : (fromPath ?? s.def ?? s.min ?? 0);
  return { min: s.min ?? 0, max: s.max ?? 0, softMax: s.soft_max ?? null, step: s.step ?? 1, def, suffix: s.suffix ?? '' };
}
const r = (cfg, id, label, hint, studio, extra = {}) => ({ type: 'range', id, label, hint, ...spec(cfg, id, studio), ...extra });

/* Поля формы режима: main — крупные поля на экране (≤ 7), details — «Уточнить расчёт» (значения по умолчанию из config) */
export function simpleFields(cfg, mode) {
  const studio = mode === 'studio';
  const tc = cfg.travel || {}, bc = cfg.base_costs || {};
  const tax = { type: 'number', id: 'taxPct', label: 'Налог с выручки, %', hint: 'УСН «Доходы» — предположение проекта, требует консультации', def: spec(cfg, 'taxPct').def, suffix: '%', step: 0.5 };
  const money = (id, label, hint, def, extra = {}) => ({ type: 'number', id, label, hint, def, suffix: '₽', step: 'any', ...extra });
  const contrib = { type: 'number', id: 'contribPct', label: 'Взносы с гонораров, %', hint: 'Модельная надбавка проекта для найма по ГПХ', def: num(cfg.gphRate) * 100, suffix: '%', step: 0.1 };
  const other = money('otherMonthly', 'Реклама и прочее в месяц', 'Свои постоянные расходы сверх модели; по умолчанию 0', 0);
  const teamFee = (hint, ph) => ({ type: 'number', id: 'teamFee', label: 'Гонорар команды за показ', hint, def: null, suffix: '₽', step: 'any', optional: true, placeholder: ph });
  if (!studio) {
    return {
      main: [
        r(cfg, 'kids', 'Сколько детей в зале', 'Платящих детей на одном показе', false),
        r(cfg, 'ticket', 'Цена билета с ребёнка', 'Сколько платит один ребёнок', false),
        r(cfg, 'perWeek', 'Сколько показов в неделю', 'В среднем за неделю, без учёта сезона', false),
        { type: 'select', id: 'route', label: 'Куда едем', hint: 'От маршрута зависит бензин на день', options: (tc.routeNames || []).map((n, i) => [i, n]), def: 0 },
        tax
      ],
      details: [
        { type: 'select', id: 'venue', label: 'Площадка', hint: 'От площадки зависит доля кассы, которую она забирает', options: [[0, `Сад / школа · оргсбор ${ruNum((cfg.venue_share || {}).school_garden)}%`], [1, `Зал ДК · доля ${ruNum((cfg.venue_share || {}).dk)}%`]], def: 0 },
        r(cfg, 'perDay', 'Показов за один выезд', 'Несколько показов подряд в один день дешевле', false),
        { type: 'select', id: 'cast', label: 'Кто играет', hint: 'Основатели играют без взносов (модель)', options: [[0, 'Наём по ГПХ'], [1, 'Основатели ИП']], def: 0 },
        teamFee(`По модели: ${ruNum(tc.salary_city_single, 0)} ₽ в городе, ${ruNum(tc.salary_city_cluster, 0)} ₽ в кусте, ${ruNum(tc.salary_dk, 0)} ₽ в ДК`, 'по модели'),
        money('props', 'Реквизит и износ за показ', `По модели: ${ruNum(tc.wear_per_show, 0)} ₽, в ДК ${ruNum(tc.wear_dk, 0)} ₽`, null, { optional: true, placeholder: 'по модели' }),
        other, contrib
      ]
    };
  }
  const bcc = (cfg.calc && cfg.calc.controls && cfg.calc.controls.basecamp) || {};
  const area = cfg.calc && cfg.calc.base_area_default != null ? cfg.calc.base_area_default : 0;
  return {
    main: [
      r(cfg, 'kids', 'Сколько детей на показе', 'Зрителей на одном спектакле в вашем зале', true),
      r(cfg, 'ticket', 'Цена билета с ребёнка', 'Сколько платит один ребёнок', true),
      r(cfg, 'perWeek', 'Сколько показов в неделю', 'Спектакли выходного дня, в среднем за неделю', true),
      r(cfg, 'parties', 'Праздников в месяц', 'Дни рождения и аренда зала', true),
      r(cfg, 'partyCheck', 'Средний чек праздника', 'Сколько оплачивает один праздник', true),
      r(cfg, 'students', 'Учеников в студии', 'Платят абонемент каждый месяц; 0 — студии нет', true),
      tax
    ],
    details: [
      { type: 'select', id: 'area', label: 'Площадь зала', hint: 'От площади зависит аренда', options: ((bcc.area_options) || [area]).map(a => [a, `${a} м²`]), def: area },
      money('rent', 'Аренда за м² в месяц', 'Допущение проекта', num(bc.rent_per_m2)),
      money('subscription', 'Абонемент ученика в месяц', 'Допущение проекта', num(bcc.sub && bcc.sub.def)),
      money('admin', 'Администратор в месяц', 'Допущение проекта', num(bc.admin_month)),
      money('marketing', 'Реклама студии в месяц', 'Допущение проекта', num(bc.marketing_month)),
      teamFee(`По модели: ${ruNum(bc.weekend_fee, 0)} ₽ за спектакль выходного дня`, 'по модели'),
      money('props', 'Реквизит за показ', 'Допущение проекта', num(bc.weekend_props)),
      other, contrib
    ]
  };
}

/* Поля расходов, которые выводятся на экран явно (помещение / площадка и гонорар актёров): подмножество «Уточнить расчёт» */
export function costFields(cfg, mode) {
  const ids = mode === 'studio' ? ['area', 'rent', 'teamFee'] : ['venue', 'teamFee'];
  const all = simpleFields(cfg, mode).details;
  return ids.map(id => all.find(f => f.id === id)).filter(Boolean);
}

/* Значения по умолчанию: { id: def } для обоих списков полей */
export function simpleDefaults(cfg, mode) {
  const f = simpleFields(cfg, mode);
  const out = { mode };
  [...f.main, ...f.details].forEach(x => { out[x.id] = x.def != null ? x.def : (x.options ? x.options[0][0] : null); });
  return out;
}

/* ---------- Подстановка вводов в cfg существующих калькуляторов ---------- */
const perMonthFactor = cfg => safeDiv(num((cfg.calendar || {}).weeks_per_year), num((cfg.calendar || {}).months_per_year), 0);
const opt = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : nonNeg(v));

/* Копия cfg с правками пользователя: налог, взносы, гонорар, реквизит, цена. Исходный cfg не меняется */
function patchedCfg(i, cfg) {
  const c = { ...cfg, travel: { ...cfg.travel }, base_costs: { ...cfg.base_costs } };
  const tax = opt(i.taxPct); if (tax != null) c.usn = tax;
  const gph = opt(i.contribPct); if (gph != null) c.gphRate = share(gph);
  const fee = opt(i.teamFee), props = opt(i.props);
  if (i.mode === 'studio') {
    c.base_costs.weekend_ticket = nonNeg(i.ticket);
    if (fee != null) c.base_costs.weekend_fee = fee;
    if (props != null) c.base_costs.weekend_props = props;
    const adm = opt(i.admin), mk = opt(i.marketing);
    if (adm != null) c.base_costs.admin_month = adm;
    if (mk != null) c.base_costs.marketing_month = mk;
  } else {
    if (fee != null) { c.travel.salary_city_single = fee; c.travel.salary_city_cluster = fee; c.travel.salary_dk = fee; }
    if (props != null) { c.travel.wear_per_show = props; c.travel.wear_dk = props; }
  }
  return c;
}

/* Одно вычисление без подсказок: месячный итог и его составляющие по режиму */
function compute(input, cfg) {
  const i = { ...input, mode: input.mode === 'studio' ? 'studio' : 'travel' };
  const c = patchedCfg(i, cfg);
  const months = num(cfg.calendar.months_per_year);
  const perWeek = nonNeg(i.perWeek);
  const showsMonth = perWeek * perMonthFactor(cfg);
  const fixedOther = nonNeg(i.otherMonthly);
  const out = { mode: i.mode, perWeek, showsMonth, months, fixedOther };

  if (i.mode === 'travel') {
    const k = Math.max(1, Math.round(num(i.perDay, 1)));
    const t = travelCalc({ n: nonNeg(i.kids), p: nonNeg(i.ticket), k, r: num(i.route), dk: num(i.venue) ? 1 : 0, own: num(i.cast) ? 1 : 0 }, c);
    const perShow = t.per, scale = safeDiv(showsMonth, k, 0);     // t.* — на день из k показов; в месяц — по числу дней
    out.perShow = perShow;
    out.revenueMonth = t.gross * scale;
    out.monthly = perShow * showsMonth - fixedOther;
    out.breakEvenKids = Math.max(1, Math.ceil(safeDiv(t.be, k, 0)));
    out.breakEvenShows = fixedOther > 0 ? (perShow > 0 ? Math.ceil(safeDiv(fixedOther, perShow, 0)) : null) : null;
    out.parts = [
      { id: 'pay', label: 'Гонорар команды и взносы', v: (t.salary + t.social) * scale },
      { id: 'road', label: 'Бензин, износ, печать', v: (t.fuel + t.wear + t.print) * scale },
      { id: 'tax', label: 'Налог и доля площадки', v: (t.fee + t.tax) * scale },
      ...(fixedOther > 0 ? [{ id: 'other', label: 'Реклама и прочее', v: fixedOther }] : [])
    ];
    out.taxMonth = t.tax * scale;
    // статьи для экрана «Посчитать» (в месяц, те же слагаемые, что в t.*): сумма статей = выручка − прибыль
    out.articles = { rent: 0, venue: t.fee * scale, actors: (t.salary + t.social) * scale, tax: t.tax * scale, road: t.fuel * scale, ads: fixedOther, other: (t.wear + t.print) * scale };
    out.detail = t;
    return out;
  }

  // Студия: показы выходного дня, праздники, ученики — baseMonth(); предельный вклад одного показа — разность соседних точек
  const m = { area: nonNeg(i.area), rent: nonNeg(i.rent), s: nonNeg(i.students), p: nonNeg(i.subscription), w: showsMonth, a: nonNeg(i.kids), h: nonNeg(i.parties), c: nonNeg(i.partyCheck) };
  const b = baseMonth(m, c);
  const plus1 = baseMonth({ ...m, w: m.w + 1 }, c).profit - b.profit;
  const zeroShows = baseMonth({ ...m, w: 0 }, c).profit - fixedOther;
  out.perShow = plus1;
  out.revenueMonth = b.gross;
  out.monthly = b.profit - fixedOther;
  out.breakEvenShows = plus1 > 0 ? (zeroShows >= 0 ? 0 : Math.ceil(safeDiv(-zeroShows, plus1, 0))) : null;
  out.breakEvenKids = null;
  out.parts = [
    { id: 'fixed', label: 'Аренда, администратор, реклама', v: b.fixed + fixedOther },
    { id: 'pay', label: 'Гонорары, преподаватели, праздники', v: b.teachers + b.week + b.party },
    { id: 'tax', label: 'Налог', v: b.tax }
  ];
  out.taxMonth = b.tax;
  // статьи для экрана «Посчитать» (в месяц): слагаемые baseMonth() по тем же значениям cfg, что и сам расчёт
  const bk = c.base_costs;
  const rentPart = m.area * (m.rent + bk.utilities_per_m2), adsPart = bk.marketing_month + fixedOther;
  const weekFee = m.w * bk.weekend_fee * (1 + c.gphRate);
  out.articles = {
    rent: rentPart, venue: 0, actors: b.teachers + weekFee, tax: b.tax, road: 0, ads: adsPart,
    other: (b.fixed + fixedOther - rentPart - adsPart) + (b.week - weekFee) + b.party      // администратор, реквизит, доля кассы, праздники
  };
  out.detail = b;
  return out;
}

/* Статус итога: в плюсе / около нуля / в минусе. Полоса «около нуля» — доля выручки из config */
export function statusOf(monthly, revenue, cfg) {
  const band = share(num((cfg.simple_calc || {}).zero_band_pct)) * Math.max(0, revenue);
  if (Math.abs(monthly) <= band) return 'zero';
  return monthly > 0 ? 'plus' : 'minus';
}

/* Подсказки подстановкой: что поменять, чтобы выйти в плюс (или заработать больше). Числа — из compute(), не оценки.
   kind: price | kids | shows | none; to — новое значение поля, gain — прирост чистыми в месяц, zero — выводит ли в ноль */
function buildAdvice(input, cfg, base) {
  const out = [];
  const at = patch => compute({ ...input, ...patch }, cfg).monthly;
  const cur = base.monthly;
  const step = Math.max(1, num(cfg.calc.pricing.price_round_step, 1));
  const ctl = cfg.calc.controls.simple;
  const need = cur < 0;                                // нужно ли выходить в ноль
  const kids = nonNeg(input.kids), ticket = nonNeg(input.ticket), perWeek = nonNeg(input.perWeek);

  // цена: ближайшая кратная шагу, при которой месяц не в минусе (или +1 шаг, если уже в плюсе)
  if (base.showsMonth > 0 && kids > 0) {
    if (need) {
      for (let p = (Math.floor(ticket / step) + 1) * step; p <= num(ctl.ticket.max); p += step) {
        const m = at({ ticket: p });
        if (m >= 0) { out.push({ kind: 'price', to: p, gain: m - cur, zero: true }); break; }
      }
    } else {
      const p = (Math.floor(ticket / step) + 1) * step;
      out.push({ kind: 'price', to: p, gain: at({ ticket: p }) - cur, zero: false });
    }
  }
  // дети: сколько нужно на показе, чтобы выйти в ноль
  if (need && base.showsMonth > 0) {
    for (let k = Math.floor(kids) + 1; k <= num(ctl.kids.soft_max ?? ctl.kids.max); k++) {
      const m = at({ kids: k });
      if (m >= 0) { out.push({ kind: 'kids', to: k, gain: m - cur, zero: true }); break; }
    }
  }
  // показы: до нуля или +1 в неделю, если каждый показ приносит прибыль
  if (base.perShow > 0) {
    if (need) {
      for (let w = Math.floor(perWeek) + 1; w <= num(ctl.perWeek.max); w++) {
        const m = at({ perWeek: w });
        if (m >= 0) { out.push({ kind: 'shows', to: w, gain: m - cur, zero: true }); break; }
      }
    }
    if (!out.some(a => a.kind === 'shows')) out.push({ kind: 'shows', to: perWeek + 1, gain: at({ perWeek: perWeek + 1 }) - cur, zero: false });
  }
  if (need && !out.some(a => a.zero)) out.push({ kind: 'none', to: null, gain: 0, zero: false });
  return out;
}

/* Главная функция: input — значения полей (см. simpleFields), cfg — единый конфиг, ctx.seasonality — месяцы из seasonality.json */
export function simpleProfit(input, cfg, ctx = {}) {
  const base = compute(input, cfg);
  const status = statusOf(base.monthly, base.revenueMonth, cfg);
  const yearly = base.monthly * base.months;
  const margin = base.revenueMonth > 0 ? 100 * base.monthly / base.revenueMonth : 0;

  // сезонность: только для выездов (там прибыль линейна по числу показов), только при реальных данных
  let season = null;
  const sf = (ctx.seasonality || []).filter(x => x && Number.isFinite(x.factor) && x.factor > 0);
  if (base.mode === 'travel' && sf.length === num(base.months) && base.showsMonth > 0) {
    const mean = sf.reduce((a, x) => a + x.factor, 0) / sf.length;
    const rows = sf.map(x => ({ name: x.name || String(x.m), factor: x.factor, monthly: base.perShow * base.showsMonth * (x.factor / mean) - base.fixedOther }));
    const hi = rows.reduce((a, x) => (x.monthly > a.monthly ? x : a), rows[0]);
    const lo = rows.reduce((a, x) => (x.monthly < a.monthly ? x : a), rows[0]);
    season = { rows, hi, lo };
  }

  // НДС не учитывается: предупреждаем, если годовая выручка выше порога года
  const yp = (cfg.byYear && cfg.byYear[cfg.year]) || {};
  const annualRevenue = base.revenueMonth * base.months;
  const vatOver = yp.vatThreshold != null && annualRevenue > yp.vatThreshold;

  const empty = base.showsMonth <= 0 ? 'shows' : (base.mode === 'travel' && nonNeg(input.kids) <= 0 ? 'kids' : (base.revenueMonth <= 0 ? 'revenue' : null));
  return {
    ...base, status, yearly, margin, season, vatOver, annualRevenue, empty,
    vatThreshold: yp.vatThreshold ?? null,
    advice: buildAdvice(input, cfg, base)
  };
}

/* Модуль в формате реестра калькуляторов (controls/calc/summary): на нём работает общая таблица сравнения сценариев.
   Поле mode хранится во входах сценария, поэтому controls() режима берётся из inputs.mode — для сравнения оба набора склеиваются */
export function makeSimpleModule(seasonality) {
  const fieldsFor = (cfg, mode) => { const f = simpleFields(cfg, mode); return [...f.main, ...f.details]; };
  return {
    meta: { id: 'simple', title: 'Сколько я заработаю', headline: 'result' },
    controls: cfg => [{ type: 'select', id: 'mode', label: 'Режим', options: MODES.map(m => [m.id, m.label]), def: 'travel' }, ...fieldsFor(cfg, 'travel'), ...fieldsFor(cfg, 'studio').filter(f => !fieldsFor(cfg, 'travel').some(x => x.id === f.id))],
    calc: (input, cfg) => simpleProfit(input, cfg, { seasonality }),
    summary: res => [
      { label: 'Чистыми в месяц', v: res.monthly, t: 'rub' },
      { label: 'С одного показа', v: res.perShow, t: 'rub' },
      { label: 'За год', v: res.yearly, t: 'rub' },
      { label: 'Выручка в месяц', v: res.revenueMonth, t: 'rub' },
      { label: 'Безубыточность', v: res.mode === 'travel' ? res.breakEvenKids : res.breakEvenShows, t: 'int', empty: 'не достигается' }
    ]
  };
}
