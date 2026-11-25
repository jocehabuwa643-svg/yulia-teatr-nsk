/* tests/audit-fixes-round2.test.mjs — доработки по второму кругу приёмки:
   печать сравнения сценариев, допущение про 1% в вычете УСН, источник лимита вычета, плашка «Маржа» без выручки,
   согласование «оплаченного места», импорт CRM (тост/ошибка, записи без объекта), «ёлочки» в названиях площадок. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildCalcConfig } from '../js/calculators/config.js';
import { registry } from '../js/calculators/index.js';
import { runCalc } from '../js/calculators/run.js';
import { buildCalcEstimate } from '../js/estimate-export.js';
import { countOrphans, importSummary, mergeImport, emptyDb } from '../js/crm.js';

const url = p => new URL(p, import.meta.url);
const src = p => readFileSync(url(p), 'utf-8');
const J = n => JSON.parse(src(`../data/${n}.json`));
const cfg = buildCalcConfig({ rates: J('rates'), config: J('config'), competitors: J('competitors') });
const ctx = { market: J('market'), now: Date.UTC(2026, 10, 24) };

test('кнопка «Печать / PDF» в сравнении сценариев снова печатает (обработчик data-act=print есть)', () => {
  const s = src('../js/calc-panel.js');
  assert.match(s, /data-act="print"/);
  assert.match(s, /act === 'print'\)\s*window\.print\(\)/);
});

test('налоги: в смете явно названо допущение «1% учтён в вычете того же года» и его сумма = ip.extra', () => {
  const mod = registry.find(m => m.meta.id === 'taxes');
  const inputs = { year: 2027, revenue: 3.6e6, costShare: 55, employees: 0, social: 0, staff: 0 };
  const r = runCalc(mod, inputs, cfg, ctx);
  // 1% сверх 300 000 ₽ от дохода УСН: (3 600 000 − 300 000) × 1% = 33 000 ₽ (НДС при 3,6 млн нет)
  assert.ok(Math.abs(r.ip.extra - 33000) < 1e-6);
  const est = buildCalcEstimate({ mod, fields: mod.controls(cfg), inputs, result: r, date: new Date(2026, 10, 24) });
  const row = est.rows.find(x => /^Допущение: 1%/.test(x.label));
  assert.ok(row, 'строка допущения есть');
  assert.equal(row.v, r.ip.extra);
  // в плашках калькулятора — та же оговорка
  assert.match(src('../js/ui/calc-ui.js'), /Допущение: 1% взносов/);
});

test('лимиты вычета взносов из УСН 6%: источник — действующая редакция п. 3.1 ст. 346.21 (КонсультантПлюс), надёжность высокая', () => {
  const rates = J('rates');
  const find = (o, k) => { if (o && typeof o === 'object') { if (k in o) return o[k]; for (const v of Object.values(o)) { const r = find(v, k); if (r) return r; } } return null; };
  for (const [k, v] of [['usn_deduction_no_staff_pct', 100], ['usn_deduction_with_staff_pct', 50]]) {
    const e = find(rates, k);
    assert.equal(e.value, v, k);
    assert.equal(e.confidence, 'high', k);
    assert.match(e.source_url, /^https:\/\/www\.consultant\.ru\/document\/cons_doc_LAW_28165\//, k);
    assert.doesNotMatch(e.note, /не подтвержд/i, k);
  }
});

test('выезд при 0 детей: плитка «Маржа» без выручки — прочерк, совет согласован («оплаченного места» для 1, 21, 31…)', () => {
  const s = src('../js/ui/calc-ui.js');
  assert.match(s, /\['Маржа', marginText\(r\.gross, r\.margin\)\]/);
  assert.match(s, /oneOr\([^)]*\), 'оплаченного места', 'оплаченных мест'\)/);
  // правило согласования — из Intl.PluralRules: 31 → one, 22 → few, 11 → many
  const P = new Intl.PluralRules('ru-RU');
  assert.deepEqual([31, 22, 11, 1].map(n => P.select(n)), ['one', 'few', 'many', 'one']);
});

test('CRM-импорт: записи без объекта в базе площадок считаются и называются в итоге', () => {
  const items = [
    { key: 'osm:1', rec: { s: 'sent', note: '', d: '', upd: 1 } },
    { key: 's:тест@55.0000,82.9000', rec: { s: 'talks', note: '', d: '', upd: 1 } }
  ];
  assert.equal(countOrphans(items, new Set(['osm:1'])), 1);
  assert.equal(countOrphans(items, ['osm:1', 's:тест@55.0000,82.9000']), 0);
  const r = mergeImport(emptyDb(), items);
  // без «сирот» текст прежний; с ними — понятная приписка
  assert.equal(importSummary(r), 'Добавлено 2, обновлено 0.');
  assert.match(importSummary(r, 0, 1), /^Добавлено 2, обновлено 0\. Не найдено в базе площадок: 1 \(сохранены, но не видны в списке/);
});

test('CRM-интерфейс: ошибка импорта прячет тост прошлого импорта; названия площадок — в «ёлочках»', () => {
  const s = src('../js/crm-ui.js');
  assert.match(s, /function hideToast\(\)/);
  assert.match(s, /if \(bad\) hideToast\(\);/);
  assert.match(s, /function rowTitle\(r\) \{ return r\.n \? ruQuotes\(r\.n\)/);
  assert.match(src('../js/client-map.js'), /o\.n \? ruQuotes\(o\.n\)/);
});
