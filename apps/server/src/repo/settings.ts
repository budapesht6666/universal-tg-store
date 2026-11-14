import { type Settings, type ShopStatus, shopStatus } from "@store/schema";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { settings } from "../db/schema.ts";

export type ShopState = { settings: Settings; pausedUntil: Date | null };

/** Настройки магазина; null — первая настройка ещё не пройдена. */
export function getShop(db: Db): ShopState | null {
  const row = db.select().from(settings).where(eq(settings.id, 1)).get();
  return row ? { settings: row.data, pausedUntil: row.pausedUntil } : null;
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
