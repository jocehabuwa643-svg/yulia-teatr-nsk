/* tests/today.test.mjs — дайджест «Сегодня»: ближайшие события от заданной даты (в т.ч. стык годов), сезон,
   «данные устарели», чек-лист и скрытие пустых блоков. Даты — местное время (new Date(y, m, d, h)), как в браузере. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  upcomingEvents, seasonStatus, dataFreshness, checklistProgress, buildDigest, digestHtml,
  formatToday, inDays, plural, isoDayNum, dayKey, STALE_DAYS
} from '../js/today.js';

const load = n => JSON.parse(readFileSync(new URL(`../data/${n}.json`, import.meta.url), 'utf-8'));
const at = (y, m, d, h = 10) => new Date(y, m - 1, d, h).getTime();

/* Небольшой набор данных проекта в том же формате, что data/*.json */
const seasonality = {
  months: [
    { m: 1, factor: 0.45, note: 'Спад после каникул', confidence: 'model' },
    { m: 6, factor: 1.25, note: 'Лагеря', confidence: 'model' },
    { m: 11, factor: 0.9, note: 'Межсезонье', confidence: 'model' },
    { m: 12, factor: 1.45, note: 'Новогодние заказы', confidence: 'model' }
  ],
  school_holidays: {
    2026: { loaded: true, source_url: 'https://do.nios.ru', items: [
      { name: 'Осенние', from: '2026-10-26', to: '2026-11-04', verified: false },
      { name: 'Зимние (новогодние)', from: '2026-12-28', to: '2027-01-10', verified: false }
    ] },
    2027: { loaded: true, items: [
      { name: 'Зимние (новогодние)', from: '2026-12-28', to: '2027-01-10' }, // повтор из соседнего года — не дублируется
      { name: 'Весенние', from: '2027-03-22', to: '2027-03-28' }
    ] }
  }
};
const market = { grants: { programs: [
  { name: 'ПФКИ', window: '27.10–07.12.2026 (дедлайн 7 декабря)', results: '30.04.2027', status: 'open', url: 'https://example.org/pfki' },
  { name: 'ФПГ', window: 'закрыт 09.11.2026', results: '—', status: 'closed' }
] } };
const guide = { entries: [
  { tab: 'docs', category: 'Налоги', title: 'Страховые взносы ИП за себя', text: 'Взносы.', details: ['Фиксированные взносы платят до 28 декабря расчётного года. Взнос 1% — до 1 июля следующего года.'] },
  { tab: 'grants', category: 'Налоги', title: 'Не та вкладка', text: 'Что-то до 05.12.2026.' }
] };
const data = { seasonality, market, guide };

test('20.11.2026: ближайшее — ПФКИ, зимние каникулы, взносы; осенние (прошли) не показаны', () => {
  const ev = upcomingEvents(data, at(2026, 11, 20));
  const titles = ev.map(e => e.title);
  assert.ok(!titles.some(t => t.startsWith('Осенние')), 'прошедшие каникулы скрыты');
  assert.equal(ev[0].title, 'ПФКИ: приём заявок');
  assert.equal(ev[0].days, 17);
  assert.equal(ev[0].date, '7 декабря');
  assert.equal(ev[0].status, 'soon');
  const winter = ev.find(e => e.kind === 'holiday');
  assert.equal(winter.title, 'Зимние (новогодние) каникулы');
  assert.equal(winter.days, 38);
  assert.equal(winter.endDate, '10 января 2027');
  assert.equal(ev.filter(e => e.kind === 'holiday').length, 1, 'одинаковые каникулы из двух лет не дублируются');
  const tax = ev.find(e => e.kind === 'tax');
  assert.equal(tax.title, 'Фиксированные взносы');
  assert.equal(tax.note, 'Страховые взносы ИП за себя');
  assert.ok(!titles.includes('Что-то'), 'карточки не из вкладки «Документы» не разбираются');
});

test('31.12.2026 (стык годов): зимние каникулы «идут сейчас», ещё 10 дней; ПФКИ и взносы 2026 прошли', () => {
  const ev = upcomingEvents(data, at(2026, 12, 31, 23));
  assert.equal(ev[0].kind, 'holiday');
  assert.equal(ev[0].status, 'now');
  assert.equal(ev[0].days, 10);
  assert.ok(!ev.some(e => e.title === 'ПФКИ: приём заявок'));
  // ежегодный срок взносов перенёсся на 28.12.2027 — это за горизонтом 120 дней
  assert.ok(!ev.some(e => e.title === 'Фиксированные взносы'));
  // весенние 2027 — впереди
  const spring = ev.find(e => e.title === 'Весенние каникулы');
  assert.equal(spring.status, 'soon');
  assert.equal(spring.days, isoDayNum('2027-03-22') - isoDayNum('2026-12-31'));
});

test('01.01.2027: январские каникулы идут, взнос 1% — следующего 1 июля, вне горизонта', () => {
  const ev = upcomingEvents(data, at(2027, 1, 1, 0));
  assert.equal(ev[0].status, 'now');
  assert.equal(ev[0].days, 9);
  assert.ok(!ev.some(e => e.title === 'Взнос 1%'));
  assert.ok(upcomingEvents(data, at(2027, 6, 1)).some(e => e.title === 'Взнос 1%' && e.date === '1 июля'));
});

test('последний день каникул — ещё «идёт сейчас» (0 дней), на следующий день — исчезает', () => {
  const last = upcomingEvents(data, at(2027, 1, 10, 23)).find(e => e.kind === 'holiday' && e.status === 'now');
  assert.equal(last.days, 0);
  assert.ok(!upcomingEvents(data, at(2027, 1, 11)).some(e => e.title.startsWith('Зимние')));
});

test('день дедлайна — «сегодня», событие ещё в списке', () => {
  const ev = upcomingEvents(data, at(2026, 12, 7, 20)).find(e => e.title === 'ПФКИ: приём заявок');
  assert.equal(ev.days, 0);
  assert.equal(inDays(ev.days), 'сегодня');
});

test('лимит и порядок: идущие первыми, затем по близости, не больше limit', () => {
  const ev = upcomingEvents(data, at(2026, 12, 30), { limit: 2 });
  assert.equal(ev.length, 2);
  assert.equal(ev[0].status, 'now');
  assert.ok(ev[1].days >= 0);
});

test('реальные данные проекта: на 20.11.2026 есть ближайшие события, все в будущем или идут', () => {
  const real = { seasonality: load('seasonality'), market: load('market'), guide: load('guide') };
  const ev = upcomingEvents(real, at(2026, 11, 20));
  assert.ok(ev.length >= 1 && ev.length <= 5);
  ev.forEach(e => assert.ok(e.days >= 0));
});

test('сезон: ноябрь — средний, пик в декабре через 11 дней; декабрь — высокий; январь — низкий', () => {
  const nov = seasonStatus(seasonality, at(2026, 11, 20));
  assert.equal(nov.level, 'mid');
  assert.equal(nov.label, 'Средний спрос');
  assert.equal(nov.nextPeak.month, 'декабрь');
  assert.equal(nov.nextPeak.days, 11);
  assert.equal(nov.model, true);
  const dec = seasonStatus(seasonality, at(2026, 12, 5));
  assert.equal(dec.level, 'high');
  assert.equal(dec.nextPeak, null);
  assert.equal(seasonStatus(seasonality, at(2027, 1, 15)).level, 'low');
  assert.equal(seasonStatus(seasonality, at(2027, 1, 15)).nextPeak.month, 'июнь');
});

test('сезон: нет данных месяца или файла → null', () => {
  assert.equal(seasonStatus(seasonality, at(2027, 3, 1)), null);
  assert.equal(seasonStatus(null, at(2027, 3, 1)), null);
  assert.equal(seasonStatus({ months: [] }, at(2027, 3, 1)), null);
});

test('свежесть: обновлено сегодня — не устарели; старше порога — устарели с причиной', () => {
  const meta = { generated_at: new Date(at(2026, 11, 20, 8)).toISOString() };
  const ok = dataFreshness({ meta }, at(2026, 11, 20, 12));
  assert.equal(ok.stale, false);
  assert.equal(ok.label, '20 ноября');
  const edge = dataFreshness({ meta }, at(2026, 11, 20 + STALE_DAYS, 12));
  assert.equal(edge.stale, false, 'ровно на пороге ещё свежие');
  const old = dataFreshness({ meta }, at(2026, 11, 21 + STALE_DAYS, 12));
  assert.equal(old.stale, true);
  assert.match(old.reasons[0], /4 дня назад/);
});

test('свежесть: курс ЦБ stale или ленты новостей недоступны → устарели; берётся самая поздняя дата', () => {
  const meta = { generated_at: new Date(at(2026, 11, 18)).toISOString() };
  const news = { updated_at: new Date(at(2026, 11, 20, 6)).toISOString(), stale: false };
  assert.equal(dataFreshness({ meta, news }, at(2026, 11, 20)).label, '20 ноября');
  const r = dataFreshness({ meta, rates: { cbr: { usd_rub: { stale: true } } } }, at(2026, 11, 18));
  assert.equal(r.stale, true);
  assert.deepEqual(r.reasons, ['курсы ЦБ не обновились']);
  assert.equal(dataFreshness({ meta, news: { ...news, stale: true } }, at(2026, 11, 20)).stale, true);
  assert.equal(dataFreshness({}, at(2026, 11, 20)), null, 'нет дат — строки нет');
});

test('чек-лист: не начат → null; начат → N из M и следующий шаг; закончен → next null', () => {
  const steps = [{ days: 'Дни 1–3', title: 'ИП' }, { days: 'Дни 2–5', title: 'Оплата' }, ['Дни 3–7', 'Труппа', '...']];
  assert.equal(checklistProgress(steps, null), null);
  assert.equal(checklistProgress(steps, [false, false]), null);
  assert.equal(checklistProgress([], [true]), null);
  const p = checklistProgress(steps, [true, false, true]);
  assert.equal(p.done, 2);
  assert.equal(p.total, 3);
  assert.deepEqual(p.next, { title: 'Оплата', days: 'Дни 2–5' });
  assert.equal(checklistProgress(steps, [true, true, true]).next, null);
});

test('пустые данные → все блоки скрыты, остаётся только дата', () => {
  const dg = buildDigest({}, { now: at(2026, 11, 20) });
  assert.equal(dg.season, null);
  assert.deepEqual(dg.events, []);
  assert.deepEqual(dg.news, []);
  assert.equal(dg.fresh, null);
  assert.equal(dg.checklist, null);
  const html = digestHtml(dg, at(2026, 11, 20));
  assert.match(html, /пятница, 20 ноября/);
  assert.doesNotMatch(html, /td-tile|td-grid|Новости отрасли|Ближайшее|Данные обновлены/);
});

test('новости: показываются 3, остальные скрыты за «Ещё N»; нет новостей — блока нет', () => {
  const now = at(2026, 11, 20, 12);
  const items = Array.from({ length: 6 }, (_, i) => ({
    id: 'n' + i, title: 'Новость ' + i, url: 'https://example.org/' + i, source_name: 'Источник',
    published_at: new Date(now - i * 864e5).toISOString(), topic: 'culture'
  }));
  const html = digestHtml(buildDigest({ news: { updated_at: new Date(now).toISOString(), stale: false, items } }, { now }), now);
  assert.equal((html.match(/class="td-news"/g) || []).length, 6);
  assert.equal((html.match(/class="td-more" hidden/g) || []).length, 3);
  assert.match(html, /Ещё 3/);
  assert.match(html, /rel="noopener noreferrer"/);
  // старые (вне 14 дней) — не свежие, блок не рисуется
  const stale = items.map(it => ({ ...it, published_at: new Date(now - 30 * 864e5).toISOString() }));
  assert.doesNotMatch(digestHtml(buildDigest({ news: { items: stale } }, { now }), now), /Новости отрасли/);
});

test('экранирование: HTML из данных не исполняется, небезопасные ссылки отбрасываются', () => {
  const now = at(2026, 11, 20);
  const evil = { grants: { programs: [{ name: '<img src=x onerror=alert(1)>', window: 'до 01.12.2026', status: 'open', url: 'javascript:alert(1)' }] } };
  const html = digestHtml(buildDigest({ market: evil }, { now }), now);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /&lt;img/);
});

test('форматирование: дата по-русски, склонения, ключ дня', () => {
  assert.equal(formatToday(at(2026, 11, 20)), 'пятница, 20 ноября');
  assert.equal(formatToday(at(2027, 1, 1)), 'пятница, 1 января');
  assert.equal(inDays(1), 'завтра');
  assert.equal(inDays(21), 'через 21 день');
  assert.equal(inDays(22), 'через 22 дня');
  assert.equal(inDays(11), 'через 11 дней');
  assert.equal(plural(112, 'день', 'дня', 'дней'), 'дней');
  assert.equal(dayKey(at(2026, 12, 31, 23)), '2026-12-31');
  assert.equal(dayKey(at(2027, 1, 1, 0)), '2027-01-01');
  assert.equal(isoDayNum('мусор'), null);
});
