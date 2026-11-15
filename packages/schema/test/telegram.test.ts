import { describe, expect, it } from "vitest";
import { normalizeTelegramUsername, telegramLink, telegramUsernameSchema } from "../src/index.ts";

describe("Telegram менеджера", () => {
  it("принимает @имя, имя и ссылку t.me — хранит без @", () => {
    expect(normalizeTelegramUsername("@pechka_manager")).toBe("pechka_manager");
    expect(normalizeTelegramUsername(" pechka_manager ")).toBe("pechka_manager");
    expect(normalizeTelegramUsername("t.me/pechka_manager")).toBe("pechka_manager");
    expect(normalizeTelegramUsername("https://t.me/pechka_manager?start=1")).toBe("pechka_manager");
    expect(normalizeTelegramUsername("https://telegram.me/Pechka_Manager/")).toBe("Pechka_Manager");
  });

  it("телефон и мусор — не имя пользователя", () => {
    expect(normalizeTelegramUsername("+84 905 123 456")).toBeNull();
    expect(normalizeTelegramUsername("1pechka")).toBeNull();
    expect(normalizeTelegramUsername("abc")).toBeNull();
    expect(normalizeTelegramUsername("pechka_")).toBeNull();
    expect(normalizeTelegramUsername("печка_менеджер")).toBeNull();
  });

  it("пустое поле — не задано, неверное — понятная ошибка", () => {
    expect(telegramUsernameSchema.parse("")).toBeUndefined();
    expect(telegramUsernameSchema.parse(undefined)).toBeUndefined();
    expect(telegramUsernameSchema.safeParse("+84905123456").error?.issues[0]?.message).toBe(
      "Нужно имя пользователя Telegram, например @pechka_manager",
    );
  });

  it("ссылка на чат", () => {
    expect(telegramLink("pechka_manager")).toBe("https://t.me/pechka_manager");
  });
});
