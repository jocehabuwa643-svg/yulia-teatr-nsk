/* tests/estimate-export.test.mjs — «Смета в 1 клик»: текст для мессенджера и лист А4 строятся из реального результата
   калькулятора, без выдуманных строк; отсутствующие поля не выводятся. Ожидаемые числа выведены вручную в комментариях. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildCalcConfig } from '../js/calculators/config.js';
import { registry, travel } from '../js/calculators/index.js';
import { runCalc, runDefaults } from '../js/calculators/run.js';
import { buildCalcEstimate, buildOverviewEstimate, estimateText, estimateHTML, ruDate, valueText } from '../js/estimate-export.js';

const url = p => new URL(p, import.meta.url);
const J = n => JSON.parse(readFileSync(url(`../data/${n}.json`), 'utf-8'));
const cfg = buildCalcConfig({ rates: J('rates'), config: J('config'), competitors: J('competitors') });
const market = J('market');
const ctx = { market, now: Date.UTC(2026, 10, 24) };
const DATE = new Date(2026, 10, 24, 12);
const NB = ' ';

const estOf = (mod, inputs) => buildCalcEstimate({ mod, fields: mod.controls(cfg), inputs, result: runCalc(mod, inputs, cfg, ctx), date: DATE });

test('дата сметы — дд.мм.гггг, битая дата → пустая строка', () => {
  assert.equal(ruDate(DATE), '24.11.2026');
  assert.equal(ruDate('не дата'), '');
});

test('выезд: выручка, расходы по статьям, налог, прибыль и безубыточность — из результата travel.calc', () => {
  const inputs = { kids: 45, ticket: 325, cluster: 1, venue: 0, route: 0, cast: 0 };
  const r = runCalc(travel, inputs, cfg, ctx);
  const est = estOf(travel, inputs);
  const text = estimateText(est);
  // заголовок: «Смета · <калькулятор> · дата»
  assert.equal(text.split('\n')[0], `Смета · ${travel.meta.title} · 24.11.2026`);
  // выручка показа: 45 × 325 × 1 = 14 625 ₽
  assert.equal(r.gross, 14625);
  assert.match(text, new RegExp(`Выручка показа: 14${NB}625${NB}₽`));
  // расходы без налога = cost − tax; налог и прибыль — те же числа, что в результате
  const byLabel = Object.fromEntries(est.rows.map(x => [x.label, x]));
  assert.equal(byLabel['Расходы показа без налога'].v, r.cost - r.tax);
  assert.ok(est.rows.some(x => x.kind === 'tax' && x.v === r.tax));
  assert.equal(byLabel['Чистая прибыль показа'].v, r.profit);
  assert.equal(byLabel['Точка безубыточности'].v, r.be);
  assert.match(text, /Точка безубыточности: \d+ чел. за день/);
  // статьи расходов в сумме дают итог расходов без налога
  const items = est.rows.filter(x => x.kind === 'item').reduce((s, x) => s + x.v, 0);
  assert.ok(Math.abs(items - (r.cost - r.tax)) < 1e-6);
  // параметры — подписи полей с выбранными значениями
  assert.ok(est.params.some(p => p.label === 'Дети на показ' && p.text.startsWith('45')));
  assert.match(text, /Ориентировочный расчёт/);
  // один показ: строки «прибыль одного показа» нет (она равна прибыли дня)
  assert.ok(!byLabel['Чистая прибыль одного показа']);
});

test('выезд: несколько показов в день — подписи «дня» и прибыль одного показа', () => {
  const est = estOf(travel, { kids: 45, ticket: 325, cluster: 2, venue: 0, route: 0, cast: 0 });
  const labels = est.rows.map(x => x.label);
  assert.ok(labels.includes('Выручка дня'));
  assert.ok(labels.includes('Чистая прибыль одного показа'));
});

test('выезд: нулевые статьи (взносы при игре основателей) в смету не попадают', () => {
  const est = estOf(travel, { kids: 45, ticket: 325, cluster: 1, venue: 0, route: 0, cast: 1 });
  assert.ok(!est.rows.some(x => x.label.startsWith('Взносы')));
});

test('каждый калькулятор даёт смету без NaN/undefined и только с реальными значениями', () => {
  for (const mod of registry) {
    const { inputs, result } = runDefaults(mod, cfg, ctx);
    const est = buildCalcEstimate({ mod, fields: mod.controls(cfg), inputs, result, date: DATE });
    const text = estimateText(est);
    assert.ok(est.rows.length > 0, `${mod.meta.id}: пустая смета`);
    assert.doesNotMatch(text, /NaN|undefined|null|Infinity|\[object/, `${mod.meta.id}: мусор в тексте`);
    assert.doesNotMatch(text, /нет данных/, `${mod.meta.id}: строка без значения попала в смету`);
    assert.equal(est.params.length, mod.controls(cfg).length, `${mod.meta.id}: параметры не все`);
  }
});

test('строка без значения в результате не выводится (поле отсутствует → строки нет)', () => {
  const mod = registry.find(m => m.meta.id === 'pricing');
  const est = buildCalcEstimate({ mod, fields: [], inputs: {}, result: { direct: 1000, priceFromMargin: null, priceBreakEven: null, profitAtPrice: null, actualMargin: null }, date: DATE });
  const labels = est.rows.map(x => x.label);
  assert.deepEqual(labels, ['Прямые расходы показа', 'Цена билета из маржи']);
  assert.equal(valueText(est.rows[1]), 'недостижима при этой марже');
});

test('неизвестный калькулятор или пустой результат — смета без строк, текст всё равно собирается', () => {
  const est = buildCalcEstimate({ mod: { meta: { id: 'нет', title: 'Тест' } }, fields: [], inputs: {}, result: {}, date: DATE });
  assert.deepEqual(est.rows, []);
  assert.match(estimateText(est), /^Смета · Тест · 24\.11\.2026/);
  assert.match(estimateHTML(est), /Нет данных для сметы/);
});

test('лист А4: заголовок «Смета — калькулятор — дата», параметры, итоговая таблица, подпись; HTML экранирован', () => {
  const est = { title: 'Тест <b>', date: '24.11.2026', params: [{ label: 'Поле & "x"', text: '1' }], rows: [{ kind: 'profit', label: 'Прибыль', v: 1500, t: 'rub', unit: '' }], note: 'Ориентировочный расчёт.' };
  const html = estimateHTML(est);
  assert.match(html, /<h1>Смета — Тест &lt;b&gt; — 24\.11\.2026<\/h1>/);
  assert.match(html, /Поле &amp; &quot;x&quot;/);
  assert.match(html, /class="est-total"/);
  assert.match(html, /<tr class="est-profit"><th scope="row">Прибыль<\/th><td>1 500 ₽<\/td><\/tr>/);
  assert.match(html, /class="est-note">Ориентировочный расчёт\./);
});

test('обзор: суммы периода, баланс на конец, дно, операционный ноль и окупаемость — из строк денежного потока', () => {
  const rows = [
    { m: 'Декабрь', tour: 100, base: 0, fixed: 50, cap: 200, op: 50, net: -150, projected: false },
    { m: 'Январь', tour: 120, base: 30, fixed: 50, cap: 0, op: 100, net: -50, projected: false },
    { m: 'Сентябрь', tour: 200, base: 60, fixed: 60, cap: 0, op: 200, net: 150, projected: true }
  ];
  const est = buildOverviewEstimate({ rows, budget: { total: 1185000, phase1: 600000 }, zeroShows: 8, payIdx: 2, date: DATE });
  const by = Object.fromEntries(est.rows.map(x => [x.label, x.v]));
  assert.equal(by['Вклад выездов'], 420);          // 100 + 120 + 200
  assert.equal(by['Вклад базы'], 90);              // 0 + 30 + 60
  assert.equal(by['Постоянные расходы'], 160);     // 50 + 50 + 60
  assert.equal(by['Вложения'], 200);
  assert.equal(by['Операционная прибыль за период'], 350);
  assert.equal(by['Баланс на конец (Сентябрь)'], 150);
  assert.equal(by['Наименьший баланс (Декабрь)'], -150);
  assert.equal(by['Операционный ноль'], 8);
  assert.equal(by['Окупаемость'], '3-й месяц (Сентябрь)');
  assert.ok(est.params.some(p => p.label === 'Период' && p.text === 'Декабрь – Сентябрь (3 мес.)'));
  assert.match(est.note, /Сентябрь — проекция модели/);
  const text = estimateText(est);
  assert.match(text, /^Смета · Обзор: деньги первого года · 24\.11\.2026/);
  assert.match(text, new RegExp(`Наименьший баланс \\(Декабрь\\): −150${NB}₽`));
});

test('обзор: без окупаемости и без операционного нуля — честные подписи, лишних строк нет', () => {
  const rows = [{ m: 'Декабрь', tour: 1, base: 0, fixed: 5, cap: 0, op: -4, net: -4, projected: false }];
  const est = buildOverviewEstimate({ rows, budget: {}, zeroShows: null, payIdx: -1, date: DATE });
  const by = Object.fromEntries(est.rows.map(x => [x.label, x.v]));
  assert.equal(by['Окупаемость'], 'за 1 мес. не наступает');
  assert.ok(!('Операционный ноль' in by));
  assert.ok(!est.params.some(p => p.label.startsWith('Бюджет')));
});

test('обзор на реальных данных config.json: сумма вкладов и баланс сходятся со строками денежного потока', () => {
  const U = x => (x && typeof x === 'object' && !Array.isArray(x) && 'value' in x ? x.value : x);
  let cum = 0;
  const rows = U(J('config').cashflow_12m).months.map(m => { const op = m.tour + m.base - m.fixed; return { ...m, op, net: cum += op - m.cap }; });
  const est = buildOverviewEstimate({ rows, budget: {}, date: DATE });
  const by = Object.fromEntries(est.rows.map(x => [x.label, x.v]));
  const last = rows[rows.length - 1];
  assert.equal(by[`Баланс на конец (${last.m})`], last.net);
  // баланс на конец = операционная прибыль периода − вложения (стартовый остаток 0)
  assert.equal(by['Операционная прибыль за период'] - by['Вложения'], last.net);
});

test('калькуляторы и обзор подключают смету; печать сметы описана в css/calc.css', () => {
  const panel = readFileSync(url('../js/calc-panel.js'), 'utf-8');
  assert.match(panel, /data-act="share"/);
  assert.match(panel, /data-act="pdf"/);
  assert.match(panel, /from '\.\/estimate-export\.js'/);
  const ov = readFileSync(url('../js/overview.js'), 'utf-8');
  assert.match(ov, /buildOverviewEstimate/);
  const css = readFileSync(url('../css/calc.css'), 'utf-8');
  assert.match(css, /@page est\{size:A4;margin:14mm\}/);
  assert.match(css, /body\.est-printing>\*:not\(#estSheet\)\{display:none!important\}/);
});

/* ==== Доработки после приёмки ==== */

test('налоги: остаток владельца в смете = r.ownerNet (с вычетом взносов), цепочка налог → −вычет → к уплате', () => {
  const mod = registry.find(m => m.meta.id === 'taxes');
  // гонорары 1,2 млн → штат (лимит 50%): 216 000 − 108 000 = 108 000 к уплате; остаток +1 417 846 ₽
  for (const [staff, owner, ded] of [['auto', 1417846, 108000], [0, 1404000, 94154]]) {
    const inputs = { year: 2027, revenue: 3.6e6, costShare: 55, employees: 1.2e6, social: 0, staff };
    const r = runCalc(mod, inputs, cfg, ctx);
    const est = estOf(mod, inputs);
    const byLabel = Object.fromEntries(est.rows.map(x => [x.label, x]));
    const ownerRow = est.rows.find(x => x.label.startsWith('Остаток владельца'));
    assert.equal(ownerRow.v, r.ownerNet);
    assert.ok(Math.abs(ownerRow.v - owner) < 1e-6);
    assert.ok(est.rows.some(x => x.v === r.usn6Tax && /до вычета/.test(x.label)));
    assert.ok(est.rows.some(x => x.v === -r.usn6Deduction && /вычет взносов/.test(x.label)));
    assert.ok(Math.abs(r.usn6Deduction - ded) < 1e-6);
    assert.ok(est.rows.some(x => x.v === r.usn6Pay && /к уплате/.test(x.label)));
    // лучший режим — по налогу к уплате, а не до вычета
    const best = byLabel['Лучший режим (налог к уплате)'];
    assert.ok(best && best.v.includes(valueText({ v: r.bestPay.pay, t: 'rub' })));
    assert.ok(!est.rows.some(x => x.v === r.now.netUsn6 && x.label.startsWith('Остаток')));
  }
});

test('выезд: при 0 детей маржа не выводится (выручки нет), «1 показ» согласован с числом', () => {
  const est = estOf(travel, { kids: 0, ticket: 325, cluster: 1, venue: 0, route: 0, cast: 0 });
  assert.ok(!est.rows.some(x => x.label === 'Маржа'));
  const text = estimateText(est);
  assert.doesNotMatch(text, /1\s+показов/);
});
