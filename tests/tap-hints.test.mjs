/* tests/tap-hints.test.mjs — чистая логика «обхода пальцем» (js/ui/tap-hints.js) без DOM: искусственные объекты-элементы. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSweepTarget, stableKey, pushDone, sweepOrder, dedupeNested, limitTargets, pickTargets, inSafeArea, clipRect, visiblePart, fingerPoint,
  nextRepeatDelay, shouldSweep, isBlocked, isCalm, MAX_TARGETS, SIZE, TIP_X, TIP_Y, REPEAT_MIN, REPEAT_MAX, DONE_MAX
} from '../js/ui/tap-hints.js';

/* Искусственный элемент: tag, classes, attrs, inside — список «предков» (селекторов/классов), в которых он лежит.
   closest(sel) истинно, если какой-то из токенов селектора входит в inside (или это сам элемент по классу). */
const fake = (o = {}) => {
  const classes = o.cls || [], attrs = o.attrs || {}, inside = o.inside || ['#main'];
  const tokens = sel => sel.split(',').map(s => s.trim());
  const selfTok = [...classes.map(c => '.' + c), ...(o.tag ? [o.tag] : []), ...(attrs['aria-hidden'] === 'true' ? ['[aria-hidden="true"]'] : [])];
  return {
    isConnected: o.connected !== false,
    tagName: (o.tag || 'div').toUpperCase(),
    disabled: o.disabled,
    classList: { contains: c => classes.includes(c), length: classes.length },
    textContent: o.text || '',
    querySelector: () => (o.check ? {} : null),
    parentElement: o.parentText === undefined ? null : { textContent: o.parentText },
    getAttribute: n => (n in attrs ? attrs[n] : null),
    closest: sel => (tokens(sel).some(t => inside.includes(t) || selfTok.includes(t)) ? {} : null)
  };
};

test('isSweepTarget: кнопки, summary, вкладки, режимы, карточки — да', () => {
  assert.equal(isSweepTarget(fake({ tag: 'button' })), true);
  assert.equal(isSweepTarget(fake({ tag: 'summary' })), true);
  assert.equal(isSweepTarget(fake({ tag: 'div', attrs: { role: 'tab' } })), true);
  assert.equal(isSweepTarget(fake({ tag: 'div', attrs: { role: 'button' } })), true);
  assert.equal(isSweepTarget(fake({ tag: 'div', cls: ['pc-card'] })), true);
  assert.equal(isSweepTarget(fake({ tag: 'button', cls: ['mode'] })), true);
  assert.equal(isSweepTarget(fake({ tag: 'button', cls: ['tab'] })), true);
  assert.equal(isSweepTarget(fake({ tag: 'button', cls: ['mmode'] })), true);
  assert.equal(isSweepTarget(fake({ tag: 'label', cls: ['btn'] })), true);       // импорт файла
  assert.equal(isSweepTarget(fake({ tag: 'a', cls: ['btn'], attrs: { href: '#x' } })), true);
  assert.equal(isSweepTarget(fake({ tag: 'a', cls: ['chip'], attrs: { href: '#x' } })), true);
});

test('isSweepTarget: метки и не-кнопки — нет', () => {
  assert.equal(isSweepTarget(fake({ tag: 'span', cls: ['chip'] })), false);       // span.chip — метка
  assert.equal(isSweepTarget(fake({ tag: 'div' })), false);
  assert.equal(isSweepTarget(fake({ tag: 'label' })), false);                      // обычная подпись поля
  assert.equal(isSweepTarget(fake({ tag: 'label', check: true })), true);          // строка-чекбокс чек-листа
  assert.equal(isSweepTarget(fake({ tag: 'a' })), false);                          // якорь без href
  assert.equal(isSweepTarget(null), false);
});

test('isSweepTarget: inline-ссылка в тексте — нет, кнопкоподобная в тексте — да', () => {
  assert.equal(isSweepTarget(fake({ tag: 'a', attrs: { href: 'https://x' }, inside: ['#main', 'p'] })), false);
  assert.equal(isSweepTarget(fake({ tag: 'a', attrs: { href: 'https://x' }, inside: ['#main', 'li'] })), false);
  assert.equal(isSweepTarget(fake({ tag: 'a', attrs: { href: 'https://x' }, inside: ['#main', 'small'] })), false);
  assert.equal(isSweepTarget(fake({ tag: 'a', cls: ['btn'], attrs: { href: 'https://x' }, inside: ['#main', 'p'] })), true);   // «Источник» с .btn
  assert.equal(isSweepTarget(fake({ tag: 'a', attrs: { href: 'https://x' }, inside: ['#main'] })), true);                      // ссылка-кнопка вне абзаца
  // inline-ссылка среди текста абзаца — нет; ссылка-строка списка (весь текст — ссылка) — да
  const inl = { tag: 'a', attrs: { href: 'https://x' }, inside: ['#main', 'p'], text: 'источник' };
  assert.equal(isSweepTarget(fake({ ...inl, parentText: 'Взносы считаются по ставке за год, подробности — источник' })), false);
  // ссылка-компонент со своим классом в списке (заголовок события + заметка рядом) — да
  assert.equal(isSweepTarget(fake({ ...inl, cls: ['td-link'], inside: ['#main', 'li'], parentText: 'Заголовок события дата — ориентир' })), true);
  assert.equal(isSweepTarget(fake({ ...inl, text: 'Новость дня: приём заявок', parentText: 'Новость дня: приём заявок', inside: ['#main', 'li'] })), true);
});

test('isSweepTarget: служебное, скрытое, отключённое — нет', () => {
  for (const inside of [['#main', '#veil'], ['#main', '#topbar'], ['#main', '#mobnav'], ['#main', '.newsflash'], ['#main', '.leaflet-container'],
    ['#main', '[inert]'], ['#main', '[hidden]'], ['#main', 'dialog'], ['#main', '.tap-finger']]) {
    assert.equal(isSweepTarget(fake({ tag: 'button', inside })), false, inside.join(' '));
  }
  assert.equal(isSweepTarget(fake({ tag: 'button', cls: ['skip'] })), false);                       // скип-ссылка
  assert.equal(isSweepTarget(fake({ tag: 'button', attrs: { 'aria-hidden': 'true' } })), false);
  assert.equal(isSweepTarget(fake({ tag: 'button', disabled: true })), false);
  assert.equal(isSweepTarget(fake({ tag: 'button', attrs: { 'aria-disabled': 'true' } })), false);
  assert.equal(isSweepTarget(fake({ tag: 'button', connected: false })), false);
  assert.equal(isSweepTarget(fake({ tag: 'button', inside: [] })), false);                          // вне #main (шапка/подвал)
});

test('stableKey: путь + текст, числа обезличены, длина ограничена', () => {
  assert.equal(stableKey('#guideTabs>button.tab', 'Шаблоны'), '#guideTabs>button.tab|Шаблоны');
  assert.equal(stableKey('#a', '  Показать   ещё 12 '), '#a|Показать ещё #');
  assert.equal(stableKey('#a', 'Показать ещё 12'), stableKey('#a', 'Показать ещё 7'));
  assert.ok(stableKey('#a', 'x'.repeat(100)).length <= '#a|'.length + 30);
  assert.equal(stableKey(undefined, undefined), '|');
});

test('pushDone: без дублей, максимум 200 — остаются последние', () => {
  assert.deepEqual(pushDone(['a', 'b'], 'a'), ['b', 'a']);
  assert.deepEqual(pushDone(null, 'a'), ['a']);
  let list = [];
  for (let i = 0; i < 250; i++) list = pushDone(list, 'k' + i);
  assert.equal(list.length, DONE_MAX);
  assert.equal(DONE_MAX, 200);
  assert.equal(list[0], 'k50');
  assert.equal(list.at(-1), 'k249');
});

test('sweepOrder: сверху вниз, в строке — слева направо', () => {
  const b = (id, left, top, w = 80, h = 44) => ({ id, left, top, width: w, height: h });
  // две строки; в первой элементы чуть «гуляют» по top (в пределах половины высоты)
  const items = [b('c', 200, 110), b('a', 10, 100), b('d', 10, 200), b('b', 105, 104), b('e', 105, 202)];
  assert.deepEqual(sweepOrder(items).map(x => x.id), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(sweepOrder([]), []);
  // разные строки не склеиваются
  assert.deepEqual(sweepOrder([b('x', 300, 0), b('y', 0, 60)]).map(x => x.id), ['x', 'y']);
});

test('dedupeNested: внутренняя цель выбрасывается, внешняя остаётся', () => {
  const outer = { id: 'o', kids: ['i'] }, inner = { id: 'i', kids: [] }, other = { id: 'z', kids: [] };
  const res = dedupeNested([outer, inner, other], (a, b) => a.kids.includes(b.id));
  assert.deepEqual(res.map(x => x.id), ['o', 'z']);
});

test('limitTargets: не больше 14, первые по порядку', () => {
  const list = Array.from({ length: 30 }, (_, i) => i);
  assert.equal(MAX_TARGETS, 14);
  assert.deepEqual(limitTargets(list), list.slice(0, 14));
  assert.deepEqual(limitTargets([1, 2]), [1, 2]);
});

test('pickTargets: при переполнении сначала не показанные, порядок обхода сохраняется', () => {
  const ordered = Array.from({ length: 17 }, (_, i) => ({ key: 'k' + i }));
  assert.equal(pickTargets(ordered, new Map()).length, 14);
  assert.deepEqual(pickTargets(ordered, new Map()).map(t => t.key), ordered.slice(0, 14).map(t => t.key));
  // первые 14 уже показаны → в обход попадают 3 оставшихся + 11 первых, в исходном порядке
  const swept = new Map(ordered.slice(0, 14).map(t => [t.key, 1]));
  const res = pickTargets(ordered, swept).map(t => t.key);
  assert.equal(res.length, 14);
  assert.ok(['k14', 'k15', 'k16'].every(k => res.includes(k)));
  assert.deepEqual(res, [...res].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
  assert.equal(pickTargets(ordered.slice(0, 5), swept).length, 5);
});

test('inSafeArea: только целиком внутри', () => {
  const safe = { left: 2, right: 358, top: 60, bottom: 600 };
  assert.equal(inSafeArea({ left: 10, right: 100, top: 100, bottom: 144 }, safe), true);
  assert.equal(inSafeArea({ left: 10, right: 100, top: 40, bottom: 84 }, safe), false);   // под шапкой
  assert.equal(inSafeArea({ left: 10, right: 100, top: 580, bottom: 624 }, safe), false); // торчит снизу
  assert.equal(inSafeArea({ left: -5, right: 100, top: 100, bottom: 144 }, safe), false);
});

test('clipRect / visiblePart: вкладка у края экрана — по горизонтали ≥60%, по вертикали целиком', () => {
  const safe = { left: 2, right: 358, top: 60, bottom: 700 };
  const clip = clipRect({ left: 280, right: 400, top: 100, bottom: 144, width: 120, height: 44 }, safe);
  assert.deepEqual([clip.left, clip.right, clip.width], [280, 358, 78]);
  assert.equal(clipRect({ left: 400, right: 500, top: 100, bottom: 144 }, safe), null);
  const mk = (left, w, top = 100, h = 44) => ({ left, right: left + w, top, bottom: top + h, width: w, height: h });
  assert.ok(visiblePart(mk(280, 120), safe));                         // видно 78/120 = 65% — берём
  assert.equal(visiblePart(mk(320, 120), safe), null);                // видно 38/120 — нет
  assert.equal(visiblePart(mk(20, 100, 40), safe), null);             // под шапкой по вертикали — нет
  assert.ok(visiblePart(mk(20, 100), safe));
});

test('fingerPoint: правая нижняя треть, палец целиком в окне, кончик на кнопке', () => {
  const r = { left: 20, top: 200, width: 200, height: 44 };
  const p = fingerPoint(r, { vw: 360, vh: 640 });
  assert.equal(p.inside, true);
  assert.ok(Math.abs(p.x - (20 + 200 * 0.72)) < 0.01);
  assert.ok(Math.abs(p.y - (200 + 44 * 0.68)) < 0.01);
  assert.ok(Math.abs(p.tx - (p.x - SIZE * TIP_X)) < 1e-9 && Math.abs(p.ty - (p.y - SIZE * TIP_Y)) < 1e-9);
  // рука целиком в окне
  assert.ok(p.tx >= 0 && p.tx + SIZE <= 360 && p.ty >= 0 && p.ty + SIZE <= 640);
});

test('fingerPoint: узкие — по центру, широкие — у правого края, у края окна — внутрь', () => {
  const narrow = fingerPoint({ left: 100, top: 100, width: 44, height: 44 }, { vw: 360, vh: 640 });
  assert.ok(Math.abs(narrow.x - 122) < 0.01);
  const wide = fingerPoint({ left: 10, top: 100, width: 600, height: 48 }, { vw: 1280, vh: 800 });
  assert.ok(wide.x > 10 + 600 - 120 && wide.x <= 610 - 10);
  // кнопка у правого края окна: палец сдвинут внутрь, но кончик остаётся на кнопке
  const edge = fingerPoint({ left: 300, top: 100, width: 56, height: 44 }, { vw: 360, vh: 640 });
  assert.ok(edge.tx + SIZE <= 360 - 6 + 1e-9);
  assert.equal(edge.inside, edge.x >= 300 && edge.x <= 356);
});

test('fingerPoint: кнопка у нижнего края — inside=false (рука не помещается), не врём', () => {
  const p = fingerPoint({ left: 20, top: 590, width: 200, height: 44 }, { vw: 360, vh: 640 });
  assert.equal(p.inside, false);
  assert.ok(p.ty + SIZE <= 640);                                   // рука всё равно внутри окна
});

test('fingerPoint: большая карточка — касание в области подписи действия (anchor)', () => {
  const card = { left: 16, top: 300, width: 320, height: 220 };
  const anchor = { left: 300, top: 312, width: 20, height: 20 };
  const p = fingerPoint(card, { vw: 360, vh: 800, anchor });
  assert.ok(Math.abs(p.x - 310) < 0.01 && Math.abs(p.y - 322) < 0.01);
  assert.equal(p.inside, true);
  // без anchor у высокой цели касание у нижней кромки, а не по центру текста
  const q = fingerPoint(card, { vw: 360, vh: 800 });
  assert.ok(q.y > 300 + 220 * 0.7);
});

test('fingerPoint: не заходит под липкую шапку', () => {
  const p = fingerPoint({ left: 10, top: 62, width: 200, height: 44 }, { vw: 360, vh: 640, safeTop: 64 });
  assert.ok(p.ty >= 64 - 1e-9 || p.inside === false);
});

test('nextRepeatDelay: 8–12 секунд', () => {
  assert.equal(nextRepeatDelay(0), REPEAT_MIN);
  assert.equal(nextRepeatDelay(0.999999), REPEAT_MAX);
  assert.equal(nextRepeatDelay(0.5), 10000);
  for (let i = 0; i < 200; i++) { const d = nextRepeatDelay(); assert.ok(d >= 8000 && d <= 12000); }
});

test('shouldSweep: новые цели → сразу; повтор по таймеру; вход в раздел; пусто → нет', () => {
  const t = [{ key: 'a' }, { key: 'b' }];
  const base = { now: 100000, nextRepeatAt: 200000, targets: t, swept: new Map(), entered: false };
  assert.equal(shouldSweep(base), true);                                         // ничего не показывали
  assert.equal(shouldSweep({ ...base, targets: [] }), false);
  const all = new Map([['a', 99000], ['b', 99500]]);
  assert.equal(shouldSweep({ ...base, swept: all }), false);                     // всё недавно показано, повтор не пора
  assert.equal(shouldSweep({ ...base, swept: all, now: 200001 }), true);         // пора повторять
  assert.equal(shouldSweep({ ...base, swept: all, entered: true }), false);      // вошла, но показано <6 с назад
  assert.equal(shouldSweep({ ...base, swept: new Map([['a', 50000], ['b', 99500]]), entered: true }), true);   // вошла, одна цель «остыла»
  assert.equal(shouldSweep({ ...base, swept: new Map([['a', 99000]]) }), true);  // появилась новая кнопка b
});

test('isBlocked: любой флаг блокирует', () => {
  assert.equal(isBlocked({}), false);
  for (const k of ['hidden', 'veil', 'reduced', 'typing', 'dialog', 'news', 'pointerDown']) assert.equal(isBlocked({ [k]: true }), true, k);
});

test('isCalm: прокрутка требует 600 мс покоя, перестройка DOM — 300 мс', () => {
  assert.equal(isCalm(1000, 500, 0, false), false);
  assert.equal(isCalm(1100, 500, 0, false), true);
  assert.equal(isCalm(2000, 0, 1900, true), false);
  assert.equal(isCalm(2000, 0, 1600, true), true);
  assert.equal(isCalm(2000, 0, 1900, false), true);
});
