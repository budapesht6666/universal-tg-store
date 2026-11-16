import { describe, expect, it } from "vitest";
import {
  dishStartParam,
  normalizeTelegramUsername,
  parseStartParam,
  telegramLink,
  telegramUsernameSchema,
} from "../src/index.ts";

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

describe("ссылка на блюдо: startapp", () => {
  it("dish_<id> туда и обратно", () => {
    expect(dishStartParam("borscht")).toBe("dish_borscht");
    expect(parseStartParam(dishStartParam("lunch-kids"))).toEqual({ dishId: "lunch-kids" });
  });

  it("самый длинный id помещается в ограничения Telegram", () => {
    const id = `a${"-b".repeat(31)}a`; // 64 символа — максимум IdSchema
    expect(id).toHaveLength(64);
    const param = dishStartParam(id);
    expect(param).toMatch(/^[A-Za-z0-9_-]{1,512}$/);
    expect(parseStartParam(param)).toEqual({ dishId: id });
  });

  it("чужие и испорченные параметры — null", () => {
    for (const bad of [
      undefined,
      null,
      "",
      "dish_",
      "order_15",
      "dish_Борщ",
      "dish_UPPER",
      "dish_a b",
      `dish_${"a".repeat(65)}`,
    ]) {
      expect(parseStartParam(bad)).toBeNull();
    }
  });
});
