import { describe, expect, it } from "vitest";
import {
  AnalyticsBatchSchema,
  AnalyticsPeriodSchema,
  CartSnapshotSchema,
  can,
  MAX_EVENTS_PER_BATCH,
  percentChange,
  sourceOf,
} from "../src/index.ts";

describe("источник захода", () => {
  it("кнопка меню, ссылка на блюдо, своя метка, другое", () => {
    expect(sourceOf(null)).toEqual({ key: "menu", label: "Кнопка «Меню» в боте" });
    expect(sourceOf("")).toEqual({ key: "menu", label: "Кнопка «Меню» в боте" });
    expect(sourceOf("dish_borscht")).toEqual({ key: "dish", label: "Ссылки на блюда" });
    expect(sourceOf("src_instagram")).toEqual({ key: "src_instagram", label: "instagram" });
    expect(sourceOf("src_")).toEqual({ key: "other", label: "Другое" });
    expect(sourceOf("promo42")).toEqual({ key: "other", label: "Другое" });
  });
});

describe("события и корзина", () => {
  it("пачка: типы, лимит, параметр startapp", () => {
    expect(AnalyticsBatchSchema.safeParse({ events: [{ type: "visit" }] }).success).toBe(true);
    expect(
      AnalyticsBatchSchema.safeParse({ events: [{ type: "cart_add", productId: "borscht" }] })
        .success,
    ).toBe(true);
    expect(AnalyticsBatchSchema.safeParse({ events: [{ type: "order" }] }).success).toBe(false);
    expect(AnalyticsBatchSchema.safeParse({ events: [] }).success).toBe(false);
    const many = Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, () => ({ type: "visit" }));
    expect(AnalyticsBatchSchema.safeParse({ events: many }).success).toBe(false);
    expect(
      AnalyticsBatchSchema.safeParse({ events: [{ type: "visit", source: "a b" }] }).success,
    ).toBe(false);
    expect(AnalyticsBatchSchema.safeParse({ events: [{ type: "visit", extra: 1 }] }).success).toBe(
      false,
    );
  });

  it("корзина: id блюда → порций (1–50)", () => {
    expect(CartSnapshotSchema.safeParse({ items: { borscht: 2 } }).success).toBe(true);
    expect(CartSnapshotSchema.safeParse({ items: {} }).success).toBe(true);
    expect(CartSnapshotSchema.safeParse({ items: { borscht: 0 } }).success).toBe(false);
    expect(CartSnapshotSchema.safeParse({ items: { borscht: 51 } }).success).toBe(false);
    expect(CartSnapshotSchema.safeParse({ items: { Борщ: 1 } }).success).toBe(false);
  });

  it("период и права: аналитику видят владелец и менеджер", () => {
    expect(AnalyticsPeriodSchema.safeParse("30d").success).toBe(true);
    expect(AnalyticsPeriodSchema.safeParse("year").success).toBe(false);
    expect(can(["owner"], "analytics.view")).toBe(true);
    expect(can(["manager"], "analytics.view")).toBe(true);
    expect(can(["courier"], "analytics.view")).toBe(false);
  });

  it("изменение к прошлому периоду", () => {
    expect(percentChange(118, 100)).toBe(18);
    expect(percentChange(90, 100)).toBe(-10);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(null, 10)).toBeNull();
  });
});
