/* travel.js — калькулятор «Выездной спектакль».
   Чистая функция: никакой DOM-логики. Формула перенесена из проверенной версии без изменений,
   константы приходят из config.json/rates.json. */

export const meta = {
  id: 'travel',
  icon: 'route',
  title: 'Выездной спектакль и область',
  what: 'Считает: чистую прибыль показа и дня, точку безубыточности по зрителям',
  when: 'Когда: перед каждым подтверждением выезда в сад, школу, ДК или область'
};

export const controls = cfg => [
  { type: 'range', id: 'kids', label: 'Дети на показ', min: 20, max: 250, step: 1, def: 45, suffix: 'чел.' },
  { type: 'range', id: 'ticket', label: 'Цена билета', min: 250, max: 500, step: 5, def: 325, suffix: '₽' },
  { type: 'select', id: 'venue', label: 'Формат площадки', options: [[0, `Сад / школа · оргсбор ${cfg.venue_share.school_garden}%`], [1, `Зал ДК · доля ${cfg.venue_share.dk}%`]] },
  { type: 'select', id: 'cluster', label: 'Показов в день', options: [[1, 'Один показ'], [2, 'Два подряд'], [3, 'Три подряд']] },
  { type: 'select', id: 'route', label: 'Маршрут и ГСМ', options: cfg.travel.routeNames.map((n, i) => [i, n]) },
  { type: 'select', id: 'cast', label: 'Состав', options: [[0, `Наём по ГПХ · +${cfg.travel.salary_city_single ? '' : ''}30,2%`], [1, 'Основатели ИП · 0% в модели']] }
];

export function calc({ n, p, k, r, dk, own }, cfg) {
  const t = cfg.travel;
  const gross = n * p * k;
  const rate = dk ? t.shareDk : t.shareSchool;
  const salary = Math.max(r ? t.salary_gastro_day : 0, k * (dk ? t.salary_dk : k > 1 ? t.salary_city_cluster : t.salary_city_single));
  const social = own ? 0 : salary * cfg.gphRate;
  const fuel = t.gas[r] + (dk && !r ? t.delivery_dk_city : 0);
  const wear = k * (dk ? t.wear_dk : t.wear_per_show);
  const print = n * k * t.print_per_viewer;
  const fee = gross * rate;
  const tax = gross * cfg.usn / 100;
  const cost = salary + social + fuel + wear + print + fee + tax;
  const profit = gross - cost;
  const beDenom = p * (1 - rate - cfg.usn / 100) - t.print_per_viewer;
  const be = Math.max(1, Math.ceil((salary + social + fuel + wear) / Math.max(1, beDenom)));
  return {
    gross, salary, social, fuel, wear, print, fee, tax, cost, profit, be,
    per: profit / Math.max(1, k),
    margin: gross > 0 ? 100 * profit / gross : 0,
    k, rate, usn: cfg.usn
  };
}
export const travelCalc = calc;
