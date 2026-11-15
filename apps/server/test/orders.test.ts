import { describe, expect, it } from "vitest";
import { settings } from "../src/db/schema.ts";
import { dueReminders, dueWaitingNotices } from "../src/orders/service.ts";
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
    expect((await t.call("GET", "/api/shop")).json).toEqual({
      ready: false,
      bot: "pechka_test_bot",
    });
    expect((await t.call("POST", "/api/setup", { as: ANNA, body: SETUP_BODY })).status).toBe(403);
    expect((await t.call("POST", "/api/setup", { as: OWNER, body: SETUP_BODY })).status).toBe(201);
    expect((await t.call("POST", "/api/setup", { as: OWNER, body: SETUP_BODY })).status).toBe(409);

    const shop = (await t.call("GET", "/api/shop")).json;
    expect(shop).toMatchObject({
      ready: true,
      shop: { name: "Печка", manager: "pechka_manager" },
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
      body: { shop: { name: "", manager: "+84905123456" } },
    });
    expect(r.status).toBe(400);
    expect(r.json.issues).toEqual(
      expect.arrayContaining([
        { path: "shop.name", message: "Как называется магазин?" },
        {
          path: "shop.manager",
          message: "Нужно имя пользователя Telegram, например @pechka_manager",
        },
      ]),
    );
  });

  it("старые настройки с телефоном магазина читаются и сохраняются без него", async () => {
    const t = setup();
    await t.call("POST", "/api/setup", { as: OWNER, body: SETUP_BODY });
    const row = t.deps.db.select().from(settings).get();
    if (!row) throw new Error("нет настроек");
    // Как на проде до 15.11.2026: в настройках лежал телефон магазина.
    const legacy = { ...row.data, shop: { name: "Печка", phone: "+84905123456" } };
    t.deps.db
      .update(settings)
      .set({ data: legacy as unknown as typeof row.data })
      .run();

    const shop = (await t.call("GET", "/api/shop")).json;
    expect(shop.shop).toEqual({ name: "Печка" });
    const { region: _region, ...saved } = (
      await t.call("GET", "/api/admin/settings", { as: OWNER })
    ).json;
    expect(saved.shop.phone).toBeUndefined();
    const r = await t.call("PUT", "/api/admin/settings", {
      as: OWNER,
      body: { ...saved, shop: { ...saved.shop, manager: "t.me/pechka_manager" } },
    });
    expect(r.status).toBe(200);
    expect(r.json.shop.manager).toBe("pechka_manager");
  });

  it("старое приветствие «напишите сюда» уточняется: пишут только по заказу", async () => {
    const t = setup();
    await t.call("POST", "/api/setup", { as: OWNER, body: SETUP_BODY });
    const row = t.deps.db.select().from(settings).get();
    if (!row) throw new Error("нет настроек");
    const greeting = "Привет!\n\nЕсть вопрос? Просто напишите сюда — ответит менеджер.";
    t.deps.db
      .update(settings)
      .set({ data: { ...row.data, shop: { ...row.data.shop, greeting } } })
      .run();
    const saved = (await t.call("GET", "/api/admin/settings", { as: OWNER })).json;
    expect(saved.shop.greeting).toBe(
      "Привет!\n\nВопрос по заказу? Напишите сюда — ответит менеджер.",
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

    expect((await t.call("GET", "/api/staff/orders/1001", { as: IVAN })).json.courier.id).toBe(
      IVAN,
    );
    expect((await t.call("GET", "/api/staff/orders/1001", { as: ANNA })).status).toBe(403);
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

describe("отзыв после доставки", () => {
  it("один раз, только доставленный свой заказ; менеджер видит, курьер — нет", async () => {
    const t = setup();
    await openShop(t);
    await addCourier(t, IVAN);
    await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY });
    const review = (as: number, body: object) =>
      t.call("POST", "/api/orders/1001/review", { as, body });
    const act = (as: number, body: object) =>
      t.call("POST", "/api/staff/orders/1001/actions", { as, body });

    expect((await t.call("GET", "/api/orders/1001", { as: ANNA })).json.canReview).toBe(false);
    expect((await review(ANNA, { rating: 5 })).status).toBe(409); // ещё не доставлен
    await act(OWNER, { action: "accept" });
    await act(OWNER, { action: "assign", courierId: IVAN });
    await act(IVAN, { action: "pickup" });
    await act(IVAN, { action: "deliver" });
    expect((await t.call("GET", "/api/orders/1001", { as: ANNA })).json.canReview).toBe(true);

    expect((await review(OWNER, { rating: 5 })).status).toBe(404); // чужой заказ
    expect((await review(ANNA, { rating: 0 })).status).toBe(400);
    expect((await review(ANNA, { rating: 6 })).status).toBe(400);

    // Через двое суток доставленный заказ ушёл бы из «Готово», но отзыв его возвращает.
    t.clock.now = new Date(NOON.getTime() + 48 * 3600_000);
    const sent = await review(ANNA, { rating: 4, text: "  Вкусно, но остыло  " });
    expect(sent.json).toMatchObject({
      canReview: false,
      review: { rating: 4, text: "Вкусно, но остыло" },
    });
    expect((await review(ANNA, { rating: 5 })).json.error).toBe("Отзыв уже оставлен — спасибо!");

    const manager = (await t.call("GET", "/api/staff/orders", { as: OWNER })).json.done;
    expect(manager.map((o: { id: number }) => o.id)).toEqual([1001]);
    expect(manager[0].review).toMatchObject({ rating: 4, seen: false });
    const courier = (await t.call("GET", "/api/staff/orders", { as: IVAN })).json.done;
    expect(courier[0].review).toBeNull();
    expect((await t.call("POST", "/api/staff/orders/1001/review-seen", { as: IVAN })).status).toBe(
      403,
    );

    const seen = await t.call("POST", "/api/staff/orders/1001/review-seen", { as: OWNER });
    expect(seen.json.review.seen).toBe(true);
    // Прочитан и прошли сутки после отзыва — из «Готово» уходит.
    t.clock.now = new Date(NOON.getTime() + 73 * 3600_000);
    expect((await t.call("GET", "/api/staff/orders", { as: OWNER })).json.done).toEqual([]);
  });

  it("непрочитанный отзыв висит в «Готово», пока его не откроют", async () => {
    const t = setup();
    await openShop(t);
    await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY });
    for (const action of ["accept", "pickup", "deliver"]) {
      await t.call("POST", "/api/staff/orders/1001/actions", { as: OWNER, body: { action } });
    }
    await t.call("POST", "/api/orders/1001/review", { as: ANNA, body: { rating: 2 } });
    t.clock.now = new Date(NOON.getTime() + 5 * 24 * 3600_000);
    const done = (await t.call("GET", "/api/staff/orders", { as: OWNER })).json.done;
    expect(done[0].review).toMatchObject({ rating: 2, text: "", seen: false });
  });

  it("в настройках до появления флага отзывы включены по умолчанию", async () => {
    const t = setup();
    await openShop(t);
    const row = t.deps.db.select().from(settings).get();
    if (!row) throw new Error("нет настроек");
    const { reviews: _, ...oldFeatures } = row.data.features;
    t.deps.db
      .update(settings)
      .set({ data: { ...row.data, features: oldFeatures as typeof row.data.features } })
      .run();
    expect((await t.call("GET", "/api/shop")).json.features.reviews).toBe(true);
  });
});

describe("зона доставки, первый заказ, долгое ожидание", () => {
  const ZONE = {
    enabled: true,
    label: "Дананг и Хойан",
    circles: [
      { name: "Дананг", lat: 16.0544, lng: 108.2022, radiusKm: 12 },
      { name: "Хойан", lat: 15.8801, lng: 108.338, radiusKm: 9 },
    ],
  };

  it("точку вне зоны сервер не принимает; магазин отдаёт зону", async () => {
    const t = setup();
    await openShop(t);
    const settings = (await t.call("GET", "/api/admin/settings", { as: OWNER })).json;
    expect(settings.delivery).toEqual({ enabled: false, label: "", circles: [] });
    const saved = await t.call("PUT", "/api/admin/settings", {
      as: OWNER,
      body: { ...settings, region: undefined, delivery: ZONE },
    });
    expect(saved.status).toBe(200);
    expect((await t.call("GET", "/api/shop")).json.delivery).toEqual(ZONE);

    const hue = { lat: 16.4637, lng: 107.5909, source: "pin" };
    const outside = await t.call("POST", "/api/orders", {
      as: ANNA,
      body: { ...ORDER_BODY, customer: { ...ORDER_BODY.customer, location: hue } },
    });
    expect(outside.status).toBe(400);
    expect(outside.json.issues[0]).toMatchObject({ path: "customer.location" });
    expect(outside.json.issues[0].message).toContain("только Дананг и Хойан");
    expect((await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY })).status).toBe(201);
  });

  it("включить зону без кругов нельзя", async () => {
    const t = setup();
    await openShop(t);
    const settings = (await t.call("GET", "/api/admin/settings", { as: OWNER })).json;
    const r = await t.call("PUT", "/api/admin/settings", {
      as: OWNER,
      body: { ...settings, region: undefined, delivery: { enabled: true, circles: [] } },
    });
    expect(r.status).toBe(400);
  });

  it("«Первый заказ» — пока покупателю ничего не доставили", async () => {
    const t = setup();
    await openShop(t);
    await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY });
    const board = async () => (await t.call("GET", "/api/staff/orders", { as: OWNER })).json;
    expect((await board()).new[0].firstOrder).toBe(true);
    const act = (body: object) =>
      t.call("POST", "/api/staff/orders/1001/actions", { as: OWNER, body });
    await act({ action: "accept" });
    await act({ action: "pickup" });
    await act({ action: "deliver" });
    await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY });
    expect((await board()).new[0].firstOrder).toBe(false);
  });

  it("не приняли за 15 минут — покупателю пишем один раз", async () => {
    const t = setup();
    await openShop(t);
    await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY });
    await t.call("POST", "/api/orders", {
      as: ANNA + 1,
      body: ORDER_BODY,
    });
    await t.call("POST", "/api/staff/orders/1002/actions", {
      as: OWNER,
      body: { action: "accept" },
    });
    t.clock.now = new Date(NOON.getTime() + 14 * 60_000);
    expect(dueWaitingNotices(t.deps)).toEqual([]);
    t.clock.now = new Date(NOON.getTime() + 15 * 60_000);
    expect(dueWaitingNotices(t.deps).map((o) => o.id)).toEqual([1001]);
    t.clock.now = new Date(NOON.getTime() + 30 * 60_000);
    expect(dueWaitingNotices(t.deps)).toEqual([]);
  });
});
