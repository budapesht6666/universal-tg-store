import { z } from "./zod.ts";

/**
 * Деньги — целое число в минимальных единицах валюты. Сколько их в одной «большой» единице,
 * берётся из стандарта валюты: у донга дробной части нет (65 000 ₫ = 65000),
 * у рубля — копейки (1990 ₽ = 199000). Никаких float.
 */
export type Minor = number;

export const MoneySchema = z
  .int({
    error:
      "Сумма — целое число в минимальных единицах валюты: 65000 = 65 000 ₫, 199000 = 1990 ₽ (в копейках)",
  })
  .min(0, { error: "Сумма не может быть отрицательной" })
  .max(1_000_000_000_000)
  .meta({
    description: "Целое число в минимальных единицах валюты: 65000 = 65 000 ₫; 199000 = 1990 ₽",
  });

const digitsCache = new Map<string, number>();

/** Сколько знаков после запятой у валюты: RUB, USD → 2, VND, JPY → 0. */
export function currencyDigits(currency: string): number {
  let digits = digitsCache.get(currency);
  if (digits === undefined) {
    digits =
      new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    digitsCache.set(currency, digits);
  }
  return digits;
}

/** 65000, "VND", "ru-RU" → "65 000 ₫"; дробная часть показывается, только если она есть. */
export function formatMoney(minor: Minor, currency: string, locale: string): string {
  const digits = currencyDigits(currency);
  const factor = 10 ** digits;
  const hasFraction = minor % factor !== 0;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: hasFraction ? digits : 0,
    maximumFractionDigits: digits,
  }).format(minor / factor);
}

/**
 * Ввод из формы → минимальные единицы валюты. Понимает "65000", "65.000", "65 000", "1 990,50".
 *
 * Разделители: если в строке есть и точка, и запятая — последний знак дробный, остальные
 * разделяют тысячи. Если знак один и делит число на правильные группы тысяч (1–3 цифры,
 * дальше ровно по три), а у валюты меньше трёх знаков после запятой — это тысячи
 * ("65.000" ₫ = 65000). "1990.555" — не тысячи, а лишние дробные знаки → null.
 * Возвращает null, если строка не похожа на сумму или дробных знаков больше, чем у валюты.
 * Считает строками, без float, чтобы 0.1 + 0.2 не превратились в 0.30000000000000004.
 */
export function toMinor(input: string | number, currency: string): Minor | null {
  const digits = currencyDigits(currency);
  const raw = typeof input === "number" ? String(input) : input;
  const compact = raw.replace(/\s/g, "");
  if (!/^\d[\d.,]*$/.test(compact)) return null;

  const lastDot = compact.lastIndexOf(".");
  const lastComma = compact.lastIndexOf(",");
  const decimalAt = Math.max(lastDot, lastComma);
  let whole = compact;
  let fraction = "";
  if (decimalAt !== -1) {
    const mixed = lastDot !== -1 && lastComma !== -1;
    const repeated = compact.indexOf(compact.charAt(decimalAt)) !== decimalAt;
    const tail = compact.slice(decimalAt + 1);
    // Тысячи — только если группы правильные: 1–3 цифры, дальше ровно по три ("1.250.000").
    const groups = compact.split(compact.charAt(decimalAt));
    const validGroups =
      /^[1-9]\d{0,2}$/.test(groups[0] ?? "") && groups.slice(1).every((g) => g.length === 3);
    const isThousands = !mixed && validGroups && (repeated || digits < 3);
    if (!isThousands) {
      whole = compact.slice(0, decimalAt);
      fraction = tail;
    }
  }
  whole = whole.replace(/[.,]/g, "");
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction)) return null;
  if (fraction.length > digits) return null;
  const minor = Number(whole + fraction.padEnd(digits, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Минимальные единицы → строка для поля ввода: 199050 RUB → "1990.50", 65000 VND → "65000". */
export function fromMinor(minor: Minor, currency: string): string {
  const digits = currencyDigits(currency);
  if (digits === 0) return String(minor);
  const factor = 10 ** digits;
  const whole = Math.trunc(minor / factor);
  const fraction = Math.abs(minor % factor);
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(digits, "0")}`;
}

/** Процент скидки для бейджа «−20%». */
export function discountPercent(price: Minor, compareAtPrice: Minor): number {
  if (compareAtPrice <= price || compareAtPrice === 0) return 0;
  return Math.round((1 - price / compareAtPrice) * 100);
}
