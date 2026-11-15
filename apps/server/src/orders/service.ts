/**
 * Заказы: оформление, отмена покупателем, действия менеджера и курьера, напоминания.
 * Правила — docs/product-decisions.md. Цены берутся из БД, клиенту не доверяем.
 * Смена статуса — условный UPDATE … WHERE status = <ожидаемый>: два менеджера,
 * нажавшие «Принять» одновременно, не примут заказ дважды.
 */
import {
  CANCEL_REASON_LABELS,
  type CancelReason,
  can,
  canOrderProduct,
  canTransition,
  createOrderInputSchema,
  customerCancelMode,
  DELIVERY_FAILURE_LABELS,
  isFinalStatus,
  mapsUrlFromCoords,
  ORDER_STATUS_LABELS,
  ORDER_STATUSES,
  type OrderItemSnapshot,
  OrderReviewInputSchema,
  type OrderStatus,
  orderTotal,
  type Role,
  type StaffOrderAction,
} from "@store/schema";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { orderEvents, orders, users } from "../db/schema.ts";
import type { Deps } from "../deps.ts";
import { AppError, parseInput } from "../errors.ts";
import { getProductsByIds } from "../repo/catalog.ts";
import { getShop, statusOf } from "../repo/settings.ts";
import { rolesOf, staffWith, userName } from "../repo/team.ts";

export type OrderRow = typeof orders.$inferSelect;
export type Actor = { id: number; roles: Role[] };

/**
 * Писать магазину через бота можно, только пока заказ в работе. После доставки или отмены и без
 * заказа сообщения менеджерам не уходят — защита от спама; бот сам отвечает контактом менеджера.
 */
export function chatOpen(order: Pick<OrderRow, "status">): boolean {
  return !isFinalStatus(order.status);
}

const ACTIVE_STATUSES = ORDER_STATUSES.filter((s) => !isFinalStatus(s));

/** Последний заказ покупателя в работе — по нему можно писать магазину. */
export function chatOrder(db: Db, customerId: number): OrderRow | null {
  return (
    db
      .select()
      .from(orders)
      .where(and(eq(orders.customerId, customerId), inArray(orders.status, ACTIVE_STATUSES)))
      .orderBy(desc(orders.createdAt))
      .limit(1)
      .get() ?? null
  );
}

/** Напоминание менеджерам о непринятом заказе — каждые 3 минуты. */
export const REMINDER_INTERVAL_MS = 3 * 60 * 1000;

export function getOrder(db: Db, id: number): OrderRow {
  const order = db.select().from(orders).where(eq(orders.id, id)).get();
  if (!order) throw new AppError(404, "Заказ не найден");
  return order;
}

function addEvent(
  db: Db,
  orderId: number,
  event: Omit<typeof orderEvents.$inferInsert, "orderId" | "createdAt">,
  now: Date,
) {
  db.insert(orderEvents)
    .values({ ...event, orderId, createdAt: now })
    .run();
}

// ───────────── Оформление ─────────────

export function createOrder(deps: Deps, customerId: number, body: unknown): OrderRow {
  const { db, now: clock, notifier } = deps;
  const now = clock();
  const shop = getShop(db);
  if (!shop) throw new AppError(503, "Магазин ещё не открылся — заходите чуть позже");

  const status = statusOf(shop, now);
  if (!status.open) {
    const when = status.opensAt ? ` · откроемся ${status.opensAt}` : "";
    throw new AppError(
      409,
      status.reason === "paused" ? `Сейчас не принимаем заказы${when}` : `Сейчас закрыто${when}`,
    );
  }

  const input = parseInput(createOrderInputSchema(shop.settings), body);

  // better-sqlite3 синхронный и с одним соединением: запросы к db внутри колбэка
  // идут в той же транзакции.
  const order = db.transaction(() => {
    const products = new Map(
      getProductsByIds(
        db,
        input.items.map((i) => i.productId),
      ).map((p) => [p.id, p]),
    );
    const issues: { path: string; message: string }[] = [];
    const items: OrderItemSnapshot[] = [];
    input.items.forEach((item, i) => {
      const p = products.get(item.productId);
      if (!p?.isActive) {
        issues.push({ path: `items[${i}]`, message: "Этого блюда больше нет в меню" });
      } else if (!canOrderProduct(p)) {
        issues.push({ path: `items[${i}]`, message: `«${p.title}» закончилось` });
      } else {
        items.push({ productId: p.id, title: p.title, price: p.price, qty: item.qty });
      }
    });
    if (issues.length > 0) {
      throw new AppError(409, `${issues[0]?.message}. Уберите из корзины и оформите снова`, issues);
    }

    const { customer } = input;
    const row = db
      .insert(orders)
      .values({
        customerId,
        customerName: customer.name,
        phone: customer.phone,
        phoneFromTelegram: input.phoneFromTelegram,
        lat: customer.location.lat,
        lng: customer.location.lng,
        accuracy: customer.location.accuracy ?? null,
        locationSource: customer.location.source,
        address: customer.address,
        comment: customer.comment,
        items,
        total: orderTotal(items),
        currency: shop.settings.region.currency,
        status: "new",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    addEvent(db, row.id, { type: "created", status: "new", actorId: customerId }, now);
    return row;
  });

  notifier.notify({ type: "created", orderId: order.id });
  return order;
}

// ───────────── Покупатель ─────────────

export function customerCancel(deps: Deps, customerId: number, orderId: number): OrderRow {
  const { db, notifier } = deps;
  const now = deps.now();
  const order = getOrder(db, orderId);
  if (order.customerId !== customerId) throw new AppError(404, "Заказ не найден");
  const shop = getShop(db);
  if (!shop) throw new AppError(503, "Магазин не настроен");

  const mode = customerCancelMode(order.status, shop.settings);
  if (mode === "none") throw new AppError(409, "Заказ уже закрыт");

  if (mode === "cancel") {
    const updated = transition(db, order, "cancelled", now, {
      cancelReason: "customer",
    });
    addEvent(db, order.id, { type: "status", status: "cancelled", actorId: customerId }, now);
    notifier.notify({ type: "status", orderId: order.id, actorId: null });
    return updated;
  }

  if (order.cancelRequestedAt) return order; // уже просили — второй раз не дёргаем менеджера
  const updated = db
    .update(orders)
    .set({ cancelRequestedAt: now, updatedAt: now })
    .where(eq(orders.id, order.id))
    .returning()
    .get();
  if (!updated) throw new AppError(404, "Заказ не найден");
  addEvent(db, order.id, { type: "cancel_requested", actorId: customerId }, now);
  notifier.notify({ type: "cancel_requested", orderId: order.id });
  return updated;
}

/** Оценка после доставки: один раз, только свой доставленный заказ, если отзывы включены. */
export function customerReview(
  deps: Deps,
  customerId: number,
  orderId: number,
  body: unknown,
): OrderRow {
  const { db } = deps;
  const now = deps.now();
  const order = getOrder(db, orderId);
  if (order.customerId !== customerId) throw new AppError(404, "Заказ не найден");
  if (!getShop(db)?.settings.features.reviews) throw new AppError(409, "Отзывы выключены");
  if (order.status !== "done") throw new AppError(409, "Оценить можно доставленный заказ");
  const input = parseInput(OrderReviewInputSchema, body);
  const updated = db
    .update(orders)
    .set({ rating: input.rating, review: input.text || null, reviewedAt: now })
    .where(and(eq(orders.id, order.id), isNull(orders.rating)))
    .returning()
    .get();
  if (!updated) throw new AppError(409, "Отзыв уже оставлен — спасибо!");
  addEvent(db, order.id, { type: "reviewed", actorId: customerId, note: `${input.rating}★` }, now);
  return updated;
}

// ───────────── Магазин ─────────────

/** Менеджер открыл заказ с отзывом — пометка «новый отзыв» снимается для всех. */
export function markReviewSeen(deps: Deps, actor: Actor, orderId: number): OrderRow {
  requirePermission(actor, "orders.manage");
  const { db } = deps;
  const order = getOrder(db, orderId);
  if (order.rating === null || order.reviewSeenAt !== null) return order;
  return (
    db
      .update(orders)
      .set({ reviewSeenAt: deps.now() })
      .where(and(eq(orders.id, order.id), isNull(orders.reviewSeenAt)))
      .returning()
      .get() ?? getOrder(db, order.id)
  );
}

/** Смена статуса с проверкой перехода и защитой от гонки. */
function transition(
  db: Db,
  order: OrderRow,
  to: OrderStatus,
  now: Date,
  extra: Partial<typeof orders.$inferInsert> = {},
): OrderRow {
  if (!canTransition(order.status, to)) {
    throw new AppError(409, `Заказ уже «${ORDER_STATUS_LABELS[order.status]}» — обновите список`);
  }
  const updated = db
    .update(orders)
    .set({ ...extra, status: to, updatedAt: now })
    .where(and(eq(orders.id, order.id), eq(orders.status, order.status)))
    .returning()
    .get();
  if (!updated) {
    const fresh = getOrder(db, order.id);
    throw new AppError(409, `Заказ уже «${ORDER_STATUS_LABELS[fresh.status]}» — обновите список`);
  }
  return updated;
}

function requirePermission(actor: Actor, permission: Parameters<typeof can>[1]) {
  if (!can(actor.roles, permission)) throw new AppError(403, "Нет доступа");
}

/** Курьер работает только со своими заказами; менеджер — с любыми. */
function requireCourierOrManager(actor: Actor, order: OrderRow) {
  if (can(actor.roles, "orders.manage")) return;
  if (can(actor.roles, "delivery.work") && order.courierId === actor.id) return;
  throw new AppError(403, "Это не ваша доставка");
}

export function staffAction(
  deps: Deps,
  actor: Actor,
  orderId: number,
  action: StaffOrderAction,
): OrderRow {
  const { db, env, notifier } = deps;
  const now = deps.now();
  const order = getOrder(db, orderId);

  switch (action.action) {
    case "accept": {
      requirePermission(actor, "orders.manage");
      const couriers = staffWith(db, env, "delivery.work");
      const autoCourier =
        order.courierId === null && couriers.length === 1 ? (couriers[0]?.id ?? null) : null;
      const updated = db.transaction(() => {
        const row = transition(db, order, "processing", now, {
          acceptedBy: actor.id,
          ...(autoCourier !== null && { courierId: autoCourier }),
        });
        addEvent(db, order.id, { type: "status", status: "processing", actorId: actor.id }, now);
        if (autoCourier !== null) {
          addEvent(
            db,
            order.id,
            { type: "courier_assigned", actorId: autoCourier, note: "авто" },
            now,
          );
        }
        return row;
      });
      notifier.notify({ type: "accepted", orderId: order.id, actorId: actor.id });
      if (autoCourier !== null) {
        notifier.notify({
          type: "courier_assigned",
          orderId: order.id,
          courierId: autoCourier,
          previousCourierId: null,
        });
      }
      return updated;
    }

    case "assign": {
      requirePermission(actor, "orders.manage");
      if (order.status !== "processing" && order.status !== "shipping") {
        throw new AppError(409, "Сначала примите заказ");
      }
      if (!can(rolesOf(db, env, action.courierId), "delivery.work")) {
        throw new AppError(400, "Этот человек не курьер");
      }
      if (order.courierId === action.courierId) return order;
      const updated = db
        .update(orders)
        .set({ courierId: action.courierId, deliveryIssue: null, updatedAt: now })
        .where(eq(orders.id, order.id))
        .returning()
        .get();
      if (!updated) throw new AppError(404, "Заказ не найден");
      addEvent(db, order.id, { type: "courier_assigned", actorId: action.courierId }, now);
      notifier.notify({
        type: "courier_assigned",
        orderId: order.id,
        courierId: action.courierId,
        previousCourierId: order.courierId,
      });
      return updated;
    }

    case "pickup": {
      requireCourierOrManager(actor, order);
      if (order.courierId === null) throw new AppError(409, "Сначала назначьте курьера");
      const updated = transition(db, order, "shipping", now);
      addEvent(db, order.id, { type: "status", status: "shipping", actorId: actor.id }, now);
      notifier.notify({ type: "status", orderId: order.id, actorId: actor.id });
      return updated;
    }

    case "deliver": {
      requireCourierOrManager(actor, order);
      const updated = transition(db, order, "done", now, { deliveryIssue: null });
      addEvent(db, order.id, { type: "status", status: "done", actorId: actor.id }, now);
      notifier.notify({ type: "status", orderId: order.id, actorId: actor.id });
      return updated;
    }

    case "fail": {
      requireCourierOrManager(actor, order);
      if (order.status !== "shipping" && order.status !== "processing") {
        throw new AppError(409, "Заказ не в доставке");
      }
      const updated = db
        .update(orders)
        .set({
          deliveryIssue: {
            reason: action.reason,
            comment: action.comment,
            by: actor.id,
            at: now.getTime(),
          },
          updatedAt: now,
        })
        .where(eq(orders.id, order.id))
        .returning()
        .get();
      if (!updated) throw new AppError(404, "Заказ не найден");
      const note = [DELIVERY_FAILURE_LABELS[action.reason], action.comment]
        .filter(Boolean)
        .join(": ");
      addEvent(db, order.id, { type: "delivery_failed", actorId: actor.id, note }, now);
      notifier.notify({ type: "delivery_failed", orderId: order.id, actorId: actor.id });
      return updated;
    }

    case "cancel": {
      requirePermission(actor, "orders.manage");
      const updated = transition(db, order, "cancelled", now, {
        cancelReason: action.reason,
        cancelComment: action.comment ?? null,
      });
      addEvent(db, order.id, { type: "status", status: "cancelled", actorId: actor.id }, now);
      notifier.notify({ type: "status", orderId: order.id, actorId: actor.id });
      return updated;
    }
  }
}

/** Заказы, о которых пора напомнить: не приняты и с прошлого напоминания прошло 3 минуты. */
export function dueReminders(deps: Deps): { order: OrderRow; waitingMinutes: number }[] {
  const { db } = deps;
  const now = deps.now();
  const edge = new Date(now.getTime() - REMINDER_INTERVAL_MS);
  const due = db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.status, "new"),
        or(
          lte(orders.remindedAt, edge),
          and(isNull(orders.remindedAt), lte(orders.createdAt, edge)),
        ),
      ),
    )
    .all();
  return due.map((order) => {
    db.update(orders).set({ remindedAt: now }).where(eq(orders.id, order.id)).run();
    const waitingMinutes = Math.floor((now.getTime() - order.createdAt.getTime()) / 60_000);
    return { order, waitingMinutes };
  });
}

// ───────────── Списки и карточки ─────────────

export function cancelText(order: OrderRow): string | null {
  if (order.status !== "cancelled") return null;
  if (order.cancelReason === "customer" || order.cancelReason === null)
    return "Отменён покупателем";
  const label = CANCEL_REASON_LABELS[order.cancelReason as CancelReason];
  return order.cancelComment ? `${label}: ${order.cancelComment}` : label;
}

function history(db: Db, orderId: number) {
  return db
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(asc(orderEvents.id))
    .all();
}

function reviewOf(order: OrderRow) {
  if (order.rating === null) return null;
  return {
    rating: order.rating,
    text: order.review ?? "",
    at: (order.reviewedAt ?? order.updatedAt).toISOString(),
  };
}

/** Заказ глазами покупателя. */
export function customerView(db: Db, order: OrderRow) {
  const shop = getShop(db);
  const reviewsOn = shop?.settings.features.reviews ?? false;
  return {
    id: order.id,
    status: order.status,
    items: order.items,
    total: order.total,
    currency: order.currency,
    createdAt: order.createdAt.toISOString(),
    name: order.customerName,
    phone: order.phone,
    location: { lat: order.lat, lng: order.lng },
    address: order.address,
    comment: order.comment,
    cancelMode: shop ? customerCancelMode(order.status, shop.settings) : "none",
    cancelRequested: order.cancelRequestedAt !== null,
    cancelReason: cancelText(order),
    review: reviewOf(order),
    canReview: reviewsOn && order.status === "done" && order.rating === null,
    /** Можно ли сейчас написать магазину в чат с ботом. */
    chatOpen: chatOpen(order),
    history: history(db, order.id)
      .filter((e) => e.type === "status" || e.type === "created")
      .map((e) => ({ status: e.status, at: e.createdAt.toISOString() })),
  };
}
export type CustomerOrderView = ReturnType<typeof customerView>;

export function listCustomerOrders(db: Db, customerId: number) {
  return db
    .select()
    .from(orders)
    .where(eq(orders.customerId, customerId))
    .orderBy(desc(orders.createdAt))
    .limit(30)
    .all()
    .map((o) => customerView(db, o));
}

/** Данные последнего заказа — чтобы второй заказ оформлялся одним нажатием. */
export function lastCustomerDetails(db: Db, customerId: number) {
  const o = db
    .select()
    .from(orders)
    .where(eq(orders.customerId, customerId))
    .orderBy(desc(orders.createdAt))
    .limit(1)
    .get();
  if (!o) return null;
  return {
    name: o.customerName,
    phone: o.phone,
    location: { lat: o.lat, lng: o.lng, source: o.locationSource },
    address: o.address,
  };
}

function person(db: Db, id: number | null) {
  return id === null ? null : { id, name: userName(db, id) };
}

/**
 * Заказ глазами менеджера или курьера. Курьеру после доставки контакты и адрес
 * покупателя больше не показываем.
 */
export function staffView(db: Db, order: OrderRow, viewer: Actor) {
  const customer = db.select().from(users).where(eq(users.id, order.customerId)).get();
  const hideContacts =
    !can(viewer.roles, "orders.manage") &&
    (order.status === "done" || order.status === "cancelled");
  const issue = order.deliveryIssue;
  const review = reviewOf(order);
  return {
    id: order.id,
    status: order.status,
    items: order.items,
    total: order.total,
    currency: order.currency,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    customer: hideContacts
      ? {
          id: order.customerId,
          name: order.customerName,
          phone: null,
          username: null,
          phoneFromTelegram: false,
        }
      : {
          id: order.customerId,
          name: order.customerName,
          phone: order.phone,
          username: customer?.username ?? null,
          phoneFromTelegram: order.phoneFromTelegram,
        },
    location: hideContacts
      ? null
      : {
          lat: order.lat,
          lng: order.lng,
          accuracy: order.accuracy,
          source: order.locationSource,
          mapsUrl: mapsUrlFromCoords(order.lat, order.lng),
        },
    address: hideContacts ? "" : order.address,
    comment: hideContacts ? "" : order.comment,
    acceptedBy: person(db, order.acceptedBy),
    courier: person(db, order.courierId),
    cancelRequested: order.cancelRequestedAt !== null && order.status !== "cancelled",
    cancelReason: cancelText(order),
    deliveryIssue: issue
      ? {
          reason: issue.reason,
          text: [DELIVERY_FAILURE_LABELS[issue.reason], issue.comment].filter(Boolean).join(": "),
          by: person(db, issue.by),
          at: new Date(issue.at).toISOString(),
        }
      : null,
    /** Отзыв видит только менеджер. seen=false — на карточке «новый отзыв». */
    review:
      review && can(viewer.roles, "orders.manage")
        ? { ...review, seen: order.reviewSeenAt !== null }
        : null,
  };
}
export type StaffOrderView = ReturnType<typeof staffView>;

const ACTIVE: OrderStatus[] = ["processing", "shipping"];
const DONE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Экран «Заказы»: Новые · В работе · Готово (за сутки; заказ с отзывом поднимается наверх
 * «Готово» на сутки после отзыва, а непрочитанный отзыв висит, пока менеджер его не откроет).
 * Режим курьера — только назначенные ему заказы.
 */
export function staffBoard(deps: Deps, viewer: Actor, mode: "manager" | "courier") {
  const { db } = deps;
  if (mode === "manager") requirePermission(viewer, "orders.manage");
  else requirePermission(viewer, "delivery.work");
  const since = new Date(deps.now().getTime() - DONE_WINDOW_MS);
  const mine = mode === "courier" ? eq(orders.courierId, viewer.id) : undefined;
  const view = (o: OrderRow) =>
    staffView(db, o, mode === "courier" ? { ...viewer, roles: ["courier"] } : viewer);

  const fresh =
    mode === "manager"
      ? db
          .select()
          .from(orders)
          .where(eq(orders.status, "new"))
          .orderBy(asc(orders.createdAt))
          .all()
      : [];
  const active = db
    .select()
    .from(orders)
    .where(and(inArray(orders.status, ACTIVE), mine))
    .orderBy(asc(orders.createdAt))
    .all();
  const done = db
    .select()
    .from(orders)
    .where(
      and(
        inArray(orders.status, ["done", "cancelled"]),
        or(
          gte(orders.updatedAt, since),
          gte(orders.reviewedAt, since),
          mode === "manager"
            ? and(isNotNull(orders.rating), isNull(orders.reviewSeenAt))
            : undefined,
        ),
        mine,
      ),
    )
    .orderBy(desc(sql`max(${orders.updatedAt}, coalesce(${orders.reviewedAt}, 0))`))
    .limit(50)
    .all();
  return { new: fresh.map(view), active: active.map(view), done: done.map(view) };
}
