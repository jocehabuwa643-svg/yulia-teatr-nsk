/* clients-model.js — чистая логика подраздела «Клиенты и площадки» (без DOM): подсчёты для вход-карточки,
   выбор места, отбор и границы объектов карты, строки вкладки «Цены и аренда» с провенансом
   и «страж истории» — запись в history, которая никогда не уводит со страницы.
   Модуль импортируется и браузером (js/clients-view.js, js/client-map.js), и тестами node --test. */

/* ---------- Подсчёты ---------- */

const num = v => (Number.isFinite(+v) && v !== null && v !== '' ? +v : 0);

/* Итоги по всем местам leads.json. Приоритет — готовые totals из файла (их считает scripts/fetch-leads.mjs),
   иначе — сумма по местам. visit = школы + детские сады («потенциал выезда» без коэффициентов). */
export function leadTotals(leads) {
  const places = (leads && Array.isArray(leads.places)) ? leads.places : [];
  const sum = places.reduce((a, p) => ({
    school: a.school + num(p.school), kindergarten: a.kindergarten + num(p.kindergarten), culture: a.culture + num(p.culture)
  }), { school: 0, kindergarten: 0, culture: 0 });
  const t = leads && leads.totals;
  const pick = k => (t && Number.isFinite(t[k]) ? t[k] : sum[k]);
  const school = pick('school'), kindergarten = pick('kindergarten'), culture = pick('culture');
  return {
    ready: places.length > 0,
    places: places.length,
    school, kindergarten, culture,
    visit: school + kindergarten,
    updated: (leads && leads.updated_at) || null,
    stale: !!(leads && leads.stale) || places.some(p => p && p.stale)
  };
}

/* Место по id; неизвестный id — первое место; пустой список — null */
export function pickPlace(places, id) {
  const list = Array.isArray(places) ? places : [];
  return list.find(p => p && p.id === id) || list[0] || null;
}

/* Сводка по месту для строки под картой */
export function placeStat(p) {
  if (!p) return null;
  const school = num(p.school), kindergarten = num(p.kindergarten), culture = num(p.culture);
  return { school, kindergarten, culture, visit: Number.isFinite(p.potential) ? p.potential : school + kindergarten };
}

/* Только объекты с корректными координатами (широта −90…90, долгота −180…180) и известным типом */
export function validObjects(p) {
  const objs = (p && Array.isArray(p.objects)) ? p.objects : [];
  return objs.filter(o => o && Array.isArray(o.ll) && o.ll.length === 2
    && Number.isFinite(o.ll[0]) && Number.isFinite(o.ll[1])
    && Math.abs(o.ll[0]) <= 90 && Math.abs(o.ll[1]) <= 180)
    .map(o => ({ n: typeof o.n === 'string' ? o.n.trim() : '', k: o.k === 'd' || o.k === 'c' ? o.k : 's', ll: o.ll }));
}

/* Число объектов каждого типа на карте (может быть меньше счётчиков, если у объекта нет координат) */
export function kindCounts(objs) {
  return (objs || []).reduce((a, o) => { a[o.k] = (a[o.k] || 0) + 1; return a; }, { s: 0, d: 0, c: 0 });
}

/* Границы [[юг, запад], [север, восток]]; нет точек — null; одна точка — null (центруем по coords места) */
export function boundsOf(objs) {
  if (!objs || objs.length < 2) return null;
  let s = 90, w = 180, n = -90, e = -180;
  objs.forEach(o => { const [la, lo] = o.ll; if (la < s) s = la; if (la > n) n = la; if (lo < w) w = lo; if (lo > e) e = lo; });
  if (s === n && w === e) return null;
  return [[s, w], [n, e]];
}

/* Районы города, отсортированные по потенциалу выезда (для Новосибирска) */
export function districtRows(p) {
  const ds = (p && Array.isArray(p.districts)) ? p.districts : [];
  return ds.map(d => ({ name: d.name || '—', school: num(d.school), kindergarten: num(d.kindergarten), culture: num(d.culture), visit: Number.isFinite(d.potential) ? d.potential : num(d.school) + num(d.kindergarten) }))
    .sort((a, b) => b.visit - a.visit);
}

/* ---------- Вкладка «Цены и аренда» ----------
   Каждая строка: { k, v, note, conf, src, url, date }. Числа берутся только из state.CFG (сплющенный config.json
   + meta с провенансом) и competitors.json. Нет значения — строка с v = null («нет данных»), а не выдуманное число. */

const fmtRu = v => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(v));
const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);

function cfgRow(cfg, path, label, format) {
  const v = get(cfg, path);
  const m = (cfg && cfg.meta && cfg.meta[path]) || {};
  const manual = !!(cfg && Array.isArray(cfg.assumptions) && cfg.assumptions.some(a => a.path === path && a.overridden));
  return {
    k: label,
    v: Number.isFinite(v) ? format(v) : null,
    note: manual ? 'ваше значение из калькулятора' : (m.note || m.source_name || 'допущение проекта'),
    conf: manual ? 'manual' : (m.confidence || (Number.isFinite(v) ? 'model' : 'no_data')),
    src: m.source_name || null, url: m.source_url || null, date: m.fetched_at || null
  };
}

export function priceRows(cfg, competitors) {
  const rows = [];
  rows.push(cfgRow(cfg, 'base_costs.rent_per_m2', 'Аренда базы (план)', v => `${fmtRu(v)} ₽/м² в мес.`));
  rows.push(cfgRow(cfg, 'base_costs.utilities_per_m2', 'Коммунальные (план)', v => `${fmtRu(v)} ₽/м² в мес.`));
  rows.push(cfgRow(cfg, 'venue_share.dk', 'Доля ДК от кассы', v => `${fmtRu(v)}%`));
  rows.push(cfgRow(cfg, 'venue_share.school_garden', 'Оргсбор сада / школы', v => `${fmtRu(v)}%`));

  // Билет выезда: диапазон min–max из config.ticket
  const tMin = get(cfg, 'ticket.min'), tMax = get(cfg, 'ticket.max');
  const tr = cfgRow(cfg, 'ticket.min', 'Билет выезда (план)', v => v);
  tr.v = Number.isFinite(tMin) && Number.isFinite(tMax) ? `${fmtRu(tMin)}–${fmtRu(tMax)} ₽` : (Number.isFinite(tMin) ? `${fmtRu(tMin)} ₽` : null);
  rows.push(tr);

  // Абонемент студии: диапазон по стадиям набора config.stages (не захардкоженная строка)
  const stages = Array.isArray(get(cfg, 'stages')) ? get(cfg, 'stages') : [];
  const subs = stages.map(s => s && s.subscription).filter(Number.isFinite);
  const sm = (cfg && cfg.meta && cfg.meta.stages) || {};
  rows.push({
    k: 'Абонемент студии (план)',
    v: subs.length ? (Math.min(...subs) === Math.max(...subs) ? `${fmtRu(subs[0])} ₽/мес.` : `${fmtRu(Math.min(...subs))}–${fmtRu(Math.max(...subs))} ₽/мес.`) : null,
    note: subs.length ? 'по стадиям набора из бизнес-плана' : 'нет данных в config.json',
    conf: subs.length ? (sm.confidence || 'model') : 'no_data',
    src: sm.source_name || null, url: sm.source_url || null, date: sm.fetched_at || null
  });

  // Публичные цены конкурентов и ориентиров рынка — каждая со своим источником и датой
  const comp = competitors || {};
  const fromPrice = (owner, pr) => ({
    k: `${owner.name}${pr.label ? ' · ' + pr.label : ''}`,
    v: Number.isFinite(pr.value) ? `${pr.qualifier ? pr.qualifier + ' ' : ''}${fmtRu(pr.value)} ${pr.unit || '₽'}` : null,
    note: pr.source_name || owner.source_name || 'источник не указан',
    conf: pr.confidence || owner.confidence || 'low',
    src: pr.source_name || owner.source_name || null,
    url: pr.source_url || owner.source_url || null,
    date: pr.fetched_at || owner.fetched_at || null
  });
  (comp.party_venues || []).forEach(v => {
    // базовый час аренды: подпись «Час аренды…» или единица ровно «₽/час» (доп. часы и пакеты — не базовая ставка)
    const ok = p => p && Number.isFinite(p.value);
    const hour = (v.prices || []).find(p => ok(p) && /^час/i.test((p.label || '').trim()))
      || (v.prices || []).find(p => ok(p) && /^₽\/час$/.test((p.unit || '').trim()));
    if (hour) rows.push(fromPrice(v, hour));
  });
  (comp.stationary_benchmarks || []).forEach(b => {
    const first = (b.prices || []).find(p => Number.isFinite(p.value));
    if (first) rows.push(fromPrice(b, first));
  });
  (comp.studio_scene || []).forEach(s => {
    if (s.status === 'historical') return;   // архивные записи — не действующие цены
    const first = (s.prices || []).find(p => Number.isFinite(p.value));
    if (first) rows.push(fromPrice(s, first));
  });
  return rows;
}

/* Подпись уровня достоверности для бейджа */
export function confLabel(conf) {
  return ({ model: 'допущение проекта', manual: 'введено вами', high: 'проверено', medium: 'публичный источник', low: 'низкая точность', no_data: 'нет данных' })[conf] || String(conf || 'нет данных');
}

/* ---------- Страж истории ----------
   Зачем: «назад» телефона должно закрывать подраздел. Для этого при открытии кладём СВОЮ запись (pushState
   с уникальным токеном), а при закрытии кнопкой снимаем её history.back().
   Опасность прежней версии: history.back() вызывался по флагу pushed, без проверки, что текущая запись — наша.
   Если запись к этому моменту уже снята (Android: CloseWatcher закрыл диалог и браузер сам ушёл назад;
   быстрый повторный цикл открытия/закрытия; восстановление вкладки после выгрузки из памяти),
   второй back() уводил ЗА начало сайта — «выкидывает из сайта».
   Правило стража: back() вызывается ТОЛЬКО когда history.state несёт наш текущий токен. Запись с токеном
   положена с этой же страницы, значит шаг назад от неё всегда остаётся на сайте. */
export const HIST_KEY = 'clView';

export function makeBackGuard(hist, opts = {}) {
  const now = opts.now || (() => Date.now());
  let token = null;        // токен нашей текущей записи
  let pending = false;     // вызван back(), ждём popstate
  let seq = 0;
  const isOurs = st => !!(st && token && st[HIST_KEY] === token);
  return {
    get token() { return token; },
    get pending() { return pending; },
    isOurs,
    /* Положить запись при открытии. Возвращает true, если запись положена */
    push() {
      if (token && isOurs(hist.state)) return true;          // уже стоит наша запись — второй не кладём
      const t = `${now().toString(36)}-${++seq}`;
      try {
        const base = (hist.state && typeof hist.state === 'object') ? hist.state : {};
        hist.pushState({ ...base, [HIST_KEY]: t }, '');
        token = t;
        return true;
      } catch (e) { token = null; return false; }            // file:// или лимит истории — живём без записи
    },
    /* Снять запись при закрытии кнопкой/Esc/кликом вне. back() — только если текущая запись наша */
    release() {
      const ours = isOurs(hist.state);
      token = null;
      if (!ours) return false;
      pending = true;
      try { hist.back(); return true; } catch (e) { pending = false; return false; }
    },
    /* popstate: true — запись уже снята браузером (подраздел надо закрыть без второго back) */
    onPop(st) {
      pending = false;
      if (token && !isOurs(st)) { token = null; return true; }
      return false;
    },
    /* Очистка «чужого» токена после перезагрузки/восстановления вкладки: запись остаётся, но без нашей метки */
    scrub() {
      const st = hist.state;
      if (st && typeof st === 'object' && HIST_KEY in st && !isOurs(st)) {
        const { [HIST_KEY]: _, ...rest } = st;
        try { hist.replaceState(Object.keys(rest).length ? rest : null, ''); } catch (e) { /* не критично */ }
        return true;
      }
      return false;
    }
  };
}

/* ---------- Пояснение «устарело» простыми словами ---------- */

/* Дата и время по Новосибирску: «21.11.2026, 10:22»; плохая дата — null */
export function nskDateTime(iso) {
  const t = new Date(iso);
  if (!iso || !Number.isFinite(t.getTime())) return null;
  try {
    return t.toLocaleString('ru-RU', { timeZone: 'Asia/Novosibirsk', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    // среда без базы часовых поясов — сдвиг UTC+7 вручную (в Новосибирске нет перехода на летнее время)
    const n = new Date(t.getTime() + 7 * 3600e3), p = v => String(v).padStart(2, '0');
    return `${p(n.getUTCDate())}.${p(n.getUTCMonth() + 1)}.${n.getUTCFullYear()}, ${p(n.getUTCHours())}:${p(n.getUTCMinutes())}`;
  }
}

/* Причина сбоя для человека: 5xx/таймаут — «сервер карт не ответил», иначе — «ошибка загрузки» */
export function staleReasonText(reason) {
  if (!reason) return 'сервер карт не ответил';
  return /\b5\d\d\b|timeout|таймаут|abort/i.test(String(reason)) ? 'сервер карт не ответил' : 'ошибка загрузки';
}

/* Подпись для места со stale:true: попытка обновления не удалась, показаны прежние данные от fetched_at.
   Без stale — null */
export function placeStaleNote(p) {
  if (!p || !p.stale) return null;
  const tried = nskDateTime(p.stale_since);
  const from = nskDateTime(p.fetched_at);
  return {
    badge: 'последнее обновление не удалось',
    text: `Последнее обновление${tried ? ` (${tried})` : ''} не удалось — ${staleReasonText(p.stale_reason)}. ${from ? `Показаны данные от ${from}` : 'Показаны прежние данные'}; следующая попытка — при еженедельном обновлении.`
  };
}

/* Строка шапки подраздела: когда обновлялось и какие места не обновились при последней попытке.
   names — подпись источников; пустой leads — null (решает вызывающий) */
export function leadsMetaLine(leads, names) {
  if (!leads) return null;
  const places = Array.isArray(leads.places) ? leads.places : [];
  const failed = places.filter(p => p && p.stale);
  const when = nskDateTime(leads.updated_at);
  const src = names || 'OpenStreetMap';
  if (!failed.length && !leads.stale) return `${src} · обновлено ${when || '—'} · возможны пропуски`;
  if (!failed.length) return `${src} · последнее обновление не удалось — показаны данные от ${when || '—'} · возможны пропуски`;
  // самая ранняя дата прежних данных среди не обновившихся мест (сортировка по времени, не по строке)
  const ts = failed.map(p => new Date(p.fetched_at).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  const oldest = ts.length ? nskDateTime(new Date(ts[0]).toISOString()) : null;
  const who = failed.map(p => p.name || p.id).join(', ');
  const ok = places.length - failed.length;
  // коротко для шапки (на 360 px — не больше трёх строк); причина сбоя — под выбранным местом
  return `${src} · ${when || '—'}: ${ok ? `обновлено ${ok} из ${places.length} мест` : 'не обновилось ни одно место'}; ` +
    `${who} — ${oldest ? `показаны данные от ${oldest}` : 'показаны прежние данные'}`;
}
