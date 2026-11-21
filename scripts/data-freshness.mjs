#!/usr/bin/env node
/* data-freshness.mjs — аудит свежести всех data/*.json по договорённым правилам обновления.
   Чистая функция auditFreshness(data, now) ничего не скачивает и не меняет: она сверяет даты в файлах с порогами
   (meta.refresh_policy.stale_after_days и rates.thresholds_days) и возвращает список находок.
   touch-meta.mjs печатает находки как ::warning в сводке GitHub Actions; запуск вручную — node scripts/data-freshness.mjs.

   Договорённости (DATA_SOURCES.md):
   • курсы ЦБ и новости — ежедневно (data-refresh.yml);
   • «потенциальные клиенты» (leads) и проверка сайтов конкурентов — еженедельно (weekly-refresh.yml);
   • налоги и ставки — по годам (valid_from / valid_to), ручная сверка; гранты и цены конкурентов — ручная сверка по порогам. */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_DIR, ageInDays } from './fetch-util.mjs';

/* Пороги по умолчанию (дней), если в данных их нет. Совпадают с meta.refresh_policy.stale_after_days */
export const DEFAULT_LIMITS = { rates: 7, prices: 30, grants: 30, news: 14, leads: 10, competitors_check: 14, news_source: 7 };

const COMP_GROUPS = ['outbound_performers', 'studio_scene', 'party_venues', 'stationary_benchmarks'];

/* Итоговые пороги: meta.refresh_policy.stale_after_days → rates.thresholds_days → значения по умолчанию */
export function limitsFrom(data) {
  const fromMeta = (data.meta && data.meta.refresh_policy && data.meta.refresh_policy.stale_after_days) || {};
  const fromRates = (data.rates && data.rates.thresholds_days) || {};
  const out = { ...DEFAULT_LIMITS };
  for (const src of [fromRates, fromMeta]) {
    for (const [k, v] of Object.entries(src)) if (Number.isFinite(v) && v > 0) out[k] = v;
  }
  return out;
}

/* Последняя дата вида ДД.ММ.ГГГГ в тексте (окно приёма заявок гранта) → epoch ms; нет даты → null */
export function lastDateInText(text) {
  const all = [...String(text || '').matchAll(/(\d{2})\.(\d{2})\.(\d{4})/g)];
  if (!all.length) return null;
  const m = all[all.length - 1];
  const t = Date.UTC(+m[3], +m[2] - 1, +m[1], 23, 59, 59);
  return Number.isFinite(t) ? t : null;
}

const days = x => `${Math.floor(x)} дн.`;

/* Аудит. data — объект { rates, meta, news, leads, competitors, market, seasonality, ... } (как после чтения data/*.json).
   Возвращает массив { file, level: 'warning' | 'notice', message } — пустой, если всё по правилам */
export function auditFreshness(data, now = Date.now()) {
  const d = data || {};
  const L = limitsFrom(d);
  const out = [];
  const add = (file, level, message) => out.push({ file, level, message });
  const year = new Date(now).getUTCFullYear();

  /* 1. Курсы ЦБ — ежедневно */
  const cbr = d.rates && d.rates.cbr;
  if (cbr) {
    for (const key of ['usd_rub', 'eur_rub']) {
      const b = cbr[key];
      if (!b || b.value === null || b.value === undefined) continue;
      if (b.stale) add('rates.json', 'warning', `Курс ${key.slice(0, 3).toUpperCase()} не обновился: ЦБ не ответил${b.stale_since ? ' с ' + String(b.stale_since).slice(0, 10) : ''}${b.stale_reason ? ' (' + b.stale_reason + ')' : ''}`);
      else if (ageInDays(b.fetched_at, now) > L.rates) add('rates.json', 'warning', `Курс ${key.slice(0, 3).toUpperCase()} не обновлялся ${days(ageInDays(b.fetched_at, now))} (порог ${L.rates}) — проверьте workflow Data refresh`);
    }
  }

  /* 2. Налоги и ставки по годам: на текущий год значение должно быть; с декабря напоминаем о следующем годе */
  const tax = (d.rates && d.rates.tax) || {};
  for (const [key, entry] of Object.entries(tax)) {
    if (!entry || typeof entry !== 'object' || !entry.years) continue;
    const cur = entry.years[String(year)];
    if (!cur) add('rates.json', 'warning', `tax.${key}: нет значения на ${year} год — сверить по первоисточнику`);
    else if (cur.valid_to && Date.parse(cur.valid_to + 'T23:59:59Z') < now) add('rates.json', 'warning', `tax.${key}: значение ${year} года действует до ${cur.valid_to} — срок прошёл`);
    const next = entry.years[String(year + 1)];
    const decemberOrLater = new Date(now).getUTCMonth() === 11;
    if (decemberOrLater && (!next || next.status === 'no_data')) add('rates.json', 'notice', `tax.${key}: на ${year + 1} год значение не внесено — внести после публикации`);
  }

  /* 3. Новости — ежедневно; отдельные ленты могут молчать (часто — недоступность сайтов ведомств из-за рубежа) */
  const news = d.news;
  if (news) {
    const age = ageInDays(news.updated_at, now);
    if (news.stale) add('news.json', 'warning', `Ни одна лента новостей не ответила${news.stale_since ? ' с ' + String(news.stale_since).slice(0, 10) : ''} — показаны прежние записи`);
    else if (age > L.news) add('news.json', 'warning', `Новости не обновлялись ${Number.isFinite(age) ? days(age) : '(даты нет)'} (порог ${L.news})`);
    for (const s of Array.isArray(news.sources) ? news.sources : []) {
      if (s.status !== 'error') continue;
      const okAge = ageInDays(s.last_ok_at, now);
      if (!Number.isFinite(okAge) || okAge > L.news_source) {
        add('news.json', 'warning', `Лента «${s.name}» не отвечает ${Number.isFinite(okAge) ? days(okAge) : 'с первого запуска'}: ${s.error || 'ошибка'}`);
      }
    }
  }

  /* 4. Потенциальные клиенты — еженедельно */
  const leads = d.leads;
  if (leads) {
    const age = ageInDays(leads.updated_at, now);
    if (leads.stale || age > L.leads) {
      add('leads.json', 'warning', `«Потенциальные клиенты» не обновлялись ${Number.isFinite(age) ? days(age) : '(даты нет)'} (порог ${L.leads}) — проверьте workflow Weekly refresh${leads.stale_reason ? ': ' + leads.stale_reason : ''}`);
    }
  }

  /* 5. Конкуренты: автопроверка сайтов — еженедельно; ручные цены — сверка раз в месяц */
  const comp = d.competitors;
  if (comp) {
    const all = COMP_GROUPS.flatMap(k => (Array.isArray(comp[k]) ? comp[k] : []));
    const checked = all.filter(x => x && x.check_status && x.check_status !== 'skipped_policy' && x.checked_at);
    if (checked.length && checked.every(x => ageInDays(x.checked_at, now) > L.competitors_check)) {
      add('competitors.json', 'warning', `Автопроверка сайтов конкурентов не выполнялась более ${L.competitors_check} дн. — проверьте workflow Weekly refresh`);
    }
    const oldPrices = all.flatMap(x => (Array.isArray(x && x.prices) ? x.prices : []))
      .filter(p => p && p.value !== null && p.value !== undefined && ageInDays(p.fetched_at || p.date, now) > L.prices);
    if (oldPrices.length) add('competitors.json', 'notice', `Цены конкурентов старше ${L.prices} дн.: ${oldPrices.length} шт. — сверить вручную (раз в месяц)`);
  }

  /* 6. Гранты: ручная сверка раз в порог; «открыт» после последней даты окна — статус устарел */
  const grants = d.market && d.market.grants;
  if (grants) {
    const age = ageInDays(grants.fetched_at, now);
    if (age > L.grants) add('market.json', 'warning', `Окна грантов сверялись ${Number.isFinite(age) ? days(age) + ' назад' : '(даты нет)'} (порог ${L.grants}) — сверить вручную`);
    for (const p of Array.isArray(grants.programs) ? grants.programs : []) {
      const end = lastDateInText(p.window);
      if (p.status === 'open' && end !== null && end < now) add('market.json', 'warning', `Грант «${p.name}»: приём закрылся (${p.window}), а статус всё ещё «открыт» — обновить`);
    }
  }

  /* 7. Календарь каникул: текущий год, а за 60 дней до конца года — и следующий (официального машиночитаемого источника нет) */
  const sh = d.seasonality && d.seasonality.school_holidays;
  if (d.seasonality) {
    const loaded = yr => !!(sh && sh[String(yr)] && sh[String(yr)].loaded !== false && Array.isArray(sh[String(yr)].items) && sh[String(yr)].items.length);
    const daysLeft = Math.ceil((Date.UTC(year + 1, 0, 1) - now) / 864e5);
    const missing = [];
    if (!loaded(year)) missing.push(year);
    if (daysLeft <= 60 && !loaded(year + 1)) missing.push(year + 1);
    if (missing.length) add('seasonality.json', 'warning', `Календарь школьных каникул на ${missing.join(' и ')} не загружен — внесите даты вручную по do.nios.ru (см. DATA_SOURCES.md, раздел «Каникулы»)`);
  }

  return out;
}

/* Читает все data/*.json каталога в объект { имя: содержимое } (битый файл пропускается — его ловит touch-meta) */
export function readDataDir(dir = DATA_DIR) {
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter(n => n.endsWith('.json'))) {
    try { out[f.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(dir, f), 'utf-8')); } catch (e) { /* невалидный JSON — отдельная проверка */ }
  }
  return out;
}

/* Ручной запуск: печать находок человеческим списком */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const found = auditFreshness(readDataDir());
  if (!found.length) console.log('Свежесть данных: всё в пределах договорённых сроков');
  for (const f of found) console.log(`${f.level === 'warning' ? '!' : '·'} data/${f.file}: ${f.message}`);
}
