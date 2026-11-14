import { describe, expect, it } from "vitest";
import {
  currencyDigits,
  discountPercent,
  formatMoney,
  fromMinor,
  MoneySchema,
  toMinor,
} from "../src/index.ts";

const nbsp = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

describe("деньги", () => {
  it("форматирует без копеек, если их нет", () => {
    expect(nbsp(formatMoney(199000, "RUB", "ru-RU"))).toBe("1 990 ₽");
  });

  it("показывает копейки, если они есть", () => {
    expect(nbsp(formatMoney(199050, "RUB", "ru-RU"))).toBe("1 990,50 ₽");
  });

  it("учитывает валюты без минорных единиц", () => {
    expect(currencyDigits("JPY")).toBe(0);
    expect(formatMoney(1990, "JPY", "en-US")).toBe("¥1,990");
  });

  it("переводит ввод из формы в копейки без ошибок float", () => {
    expect(toMinor("1990", "RUB")).toBe(199000);
    expect(toMinor("1 990,5", "RUB")).toBe(199050);
    expect(toMinor("0.1", "RUB")).toBe(10);
    expect(toMinor(19.99, "RUB")).toBe(1999);
    expect(toMinor("1990.555", "RUB")).toBeNull();
    expect(toMinor("-5", "RUB")).toBeNull();
    expect(toMinor("abc", "RUB")).toBeNull();
  });

  it("донги: без дробной части, точка и запятая — разделители тысяч", () => {
    expect(currencyDigits("VND")).toBe(0);
    expect(nbsp(formatMoney(65000, "VND", "ru-RU"))).toBe("65 000 ₫");
    expect(toMinor("65000", "VND")).toBe(65000);
    expect(toMinor("65.000", "VND")).toBe(65000);
    expect(toMinor("65,000", "VND")).toBe(65000);
    expect(toMinor("1.250.000", "VND")).toBe(1250000);
    expect(toMinor("65 000", "VND")).toBe(65000);
    expect(toMinor("65000.5", "VND")).toBeNull();
    expect(fromMinor(65000, "VND")).toBe("65000");
  });

  it("смешанные разделители: последний — дробный", () => {
    expect(toMinor("1.990,50", "RUB")).toBe(199050);
    expect(toMinor("1,990.50", "USD")).toBe(199050);
    expect(toMinor("1.990", "RUB")).toBe(199000);
    expect(toMinor("0.125", "USD")).toBeNull();
  });

  it("и обратно — для поля ввода", () => {
    expect(fromMinor(199000, "RUB")).toBe("1990");
    expect(fromMinor(199005, "RUB")).toBe("1990.05");
    expect(fromMinor(1990, "JPY")).toBe("1990");
  });

  it("принимает только целые неотрицательные суммы", () => {
    expect(MoneySchema.safeParse(199000).success).toBe(true);
    expect(MoneySchema.safeParse(1990.5).error?.issues[0]?.message).toMatch(/копейках/);
    expect(MoneySchema.safeParse(-1).error?.issues[0]?.message).toBe(
      "Сумма не может быть отрицательной",
    );
  });

  it("считает процент скидки", () => {
    expect(discountPercent(199000, 249000)).toBe(20);
    expect(discountPercent(199000, 199000)).toBe(0);
  });
});
