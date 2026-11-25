/* live-data.js — кнопка «Обновить данные» в hero (p#dataStatus).
   По нажатию заново читает ВСЕ data/*.json мимо кэшей (loadAll({ fresh:true }) из data-loader.js: ?t=… и cache:'reload'),
   сравнивает «отпечаток» свежести с тем, что уже на экране, и:
   • пришло новое — коротко называет, что именно (курсы ЦБ, новости, клиенты…), и перезагружает страницу, чтобы все
     разделы перерисовались из новых файлов (обычная загрузка идёт с cache:'no-cache' и сверяет каждый файл с сервером по ETag);
   • нового нет — честно пишет «данные актуальны» и дату последней проверки;
   • сеть недоступна — спокойная подпись «Работа в офлайн-режиме · данные от 23 ноября» (или «Данные от … · обновятся
     автоматически», если интернет есть, а сервер не ответил); на экране остаются прежние данные.
   Здесь же — общие чистые функции сетевых подписей (fmtDayMonth, dataDateOf, savedDataDate, networkNotice): ими пользуются
   data-loader.js (тост при загрузке) и pwa.js (офлайн-плашка), чтобы все сообщения о сети говорили одно и то же.
   Курсы ЦБ напрямую из браузера не запрашиваются: cbr.ru не разрешает такие запросы с чужих сайтов (CORS), попытка
   только тянула время. Курсы обновляет ежедневный workflow Data refresh.
   Из статических импортов — только геометрия иконок (js/ui/icon-data.js, чистые данные): data-loader.js и state.js подгружаются при нажатии, поэтому чистые функции
   (dataSignature, signatureChanges) импортируются в тестах Node без браузера. Запуск — initLiveData() из js/app.js. */
import { ICON_DATA } from './ui/icon-data.js';

var PFX = 'yulia.v2.';

function lsGet(k, f) { try { var v = localStorage.getItem(PFX + k); return v === null ? f : JSON.parse(v); } catch (e) { return f; } }
function lsSet(k, v) { try { localStorage.setItem(PFX + k, JSON.stringify(v)); } catch (e) { /* приватный режим — не критично */ } }

/* Дата и время по-русски: «21.11, 14:05» */
function fmtDateTime(iso) {
  var d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/* ---------- Отпечаток свежести (чистые функции) ---------- */

/* Самая поздняя дата checked_at среди конкурентов (недельная проверка сайтов) */
function latestCompetitorCheck(comp) {
  if (!comp) return null;
  var best = null;
  ['outbound_performers', 'studio_scene', 'party_venues', 'stationary_benchmarks'].forEach(function (k) {
    (Array.isArray(comp[k]) ? comp[k] : []).forEach(function (x) {
      if (x && x.checked_at && (!best || x.checked_at > best)) best = x.checked_at;
    });
  });
  return best;
}

/* Отпечаток: по одной метке на каждый автообновляемый блок. Меняется метка — значит, пришли новые данные этого блока */
export function dataSignature(data) {
  var d = data || {};
  var cbr = (d.rates && d.rates.cbr) || {};
  var usd = cbr.usd_rub || {};
  var eur = cbr.eur_rub || {};
  return {
    release: (d.meta && d.meta.generated_at) || null,
    cbr: [usd.value, usd.valid_from, eur.value, eur.valid_from, usd.stale === true || eur.stale === true].join('|'),
    news: (d.news && [d.news.updated_at, Array.isArray(d.news.items) ? d.news.items.length : 0, d.news.stale === true].join('|')) || null,
    leads: (d.leads && [d.leads.updated_at, d.leads.stale === true].join('|')) || null,
    competitors: latestCompetitorCheck(d.competitors)
  };
}

var LABELS = { cbr: 'курсы ЦБ', news: 'новости', leads: 'клиенты и площадки', competitors: 'проверка конкурентов' };

/* Что поменялось между отпечатками: список понятных названий. Только release без остального — «справочные данные» */
export function signatureChanges(before, after) {
  var a = before || {}, b = after || {};
  var out = Object.keys(LABELS).filter(function (k) { return (a[k] || null) !== (b[k] || null); }).map(function (k) { return LABELS[k]; });
  if (!out.length && (a.release || null) !== (b.release || null)) out.push('справочные данные');
  return out;
}

/* Когда данные последний раз проверялись автоматически: meta.checked_at (метка ежедневного прогона), иначе generated_at */
export function lastCheckedAt(data) {
  var m = (data && data.meta) || {};
  var c = Date.parse(m.checked_at || ''), g = Date.parse(m.generated_at || '');
  var t = Math.max(Number.isFinite(c) ? c : -Infinity, Number.isFinite(g) ? g : -Infinity);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/* ---------- Сетевые подписи (чистые функции) ---------- */

/* Месяцы в родительном падеже: «23 ноября». Свой список, а не toLocaleDateString — одинаково в любом браузере и в Node */
var MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/* Дата по-русски в местном времени: «23 ноября»; другой год — «23 ноября 2025». Нет даты или мусор → '' */
export function fmtDayMonth(t, now) {
  var ms = typeof t === 'number' ? t : Date.parse(t || '');
  if (!Number.isFinite(ms)) return '';
  var d = new Date(ms), n = new Date(Number.isFinite(now) ? now : Date.now());
  var s = d.getDate() + ' ' + MONTHS_GEN[d.getMonth()];
  return d.getFullYear() === n.getFullYear() ? s : s + ' ' + d.getFullYear();
}

/* Дата последнего успешного обновления данных (мс UTC): самая поздняя из meta.generated_at, meta.checked_at и news.updated_at —
   те же метки, что в строке свежести блока «Сегодня». Нет ни одной → null */
export function dataDateOf(data) {
  var d = data || {}, m = d.meta || {}, n = d.news || {};
  var best = null;
  [m.generated_at, m.checked_at, n.updated_at].forEach(function (s) {
    var t = Date.parse(s || '');
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  });
  return best;
}

/* Дата данных, сохранённых после последней удачной загрузки: data-loader.js кладёт каждый файл в localStorage
   под ключом yulia.v2.data.v2.<имя> ({ t, d }). Хранилище недоступно или пусто → null */
export function savedDataDate(storage) {
  function read(name) {
    try { var v = JSON.parse(storage.getItem(PFX + 'data.v2.' + name) || 'null'); return v && v.d ? v.d : null; } catch (e) { return null; }
  }
  if (!storage) return null;
  return dataDateOf({ meta: read('meta'), news: read('news') });
}

/* Спокойная подпись о сети — без «ошибок» и восклицаний, данные на экране рабочие:
   'offline'      — интернета нет: «Работа в офлайн-режиме · данные от 23 ноября»;
   'stale'        — интернет есть, но сервер/файлы не ответили: «Данные от 23 ноября · обновятся автоматически»;
   'news-partial' — часть лент новостей не ответила: «Часть новостей обновится позже» (тост для этого не нужен — подпись для блоков);
   иное — пустая строка (показывать нечего) */
export function networkNotice(kind, date, now) {
  var when = fmtDayMonth(date, now);
  if (kind === 'offline') return 'Работа в офлайн-режиме · ' + (when ? 'данные от ' + when : 'показаны сохранённые данные');
  if (kind === 'stale') return when ? 'Данные от ' + when + ' · обновятся автоматически' : 'Данные обновятся автоматически';
  if (kind === 'news-partial') return 'Часть новостей обновится позже';
  return '';
}

/* Нет интернета по мнению браузера (в Node и старых браузерах — считаем, что сеть есть) */
export function browserOffline() {
  try { return typeof navigator !== 'undefined' && navigator.onLine === false; } catch (e) { return false; }
}

/* Иконка «обновить» (Lucide refresh-cw из js/ui/icon-data.js) — настоящий SVG вместо текстового символа «стрелка по кругу» (U+27F3),
   которого нет в части шрифтов (на телефонах он рисовался пустым квадратом) */
function refreshIcon() {
  var NS = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(NS, 'svg');
  var frame = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: 'lucide lucide-refresh-cw' };
  Object.keys(frame).forEach(function (k) { svg.setAttribute(k, frame[k]); });
  (ICON_DATA['refresh-cw'] || []).forEach(function (p) {
    var el = document.createElementNS(NS, p[0]);
    Object.keys(p[1]).forEach(function (k) { el.setAttribute(k, p[1][k]); });
    svg.appendChild(el);
  });
  return svg;
}

/* ---------- Интерфейс ---------- */

function toastOnce(text) {
  var t = document.createElement('div');
  t.className = 'toast show';
  t.setAttribute('role', 'status');
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(function () { t.remove(); }, 2600);
}

export function initLiveData() {
  var anchor = document.getElementById('dataStatus');
  if (!anchor || document.getElementById('liveDataBtn')) return;

  // span, а не div: контейнер — абзац p#dataStatus
  var box = document.createElement('span');
  box.id = 'liveDataBox';
  box.style.cssText = 'display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap';
  var info = document.createElement('span');
  info.className = 'tiny';
  info.id = 'liveDataInfo';
  info.setAttribute('aria-live', 'polite');
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn small secondary';
  btn.id = 'liveDataBtn';
  var label = document.createElement('span');
  label.textContent = 'Обновить данные';
  btn.appendChild(refreshIcon());
  btn.appendChild(label);
  btn.setAttribute('aria-label', 'Обновить данные сейчас');
  box.appendChild(info); box.appendChild(btn);
  anchor.textContent = '';
  anchor.appendChild(box);

  function say(text) { info.hidden = !text; info.textContent = text || ''; }

  // После перезагрузки из-за новых данных — короткое подтверждение, что именно обновилось (один раз)
  var after = lsGet('liveAfterReload', null);
  if (after && after.at && Date.now() - Date.parse(after.at) < 60000) {
    say('Обновлено: ' + after.what + ' · ' + fmtDateTime(after.at));
  } else {
    say('');
  }
  lsSet('liveAfterReload', null);

  // Офлайн-файл: данные вшиты сборкой, перечитывать нечего — говорим об этом прямо
  if (typeof window !== 'undefined' && window.__YULIA_DATA__) {
    btn.addEventListener('click', function () { say('В офлайн-файле данные вшиты на дату сборки. Свежие — на сайте.'); });
    return;
  }

  // Сбой обновления: прежние данные остаются на экране, подпись — спокойная, с датой этих данных
  var shownDate = null;
  function sayNetwork() {
    say(networkNotice(browserOffline() ? 'offline' : 'stale', shownDate));
  }

  btn.addEventListener('click', function () {
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    say('Обновляю…');
    Promise.all([import('./data-loader.js'), import('./state.js')]).then(function (mods) {
      var loadAll = mods[0].loadAll, state = mods[1].state;
      shownDate = dataDateOf(state.DATA);
      var before = dataSignature(state.DATA);
      return loadAll({ fresh: true }).then(function (fresh) {
        // Обязательные файлы не пришли (нет сети или сервер не ответил): экран не трогаем
        if (fresh.health && fresh.health.errors && fresh.health.errors.length) {
          sayNetwork();
          return;
        }
        var changes = signatureChanges(before, dataSignature(fresh));
        var checked = lastCheckedAt(fresh);
        lsSet('liveMeta', { savedAt: new Date().toISOString(), checkedAt: checked });
        if (!changes.length) {
          say('Данные актуальны' + (checked ? ' · проверены ' + fmtDateTime(checked) : ''));
          toastOnce('Новых данных нет — всё актуально');
          return;
        }
        // Новое есть: запоминаем, что именно, и перерисовываем страницу целиком из обновлённых файлов
        lsSet('liveAfterReload', { at: new Date().toISOString(), what: changes.join(', ') });
        say('Пришли новые данные: ' + changes.join(', ') + '. Обновляю страницу…');
        setTimeout(function () { location.reload(); }, 900);
      });
    }).catch(function () {
      sayNetwork();
    }).then(function () { btn.disabled = false; btn.removeAttribute('aria-busy'); });
  });
}
