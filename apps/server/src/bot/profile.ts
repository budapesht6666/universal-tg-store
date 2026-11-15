/**
 * Профиль бота из настроек магазина: имя, «О себе» и текст в пустом чате.
 * Ставится при запуске и после сохранения настроек. Меняем только то, что отличается:
 * у setMyName и соседей жёсткий лимит частоты (429).
 * Аватар так не синхронизируем: каждый setMyProfilePhoto добавляет новое фото — его ставят
 * один раз в BotFather (/setuserpic).
 */
import type { Api } from "grammy";
import type { Deps } from "../deps.ts";
import { getShop } from "../repo/settings.ts";

export async function syncBotProfile(api: Api, deps: Deps): Promise<void> {
  const shop = getShop(deps.db);
  if (!shop) return;
  const { name, botAbout, botDescription } = shop.settings.shop;
  const [current, description, short] = await Promise.all([
    api.getMyName(),
    api.getMyDescription(),
    api.getMyShortDescription(),
  ]);
  if (current.name !== name) await api.setMyName(name);
  if (description.description !== botDescription) await api.setMyDescription(botDescription);
  if (short.short_description !== botAbout) await api.setMyShortDescription(botAbout);
}
