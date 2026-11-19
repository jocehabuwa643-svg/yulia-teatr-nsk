/* guide.js — раздел «Справочник»: вкладки категорий, поиск, риски, шаблоны, словарь, архив исследования. */
import { $, $$, ic, icons } from './ui/helpers.js';
import { state } from './state.js';

const guideState = { cat: 0 };

export function initGuide(guide) {
  const cats = guide.categories;
  $('guideTabs').innerHTML = cats.map((c, i) => `<button class="tab ${i === 0 ? 'on' : ''}" role="tab" aria-pressed="${i === 0}">${c}</button>`).join('');
  $('guideTabs').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    guideState.cat = [...$('guideTabs').children].indexOf(b);
    $('q').value = '';
    guideView();
  };
  $('q').oninput = guideView;
  guideView();

  fetch('data/archive.html').then(r => r.ok ? r.text() : Promise.reject(r.status))
    .then(html => { $('archiveBody').innerHTML = html; })
    .catch(() => { $('archiveBody').innerHTML = '<p class="hint">Архив недоступен без сети.</p>'; });
}

function guideView() {
  const guide = state.DATA.guide;
  let q = $('q').value.trim().toLocaleLowerCase('ru').replaceAll('ё', 'е');
  const rows = guide.entries.filter(([k, t, d]) => q ? (t + ' ' + d.replace(/<[^>]+>/g, '')).toLocaleLowerCase('ru').replaceAll('ё', 'е').includes(q) : k === guideState.cat);
  $$('#guideTabs .tab').forEach((b, i) => { b.classList.toggle('on', !q && guideState.cat === i); b.setAttribute('aria-pressed', String(!q && guideState.cat === i)); });
  $('found').textContent = q ? `Поиск по всем разделам · найдено ${rows.length}` : `${guide.categories[guideState.cat]} · материалов: ${rows.length}`;
  if (!rows.length) { $('entries').innerHTML = q ? '<p class="hint">Ничего не найдено. Попробуйте «лицензия», «ПДД» или название площадки.</p>' : ''; return; }
  if (guideState.cat === 2 && !q) {
    $('entries').innerHTML = `<div class="risk-grid">${rows.map(([k, t, d, v]) => {
      const cut = d.indexOf('. ');
      const head = cut > 0 ? d.slice(0, cut) : '';
      const body = cut > 0 ? d.slice(cut + 2) : d;
      const title = t.split(' · ').slice(1).join(' · ') || t;
      return `<div class="risk"><div class="rt">${ic('triangle-alert')}<span>${title}</span></div><div class="tiny"><b>${head}.</b></div><div class="arrow" aria-hidden="true">↓ Решение</div><p>${body}</p></div>`;
    }).join('')}</div>`;
  } else if (guideState.cat === 3 && !q) {
    $('entries').innerHTML = `<div class="templates">${rows.filter(r => r[3] === 'Шаблон').map(([k, t, d]) => `<details class="tmpl"><summary>${t.replace('Шаблон: ', '')}<span class="plus">+</span></summary><pre>${d}</pre></details>`).join('')}</div>
      <h3 style="margin:18px 0 10px">Словарь терминов</h3><div class="dict">${rows.filter(r => r[3] === 'Справка').map(([k, t, d]) => d.split('. ').filter(Boolean).map(s => { const [w, ...rest] = s.split(' — '); return `<div><b>${w}</b><span>${rest.join(' — ')}</span></div>`; }).join('')).join('')}</div>`;
  } else {
    $('entries').innerHTML = `<div class="items">${rows.map(([k, t, d, v]) => `<details class="item"><summary>${t}<span class="plus">+</span></summary><p>${d}</p>${v ? `<span class="verify">${v}</span>` : ''}</details>`).join('')}</div>`;
  }
  icons();
}
