/**
 * Заблокировавшим бота ничего не отправляем (урок diverBot: настойчивые сообщения → блокировки).
 * Узнаём о блокировке двумя путями: событие my_chat_member (kicked) и ошибка 403 при отправке.
 * Человек снова написал боту или разблокировал его (member) — отметка снимается.
 */
import { eq } from "drizzle-orm";
import type { Transformer } from "grammy";
import type { Db } from "../db/client.ts";
import { users } from "../db/schema.ts";
import type { Deps } from "../deps.ts";

const BLOCKED = /bot was blocked by the user|user is deactivated/i;

/** Методы, которые пишут человеку в личку. Правку и удаление уже отправленного не трогаем. */
const SENDS = new Set([
  "sendMessage",
  "copyMessage",
  "forwardMessage",
  "sendPhoto",
  "sendDocument",
  "sendLocation",
  "sendContact",
  "sendMediaGroup",
  "sendVideo",
  "sendAudio",
  "sendVoice",
  "sendSticker",
  "sendAnimation",
]);

export function setBotBlocked(db: Db, userId: number, blockedAt: Date | null): void {
  db.update(users).set({ botBlockedAt: blockedAt }).where(eq(users.id, userId)).run();
}

export function isBotBlocked(db: Db, userId: number): boolean {
  const row = db.select({ at: users.botBlockedAt }).from(users).where(eq(users.id, userId)).get();
  return row?.at != null;
}

/**
 * Преобразователь запросов Bot API: отправку заблокировавшему не делаем (ответ как у Telegram —
 * 403, вызывающий код уже умеет это переживать), а 403 «bot was blocked» запоминаем.
 */
export function blockedGuard(deps: Pick<Deps, "db" | "now">): Transformer {
  return async (prev, method, payload, signal) => {
    const chatId =
      SENDS.has(method) && payload && typeof payload === "object" && "chat_id" in payload
        ? payload.chat_id
        : null;
    // Личный чат — положительный id (группы и каналы — отрицательные).
    const userId = typeof chatId === "number" && chatId > 0 ? chatId : null;
    if (userId !== null && isBotBlocked(deps.db, userId)) {
      // Ответ той же формы, что вернул бы Telegram.
      return {
        ok: false,
        error_code: 403,
        description: "Forbidden: bot was blocked by the user",
      } as never;
    }
    const res = await prev(method, payload, signal);
    if (userId !== null && !res.ok && res.error_code === 403 && BLOCKED.test(res.description)) {
      setBotBlocked(deps.db, userId, deps.now());
    }
    return res;
  };
}

/** Ошибка отправки из-за блокировки — не шум в логах, а ожидаемый случай. */
export function isBlockedError(err: unknown): boolean {
  return BLOCKED.test(String(err));
}
