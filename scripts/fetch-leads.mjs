#!/usr/bin/env node
/* fetch-leads.mjs — «Потенциальные клиенты»: раз в неделю считает школы, детские сады и дома культуры / клубы
   по населённым пунктам Новосибирской области (Новосибирск — ещё и по районам) и пишет data/leads.json.

   Источник — OpenStreetMap через Overpass API (открытые данные, лицензия ODbL 1.0; ключей не нужно).
   OSM неполон: часть учреждений не нанесена или нанесена без названия, поэтому в интерфейсе стоит пометка
   «по данным OpenStreetMap, возможны пропуски». 2ГИС и Яндекс не используются (нужен ключ / запрещён сбор).

   Правила проекта: ничего не выдумывается — только то, что вернул источник; сбой не затирает старые данные
   (место остаётся с прежними числами и пометкой stale), сбой одного места не мешает остальным.
   «Потенциал на выезд» — прозрачная сумма «школы + детские сады» (учреждения, куда можно предложить выездной показ);
   никаких коэффициентов спроса. ДК и клубы считаются отдельно — это площадки-партнёры, а не заказчики выезда.

   Исключение из правила «таймаут 10 с»: Overpass считает запрос на сервере, ответ приходит 20–40 с,
   поэтому клиентский таймаут здесь 60 с (повторы и пауза по fetch-util сохранены). Нагрузка — ≈ 6 запросов в неделю.
   Чистые функции (parseOverpass, dedupeObjects, aggregate, buildPlace, mergeKeepOld, buildDoc, leadsStale) экспортируются для тестов.
   Запуск: node scripts/fetch-leads.mjs (DATA_DIR=… — сухой прогон на копии; OVERPASS_ENDPOINTS=url1,url2 — свои зеркала). */
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DATA_DIR, PROJECT_UA, fetchRetry, readJson, writeJsonIfChanged, wait, ageInDays } from './fetch-util.mjs';

/* ---------- Настройки ---------- */
export const STALE_AFTER_DAYS = 10;        // старше — «Данные устарели»
export const MAX_OBJECTS_PER_PLACE = 1500; // потолок списка объектов (для карты) на одно место
export const OVERPASS_TIMEOUT_MS = 60_000; // клиентский таймаут одного запроса (серверный лимит — 50 с)
const PAUSE_MS = 3000;                     // пауза между запросами к Overpass
const DEADLINE_MS = 30 * 60_000;           // общий бюджет времени прогона
const AREA_BASE = 3_600_000_000;           // id области Overpass = 3600000000 + id отношения OSM

/* Эндпоинты по порядку: основной и зеркало VK Maps. Оба публичные; при отказе первого пробуем второй */
export const ENDPOINTS = (process.env.OVERPASS_ENDPOINTS || 'https://maps.mail.ru/osm/tools/overpass/api/interpreter')
  .split(',').map(s => s.trim()).filter(Boolean);

/* Населённые пункты. relation — id административной границы в OSM (найдены через Nominatim, 2026-11-21);
   districts:true — для города отдельно считаем по районам (admin_level=9). ll — запасная точка центра. */
export const PLACES = [
  { id: 'novosibirsk', name: 'Новосибирск', kind: 'city', relation: 1751445, districts: true, ll: [55.0302, 82.9204] },
  { id: 'berdsk', name: 'Бердск', kind: 'city', relation: 1307315, ll: [54.758, 83.107] },
  { id: 'iskitim', name: 'Искитим', kind: 'city', relation: 3396079, ll: [54.644, 83.304] },
  { id: 'kochenevo', name: 'Коченёво', kind: 'town', relation: 7606008, ll: [55.0238, 82.2007] },
  { id: 'moshkovo', name: 'Мошково', kind: 'town', relation: 7613336, ll: [55.2993, 83.6143] },
  { id: 'ordynskoe', name: 'Ордынское', kind: 'town', relation: 7613465, ll: [54.3664, 81.8789] }
];

const KIND_BY_AMENITY = { school: 'school', kindergarten: 'kindergarten', community_centre: 'culture', arts_centre: 'culture' };
const SHORT = { school: 's', kindergarten: 'd', culture: 'c' };

/* ---------- Запрос ---------- */

/* Текст Overpass-запроса. Для города с районами: foreach по границам районов отдаёт сначала тег района, затем его объекты */
export function buildQuery(place) {
  const area = AREA_BASE + place.relation;
  const filter = 'nwr["amenity"~"^(school|kindergarten|community_centre|arts_centre)$"]';
  if (place.districts) {
    return `[out:json][timeout:50];
area(${area})->.city;
rel(area.city)["boundary"="administrative"]["admin_level"="9"]->.ds;
foreach.ds->.d(
  .d out tags center;
  .d map_to_area->.da;
  ${filter}(area.da);
  out center tags;
);`;
  }
  return `[out:json][timeout:50];
area(${area})->.a;
${filter}(area.a);
out center tags;`;
}

/* ---------- Разбор ответа ---------- */

const round5 = x => Math.round(x * 1e5) / 1e5;

/* Нормализованное имя для сравнения дублей: регистр, ё/е, кавычки и знаки */
export function normName(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"'“”„.,;:()\-–—№#]/g, ' ').replace(/\s+/g, ' ').trim();
}

/* Один элемент OSM → объект {k, n, ll, id} или null (не наша категория / нет координат) */
export function elementToObject(el) {
  if (!el || !el.tags) return null;
  const kind = KIND_BY_AMENITY[el.tags.amenity];
  if (!kind) return null;
  const lat = el.lat ?? (el.center && el.center.lat), lon = el.lon ?? (el.center && el.center.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const name = el.tags.name || el.tags['name:ru'] || el.tags.official_name || el.tags.short_name || '';
  return { id: `${el.type[0]}${el.id}`, k: kind, n: String(name).trim(), ll: [round5(lat), round5(lon)] };
}

/* Граница района: relation с boundary=administrative и admin_level (а не школа, оформленная как relation) */
const isBoundary = el => el && el.type === 'relation' && el.tags && el.tags.boundary === 'administrative' && el.tags.admin_level;

/* Разбор JSON Overpass. Возвращает { ok, objects, districts, error }.
   remark с «error»/«timed out»/«out of memory» — серверный сбой при формально HTTP 200: такой ответ неполон и отбрасывается.
   Без районов: objects — все объекты. С районами: districts [{name, objects}], objects — объединение. */
export function parseOverpass(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.elements)) return { ok: false, error: 'ответ не похож на Overpass JSON', objects: [], districts: [] };
  if (json.remark && /error|timed out|out of memory|too many/i.test(json.remark)) {
    return { ok: false, error: `Overpass: ${String(json.remark).slice(0, 120)}`, objects: [], districts: [] };
  }
  const districts = [];
  const objects = [];
  let cur = null;
  for (const el of json.elements) {
    if (isBoundary(el)) {
      cur = { id: `r${el.id}`, name: el.tags.name || `район ${el.id}`, objects: [] };
      districts.push(cur);
      continue;
    }
    const o = elementToObject(el);
    if (!o) continue;
    (cur ? cur.objects : objects).push(o);
  }
  if (districts.length) districts.forEach(d => objects.push(...d.objects));
  return { ok: true, objects, districts };
}

/* Расстояние между точками, метров (хаверсин) */
export function distM(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* Дубли: один объект нанесён и точкой, и контуром. Одна категория и (то же имя ближе 300 м) или (оба без имени ближе 25 м).
   Детсад в здании школы — разные категории и считаются отдельно. */
export function dedupeObjects(objects) {
  const out = [];
  for (const o of objects) {
    const nm = normName(o.n);
    const dup = out.find(x => x.k === o.k && (nm
      ? normName(x.n) === nm && distM(x.ll, o.ll) < 300
      : !x.n && distM(x.ll, o.ll) < 25));
    if (!dup) out.push(o);
  }
  return out;
}

/* Сводка по списку объектов: счётчики категорий, потенциал на выезд (школы + сады), центр масс координат */
export function aggregate(objects) {
  const c = { school: 0, kindergarten: 0, culture: 0 };
  let la = 0, lo = 0;
  for (const o of objects) { c[o.k]++; la += o.ll[0]; lo += o.ll[1]; }
  return {
    school: c.school, kindergarten: c.kindergarten, culture: c.culture,
    potential: c.school + c.kindergarten,
    ll: objects.length ? [round5(la / objects.length), round5(lo / objects.length)] : null
  };
}

/* Компактный список объектов для карты/списка: [{n,k:'s'|'d'|'c',ll}], без дублей, стабильный порядок (меньше шума в git) */
export function compactObjects(objects, limit = MAX_OBJECTS_PER_PLACE) {
  return objects.slice()
    .sort((a, b) => a.k.localeCompare(b.k) || a.n.localeCompare(b.n, 'ru') || a.ll[0] - b.ll[0] || a.ll[1] - b.ll[1])
    .slice(0, limit)
    .map(o => ({ n: o.n, k: SHORT[o.k], ll: o.ll }));
}

/* Запись места из результата разбора */
export function buildPlace(def, parsed, nowIso, sourceId = 'osm-overpass') {
  const objects = dedupeObjects(parsed.objects);
  const total = aggregate(objects);
  const place = {
    id: def.id, name: def.name, kind: def.kind,
    school: total.school, kindergarten: total.kindergarten, culture: total.culture, potential: total.potential,
    coords: total.ll || def.ll,
    objects: compactObjects(objects),
    objects_truncated: objects.length > MAX_OBJECTS_PER_PLACE,
    source: sourceId, fetched_at: nowIso, stale: false
  };
  if (parsed.districts && parsed.districts.length) {
    place.districts = parsed.districts
      .map(d => {
        const a = aggregate(dedupeObjects(d.objects));
        return { id: d.id, name: d.name, school: a.school, kindergarten: a.kindergarten, culture: a.culture, potential: a.potential, coords: a.ll };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }
  return place;
}

/* Сбой места: старые данные остаются (если были), ставится stale + причина; stale_since фиксируется один раз.
   Нет старых данных — место остаётся без чисел (status:'no_data'), а не с нулями. */
export function mergeKeepOld(oldPlace, def, error, nowIso) {
  const reason = String(error).slice(0, 200);
  if (oldPlace && Number.isFinite(oldPlace.school)) {
    return { ...oldPlace, stale: true, stale_since: oldPlace.stale_since || nowIso, stale_reason: reason };
  }
  return { id: def.id, name: def.name, kind: def.kind, status: 'no_data', coords: def.ll, source: 'osm-overpass', stale: true, stale_since: nowIso, stale_reason: reason };
}

/* Подозрительно пустой ответ при непустых старых данных (Overpass иногда отдаёт 200 и пустой набор при перегрузке) */
export function looksBroken(oldPlace, parsed) {
  if (!parsed.ok) return true;
  const n = dedupeObjects(parsed.objects).length;
  if (n === 0) return true;
  const oldN = oldPlace && Number.isFinite(oldPlace.potential) ? oldPlace.potential + (oldPlace.culture || 0) : 0;
  return oldN >= 20 && n < oldN * 0.5;
}

/* Итоги по местам с числами (районы не складываем — они уже внутри города) */
export function totalsOf(places) {
  const t = { school: 0, kindergarten: 0, culture: 0, potential: 0, places_total: places.length, places_ok: 0, places_stale: 0 };
  for (const p of places) {
    if (p.stale) t.places_stale++;
    if (!Number.isFinite(p.school)) continue;
    t.school += p.school; t.kindergarten += p.kindergarten; t.culture += p.culture; t.potential += p.potential;
    if (!p.stale) t.places_ok++;
  }
  return t;
}

/* Документ leads.json. results: [{def, place|null, error|null}], старый документ нужен для сохранения при сбоях.
   stale (документ целиком) — когда НИ ОДНО место не обновилось; частичный сбой — partial + stale_places. */
export function buildDoc(oldDoc, results, sourceInfo, nowIso) {
  const oldById = new Map(((oldDoc && oldDoc.places) || []).map(p => [p.id, p]));
  const places = results.map(r => r.place || mergeKeepOld(oldById.get(r.def.id), r.def, r.error, nowIso));
  const fresh = results.filter(r => r.place).length;
  const failed = results.filter(r => !r.place);
  const doc = {
    schema_version: 1,
    note: 'Школы, детские сады и ДК/клубы по данным OpenStreetMap (ODbL); возможны пропуски. Потенциал на выезд = школы + детские сады (без коэффициентов). Обновляется раз в неделю: scripts/fetch-leads.mjs.',
    updated_at: fresh ? nowIso : (oldDoc && oldDoc.updated_at) || null,
    stale: fresh === 0,
    sources: [{ ...sourceInfo, status: fresh === results.length ? 'ok' : fresh ? 'partial' : 'error', fetched_at: fresh ? nowIso : (sourceInfo.fetched_at || null), items: places.reduce((s, p) => s + (Number.isFinite(p.school) ? p.school + p.kindergarten + p.culture : 0), 0) }],
    places,
    totals: totalsOf(places)
  };
  if (failed.length) {
    doc.partial = fresh > 0;
    doc.stale_places = failed.map(r => r.def.id);
    doc.stale_reason = failed.map(r => `${r.def.name}: ${r.error}`).join('; ').slice(0, 300);
    if (doc.stale && oldDoc && oldDoc.stale_since) doc.stale_since = oldDoc.stale_since;
    else if (doc.stale) doc.stale_since = nowIso;
  }
  return doc;
}

/* Документ устарел: флаг stale или обновление старше STALE_AFTER_DAYS */
export function leadsStale(doc, now = Date.now()) {
  if (!doc) return true;
  return doc.stale === true || ageInDays(doc.updated_at, now) > STALE_AFTER_DAYS;
}

/* ---------- Сеть ---------- */

/* Паузы между повторами к перегруженному Overpass: у публичных серверов очередь из слотов, короткий backoff их не ждёт */
const OVERPASS_RETRY_WAIT_MS = [12_000, 30_000];
const SECOND_PASS_WAIT_MS = 60_000; // пауза перед вторым кругом по местам, которые не ответили в первом

/* Один запрос к Overpass с переключением между эндпоинтами и терпеливыми повторами (до 3 попыток на эндпоинт).
   Возвращает разобранный результат или бросает Error */
async function queryPlace(def, deadline) {
  let lastErr;
  for (const endpoint of ENDPOINTS) {
    for (let attempt = 0; attempt <= OVERPASS_RETRY_WAIT_MS.length; attempt++) {
      if (Date.now() > deadline) throw new Error('исчерпан общий бюджет времени прогона');
      try {
        const res = await fetchRetry(endpoint, {
          method: 'POST',
          headers: { 'User-Agent': PROJECT_UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: 'data=' + encodeURIComponent(buildQuery(def))
        }, { retries: 0, timeout: OVERPASS_TIMEOUT_MS, label: `Overpass ${new URL(endpoint).host} (${def.name})` });
        const text = await res.text();
        let json;
        try { json = JSON.parse(text); } catch { throw new Error('ответ не JSON (перегрузка сервера?)'); }
        const parsed = parseOverpass(json);
        if (!parsed.ok) throw new Error(parsed.error);
        return { parsed, endpoint, osmBase: json.osm3s && json.osm3s.timestamp_osm_base };
      } catch (e) {
        lastErr = e;
        // 4xx (кроме 408/429), запрет и отсутствие эндпоинта — повторять бессмысленно, идём на следующий эндпоинт
        const hopeless = e.fatal && !/HTTP (408|429)/.test(e.message);
        console.error(`[leads] ${def.name}: ${e.message}${hopeless || attempt === OVERPASS_RETRY_WAIT_MS.length ? '' : ` — повтор через ${OVERPASS_RETRY_WAIT_MS[attempt] / 1000} с`}`);
        if (hopeless || attempt === OVERPASS_RETRY_WAIT_MS.length) break;
        await wait(OVERPASS_RETRY_WAIT_MS[attempt]);
      }
    }
  }
  throw lastErr;
}

/* ---------- Запуск ---------- */

export async function run({ now = new Date() } = {}) {
  const file = join(DATA_DIR, 'leads.json');
  const nowIso = now.toISOString();
  const oldDoc = existsSync(file) ? (() => { try { return readJson(file); } catch { return null; } })() : null;
  const oldById = new Map(((oldDoc && oldDoc.places) || []).map(p => [p.id, p]));
  const deadline = Date.now() + DEADLINE_MS;
  let osmBase = null;
  /* Одно место: запрос, проверка на «подозрительно пусто», сборка. Ошибка не бросается — возвращается в результате */
  const queryOne = async def => {
    try {
      const { parsed, osmBase: base } = await queryPlace(def, deadline);
      if (looksBroken(oldById.get(def.id), parsed)) throw Object.assign(new Error('ответ пуст или заметно меньше прежнего — похоже на сбой источника'), { suspicious: true });
      osmBase = base || osmBase;
      const place = buildPlace(def, parsed, nowIso);
      console.log(`[leads] ${def.name}: школ ${place.school}, садов ${place.kindergarten}, ДК/клубов ${place.culture}${place.districts ? `, районов ${place.districts.length}` : ''}`);
      return { def, place };
    } catch (e) {
      return { def, place: null, error: e.message, retryable: !e.suspicious };
    }
  };
  const results = [];
  for (const def of PLACES) {
    results.push(await queryOne(def));
    await wait(PAUSE_MS);
  }
  /* Второй круг для мест, где Overpass не дал слот (502/504/таймаут): зеркало перегружено волнами, через минуту
     запрос часто проходит. Только сетевые сбои и только в пределах общего бюджета времени */
  const failed = results.map((r, i) => (r.place || !r.retryable ? -1 : i)).filter(i => i >= 0);
  if (failed.length && Date.now() + SECOND_PASS_WAIT_MS < deadline) {
    console.error(`[leads] второй круг через ${SECOND_PASS_WAIT_MS / 1000} с: ${failed.map(i => results[i].def.name).join(', ')}`);
    await wait(SECOND_PASS_WAIT_MS);
    for (const i of failed) {
      if (Date.now() > deadline) break;
      const again = await queryOne(results[i].def);
      if (again.place) results[i] = again;
      await wait(PAUSE_MS);
    }
  }
  for (const r of results) {
    if (!r.place) console.error(`[leads] ${r.def.name}: оставляю прежние данные — ${r.error}`);
  }
  const prevSource = ((oldDoc && oldDoc.sources) || [])[0] || {};
  const doc = buildDoc(oldDoc, results, {
    id: 'osm-overpass',
    name: 'OpenStreetMap (Overpass API)',
    url: 'https://www.openstreetmap.org/copyright',
    license: 'ODbL 1.0 — © участники OpenStreetMap',
    note: 'Теги amenity=school / kindergarten / community_centre / arts_centre; неполно, возможны пропуски',
    fetched_at: prevSource.fetched_at || null
  }, nowIso);
  if (osmBase) doc.sources[0].osm_data_timestamp = osmBase;
  const changed = writeJsonIfChanged(file, doc);
  console.log(`[leads] ${changed ? 'записан' : 'без изменений'}: ${file}; stale=${doc.stale}; мест обновлено ${doc.totals.places_ok}/${doc.totals.places_total}`);
  return doc;
}

/* Запускаем только как скрипт, не при импорте из тестов */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error('[leads] критическая ошибка:', e); process.exit(1); });
}
