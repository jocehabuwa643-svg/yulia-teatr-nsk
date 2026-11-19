/* market.js — раздел «Навигатор рынка»: конкуренты, спрос, сезонность, образовательная сеть. */
import { $, $$, fmt, ic, table, toast, store } from './ui/helpers.js';

export function initMarket(cfg, competitors, market) {
  const cards = [
    ...competitors.outbound_performers.map(c => ({ icon: 'drama', t: c.name, d: `${c.status === 'public' ? 'Публичное предложение' : c.status === 'historical' ? 'Подтверждённый прошлый выезд' : c.status === 'mixed' ? 'Разночтения о статусе' : 'Ориентир'} · ${c.address}. ${c.program}. ${c.price != null ? 'Цена: ' + c.price + ' ₽ (' + (c.price_note || '') + ')' : (c.price_note || 'Цена: нет данных')}`, url: c.url })),
    ...competitors.studio_scene.map(c => ({ icon: 'users', t: c.name, d: `${c.address}. ${c.price != null ? c.price + ' ₽/' + (c.price_unit || 'мес') + '. ' : ''}${c.price_note || ''}`, url: c.url })),
    ...competitors.party_venues.map(c => ({ icon: 'cake', t: c.name, d: `${c.address}. ${c.hour_rate ? c.hour_rate + ' ₽/час. ' : ''}${c.packages ? 'Пакеты: ' + c.packages.map(p => p.name + ' ' + fmt(p.price) + ' ₽').join(', ') + '. ' : ''}${c.price_note || ''}`, url: c.url })),
    ...competitors.stationary_benchmarks.map(c => ({ icon: 'ticket', t: c.name, d: `${c.address}. ${c.price_note}`, url: c.url }))
  ];
  const filters = ['Все', 'Выездные', 'Студии', 'Лофты', 'Ориентиры'];
  $('marketCards').innerHTML =
    `<div class="filters" role="group" aria-label="Фильтр конкурентов">${filters.map((f, i) => `<button class="chip ${i ? '' : 'on'}" data-f="${i}">${f}</button>`).join('')}</div>` +
    `<div class="rivals">${cards.map((c, i) => rivalCard(c, i)).join('')}</div>`;
  $('marketCards').querySelector('.filters').onclick = e => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    $$('#marketCards .filters .chip').forEach(x => x.classList.toggle('on', x === b));
    const f = +b.dataset.f;
    $$('#marketCards .rival').forEach((el, i) => {
      const group = i < 9 ? 1 : i < 14 ? 2 : i < 17 ? 3 : 4;
      el.style.display = (f === 0 || group === f) ? '' : 'none';
    });
  };
  // Спрос: без источника — честная заглушка
  const d = market.demand || {};
  $('demandBox').innerHTML = d.status === 'no_source'
    ? `<div class="nodata"><strong>Спрос по запросам — подключите источник</strong>
       <span>Wordstat требует официальный API-токен (см. DATA_SOURCES.md). Без токена график не строится и не имитируется.</span>
       <span class="tiny">Запросы-кандидаты: ${(d.queries || []).join(' · ')}</span>
       <button class="btn small secondary" id="demandManual">Ввести данные вручную</button></div>`
    : '';
  const dm = $('demandManual');
  if (dm) dm.onclick = () => {
    const v = prompt('Вставьте данные Wordstat (запрос: показы в месяц, через запятую):');
    if (v) { store.set('ovr.demand', v); toast('Сохранено в этом браузере — построение графика запланировано (см. HANDOFF)'); }
  };
  // Сезонность модели + календарь
  const s = market.seasonality_model || { months: [] };
  const maxS = Math.max(...s.months.map(m => m.shows), 1);
  $('seasonStrip').innerHTML = s.months.map(m =>
    `<div class="cal-m"><b>${m.m}</b><span class="bar"><span style="height:${m.shows / maxS * 100}%"></span></span>${m.shows}</div>`).join('');
  $('chartMeta').innerHTML = `Источник: модель проекта · Обновлено: ${(market.fetched_at || '—')} · Надёжность: средняя (не рыночная статистика)`;
  const cal = market.school_calendar || { holidays: [] };
  $('holidayList').innerHTML = cal.holidays.map(h => `<span class="chip">${h.name} — ${h.approx}${h.peak ? ' · ' + h.peak : ''}</span>`).join('') +
    `<p class="hint" style="margin-top:10px">${cal.note || ''}</p>`;
  // Сеть учреждений
  $('networkStats').innerHTML = table(['Территория', 'Подтверждённый масштаб'], (market.network_stats || []).map(n => [n.area, n.stat]));
}

function rivalCard(c, i) {
  return `<article class="card rival rv"><h4>${ic(c.icon)}${c.t}</h4><p>${c.d}</p>${c.url ? `<a class="chip tag" target="_blank" rel="noopener" href="${c.url}" style="text-decoration:none">Источник ↗</a>` : ''}</article>`;
}
