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

/** Убранные поля старых настроек. Иначе strictObject отверг бы их, и сохранить настройки было бы нельзя. */
function upgrade(data: unknown): unknown {
  if (typeof data !== "object" || data === null || !("shop" in data)) return data;
  const shop = data.shop;
  if (typeof shop !== "object" || shop === null || !("phone" in shop)) return data;
  // Телефон магазина больше не храним и не показываем (15.11.2026) — контакт теперь shop.manager.
  const { phone: _phone, ...rest } = shop;
  return { ...data, shop: rest };
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
