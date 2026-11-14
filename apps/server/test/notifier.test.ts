import type { Api } from "grammy";
import { describe, expect, it } from "vitest";
import { createBotNotifier } from "../src/bot/notifier.ts";
import { ANNA, NOON, ORDER_BODY, OWNER, openShop, setup } from "./helpers.ts";

type Call = {
  method: string;
  chatId: number;
  text?: string;
  opts?: Record<string, unknown>;
  messageId?: number;
};

function fakeApi() {
  const calls: Call[] = [];
  let nextId = 100;
  const api = {
    async sendMessage(chatId: number, text: string, opts: Record<string, unknown>) {
      calls.push({ method: "send", chatId, text, opts });
      return { message_id: nextId++ };
    },
    async editMessageText(
      chatId: number,
      messageId: number,
      text: string,
      opts: Record<string, unknown>,
    ) {
      calls.push({ method: "edit", chatId, messageId, text, opts });
      return true;
    },
    async deleteMessage(chatId: number, messageId: number) {
      calls.push({ method: "delete", chatId, messageId });
      return true;
    },
  };
  return { api: api as unknown as Api, calls };
}

describe("уведомления в боте", () => {
  it("новый заказ со звуком → напоминание → «Принять» правит сообщение на месте", async () => {
    const t = setup();
    await openShop(t);
    const { api, calls } = fakeApi();
    const notifier = createBotNotifier(api, t.deps);
    t.deps.notifier = notifier;

    await t.call("POST", "/api/orders", { as: ANNA, body: ORDER_BODY });
    await notifier.idle();
    const [toOwner, toCustomer] = calls;
    expect(toOwner).toMatchObject({
      method: "send",
      chatId: OWNER,
      opts: { disable_notification: false },
    });
    expect(toOwner?.text).toMatch(/^🆕 <b>Заказ #1001<\/b> · 420\s000\s₫/);
    expect(toOwner?.text).toContain("👤 Анна · +84912345678");
    expect(toCustomer).toMatchObject({
      method: "send",
      chatId: ANNA,
      opts: { disable_notification: true },
    });

    notifier.notify({ type: "reminder", orderId: 1001, waitingMinutes: 3 });
    await notifier.idle();
    expect(calls.at(-1)).toMatchObject({
      method: "send",
      chatId: OWNER,
      text: "⏰ Заказ <b>#1001</b> ждёт уже 3 мин",
      opts: { reply_parameters: { message_id: 100, allow_sending_without_reply: true } },
    });

    calls.length = 0;
    t.clock.now = new Date(NOON.getTime() + 4 * 60_000);
    await t.call("POST", "/api/staff/orders/1001/actions", {
      as: OWNER,
      body: { action: "accept" },
    });
    await notifier.idle();
    expect(calls.map((c) => [c.method, c.chatId])).toEqual([
      ["delete", OWNER], // напоминание
      ["edit", OWNER], // «🆕 Заказ» → «Готовим»
      ["send", ANNA], // покупателю «Готовим»
      ["edit", OWNER], // назначен курьер (владелец)
      ["send", OWNER], // карточка доставки курьеру
    ]);
    expect(calls[1]?.text).toContain("👨‍🍳 Готовим · принял User1000 · курьер User1000");
    expect(calls[4]?.text).toMatch(/^🛵 <b>Доставка #1001<\/b> · получить 420\s000\s₫/);
  });
});
