/* calc-dialog.js — маленькая форма в <dialog> вместо window.prompt: ручной ввод значения, имя сценария, допущения проекта.
   Нативный <dialog>: фокус внутри формы, Esc закрывает, фокус возвращается на кнопку, вызвавшую диалог.
   askDialog() возвращает Promise: { values } при «Сохранить», { extra: true } при дополнительной кнопке, null при отмене. */
import { num } from '../calculators/util.js';

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let seq = 0;

/* fields: [{ id, label, type:'number'|'text', value, unit, hint, min, group, maxLength }] */
export function askDialog({ title, lead = '', fields, ok = 'Сохранить', cancel = 'Отмена', extra = null }) {
  return new Promise(resolve => {
    const uid = `dlg${++seq}`;
    const opener = document.activeElement;
    const dlg = document.createElement('dialog');
    dlg.className = 'calcdlg';
    dlg.setAttribute('aria-labelledby', `${uid}t`);
    dlg.setAttribute('aria-describedby', `${uid}d`);
    let lastGroup = null;
    const rows = fields.map((f, i) => {
      const head = f.group && f.group !== lastGroup ? `<h3 class="dlg-group">${esc(f.group)}</h3>` : '';
      lastGroup = f.group || lastGroup;
      const isNum = f.type !== 'text';
      return `${head}<div class="dlg-field">
        <label for="${uid}f${i}">${esc(f.label)}${f.unit ? ` <span class="fsuf">(${esc(f.unit)})</span>` : ''}</label>
        <input id="${uid}f${i}" name="${esc(f.id)}" type="text" ${isNum ? 'inputmode="decimal"' : (f.maxLength ? `maxlength="${f.maxLength}"` : '')} autocomplete="off" value="${esc(f.value == null ? '' : f.value)}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} aria-describedby="${uid}h${i}">
        ${f.hint ? `<p class="tiny" id="${uid}h${i}">${f.hint}</p>` : `<span id="${uid}h${i}"></span>`}
      </div>`;
    }).join('');
    dlg.innerHTML = `<form method="dialog" novalidate>
      <h2 id="${uid}t">${esc(title)}</h2>
      <p class="tiny" id="${uid}d">${lead}</p>
      <div class="dlg-body">${rows}</div>
      <p class="dlg-err" role="alert" hidden></p>
      <div class="toolrow dlg-actions">
        <button type="submit" class="btn small primary">${esc(ok)}</button>
        <button type="button" class="btn small secondary" data-dlg="cancel">${esc(cancel)}</button>
        ${extra ? `<button type="button" class="btn small secondary" data-dlg="extra">${esc(extra)}</button>` : ''}
      </div>
    </form>`;
    let result = null;
    const form = dlg.querySelector('form');
    const err = dlg.querySelector('.dlg-err');
    form.addEventListener('submit', e => {
      e.preventDefault();
      const values = {};
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        const raw = form.elements[f.id] ? form.elements[f.id].value : '';
        if (f.type === 'text') { values[f.id] = raw; continue; }
        if (raw.trim() === '' && f.optional) { values[f.id] = null; continue; }
        const n = num(raw, NaN);
        if (!Number.isFinite(n) || n < (f.min ?? 0)) {
          err.hidden = false;
          err.textContent = `Поле «${f.label}»: введите число не меньше ${f.min ?? 0}.`;
          form.elements[f.id].focus();
          return;
        }
        values[f.id] = n;
      }
      result = { values };
      dlg.close();
    });
    dlg.addEventListener('click', e => {
      const b = e.target.closest('[data-dlg]');
      if (!b) return;
      if (b.dataset.dlg === 'extra') result = { extra: true };
      dlg.close();
    });
    dlg.addEventListener('close', () => { dlg.remove(); if (opener && opener.focus) try { opener.focus(); } catch (e) { /* элемент мог исчезнуть */ } resolve(result); });
    document.body.appendChild(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    const first = dlg.querySelector('input'); if (first) { first.focus(); first.select && first.select(); }
  });
}
