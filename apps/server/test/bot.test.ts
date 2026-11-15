import { describe, expect, it } from "vitest";
import { createBot } from "../src/bot/bot.ts";
import { ANNA, NOON, ORDER_BODY, OWNER, openShop, setup, type TestCtx } from "./helpers.ts";

type Sent = { method: string; payload: Record<string, unknown> };

/** Бот с подменённым Bot API: запросы записываются, наружу ничего не уходит. */
async function botWithFakeApi(t: TestCtx) {
  const bot = createBot(t.deps);
  const sent: Sent[] = [];
  let nextId = 500;
  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, payload: payload as Record<string, unknown> });
    const result =
      method === "getMe"
        ? {
            id: 1,
            is_bot: true,
            first_name: "Печка",
            username: "pechka_test_bot",
            can_join_groups: false,
            can_read_all_group_messages: false,
            supports_inline_queries: false,
          }
        : method === "sendMessage" || method === "copyMessage"
          ? { message_id: nextId++ }
          : true;
    // biome-ignore lint/suspicious/noExplicitAny: ответ Bot API в тесте
    return { ok: true, result } as any;
  });
  await bot.init();
  let updateId = 1;
  const write = (from: number, text: string) =>
    bot.handleUpdate({
      update_id: updateId++,
      message: {
        message_id: updateId,
        date: Math.floor(t.clock.now.getTime() / 1000),
        chat: { id: from, type: "private", first_name: "Анна" },
        from: { id: from, is_bot: false, first_name: "Анна" },
        text,
      },
    });
  return { sent, write };
}

const toManager = (sent: Sent[]) =>
  sent.filter(
    (s) =>
      (s.method === "sendMessage" || s.method === "copyMessage") && s.payload.chat_id === OWNER,
  );

describe("переписка покупателя с магазином", () => {
  it("без заказа менеджеру не уходит, бот отвечает контактом менеджера — не чаще раза в минуту", async () => {
    const t = setup();
    await openShop(t);
    const { sent, write } = await botWithFakeApi(t);

    await write(ANNA, "привет");
    await write(ANNA, "привет ещё раз");
    expect(toManager(sent)).toEqual([]);
    const replies = sent.filter((s) => s.method === "sendMessage" && s.payload.chat_id === ANNA);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.payload.text).toContain("для вопросов по текущему заказу");
    expect(replies[0]?.payload.text).toContain(
      "напишите менеджеру: @pechka_manager — ответит в рабочее время, как только освободится",
    );
    expect(replies[0]?.payload.text).not.toContain("+84");

    t.clock.now = new Date(NOON.getTime() + 61_000);
    await write(ANNA, "алло");
    expect(
      sent.filter((s) => s.method === "sendMessage" && s.payload.chat_id === ANNA),
    ).toHaveLength(2);
  });

  it("по заказу — уходит менеджеру; 2 часа после доставки — тоже, потом — нет", async () => {
    const t = setup();
    await openShop(t);
    await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY });
    const { sent, write } = await botWithFakeApi(t);

    await write(ANNA, "где курьер?");
    expect(toManager(sent).map((s) => s.method)).toEqual(["sendMessage", "copyMessage"]);
    expect(toManager(sent)[0]?.payload.text).toContain("заказ #1001");

    for (const action of ["accept", "pickup", "deliver"]) {
      await t.call("POST", "/api/staff/orders/1001/actions", { as: OWNER, body: { action } });
    }
    t.clock.now = new Date(NOON.getTime() + 119 * 60_000);
    await write(ANNA, "привезли не тот соус");
    expect(toManager(sent)).toHaveLength(4);
    expect((await t.call("GET", "/api/orders/1001", { as: ANNA })).json.chatOpen).toBe(true);

    t.clock.now = new Date(NOON.getTime() + 121 * 60_000);
    await write(ANNA, "спасибо, всё вкусно");
    expect(toManager(sent)).toHaveLength(4);
    const last = sent
      .filter((s) => s.method === "sendMessage" && s.payload.chat_id === ANNA)
      .at(-1);
    expect(last?.payload.text).toContain("@pechka_manager");
    expect((await t.call("GET", "/api/orders/1001", { as: ANNA })).json.chatOpen).toBe(false);
  });

  it("после отмены менеджеру не уходит сразу", async () => {
    const t = setup();
    await openShop(t);
    await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY });
    await t.call("POST", "/api/orders/1001/cancel", { as: ANNA });
    const { sent, write } = await botWithFakeApi(t);

    await write(ANNA, "почему отменили?");
    expect(toManager(sent)).toEqual([]);
    expect((await t.call("GET", "/api/orders/1001", { as: ANNA })).json.chatOpen).toBe(false);
  });
});
