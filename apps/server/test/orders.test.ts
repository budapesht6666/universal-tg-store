import { describe, expect, it } from "vitest";
import { dueReminders } from "../src/orders/service.ts";
import { claimInvite, completeInvite, createInvite } from "../src/repo/team.ts";
import {
  ANNA,
  IVAN,
  NOON,
  ORDER_BODY,
  OWNER,
  openShop,
  SETUP_BODY,
  setup,
  type TestCtx,
} from "./helpers.ts";

async function addCourier(t: TestCtx, id: number) {
  await t.call("GET", "/api/me", { as: id }); // пользователь появился в БД
  const { token } = createInvite(t.deps.db, t.env, "courier", OWNER, NOON);
  claimInvite(t.deps.db, t.env, token, id, NOON);
  completeInvite(t.deps.db, id, "+84900000001", NOON);
}

describe("первая настройка", () => {
  it("до настройки магазин не готов, настраивает только владелец и один раз", async () => {
    const t = setup();
    expect((await t.call("GET", "/api/shop")).json).toEqual({ ready: false });
    expect((await t.call("POST", "/api/setup", { as: ANNA, body: SETUP_BODY })).status).toBe(403);
    expect((await t.call("POST", "/api/setup", { as: OWNER, body: SETUP_BODY })).status).toBe(201);
    expect((await t.call("POST", "/api/setup", { as: OWNER, body: SETUP_BODY })).status).toBe(409);

    const shop = (await t.call("GET", "/api/shop")).json;
    expect(shop).toMatchObject({
      ready: true,
      shop: { name: "Печка", phone: "+84905123456" },
      region: { currency: "VND", timeZone: "Asia/Ho_Chi_Minh" },
      status: { open: true, closesAt: "22:00" },
    });
    expect(shop.catalog.products).toHaveLength(12);
    expect(shop.catalog.products.find((p: { id: string }) => p.id === "solyanka").available).toBe(
      false,
    );
  });

  it("ошибки формы — по полям", async () => {
    const t = setup();
    const r = await t.call("POST", "/api/setup", {
      as: OWNER,
      body: { shop: { name: "", phone: "1" } },
    });
    expect(r.status).toBe(400);
    expect(r.json.issues).toEqual(
      expect.arrayContaining([{ path: "shop.name", message: "Как называется магазин?" }]),
    );
  });
});

describe("вход", () => {
  it("без подписи Telegram — 401", async () => {
    const t = setup();
    expect((await t.call("GET", "/api/me")).status).toBe(401);
    const forged = await t.call("GET", "/api/me", {
      headers: { authorization: "tma user=%7B%7D&hash=00" },
    });
    expect(forged.status).toBe(401);
    expect(forged.json.error).toBe("Откройте магазин заново из Telegram");
  });
});

describe("оформление", () => {
  it("цены и сумма — из БД, номер с 1001, менеджеры уведомлены", async () => {
    const t = setup();
    await openShop(t);
    const r = await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      id: 1001,
      status: "new",
      total: 85000 * 2 + 250000,
      currency: "VND",
      phone: "+84912345678",
      cancelMode: "cancel",
    });
    expect(t.notices).toEqual([{ type: "created", orderId: 1001 }]);

    const withPrice = await t.call("POST", "/api/orders", {
      as: ANNA,
      body: { ...ORDER_BODY, items: [{ productId: "borscht", qty: 1, price: 1 }] },
    });
    expect(withPrice.status).toBe(400);

    const me = (await t.call("GET", "/api/me", { as: ANNA })).json;
    expect(me.lastDetails).toMatchObject({
      name: "Анна",
      phone: "+84912345678",
      address: "Вилла 12",
    });
  });

  it("стоп-лист и несуществующее блюдо", async () => {
    const t = setup();
    await openShop(t);
    const r = await t.call("POST", "/api/orders", {
      as: ANNA,
      body: {
        ...ORDER_BODY,
        items: [
          { productId: "solyanka", qty: 1 },
          { productId: "pho", qty: 1 },
        ],
      },
    });
    expect(r.status).toBe(409);
    expect(r.json.issues).toEqual([
      { path: "items[0]", message: "«Солянка мясная» закончилось" },
      { path: "items[1]", message: "Этого блюда больше нет в меню" },
    ]);
  });

  it("ночью и на паузе заказ не принимается", async () => {
    const t = setup();
    await openShop(t);
    t.clock.now = new Date("2026-11-14T16:00:00Z"); // 23:00
    const night = await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY });
    expect(night.status).toBe(409);
    expect(night.json.error).toBe("Сейчас закрыто · откроемся завтра в 10:00");

    t.clock.now = NOON;
    expect(
      (await t.call("POST", "/api/staff/pause", { as: ANNA, body: { pause: "1h" } })).status,
    ).toBe(403);
    const pause = await t.call("POST", "/api/staff/pause", { as: OWNER, body: { pause: "1h" } });
    expect(pause.json).toMatchObject({
      pausedUntil: "2026-11-14T06:00:00.000Z",
      status: { open: false, reason: "paused" },
    });
    const paused = await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY });
    expect(paused.json.error).toBe("Сейчас не принимаем заказы · откроемся сегодня в 13:00");

    t.clock.now = new Date(NOON.getTime() + 61 * 60_000); // пауза снялась сама
    expect((await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY })).status).toBe(201);
  });
});

describe("отмена покупателем", () => {
  it("«Оформлен» — сам, дальше — просьба менеджеру", async () => {
    const t = setup();
    await openShop(t);
    await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY });
    const cancelled = await t.call("POST", "/api/orders/1001/cancel", { as: ANNA });
    expect(cancelled.json).toMatchObject({
      status: "cancelled",
      cancelReason: "Отменён покупателем",
    });

    await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY });
    await t.call("POST", "/api/staff/orders/1002/actions", {
      as: OWNER,
      body: { action: "accept" },
    });
    const asked = await t.call("POST", "/api/orders/1002/cancel", { as: ANNA });
    expect(asked.json).toMatchObject({
      status: "processing",
      cancelRequested: true,
      cancelMode: "request",
    });
    expect(t.notices.filter((n) => n.type === "cancel_requested")).toEqual([
      { type: "cancel_requested", orderId: 1002 },
    ]);
    expect((await t.call("POST", "/api/orders/1002/cancel", { as: IVAN })).status).toBe(404);
  });
});

describe("менеджер и курьер", () => {
  it("один курьер (владелец) назначается сам; полный путь до «Доставлен»", async () => {
    const t = setup();
    await openShop(t);
    await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY });
    const act = (action: string) =>
      t.call("POST", "/api/staff/orders/1001/actions", { as: OWNER, body: { action } });

    expect((await act("pickup")).status).toBe(409); // ещё не принят
    const accepted = await act("accept");
    expect(accepted.json).toMatchObject({ status: "processing", courier: { id: OWNER } });
    expect((await act("accept")).json.error).toBe("Заказ уже «Готовим» — обновите список");
    expect((await act("pickup")).json.status).toBe("shipping");
    expect((await act("deliver")).json.status).toBe("done");
    expect(t.notices.map((n) => n.type)).toEqual([
      "created",
      "accepted",
      "courier_assigned",
      "status",
      "status",
    ]);

    const order = (await t.call("GET", "/api/orders/1001", { as: ANNA })).json;
    expect(order.history.map((h: { status: string }) => h.status)).toEqual([
      "new",
      "processing",
      "shipping",
      "done",
    ]);
    expect(order.cancelMode).toBe("none");
  });

  it("курьер видит только свои доставки, после доставки — без контактов", async () => {
    const t = setup();
    await openShop(t);
    await addCourier(t, IVAN);
    await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY });
    const act = (as: number, body: object) =>
      t.call("POST", "/api/staff/orders/1001/actions", { as, body });

    const accepted = await act(OWNER, { action: "accept" });
    expect(accepted.json.courier).toBeNull(); // курьеров двое — выбирает менеджер
    expect((await act(IVAN, { action: "pickup" })).status).toBe(403);
    expect((await act(IVAN, { action: "accept" })).status).toBe(403);
    expect((await act(OWNER, { action: "assign", courierId: ANNA })).status).toBe(400);
    expect((await act(OWNER, { action: "assign", courierId: IVAN })).json.courier).toEqual({
      id: IVAN,
      name: `User${IVAN}`,
    });

    const board = (await t.call("GET", "/api/staff/orders", { as: IVAN })).json;
    expect(board.mode).toBe("courier");
    expect(board.active.map((o: { id: number }) => o.id)).toEqual([1001]);
    expect(board.active[0].location.mapsUrl).toBe(
      "https://maps.google.com/?q=15.880100,108.338000",
    );

    expect((await act(IVAN, { action: "fail", reason: "no_answer" })).json.deliveryIssue.text).toBe(
      "Не дозвонился",
    );
    await act(IVAN, { action: "pickup" });
    await act(IVAN, { action: "deliver" });
    const done = (await t.call("GET", "/api/staff/orders", { as: IVAN })).json.done[0];
    expect(done).toMatchObject({
      status: "done",
      location: null,
      address: "",
      customer: { phone: null },
    });
    const managerView = (await t.call("GET", "/api/staff/orders", { as: OWNER })).json.done[0];
    expect(managerView.customer.phone).toBe("+84912345678");
  });

  it("отмена магазином — с причиной", async () => {
    const t = setup();
    await openShop(t);
    await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY });
    const r = await t.call("POST", "/api/staff/orders/1001/actions", {
      as: OWNER,
      body: { action: "cancel", reason: "out_of_stock" },
    });
    expect(r.json).toMatchObject({ status: "cancelled", cancelReason: "Закончилось блюдо" });
  });

  it("напоминание о непринятом заказе — раз в 3 минуты", async () => {
    const t = setup();
    await openShop(t);
    await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY });
    t.clock.now = new Date(NOON.getTime() + 2 * 60_000);
    expect(dueReminders(t.deps)).toEqual([]);
    t.clock.now = new Date(NOON.getTime() + 3 * 60_000);
    expect(dueReminders(t.deps).map((r) => r.waitingMinutes)).toEqual([3]);
    t.clock.now = new Date(NOON.getTime() + 4 * 60_000);
    expect(dueReminders(t.deps)).toEqual([]);
    t.clock.now = new Date(NOON.getTime() + 6 * 60_000);
    expect(dueReminders(t.deps).map((r) => r.waitingMinutes)).toEqual([6]);
  });
});
