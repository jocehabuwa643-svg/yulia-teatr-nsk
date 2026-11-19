/* grants.js — гранты и срок запуска: успевает ли конкурс до открытия базы.
   Данные только из market.json (проверенные окна конкурсов); варианты запуска — из config.calc.launch_options.
   «Сегодня» передаётся снаружи (now), внутри Date.now() нет — расчёт воспроизводим в тестах. */

export const meta = {
  id: 'grants',
  icon: 'award',
  headline: 'count',            // тип главной цифры: result — со знаком, amount — сумма/цена без плюса, count — целое число
  title: 'Гранты и срок запуска',
  what: 'Считает: какие конкурсы закрываются до вашей даты запуска и что можно подать',
  when: 'Когда: решаете, закладывать ли грант в финансирование февраля'
};

export const controls = cfg => [
  { type: 'select', id: 'launch', label: 'Планируемый запуск базы', options: cfg.calc.launch_options.map((o, i) => [i, o.label]) }
];

/* «дд.мм.гггг» → UTC-дата (полночь), чтобы сравнение не зависело от часового пояса */
const parseRu = s => {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(s || '');
  return m ? new Date(Date.UTC(+m[3], +m[2] - 1, +m[1])) : null;
};
const parseAllRu = s => ((s || '').match(/\d{2}\.\d{2}\.\d{4}/g) || []).map(parseRu);

/* now — момент «сегодня» (мс или Date); если не передан, берётся дата среза данных cfg.as_of */
export function calc(input, cfg, marketData, now) {
  const grantsData = (marketData && marketData.grants) || marketData || { programs: [] };
  const opts = cfg.calc.launch_options;
  const idx = Math.min(Math.max(0, Math.round(Number(input.launch) || 0)), opts.length - 1);
  const launchDate = new Date(opts[idx].date + 'T00:00:00Z');
  const today = now != null ? new Date(now) : new Date(cfg.as_of + 'T00:00:00Z');
  const programs = (grantsData.programs || []).map(p => {
    const dates = parseAllRu(p.window);
    const deadline = dates.length ? dates[dates.length - 1] : null;
    const results = parseRu(p.results);
    let verdict;
    if (p.status === 'open' && deadline && deadline >= today) verdict = 'Подача открыта — подавайте сейчас';
    else if (p.status === 'monitor') verdict = 'Мониторить объявления';
    else verdict = 'Окно закрыто';
    const moneyBeforeLaunch = results ? results < launchDate : false;
    // можно ли ещё подать: окно открыто и дедлайн не прошёл
    const canApply = p.status === 'open' && !!deadline && deadline >= today;
    return { ...p, deadline, results, verdict, moneyBeforeLaunch, canApply };
  });
  const usable = programs.filter(p => p.moneyBeforeLaunch && p.status === 'open');
  return {
    launchDate: opts[idx].date,
    launchLabel: opts[idx].label,
    today: today.toISOString().split('T')[0],
    programs, usable,
    openNow: programs.filter(p => p.canApply).length,
    conclusion: usable.length
      ? `До запуска деньги может дать: ${usable.map(p => p.name).join(', ')}. Итоги — проверить по положению.`
      : 'Ни один подтверждённый конкурс не даёт деньги до запуска: не закладывайте грант в обязательные платежи по помещению.',
    warning: grantsData.warning || ''
  };
}

/* Ключевые показатели для сравнения сценариев */
export const summary = r => [
  { label: 'Дата запуска', v: r.launchLabel, t: 'text' },
  { label: 'Грантов до запуска', v: r.usable.length, t: 'int' },
  { label: 'Конкурсов открыто сейчас', v: r.openNow, t: 'int' }
];
