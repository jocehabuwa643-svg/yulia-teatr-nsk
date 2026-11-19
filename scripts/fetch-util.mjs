/* fetch-util.mjs — общие помощники для скриптов обновления данных (fetch-*.mjs).
   Только Node ≥ 20, без зависимостей. Правила: таймаут 10 с, ретраи с экспоненциальной паузой
   и джиттером, 4xx (кроме 408/429) не повторяются, данные не затираются при сбое источника. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/* Каталог данных; DATA_DIR позволяет прогнать скрипт на копии (сухой прогон), не трогая репозиторий */
export const DATA_DIR = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(ROOT, 'data');

export const TIMEOUT_MS = 10_000;
export const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Пауза перед повтором: 500 мс × 2^n + джиттер до 25 % */
export function backoffDelay(attempt) {
  const base = BASE_DELAY_MS * 2 ** attempt;
  return base + Math.floor(Math.random() * base * 0.25);
}

/* fetch с таймаутом и ретраями. Возвращает Response (ok) либо бросает Error с понятным текстом.
   Повторяем: сетевые ошибки, таймаут, 5xx, 408, 429. Остальные 4xx — сразу ошибка. */
export async function fetchRetry(url, options = {}, { retries = MAX_RETRIES, timeout = TIMEOUT_MS, label = url } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
      if (res.ok) return res;
      const retryable = res.status >= 500 || res.status === 408 || res.status === 429;
      lastErr = new Error(`${label}: HTTP ${res.status}`);
      if (!retryable) throw Object.assign(lastErr, { fatal: true });
    } catch (e) {
      if (e && e.fatal) throw e;
      lastErr = new Error(`${label}: ${e && e.name === 'TimeoutError' ? `таймаут ${timeout} мс` : (e && e.message) || e}`);
    }
    if (attempt < retries) {
      const d = backoffDelay(attempt);
      console.error(`${lastErr.message} — повтор ${attempt + 1}/${retries} через ${d} мс`);
      await sleep(d);
    }
  }
  throw lastErr;
}

export function readJson(file) {
  if (!existsSync(file)) throw new Error(`нет файла ${file}`);
  return JSON.parse(readFileSync(file, 'utf-8'));
}

/* Пишет JSON только если содержимое изменилось. Возвращает true, если файл перезаписан */
export function writeJsonIfChanged(file, obj) {
  const next = JSON.stringify(obj, null, 2) + '\n';
  const prev = existsSync(file) ? readFileSync(file, 'utf-8') : null;
  if (prev === next) return false;
  writeFileSync(file, next);
  return true;
}

/* Помечает блок с провенансом устаревшим, сохраняя прежние значения.
   stale_since ставится один раз — в момент первого сбоя — и не сдвигается при повторных. */
export function markStale(block, reason, nowIso = new Date().toISOString()) {
  block.stale = true;
  if (!block.stale_since) block.stale_since = nowIso;
  block.stale_reason = String(reason).slice(0, 200);
  return block;
}

/* Снимает пометку устаревания после успешного обновления */
export function clearStale(block) {
  block.stale = false;
  delete block.stale_since;
  delete block.stale_reason;
  return block;
}
