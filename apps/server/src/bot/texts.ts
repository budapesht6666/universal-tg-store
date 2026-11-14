/** Тексты и кнопки сообщений бота (HTML-разметка Telegram). */
import { formatMoney, type InviteRole, mapsUrlFromCoords, ROLE_LABELS } from "@store/schema";
import { InlineKeyboard } from "grammy";
import type { Env } from "../env.ts";
import { cancelText, type OrderRow } from "../orders/service.ts";

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type Names = { name: (id: number | null) => string | null };

export const staffAppUrl = (env: Env, path = "") => `${env.PUBLIC_URL}/admin/${path}`;
export const shopAppUrl = (env: Env, path = "") => `${env.PUBLIC_URL}/${path}`;

function money(order: OrderRow, locale: string) {
  return formatMoney(order.total, order.currency, locale);
}

function itemsBlock(order: OrderRow) {
  return order.items.map((i) => `• ${esc(i.title)} × ${i.qty}`).join("\n");
}

function contactBlock(order: OrderRow) {
  const lines = [`👤 ${esc(order.customerName)} · ${esc(order.phone)}`];
  if (order.address) lines.push(`📍 ${esc(order.address)}`);
  if (order.comment) lines.push(`💬 ${esc(order.comment)}`);
  return lines.join("\n");
}

function statusLine(order: OrderRow, names: Names): string {
  const courier = names.name(order.courierId);
  const lines: string[] = [];
  switch (order.status) {
    case "new":
      lines.push("⏳ Ждёт, когда примут");
      break;
    case "processing":
      lines.push(
        [
          `👨‍🍳 Готовим · принял ${esc(names.name(order.acceptedBy) ?? "")}`,
          courier && `курьер ${esc(courier)}`,
        ]
          .filter(Boolean)
          .join(" · "),
      );
      break;
    case "shipping":
      lines.push(`🛵 ${courier ? `${esc(courier)} везёт` : "Курьер в пути"}`);
      break;
    case "done":
      lines.push("✅ Доставлен");
      break;
    case "cancelled":
      lines.push(`❌ ${esc(cancelText(order) ?? "Отменён")}`);
      break;
  }
  if (order.cancelRequestedAt && order.status !== "cancelled")
    lines.push("🙋 Покупатель просит отменить");
  if (order.deliveryIssue && order.status === "shipping") lines.push("⚠️ Не получилось доставить");
  return lines.join("\n");
}

/** «🆕 Заказ» у менеджера — одно сообщение, обновляется на месте при каждом изменении. */
export function staffOrderMessage(order: OrderRow, env: Env, locale: string, names: Names) {
  const head = order.status === "new" ? "🆕" : "📦";
  const text = [
    `${head} <b>Заказ #${order.id}</b> · ${money(order, locale)}`,
    itemsBlock(order),
    contactBlock(order),
    "",
    statusLine(order, names),
  ].join("\n");
  const kb = new InlineKeyboard();
  if (order.status === "new") kb.text("✅ Принять", `a:${order.id}`);
  kb.webApp("Открыть", staffAppUrl(env, `orders/${order.id}`));
  return { text, reply_markup: kb };
}

/** Карточка доставки у курьера. После доставки контакты из неё убираются. */
export function courierMessage(order: OrderRow, env: Env, locale: string) {
  if (order.status === "done" || order.status === "cancelled") {
    return {
      text:
        order.status === "done"
          ? `✅ Доставка #${order.id} завершена · ${money(order, locale)}`
          : `❌ Заказ #${order.id} отменён`,
      reply_markup: new InlineKeyboard(),
    };
  }
  const text = [
    `🛵 <b>Доставка #${order.id}</b> · получить ${money(order, locale)}`,
    itemsBlock(order),
    contactBlock(order),
  ].join("\n");
  const kb = new InlineKeyboard().url("🗺 Карта", mapsUrlFromCoords(order.lat, order.lng));
  if (order.status === "processing") kb.text("🥡 Забрал, еду", `p:${order.id}`);
  if (order.status === "shipping") kb.text("✅ Доставлен", `d:${order.id}`);
  kb.row().webApp("Открыть", staffAppUrl(env, `orders/${order.id}`));
  return { text, reply_markup: kb };
}

/** Сообщение покупателю о его заказе. null — писать не нужно. */
export function customerMessage(order: OrderRow, env: Env, locale: string, byCustomer: boolean) {
  const kb = new InlineKeyboard().webApp("Открыть заказ", shopAppUrl(env, `orders/${order.id}`));
  const sum = money(order, locale);
  const texts: Record<OrderRow["status"], string> = {
    new: `Заказ <b>#${order.id}</b> оформлен · ${sum}\nОплата курьеру при получении. Напишем, когда начнём готовить.`,
    processing: `👨‍🍳 Готовим ваш заказ <b>#${order.id}</b>`,
    shipping: `🛵 Курьер везёт заказ <b>#${order.id}</b>. Приготовьте ${sum}`,
    done: `✅ Заказ <b>#${order.id}</b> доставлен. Приятного аппетита!`,
    cancelled: byCustomer
      ? `Заказ <b>#${order.id}</b> отменён`
      : `❌ Заказ <b>#${order.id}</b> отменён: ${esc(cancelText(order) ?? "")}`,
  };
  return { text: texts[order.status], reply_markup: kb };
}

export function roleLabel(role: InviteRole): string {
  return ROLE_LABELS[role].toLowerCase();
}
