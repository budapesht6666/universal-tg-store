/**
 * Аналитика: запись событий Mini App и снимков корзины, отчёт для админки.
 * Сотрудники (все, у кого есть строка в staff, и владелец из .env) в статистику не попадают.
 * Дни и часы считаются по часовому поясу магазина. Объёмы маленькие — считаем в JS.
 */
import {
  type AnalyticsBatchSchema,
  type AnalyticsBucket,
  type AnalyticsPeriod,
  type AnalyticsReport,
  CANCEL_REASON_LABELS,
  type CancelReason,
  type CartSnapshot,
  type KpiValue,
  PERIOD_DAYS,
  sourceOf,
  WEEKDAY_LABELS,
  WEEKDAYS,
  type WeekHours,
  type z,
} from "@store/schema";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import {
  analyticsEvents,
  carts,
  orderEvents,
  orders,
  products,
  staff,
  users,
} from "../db/schema.ts";
import type { Env } from "../env.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// ───────────── Запись ─────────────

export function recordEvents(
  db: Db,
  userId: number,
  batch: z.output<typeof AnalyticsBatchSchema>,
  now: Date,
): void {
  db.insert(analyticsEvents)
    .values(
      batch.events.map((e) => ({
        userId,
        type: e.type,
        productId: e.productId ?? null,
        source: e.type === "visit" ? (e.source ?? null) : null,
        createdAt: now,
      })),
    )
    .run();
}

/** Снимок корзины: сумма — по ценам из БД (скрытые и удалённые блюда не считаем). Пустая — удалить. */
export function saveCart(db: Db, userId: number, snapshot: CartSnapshot, now: Date): void {
  const ids = Object.keys(snapshot.items);
  if (ids.length === 0) {
    deleteCart(db, userId);
    return;
  }
  const rows = db
    .select({ id: products.id, price: products.price, isActive: products.isActive })
    .from(products)
    .where(inArray(products.id, ids))
    .all();
  const total = rows
    .filter((p) => p.isActive)
    .reduce((sum, p) => sum + p.price * (snapshot.items[p.id] ?? 0), 0);
  const values = { items: snapshot.items, total, updatedAt: now };
  db.insert(carts)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: carts.userId, set: values })
    .run();
}

export function deleteCart(db: Db, userId: number): void {
  db.delete(carts).where(eq(carts.userId, userId)).run();
}

// ───────────── Время магазина ─────────────

const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

const formatters = new Map<string, Intl.DateTimeFormat>();

type LocalParts = { y: number; m: number; d: number; h: number; mi: number; s: number; wd: number };

function localParts(date: Date, timeZone: string): LocalParts {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  const parts = f.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  return {
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
    h: Number(get("hour")),
    mi: Number(get("minute")),
    s: Number(get("second")),
    wd: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday")),
  };
}

/** Полночь того дня (по времени магазина), в который попадает момент. */
function startOfLocalDay(date: Date, timeZone: string): Date {
  const p = localParts(date, timeZone);
  const offset =
    Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(date.getTime() / 1000) * 1000;
  return new Date(Date.UTC(p.y, p.m - 1, p.d) - offset);
}

const dayKey = (date: Date, timeZone: string) => {
  const p = localParts(date, timeZone);
  return `${p.y}-${p.m}-${p.d}`;
};

/** Часы, которые показываем на графике «сегодня»: рабочие часы дня плюс часы, где что-то было. */
function hourRange(hours: WeekHours, weekday: number, busy: number[]): [number, number] {
  const day = hours[WEEKDAYS[weekday] ?? "mon"];
  let from = 0;
  let to = 23;
  if (day) {
    const open = Number(day.from.slice(0, 2));
    const close = Number(day.to.slice(0, 2)) - (day.to.endsWith(":00") ? 1 : 0);
    if (close > open) [from, to] = [open, close];
  }
  for (const h of busy) {
    from = Math.min(from, h);
    to = Math.max(to, h);
  }
  return [from, to];
}

// ───────────── Отчёт ─────────────

type EventRow = typeof analyticsEvents.$inferSelect;
type OrderRow = Pick<
  typeof orders.$inferSelect,
  "id" | "customerId" | "total" | "status" | "cancelReason" | "rating" | "items" | "createdAt"
>;

const unique = (ids: Iterable<number>) => new Set(ids).size;
const avg = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const pct = (part: number, whole: number) =>
  whole > 0 ? Math.min(Math.round((part / whole) * 1000) / 10, 100) : null;

function metrics(events: EventRow[], list: OrderRow[]) {
  const visitors = unique(events.filter((e) => e.type === "visit").map((e) => e.userId));
  const delivered = list.filter((o) => o.status === "done");
  const revenue = delivered.reduce((s, o) => s + o.total, 0);
  const buyers = unique(list.map((o) => o.customerId));
  return {
    visitors,
    orders: list.length,
    revenue,
    avgCheck: delivered.length ? Math.round(revenue / delivered.length) : null,
    conversion: pct(buyers, visitors),
  };
}

export type ReportOptions = {
  db: Db;
  env: Env;
  now: Date;
  period: AnalyticsPeriod;
  timeZone: string;
  hours: WeekHours;
};

export function analyticsReport({
  db,
  env,
  now,
  period,
  timeZone,
  hours,
}: ReportOptions): AnalyticsReport {
  const days = PERIOD_DAYS[period];
  const from = startOfLocalDay(new Date(now.getTime() - (days - 1) * DAY), timeZone);
  const shift = days * DAY;
  const prevFrom = new Date(from.getTime() - shift);
  const prevTo = new Date(now.getTime() - shift);
  const inRange = (d: Date) => d >= from && d <= now;
  const inPrev = (d: Date) => d >= prevFrom && d <= prevTo;

  const team = new Set(
    db
      .select({ id: staff.userId })
      .from(staff)
      .all()
      .map((r) => r.id),
  );
  team.add(env.OWNER_TELEGRAM_ID);
  const customer = (id: number) => !team.has(id);

  const allEvents = db
    .select()
    .from(analyticsEvents)
    .where(
      and(
        gte(analyticsEvents.createdAt, prevFrom),
        lt(analyticsEvents.createdAt, new Date(now.getTime() + 1)),
      ),
    )
    .all()
    .filter((e) => customer(e.userId));
  const events = allEvents.filter((e) => inRange(e.createdAt));
  const prevEvents = allEvents.filter((e) => inPrev(e.createdAt));

  const allOrders: OrderRow[] = db
    .select({
      id: orders.id,
      customerId: orders.customerId,
      total: orders.total,
      status: orders.status,
      cancelReason: orders.cancelReason,
      rating: orders.rating,
      items: orders.items,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(and(gte(orders.createdAt, prevFrom), lt(orders.createdAt, new Date(now.getTime() + 1))))
    .all()
    .filter((o) => customer(o.customerId));
  const list = allOrders.filter((o) => inRange(o.createdAt));
  const prevList = allOrders.filter((o) => inPrev(o.createdAt));

  const cur = metrics(events, list);
  const prev = metrics(prevEvents, prevList);
  const kpi = (key: keyof typeof cur): KpiValue => ({ value: cur[key], prev: prev[key] });

  // Столбики: часы сегодняшнего дня или дни периода.
  const series: AnalyticsBucket[] = [];
  const indexOf: (d: Date) => number = (() => {
    if (period === "today") {
      const busy = [...events.map((e) => e.createdAt), ...list.map((o) => o.createdAt)].map(
        (d) => localParts(d, timeZone).h,
      );
      const [h0, h1] = hourRange(hours, localParts(now, timeZone).wd, busy);
      for (let h = h0; h <= h1; h++) {
        series.push(emptyBucket(String(h), `${pad(h)}:00–${pad(h + 1)}:00`));
      }
      return (d: Date) => localParts(d, timeZone).h - h0;
    }
    const keys = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const day = new Date(from.getTime() + i * DAY + 12 * HOUR);
      const p = localParts(day, timeZone);
      keys.set(dayKey(day, timeZone), i);
      series.push(
        emptyBucket(
          `${WEEKDAY_LABELS[WEEKDAYS[p.wd] ?? "mon"]} ${p.d}`,
          `${p.d} ${MONTHS[p.m - 1] ?? ""}`,
        ),
      );
    }
    return (d: Date) => keys.get(dayKey(d, timeZone)) ?? -1;
  })();
  const bucketEvents = series.map(() => [] as EventRow[]);
  const bucketOrders = series.map(() => [] as OrderRow[]);
  for (const e of events) bucketEvents[indexOf(e.createdAt)]?.push(e);
  for (const o of list) bucketOrders[indexOf(o.createdAt)]?.push(o);
  series.forEach((b, i) => {
    Object.assign(b, metrics(bucketEvents[i] ?? [], bucketOrders[i] ?? []));
  });

  // Воронка — уникальные покупатели.
  const usersOf = (type: EventRow["type"]) =>
    new Set(events.filter((e) => e.type === type).map((e) => e.userId));
  const buyers = new Set(list.map((o) => o.customerId));
  const delivered = list.filter((o) => o.status === "done");
  const addedToCart = usersOf("cart_add");
  const funnel = {
    visited: usersOf("visit").size,
    addedToCart: addedToCart.size,
    checkout: usersOf("checkout_open").size,
    ordered: buyers.size,
    delivered: unique(delivered.map((o) => o.customerId)),
  };

  // Брошенные корзины: положили в период и в период не заказали.
  const abandonedUsers = [...addedToCart].filter((id) => !buyers.has(id));
  const abandonedCarts = abandonedUsers.length
    ? db.select().from(carts).where(inArray(carts.userId, abandonedUsers)).all()
    : [];
  const abandoned = {
    count: abandonedUsers.length,
    total: abandonedCarts.reduce((s, c) => s + c.total, 0),
  };

  // Популярные блюда — по доставленным.
  const dishes = new Map<
    string,
    { productId: string; title: string; qty: number; revenue: number }
  >();
  for (const o of delivered) {
    for (const it of o.items) {
      const d = dishes.get(it.productId) ?? {
        productId: it.productId,
        title: it.title,
        qty: 0,
        revenue: 0,
      };
      d.qty += it.qty;
      d.revenue += it.price * it.qty;
      dishes.set(it.productId, d);
    }
  }
  const topDishes = [...dishes.values()]
    .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
    .slice(0, 8);

  const byHour = Array.from({ length: 24 }, () => 0);
  for (const o of list) {
    const h = localParts(o.createdAt, timeZone).h;
    byHour[h] = (byHour[h] ?? 0) + 1;
  }

  // Покупатели: первый заказ в периоде или заказывали раньше.
  const history = new Map<number, { first: Date; count: number }>();
  if (buyers.size > 0) {
    const rows = db
      .select({ customerId: orders.customerId, createdAt: orders.createdAt })
      .from(orders)
      .where(
        and(
          inArray(orders.customerId, [...buyers]),
          lt(orders.createdAt, new Date(now.getTime() + 1)),
        ),
      )
      .orderBy(asc(orders.createdAt))
      .all();
    for (const r of rows) {
      const h = history.get(r.customerId);
      if (h) h.count += 1;
      else history.set(r.customerId, { first: r.createdAt, count: 1 });
    }
  }
  const returning = new Set([...buyers].filter((id) => (history.get(id)?.first ?? now) < from));
  const returningDelivered = delivered.filter((o) => returning.has(o.customerId));
  const customers = {
    newBuyers: buyers.size - returning.size,
    returningBuyers: returning.size,
    repeatShare: pct(
      [...buyers].filter((id) => (history.get(id)?.count ?? 0) >= 2).length,
      buyers.size,
    ),
    returningAvgCheck: returningDelivered.length
      ? Math.round(returningDelivered.reduce((s, o) => s + o.total, 0) / returningDelivered.length)
      : null,
  };

  // Откуда пришли: первый заход покупателя в периоде.
  const firstVisit = new Map<number, EventRow>();
  for (const e of events) {
    if (e.type !== "visit") continue;
    const seen = firstVisit.get(e.userId);
    if (!seen || e.createdAt < seen.createdAt) firstVisit.set(e.userId, e);
  }
  const sourceMap = new Map<
    string,
    { key: string; label: string; visitors: number; buyers: number }
  >();
  for (const [userId, e] of firstVisit) {
    const src = sourceOf(e.source);
    const row = sourceMap.get(src.key) ?? { ...src, visitors: 0, buyers: 0 };
    row.visitors += 1;
    if (buyers.has(userId)) row.buyers += 1;
    sourceMap.set(src.key, row);
  }
  const sources = [...sourceMap.values()].sort((a, b) => b.visitors - a.visitors);

  // Работа: среднее от оформления до «Готовим» и до «Доставлен».
  const ids = list.map((o) => o.id);
  const steps = ids.length
    ? db
        .select({
          orderId: orderEvents.orderId,
          status: orderEvents.status,
          createdAt: orderEvents.createdAt,
        })
        .from(orderEvents)
        .where(and(inArray(orderEvents.orderId, ids), eq(orderEvents.type, "status")))
        .all()
    : [];
  const created = new Map(list.map((o) => [o.id, o.createdAt.getTime()]));
  const firstStep = (status: "processing" | "done") => {
    const at = new Map<number, number>();
    for (const s of steps) {
      if (s.status !== status) continue;
      const t = s.createdAt.getTime();
      if (!at.has(s.orderId) || t < (at.get(s.orderId) ?? t)) at.set(s.orderId, t);
    }
    const minutes = [...at].map(([id, t]) => (t - (created.get(id) ?? t)) / 60000);
    const value = avg(minutes);
    return value === null ? null : Math.round(value);
  };
  const cancelled = list.filter((o) => o.status === "cancelled");
  const reasons = new Map<string, number>();
  for (const o of cancelled) {
    const r = o.cancelReason ?? "other";
    reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  const rated = list.filter((o) => o.rating !== null).map((o) => o.rating ?? 0);
  const rating = avg(rated);
  const operations = {
    acceptMinutes: firstStep("processing"),
    deliverMinutes: firstStep("done"),
    cancelled: cancelled.length,
    cancelReasons: [...reasons]
      .map(([reason, count]) => ({
        reason,
        label:
          reason === "customer"
            ? "Отменил покупатель"
            : (CANCEL_REASON_LABELS[reason as CancelReason] ?? "Другое"),
        count,
      }))
      .sort((a, b) => b.count - a.count),
    rating: rating === null ? null : Math.round(rating * 10) / 10,
    reviews: rated.length,
  };

  // Бот: пользователи и заблокировавшие (без сотрудников).
  const people = db
    .select({ id: users.id, createdAt: users.createdAt, botBlockedAt: users.botBlockedAt })
    .from(users)
    .all()
    .filter((u) => customer(u.id) && u.createdAt <= now);
  const bot = {
    users: people.length,
    usersNew: people.filter((u) => inRange(u.createdAt)).length,
    blocked: people.filter((u) => u.botBlockedAt !== null).length,
    blockedNew: people.filter((u) => u.botBlockedAt !== null && inRange(u.botBlockedAt)).length,
  };

  const first = db
    .select({ createdAt: analyticsEvents.createdAt })
    .from(analyticsEvents)
    .orderBy(asc(analyticsEvents.createdAt))
    .limit(1)
    .get();

  return {
    period,
    from: from.toISOString(),
    to: now.toISOString(),
    trackingSince: first ? first.createdAt.toISOString() : null,
    kpi: {
      visitors: kpi("visitors"),
      orders: kpi("orders"),
      revenue: kpi("revenue"),
      avgCheck: kpi("avgCheck"),
      conversion: kpi("conversion"),
    },
    series,
    funnel,
    abandoned,
    topDishes,
    byHour,
    customers,
    sources,
    operations,
    bot,
  };
}

const pad = (n: number) => String(n % 24).padStart(2, "0");

function emptyBucket(label: string, title: string): AnalyticsBucket {
  return { label, title, visitors: 0, orders: 0, revenue: 0, avgCheck: null, conversion: null };
}
