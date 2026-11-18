import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { blockedGuard, isBotBlocked, setBotBlocked } from "../src/bot/blocked.ts";
import { createBot } from "../src/bot/bot.ts";
import { carts, users } from "../src/db/schema.ts";
import { ANNA, NOON, ORDER_BODY, OWNER, openShop, setup, type TestCtx } from "./helpers.ts";

const BORIS = 4001;
const MIN = 60 * 1000;

const events = (t: TestCtx, as: number, list: unknown[]) =>
  t.call("POST", "/api/events", { as, body: { events: list } });

const report = async (t: TestCtx, period = "7d", as = OWNER) =>
  (await t.call("GET", `/api/admin/analytics?period=${period}`, { as })).json;

describe("аналитика: запись", () => {
  it("события пачкой; неверный тип и пустая пачка — 400; без входа — 401", async () => {
    const t = setup();
    await openShop(t);
    expect((await events(t, ANNA, [{ type: "visit", source: "dish_borscht" }])).status).toBe(200);
    expect((await events(t, ANNA, [{ type: "buy" }])).status).toBe(400);
    expect((await events(t, ANNA, [])).status).toBe(400);
    expect((await events(t, ANNA, [{ type: "visit", source: "bad param!" }])).status).toBe(400);
    expect(
      (await t.call("POST", "/api/events", { body: { events: [{ type: "visit" }] } })).status,
    ).toBe(401);
  });

  it("снимок корзины: сумма по ценам из БД, пустая корзина и заказ удаляют снимок", async () => {
    const t = setup();
    await openShop(t);
    const cartOf = () => t.deps.db.select().from(carts).where(eq(carts.userId, ANNA)).get();

    await t.call("POST", "/api/cart", { as: ANNA, body: { items: { borscht: 2, nope: 3 } } });
    expect(cartOf()?.total).toBe(170000);
    await t.call("POST", "/api/cart", { as: ANNA, body: { items: {} } });
    expect(cartOf()).toBeUndefined();

    await t.call("POST", "/api/cart", { as: ANNA, body: { items: { borscht: 1 } } });
    await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY });
    expect(cartOf()).toBeUndefined();
  });
});

describe("аналитика: отчёт", () => {
  it("цифры периода, воронка, брошенные корзины, источники; сотрудники не считаются", async () => {
    const t = setup();
    await openShop(t);

    // Владелец — сотрудник: его заход и заказ в статистику не попадают.
    await events(t, OWNER, [{ type: "visit" }, { type: "cart_add", productId: "borscht" }]);
    await t.call("POST", "/api/orders", { as: OWNER, body: ORDER_BODY }); // #1001

    // Анна пришла по ссылке на блюдо и заказала.
    await events(t, ANNA, [
      { type: "visit", source: "dish_borscht" },
      { type: "dish_view", productId: "borscht" },
      { type: "cart_add", productId: "borscht" },
      { type: "checkout_open" },
    ]);
    await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY }); // #1002

    // Борис пришёл по своей метке, положил в корзину и не заказал.
    await events(t, BORIS, [
      { type: "visit", source: "src_instagram" },
      { type: "cart_add", productId: "pelmeni" },
    ]);
    await t.call("POST", "/api/cart", { as: BORIS, body: { items: { pelmeni: 2 } } });

    // Заказ Анны приняли через 4 минуты и доставили через 40.
    const act = (action: string) =>
      t.call("POST", "/api/staff/orders/1002/actions", { as: OWNER, body: { action } });
    t.clock.now = new Date(NOON.getTime() + 4 * MIN);
    await act("accept");
    await act("pickup");
    t.clock.now = new Date(NOON.getTime() + 40 * MIN);
    await act("deliver");
    await t.call("POST", "/api/orders/1002/review", { as: ANNA, body: { rating: 4, text: "" } });

    const r = await report(t, "7d");
    expect(r.kpi.visitors.value).toBe(2);
    expect(r.kpi.orders.value).toBe(1);
    expect(r.kpi.revenue.value).toBe(420000);
    expect(r.kpi.avgCheck.value).toBe(420000);
    expect(r.kpi.conversion.value).toBe(50);
    expect(r.kpi.visitors.prev).toBe(0);
    expect(r.funnel).toEqual({ visited: 2, addedToCart: 2, checkout: 1, ordered: 1, delivered: 1 });
    expect(r.abandoned).toEqual({ count: 1, total: 500000 });
    expect(r.sources).toEqual([
      { key: "dish", label: "Ссылки на блюда", visitors: 1, buyers: 1 },
      { key: "src_instagram", label: "instagram", visitors: 1, buyers: 0 },
    ]);
    // По порциям: борщ (2) выше пельменей (1), хотя выручка у пельменей больше.
    expect(r.topDishes[0]).toMatchObject({ productId: "borscht", qty: 2, revenue: 170000 });
    expect(r.topDishes[1]).toMatchObject({ productId: "pelmeni", qty: 1, revenue: 250000 });
    // 12:00 в Хойане.
    expect(r.byHour[12]).toBe(1);
    expect(r.byHour.reduce((a: number, b: number) => a + b, 0)).toBe(1);
    expect(r.customers).toMatchObject({ newBuyers: 1, returningBuyers: 0 });
    expect(r.operations).toMatchObject({
      acceptMinutes: 4,
      deliverMinutes: 40,
      cancelled: 0,
      rating: 4,
      reviews: 1,
    });
    expect(r.bot).toMatchObject({ users: 2, usersNew: 2, blocked: 0 });

    // 7 дней — 7 столбиков, последний — сегодня (сб 14 ноября).
    expect(r.series).toHaveLength(7);
    expect(r.series[6]).toMatchObject({
      label: "Сб 14",
      title: "14 ноября",
      visitors: 2,
      orders: 1,
    });
    expect(r.trackingSince).not.toBeNull();
  });

  it("сегодня — по часам рабочего дня; прошлый период — вчера в то же время", async () => {
    const t = setup();
    await openShop(t);
    t.clock.now = new Date(NOON.getTime() - 24 * 60 * MIN);
    await events(t, ANNA, [{ type: "visit" }]);
    await events(t, BORIS, [{ type: "visit" }]);
    t.clock.now = NOON;
    await events(t, ANNA, [{ type: "visit" }]);

    const r = await report(t, "today");
    expect(r.kpi.visitors).toEqual({ value: 1, prev: 2 });
    // Часы работы 10:00–22:00 → столбики 10…21.
    expect(r.series.map((b: { label: string }) => b.label)).toEqual(
      Array.from({ length: 12 }, (_, i) => String(10 + i)),
    );
    expect(r.series[2]).toMatchObject({ title: "12:00–13:00", visitors: 1 });
  });

  it("повторный покупатель и отмены по причинам", async () => {
    const t = setup();
    await openShop(t);
    t.clock.now = new Date(NOON.getTime() - 10 * 24 * 60 * MIN);
    await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY }); // давно, вне периода
    t.clock.now = NOON;
    await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY });
    await t.call("POST", "/api/orders/1002/cancel", { as: ANNA });

    const r = await report(t, "7d");
    expect(r.customers).toMatchObject({ newBuyers: 0, returningBuyers: 1, repeatShare: 100 });
    expect(r.operations.cancelled).toBe(1);
    expect(r.operations.cancelReasons).toEqual([
      { reason: "customer", label: "Отменил покупатель", count: 1 },
    ]);
    expect(r.kpi.revenue.value).toBe(0);
    expect(r.kpi.avgCheck.value).toBeNull();
  });

  it("пустой магазин — без NaN; покупателю и курьеру отчёт недоступен", async () => {
    const t = setup();
    await openShop(t);
    const r = await report(t, "30d");
    expect(r.series).toHaveLength(30);
    expect(JSON.stringify(r)).not.toContain("NaN");
    expect(r.kpi.conversion.value).toBeNull();
    expect(r.trackingSince).toBeNull();
    expect((await t.call("GET", "/api/admin/analytics", { as: ANNA })).status).toBe(403);
    expect((await t.call("GET", "/api/admin/analytics?period=year", { as: OWNER })).status).toBe(
      400,
    );
  });
});

describe("заблокировавшим бота не пишем", () => {
  it("403 «bot was blocked» запоминается, дальше отправка не уходит в Telegram", async () => {
    const t = setup();
    await t.call("GET", "/api/me", { as: ANNA });
    const guard = blockedGuard(t.deps);
    const calls: string[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: подменный Bot API
    const prev: any = async (method: string) => {
      calls.push(method);
      return { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" };
    };
    // biome-ignore lint/suspicious/noExplicitAny: подменный Bot API
    const send = () => guard(prev, "sendMessage", { chat_id: ANNA, text: "hi" } as any);

    expect((await send()).ok).toBe(false);
    expect(isBotBlocked(t.deps.db, ANNA)).toBe(true);
    expect((await send()).ok).toBe(false);
    expect(calls).toEqual(["sendMessage"]); // второй раз в Telegram не ходили

    setBotBlocked(t.deps.db, ANNA, null);
    expect(isBotBlocked(t.deps.db, ANNA)).toBe(false);
  });

  it("my_chat_member: kicked — заблокировал, member или новое сообщение — снова пишем; в отчёте счётчик", async () => {
    const t = setup();
    await openShop(t);
    const bot = createBot(t.deps);
    bot.api.config.use(
      async (_prev, method) =>
        ({
          ok: true,
          result:
            method === "getMe"
              ? { id: 1, is_bot: true, first_name: "Печка", username: "pechka_test_bot" }
              : { message_id: 1 },
        }) as never,
    );
    await bot.init();
    let updateId = 1;
    const date = Math.floor(NOON.getTime() / 1000);
    const chat = { id: ANNA, type: "private" as const, first_name: "Анна" };
    const from = { id: ANNA, is_bot: false, first_name: "Анна" };
    const member = (status: "kicked" | "member") =>
      bot.handleUpdate({
        update_id: updateId++,
        my_chat_member: {
          chat,
          from,
          date,
          old_chat_member: { status: "member", user: { id: 1, is_bot: true, first_name: "Печка" } },
          new_chat_member:
            status === "kicked"
              ? { status, user: { id: 1, is_bot: true, first_name: "Печка" }, until_date: 0 }
              : { status, user: { id: 1, is_bot: true, first_name: "Печка" } },
        },
      });

    await member("kicked");
    expect(isBotBlocked(t.deps.db, ANNA)).toBe(true);
    expect((await report(t)).bot).toMatchObject({ blocked: 1, blockedNew: 1 });

    await member("member");
    expect(isBotBlocked(t.deps.db, ANNA)).toBe(false);

    await member("kicked");
    await bot.handleUpdate({
      update_id: updateId++,
      message: { message_id: 9, date, chat, from, text: "/start" },
    });
    expect(isBotBlocked(t.deps.db, ANNA)).toBe(false);
    expect(t.deps.db.select().from(users).where(eq(users.id, ANNA)).get()?.botBlockedAt).toBeNull();
  });
});
