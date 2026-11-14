/**
 * Заказы: статусы, допустимые переходы, отмена, оформление.
 * Названия статусов — единственный словарь для магазина, админки и бота (docs/product-decisions.md).
 */
import { IdSchema, MAX_QTY_PER_ITEM } from "./catalog.ts";
import { DeliveryLocationSchema } from "./geo.ts";
import type { Minor } from "./money.ts";
import { phoneSchema } from "./phone.ts";
import type { Settings } from "./settings.ts";
import { z } from "./zod.ts";

export const ORDER_STATUSES = ["new", "processing", "shipping", "done", "cancelled"] as const;
export const OrderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.output<typeof OrderStatusSchema>;

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  new: "Оформлен",
  processing: "Готовим",
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
 * request — попросить магазин отменить; none — заказ закрыт.
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
  out_of_stock: "Закончилось блюдо",
  no_answer: "Не дозвонились до покупателя",
  customer_request: "Покупатель попросил",
  other: "Другое",
};

/** Отмена магазином: причина обязательна, «Другое» — с комментарием, который увидит покупатель. */
export const StaffCancelInputSchema = z
  .strictObject({
    reason: z.enum(CANCEL_REASONS),
    comment: z.string().trim().max(500).optional(),
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
  not_home: "Никого нет на месте",
  refused: "Покупатель отказался",
  other: "Другое",
};

// ───────────── Оформление ─────────────

export const OrderItemInputSchema = z.strictObject({
  productId: IdSchema,
  qty: z
    .int()
    .min(1, { error: "Количество — от 1" })
    .max(MAX_QTY_PER_ITEM, { error: `Не больше ${MAX_QTY_PER_ITEM} порций одного блюда` }),
});

/**
 * Что присылает магазин при оформлении. Цен клиент не присылает: сервер берёт их из БД.
 * Форма фиксированная: имя, телефон, точка на карте (координаты пина), уточнение адреса,
 * комментарий. Ссылки клиент разбирает заранее (parseLocationText, короткие — через сервер).
 * Телефон нормализуется по коду страны магазина, поэтому схема строится от настроек.
 */
export function createOrderInputSchema(settings: Pick<Settings, "region">) {
  return z.strictObject({
    items: z
      .array(OrderItemInputSchema)
      .min(1, { error: "Корзина пуста" })
      .max(100)
      .refine((items) => new Set(items.map((i) => i.productId)).size === items.length, {
        error: "Блюдо повторяется — объедините позиции",
      }),
    customer: z.strictObject({
      name: z.string().trim().min(1, { error: "Как к вам обращаться?" }).max(80),
      phone: phoneSchema(settings.region.phoneCode),
      location: DeliveryLocationSchema,
      address: z
        .string()
        .trim()
        .max(300)
        .default("")
        .meta({ description: "Дом, подъезд, этаж, квартира — необязательно" }),
      comment: z.string().trim().max(500).default(""),
    }),
    /** Номер пришёл из Telegram (кнопка «Взять из Telegram») — пометка в админке. */
    phoneFromTelegram: z.boolean().default(false),
  });
}
export type CreateOrderInput = z.output<ReturnType<typeof createOrderInputSchema>>;

/** Позиция заказа — снимок на момент оформления: цена и название не меняются вместе с меню. */
export type OrderItemSnapshot = {
  productId: string;
  title: string;
  price: Minor;
  qty: number;
};

export function orderTotal(items: readonly Pick<OrderItemSnapshot, "price" | "qty">[]): Minor {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}
