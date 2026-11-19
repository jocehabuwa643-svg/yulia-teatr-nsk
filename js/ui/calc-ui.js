/* calc-ui.js — универсальный рендер калькуляторов: поля ввода, результат, источники.
   Читает спецификации модулей; результат собирает из calc() функциями R.*. Числовых констант тут нет:
   все цифры в текстах берутся из cfg (data/config.json, data/rates.json); геометрия графиков — в calc-charts.js. */
import { $, fmt, rub, signed, pct, kv, minis, costBar, goalbar, table, srcBadge } from './helpers.js';
import { lineChart, barsChart, gauge } from './calc-charts.js';
import { business } from '../calculators/basecamp.js';
import { registry } from '../calculators/index.js';
import { calc as travelCalc } from '../calculators/travel.js';
import { methodLines, legalLine } from '../calculators/method.js';
import { formatHeadline, thousands } from '../calculators/headline.js';
import { clamp, ruNum } from '../calculators/util.js';

/* ==== Поля ввода ==== */
/* id элемента в DOM: у полей разных калькуляторов совпадают имена (year, venue, route…), поэтому id префиксуется */
const D = f => f.dom || f.id;
const attr = v => String(v).replace(/"/g, '&quot;');

export function fieldHTML(f) {
  if (f.type === 'range') {
    // Ползунок + числовое поле: ввод цифрами точный (не «прилипает» к шагу ползунка), ползунок показывает ближайшее
    const lim = f.softMax != null ? ` data-softmax="${f.softMax}"` : '';
    return `<div class="field ${f.wide ? 'wide' : ''}">
      <label for="${D(f)}Num">${f.label}${f.suffix ? ` <span class="fsuf">(${f.suffix})</span>` : ''}</label>
      <div class="frow">
        <input data-suffix="${attr(f.suffix || '')}" id="${D(f)}" type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${f.def}" aria-label="${attr(f.label)}, ползунок"${lim}>
        <input class="fnum" id="${D(f)}Num" type="number" inputmode="decimal" min="${f.min}" max="${f.softMax ?? f.max}" step="any" value="${f.def}" aria-label="${attr(f.label)}, точное значение">
      </div>
      <output class="fv" for="${D(f)}" id="${D(f)}Val" aria-hidden="true"></output>
    </div>`;
  }
  const def = f.def ?? f.options[0][0];
  return `<div class="field ${f.wide ? 'wide' : ''}"><label for="${D(f)}">${f.label}</label><select id="${D(f)}">${f.options.map(o => { const [val, s] = Array.isArray(o) ? o : [o, o]; return `<option value="${val}" ${String(val) === String(def) ? 'selected' : ''}>${s}</option>`; }).join('')}</select></div>`;
}

/* Верхняя граница поля: мягкий максимум (data-softmax) позволяет вводить цифрами за пределами ползунка */
const hiOf = el => (el.dataset.softmax ? Number(el.dataset.softmax) : Number(el.max));

/* Значение поля: у range приоритет у числового поля (точный ввод), с зажимом в [min; мягкий максимум]; пусто → ползунок */
function fieldValue(f) {
  const el = $(D(f));
  if (!el) return f.def;
  if (f.type !== 'range') {
    const n = Number(el.value);
    return el.value === '' || Number.isNaN(n) ? el.value : n;
  }
  const nm = $(D(f) + 'Num');
  const typed = nm && nm.value !== '' ? Number(nm.value) : NaN;
  if (Number.isFinite(typed)) return clamp(typed, Number(el.min), hiOf(el));
  return Number(el.value);
}

export function readInputs(fields) {
  const out = {};
  fields.forEach(f => { out[f.id] = fieldValue(f); });
  return out;
}

/* Заливка активной части ползунка (то же, что делает initUI, но сразу после программной смены значения) */
function paint(r) {
  const min = Number(r.min), max = Number(r.max), v = Number(r.value);
  r.style.setProperty('--fill', max > min ? ((v - min) / (max - min) * 100).toFixed(2) + '%' : '0%');
}

/* Показать значения рядом с ползунками и синхронизировать ползунок с числовым полем (если оно не в фокусе) */
export function rangeValues(fields) {
  fields.filter(f => f.type === 'range').forEach(f => {
    const e = $(D(f)); if (!e) return;
    const v = fieldValue(f);
    const o = $(D(f) + 'Val');
    const text = `${fmt(v)} ${e.dataset.suffix || ''}`.trim();
    if (o) o.textContent = text;
    e.setAttribute('aria-valuetext', text);
    const nm = $(D(f) + 'Num');
    if (nm && document.activeElement !== nm && Number(nm.value) !== v) nm.value = String(v);
    const sv = clamp(v, Number(e.min), Number(e.max));
    if (Number(e.value) !== sv) e.value = String(sv);
    paint(e);
  });
}

/* Записать значения в поля (сброс, сценарий, пресет). Неизвестные id и неверные варианты select игнорируются */
export function writeInputs(fields, values) {
  fields.forEach(f => {
    if (!(f.id in values)) return;
    const el = $(D(f)); if (!el) return;
    if (f.type === 'range') {
      const v = Number(values[f.id]);
      if (!Number.isFinite(v)) return;
      const c = clamp(v, f.min, f.softMax ?? f.max);
      el.value = String(clamp(c, f.min, f.max));
      const nm = $(D(f) + 'Num'); if (nm) nm.value = String(c);
      paint(el);
    } else if ([...el.options].some(o => o.value === String(values[f.id]))) el.value = String(values[f.id]);
  });
}

/* Поле числа ↔ ползунок: ввод цифрами пересчитывает сразу; на выходе из поля значение нормализуется до границ.
   onChange(id) вызывается после каждой правки поля калькулятора. */
export function bindNumberSync(container, onChange) {
  container.addEventListener('input', e => {
    const t = e.target;
    if (t.classList && t.classList.contains('fnum')) {
      const range = $(t.id.slice(0, -3)); // «kidsNum» → «kids»
      if (!range) return;
      if (t.value !== '' && Number.isFinite(Number(t.value))) { range.value = String(clamp(Number(t.value), Number(range.min), Number(range.max))); paint(range); }
      onChange(range.id);
    } else if (t.type === 'range') {
      const nm = $(t.id + 'Num');
      if (nm) nm.value = t.value;
      onChange(t.id);
    }
  });
  container.addEventListener('change', e => {
    const t = e.target;
    if (!(t.classList && t.classList.contains('fnum'))) return;
    const range = $(t.id.slice(0, -3)); if (!range) return;
    // пустое / неверное / за границами → ближайшее допустимое значение
    const v = t.value === '' || !Number.isFinite(Number(t.value)) ? Number(range.value) : clamp(Number(t.value), Number(range.min), hiOf(range));
    t.value = String(v);
    onChange(range.id);
  });
}

/* ==== Источники и допущения ==== */

/* Плашка источника у значения: надёжность + дата проверки + «Требует консультации» (для налогового слоя).
   Предположения проекта и ручной ввод помечаются своими подписями — они не «данные источника». */
export function srcTag(src, cfg) {
  if (!src) return '';
  const tag = (t, cls = '', title = '') => `<span class="srcinfo"><span class="sbadge ${cls}"${title ? ` title="${attr(title)}"` : ''}>${t}</span></span>`;
  const consult = /консультации/.test(src.legal_note || '') ? tag('Требует консультации', 'consult') : '';
  if (src.confidence === 'manual') return tag('ручной ввод', 'manual', 'Значение введено вручную и хранится только в этом браузере');
  if (src.confidence === 'model') return tag('предположение проекта · можно изменить', 'model') + consult;
  const days = cfg && cfg.ui ? cfg.ui.stale_badge_days_rates : undefined;
  return srcBadge(src, days) + consult;
}
const rateTag = (cfg, key) => srcTag(cfg.rateMeta && cfg.rateMeta[key], cfg);

/* Значение ставки для списка источников: число с единицей, «нет данных» или краткая строка */
function valueText(v, unit, max) {
  if (v == null) return 'нет данных';
  if (typeof v === 'number') return `${ruNum(v, 4)} ${unit || ''}`.trim();
  return String(v).length > max ? String(v).slice(0, max - 1) + '…' : String(v);
}

/* Список источников калькулятора: подпись, значение, плашка, первоисточник, юр-пометка. «*» в ключе — по году расчёта */
export function sourcesHTML(mod, cfg, year) {
  const keys = (mod.meta.sources || []).map(k => (k.endsWith('*') ? `${k.slice(0, -1)}.${year}` : k));
  const items = keys.filter(k => cfg.rateMeta && cfg.rateMeta[k]).map(k => {
    const m = cfg.rateMeta[k], v = cfg.rateVals[k];
    const fill = v == null ? ` <button type="button" class="btn small secondary" data-fill="${k}">Ввести вручную</button>` : '';
    return `<li><span class="sl-name">${m.label || k}</span> <b>${valueText(v, m.unit, cfg.ui.source_value_max_chars)}</b>${fill}<br>${rateTag(cfg, k)}
      <span class="tiny">${m.source_url ? `<a href="${m.source_url}" target="_blank" rel="noopener">${m.source_name}</a>` : m.source_name}${m.fetched_at ? ` · проверено ${m.fetched_at}` : ''}</span></li>`;
  });
  return items.length ? `<ul class="srclist">${items.join('')}</ul>` : '<p class="tiny">Налоговых источников нет: все значения — допущения проекта.</p>';
}
export const methodHTML = (id, cfg, year) => `<ul class="methodlist">${methodLines(id, cfg, year).map(l => `<li>${l}</li>`).join('')}</ul>`;

/* ==== Общие блоки результата ==== */
const plate = (title, value, lines) => `<div class="plate"><small>${title}</small><b>${value}</b>${lines.map(l => `<span>${l}</span>`).join('')}</div>`;
/* Совет/предупреждение: видна первая фраза (до calc_tip_chars знаков из data), остальное — в «Подробнее» */
const tip = (cfg, title, text, kind = '') => {
  const parts = String(text).split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«])/);
  let shown = parts.shift() || '';
  while (parts.length && `${shown} ${parts[0]}`.length <= cfg.ui.calc_tip_chars) shown += ` ${parts.shift()}`;
  // одна длинная фраза: режем по двоеточию, точке с запятой или запятой не дальше предела
  if (shown.length > cfg.ui.calc_tip_chars) {
    const ds = [': ', '; ', ' — ', ', '];
    const cut = Math.max(...ds.map(d => shown.lastIndexOf(d, cfg.ui.calc_tip_chars)));
    if (cut > 0) { parts.unshift(shown.slice(cut).replace(/^[:;,]?\s*(—\s*)?/, '')); shown = `${shown.slice(0, cut)}.`; }
    else {                                                        // разделителя нет — режем по слову, полный текст в «Подробнее»
      parts.unshift(shown);
      shown = `${shown.slice(0, shown.lastIndexOf(' ', cfg.ui.calc_tip_chars))}…`;
    }
  }
  const rest = parts.join(' ');
  return `<div class="advice ${kind}"><strong>${title}</strong>${shown}${rest ? `<details><summary>Подробнее</summary><p>${rest}</p></details>` : ''}</div>`;
};
/* Раскрывающееся пояснение: длинный текст не загромождает карточку */
const more = (title, text) => `<details><summary>${title}</summary><p class="tiny">${text}</p></details>`;
/* «Нет данных»: короткая пометка + кнопка ручного ввода; пояснение — в раскрывающемся блоке */
const nodata = (text, fillKey, label = 'Ввести вручную') => `<div class="nodata"><span>${text}</span>${fillKey ? `<button type="button" class="btn small secondary" data-fill="${fillKey}">${label}</button>` : ''}</div>`;
/* Главная цифра результата: формат по типу калькулятора (meta.headline) — «+» только у итога со знаком,
   цена и налог без плюса, штуки без ₽. null → empty (например «недостижима»), а не «0 ₽» */
const KIND = Object.fromEntries(registry.map(m => [m.meta.id, m.meta.headline]));
const head = (id, label, v, sub, empty) => {
  const kind = KIND[id];
  const neg = kind === 'result' && Number.isFinite(v) && Math.round(v) < 0;
  return `<div><div class="res-label">${label}</div><div class="big-num${neg ? ' negative' : ''}">${formatHeadline(kind, v, empty)}</div><p class="tiny">${sub}</p></div>`;
};

const R = {};

R.travel = (input, cfg, r) => {
  const NCHART = cfg.calc.chart_points;                          // точек на графике — из data/config.json
  const nMax = Math.max(Math.ceil(r.be / r.k) * 2, input.kids * 2, NCHART);
  const pts = Array.from({ length: NCHART + 1 }, (_, i) => {
    const n = Math.round(nMax * i / NCHART);
    return { x: n, y: travelCalc({ n, p: input.ticket, k: input.cluster, r: input.route, dk: input.venue, own: input.cast }, cfg).profit };
  });
  const beShow = Math.max(1, Math.ceil(r.be / Math.max(1, r.k)));
  return head('travel', 'Чистая прибыль', r.per, 'С одного показа после перечисленных расходов, до постоянных затрат.') +
    minis([['Выручка дня', rub(r.gross)], ['Прибыль дня', signed(r.profit)], ['Маржа', pct(r.margin)]]) +
    lineChart({ points: pts, marks: [{ x: Math.min(beShow, nMax), label: 'безубыточность' }], aria: `Прибыль дня в зависимости от числа зрителей на показ: ноль при ${beShow} зрителях`, unitX: 'зрит.' }) +
    costBar([
      ['ФОТ и взносы', r.salary + r.social, 'c1'],
      ['Транспорт и реквизит', r.fuel + r.wear + r.print, 'c2'],
      ['Налоги и доля площадки', r.fee + r.tax, 'c3'],
      ['Остаток Юлии', Math.max(0, r.profit), 'c4']
    ]) +
    `<div class="ledger">
      ${kv('Гонорар команды', rub(r.salary))}
      ${kv('Взносы (модель)', `${rub(r.social)} ${rateTag(cfg, 'gph_contributions_rate')}`)}
      ${kv(`Доля площадки (${ruNum(r.rate * 100, 1)}%)`, rub(r.fee))}
      ${kv(`УСН ${ruNum(r.usn, 2)}%`, `${rub(r.tax)} ${rateTag(cfg, 'usn_income_rate')}`)}
      ${kv('Расходы ' + (r.k === 1 ? 'показа' : 'дня'), rub(r.cost))}
    </div>` +
    tip(cfg, 'Совет помощника',
      r.profit < 0 ? `Не подтверждайте выезд на этих условиях. До нуля не хватает ${fmt(Math.max(0, r.be - input.kids * r.k))} оплаченных мест за день. Объедините группы или согласуйте минимум кассы.`
        : r.margin < cfg.calc.advice.low_margin_pct ? 'Показ покрывает прямые расходы, но запас небольшой. Второй показ по тому же адресу снизит долю транспорта.'
          : 'Условия дают запас. Зафиксируйте число детей и второй слот письменно до бронирования команды.',
      r.profit < 0 ? 'warn' : '') +
    `<p class="hint">Безубыточность: ${r.be} зрителей за день, в среднем не меньше ${beShow} на показ при одинаковых группах.</p>`;
};

R.basecamp = (input, cfg, r) => {
  const x = r.x, year = x.year, T = x.threshold;
  const NCHART = cfg.calc.chart_points;
  const capShows = input.teams * cfg.tour_unit.capacity_per_troupe;
  const step = Math.max(1, Math.ceil(capShows / NCHART));
  const pts = []; let first = null;
  for (let n = 0; n <= capShows; n += step) {
    const bx = business(r.b, n, input.teams, cfg, true, year);
    pts.push({ x: n, y: bx.profit });
    if (first == null && bx.reg) first = n;
  }
  const marks = first != null && first > 0 ? [{ x: first, label: 'порог НДС' }] : [];
  const lowRate = cfg.byYear[year].vatLow;
  return head('basecamp', 'Чистая прибыль', x.profit, 'Расчётная чистая операционная прибыль бизнеса за месяц, не остаток на счёте.') +
    minis([
      ['База отдельно', signed(x.baseProfit)],
      ['Выезды', signed(x.tourProfit)],
      ['Окупаемость¹', r.payback != null ? fmt(r.payback) + ' мес.' : 'Не достигается']
    ]) +
    lineChart({ points: pts, marks, aria: 'Прибыль месяца в зависимости от числа выездных показов; излом — переход через порог НДС', unitX: 'показов' }) +
    `<div class="platerow">${plate('До порога НДС', signed(x.profitNoVat), ['без НДС и штаба'])}${plate('После порога', signed(x.profitOver), [`НДС ${ruNum(lowRate)}% в цене и штаб ${rub(cfg.phases_budget.hq_month_over_threshold)}`])}</div>` +
    (T != null ? gauge({ value: x.annual, limit: T, label: `Годовой темп к порогу НДС ${ruNum(T / 1e6)} млн ₽ (${year})`, aria: `Годовой темп выручки ${rub(x.annual)} при пороге ${rub(T)}` }) : '') +
    costBar([
      ['ФОТ и взносы', r.b.teachers + r.b.week + r.b.party, 'c1'],
      ['База: аренда и фикс', r.b.fixed, 'c2'],
      ['Налоги', r.b.tax + x.vat, 'c3'],
      ['Остаток Юлии', Math.max(0, x.profit), 'c4']
    ]) +
    `<div class="ledger">
      ${kv('Выручка базы', rub(r.b.gross))}
      ${kv('Аренда, КУ, администрация и реклама', rub(r.b.fixed))}
      ${kv('Выручка всего за месяц', rub(x.g))}
      ${kv('Годовой темп (месяц × 12)', rub(x.annual))}
      ${kv('НДС в цене / штаб', `${rub(x.vat)} / ${rub(x.hq)} ${rateTag(cfg, 'vat_rate_special_low')}`)}
      ${kv(`Порог НДС (${year})`, `${T != null ? rub(T) : 'нет данных'} ${rateTag(cfg, `vat_threshold.${year}`)}`)}
    </div>` +
    (x.reg ? tip(cfg, `Порог ${ruNum(T / 1e6)} млн ₽ превышен по годовому темпу`, `В сценарии цены уже включают НДС ${ruNum(x.vatRate)}%; для УСН НДС исключён из дохода. Добавлен штаб ${rub(x.hq)} в месяц. Фактический переход зависит от дохода календарного года, не от экстраполяции.`, 'warn')
      : tip(cfg, 'Порог НДС не превышен', `Годовой темп ${rub(x.annual)} ниже порога. После порога прибыль была бы ${rub(x.profitOver)}.`)) +
    tip(cfg, 'Совет помощника', x.reg ? 'Сравните два пути: держать выручку под порогом (ограничить выезды) или принять НДС и штаб — плашки «до» и «после» показывают цену выбора.' : 'Следите за годовым темпом: приближаясь к порогу, заранее решите, что выгоднее — вырасти через НДС или остаться под порогом.') +
    (x.served < input.trips ? tip(cfg, 'Не хватает мощности трупп', `Запрошено ${input.trips}, в результат вошло ${x.served} показов. Добавьте труппу или измените график.`, 'warn') : '') +
    `<div class="goals">${goalbar(`Цель ${cfg.goals.short_range}`, x.profit, cfg.goals.short_target)}${goalbar(`Цель ${cfg.goals.long_range}`, x.profit, cfg.goals.long_target)}</div>` +
    `<p class="hint">¹ Бюджет ${fmt(cfg.phases_budget.total)} ₽ ÷ прибыль, вверх. Без разгона и доп. комплектов.</p>`;
};

R.goal = (input, cfg, r) => {
  const NCHART = cfg.calc.chart_points;
  const stride = Math.max(1, Math.ceil(r.curve.length / (NCHART * 2)));
  const pts = r.curve.filter((_, i) => i % stride === 0 || i === r.curve.length - 1).map(c => ({ x: c.n, y: c.profit }));
  return `<div><div class="res-label">План на один месяц</div><h3>${r.plan ? 'Как получить ' + rub(r.goal) : 'Цель выше мощности этой стадии'}</h3></div>` +
    `<div class="planresult">${[[r.x.n, 'выездных показов'], [r.students, 'учеников студии'], [r.x.t, 'гастрольных трупп']].map(([n, l]) => `<div><b>${n}</b><small>${l}</small></div>`).join('')}</div>` +
    lineChart({ points: pts, hLines: r.goal > 0 ? [{ y: r.goal, label: 'цель' }] : [], marks: r.plan && r.x.n > 0 ? [{ x: r.x.n, label: 'план' }] : [], aria: `Прибыль месяца в зависимости от числа выездных показов; цель ${rub(r.goal)}`, unitX: 'показов' }) +
    `<div class="ledger">
      ${kv('Плановая прибыль', signed(r.x.profit))}
      ${kv('В том числе база / фикс без базы', signed(r.x.baseProfit))}
      ${kv('Зрителей на выездах', fmt(r.x.n * r.x.aud))}
      ${kv('Выручка месяца', rub(r.x.g))}
      ${kv(`Порог НДС (${r.x.year})`, `${r.x.threshold != null ? rub(r.x.threshold) : 'нет данных'} ${rateTag(cfg, `vat_threshold.${r.x.year}`)}`)}
    </div>` +
    tip(cfg, r.plan ? 'Совет помощника: что бронировать' : 'Совет помощника: что изменить',
      r.plan ? `${r.model ? `${r.model.weekend_shows} показов выходного дня и ${r.model.parties} праздников. ` : 'Работа без своей площадки. '}${r.x.n ? `Нужно ${fmt(r.x.n * r.x.aud)} оплаченных посещений в месяц. Сначала закрепите кластеры с повторными показами.` : 'Выезды для этой цели не обязательны: её покрывает база.'}` : `До цели не хватает ${rub(r.goal - r.x.profit)}. Сейчас доступно не более ${r.max} показов; выберите более зрелую стадию или снизьте цель.`,
      r.plan ? '' : 'warn') +
    `<p class="hint">Без базы: одна труппа, до ${cfg.tour_unit.capacity_per_troupe} показов. С базой: до ${cfg.calc.controls.basecamp.teams.max} трупп и ${cfg.calc.goal_max_shows_with_base} показов.</p>`;
};

R.taxes = (input, cfg, r) => {
  const yr = r.year, T = r.threshold, c = r.crossing, best = r.best;
  const top = head('taxes', 'Налог года (лучшая схема)', best ? best.tax : null, best ? `«${best.name}» при выручке ${rub(r.revenue)} и расходах ${input.costShare}% · ${yr} год` : 'Ставки режимов без проверенных данных — введите вручную.');
  // плашки «до / после порога»: оба берега считаются по ОДНОМУ режиму (УСН «Доходы»), лучший режим — отдельной строкой ниже
  const usn6Of = s => s.regimes.find(q => q.id === 'usn6');
  const usn6Text = s => (s.usnLost ? 'УСН недоступна' : rub(usn6Of(s).tax));
  const side = s => [
    `НДС за год: ${rub(s.vat)}`,
    `Взносы ИП: ${rub(s.ip.total)}`,
    `Остаток владельца: ${s.usnLost ? 'УСН недоступна' : signed(s.netUsn6)}`
  ];
  const plates = T == null ? '' : `<div class="platerow">${plate(`До порога · ${rub(r.before.revenue)}`, usn6Text(r.before), ['налог УСН «Доходы»', ...side(r.before)])}${plate(`${c.over ? 'После порога · ваша выручка' : 'Сразу после порога'} · ${rub(r.after.revenue)}`, usn6Text(r.after), ['налог УСН «Доходы»', ...side(r.after)])}</div>`;
  const bestName = s => (s.best ? `«${s.best.name}» · ${rub(s.best.tax)}` : 'нет данных');
  const cross = T == null ? nodata(`Порог НДС на ${yr} год не определён — введите вручную.`, `vat_threshold.${yr}`) :
    `<div class="ledger">
      ${kv(`Порог НДС (${yr})`, `${rub(T)} ${rateTag(cfg, `vat_threshold.${yr}`)}`)}
      ${kv(c.over ? 'Превышение порога' : 'Запас до порога', rub(Math.abs(c.headroom)))}
      ${kv('Лучший режим по налогу до порога', bestName(r.before))}
      ${kv('Лучший режим по налогу после порога', bestName(r.after))}
      ${kv('Точка перехода: выручка, при которой остаток снова как на пороге', c.breakEven != null ? rub(c.breakEven) : 'не достигается')}
      ${kv('Порог пересекается', c.month != null ? `в ${c.month}-м месяце` : 'не пересекается')}
      ${kv('НДС начинается', c.month == null ? '—' : (c.vatFromMonth != null ? `с ${c.vatFromMonth}-го месяца` : 'со следующего года'))}
      ${kv('НДС в год превышения', c.month != null ? rub(c.vatFirstYear) : '—')}
    </div>`;
  // таблица режимов до/после
  const cell = (g, s) => { const x = s.regimes.find(q => q.id === g.id); return x && x.tax != null ? rub(x.tax) : (x && x.lost ? 'УСН недоступна' : 'нет данных'); };
  const tbl = table(['Режим', 'До порога', 'После порога'], r.regimes.map(g => [g.name, cell(g, r.before), cell(g, r.after)]));
  // карточки режимов (по вашей выручке)
  const cards = r.regimes.map(g => {
    let body;
    if (g.id === 'usnSocial' && g.needStatus) body = `<p class="tiny">Нужен статус соцпредприятия</p>${more('Условие', legalLine(cfg, 'social_need_status'))}`;
    else if (g.id === 'usnSocial' && g.noData) body = nodata(`Ставка ${yr} года — нет данных`, `usn_nso_social_income.${yr}`) + more('Подробнее', legalLine(cfg, 'social_missing', { year: yr }) + (r.socialYear ? legalLine(cfg, 'social_reference', { refYear: r.socialYear, refRate: cfg.byYear[r.socialYear].usnSocial }) : '')) + `<button type="button" class="btn small secondary" data-fill="usn_nso_social_income_minus_costs.${yr}">Ввести ставку «Д−Р»</button>`;
    else if (g.id === 'patent' && g.noData) body = nodata('Потенциальный доход — нет данных', 'patent_potential_nsk') + more('Подробнее', legalLine(cfg, 'patent_nodata'));
    else if (g.lost) body = '<p class="tiny">Выручка выше верхней границы: право на УСН утрачено — режим недоступен.</p>';
    else {
      const extra = g.taxAfterContrib != null ? `<div class="kv"><span>после вычета взносов (оценка)</span><b>${rub(g.taxAfterContrib)}</b></div>` : '';
      const src = { usn6: 'usn_income_rate', usn15: 'usn_income_minus_costs_rate', usnSocial: `usn_nso_social_income.${yr}`, patent: 'patent_tax_rate' }[g.id];
      const note = {
        usn6: `Вычет взносов — до ${g.dedPct != null ? ruNum(g.dedPct) + '%' : 'нет данных'} налога; сумма вычета ${rub(g.deduction)}`,
        usn15: `Расходы ${input.costShare}% должны подтверждаться документами; минимальный налог ${ruNum(g.minTax)}% дохода`,
        usnSocial: legalLine(cfg, 'social_note', { rate: g.rate, rateDR: g.rateDR }),
        patent: legalLine(cfg, 'patent_note')
      }[g.id];
      body = `<div class="big-num sm">${rub(g.tax)}</div><div class="kv"><span>ставка</span><b>${g.rate != null ? ruNum(g.rate, 2) + '%' : '—'}</b></div>${extra}${more('Условия', note)}${src ? rateTag(cfg, src) : ''}`;
    }
    return `<div class="cmpcol ${best && g.id === best.id ? 'best' : ''}"><h4>${g.name}</h4>${body}</div>`;
  }).join('');
  // блок взносов ИП
  const ip = r.ip;
  const cap = cfg.byYear[yr].extraCap;
  const contrib = `<div class="ledger">
    ${kv(`Фиксированные взносы (${yr})`, ip.fixedNoData ? 'нет данных' : `${rub(ip.fixed)} ${rateTag(cfg, `ip_fixed_contributions.${yr}`)}`)}
    ${kv(`${ruNum(cfg.contrib1pctRate)}% сверх ${rub(cfg.contrib1pctThreshold)}`, `${rub(ip.extra)} ${rateTag(cfg, 'contributions_1pct_rate')}`)}
    ${kv('Потолок 1%-взноса', cap == null ? 'нет данных' : `${rub(cap)} ${rateTag(cfg, `ip_extra_contrib_cap.${yr}`)}`)}
    ${kv('Взносы ИП итого', rub(ip.total))}
    ${kv('Взносы с гонораров (модель)', rub(r.gphContribs))}
  </div>${ip.fixedNoData ? nodata(`Фиксированные взносы ИП на ${yr} год не внесены.`, `ip_fixed_contributions.${yr}`) : ''}`;
  return top + plates +
    (T != null ? gauge({ value: r.revenue, limit: T, label: `Выручка к порогу НДС (${yr})`, aria: `Выручка ${rub(r.revenue)} при пороге ${rub(T)}` }) : '') +
    barsChart({ rows: r.regimes.filter(g => g.tax != null).map(g => ({ label: g.name, a: g.tax })), aria: 'Налог за год по режимам', fmtV: rub }) +
    '<h4 class="subh">Переход через порог НДС</h4>' + cross + tbl +
    '<h4 class="subh">Режимы при вашей выручке</h4>' + `<div class="cmpgrid">${cards}</div>` +
    '<h4 class="subh">Взносы ИП за себя</h4>' + contrib +
    (r.warning ? tip(cfg, 'Порог НДС', r.warning, 'warn') : '') +
    (r.now.usnLost ? tip(cfg, 'Право на УСН утрачено', `Выручка выше ${rub(r.bandHigh)}: общие ставки НДС и налогообложение — вне модели, вычеты входного НДС не считаются.`, 'warn') : '') +
    (r.now.bandUnknown ? tip(cfg, 'Верхняя граница диапазона неизвестна', 'Для этого года не внесены границы 5%/7%-диапазонов — введите вручную в списке источников.', 'warn') : '') +
    tip(cfg, 'Совет помощника', best ? `Лучший режим по налогу — «${best.name}». Держите запас до порога НДС: переход съедает часть прибыли, а «точка перехода» показывает, сколько выручки нужно, чтобы её вернуть.` : 'Налог лучшего режима посчитать нельзя: введите недостающие значения вручную.') +
    tip(cfg, 'Требует консультации', 'Итог выбора режима подтверждайте с бухгалтером: льготы, вычеты взносов и региональные условия здесь учтены только приблизительно.');
};

R.payroll = (input, cfg, r) =>
  head('payroll', 'Стоимость команды в месяц', r.cheapest, `Самая дешёвая схема при заданных гонорарах · ${r.year} год; сравнение колонок ниже.`) +
  minis([['Гонораров всего', rub(r.gross)], ['ГПХ (наём)', rub(r.gph.cost)], ['Штат', rub(r.staff.cost)]]) +
  barsChart({ rows: [r.gph, r.npd, r.staff].map(s => ({ label: s.name, a: s.cost })), aria: 'Стоимость команды в месяц по схемам', fmtV: rub }) +
  `<div class="cmpgrid">${[r.gph, r.npd, r.staff].map(s => `
    <div class="cmpcol ${s.cost === r.cheapest ? 'best' : ''}">
      <h4>${s.name}</h4>
      <div class="big-num sm">${rub(s.cost)}</div>
      ${more('Условия', s.note)}
      ${s.id === 'npd' ? rateTag(cfg, 'npd_rate_companies') : rateTag(cfg, 'gph_contributions_rate')}
    </div>`).join('')}</div>` +
  (r.npdOver ? tip(cfg, 'Лимит самозанятого превышен', `Один исполнитель получит ${rub(r.yearPerPerson)} в год — больше лимита НПД ${rub(r.npdLimit)}. Право на НПД утрачивается: распределите работу или выберите другую схему.`, 'warn') : '') +
  (r.gphBaseNoData ? tip(cfg, 'Предельная база не внесена', `На ${r.year} год предельная база взносов неизвестна: считается модельная ставка без сниженного тарифа.`, 'warn') : '') +
  tip(cfg, 'Риск переквалификации', r.risk, r.regular ? 'warn' : '') +
  tip(cfg, 'Совет помощника', 'Для регулярной команды сравнивайте не только цену схемы, но и риск доначисления: самая дешёвая колонка не всегда самая безопасная.') +
  tip(cfg, 'НДФЛ — за рамками модели', 'Подоходный налог и точные перечни ставок не считаются без проверенного источника — консультация со специалистом.');

R.pricing = (input, cfg, r) => {
  const pc = cfg.calc.pricing;
  const hm = r.auds.map((a, i) => `<div class="hm-lab">${a}</div>` + r.prices.map((p, j) => {
    const v = r.grid[i][j];
    const alpha = Math.min(1, Math.abs(v) / r.maxAbs);
    const text = thousands(v);                                    // малые отрицательные → «0к», без «−0к»
    const neg = v < 0 && text !== thousands(0);
    return `<div class="hm-cell ${neg ? 'hm-neg' : 'hm-pos'}${alpha > pc.heat_light_text_alpha ? ' hm-hi' : ''}" style="--a:${alpha.toFixed(3)}">${text}</div>`;
  }).join('')).join('');
  return head('pricing', 'Цена из маржи', r.priceFromMargin, `Билет, дающий маржу ${input.margin}% при ${input.audience} зрителях`, 'недостижима') +
    (r.priceFromMargin ? '' : tip(cfg, 'Маржа недостижима', 'Прямые расходы съедают всё при такой аудитории — увеличивайте группу или число показов в день.', 'warn')) +
    minis([['Прямые расходы показа', rub(r.direct)], ['Доля площадки и УСН', pct(r.varPercent * 100)], ['Цена безубыточности', r.priceBreakEven != null ? rub(r.priceBreakEven) : 'нет данных']]) +
    (r.actualMargin != null ? `<p class="tiny">Проверка по калькулятору выезда: при этой цене маржа ${pct(r.actualMargin)}, прибыль показа ${signed(r.profitAtPrice)}.</p>` : '') +
    `<p class="tiny">Тепловая карта: прибыль показа, ₽ (цена × аудитория). Плотнее заливка — больше по модулю; знак «−» — убыток.</p>
    <div class="heatmap" style="grid-template-columns:44px repeat(${r.prices.length},1fr)" role="img" aria-label="Тепловая карта прибыли показа по цене и аудитории">
      <div class="hm-lab"></div>${r.prices.map(p => `<div class="hm-lab">${p}</div>`).join('')}${hm}
    </div>` +
    tip(cfg, 'Совет помощника', r.priceFromMargin && r.priceFromMargin <= cfg.ticket.max ? `Расчётная цена не выше ${rub(cfg.ticket.max)} — гипотеза проекта по билету (${rub(cfg.ticket.min)}–${rub(cfg.ticket.max)}) подтверждается моделью.` : `Расчётная цена выше гипотезы проекта (${rub(cfg.ticket.min)}–${rub(cfg.ticket.max)}): проверьте рост аудитории или второго показа в день, прежде чем поднимать цену.`) +
    `<p class="hint">Округление цены вверх до ${rub(pc.price_round_step)}.</p>`;
};

R.parties = (input, cfg, r) => {
  const b = (r.bench || [])[0];
  const bench = b ? `${b.name}${b.address ? ` (${b.address.split(';')[0]})` : ''}: ${b.perHour != null ? rub(b.perHour) + '/час' : 'цена часа — нет данных'}${b.packageMin != null ? `, пакеты ${rub(b.packageMin)}–${rub(b.packageMax)}` : ''}. Не конкурировать числом игровых зон — продавать спектакль с участием именинника.` : 'Ориентиров рынка в data/competitors.json нет — нет данных.';
  const checks = cfg.stages.map(s => s.party_check);
  return head('parties', 'Прибыль праздника', r.profit, 'Один «День рождения в театре» после переменных, ФОТ и налога.') +
    minis([['Выручка пакета', rub(r.revenue)], ['Маржа', pct(r.margin)], ['За месяц (' + input.perMonth + ')', signed(r.perMonth)]]) +
    minis([
      ['Выручка на гостя', rub(input.guests > 0 ? r.revenue / input.guests : 0)],
      ['Прибыль на гостя', signed(input.guests > 0 ? r.profit / input.guests : 0)],
      ['Час пакета', rub(input.hours > 0 ? r.revenue / input.hours : 0)]
    ]) +
    costBar([
      ['Переменные праздника', r.variables, 'c1'],
      ['ФОТ (модель выходного)', r.fee, 'c2'],
      ['Налоги', r.tax, 'c3'],
      ['Остаток Юлии', Math.max(0, r.profit), 'c4']
    ]) +
    `<div class="ledger">${kv('Себестоимость', rub(r.cost))}${kv('Выручка за месяц', rub(r.revenueMonth))}${kv(`УСН ${ruNum(cfg.usn)}%`, rateTag(cfg, 'usn_income_rate'))}</div>` +
    tip(cfg, 'Совет помощника', bench) +
    tip(cfg, 'Предположение модели', `Чек ${rub(Math.min(...checks))}–${rub(Math.max(...checks))} и переменные ${rub(cfg.base_costs.party_variables)} — допущения проекта. Требуют подтверждения; правятся в «Допущениях проекта».`);
};

R.cashflow = (input, cfg, r) => {
  const pts = r.rows.map((x, i) => ({ x: i, y: x.net }));
  const labels = r.rows.map((x, i) => ({ x: i, text: x.short || x.m.slice(0, 3), a: i === 0 ? 'start' : (i === r.rows.length - 1 ? 'end' : 'middle') }));
  const projected = r.rows.filter(x => x.projected).map(x => x.short || x.m);
  const minIdx = r.rows.findIndex(x => x.m === r.min.m);
  return head('cashflow', 'Минимальный остаток', r.min.net, `${r.min.m} — дно баланса при начальном финансировании ${rub(input.startCapital)}`) +
    minis([['Месяцев в минусе', String(r.gaps.length)], ['Годовая прибыль', signed(r.yearOp)], ['Вложений всего', rub(r.capTotal)]]) +
    lineChart({ points: pts, marks: minIdx >= 0 ? [{ x: minIdx, label: 'дно' }] : [], xLabels: labels.filter((_, i) => i % 2 === 0 || i === labels.length - 1), aria: `Остаток денег по месяцам; минимум ${rub(r.min.net)} в месяце ${r.min.m}` }) +
    (r.gaps.length ? tip(cfg, 'Кассовые разрывы', `Отрицательный остаток: ${r.gaps.join(', ')}. Платёжный календарь — до подписания аренды.`, 'warn') : tip(cfg, 'Разрывов нет', 'При заданных правках баланс не уходит в минус.')) +
    tip(cfg, 'Совет помощника', r.gaps.length ? 'Сдвиньте второй платёж по помещению или увеличьте резерв на месяцы дна: график показывает, где деньги кончаются раньше всего.' : 'Резерв достаточен при этих правках; проверьте, что будет при просадке выездов в сезон низкого спроса.') +
    `<details open><summary>Помесячная таблица</summary>${table(['Месяц', 'Показы', 'Выезды', 'База', 'Фикс', 'Вложения', 'Прибыль', 'Баланс'], r.rows.map(x => [x.m + (x.projected ? ' *' : ''), x.shows, ...[x.tour, x.base, x.fixed, x.cap, x.op, x.net].map(rub)]))}</details>` +
    `<p class="hint">${projected.length ? `* ${projected.join(', ')} — проекция (confidence: low). ` : ''}Базовые месяцы — модель проекта. Без финансирования дно: ${rub(r.minNoFinancing)}.</p>`;
};

R.grants = (input, cfg, r) =>
  head('grants', 'Грантов до запуска', r.usable.length, `Конкурсы, чьи итоги подводятся до ${new Date(r.launchDate).toLocaleDateString('ru-RU')} · сегодня ${new Date(r.today).toLocaleDateString('ru-RU')}`) +
  minis([['Открыто сейчас', String(r.openNow)], ['Конкурсов в списке', String(r.programs.length)], ['Запуск', r.launchLabel]]) +
  `<div class="items one">${r.programs.map(p => `
    <details class="item"><summary>${p.name}<span class="plus">+</span></summary>
      <p><b>Окно:</b> ${p.window}<br><b>Итоги:</b> ${p.results ? p.results.toLocaleDateString('ru-RU') : '—'}<br><b>Размер:</b> ${p.amount}<br><b>Статус:</b> ${p.verdict}${p.url ? `<br><a href="${p.url}" target="_blank" rel="noopener">Источник ↗</a>` : ''}</p>
    </details>`).join('')}</div>` +
  tip(cfg, 'Совет помощника', r.conclusion) +
  (r.warning ? tip(cfg, 'Не закладывать в аренду', r.warning, 'warn') : '');

export function renderResult(mod, input, cfg, result, extra) {
  const fn = R[mod.meta.id] || (() => '<p class="hint">Рендер не определён</p>');
  return fn(input, cfg, result, extra);
}
