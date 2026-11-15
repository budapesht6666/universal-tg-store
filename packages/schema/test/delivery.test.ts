import { describe, expect, it } from "vitest";
import {
  createOrderInputSchema,
  DeliveryZoneSchema,
  deliveryAreaLine,
  distanceKm,
  inDeliveryZone,
  regionFor,
} from "../src/index.ts";

const DANANG = { lat: 16.0544, lng: 108.2022 };
const HOI_AN = { lat: 15.8801, lng: 108.338 };
const HUE = { lat: 16.4637, lng: 107.5909 };

const zone = DeliveryZoneSchema.parse({
  enabled: true,
  label: "Дананг и Хойан",
  circles: [
    { name: "Дананг", ...DANANG, radiusKm: 12 },
    { name: "Хойан", ...HOI_AN, radiusKm: 9 },
  ],
});

describe("зона доставки", () => {
  it("расстояние по прямой", () => {
    expect(distanceKm(DANANG, HOI_AN)).toBeGreaterThan(23);
    expect(distanceKm(DANANG, HOI_AN)).toBeLessThan(25);
    expect(distanceKm(HOI_AN, HOI_AN)).toBe(0);
  });

  it("точка внутри любого круга — доставляем", () => {
    expect(inDeliveryZone(zone, DANANG)).toBe(true);
    expect(inDeliveryZone(zone, { lat: 15.9, lng: 108.36 })).toBe(true);
    expect(inDeliveryZone(zone, HUE)).toBe(false);
  });

  it("выключенная зона пускает везде, и по умолчанию она выключена", () => {
    const off = DeliveryZoneSchema.parse({});
    expect(off).toEqual({ enabled: false, label: "", circles: [] });
    expect(inDeliveryZone(off, HUE)).toBe(true);
    expect(deliveryAreaLine(off)).toBeNull();
    expect(deliveryAreaLine(zone)).toBe("Доставка: Дананг и Хойан");
    // Название показываем и без ограничения заказов кругами.
    expect(deliveryAreaLine({ ...off, label: "Дананг и Хойан" })).toBe("Доставка: Дананг и Хойан");
  });

  it("включённая зона без кругов — ошибка", () => {
    const r = DeliveryZoneSchema.safeParse({ enabled: true });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["circles"]);
  });

  it("оформление: точка вне зоны — ошибка у поля location", () => {
    const schema = createOrderInputSchema({ region: regionFor("VN"), delivery: zone });
    const order = (point: { lat: number; lng: number }) => ({
      items: [{ productId: "borsch", qty: 1 }],
      customer: { name: "Анна", phone: "0912345678", location: point },
    });
    expect(schema.safeParse(order(HOI_AN)).success).toBe(true);
    const r = schema.safeParse(order(HUE));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["customer", "location"]);
    expect(r.error?.issues[0]?.message).toContain("только Дананг и Хойан");
  });
});
