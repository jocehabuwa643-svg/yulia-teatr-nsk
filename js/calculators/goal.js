/* goal.js — обратный планировщик цели: «хочу чистыми X ₽/мес».
   Решается прямым перебором целых показов на точной модели business() —
   это обратная задача на монотонной функции, а не подгонка. */
import { baseMonth, business } from './basecamp.js';
import { nonNeg, rangeField, yearField } from './util.js';

export const meta = {
  id: 'goal',
  sources: ['vat_threshold*', 'vat_rate_special_low'],
  icon: 'target',
  headline: 'result',            // тип главной цифры: result — со знаком, amount — сумма/цена без плюса, count — целое число
  title: 'Сколько нужно для моей цели',
  what: 'Считает: минимальное число показов, учеников и трупп под желаемую чистую прибыль',
  when: 'Когда: планируете целевой доход и решаете, чем его закрывать'
};

export const controls = cfg => [
  yearField(cfg, { wide: true }),
  rangeField(cfg, 'goal', 'goal', 'Желаемая чистая прибыль в месяц', { wide: true }),
  { type: 'select', id: 'stageSel', label: 'Стадия проекта', options: [[0, 'До февраля · без базы'], ...cfg.stages.map((s, i) => [i + 1, `${s.name} · ${cfg.calc.base_area_default} м²`])], wide: true }
];

/* Модель базы для стадии (0 — без базы → null) */
export function stageModel(i, cfg) {
  if (!i) return null;
  const s = cfg.stages[i - 1];
  if (!s) return null;
  return { ...s, area: cfg.calc.base_area_default, rent: cfg.base_costs.rent_per_m2, s: s.students, p: s.subscription, w: s.weekend_shows, a: s.weekend_audience, h: s.parties, c: s.party_check };
}

export function calc(input, cfg) {
  const goal = nonNeg(input.goal);
  const stageSel = Math.round(nonNeg(input.stageSel));
  const model = stageModel(stageSel, cfg);
  const b = model ? baseMonth(model, cfg) : { gross: 0, profit: -cfg.phases_budget.phase1_fixed_month };
  const max = model ? cfg.calc.goal_max_shows_with_base : cfg.tour_unit.capacity_per_troupe;
  const year = input.year ?? cfg.year;
  let plan = null, best = { profit: -Infinity };
  const curve = [];
  for (let n = 0; n <= max; n++) {
    const t = Math.max(1, Math.ceil(n / cfg.tour_unit.capacity_per_troupe));
    const x = business(b, n, t, cfg, true, year);
    curve.push({ n, profit: x.profit });
    if (x.profit > best.profit) best = { ...x, n, t };
    if (!plan && x.profit >= goal) plan = { ...x, n, t: n ? t : 0 };
  }
  const x = plan || best;
  return { goal, model, x, plan: !!plan, max, students: model ? model.students : 0, curve };
}

/* Ключевые показатели для сравнения сценариев */
export const summary = r => [
  { label: 'Выездных показов в месяц', v: r.x.n, t: 'int' },
  { label: 'Учеников студии', v: r.students, t: 'int' },
  { label: 'Гастрольных трупп', v: r.x.t, t: 'int' },
  { label: 'Плановая прибыль', v: r.x.profit, t: 'rub' },
  { label: 'Цель достижима', v: r.plan ? 'да' : 'нет', t: 'text' }
];
