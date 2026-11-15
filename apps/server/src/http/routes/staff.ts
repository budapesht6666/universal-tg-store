/** Менеджер и курьер: экран «Заказы», действия с заказом, пауза приёма заказов. */
import { can, PauseInputSchema, pauseUntil, StaffOrderActionSchema } from "@store/schema";
import { Hono } from "hono";
import { AppError, parseInput } from "../../errors.ts";
import {
  getOrder,
  markReviewSeen,
  staffAction,
  staffBoard,
  staffView,
} from "../../orders/service.ts";
import { getShop, setPause, statusOf } from "../../repo/settings.ts";
import { staffWith } from "../../repo/team.ts";
import { type AppEnv, requirePermission, requireUser } from "../auth.ts";
import { jsonBody, orderIdParam } from "../util.ts";

export const staffRoutes = new Hono<AppEnv>()
  /** ?mode=courier — «Мои доставки»; по умолчанию — менеджер, если есть права. */
  .get("/staff/orders", (c) => {
    const user = requireUser(c);
    const asked = c.req.query("mode");
    const mode =
      asked === "courier" || (asked !== "manager" && !can(user.roles, "orders.manage"))
        ? "courier"
        : "manager";
    const shop = getShop(c.var.deps.db);
    return c.json({
      mode,
      status: shop ? statusOf(shop, c.var.deps.now()) : null,
      pausedUntil: shop?.pausedUntil?.toISOString() ?? null,
      ...staffBoard(c.var.deps, user, mode),
    });
  })

  /** Один заказ — по кнопке «Открыть» из бота. Курьеру — только его доставки. */
  .get("/staff/orders/:id", (c) => {
    const user = requireUser(c);
    const order = getOrder(c.var.deps.db, orderIdParam(c));
    const manager = can(user.roles, "orders.manage");
    if (!manager && !(can(user.roles, "delivery.work") && order.courierId === user.id)) {
      throw new AppError(403, "Это не ваша доставка");
    }
    return c.json(staffView(c.var.deps.db, order, user));
  })

  .post("/staff/orders/:id/actions", async (c) => {
    const user = requireUser(c);
    if (!can(user.roles, "orders.manage") && !can(user.roles, "delivery.work")) {
      throw new AppError(403, "Нет доступа");
    }
    const action = parseInput(StaffOrderActionSchema, await jsonBody(c));
    const order = staffAction(c.var.deps, user, orderIdParam(c), action);
    return c.json(staffView(c.var.deps.db, order, user));
  })

  /** Менеджер открыл карточку с отзывом — снять пометку «новый отзыв». */
  .post("/staff/orders/:id/review-seen", (c) => {
    const user = requireUser(c);
    const order = markReviewSeen(c.var.deps, user, orderIdParam(c));
    return c.json(staffView(c.var.deps.db, order, user));
  })

  /** Кого можно назначить курьером. */
  .get("/staff/couriers", (c) => {
    requirePermission(c, "orders.manage");
    const { db, env } = c.var.deps;
    return c.json({
      couriers: staffWith(db, env, "delivery.work").map((m) => ({ id: m.id, name: m.name })),
    });
  })

  .post("/staff/pause", async (c) => {
    requirePermission(c, "orders.manage");
    const { db } = c.var.deps;
    const now = c.var.deps.now();
    const shop = getShop(db);
    if (!shop) throw new AppError(409, "Магазин ещё не настроен");
    const { pause } = parseInput(PauseInputSchema, await jsonBody(c));
    const { hours, region } = shop.settings;
    const until = pauseUntil(pause, hours, region.timeZone, now);
    setPause(db, until, now);
    const fresh = { ...shop, pausedUntil: until };
    return c.json({ pausedUntil: until?.toISOString() ?? null, status: statusOf(fresh, now) });
  });
