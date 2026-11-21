/* Тесты недельной проверки конкурентов: видимый текст, устойчивый хеш, извлечение цены (плюсы и минусы),
   robots.txt, запрещённые площадки, сравнение наблюдений, сохранение прежних данных при сбое и неприкосновенность ручных цен.
   Сеть не используется: страницы и robots подставляются зависимостями. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { htmlToText, hashText, extractPrice, diffObserved, isDeniedHost, buildCheck, checkItem, DENY_HOSTS } from '../scripts/fetch-competitors.mjs';
import { robotsAllowsPath } from '../scripts/fetch-util.mjs';

const NOW = '2026-11-21T03:00:00.000Z';
const LATER = '2026-11-28T03:00:00.000Z';

/* ---------- Текст и хеш ---------- */
test('htmlToText: убирает скрипты, стили, навигацию, комментарии и теги; раскрывает сущности', () => {
  const html = '<html><head><title>T</title><style>.a{color:red}</style></head><body><nav>Меню</nav><!-- скрыто --><script>var p="999 руб"</script>' +
    '<h1>Спектакль</h1><p>Билет&nbsp;от&nbsp;300&nbsp;&#8381; &amp; бонус</p><footer>© 2026</footer></body></html>';
  const t = htmlToText(html);
  assert.match(t, /Спектакль/);
  assert.match(t, /Билет от 300 ₽ & бонус/);
  assert.doesNotMatch(t, /Меню|999|color|скрыто|©/);
});

test('hashText: стабилен к пробелам, переводам строк, регистру и ё/е; чувствителен к словам и цифрам', () => {
  const a = hashText('Билет  от 300 ₽\n  Ёлка');
  assert.equal(a, hashText('  билет от 300 ₽ елка '));
  assert.equal(a, hashText('Билет\tот\n\n300 ₽ Ёлка'));
  assert.notEqual(a, hashText('Билет от 350 ₽ Ёлка'));
  assert.equal(a.length, 16);
});

/* ---------- Извлечение цены: положительные ---------- */
test('extractPrice: «от 300 ₽» рядом со словом «билет»', () => {
  const r = extractPrice('Купить билет от 300 ₽ на спектакль');
  assert.equal(r.value, 300);
  assert.equal(r.qualifier, 'от');
  assert.equal(r.unit, '₽');
  assert.match(r.snippet, /билет/i);
});

test('extractPrice: «1 500 руб.» с пробелом тысяч и неразрывным пробелом', () => {
  assert.equal(extractPrice('Стоимость программы 1 500 руб.').value, 1500);
  assert.equal(extractPrice('Стоимость программы 1 500 руб.').value, 1500);
  assert.equal(extractPrice('Цена спектакля — 2500 рублей за выезд').value, 2500);
  assert.equal(extractPrice('Стоимость программы 450 р. с человека').value, 450);
});

test('extractPrice: одна и та же цена, повторённая несколько раз, — однозначна', () => {
  const r = extractPrice('Билет 400 ₽. Спектакль для детей: билет 400 ₽.');
  assert.equal(r.value, 400);
});

/* ---------- Извлечение цены: отрицательные ---------- */
test('extractPrice: телефон не цена', () => {
  assert.equal(extractPrice('Заказ билетов по телефону +7 (383) 287-89-17').value, null);
  assert.equal(extractPrice('Звоните: 8 800 555 35 35, спектакль для школ').value, null);
});

test('extractPrice: ИНН, ОГРН, расчётный счёт не цена', () => {
  assert.equal(extractPrice('ИНН 5402123456 руб. ООО «Театр», билеты').value, null);
  assert.equal(extractPrice('Реквизиты: ОГРН 1125476012345 руб программа').value, null);
});

test('extractPrice: число без валюты и валюта без ключевых слов — не цена', () => {
  assert.equal(extractPrice('Спектакль смотрят 300 детей и 40 взрослых').value, null);
  assert.equal(extractPrice('Наша рубашка стоит 5000 руб').reason, 'not_found');   // нет слов про билет/программу/спектакль
  assert.equal(extractPrice('Работаем с 2015 года, 120 школ, 3 города').value, null);
});

test('extractPrice: нереалистичные суммы (меньше 50 или больше 300 000 ₽) отбрасываются', () => {
  assert.equal(extractPrice('Билет 5 ₽').value, null);
  assert.equal(extractPrice('Аренда площадки под спектакль 9 000 000 ₽').value, null);
});

test('extractPrice: несколько разных цен или диапазон — «неоднозначно», цену не угадываем', () => {
  const two = extractPrice('Билет детский 300 ₽, билет взрослый 450 ₽');
  assert.equal(two.value, null);
  assert.equal(two.reason, 'ambiguous');
  assert.deepEqual(two.values.sort(), [300, 450]);
  assert.equal(extractPrice('Билет 300–500 ₽').reason, 'ambiguous');
  assert.equal(extractPrice('Стоимость программы от 300 до 500 ₽').reason, 'ambiguous');
  assert.equal(extractPrice('Просто текст без цен').reason, 'not_found');
});

/* ---------- robots.txt ---------- */
test('robotsAllowsPath: Disallow для *, Allow длиннее перекрывает, привязка $, чужие агенты игнорируются', () => {
  const robots = 'User-agent: BadBot\nDisallow: /\n\nUser-agent: *\nDisallow: /private/\nAllow: /private/open$\n';
  assert.equal(robotsAllowsPath(robots, '/show/'), true);
  assert.equal(robotsAllowsPath(robots, '/private/x'), false);
  assert.equal(robotsAllowsPath(robots, '/private/open'), true);
  assert.equal(robotsAllowsPath(robots, '/private/open2'), false);
  assert.equal(robotsAllowsPath('', '/anything'), true);
  assert.equal(robotsAllowsPath('User-agent: *\nDisallow: /', '/a'), false);
});

test('isDeniedHost: 2ГИС, VK, Яндекс, Zoon и их поддомены запрещены; обычные сайты — нет', () => {
  for (const h of ['2gis.ru', 'www.vk.ru', 'afisha.yandex.ru', 'zoon.ru', 'nsk.zoon.ru']) assert.equal(isDeniedHost(h), true, h);
  for (const h of ['playpanda.ru', 'nsk.nik-show.ru', 'unc-planetary.ru']) assert.equal(isDeniedHost(h), false, h);
  assert.ok(DENY_HOSTS.includes('2gis.ru'));
});

/* ---------- diffObserved ---------- */
test('diffObserved: изменение контента, появление / исчезновение / смена цены', () => {
  const p = { content_hash: 'a', price: { value: 300, qualifier: 'от' } };
  assert.deepEqual(diffObserved(p, { content_hash: 'a', price: { value: 300, qualifier: 'от' } }), { contentChanged: false, priceAppeared: false, priceRemoved: false, priceChanged: false });
  assert.equal(diffObserved(p, { content_hash: 'b', price: { value: 300, qualifier: 'от' } }).contentChanged, true);
  assert.equal(diffObserved(p, { content_hash: 'a', price: { value: 350, qualifier: 'от' } }).priceChanged, true);
  assert.equal(diffObserved(p, { content_hash: 'a', price: null }).priceRemoved, true);
  assert.equal(diffObserved({ content_hash: 'a' }, { content_hash: 'a', price: { value: 300 } }).priceAppeared, true);
  assert.equal(diffObserved(null, { content_hash: 'a' }).contentChanged, false);   // первая проверка — не «изменение»
});

/* ---------- buildCheck / checkItem ---------- */
const PAGE = '<html><body><h1>Шоу</h1><p>Билет от 300 ₽</p></body></html>';
const okRobots = async () => ({ ok: true, text: '' });
const item = (extra = {}) => ({ id: 'x', source_url: 'https://example.ru/show/', prices: [{ label: 'Билет', value: 300, unit: '₽/билет', source_name: 'вручную' }], ...extra });

test('buildCheck: первая проверка — ok, цена фиксируется как наблюдение confidence:low со ссылкой и датой', () => {
  const r = buildCheck(null, 'https://example.ru/show/', 200, PAGE, NOW);
  assert.equal(r.check_status, 'ok');
  assert.equal(r.observed.price.value, 300);
  assert.equal(r.observed.price.confidence, 'low');
  assert.equal(r.observed.price.source_url, 'https://example.ru/show/');
  assert.equal(r.observed.price.fetched_at, NOW);
  assert.equal(r.observed.hash_at, NOW);
});

test('buildCheck: тот же контент — ok и hash_at не сдвигается; другой контент — changed и changed_at', () => {
  const first = buildCheck(null, 'u', 200, PAGE, NOW);
  const same = buildCheck(first.observed, 'u', 200, PAGE.replace('<p>', '<p>  \n '), LATER);
  assert.equal(same.check_status, 'ok');
  assert.equal(same.observed.hash_at, NOW);
  const ch = buildCheck(first.observed, 'u', 200, PAGE.replace('300', '350'), LATER);
  assert.equal(ch.check_status, 'changed');
  assert.equal(ch.observed.changed_at, LATER);
  assert.equal(ch.observed.price.value, 350);
  assert.equal(ch.observed.prev_price.value, 300);
});

test('buildCheck: неоднозначные цены — цена не записывается, есть пояснение', () => {
  const r = buildCheck(null, 'u', 200, '<p>Билет 300 ₽ и билет 450 ₽</p>', NOW);
  assert.equal(r.observed.price, null);
  assert.match(r.observed.price_note, /несколько/);
});

test('checkItem: запрещённый robots.txt — пропуск со статусом, страница не запрашивается', async () => {
  let fetched = false;
  const res = await checkItem(item(), NOW, {
    getRobots: async () => ({ ok: true, text: 'User-agent: *\nDisallow: /show/' }),
    getPage: async () => { fetched = true; return { status: 200, html: PAGE }; }
  });
  assert.equal(res.check_status, 'robots_disallowed');
  assert.equal(fetched, false);
});

test('checkItem: 2ГИС / VK / Яндекс — skipped_policy без единого запроса', async () => {
  let touched = false;
  const deps = { getRobots: async () => { touched = true; return { ok: true, text: '' }; }, getPage: async () => { touched = true; return { status: 200, html: '' }; } };
  for (const url of ['https://2gis.ru/novosibirsk/firm/1', 'https://vk.ru/club1', 'https://afisha.yandex.ru/x']) {
    assert.equal((await checkItem(item({ source_url: url }), NOW, deps)).check_status, 'skipped_policy', url);
  }
  assert.equal(touched, false);
});

test('checkItem: сбой страницы — unavailable, прежние хеш и цена сохраняются', async () => {
  const prev = buildCheck(null, 'https://example.ru/show/', 200, PAGE, NOW).observed;
  const res = await checkItem(item({ observed: prev }), LATER, {
    getRobots: okRobots,
    getPage: async () => { throw new Error('HTTP 503'); }
  });
  assert.equal(res.check_status, 'unavailable');
  assert.equal(res.observed.content_hash, prev.content_hash);
  assert.equal(res.observed.price.value, 300);
  assert.match(res.observed.error, /503/);
  assert.equal(res.checked_at, LATER);
});

test('checkItem: недоступный robots.txt — unavailable, страница не запрашивается', async () => {
  let fetched = false;
  const res = await checkItem(item(), NOW, { getRobots: async () => ({ ok: false, error: 'таймаут' }), getPage: async () => { fetched = true; return { status: 200, html: PAGE }; } });
  assert.equal(res.check_status, 'unavailable');
  assert.equal(fetched, false);
});

test('checkItem: возвращает только новые поля — ручное значение prices не затрагивается', async () => {
  const it = item();
  const before = JSON.stringify(it.prices);
  const res = await checkItem(it, NOW, { getRobots: okRobots, getPage: async () => ({ status: 200, html: PAGE.replace('300', '999') }) });
  assert.deepEqual(Object.keys(res).sort(), ['check_status', 'checked_at', 'observed']);
  assert.equal(JSON.stringify(it.prices), before);
  assert.equal(res.observed.price.value, 999);
});

test('checkItem: битая и не-http ссылка пропускаются без исключений', async () => {
  assert.equal((await checkItem(item({ source_url: 'not a url' }), NOW, {})).check_status, 'skipped');
  assert.equal((await checkItem(item({ source_url: 'ftp://example.ru/x' }), NOW, {})).check_status, 'skipped');
});

/* ---------- Реальный файл ---------- */
test('data/competitors.json: новые поля корректны, ручные цены с провенансом не затронуты', () => {
  const d = JSON.parse(readFileSync(new URL('../data/competitors.json', import.meta.url), 'utf-8'));
  const ok = new Set(['ok', 'changed', 'unavailable', 'robots_disallowed', 'skipped_policy', 'skipped']);
  for (const key of ['outbound_performers', 'studio_scene', 'party_venues', 'stationary_benchmarks']) {
    for (const x of d[key]) {
      if (x.check_status !== undefined) { assert.ok(ok.has(x.check_status), x.id); assert.ok(x.checked_at, x.id); }
      if (x.observed && x.observed.price) {
        assert.equal(x.observed.price.confidence, 'low', x.id);
        assert.ok(x.observed.price.source_url && x.observed.price.fetched_at, x.id);
      }
      for (const p of x.prices || []) assert.ok(p.source_name && p.fetched_at && p.confidence, x.id);
    }
  }
});
