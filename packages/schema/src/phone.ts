import { z } from "./zod.ts";

/**
 * Приводит номер к виду +79991234567. Российские «8XXXXXXXXXX» и «9XXXXXXXXX» → +7….
 * Возвращает null, если цифр меньше 10 или больше 15 (E.164).
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  let result = digits;
  if (digits.length === 11 && digits.startsWith("8")) result = `7${digits.slice(1)}`;
  else if (digits.length === 10 && digits.startsWith("9")) result = `7${digits}`;
  if (result.length < 10 || result.length > 15) return null;
  return `+${result}`;
}

/** Телефон в оформлении и настройках: принимает любую запись, хранит нормализованную. */
export const PhoneSchema = z
  .string()
  .trim()
  .min(1, { error: "Без телефона курьер не сможет передать заказ" })
  .transform((value, ctx) => {
    const phone = normalizePhone(value);
    if (phone === null) {
      ctx.issues.push({
        code: "custom",
        input: value,
        message: "Номер неполный — нужно от 10 до 15 цифр",
      });
      return z.NEVER;
    }
    return phone;
  });
