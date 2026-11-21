/* news.js — «Новости отрасли»: отбор свежих записей из data/news.json и выезжающая плашка.

   Плашка появляется не при загрузке, а когда Юлия начала пользоваться справочником: первое действие после закрытия
   заставки (клик, ввод, прокрутка, фокус в поиске) + 1,5 с; не чаще раза за сессию и только с новостями,
   которых она ещё не видела (id — в localStorage, ключ yulia.v2.news.seen). Висит 9 с, таймер стоит на паузе,
   пока над плашкой курсор или в ней фокус. Нет свежих новостей или данные устарели — плашки нет вовсе.
   Чистые функции (freshNews, pickUnseen, relativeDay, isNewsUsable) не трогают DOM и проверяются тестами. */

export const FRESH_DAYS = 14;        // «свежая» новость для дайджеста и плашки
export const TOAST_MAX = 3;          // сколько новостей в плашке
export const TOAST_MAX_NARROW = 2;   // сколько новостей в плашке на телефоне (≤600px)
export const TOAST_TEASER_MS = 25000; // сколько висит свёрнутая плашка (20–30 с), если её не открыли
export const TOAST_OPEN_MS = 9000;    // сколько висит раскрытая плашка после «Посмотреть» (8–10 с)
export const TOAST_SHOW_MS = TOAST_TEASER_MS; // совместимость со старым именем
export const TOAST_DELAY_MS = 1500;  // пауза после первого действия
const SEEN_KEY = 'yulia.v2.news.seen';
const SESSION_KEY = 'yulia.v2.news.toastShown';
const SEEN_CAP = 300;                // потолок запомненных id, чтобы localStorage не рос бесконечно
const DAY = 864e5;

/* Подписи тем — для дайджеста и плашки */
export const TOPIC_LABELS = {
  grants: 'Гранты',
  taxes: 'Налоги',
  culture: 'Культура',
  city: 'Регион',
  industry: 'Детский театр'
};

/* ---------- Чистые функции ---------- */

/* Данные пригодны для показа: есть записи и, если ленты недоступны (stale), последнее успешное обновление не старше days */
export function isNewsUsable(data, now = Date.now(), days = FRESH_DAYS) {
  if (!data || !Array.isArray(data.items) || !data.items.length) return false;
  if (data.stale) {
    const t = Date.parse(data.updated_at);
    if (!Number.isFinite(t) || now - t > days * DAY) return false;
  }
  return true;
}

/* Свежие новости для дайджеста: опубликованы за последние days дней (относительно now), новые сверху.
   Записи без корректной даты, ссылки или заголовка отбрасываются; дата «из будущего» допустима не дальше суток */
export function freshNews(data, now = Date.now(), days = FRESH_DAYS) {
  if (!isNewsUsable(data, now, days)) return [];
  const from = now - days * DAY;
  return data.items
    .filter(it => it && it.title && it.url && /^https?:\/\//i.test(it.url))
    .map(it => ({ it, t: Date.parse(it.published_at) }))
    .filter(({ t }) => Number.isFinite(t) && t >= from && t - now <= DAY)
    .sort((a, b) => b.t - a.t)
    .map(({ it }) => it);
}

/* Ещё не показанные записи (по id), не больше max */
export function pickUnseen(items, seenIds, max = TOAST_MAX) {
  const seen = new Set(seenIds || []);
  return (items || []).filter(it => it.id && !seen.has(it.id)).slice(0, max);
}

/* «сегодня» / «вчера» / «3 дня назад» / «20 нояб.» — по календарным дням местного времени */
export function relativeDay(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const day = d => { const x = new Date(d); return Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()); };
  const diff = Math.round((day(now) - day(t)) / DAY);
  if (diff <= 0) return 'сегодня';
  if (diff === 1) return 'вчера';
  if (diff < 7) {
    const n = diff;
    const word = n % 10 === 1 && n % 100 !== 11 ? 'день' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'дня' : 'дней');
    return `${n} ${word} назад`;
  }
  try { return new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }); }
  catch { return new Date(t).toISOString().slice(0, 10); }
}

/* ---------- Хранилище (ошибки доступа не роняют модуль: приватный режим, запрет cookies) ---------- */
function readSeen(storage) {
  try {
    const v = JSON.parse(storage.getItem(SEEN_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function writeSeen(storage, ids) {
  try { storage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-SEEN_CAP))); } catch { /* квота или запрет — не критично */ }
}
function sessionFlag(session, set) {
  try {
    if (set) { session.setItem(SESSION_KEY, '1'); return true; }
    return session.getItem(SESSION_KEY) === '1';
  } catch { return false; }
}

/* ---------- Плашка ---------- */
const CLOSE_SVG = '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const ARROW_SVG = '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
const EXT_SVG = '<svg class="lucide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';

/* Собирает DOM плашки. Текст вставляется через textContent — HTML из лент не исполняется */
function buildToast(doc, items, now, allTarget) {
  const box = doc.createElement('aside');
  box.className = 'newsflash';
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  box.setAttribute('aria-label', 'Новости отрасли');

  // шапка: подпись и кнопка закрытия
  const head = doc.createElement('div');
  head.className = 'nf-head';
  const kicker = doc.createElement('p');
  kicker.className = 'nf-kicker';
  kicker.textContent = items.length > 1 ? `Новости отрасли · ${items.length}` : 'Новость отрасли';
  const close = doc.createElement('button');
  close.type = 'button';
  close.className = 'nf-close';
  close.setAttribute('aria-label', 'Закрыть новости');
  close.innerHTML = CLOSE_SVG;
  head.append(kicker, close);

  // свёрнутый вид: одна строка с первой новостью и кнопка «Посмотреть» (раскрывает список)
  const peek = doc.createElement('p');
  peek.className = 'nf-peek';
  peek.textContent = items[0].title;
  const view = doc.createElement('button');
  view.type = 'button';
  view.className = 'nf-view';
  view.innerHTML = '<span>Посмотреть</span>' + ARROW_SVG;
  view.setAttribute('aria-expanded', 'false');

  // список: каждая новость — ссылка на первоисточник в новой вкладке
  const list = doc.createElement('ul');
  list.className = 'nf-list';
  for (const it of items) {
    const li = doc.createElement('li');
    const a = doc.createElement('a');
    a.className = 'nf-item';
    a.href = it.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    const title = doc.createElement('span');
    title.className = 'nf-title';
    title.textContent = it.title;
    const meta = doc.createElement('span');
    meta.className = 'nf-meta';
    const topic = TOPIC_LABELS[it.topic];
    meta.textContent = [topic, it.source_name, relativeDay(it.published_at, now)].filter(Boolean).join(' · ');
    const ext = doc.createElement('span');
    ext.className = 'nf-ext';
    ext.innerHTML = EXT_SVG;
    const sr = doc.createElement('span');
    sr.className = 'sr-only nf-sr';
    sr.textContent = ' (откроется в новой вкладке)';
    a.append(title, meta, ext, sr);
    li.append(a);
    list.append(li);
  }

  box.className = 'newsflash compact';
  box.append(head, peek, view, list);

  // «Все новости» — только если на странице есть блок дайджеста
  let all = null;
  if (allTarget) {
    all = doc.createElement('a');
    all.className = 'nf-all';
    all.href = '#' + allTarget.id;
    all.innerHTML = '<span>Все новости</span>' + ARROW_SVG;
    box.append(all);
  }

  // полоска оставшегося времени (только transform)
  const bar = doc.createElement('div');
  bar.className = 'nf-timer';
  bar.setAttribute('aria-hidden', 'true');
  box.append(bar);

  return { box, close, all, bar, view };
}

/* Подключает новости к странице.
   newsData — содержимое data/news.json (или null). Опции:
     now        — момент «сейчас» в мс (для тестов и «дня запуска»), по умолчанию Date.now();
     doc / win  — document и window (по умолчанию глобальные);
     allId      — id блока дайджеста для ссылки «Все новости» (по умолчанию 'today'; нет элемента — нет ссылки);
     searchId   — id поля поиска справочника (по умолчанию 'q'): фокус в нём тоже считается началом работы.
   Возвращает { items, unseen, show, destroy }: items — свежие новости для дайджеста (freshNews),
   show() — показать плашку немедленно (для отладки), destroy() — снять слушатели и убрать плашку. */
export function initNews(newsData, { now = Date.now(), doc = globalThis.document, win = globalThis.window, allId = 'today', searchId = 'q' } = {}) {
  const items = freshNews(newsData, now);
  const api = { items, unseen: [], show: () => false, destroy: () => {} };
  if (!doc || !win || !items.length) return api;

  let storage = null, session = null;
  try { storage = win.localStorage; } catch { /* нет доступа */ }
  try { session = win.sessionStorage; } catch { /* нет доступа */ }
  const unseen = storage ? pickUnseen(items, readSeen(storage)) : items.slice(0, TOAST_MAX);
  api.unseen = unseen;
  // показывать нечего или уже показывали в этой сессии — слушатели не вешаем вовсе
  if (!unseen.length || (session && sessionFlag(session))) return api;

  const root = doc.documentElement;
  const reduced = () => { try { return win.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  /* Заставка открыта: у html нет veil-seen или #veil ещё не скрыт */
  const veilOpen = () => {
    if (!root.classList.contains('veil-seen')) return true;
    const v = doc.getElementById('veil');
    return !!(v && !v.classList.contains('gone') && !v.hasAttribute('hidden'));
  };

  let armTimer = 0, hideTimer = 0, removeTimer = 0;
  let toast = null, remaining = TOAST_TEASER_MS, startedAt = 0, paused = false, done = false;
  // прокрутку ловим по её источникам (колесо, касание, клавиши): событие scroll бывает и без участия человека (восстановление позиции)
  const EVENTS = ['pointerdown', 'keydown', 'input', 'wheel', 'touchstart'];
  const opts = { passive: true, capture: true };

  /* Первое действие пользователя после заставки → через TOAST_DELAY_MS показываем плашку */
  function onActivity(e) {
    if (done || armTimer || veilOpen()) return;
    // клики и клавиши внутри самой заставки не считаются
    const veil = doc.getElementById('veil');
    if (veil && e && e.target && e.target.nodeType === 1 && veil.contains(e.target)) return;
    detachActivity();
    armTimer = win.setTimeout(() => { armTimer = 0; show(); }, TOAST_DELAY_MS);
  }
  function onFocusIn(e) {
    if (e && e.target && e.target.id === searchId) onActivity(e);
  }
  function attachActivity() {
    for (const ev of EVENTS) win.addEventListener(ev, onActivity, opts);
    doc.addEventListener('focusin', onFocusIn, true);
  }
  function detachActivity() {
    for (const ev of EVENTS) win.removeEventListener(ev, onActivity, opts);
    doc.removeEventListener('focusin', onFocusIn, true);
  }

  /* Таймер скрытия с паузой: запоминаем остаток при наведении/фокусе */
  function startTimer() {
    startedAt = Date.now();
    hideTimer = win.setTimeout(hide, remaining);
    if (toast) toast.box.classList.remove('paused');
  }
  function pauseTimer() {
    if (paused || !toast) return;
    paused = true;
    win.clearTimeout(hideTimer);
    remaining = Math.max(1500, remaining - (Date.now() - startedAt));
    toast.box.classList.add('paused');
  }
  function resumeTimer() {
    if (!paused || !toast) return;
    // фокус ещё внутри плашки или курсор над ней — продолжаем ждать
    if (toast.box.matches(':hover') || toast.box.contains(doc.activeElement)) return;
    paused = false;
    startTimer();
  }

  function show() {
    if (done || toast) return false;
    if (veilOpen()) { attachActivity(); return false; }
    done = true;
    detachActivity();
    if (session) sessionFlag(session, true);
    // на телефоне (≤600px) плашка компактная — две новости; счётчик и «показанные» id считаются только по ним,
    // чтобы невидимая третья не помечалась прочитанной и пришла в следующий раз
    const narrow = !!(win.matchMedia && win.matchMedia('(max-width:600px)').matches);
    const shown = narrow ? unseen.slice(0, TOAST_MAX_NARROW) : unseen;
    if (storage) writeSeen(storage, [...readSeen(storage), ...shown.map(it => it.id)]);

    const allTarget = allId ? doc.getElementById(allId) : null;
    toast = buildToast(doc, shown, now, allTarget);
    const { box, close, all, bar, view } = toast;
    // длительность полоски = время показа свёрнутой плашки; пауза останавливает анимацию классом .paused
    remaining = TOAST_TEASER_MS;
    bar.style.animationDuration = TOAST_TEASER_MS + 'ms';
    if (reduced()) box.classList.add('still');
    doc.body.append(box);
    // кадр между вставкой и классом .show — чтобы сработал переход transform/opacity
    win.requestAnimationFrame(() => win.requestAnimationFrame(() => box.classList.add('show')));

    close.addEventListener('click', hide);
    // «Посмотреть»: раскрываем список и даём ещё TOAST_OPEN_MS (мышью — без залипания на паузе, с клавиатуры — фокус на первую новость)
    view.addEventListener('click', e => {
      if (!toast) return;
      const byKeyboard = e.detail === 0;
      box.classList.remove('compact');
      box.classList.add('open');
      view.setAttribute('aria-expanded', 'true');
      win.clearTimeout(hideTimer);
      remaining = TOAST_OPEN_MS;
      bar.style.animation = 'none';
      void bar.offsetWidth; // перезапуск полоски
      bar.style.animation = '';
      bar.style.animationDuration = TOAST_OPEN_MS + 'ms';
      const first = box.querySelector('.nf-item');
      if (byKeyboard && first) { try { first.focus({ preventScroll: true }); } catch { /* ок */ } }
      else { try { view.blur(); } catch { /* ок */ } }
      paused = false;
      // курсор уже над раскрывшейся плашкой — mouseenter не придёт, поэтому паузу ставит только фокус; пауза по наведению включится, когда курсор выйдет и вернётся
      if (box.contains(doc.activeElement)) { paused = true; box.classList.add('paused'); } else startTimer();
    });
    box.addEventListener('mouseenter', pauseTimer);
    box.addEventListener('mouseleave', resumeTimer);
    box.addEventListener('focusin', pauseTimer);
    box.addEventListener('focusout', () => win.setTimeout(resumeTimer, 0));
    // Escape закрывает плашку, где бы ни был фокус (в том числе когда мышь держит таймер на паузе);
    // слушатель на документе живёт только пока плашка на экране
    doc.addEventListener('keydown', onEscape, true);
    doc.addEventListener('focusin', onFieldFocus, true);
    if (all) all.addEventListener('click', e => {
      const target = doc.getElementById(allId);
      if (!target) return;
      e.preventDefault();
      hide();
      target.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      // фокус переносим в дайджест, чтобы клавиатура продолжила оттуда
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      try { target.focus({ preventScroll: true }); } catch { /* старый браузер */ }
    });
    startTimer();
    return true;
  }

  /* Человек начал вводить цифры в калькулятор или поле поиска — плашка не должна мешать: убираем её */
  function onFieldFocus(e) {
    const t = e && e.target;
    if (!toast || !t || t.nodeType !== 1 || toast.box.contains(t)) return;
    if (t.matches && t.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]),textarea,select')) hide();
  }

  function onEscape(e) {
    if (e.key !== 'Escape' || !toast) return;
    // фокус внутри плашки — Escape адресован ей, дальше по странице не идёт
    if (toast.box.contains(doc.activeElement)) e.stopPropagation();
    hide();
  }

  function hide() {
    if (!toast) return;
    doc.removeEventListener('keydown', onEscape, true);
    doc.removeEventListener('focusin', onFieldFocus, true);
    win.clearTimeout(hideTimer);
    const { box } = toast;
    // если фокус был внутри плашки — снимаем его, чтобы он не остался на удалённом элементе
    if (box.contains(doc.activeElement)) { try { doc.activeElement.blur(); } catch { /* ок */ } }
    box.classList.remove('show');
    box.classList.add('hiding');
    removeTimer = win.setTimeout(() => box.remove(), reduced() ? 0 : 450);
    toast = null;
  }

  attachActivity();
  api.show = show;
  api.destroy = () => {
    detachActivity();
    win.clearTimeout(armTimer);
    win.clearTimeout(hideTimer);
    win.clearTimeout(removeTimer);
    doc.removeEventListener('keydown', onEscape, true);
    doc.removeEventListener('focusin', onFieldFocus, true);
    if (toast) { toast.box.remove(); toast = null; }
    done = true;
  };
  return api;
}
