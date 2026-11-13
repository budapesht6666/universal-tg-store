import type * as z from "zod";

/** Склонение: plural(5, "символ", "символа", "символов") → "символов". */
export function plural(n: number, one: string, few: string, many: string): string {
  const n10 = Math.abs(n) % 10;
  const n100 = Math.abs(n) % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

const EXPECTED: Record<string, string> = {
  string: "Нужен текст",
  number: "Нужно число",
  int: "Нужно целое число",
  boolean: "Нужно true или false",
  array: "Нужен список",
  object: "Нужен объект",
  date: "Нужна дата",
};

const FORMATS: Record<string, string> = {
  url: "Нужна ссылка вида https://…",
  email: "Нужен адрес почты",
  datetime: "Нужны дата и время в формате ISO, например 2026-11-14T10:00:00Z",
  date: "Нужна дата в формате ГГГГ-ММ-ДД",
  regex: "Неверный формат",
};

/**
 * Понятные сообщения для частых ошибок. Встроенная русская локаль zod остаётся запасной:
 * если здесь сообщения нет (`undefined`), zod берёт его из локали.
 */
export const russianErrorMap = (issue: z.core.$ZodRawIssue): string | undefined => {
  switch (issue.code) {
    case "invalid_type":
      if (issue.input === undefined) return "Обязательное поле";
      return EXPECTED[issue.expected];
    case "too_small": {
      const min = Number(issue.minimum);
      if (issue.origin === "string") {
        return min <= 1
          ? "Не может быть пустым"
          : `Минимум ${min} ${plural(min, "символ", "символа", "символов")}`;
      }
      if (issue.origin === "array" || issue.origin === "set") {
        return min <= 1
          ? "Нужен хотя бы один элемент"
          : `Нужно хотя бы ${min} ${plural(min, "элемент", "элемента", "элементов")}`;
      }
      if (issue.origin === "number" || issue.origin === "int" || issue.origin === "bigint") {
        return issue.inclusive ? `Не меньше ${min}` : `Больше ${min}`;
      }
      return undefined;
    }
    case "too_big": {
      const max = Number(issue.maximum);
      if (issue.origin === "string") {
        return `Не длиннее ${max} ${plural(max, "символа", "символов", "символов")}`;
      }
      if (issue.origin === "array" || issue.origin === "set") {
        return `Не больше ${max} ${plural(max, "элемента", "элементов", "элементов")}`;
      }
      if (issue.origin === "number" || issue.origin === "int" || issue.origin === "bigint") {
        return issue.inclusive ? `Не больше ${max}` : `Меньше ${max}`;
      }
      return undefined;
    }
    case "invalid_format":
      return FORMATS[issue.format];
    case "invalid_value":
      return `Допустимые значения: ${issue.values.map((v) => String(v)).join(", ")}`;
    case "unrecognized_keys":
      return issue.keys.length === 1
        ? `Неизвестное поле «${issue.keys[0]}» — проверьте написание`
        : `Неизвестные поля: ${issue.keys.map((k) => `«${k}»`).join(", ")} — проверьте написание`;
    case "not_multiple_of":
      return `Должно быть кратно ${String(issue.divisor)}`;
    case "invalid_union":
      return "Значение не подходит ни под один из вариантов";
    default:
      return undefined;
  }
};
