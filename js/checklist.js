/* checklist.js — чек-лист запуска на 30 дней: отметки и заметки хранятся в localStorage. */
import { $, store } from './ui/helpers.js';

/* Шаги в config.json — объекты {days, title, text}; поддерживаем и старый формат-массив [дни, заголовок, текст] */
function normalizeStep(s) {
  if (Array.isArray(s)) return { days: s[0], title: s[1], text: s[2] };
  return { days: s.days, title: s.title, text: s.text };
}

export function initChecklist(cfg) {
  const steps = (cfg.checklist_30d || []).map(normalizeStep);
  const total = steps.length;
  const saved = store.get('checks', []);
  const a = Array.from({ length: total }, (_, i) => Array.isArray(saved) && saved[i] === true);
  $('checks').innerHTML = steps.map((s, i) => `<label class="checkrow"><input type="checkbox" data-i="${i}" ${a[i] ? 'checked' : ''}><span class="cbody"><span class="days">${s.days}</span><strong>${s.title}</strong><small>${s.text}</small></span></label>`).join('');
  const heading = $('checklistTitle');
  if (heading) heading.textContent = `${total} шагов`;
  const note = store.get('note', '');
  $('note').value = typeof note === 'string' ? note : '';
  const status = () => { $('saved').textContent = store.ok ? 'Заметки и отметки сохраняются только в этом браузере.' : 'Хранилище недоступно: изменения живут до закрытия страницы.'; };
  const tally = () => {
    const n = a.filter(Boolean).length;
    const p = total ? Math.round(n * 100 / total) : 0;
    $('checkbar').style.width = p + '%';
    $('checkcount').textContent = `${n} из ${total} · ${p}%`;
    status();
  };
  $('checks').onchange = e => { if (e.target.matches('input')) { a[+e.target.dataset.i] = e.target.checked; store.set('checks', a); tally(); } };
  $('note').oninput = () => { store.set('note', $('note').value); status(); };
  tally();
}
