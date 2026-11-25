/* access-card.js — карточка «Допуск в сады и школы (старт)»: чистая логика без DOM (проверяется тестами).
   Данные — data/guide.json → access_start: пункты с официальными источниками и пометкой «уточните у заведующей». */

/* Пункты карточки в безопасном виде: только записи с id и заголовком, у источников — только http(s)-ссылки */
export function accessItems(block) {
  const items = block && Array.isArray(block.items) ? block.items : [];
  return items.filter(x => x && typeof x.id === 'string' && x.id && typeof x.title === 'string' && x.title)
    .map(x => ({
      id: x.id,
      title: x.title,
      what: String(x.what || ''),
      clarify: String(x.clarify || ''),
      sources: (Array.isArray(x.sources) ? x.sources : [])
        .filter(s => s && /^https:\/\//.test(String(s.source_url || '')))
        .map(s => ({ source_name: String(s.source_name || s.source_url), source_url: String(s.source_url), fetched_at: s.fetched_at || null, confidence: s.confidence || 'medium' }))
    }));
}

/* Отметки «готово» (store: yulia.v2.launchx.access) — только известные id и только true */
export function sanitizeAccessState(raw, items) {
  const ids = new Set(items.map(x => x.id));
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const k of Object.keys(raw)) if (ids.has(k) && raw[k] === true) out[k] = true;
  return out;
}

/* Прогресс: { done, total, pct } */
export function accessProgress(items, st) {
  const total = items.length;
  const done = items.filter(x => st[x.id] === true).length;
  return { done, total, pct: total ? Math.round(done * 100 / total) : 0 };
}

/* Дата проверки «2026-11-24» → «24.11.2026» (строкой, без часовых поясов) */
export function ruDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}
