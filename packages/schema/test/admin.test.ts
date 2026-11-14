import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type Catalog,
  type PauseOption,
  parseCatalog,
  pauseUntil,
  productInputSchema,
  StaffOrderActionSchema,
  StaffUpdateSchema,
  slugify,
  WeekHoursSchema,
} from "../src/index.ts";

const example = parseCatalog(
  JSON.parse(
    readFileSync(new URL("../../../catalog/example.catalog.json", import.meta.url), "utf8"),
  ),
);
if (!example.ok) throw new Error("демо-меню невалидно");
const catalog: Catalog = example.value;

describe("slugify", () => {
  it("кириллица → латиница для id", () => {
    expect(slugify("Борщ с говядиной")).toBe("borsch-s-govyadinoy");
    expect(slugify("  Щи / Суп дня №2 ")).toBe("schi-sup-dnya-no2");
    expect(slugify("Café crème")).toBe("cafe-creme");
    expect(slugify("🌶🌶")).toBe("");
  });
});

describe("форма блюда", () => {
  const schema = productInputSchema(catalog.attributes);
  const base = { title: "Щи", price: 70000, categoryId: "soups" };

  it("id не обязателен, характеристики проверяются по описаниям", () => {
    expect(schema.parse({ ...base, attributes: { portion: "400 мл" } })).toMatchObject({
      title: "Щи",
      attributes: { portion: "400 мл" },
      available: true,
    });
    const r = schema.safeParse({ ...base, attributes: { kcal: 9000, spicy: true } });
    expect(r.error?.issues.map((i) => i.path.join("."))).toEqual(
      expect.arrayContaining(["attributes.kcal", "attributes"]),
    );
  });

  it("старая цена больше текущей", () => {
    const r = schema.safeParse({ ...base, compareAtPrice: 70000 });
    expect(r.error?.issues[0]?.path).toEqual(["compareAtPrice"]);
  });
});

describe("пауза", () => {
  const hours = WeekHoursSchema.parse({ sat: { from: "18:00", to: "02:00" } });
  // Сб 14.11.2026 23:00 в Хойане (UTC+7)
  const now = new Date("2026-11-14T16:00:00Z");
  const at = (o: PauseOption) => pauseUntil(o, hours, "Asia/Ho_Chi_Minh", now)?.toISOString();

  it("на время, до закрытия смены и снять", () => {
    expect(at("30m")).toBe("2026-11-14T16:30:00.000Z");
    expect(at("1h")).toBe("2026-11-14T17:00:00.000Z");
    expect(at("today")).toBe("2026-11-14T19:00:00.000Z"); // 02:00 по местному
    expect(at("off")).toBeUndefined();
  });
});

describe("действия с заказом", () => {
  it("«Другое» требует комментарий", () => {
    expect(StaffOrderActionSchema.safeParse({ action: "accept" }).success).toBe(true);
    const r = StaffOrderActionSchema.safeParse({ action: "fail", reason: "other" });
    expect(r.error?.issues[0]).toMatchObject({
      path: ["comment"],
      message: "Опишите, что случилось",
    });
    expect(StaffOrderActionSchema.safeParse({ action: "assign", courierId: 0 }).success).toBe(
      false,
    );
  });

  it("роль владельца ссылкой не выдать", () => {
    expect(StaffUpdateSchema.safeParse({ roles: ["owner"] }).success).toBe(false);
    expect(StaffUpdateSchema.parse({ roles: ["courier"], active: false })).toEqual({
      roles: ["courier"],
      active: false,
    });
  });
});
