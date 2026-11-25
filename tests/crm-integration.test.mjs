/* Мини-CRM площадок: связка вкладки «Мои площадки» с подразделом «Клиенты и площадки» и картой (статические проверки
   исходников — без браузера). Логика данных — в tests/crm.test.mjs. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const view = read('js/clients-view.js');
const map = read('js/client-map.js');
const ui = read('js/crm-ui.js');
const css = read('css/restructure.css');

test('подраздел: вкладка «Мои площадки» рядом с картой, место общее с картой', () => {
  assert.match(view, /\['list', '[a-z-]+', 'Мои площадки'\]/);
  assert.match(view, /id="clPane-list"/);
  assert.match(view, /from '\.\/crm-ui\.js'/);
  assert.match(view, /setCrmPlace\(p,/);                       // смена места на карте — и в списке
  assert.match(view, /onPlace: id => renderPlace\(id\)/);       // смена места в списке — и на карте
});

test('Esc: подсказка точки → карточка площадки → подраздел (по шагам)', () => {
  assert.match(view, /crmCardOpen\(\)\) closeCrmCard\(\)/);
});

test('карта: статус точки не только цветом — легенда и значок ✓ для «Договорились», кнопка «Открыть карточку»', () => {
  for (const id of ['sent', 'talks', 'deal', 'refused']) assert.match(map, new RegExp(`crm-st-${id}`));
  assert.match(map, /crm-dealmark/);
  assert.match(map, /Открыть карточку/);
  assert.match(map, /renderer/);                                // точки по-прежнему на canvas
});

test('список: не больше 200 строк за раз, дальше — «Показать ещё»; хранение через store (yulia.v2.crm)', () => {
  assert.match(ui, /const PAGE = 200/);
  assert.match(ui, /Показать ещё/);
  assert.match(ui, /store\.get\(STORE_KEY/);
  assert.doesNotMatch(ui, /localStorage\.(get|set)Item/);
});

test('стили: обозначения всех статусов, подписи кнопок экспорта/импорта видны на телефоне, reduced-motion', () => {
  for (const id of ['sent', 'talks', 'deal', 'refused']) assert.match(css, new RegExp(`\.crm-dot\.crm-st-${id}\{`));
  assert.match(css, /\.crm-iob span,\.crm-onmap span\{display:inline!important\}/);
  assert.match(css, /\.crm-sb\{[^}]*min-height:48px/);
  assert.match(css, /prefers-reduced-motion:reduce\)\{\s*\.crm-toast/);
});
