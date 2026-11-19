/* goal.js — обратный планировщик цели: «хочу чистыми X ₽/мес».
   Решается прямым перебором целых показов на точной модели business() —
   это обратная задача на монотонной функции, а не подгонка. */
import { baseMonth, business } from './basecamp.js';

export const meta = {
  id: 'goal',
  icon: 'target',
  title: 'Сколько нужно для моей цели',
  what: 'Считает: минимальное число показов, учеников и трупп под желаемую чистую прибыль',
  when: 'Когда: планируете целевой доход и решаете, чем его закрывать'
};

export const controls = cfg => [
  { type: 'range', id: 'goal', label: 'Желаемая чистая прибыль в месяц', min: 100000, max: 1500000, step: 5000, def: cfg.goals.short_target, suffix: '₽', wide: true },
  { type: 'select', id: 'stageSel', label: 'Стадия проекта', options: [[0, 'До февраля · без базы'], [1, 'База на разгоне · 130 м²'], [2, 'Зрелая база · 130 м²']], wide: true }
];

export function stageModel(i, cfg) {
  if (!i) return null;
  const s = cfg.stages[i - 1];
  return { ...s, area: 130, rent: 1000, s: s.students, p: s.subscription, w: s.weekend_shows, a: s.weekend_audience, h: s.parties, c: s.party_check };
}

export function calc({ goal, stageSel }, cfg) {
  const model = stageModel(stageSel, cfg);
  const b = model ? baseMonth(model, cfg) : { gross: 0, profit: -cfg.phases_budget.phase1_fixed_month };
  const max = stageSel === 0 ? cfg.tour_unit.capacity_per_troupe : 200;
  let plan = null, best = { profit: -Infinity };
  for (let n = 0; n <= max; n++) {
    const t = Math.max(1, Math.ceil(n / cfg.tour_unit.capacity_per_troupe));
    const x = business(b, n, t, cfg);
    if (x.profit > best.profit) best = { ...x, n, t };
    if (x.profit >= goal) { plan = { ...x, n, t: n ? t : 0 }; break; }
  }
  const x = plan || best;
  return { goal, model, x, plan: !!plan, max, students: model ? model.students : 0 };
}
