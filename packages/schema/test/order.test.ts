import { describe, expect, it } from "vitest";
import {
  buildCheckoutSchema,
  CreateOrderInputSchema,
  can,
  canTransition,
  customerCancelMode,
  isFinalStatus,
  ORDER_STATUS_LABELS,
  ORDER_STATUSES,
  orderTotal,
  parseCatalog,
  StaffCancelInputSchema,
} from "../src/index.ts";

describe("статусы заказа", () => {
  it("один словарь названий", () => {
    expect(ORDER_STATUSES.map((s) => ORDER_STATUS_LABELS[s])).toEqual([
      "Оформлен",
      "Собираем",
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

  it("менеджер указывает причину, «Другое» — с комментарием", () => {
    expect(StaffCancelInputSchema.parse({ reason: "out_of_stock" })).toEqual({
      reason: "out_of_stock",
      restock: true,
    });
    const r = StaffCancelInputSchema.safeParse({ reason: "other", comment: " " });
    expect(r.error?.issues[0]).toMatchObject({
      path: ["comment"],
      message: "Опишите причину — её увидит покупатель",
    });
  });
});

describe("оформление", () => {
  const catalog = parseCatalog({ version: 1, settings: { shop: { name: "М" } } });
  if (!catalog.ok) throw new Error("каталог невалиден");
  const checkout = buildCheckoutSchema(catalog.value.settings);

  it("корзина: не пустая, без повторов, количество от 1", () => {
    expect(
      CreateOrderInputSchema.safeParse({ items: [], customer: {} }).error?.issues[0]?.message,
    ).toBe("Корзина пуста");
    const dup = CreateOrderInputSchema.safeParse({
      items: [
        { productId: "tee", qty: 1 },
        { productId: "tee", qty: 2 },
      ],
      customer: {},
    });
    expect(dup.error?.issues[0]?.message).toBe("Товар повторяется — объедините позиции");
    expect(
      CreateOrderInputSchema.safeParse({ items: [{ productId: "tee", qty: 0 }], customer: {} })
        .success,
    ).toBe(false);
  });

  it("поля покупателя по настройкам: телефон и адрес обязательны", () => {
    const r = checkout.safeParse({ name: "Анна", phone: "", address: "" });
    expect(r.error?.issues.map((i) => [i.path[0], i.message])).toEqual([
      ["phone", "Без телефона курьер не сможет передать заказ"],
      ["address", "Обязательное поле"],
    ]);
    expect(
      checkout.parse({ name: "Анна", phone: "89991234567", address: "Москва, Лесная, 5" }),
    ).toEqual({
      name: "Анна",
      phone: "+79991234567",
      address: "Москва, Лесная, 5",
    });
  });

  it("сумма заказа", () => {
    expect(
      orderTotal([
        { price: 199000, qty: 2 },
        { price: 89000, qty: 1 },
      ]),
    ).toBe(487000);
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
