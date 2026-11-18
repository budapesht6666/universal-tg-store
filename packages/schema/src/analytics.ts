/**
 * Аналитика магазина (docs/product-decisions.md → «Аналитика»): события Mini App, снимок корзины,
 * период отчёта и источник захода. Сотрудники магазина в статистику не попадают — это решает сервер.
 */
import { IdSchema, MAX_QTY_PER_ITEM } from "./catalog.ts";
import type { Minor } from "./money.ts";
import { z } from "./zod.ts";

/**
 * visit — открыл магазин (один раз за запуск, с параметром startapp), dish_view — страница блюда,
 * cart_add — положил блюдо в корзину, checkout_open — открыл оформление.
 */
export const ANALYTICS_EVENT_TYPES = ["visit", "dish_view", "cart_add", "checkout_open"] as const;
export type AnalyticsEventType = (typeof ANALYTICS_EVENT_TYPES)[number];

/** Сколько событий магазин отправляет одним запросом. */
export const MAX_EVENTS_PER_BATCH = 50;

/** Параметр запуска Mini App: что Telegram пропускает в startapp. */
const START_PARAM = /^[A-Za-z0-9_-]{1,512}$/;

export const AnalyticsEventSchema = z.strictObject({
  type: z.enum(ANALYTICS_EVENT_TYPES),
  productId: IdSchema.optional(),
  source: z.string().regex(START_PARAM).optional(),
});
export type AnalyticsEvent = z.output<typeof AnalyticsEventSchema>;

export const AnalyticsBatchSchema = z.strictObject({
  events: z.array(AnalyticsEventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
});

/** Снимок корзины покупателя: id блюда → порций. Пустая — корзину очистили. */
export const CartSnapshotSchema = z.strictObject({
  items: z
    .record(IdSchema, z.int().min(1).max(MAX_QTY_PER_ITEM))
    .refine((items) => Object.keys(items).length <= 100, { error: "Слишком много блюд" }),
});
export type CartSnapshot = z.output<typeof CartSnapshotSchema>;

export const ANALYTICS_PERIODS = ["today", "7d", "30d"] as const;
export const AnalyticsPeriodSchema = z.enum(ANALYTICS_PERIODS);
export type AnalyticsPeriod = z.output<typeof AnalyticsPeriodSchema>;

/** Сколько календарных дней (по часовому поясу магазина) входит в период, включая сегодня. */
export const PERIOD_DAYS: Record<AnalyticsPeriod, number> = { today: 1, "7d": 7, "30d": 30 };

// ───────────── Откуда пришли ─────────────

export const SOURCE_MENU = "menu";
export const SOURCE_DISH = "dish";
export const SOURCE_OTHER = "other";
const LABEL_PREFIX = "src_";

/**
 * Источник захода по параметру startapp: без параметра — кнопка «Меню» в боте (или прямая
 * ссылка), dish_<id> — ссылка на блюдо, src_<метка> — своя метка (пост, реклама), иное — «Другое».
 */
export function sourceOf(startParam: string | null | undefined): { key: string; label: string } {
  if (!startParam) return { key: SOURCE_MENU, label: "Кнопка «Меню» в боте" };
  if (startParam.startsWith("dish_")) return { key: SOURCE_DISH, label: "Ссылки на блюда" };
  if (startParam.startsWith(LABEL_PREFIX) && startParam.length > LABEL_PREFIX.length) {
    const label = startParam.slice(LABEL_PREFIX.length).slice(0, 40);
    return { key: `${LABEL_PREFIX}${label}`, label };
  }
  return { key: SOURCE_OTHER, label: "Другое" };
}

// ───────────── Отчёт ─────────────

export type KpiValue = { value: number | null; prev: number | null };

/** Столбик графика: день (7 и 30 дней) или час (сегодня). */
export type AnalyticsBucket = {
  /** Подпись под столбиком: «Чт 12» или «10». */
  label: string;
  /** Для подсказки: «12 ноября» или «10:00–11:00». */
  title: string;
  visitors: number;
  orders: number;
  revenue: Minor;
  avgCheck: Minor | null;
  conversion: number | null;
};

export type AnalyticsReport = {
  period: AnalyticsPeriod;
  from: string;
  to: string;
  /** Первое событие магазина — до него посещений, корзин и источников нет. */
  trackingSince: string | null;
  kpi: {
    visitors: KpiValue;
    orders: KpiValue;
    revenue: KpiValue;
    avgCheck: KpiValue;
    /** Процент: сколько из зашедших заказали. */
    conversion: KpiValue;
  };
  series: AnalyticsBucket[];
  funnel: {
    visited: number;
    addedToCart: number;
    checkout: number;
    ordered: number;
    delivered: number;
  };
  abandoned: { count: number; total: Minor };
  topDishes: { productId: string; title: string; qty: number; revenue: Minor }[];
  /** Заказы по часу оформления, 0–23 по времени магазина. */
  byHour: number[];
  customers: {
    newBuyers: number;
    returningBuyers: number;
    /** Процент покупателей периода, у которых 2 заказа и больше. */
    repeatShare: number | null;
    returningAvgCheck: Minor | null;
  };
  sources: { key: string; label: string; visitors: number; buyers: number }[];
  operations: {
    acceptMinutes: number | null;
    deliverMinutes: number | null;
    cancelled: number;
    cancelReasons: { reason: string; label: string; count: number }[];
    rating: number | null;
    reviews: number;
  };
  bot: { users: number; usersNew: number; blocked: number; blockedNew: number };
};

/** Изменение к прошлому периоду в процентах; прошлого нет или он нулевой — null. */
export function percentChange(value: number | null, prev: number | null): number | null {
  if (value === null || prev === null || prev === 0) return null;
  return Math.round(((value - prev) / prev) * 100);
}
