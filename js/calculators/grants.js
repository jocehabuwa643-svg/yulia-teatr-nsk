/* grants.js — гранты и срок запуска: успевает ли конкурс до открытия базы.
   Данные только из market.json (проверенные окна конкурсов). */
export const meta = {
  id: 'grants',
  icon: 'award',
  title: 'Гранты и срок запуска',
  what: 'Считает: какие конкурсы закрываются до вашей даты запуска и что можно подать',
  when: 'Когда: решаете, закладывать ли грант в финансирование февраля'
};

export const controls = () => [
  { type: 'select', id: 'launch', label: 'Планируемый запуск базы', options: [[0, 'Февраль 2027'], [1, 'Март 2027'], [2, 'Лето 2027'], [3, 'Осень 2027+']] }
];

const LAUNCH_DATE = ['2027-02-01', '2027-03-01', '2027-06-01', '2027-09-01'];

export function calc({ launch }, cfg, marketData) {
  // Принимаем и весь market.json, и уже выделенный блок grants
  const grantsData = (marketData && marketData.grants) || marketData || { programs: [] };
  const launchDate = new Date(LAUNCH_DATE[launch]);
  const programs = grantsData.programs.map(p => {
    // окно из строки вида «27.10–07.12.2026» или «закрыт 09.11.2026»
    const dates = (p.window.match(/(\d{2}\.\d{2}\.\d{4})/g) || []).map(d => {
      const [dd, mm, yy] = d.split('.');
      return new Date(+yy, +mm - 1, +dd);
    });
    const deadline = dates.length ? dates[dates.length - 1] : null;
    const resultsDate = p.results ? (p.results.match(/\d{2}\.\d{2}\.\d{4}/) || [null])[0] : null;
    const results = resultsDate ? (() => { const [dd, mm, yy] = resultsDate.split('.'); return new Date(+yy, +mm - 1, +dd); })() : null;
    let verdict;
    if (p.status === 'open' && deadline && deadline >= new Date()) verdict = 'Подача открыта — подавайте сейчас';
    else if (p.status === 'monitor') verdict = 'Мониторить объявления';
    else verdict = 'Окно закрыто';
    const moneyBeforeLaunch = results ? results < launchDate : false;
    return { ...p, deadline, results, verdict, moneyBeforeLaunch };
  });
  const usable = programs.filter(p => p.moneyBeforeLaunch && (p.status === 'open'));
  return {
    launchDate: LAUNCH_DATE[launch],
    programs, usable,
    conclusion: usable.length
      ? `До запуска деньги может дать: ${usable.map(p => p.name).join(', ')}. Итоги — проверить по положению.`
      : 'Ни один подтверждённый конкурс не даёт деньги до запуска: не закладывайте грант в обязательные платежи по помещению.',
    warning: grantsData.warning
  };
}
