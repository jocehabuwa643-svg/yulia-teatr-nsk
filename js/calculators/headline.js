/* headline.js — форматирование главной цифры результата по её типу (чистый модуль, без DOM).
   Тип задаёт модуль калькулятора (meta.headline):
     result — итог со знаком (прибыль, остаток): «+3 925 ₽» / «−964 900 ₽»;
     amount — сумма или цена без плюса (налог, стоимость команды, цена билета): «380 ₽»;
     count  — целое число без валюты (конкурсы, штуки): «2».
   Нет значения (null/NaN) → текст empty, а не «0 ₽». */
import { ruNum } from './util.js';

export const HEADLINE_KINDS = ['result', 'amount', 'count'];
const NBSP = '\u00a0';
const MINUS = '\u2212';

/* Округлённое значение с настоящим минусом; отрицательный ноль («−0») не выводится */
function body(v) {
  const r = Math.round(v);
  return `${r < 0 ? MINUS : ''}${ruNum(Math.abs(r), 0)}`;
}

export function formatHeadline(kind, v, empty = 'нет данных') {
  if (v == null || !Number.isFinite(v)) return empty;
  const r = Math.round(v);
  if (kind === 'count') return body(v);
  if (kind === 'result') return `${r > 0 ? '+' : ''}${body(v)}${NBSP}₽`;
  return `${body(v)}${NBSP}₽`;
}

/* Дробные тысячи для ячеек тепловой карты: «12к», «−3к»; малые отрицательные (|v| < 500) дают «0к», а не «−0к» */
export function thousands(v) {
  const k = Math.round(v / 1e3);
  return `${k < 0 ? MINUS : ''}${ruNum(Math.abs(k), 0)}к`;
}
