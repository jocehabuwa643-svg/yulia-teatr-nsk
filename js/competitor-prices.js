/* competitor-prices.js — чистая логика цен конкурентов (без DOM): тип цены, группировка, «от»-цены,
   выбор цены билета, сравнение с автонаблюдением сайта и оценка кассы по модели проекта.
   Используется интерфейсом (market.js, competitor-detail.js) и недельным скриптом scripts/fetch-competitors.mjs,
   поэтому не импортирует ничего, что требует браузера.

   Главное правило: сравниваются только цены ОДНОГО типа. Билет в зал, выезд за ребёнка, пакет праздника,
   час аренды и абонемент — разные величины; в одной шкале они дают «непонятные подсчёты». */

/* ---------- Типы цен ---------- */

/* Подписи типов простыми словами; per — за что платят */
export const KINDS = {
  ticket: { label: 'Билет на спектакль или сеанс', short: 'билет', per: 'за человека, в зале' },
  per_child: { label: 'Выездной спектакль, за ребёнка', short: 'выезд, за ребёнка', per: 'за ребёнка' },
  // выезд с ценой за всю программу для группы (шоу Николя: 8 000 ₽ за 45 мин до 15 детей) — не «за человека»
  outbound_package: { label: 'Выезд — цена за программу для группы', short: 'выезд, за программу', per: 'за всю программу для группы' },
  party_package: { label: 'Праздник — пакет', short: 'пакет праздника', per: 'за весь праздник' },
  hour: { label: 'Аренда — час', short: 'час аренды', per: 'за час' },
  subscription: { label: 'Абонемент или месяц занятий', short: 'абонемент', per: 'за абонемент или месяц' },
  other: { label: 'Прочее (предоплата, разовое занятие)', short: 'прочее', per: '' }
};
export const KIND_ORDER = ['ticket', 'per_child', 'outbound_package', 'party_package', 'hour', 'subscription', 'other'];
/* Цены «за человека» — только их можно сравнивать с билетом Юлии */
export const PER_PERSON = new Set(['ticket', 'per_child']);

/* Тип по тексту рядом с ценой: ближайшее к числу ключевое слово побеждает.
   at — позиция числа в text; без позиции — по всему тексту в порядке приоритета. */
/* \b в JS не работает с кириллицей — границы слова заданы просмотром вперёд (?![а-яё]) */
const KIND_WORDS = [
  ['hour', /(в|за)\s+час(?![а-яё])|\/\s*час|аренд/giu],
  ['party_package', /пакет|тариф\s*[«"]/giu],
  ['subscription', /абонемент|в\s+месяц|\/\s*мес|за\s+месяц|занятий(?![а-яё])/giu],
  ['per_child', /(с|за)\s+(реб[её]нка|участника|человека)/giu],
  ['ticket', /билет|сеанс|вход(?![а-яё])|лекци/giu]
];
export function kindFromText(text, at = -1) {
  const t = String(text || '');
  if (at < 0) {
    // без позиции: первый сработавший тип по приоритету KIND_WORDS
    for (const [kind, re] of KIND_WORDS) { re.lastIndex = 0; if (re.test(t)) return kind; }
    return 'other';
  }
  // слова СРАЗУ после цены («350 ₽ с ребёнка», «3000 ₽ в час») точнее всего; после-окно обрывается на конце фразы,
  // чтобы «Билет 400 ₽. Аренда зала…» не приписал билету тип «аренда»
  const tail = t.slice(at, at + 28);
  const cut = tail.search(/[;!?\n]|\.\s+[А-ЯЁA-Z]/u);
  const after = cut >= 0 ? tail.slice(0, cut) : tail;
  const before = t.slice(Math.max(0, at - 80), at);
  const nearest = (s, fromEnd) => {
    let best = null;
    for (const [kind, re] of KIND_WORDS) {
      for (const m of s.matchAll(re)) {
        const dist = fromEnd ? s.length - (m.index + m[0].length) : m.index;
        if (!best || dist < best.dist) best = { kind, dist };
      }
    }
    return best;
  };
  const a = nearest(after, false);
  if (a) return a.kind;
  const b = nearest(before, true);
  return b ? b.kind : 'other';
}

/* Тип записи цены: явное поле kind главнее; иначе — по единице и подписи (старые записи и ручной ввод) */
export function kindOf(p) {
  if (!p) return 'other';
  if (p.kind && KINDS[p.kind]) return p.kind;
  const u = String(p.unit || '').toLowerCase();
  if (/пакет/.test(u)) return 'party_package';
  if (/шоу|выезд|программ/.test(u)) return 'outbound_package';
  if (/час/.test(u)) return 'hour';
  if (/абонемент|мес/.test(u)) return 'subscription';
  if (/реб/.test(u)) return 'per_child';
  if (/билет|чел/.test(u)) return 'ticket';
  if (p.snippet) return kindFromText(p.snippet, String(p.snippet).search(/\d/));
  return kindFromText(p.label || '');
}

/* ---------- Форматирование ---------- */

export const fmtNum = v => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(v)).replace(/-/g, '−');
export const ruDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${m[3]}.${m[2]}.${m[1]}` : null; };
export const safeUrl = u => (typeof u === 'string' && /^https?:\/\/\S+$/i.test(u.trim())) ? u.trim() : null;

/* Единица без дублирования «₽»: «₽/билет» → «₽/билет», пусто → «₽» */
const unitOf = p => { const u = String(p.unit || '₽').trim(); return /^₽/.test(u) ? u : '₽ ' + u; };

/* «от 500 ₽/билет» — квалификатор «от/до» сохраняется всегда: «от»-цена не выдаётся за точную */
export function priceText(p, withUnit = true) {
  if (!p || !Number.isFinite(p.value)) return 'нет данных';
  const q = p.qualifier ? p.qualifier + ' ' : '';
  return `${q}${fmtNum(p.value)} ${withUnit ? unitOf(p) : '₽'}`;
}

/* ---------- Ручной ввод Юлии ---------- */

/* Ручное значение → запись цены. Старые записи без kind вводились в поле «₽ за человека» — это билет */
export function manualPrice(m) {
  if (!m || !Number.isFinite(m.value)) return null;
  const kind = m.kind && KINDS[m.kind] ? m.kind : 'ticket';
  return {
    label: 'введено вами', value: m.value, unit: m.unit || (kind === 'ticket' ? '₽/билет' : kind === 'per_child' ? '₽/ребёнок' : kind === 'hour' ? '₽/час' : kind === 'party_package' ? '₽/пакет' : kind === 'outbound_package' ? '₽/выезд' : kind === 'subscription' ? '₽/мес' : '₽'),
    qualifier: null, kind, source_name: 'Ручной ввод', source_url: safeUrl(m.url), fetched_at: m.date || null, confidence: 'manual', manual: true
  };
}

/* ---------- Группировка ---------- */

/* Подтверждённые цены карточки + ручная цена, разложенные по типам (порядок KIND_ORDER).
   Ручная цена стоит первой в своей группе и помечена manual. */
export function groupPrices(c, manual) {
  const all = [];
  const m = manualPrice(manual);
  if (m) all.push(m);
  (c && c.prices || []).forEach(p => { if (p && Number.isFinite(p.value)) all.push({ ...p, kind: kindOf(p) }); });
  return KIND_ORDER.map(kind => ({ kind, ...KINDS[kind], items: all.filter(p => p.kind === kind) })).filter(g => g.items.length);
}

/* Допущение бизнес-плана (confidence:model) — рабочая цифра проекта, а НЕ цена, проверенная на сайте конкурента */
export const isPlanAssumption = p => !!p && !p.manual && p.confidence === 'model';

/* Цены, которые можно показывать как цены конкурента: подтверждённые источником или введённые Юлией.
   Допущения плана из групп убираются; группа только из допущений исчезает целиком. */
export function confirmedGroups(c, manual) {
  return groupPrices(c, manual)
    .map(g => ({ ...g, items: g.items.filter(p => !isPlanAssumption(p)) }))
    .filter(g => g.items.length);
}

/* Допущения бизнес-плана карточки по типам — для честной сноски «не цена студии» */
export function planAssumptionGroups(c) {
  return groupPrices(c, null)
    .map(g => ({ ...g, items: g.items.filter(isPlanAssumption) }))
    .filter(g => g.items.length);
}

/* Подпись источника цены по уровню достоверности: «проверено по источнику» — только для официального сайта */
export const SOURCE_WORD = { high: 'официальный сайт', medium: 'вторичный источник (не перепроверяется автоматически)', low: 'не подтверждено' };

/* Сводка группы одной строкой: одна цена — как есть; несколько — диапазон «21 000–29 500 ₽/пакет · 4 тарифа».
   Если минимальная цена была «от» — диапазон тоже начинается с «от». */
export function groupSummary(g) {
  const items = g.items.filter(p => !p.manual);
  const man = g.items.find(p => p.manual);
  if (man) return { text: priceText(man), manual: true };
  if (items.length === 1) return { text: priceText(items[0]), manual: false };
  // есть основная цена (chart — например, детский билет): показываем её, а не диапазон со льготными тарифами
  const main = items.find(p => p.chart);
  if (main) return { text: priceText(main), note: main.label || '', count: items.length, manual: false };
  const vals = items.map(p => p.value);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const loItem = items.find(p => p.value === lo);
  const units = new Set(items.map(unitOf));
  const unit = units.size === 1 ? [...units][0] : '₽';
  const q = loItem.qualifier === 'от' ? 'от ' : '';
  const text = lo === hi ? `${q}${fmtNum(lo)} ${unit}` : `${q}${fmtNum(lo)}–${fmtNum(hi)} ${unit}`;
  return { text, count: items.length, manual: false };
}

/* Самая свежая дата проверки среди цен группы (для подписи «проверено …») */
export function groupDate(g) {
  const ds = g.items.map(p => p.fetched_at).filter(Boolean).sort();
  return ds.length ? ds[ds.length - 1] : null;
}

/* ---------- Цена билета для сравнения с Юлией ---------- */

/* Ручная цена «за человека» → подтверждённая цена «за человека» (сначала отмеченная chart) → автонаблюдение сайта
   того же типа → null. Цены другого типа (час, пакет, абонемент) ценой билета НЕ считаются. */
export function ticketPriceOf(c, manual) {
  const m = manualPrice(manual);
  if (m && PER_PERSON.has(m.kind)) return { value: m.value, qualifier: null, kind: m.kind, label: m.label, source: 'введено вами', date: m.fetched_at, url: m.source_url, confidence: 'manual' };
  // допущения бизнес-плана ценой конкурента не считаются
  const listed = (c && c.prices || []).filter(p => Number.isFinite(p.value) && PER_PERSON.has(kindOf(p)) && !isPlanAssumption(p));
  const p = listed.find(x => x.chart) || listed[0];
  if (p) {
    const conf = p.confidence || 'medium';
    return { value: p.value, qualifier: p.qualifier || null, kind: kindOf(p), label: p.label || '', source: SOURCE_WORD[conf] || SOURCE_WORD.medium, date: p.fetched_at || null, url: safeUrl(p.source_url), confidence: conf };
  }
  const o = c && c.observed && c.observed.price;
  if (o && Number.isFinite(o.value) && PER_PERSON.has(kindOf(o))) return { value: o.value, qualifier: o.qualifier || null, kind: kindOf(o), label: 'найдено на сайте', source: 'найдено на сайте автоматически', date: o.fetched_at || c.checked_at || null, url: safeUrl(o.source_url), confidence: 'low' };
  return { value: null, qualifier: null, kind: null, label: '', source: null, date: null, url: null, confidence: 'no_data' };
}

/* ---------- Автонаблюдение сайта ---------- */

/* Цена, найденная недельной проверкой, и сравнение ТОЛЬКО с ценами того же типа.
   differs=true — на сайте другое число, чем в карточке (или чем было на прошлой неделе). */
export function observedCompare(c, manual) {
  const o = c && c.observed;
  const op = o && o.price && Number.isFinite(o.price.value) ? o.price : null;
  if (!op) return null;
  const kind = kindOf(op);
  const same = groupPrices(c, manual).find(g => g.kind === kind);
  const known = same ? same.items.map(p => p.value) : [];
  const changedSinceLastWeek = !!(o.prev_price && Number.isFinite(o.prev_price.value) && o.prev_price.value !== op.value);
  return {
    price: op, kind, kindLabel: KINDS[kind].short,
    differs: (known.length > 0 && !known.includes(op.value)) || changedSinceLastWeek,
    prev: changedSinceLastWeek ? o.prev_price : null,
    comparable: known.length > 0
  };
}

/* ---------- Диаграмма и таблица сравнения ---------- */

/* Строки диаграммы «за человека»: по каждой группе (билет в зал / выезд за ребёнка) — цены конкурентов.
   manualAll — { [id]: ручная запись }. Возвращает { ticket:[…], per_child:[…], none:[имена без цены за человека] } */
export function perPersonRows(list, manualAll = {}) {
  const out = { ticket: [], per_child: [], none: [] };
  (list || []).forEach(c => {
    const groups = groupPrices(c, manualAll[c.id]).filter(g => PER_PERSON.has(g.kind));
    if (!groups.length) { if (c.type === 'outbound' || c.type === 'benchmark') out.none.push(c.name); return; }
    groups.forEach(g => {
      const man = g.items.find(p => p.manual);
      const items = man ? [man] : g.items.filter(p => p.chart !== false || g.items.length === 1).slice(0, 2);
      (items.length ? items : g.items.slice(0, 1)).forEach(p => out[g.kind].push({
        id: c.id, name: c.name, label: p.manual ? 'введено вами' : (p.label || ''), value: p.value, qualifier: p.qualifier || null,
        manual: !!p.manual, confidence: p.confidence || 'medium', date: p.fetched_at || null, url: safeUrl(p.source_url)
      }));
    });
  });
  ['ticket', 'per_child'].forEach(k => out[k].sort((a, b) => b.value - a.value));
  return out;
}

/* Сводка цен других типов (выезд за программу, пакет праздника, аренда-час, абонемент) — каждая группа отдельно */
export function otherKindRows(list, manualAll = {}) {
  const out = {};
  ['outbound_package', 'party_package', 'hour', 'subscription'].forEach(k => { out[k] = []; });
  (list || []).forEach(c => groupPrices(c, manualAll[c.id]).forEach(g => {
    if (!out[g.kind]) return;
    const s = groupSummary(g);
    // единица внутри типа: «₽/мес» и «₽/абонемент (4 или 8 занятий)» — разные величины, сравнивать их нельзя
    const lead = g.items.find(p => p.manual) || g.items[0];
    const per = /мес/i.test(unitOf(lead)) ? 'month' : g.kind === 'subscription' ? 'pack' : 'unit';
    out[g.kind].push({ id: c.id, name: c.name, text: s.text, count: s.count || 1, manual: s.manual, date: groupDate(g), per, confidence: (g.items.find(p => p.manual) || g.items[0]).confidence || 'medium', url: safeUrl((g.items.find(p => p.source_url) || {}).source_url) });
  }));
  return out;
}

/* ---------- Оценка кассы по модели проекта ---------- */

/* «Если бы вы продавали билет по цене конкурента»: касса = зрители × цена; чистыми — по вашему калькулятору выезда.
   Это НЕ выручка конкурента: его расходы и загрузка неизвестны. calc — travelCalc (внедряется для тестов). */
export function revenueEstimate(c, cfg, manual, calc, audiences = [30, 60, 100]) {
  const tp = ticketPriceOf(c, manual);
  if (!Number.isFinite(tp.value) || tp.value <= 0) return { available: false, reason: 'у конкурента нет подтверждённой цены за человека — считать не из чего' };
  if (typeof calc !== 'function' || !cfg) return { available: false, reason: 'калькулятор выезда не загружен' };
  const rows = audiences.map(n => {
    const r = calc({ n, p: tp.value, k: 1, r: 0, dk: 0, own: 0 }, cfg);
    return { n, gross: r.gross, profit: r.profit, be: r.be };
  });
  return { available: true, price: tp, rows, fromPrice: tp.qualifier === 'от' };
}
