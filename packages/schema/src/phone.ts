import { z } from "./zod.ts";

/**
 * Приводит номер к международному виду +84912345678.
 *
 * - «+…» и «00…» — уже международный номер, оставляем как есть;
 * - «0…» — местный номер страны магазина: 0912 345 678 → +84 912 345 678;
 * - начинается с кода страны магазина — международный без плюса (так номер отдаёт Telegram);
 * - 11 цифр с «89» — российский мобильный по привычке (8 999 …) → +7 999 …;
 * - короче 10 цифр — местный номер без нуля, добавляем код страны.
 *
 * `countryCode` — код страны магазина без плюса (settings.region.phoneCode), по умолчанию 84.
 * Возвращает null, если цифр в итоге меньше 10 или больше 15 (E.164).
 */
export function normalizePhone(input: string, countryCode = "84"): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");
  let result: string;
  if (trimmed.startsWith("+")) result = digits;
  else if (digits.startsWith("00")) result = digits.slice(2);
  else if (digits.startsWith("0")) result = countryCode + digits.slice(1);
  else if (digits.startsWith(countryCode) && digits.length >= 10) result = digits;
  else if (digits.length === 11 && digits.startsWith("89")) result = `7${digits.slice(1)}`;
  else if (digits.length < 10) result = countryCode + digits;
  else result = digits;
  if (result.length < 10 || result.length > 15) return null;
  return `+${result}`;
}

/** Телефон покупателя или магазина: принимает любую запись, хранит нормализованную. */
export function phoneSchema(countryCode = "84") {
  return z
    .string()
    .trim()
    .min(1, { error: "Без телефона курьер не сможет передать заказ" })
    .transform((value, ctx) => {
      const phone = normalizePhone(value, countryCode);
      if (phone === null) {
        ctx.issues.push({
          code: "custom",
          input: value,
          message: "Номер неполный — проверьте цифры",
        });
        return z.NEVER;
      }
      return phone;
    });
}

/**
 * Номер для показа: +84912345678 → «+84 91 234 56 78», +79993334455 → «+7 999 333 44 55».
 * Хранится номер без пробелов (normalizePhone), этот вид — только на экране.
 * Код страны берётся из настроек магазина; чужой или непонятный номер возвращается как есть.
 */
export function formatPhone(phone: string, countryCode = "84"): string {
  const m = /^\+(\d{10,15})$/.exec(phone);
  if (!m?.[1]) return phone;
  const digits = m[1];
  const code = digits.startsWith(countryCode)
    ? countryCode
    : digits.length === 11 && digits.startsWith("7")
      ? "7"
      : null;
  if (code === null) return phone;
  const rest = digits.slice(code.length);
  if (rest.length < 7) return phone;
  const tail = [rest.slice(-7, -4), rest.slice(-4, -2), rest.slice(-2)];
  const head = rest.slice(0, -7);
  return [`+${code}`, head, ...tail].filter(Boolean).join(" ");
}
