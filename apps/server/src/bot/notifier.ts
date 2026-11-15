/**
 * Уведомления о заказах в чатах с ботом (docs/product-decisions.md → «Уведомления»):
 * - новый заказ — менеджерам со звуком; пока не приняли — напоминание каждые 3 минуты;
 * - сообщение о заказе у менеджеров обновляется на месте, напоминания удаляются;
 * - курьеру — со звуком при назначении; остальное — без звука или правкой на месте;
 * - покупателю — каждая смена статуса.
 * События одного заказа обрабатываются по очереди, ошибки Telegram только логируются.
 */
import { DELIVERY_FAILURE_LABELS } from "@store/schema";
import { and, eq } from "drizzle-orm";
import type { Api, RawApi } from "grammy";
import { botMessages } from "../db/schema.ts";
import type { Deps } from "../deps.ts";
import type { Notifier, OrderNotice } from "../notify.ts";
import { getOrder, isFirstOrder, type OrderRow } from "../orders/service.ts";
import { getShop } from "../repo/settings.ts";
import { staffWith, userName } from "../repo/team.ts";
import {
  courierMessage,
  customerMessage,
  esc,
  type Names,
  staffOrderMessage,
  waitingMessage,
} from "./texts.ts";

type Kind = (typeof botMessages.$inferSelect)["kind"];
type Markup = Parameters<Api<RawApi>["sendMessage"]>[2] extends infer O
  ? O extends { reply_markup?: infer M }
    ? M
    : never
  : never;

function isNotModified(err: unknown) {
  return String(err).includes("message is not modified");
}

export function createBotNotifier(api: Api, deps: Deps): Notifier & { idle(): Promise<void> } {
  const { db, env } = deps;
  const queues = new Map<number, Promise<void>>();
  const names: Names = { name: (id) => (id === null ? null : userName(db, id)) };
  const locale = () => getShop(db)?.settings.region.locale ?? "ru-RU";

  function remember(
    kind: Kind,
    orderId: number | null,
    chatId: number,
    messageId: number,
    customerId?: number,
  ) {
    db.insert(botMessages)
      .values({
        kind,
        orderId,
        chatId,
        messageId,
        customerId: customerId ?? null,
        createdAt: deps.now(),
      })
      .run();
  }

  function messagesOf(orderId: number, kind: Kind) {
    return db
      .select()
      .from(botMessages)
      .where(and(eq(botMessages.orderId, orderId), eq(botMessages.kind, kind)))
      .all();
  }

  async function send(
    chatId: number,
    text: string,
    opts: { silent?: boolean; replyTo?: number; markup?: Markup } = {},
  ): Promise<number | null> {
    try {
      const m = await api.sendMessage(chatId, text, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        disable_notification: opts.silent ?? false,
        ...(opts.replyTo && {
          reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true },
        }),
        ...(opts.markup && { reply_markup: opts.markup }),
      });
      return m.message_id;
    } catch (err) {
      console.error(`Бот: не отправилось сообщение в чат ${chatId}:`, String(err));
      return null;
    }
  }

  async function edit(chatId: number, messageId: number, text: string, markup: Markup) {
    try {
      await api.editMessageText(chatId, messageId, text, {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        reply_markup: markup as never,
      });
    } catch (err) {
      if (!isNotModified(err))
        console.error(`Бот: не обновилось сообщение ${chatId}/${messageId}:`, String(err));
    }
  }

  async function refreshStaff(order: OrderRow) {
    const msg = staffOrderMessage(order, env, locale(), names, isFirstOrder(db, order));
    for (const m of messagesOf(order.id, "order"))
      await edit(m.chatId, m.messageId, msg.text, msg.reply_markup);
  }

  async function refreshCourier(order: OrderRow) {
    const msg = courierMessage(order, env, locale());
    for (const m of messagesOf(order.id, "courier")) {
      if (m.chatId === order.courierId)
        await edit(m.chatId, m.messageId, msg.text, msg.reply_markup);
    }
  }

  async function dropReminders(orderId: number) {
    for (const m of messagesOf(orderId, "reminder")) {
      await api.deleteMessage(m.chatId, m.messageId).catch(() => {});
      db.delete(botMessages).where(eq(botMessages.id, m.id)).run();
    }
  }

  /** Сообщение менеджерам ответом на их «🆕 Заказ» (со звуком — нужно действие). */
  async function alertManagers(order: OrderRow, text: string) {
    const originals = new Map(messagesOf(order.id, "order").map((m) => [m.chatId, m.messageId]));
    for (const m of staffWith(db, env, "orders.manage")) {
      const replyTo = originals.get(m.id);
      await send(m.id, text, replyTo ? { replyTo } : {});
    }
  }

  async function toCustomer(order: OrderRow, byCustomer = false) {
    const reviews = getShop(db)?.settings.features.reviews ?? false;
    const msg = customerMessage(order, env, locale(), byCustomer, reviews);
    await send(order.customerId, msg.text, {
      silent: byCustomer || order.status === "new",
      markup: msg.reply_markup,
    });
  }

  async function handle(n: OrderNotice) {
    const order = getOrder(db, n.orderId);
    switch (n.type) {
      case "created": {
        const msg = staffOrderMessage(order, env, locale(), names, isFirstOrder(db, order));
        for (const m of staffWith(db, env, "orders.manage")) {
          const id = await send(m.id, msg.text, { markup: msg.reply_markup });
          if (id) remember("order", order.id, m.id, id);
        }
        await toCustomer(order);
        break;
      }
      case "accepted":
        await dropReminders(order.id);
        await refreshStaff(order);
        await toCustomer(order);
        break;
      case "courier_assigned": {
        await refreshStaff(order);
        if (n.previousCourierId !== null && n.previousCourierId !== n.courierId) {
          for (const m of messagesOf(order.id, "courier")) {
            if (m.chatId === n.previousCourierId) {
              await edit(m.chatId, m.messageId, `↪️ Заказ #${order.id} передан другому курьеру`, {
                inline_keyboard: [],
              });
            }
          }
        }
        const msg = courierMessage(order, env, locale());
        const id = await send(n.courierId, msg.text, { markup: msg.reply_markup });
        if (id) remember("courier", order.id, n.courierId, id);
        break;
      }
      case "status":
        await dropReminders(order.id);
        await refreshStaff(order);
        await refreshCourier(order);
        await toCustomer(order, n.actorId === null);
        break;
      case "cancel_requested":
        await refreshStaff(order);
        await alertManagers(order, `🙋 Покупатель просит отменить заказ <b>#${order.id}</b>`);
        break;
      case "delivery_failed": {
        await refreshStaff(order);
        const issue = order.deliveryIssue;
        const by = esc(userName(db, n.actorId));
        const reason = issue
          ? esc([DELIVERY_FAILURE_LABELS[issue.reason], issue.comment].filter(Boolean).join(": "))
          : "";
        await alertManagers(
          order,
          `⚠️ Заказ <b>#${order.id}</b> не доставлен · ${by}${reason ? `\n${reason}` : ""}\nПозвоните покупателю или отмените заказ.`,
        );
        break;
      }
      case "waiting": {
        if (order.status !== "new") break;
        const canCancel = getShop(db)?.settings.orders.customerCanCancel ?? false;
        const msg = waitingMessage(order, env, canCancel);
        await send(order.customerId, msg.text, { markup: msg.reply_markup });
        break;
      }
      case "reminder": {
        if (order.status !== "new") break;
        await dropReminders(order.id);
        const originals = new Map(
          messagesOf(order.id, "order").map((m) => [m.chatId, m.messageId]),
        );
        for (const m of staffWith(db, env, "orders.manage")) {
          const replyTo = originals.get(m.id);
          const id = await send(
            m.id,
            `⏰ Заказ <b>#${order.id}</b> ждёт уже ${n.waitingMinutes} мин`,
            {
              ...(replyTo && { replyTo }),
              markup: {
                inline_keyboard: [[{ text: "✅ Принять", callback_data: `a:${order.id}` }]],
              },
            },
          );
          if (id) remember("reminder", order.id, m.id, id);
        }
        break;
      }
    }
  }

  return {
    notify(n) {
      const prev = queues.get(n.orderId) ?? Promise.resolve();
      const next = prev
        .then(() => handle(n))
        .catch((err) => console.error(`Бот: уведомление ${n.type} по заказу #${n.orderId}:`, err));
      queues.set(n.orderId, next);
      void next.finally(() => {
        if (queues.get(n.orderId) === next) queues.delete(n.orderId);
      });
    },
    /** Дождаться отправки всех уведомлений (для тестов и остановки). */
    async idle() {
      while (queues.size > 0) await Promise.all(queues.values());
    },
  };
}

/** Запомнить пересланное сообщение покупателя — чтобы ответ менеджера ушёл ему. */
export function rememberRelay(
  deps: Deps,
  chatId: number,
  messageId: number,
  customerId: number,
  orderId: number | null,
) {
  deps.db
    .insert(botMessages)
    .values({ kind: "relay", orderId, chatId, messageId, customerId, createdAt: deps.now() })
    .run();
}
