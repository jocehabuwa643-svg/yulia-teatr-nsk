/* live-data.js — уровень B живых данных: индикатор «Обновлено», кнопка «Обновить сейчас»,
   cache-busting по meta.json, попытка живых значений Банка России напрямую из браузера
   (только если ЦБ отдаёт CORS — иначе тихий fallback на сохранённые data/*.json, как требует
   правило «не выдумывать»). Самоподключаемый модуль. */
(function () {
  'use strict';
  var PFX = 'yulia.v2.';

  function lsGet(k, f) { try { var v = localStorage.getItem(PFX + k); return v === null ? f : JSON.parse(v); } catch (e) { return f; } }
  function lsSet(k, v) { try { localStorage.setItem(PFX + k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fmtDateTime(iso) {
    try { return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return '—'; }
  }

  /* Живые курсы ЦБ: официальный XML_daily. Отдаёт ли ЦБ CORS с чужого origin — проверяем
     честной попыткой; при отказе остаёмся на ночном data-refresh. */
  function fetchCbrLive() {
    var d = new Date();
    var dateReq = String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
    return fetch('https://www.cbr.ru/scripts/XML_daily.asp?date_req=' + dateReq, { signal: AbortSignal.timeout(8000) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (xml) {
        var m = xml.match(/<CharCode>USD<\/CharCode>[\s\S]*?<Value>([\d,]+)<\/Value>/);
        if (!m) throw new Error('no USD');
        return { usd: parseFloat(m[1].replace(',', '.')) };
      });
  }

  function setLine(box, text, extra) {
    box.innerHTML = text + (extra ? ' · <span class="tiny">' + extra + '</span>' : '');
  }

  function init() {
    var anchor = document.getElementById('dataStatus');
    if (!anchor || document.getElementById('liveDataBtn')) return;

    var box = document.createElement('div');
    box.id = 'liveDataBox';
    box.style.cssText = 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:6px';
    var info = document.createElement('span');
    info.className = 'tiny';
    info.id = 'liveDataInfo';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn small secondary';
    btn.id = 'liveDataBtn';
    btn.innerHTML = '⟳ Обновить сейчас';
    btn.setAttribute('aria-label', 'Обновить данные сейчас');
    box.appendChild(info); box.appendChild(btn);
    anchor.insertAdjacentElement('afterend', box);

    function paint(staleReason) {
      var meta = lsGet('liveMeta', null);
      var txt = meta ? 'Курсы и данные: сохранены ' + fmtDateTime(meta.savedAt) : 'Данные: из последнего релиза сайта';
      if (meta && meta.live) txt += ' · живой курс ЦБ: ' + meta.usd + ' ₽/$';
      setLine(info, txt, staleReason || undefined);
    }
    paint();

    btn.addEventListener('click', function () {
      btn.disabled = true;
      setLine(info, 'Обновляю…');
      var bust = '?t=' + Date.now();
      Promise.all([
        fetch('data/meta.json' + bust, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }),
        fetch('data/rates.json' + bust, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }),
        fetchCbrLive().then(function (v) { return { live: true, usd: v.usd }; }).catch(function () { return { live: false }; })
      ]).then(function (res) {
        var meta = res[0], rates = res[1], live = res[2];
        var saved = { savedAt: new Date().toISOString() };
        if (rates && rates.cbr) {
          if (live.live) {
            rates.cbr.usd_rub.value = live.usd;
            rates.cbr.usd_rub.fetched_at = saved.savedAt.slice(0, 10);
            saved.usd = live.usd;
            saved.live = true;
          } else if (rates.cbr.usd_rub && rates.cbr.usd_rub.value != null) {
            saved.usd = rates.cbr.usd_rub.value;
          }
        }
        if (meta && meta.generated_at) saved.generatedAt = meta.generated_at;
        lsSet('liveMeta', saved);
        var why = live.live ? 'живой запрос к cbr.ru' : 'ЦБ без CORS — показаны данные ночного обновления';
        paint(why);
        var t = document.createElement('div'); t.className = 'toast show'; t.textContent = 'Данные обновлены'; document.body.appendChild(t);
        setTimeout(function () { t.remove(); }, 2200);
      }).catch(function () {
        paint('не удалось обновить — проверьте сеть');
      }).then(function () { btn.disabled = false; });
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else setTimeout(init, 400);
  }
})();
