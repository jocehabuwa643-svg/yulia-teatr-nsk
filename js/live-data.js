/* live-data.js — кнопка «Обновить данные» в hero (p#dataStatus).
   По нажатию заново читает ВСЕ data/*.json мимо кэшей (loadAll({ fresh:true }) из data-loader.js: ?t=… и cache:'reload'),
   сравнивает «отпечаток» свежести с тем, что уже на экране, и:
   • пришло новое — коротко называет, что именно (курсы ЦБ, новости, клиенты…), и перезагружает страницу, чтобы все
     разделы перерисовались из новых файлов (обычная загрузка идёт с cache:'no-cache' и сверяет каждый файл с сервером по ETag);
   • нового нет — честно пишет «данные актуальны» и дату последней проверки;
   • сеть недоступна — «не удалось обновить», на экране остаются прежние данные.
   Курсы ЦБ напрямую из браузера не запрашиваются: cbr.ru не разрешает такие запросы с чужих сайтов (CORS), попытка
   только тянула время. Курсы обновляет ежедневный workflow Data refresh.
   Модуль без статических импортов: data-loader.js и state.js подгружаются при нажатии, поэтому чистые функции
   (dataSignature, signatureChanges) импортируются в тестах Node без браузера. Запуск — initLiveData() из js/app.js. */
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
  btn.textContent = '⟳ Обновить данные';
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

  btn.addEventListener('click', function () {
    btn.disabled = true;
    say('Обновляю…');
    Promise.all([import('./data-loader.js'), import('./state.js')]).then(function (mods) {
      var loadAll = mods[0].loadAll, state = mods[1].state;
      var before = dataSignature(state.DATA);
      return loadAll({ fresh: true }).then(function (fresh) {
        // Обязательные файлы не пришли — значит, нет сети: экран не трогаем
        if (fresh.health && fresh.health.errors && fresh.health.errors.length) {
          say('Не удалось обновить — проверьте интернет. На экране прежние данные.');
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
      say('Не удалось обновить — проверьте интернет. На экране прежние данные.');
    }).then(function () { btn.disabled = false; });
  });
}
