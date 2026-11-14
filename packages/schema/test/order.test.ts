import { describe, expect, it } from "vitest";
import {
  can,
  canTransition,
  createOrderInputSchema,
  customerCancelMode,
  isFinalStatus,
  ORDER_STATUS_LABELS,
  ORDER_STATUSES,
  orderTotal,
  regionFor,
  StaffCancelInputSchema,
} from "../src/index.ts";

describe("статусы заказа", () => {
  it("один словарь названий", () => {
    expect(ORDER_STATUSES.map((s) => ORDER_STATUS_LABELS[s])).toEqual([
      "Оформлен",
      "Готовим",
      "Курьер в пути",
      "Доставлен",
      "Отменён",
    ]);
  });

  it("переходы только по порядку, отмена — из любого незакрытого", () => {
    expect(canTransition("new", "processing")).toBe(true);
    expect(canTransition("new", "shipping")).toBe(false);
    expect(canTransition("processing", "shipping")).toBe(true);
    expect(canTransition("shipping", "done")).toBe(true);
    expect(canTransition("shipping", "cancelled")).toBe(true);
    expect(canTransition("done", "cancelled")).toBe(false);
    expect(canTransition("cancelled", "new")).toBe(false);
    expect(isFinalStatus("done") && isFinalStatus("cancelled")).toBe(true);
  });
});

describe("отмена", () => {
  const on = { orders: { customerCanCancel: true } };
  const off = { orders: { customerCanCancel: false } };

  it("покупатель отменяет сам только «Оформлен», дальше — просьба", () => {
    expect(customerCancelMode("new", on)).toBe("cancel");
    expect(customerCancelMode("processing", on)).toBe("request");
    expect(customerCancelMode("shipping", on)).toBe("request");
    expect(customerCancelMode("done", on)).toBe("none");
    expect(customerCancelMode("new", off)).toBe("request");
  });

  it("магазин указывает причину, «Другое» — с комментарием", () => {
    expect(StaffCancelInputSchema.parse({ reason: "out_of_stock" })).toEqual({
      reason: "out_of_stock",
    });
    const r = StaffCancelInputSchema.safeParse({ reason: "other", comment: " " });
    expect(r.error?.issues[0]).toMatchObject({
      path: ["comment"],
      message: "Опишите причину — её увидит покупатель",
    });
  });
});

describe("оформление", () => {
  const schema = createOrderInputSchema({ region: regionFor("VN") });
  const items = [{ productId: "pho-bo", qty: 2 }];
  const customer = {
    name: "Анна",
    phone: "0912 345 678",
    location: { lat: 15.8801, lng: 108.338, accuracy: 12, source: "gps" },
  };

  it("корзина: не пустая, без повторов, количество от 1 до 50", () => {
    expect(schema.safeParse({ items: [], customer }).error?.issues[0]?.message).toBe(
      "Корзина пуста",
    );
    const dup = schema.safeParse({
      items: [
        { productId: "pho-bo", qty: 1 },
        { productId: "pho-bo", qty: 2 },
      ],
      customer,
    });
    expect(dup.error?.issues[0]?.message).toBe("Блюдо повторяется — объедините позиции");
    expect(schema.safeParse({ items: [{ productId: "pho-bo", qty: 0 }], customer }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ items: [{ productId: "pho-bo", qty: 51 }], customer }).error?.issues[0]
        ?.message,
    ).toBe("Не больше 50 порций одного блюда");
  });

  it("нормализует телефон по стране магазина", () => {
    expect(schema.parse({ items, customer })).toEqual({
      items,
      customer: {
        name: "Анна",
        phone: "+84912345678",
        location: { lat: 15.8801, lng: 108.338, accuracy: 12, source: "gps" },
        address: "",
        comment: "",
      },
      phoneFromTelegram: false,
    });
  });

  it("обязательные поля объясняют, зачем они", () => {
    const r = schema.safeParse({ items, customer: { name: "", phone: "" } });
    expect(r.error?.issues.map((i) => [i.path.at(-1), i.message])).toEqual([
      ["name", "Как к вам обращаться?"],
      ["phone", "Без телефона курьер не сможет передать заказ"],
      ["location", "Поставьте точку на карте — так курьер быстрее вас найдёт"],
    ]);
    const wrongPoint = schema.safeParse({
      items,
      customer: { ...customer, location: { lat: 95, lng: 108 } },
    });
    expect(wrongPoint.success).toBe(false);
  });

  it("сумма заказа", () => {
    expect(
      orderTotal([
        { price: 75000, qty: 2 },
        { price: 30000, qty: 1 },
      ]),
    ).toBe(180000);
  });
});

describe("роли", () => {
  it("права складываются из ролей", () => {
    expect(can(["courier"], "delivery.work")).toBe(true);
    expect(can(["courier"], "orders.manage")).toBe(false);
    expect(can(["manager"], "team.manage")).toBe(false);
    expect(can(["owner", "courier"], "team.manage")).toBe(true);
  });
});
