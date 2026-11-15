import { type Settings, SettingsSchema, type ShopStatus, shopStatus } from "@store/schema";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { settings } from "../db/schema.ts";

export type ShopState = { settings: Settings; pausedUntil: Date | null };

/** Настройки магазина; null — первая настройка ещё не пройдена. */
export function getShop(db: Db): ShopState | null {
  const row = db.select().from(settings).where(eq(settings.id, 1)).get();
  if (!row) return null;
  // Настройки, сохранённые до появления нового флага, получают его значение по умолчанию.
  const parsed = SettingsSchema.safeParse(upgrade(row.data));
  return { settings: parsed.success ? parsed.data : row.data, pausedUntil: row.pausedUntil };
}

/** Строка старого приветствия по умолчанию: обещала ответ на любой вопрос, а пишут теперь только по заказу. */
const OLD_GREETING_LINE = "Есть вопрос? Просто напишите сюда — ответит менеджер.";
const NEW_GREETING_LINE = "Вопрос по заказу? Напишите сюда — ответит менеджер.";

/**
 * Старые настройки → текущий формат. Убранные поля отрезаем, иначе strictObject отверг бы их,
 * и сохранить настройки было бы нельзя.
 */
function upgrade(data: unknown): unknown {
  if (typeof data !== "object" || data === null || !("shop" in data)) return data;
  if (typeof data.shop !== "object" || data.shop === null) return data;
  // Телефон магазина больше не храним и не показываем (15.11.2026) — контакт теперь shop.manager.
  const { phone: _phone, ...shop } = data.shop as Record<string, unknown>;
  if (typeof shop.greeting === "string") {
    shop.greeting = shop.greeting.replace(OLD_GREETING_LINE, NEW_GREETING_LINE);
  }
  return { ...data, shop };
}

export function saveSettings(db: Db, data: Settings, now: Date): void {
  db.insert(settings)
    .values({ id: 1, data, updatedAt: now })
    .onConflictDoUpdate({ target: settings.id, set: { data, updatedAt: now } })
    .run();
}

export function setPause(db: Db, until: Date | null, now: Date): void {
  db.update(settings).set({ pausedUntil: until, updatedAt: now }).where(eq(settings.id, 1)).run();
}

export function statusOf(state: ShopState, now: Date): ShopStatus {
  const { hours, region } = state.settings;
  return shopStatus(hours, region.timeZone, now, state.pausedUntil);
}
