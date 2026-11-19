/* calc-ui.js — универсальный рендер калькуляторов: поля ввода, результат, сценарии.
   Читает спецификации модулей; результат собирает из calc() через render() модуля. */
import { $, $$, fmt, rub, signed, pct, ic, icons, kv, minis, resultHead, costBar, advice, goalbar, toast, store, table } from './helpers.js';

export function fieldHTML(f) {
  if (f.type === 'range') {
    // Ползунок + связанное поле ручного ввода числа (двусторонняя синхронизация в calc-panel)
    return `<div class="field ${f.wide ? 'wide' : ''}">
      <label for="${f.id}">${f.label}${f.suffix ? ` <span class="fsuf">(${f.suffix})</span>` : ''}</label>
      <div class="frow">
        <input data-suffix="${f.suffix || ''}" id="${f.id}" type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${f.def}" aria-label="${f.label}">
        <input class="fnum" id="${f.id}Num" type="number" inputmode="numeric" min="${f.min}" max="${f.max}" step="${f.step}" value="${f.def}" aria-label="${f.label}, точное значение">
      </div>
      <output class="fv" for="${f.id}" id="${f.id}Val" aria-hidden="true"></output>
    </div>`;
  }
  return `<div class="field ${f.wide ? 'wide' : ''}"><label for="${f.id}">${f.label}</label><select id="${f.id}">${f.options.map(o => { const [val, s] = Array.isArray(o) ? o : [o, o]; return `<option value="${val}" ${String(val) === String(f.def ?? f.options[0][0]) ? 'selected' : ''}>${s}</option>`; }).join('')}</select></div>`;
}

export function readInputs(fields) {
  const out = {};
  fields.forEach(f => {
    const el = $(f.id);
    out[f.id] = el ? (f.type === 'range' ? Number(el.value) : (isNaN(Number(el.value)) || el.value === '' ? el.value : Number(el.value))) : f.def;
  });
  return out;
}

export function rangeValues(fields) {
  fields.filter(f => f.type === 'range').forEach(f => {
    const e = $(f.id); if (!e) return;
    const v = fmt(+e.value) + ' ' + (e.dataset.suffix || '');
    const o = $(f.id + 'Val');
    if (o) { o.textContent = v.trim(); e.setAttribute('aria-valuetext', v.trim()); }
    const num = $(f.id + 'Num');
    if (num && document.activeElement !== num && Number(num.value) !== Number(e.value)) num.value = e.value;
  });
}

/* Синхронизация ползунок ↔ число: clamp + пересчёт; вызывается из делегирования calc-panel */
export function bindNumberSync(container, onChange) {
  container.addEventListener('input', e => {
    const t = e.target;
    if (t.classList && t.classList.contains('fnum')) {
      const range = $(t.id.slice(0, -3)); // «kidsNum» → «kids»
      if (!range) return;
      const v = t.value === '' ? Number(range.min) : Math.min(Number(range.max), Math.max(Number(range.min), Number(t.value)));
      range.value = v;
      onChange();
    } else if (t.type === 'range') {
      const num = $(t.id + 'Num');
      if (num && document.activeElement !== num) num.value = t.value;
    }
  });
}

/* ==== Рендеры результатов по калькуляторам ==== */
import { calc as travelCalc } from '../calculators/travel.js';

const R = {};

R.travel = (input, cfg, r) =>
  resultHead('Чистая прибыль', r.per, 'С одного показа после перечисленных расходов, до постоянных затрат.') +
  minis([['Выручка дня', rub(r.gross)], ['Прибыль дня', signed(r.profit)], ['Маржа', pct(r.margin)]]) +
  costBar([
    ['ФОТ и взносы', r.salary + r.social, 'c1'],
    ['Транспорт и реквизит', r.fuel + r.wear + r.print, 'c2'],
    ['Налоги', r.fee + r.tax, 'c3'],
    ['Остаток Юлии', Math.max(0, r.profit), 'c4']
  ]) +
  `<div class="ledger">
    ${kv('Гонорар команды', rub(r.salary))}
    ${kv('Взносы (модель)', rub(r.social))}
    ${kv(`Доля площадки (${(r.rate * 100).toFixed(0)}%)`, rub(r.fee))}
    ${kv(`УСН ${r.usn}%`, rub(r.tax))}
    ${kv('Расходы ' + (r.k === 1 ? 'показа' : 'дня'), rub(r.cost))}
  </div>` +
  advice('Совет помощника',
    r.profit < 0 ? `Не подтверждайте выезд на этих условиях. До нуля не хватает ${fmt(Math.max(0, r.be - input.kids * r.k))} оплаченных мест за день. Объедините группы или согласуйте минимум кассы.`
      : r.margin < 25 ? 'Показ покрывает прямые расходы, но запас небольшой. Второй показ по тому же адресу снизит долю транспорта.'
        : 'Условия дают запас. Зафиксируйте число детей и второй слот письменно до бронирования команды.',
    r.profit < 0 ? 'warn' : '') +
  `<p class="hint" style="margin-top:10px">Безубыточность: ${r.be} зрителей за день, в среднем не меньше ${Math.max(1, Math.ceil(r.be / Math.max(1, r.k)))} на показ при одинаковых группах.</p>`;

R.basecamp = (input, cfg, r) =>
  resultHead('Чистая прибыль', r.x.profit, 'Расчётная чистая операционная прибыль бизнеса за месяц, не остаток на счёте.') +
  minis([
    ['База отдельно', signed(r.x.baseProfit)],
    ['Выезды', signed(r.x.tourProfit)],
    ['Окупаемость¹', r.x.profit > 0 ? fmt(Math.ceil(cfg.phases_budget.total / r.x.profit)) + ' мес.' : 'Не достигается']
  ]) +
  costBar([
    ['ФОТ и взносы', r.b.teachers + r.b.week + r.b.party, 'c1'],
    ['База: аренда и фикс', r.b.fixed, 'c2'],
    ['Налоги', r.b.tax + r.x.vat, 'c3'],
    ['Остаток Юлии', Math.max(0, r.x.profit), 'c4']
  ]) +
  `<div class="ledger">
    ${kv('Выручка базы', rub(r.b.gross))}
    ${kv('Аренда, КУ, администрация и реклама', rub(r.b.fixed))}
    ${kv('Выручка всего за месяц', rub(r.x.g))}
    ${kv('Годовой темп (месяц × 12)', rub(r.x.annual))}
    ${kv('НДС в цене / штаб', rub(r.x.vat) + ' / ' + rub(r.x.hq))}
  </div>` +
  (r.x.reg ? advice('Порог 20 млн ₽ превышен по годовому темпу', 'В сценарии цены уже включают НДС 5% (5/105); для УСН НДС исключён из дохода. Добавлен штаб 150 000 ₽/мес. Фактический переход зависит от дохода календарного года, не от экстраполяции.', 'warn') : '') +
  (r.x.served < input.trips ? advice('Не хватает мощности трупп', `Запрошено ${input.trips}, в результат вошло ${r.x.served} показов. Добавьте труппу или измените график.`, 'warn') : '') +
  `<div class="goals">${goalbar(`Цель 120–130 тыс. ₽ · ориентир 125 тыс.`, r.x.profit, cfg.goals.short_target)}${goalbar(`Цель 1,2–1,3 млн ₽ · ориентир 1,25 млн`, r.x.profit, cfg.goals.long_target)}</div>` +
  `<p class="hint" style="margin-top:12px">¹ При неизменной прибыли: ${fmt(cfg.phases_budget.total)} ₽ ÷ прибыль, с округлением вверх. Не учитывает разгон и дополнительные мобильные комплекты.</p>`;

R.goal = (input, cfg, r) =>
  `<div><div class="res-label">План на один месяц</div><h3 style="margin-top:8px">${r.plan ? 'Как получить ' + rub(r.goal) : 'Цель выше мощности этой стадии'}</h3></div>` +
  `<div class="planresult">${[[r.x.n, 'выездных показов'], [r.students, 'учеников студии'], [r.x.t, 'гастрольных трупп']].map(([n, l]) => `<div><b>${n}</b><small>${l}</small></div>`).join('')}</div>` +
  `<div class="ledger">
    ${kv('Плановая прибыль', signed(r.x.profit))}
    ${kv('В том числе база / фикс без базы', signed(r.x.baseProfit))}
    ${kv('Зрителей на выездах', fmt(r.x.n * r.x.aud))}
    ${kv('Выручка месяца', rub(r.x.g))}
  </div>` +
  advice(r.plan ? 'Что бронировать' : 'Что изменить',
    r.plan ? `${r.model ? `${r.model.weekend_shows} показов выходного дня и ${r.model.parties} праздников. ` : 'Работа без своей площадки. '}${r.x.n ? `Нужно ${fmt(r.x.n * r.x.aud)} оплаченных посещений в месяц. Сначала закрепите кластеры с повторными показами.` : 'Выезды для этой цели не обязательны: её покрывает база.'}` : `До цели не хватает ${rub(r.goal - r.x.profit)}. Сейчас доступно не более ${r.max} показов; выберите более зрелую стадию или снизьте цель.`,
    r.plan ? '' : 'warn') +
  `<p class="hint" style="margin-top:10px">До февраля: одна труппа до ${cfg.tour_unit.capacity_per_troupe} показов. После открытия: до четырёх трупп и 200 показов в планировщике. Результат может отличаться от ориентира 177 показов в плане: НДС рассчитан и с выручки базы.</p>`;

R.taxes = (input, cfg, r) =>
  resultHead('Налог года (лучшая схема)', r.best ? -r.best.tax : 0, r.best ? `«${r.best.name}» при выручке ${rub(r.revenue)} и расходах ${input.costShare}%` : 'Недостаточно данных') +
  minis([['Расходы за год', rub(r.costs)], ['НДС (если сверх порога)', rub(r.vat)], ['1% взносов сверх порога', rub(r.onePct)]]) +
  `<div class="cmpgrid">${r.regimes.map(g => `
    <div class="cmpcol ${r.best && g.id === r.best.id ? 'best' : ''}">
      <h4>${g.name}</h4>
      ${g.noData || g.tax == null ? `<div class="nodata"><span>Нет проверенных данных по ставке.</span>${g.note ? `<p class="tiny" style="margin:0">${g.note}</p>` : ''}<button class="btn small secondary" data-fill="${g.id}">Ввести вручную</button></div>`
      : `<div class="big-num" style="font-size:26px">${rub(g.tax)}</div>
         <div class="kv"><span>ставка</span><b>${g.rate != null ? g.rate + '%' : '—'}</b></div>
         <p class="tiny">${g.note}</p>`}
    </div>`).join('')}</div>` +
  (r.ipFixedNoData ? advice('Фиксированные взносы ИП — нет данных', 'Значение не внесено в rates.json. Введите вручную после проверки на nalog.gov.ru — расчёты продолжают работать без него.', 'warn') : '') +
  (r.warning ? advice('Порог НДС', r.warning, 'warn') : '') +
  advice('Требует консультации', 'Итог выбора режима подтверждайте с бухгалтером: льготы, вычеты взносов и региональные условия здесь не учтены.');

R.payroll = (input, cfg, r) =>
  resultHead('Стоимость команды в месяц', -r.cheapest, 'Самая дешёвая схема при заданных гонорарах; сравнение колонок ниже.') +
  minis([['Гонораров всего', rub(r.gross)], ['ГПХ (наём)', rub(r.gph.cost)], ['Штат', rub(r.staff.cost)]]) +
  `<div class="cmpgrid">${[r.gph, r.npd, r.staff].map(s => `
    <div class="cmpcol ${s.cost === r.cheapest ? 'best' : ''}">
      <h4>${s.name}</h4>
      <div class="big-num" style="font-size:26px">${rub(s.cost)}</div>
      <p class="tiny">${s.note}</p>
    </div>`).join('')}</div>` +
  advice('Риск переквалификации', r.risk, r.regular ? 'warn' : '') +
  advice('НДФЛ — за рамками модели', 'Подоходный налог и точные перечни ставок не считаются без проверенного источника — консультация со специалистом.');

R.pricing = (input, cfg, r) =>
  resultHead('Цена из маржи', r.priceFromMargin || 0, `Билет, дающий маржу ${input.margin}% при ${input.audience} зрителях`) +
  (r.priceFromMargin ? `<div class="big-num">${rub(r.priceFromMargin)}</div>` : advice('Маржа недостижима', 'Прямые расходы съедают всё при такой аудитории — увеличивайте группу или число показов в день.', 'warn')) +
  minis([['Прямые расходы показа', rub(r.direct)], ['Переменная доля цены', pct(r.varPercent * 100)], ['Порог цены (ноль)', rub(Math.ceil(r.direct / Math.max(1, input.audience * (1 - r.varPercent)) / 10) * 10)]]) +
  `<p class="tiny" style="margin-top:8px">Тепловая карта: прибыль показа, ₽ (цена × аудитория). Темнее — больше.</p>
  <div class="heatmap" style="grid-template-columns:44px repeat(${r.prices.length},1fr)" role="img" aria-label="Тепловая карта прибыли показа по цене и аудитории">
    <div class="hm-lab"></div>${r.prices.map(p => `<div class="hm-lab">${p}</div>`).join('')}
    ${r.auds.map((a, i) => `<div class="hm-lab">${a}</div>` + r.prices.map((p, j) => {
      const v = r.grid[i][j];
      const alpha = Math.min(1, Math.abs(v) / r.maxAbs);
      return `<div class="hm-cell" style="background:${v < 0 ? 'rgba(142,142,147,' + (0.15 + alpha * 0.5) + ')' : 'rgba(28,28,30,' + (0.06 + alpha * 0.85) + ')'};color:${alpha > .55 ? '#F5F5F7' : 'inherit'}">${v < 0 ? '−' + fmt(-v / 1000) + 'к' : fmt(v / 1000) + 'к'}</div>`;
    }).join('')).join('')}
  </div>` +
  advice('Совет помощника', r.priceFromMargin && r.priceFromMargin <= 350 ? 'Расчётная цена в диапазоне 300–350 ₽ — рабочая гипотеза проекта подтверждается моделью.' : 'Расчётная цена выше привычных 300–350 ₽: проверьте рост аудитории или второго показа в день, прежде чем поднимать цену.');

R.parties = (input, cfg, r) =>
  resultHead('Прибыль праздника', r.profit, 'Один «День рождения в театре» после переменных, ФОТ и налога.') +
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
  `<div class="ledger">${kv('Себестоимость', rub(r.cost))}${kv('Выручка за месяц', rub(r.revenueMonth))}</div>` +
  advice('Ориентир рынка', 'PlayPanda (Б. Хмельницкого, 2): 5 000 ₽/час, пакеты 21 000–26 000 ₽. Не конкурировать числом игровых зон — продавать спектакль с участием именинника.') +
  advice('Предположение модели', 'Чек 9–11 тыс. ₽ и переменные 2 953 ₽ — из исходных предположений проекта, требуют подтверждения.');

R.cashflow = (input, cfg, r) =>
  resultHead('Минимальный остаток', r.min.net, `${r.min.m} — дно баланса при начальном финансировании ${rub(input.startCapital)}`) +
  minas_(r) +
  (r.gaps.length ? advice('Кассовые разрывы', `Отрицательный остаток: ${r.gaps.join(', ')}. Платёжный календарь — до подписания аренды.`, 'warn') : advice('Разрывов нет', 'При заданных правках баланс не уходит в минус.')) +
  `<details open><summary>Помесячная таблица</summary>${table(['Месяц', 'Показы', 'Выезды', 'База', 'Фикс', 'Вложения', 'Прибыль', 'Баланс'], r.rows.map(x => [x.m + (x.projected ? ' *' : ''), x.shows, ...[x.tour, x.base, x.fixed, x.cap, x.op, x.net].map(rub)]))}</details>` +
  `<p class="hint" style="margin-top:8px">* Сен–Ноя — проекция (confidence: low). Базовые 9 месяцев — модель проекта. Без финансирования дно: ${rub(r.minNoFinancing)}.</p>`;
function minas_(r) {
  return minis([['Месяцев в минусе', String(r.gaps.length)], ['Годовая прибыль', signed(r.rows.reduce((a, x) => a + x.op, 0))], ['Вложений всего', rub(r.rows.reduce((a, x) => a + x.cap, 0))]]);
}

R.grants = (input, cfg, r) =>
  resultHead('Грантов до запуска', r.usable.length, `Конкурсы, чьи итоги подводятся до ${new Date(r.launchDate).toLocaleDateString('ru-RU')}`) +
  `<div class="items" style="grid-template-columns:1fr">${r.programs.map(p => `
    <details class="item"><summary>${p.name}<span class="plus">+</span></summary>
      <p><b>Окно:</b> ${p.window}<br><b>Итоги:</b> ${p.results ? p.results.toLocaleDateString('ru-RU') : '—'}<br><b>Размер:</b> ${p.amount}<br><b>Статус:</b> ${p.verdict}${p.url ? `<br><a href="${p.url}" target="_blank" rel="noopener">Источник ↗</a>` : ''}</p>
    </details>`).join('')}</div>` +
  advice('Вывод', r.conclusion) +
  advice('Не закладывать в аренду', r.warning, 'warn');

export function renderResult(mod, input, cfg, result, extra) {
  const fn = R[mod.meta.id] || (() => '<p class="hint">Рендер не определён</p>');
  return fn(input, cfg, result, extra);
}
