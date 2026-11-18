import { describe, expect, it } from "vitest";
import { ANNA, IVAN, ORDER_BODY, OWNER, openShop, setup, type TestCtx } from "./helpers.ts";

type P = { id: string; stock: number | null; available: boolean } & Record<string, unknown>;

async function adminProduct(t: TestCtx, id: string): Promise<P> {
  const catalog = (await t.call("GET", "/api/admin/catalog", { as: OWNER })).json;
  return catalog.products.find((p: P) => p.id === id);
}

async function shopProduct(t: TestCtx, id: string): Promise<P> {
  return (await t.call("GET", "/api/shop")).json.catalog.products.find((p: P) => p.id === id);
}

/** Форма блюда целиком, как её шлёт админка (без служебных полей). */
async function setStock(t: TestCtx, id: string, stock: number | null | undefined) {
  const { createdAt: _c, updatedAt: _u, stock: _s, ...rest } = await adminProduct(t, id);
  return t.call("PUT", `/api/admin/products/${id}`, {
    as: OWNER,
    body: stock === undefined ? rest : { ...rest, stock },
  });
}

const order = (qty: number) => ({ ...ORDER_BODY, items: [{ productId: "borscht", qty }] });

describe("остатки порций", () => {
  it("по умолчанию без ограничения; остаток задаётся формой и виден магазину", async () => {
    const t = setup();
    await openShop(t);
    expect((await shopProduct(t, "borscht")).stock).toBeNull();
    expect((await setStock(t, "borscht", 3)).json.stock).toBe(3);
    expect((await shopProduct(t, "borscht")).stock).toBe(3);

    const bad = await setStock(t, "borscht", -1);
    expect(bad.status).toBe(400);
    expect(bad.json.issues).toEqual([
      { path: "stock", message: "Остаток не может быть меньше нуля" },
    ]);
  });

  it("заказ списывает порции, больше остатка не оформить, на нуле — «Закончилось»", async () => {
    const t = setup();
    await openShop(t);
    await setStock(t, "borscht", 3);

    const tooMany = await t.call("POST", "/api/orders", { as: ANNA, body: order(4) });
    expect(tooMany.status).toBe(409);
    expect(tooMany.json.issues).toEqual([
      { path: "items[0]", message: "«Борщ с говядиной»: осталось 3 порции, а у вас 4" },
    ]);
    expect((await adminProduct(t, "borscht")).stock).toBe(3);

    expect((await t.call("POST", "/api/orders", { as: ANNA, body: order(2) })).status).toBe(201);
    expect((await adminProduct(t, "borscht")).stock).toBe(1);
    expect((await t.call("POST", "/api/orders", { as: IVAN, body: order(1) })).status).toBe(201);
    expect((await adminProduct(t, "borscht")).stock).toBe(0);

    const soldOut = await t.call("POST", "/api/orders", { as: ANNA, body: order(1) });
    expect(soldOut.status).toBe(409);
    expect(soldOut.json.issues).toEqual([
      { path: "items[0]", message: "«Борщ с говядиной» закончилось" },
    ]);
  });

  it("отмена покупателем и магазином возвращает порции", async () => {
    const t = setup();
    await openShop(t);
    await setStock(t, "borscht", 5);
    await t.call("POST", "/api/orders", { as: ANNA, body: order(2) }); // 1001
    await t.call("POST", "/api/orders", { as: ANNA, body: order(3) }); // 1002
    expect((await adminProduct(t, "borscht")).stock).toBe(0);

    await t.call("POST", "/api/orders/1001/cancel", { as: ANNA });
    expect((await adminProduct(t, "borscht")).stock).toBe(2);

    await t.call("POST", "/api/staff/orders/1002/actions", {
      as: OWNER,
      body: { action: "cancel", reason: "no_answer" },
    });
    expect((await adminProduct(t, "borscht")).stock).toBe(5);
  });

  it("ограничение сняли после заказа — отмена остаток не создаёт", async () => {
    const t = setup();
    await openShop(t);
    await setStock(t, "borscht", 5);
    await t.call("POST", "/api/orders", { as: ANNA, body: order(2) });
    await setStock(t, "borscht", null);
    await t.call("POST", "/api/orders/1001/cancel", { as: ANNA });
    expect((await adminProduct(t, "borscht")).stock).toBeNull();
  });

  it("форма без поля stock остаток не трогает — заказы, пока она была открыта, не теряются", async () => {
    const t = setup();
    await openShop(t);
    await setStock(t, "borscht", 5);
    await t.call("POST", "/api/orders", { as: ANNA, body: order(2) });
    const saved = await setStock(t, "borscht", undefined);
    expect(saved.status).toBe(200);
    expect(saved.json.stock).toBe(3);
  });
});
