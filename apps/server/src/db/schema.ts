/**
 * Схема БД (SQLite). После правки: pnpm --filter @store/server db:generate — новая миграция
 * в apps/server/drizzle, применяется сама при запуске.
 * Деньги — целые числа в минимальных единицах валюты. Время — миллисекунды Unix.
 */
import type {
  AttributeDefinition,
  CancelReason,
  DeliveryFailureReason,
  ImageRef,
  InviteRole,
  OrderEventType,
  OrderItemSnapshot,
  OrderStatus,
  Role,
  Settings,
} from "@store/schema";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const ms = (name: string) => integer(name, { mode: "timestamp_ms" });
const bool = (name: string) => integer(name, { mode: "boolean" });

/** Одна строка (id = 1). Нет строки — магазин ещё не настроен. */
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  data: text("data", { mode: "json" }).$type<Settings>().notNull(),
  /** Пауза приёма заказов до этого момента. */
  pausedUntil: ms("paused_until"),
  updatedAt: ms("updated_at").notNull(),
});

export const attributes = sqliteTable("attributes", {
  key: text("key").primaryKey(),
  sort: integer("sort").notNull().default(0),
  definition: text("definition", { mode: "json" }).$type<AttributeDefinition>().notNull(),
});

export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  sort: integer("sort").notNull().default(0),
});

export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    price: integer("price").notNull(),
    compareAtPrice: integer("compare_at_price"),
    image: text("image", { mode: "json" }).$type<ImageRef>(),
    badges: text("badges", { mode: "json" }).$type<string[]>().notNull(),
    available: bool("available").notNull().default(true),
    isActive: bool("is_active").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    attributes: text("attributes", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [index("products_category").on(t.categoryId, t.sort)],
);

/** Все, кто открывал Mini App или писал боту. id — Telegram id. */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  username: text("username"),
  createdAt: ms("created_at").notNull(),
  lastSeenAt: ms("last_seen_at").notNull(),
});

/** Команда магазина. Владелец — OWNER_TELEGRAM_ID, строка создаётся при первой настройке. */
export const staff = sqliteTable("staff", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id),
  roles: text("roles", { mode: "json" }).$type<Role[]>().notNull(),
  active: bool("active").notNull().default(true),
  createdAt: ms("created_at").notNull(),
});

/** Приглашения: в БД только хеш токена из ссылки. */
export const invites = sqliteTable("invites", {
  tokenHash: text("token_hash").primaryKey(),
  role: text("role").$type<InviteRole>().notNull(),
  createdBy: integer("created_by").notNull(),
  createdAt: ms("created_at").notNull(),
  expiresAt: ms("expires_at").notNull(),
  usedBy: integer("used_by"),
  usedAt: ms("used_at"),
});

/** Ссылки входа на компьютере (login) и сессии браузера (session). В БД — хеши. */
export const authTokens = sqliteTable("auth_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  kind: text("kind").$type<"login" | "session">().notNull(),
  userId: integer("user_id").notNull(),
  createdAt: ms("created_at").notNull(),
  expiresAt: ms("expires_at").notNull(),
  usedAt: ms("used_at"),
});

export type DeliveryIssue = {
  reason: DeliveryFailureReason;
  comment?: string | undefined;
  by: number;
  at: number;
};

export const orders = sqliteTable(
  "orders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customerId: integer("customer_id")
      .notNull()
      .references(() => users.id),
    customerName: text("customer_name").notNull(),
    phone: text("phone").notNull(),
    phoneFromTelegram: bool("phone_from_telegram").notNull().default(false),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    accuracy: real("accuracy"),
    locationSource: text("location_source").$type<"pin" | "gps" | "link">().notNull(),
    address: text("address").notNull().default(""),
    comment: text("comment").notNull().default(""),
    items: text("items", { mode: "json" }).$type<OrderItemSnapshot[]>().notNull(),
    total: integer("total").notNull(),
    currency: text("currency").notNull(),
    status: text("status").$type<OrderStatus>().notNull(),
    acceptedBy: integer("accepted_by"),
    courierId: integer("courier_id"),
    cancelReason: text("cancel_reason").$type<CancelReason | "customer">(),
    cancelComment: text("cancel_comment"),
    cancelRequestedAt: ms("cancel_requested_at"),
    deliveryIssue: text("delivery_issue", { mode: "json" }).$type<DeliveryIssue>(),
    /** Отзыв покупателя после доставки: 1–5 звёзд и необязательный текст. */
    rating: integer("rating"),
    review: text("review"),
    reviewedAt: ms("reviewed_at"),
    /** Когда менеджер открыл заказ с отзывом — до этого на карточке «новый отзыв». */
    reviewSeenAt: ms("review_seen_at"),
    /** Когда последний раз напоминали менеджерам о непринятом заказе. */
    remindedAt: ms("reminded_at"),
    /** Когда написали покупателю «заказ ещё не приняли» (один раз, через 15 минут). */
    waitingNoticeAt: ms("waiting_notice_at"),
    createdAt: ms("created_at").notNull(),
    updatedAt: ms("updated_at").notNull(),
  },
  (t) => [
    index("orders_status").on(t.status, t.createdAt),
    index("orders_customer").on(t.customerId, t.createdAt),
    index("orders_courier").on(t.courierId, t.status),
  ],
);

export const orderEvents = sqliteTable(
  "order_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id),
    type: text("type").$type<OrderEventType>().notNull(),
    status: text("status").$type<OrderStatus>(),
    actorId: integer("actor_id"),
    note: text("note"),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [index("order_events_order").on(t.orderId, t.id)],
);

/**
 * Сообщения бота, которые потом правим или на которые отвечают:
 * order — «🆕 Заказ» у менеджера (обновляется на месте), reminder — напоминание,
 * courier — карточка доставки у курьера, relay — пересланное сообщение покупателя.
 */
export const botMessages = sqliteTable(
  "bot_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind").$type<"order" | "reminder" | "courier" | "relay">().notNull(),
    orderId: integer("order_id"),
    chatId: integer("chat_id").notNull(),
    messageId: integer("message_id").notNull(),
    /** Для relay: кому пересылать ответ. */
    customerId: integer("customer_id"),
    createdAt: ms("created_at").notNull(),
  },
  (t) => [
    index("bot_messages_order").on(t.orderId, t.kind),
    index("bot_messages_chat").on(t.chatId, t.messageId),
  ],
);
