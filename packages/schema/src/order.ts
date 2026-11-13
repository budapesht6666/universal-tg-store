/**
 * Заказы: статусы, допустимые переходы, отмена, оформление.
 * Названия статусов — единственный словарь для магазина, админки и бота (docs/product-decisions.md).
 */
import type { Settings } from "./catalog.ts";
import { IdSchema } from "./catalog.ts";
import { buildZodSchema } from "./fields.ts";
import type { Minor } from "./money.ts";
import { z } from "./zod.ts";

export const ORDER_STATUSES = ["new", "processing", "shipping", "done", "cancelled"] as const;
export const OrderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.output<typeof OrderStatusSchema>;

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: "Оформлен",
  processing: "Собираем",
  shipping: "Курьер в пути",
  done: "Доставлен",
  cancelled: "Отменён",
};

/** Шаги для полосы прогресса и истории (отмена — отдельная ветка). */
export const ORDER_FLOW = [
  "new",
  "processing",
  "shipping",
  "done",
] as const satisfies readonly OrderStatus[];

/** Допустимые переходы. Сервер проверяет их при каждой смене статуса. */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  new: ["processing", "cancelled"],
  processing: ["shipping", "cancelled"],
  shipping: ["done", "cancelled"],
  done: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function isFinalStatus(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

/**
 * Что может покупатель с заказом:
 * cancel — отменить сам (только «Оформлен» и если разрешено настройкой);
 * request — попросить менеджера отменить; none — заказ закрыт.
 */
export function customerCancelMode(
  status: OrderStatus,
  settings: Pick<Settings, "orders">,
): "cancel" | "request" | "none" {
  if (isFinalStatus(status)) return "none";
  if (status === "new" && settings.orders.customerCanCancel) return "cancel";
  return "request";
}

// ───────────── Отмена ─────────────

export const CANCEL_REASONS = ["out_of_stock", "no_answer", "customer_request", "other"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  out_of_stock: "Нет в наличии",
  no_answer: "Не дозвонились до покупателя",
  customer_request: "Покупатель попросил",
  other: "Другое",
};

/** Отмена менеджером: причина обязательна, «Другое» — с комментарием, который увидит покупатель. */
export const StaffCancelInputSchema = z
  .strictObject({
    reason: z.enum(CANCEL_REASONS),
    comment: z.string().trim().max(500).optional(),
    restock: z.boolean().default(true),
  })
  .refine((v) => v.reason !== "other" || (v.comment !== undefined && v.comment.length > 0), {
    error: "Опишите причину — её увидит покупатель",
    path: ["comment"],
  });
export type StaffCancelInput = z.output<typeof StaffCancelInputSchema>;

// ───────────── Доставка ─────────────

export const DELIVERY_FAILURE_REASONS = ["no_answer", "not_home", "refused", "other"] as const;
export type DeliveryFailureReason = (typeof DELIVERY_FAILURE_REASONS)[number];

export const DELIVERY_FAILURE_LABELS: Record<DeliveryFailureReason, string> = {
  no_answer: "Не дозвонился",
  not_home: "Никого нет дома",
  refused: "Покупатель отказался",
  other: "Другое",
};

// ───────────── Оформление ─────────────

export const OrderItemInputSchema = z.strictObject({
  productId: IdSchema,
  qty: z.int().min(1, { error: "Количество — от 1" }),
});

/**
 * Что присылает магазин при оформлении. Цены и остатки клиент не присылает: сервер берёт их из БД.
 * Поля покупателя проверяются схемой из settings.checkout.fields — см. buildCheckoutSchema.
 */
export const CreateOrderInputSchema = z.strictObject({
  items: z
    .array(OrderItemInputSchema)
    .min(1, { error: "Корзина пуста" })
    .max(100)
    .refine((items) => new Set(items.map((i) => i.productId)).size === items.length, {
      error: "Товар повторяется — объедините позиции",
    }),
  customer: z.record(z.string(), z.unknown()),
  /** Номер подтверждён Telegram (requestContact) — для пометки «из Telegram» в админке. */
  phoneFromTelegram: z.boolean().default(false),
});
export type CreateOrderInput = z.output<typeof CreateOrderInputSchema>;

/** Проверка полей покупателя по настройкам оформления. */
export function buildCheckoutSchema(settings: Pick<Settings, "checkout">) {
  return buildZodSchema(settings.checkout.fields);
}

/** Позиция заказа — снимок на момент оформления: цена и название не меняются вместе с каталогом. */
export type OrderItemSnapshot = {
  productId: string;
  title: string;
  price: Minor;
  qty: number;
};

export function orderTotal(items: readonly Pick<OrderItemSnapshot, "price" | "qty">[]): Minor {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}
