import { z } from "./zod.ts";

/**
 * Деньги — целое число в минорных единицах валюты (копейках, центах).
 * Никаких float: 1990 ₽ хранится как 199000.
 */
export type Minor = number;

export const MoneySchema = z
  .int({ error: "Сумма — целое число в копейках (минорных единицах), например 199000 = 1990 ₽" })
  .min(0, { error: "Сумма не может быть отрицательной" })
  .max(1_000_000_000_000)
  .meta({ description: "Целое число в минорных единицах валюты: 199000 = 1990 ₽" });

const digitsCache = new Map<string, number>();

/** Сколько знаков после запятой у валюты: RUB, USD → 2, JPY → 0. */
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

/** 199000, "RUB", "ru-RU" → "1 990 ₽"; копейки показываются, только если они есть. */
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
 * Ввод в рублях из формы → минорные единицы. Понимает "1990", "1 990,50", "1990.5".
 * Возвращает null, если строка не похожа на сумму или знаков после запятой больше, чем у валюты.
 * Считает строками, без float, чтобы 0.1 + 0.2 не превратились в 0.30000000000000004.
 */
export function toMinor(input: string | number, currency: string): Minor | null {
  const digits = currencyDigits(currency);
  const raw = typeof input === "number" ? String(input) : input;
  const normalized = raw.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
  const match = /^(\d+)(?:\.(\d*))?$/.exec(normalized);
  if (!match) return null;
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > digits) return null;
  const minor = Number(whole + fraction.padEnd(digits, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Минорные единицы → строка для поля ввода: 199050 → "1990.50", 199000 → "1990". */
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
