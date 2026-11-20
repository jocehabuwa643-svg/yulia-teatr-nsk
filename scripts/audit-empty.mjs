// audit_empty.mjs — П1.2: поиск пустых карточк/контейнеров/графиков на обеих темах, 360px
import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const ROOT = path.resolve(process.cwd());
const server = http.createServer(async (req, res) => {
  try { let p = req.url === '/' ? '/index.html' : req.url; const d = await readFile(path.join(ROOT, p)); res.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : p.endsWith('.json') ? 'application/json' : p.endsWith('.css') ? 'text/css' : 'text/html' }); res.end(d); } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(8132, '127.0.0.1', r));
const edge = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', ['--headless=new', '--disable-gpu', '--remote-debugging-port=9343', `--user-data-dir=${ROOT}/../tmp_audit`, '--window-size=360,900', 'about:blank'], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 2500));
const list = await (await fetch('http://127.0.0.1:9343/json/list')).json();
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let mid = 0; const pend = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const send = (m, p = {}) => new Promise(res => { const id = ++mid; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
const evalJS = async e => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.result?.value; };
await send('Runtime.enable'); await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 900, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://127.0.0.1:8132/' });
await new Promise(r => setTimeout(r, 3000));
await evalJS(`localStorage.setItem('yulia.v2.seen','1'); location.reload()`);
await new Promise(r => setTimeout(r, 3000));

const AUDIT = `(async function(){
  const issues = [];
  // прокрутить всю страницу, чтобы всё инициализировалось/появилось
  const H = document.body.scrollHeight;
  for (let y = 0; y <= H; y += 500) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 70)); }
  await new Promise(r => setTimeout(r, 900));
  window.scrollTo(0, 0);
  // 1) пустые карточки и .card без текста (видимые)
  document.querySelectorAll('.card').forEach(c => {
    if (c.offsetParent === null) return;
    const txt = (c.textContent || '').replace(/\\s+/g, ' ').trim();
    if (txt.length < 3) issues.push('пустая .card: ' + (c.id || c.className).toString().slice(0, 40));
  });
  // 2) нулевые/крошечные видимые блоки-контейнеры, ожидающие контент (форменные элементы — не пустышки)
  document.querySelectorAll('section [id]').forEach(el => {
    if (el.offsetParent === null) return;
    if (/^(INPUT|SELECT|TEXTAREA|CANVAS|PROGRESS|OUTPUT|METER)$/.test(el.tagName)) return;
    if (el.closest('.track, .tally')) return; // прогресс-шкалы — анимационные span
    if (el.children.length === 0 && (el.textContent || '').trim() === '' && el.clientHeight > 0)
      issues.push('пустой контейнер #' + el.id + ' (h=' + el.clientHeight + ')');
  });
  // 3) графики: canvas отрисован? (есть непрозрачные пиксели)
  document.querySelectorAll('canvas').forEach(c => {
    if (c.closest('[hidden]')) return;
    const r = c.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) { issues.push('canvas нулевой: ' + (c.id || '')); return; }
    try {
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, Math.min(c.width, 120), Math.min(c.height, 80)).data;
      let painted = 0;
      for (let i = 3; i < d.length; i += 40) if (d[i] > 0) painted++;
      if (painted < 3) issues.push('canvas не отрисован: ' + (c.id || 'no-id') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    } catch (e) { issues.push('canvas недоступен: ' + (c.id || '') + ' ' + e.message.slice(0, 40)); }
  });
  // 4) reveal: прокрутить к каждому .rv по очереди, чтобы observer отработал; затем искать застрявшие В ВЬЮПОРТЕ
  const rvs = [...document.querySelectorAll('.rv:not(.in)')];
  for (const e of rvs) { e.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 60)); }
  await new Promise(r => setTimeout(r, 400));
  document.querySelectorAll('.rv:not(.in)').forEach(e => {
    if (e.offsetParent === null) return;
    const r = e.getBoundingClientRect();
    if (r.top >= 0 && r.top < innerHeight) {
      const sec = e.closest('section');
      issues.push('rv застрял В ВЬЮПОРТЕ: ' + (e.id || e.className.toString().split(' ')[0]) + ' @' + (sec ? sec.id : '?'));
    }
  });
  // 5) нулевые svg/иконки с фрагментом разметки (заставка скрыта — её элементы законно 0×0)
  document.querySelectorAll('img, svg').forEach(i => {
    if (i.offsetParent === null || i.closest('#veil')) return;
    const r = i.getBoundingClientRect();
    if ((r.width === 0 || r.height === 0) && r.top > -1)
      issues.push('нулевой размер: ' + i.outerHTML.slice(0, 90));
  });
  return issues;
})()`;

for (const theme of ['light', 'dark']) {
  await evalJS(`document.documentElement.dataset.theme='${theme}'`);
  await new Promise(r => setTimeout(r, 500));
  const issues = await evalJS(AUDIT);
  console.log(theme.toUpperCase() + ': ' + (Array.isArray(issues) && issues.length ? '\n  - ' + issues.join('\n  - ') : 'чисто'));
}
ws.close(); edge.kill(); server.close(); process.exit(0);
