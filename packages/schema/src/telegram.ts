/**
 * Аккаунт менеджера в Telegram — контакт магазина для покупателей. Телефон магазина нигде
 * не показываем: вопрос по заказу покупатель пишет в чат с ботом, другой вопрос — менеджеру.
 */
import { z } from "./zod.ts";

/** Имя пользователя Telegram: 4–32 символа, латиница, цифры и «_», начинается с буквы. */
const USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

/**
 * «@pechka_manager», «pechka_manager», «t.me/pechka_manager», «https://t.me/pechka_manager»
 * → «pechka_manager»; не похоже на имя пользователя — null.
 */
export function normalizeTelegramUsername(raw: string): string | null {
  const name = raw
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\//i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "");
  return USERNAME.test(name) && !name.endsWith("_") ? name : null;
}

/** Ссылка на чат: в Mini App открывается через openTelegramLink, в боте — как текст. */
export function telegramLink(username: string): string {
  return `https://t.me/${username}`;
}

/** Необязательное поле «аккаунт в Telegram»: пустая строка — не задано. Храним без @. */
export const telegramUsernameSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === "") return undefined;
    const name = normalizeTelegramUsername(value);
    if (name === null) {
      ctx.issues.push({
        code: "custom",
        input: value,
        message: "Нужно имя пользователя Telegram, например @pechka_manager",
      });
      return z.NEVER;
    }
    return name;
  })
  .optional();
