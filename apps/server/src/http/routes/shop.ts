/** Покупатель: магазин и меню, профиль, оформление и мои заказы, разбор ссылки на карту. */
import { isShortMapsUrl } from "@store/schema";
import { Hono } from "hono";
import { AppError } from "../../errors.ts";
import { resolveMapsUrl } from "../../lib/geo-resolve.ts";
import {
  createOrder,
  customerCancel,
  customerView,
  getOrder,
  lastCustomerDetails,
  listCustomerOrders,
} from "../../orders/service.ts";
import { publicCatalog } from "../../repo/catalog.ts";
import { getShop, statusOf } from "../../repo/settings.ts";
import { type AppEnv, requireUser } from "../auth.ts";
import { jsonBody, orderIdParam } from "../util.ts";

export const shopRoutes = new Hono<AppEnv>()
  /** Всё для первого экрана Mini App одним запросом. */
  .get("/shop", (c) => {
    const { db, now } = c.var.deps;
    const shop = getShop(db);
    const bot = c.var.deps.botUsername;
    if (!shop) return c.json({ ready: false as const, bot });
    const { settings } = shop;
    return c.json({
      ready: true as const,
      bot,
      shop: {
        name: settings.shop.name,
        phone: settings.shop.phone,
        ...(settings.shop.logo && { logo: settings.shop.logo }),
      },
      region: settings.region,
      features: settings.features,
      hours: settings.hours,
      status: statusOf(shop, now()),
      customerCanCancel: settings.orders.customerCanCancel,
      catalog: publicCatalog(db, settings.features),
    });
  })

  .get("/me", (c) => {
    const user = requireUser(c);
    return c.json({
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName ?? null,
        username: user.username ?? null,
      },
      roles: user.roles,
      lastDetails: lastCustomerDetails(c.var.deps.db, user.id),
    });
  })

  /** Короткая ссылка Google Maps → координаты. */
  .get("/geo/resolve", async (c) => {
    requireUser(c);
    const url = c.req.query("url") ?? "";
    if (!isShortMapsUrl(url)) throw new AppError(400, "Нужна короткая ссылка maps.app.goo.gl");
    const point = await resolveMapsUrl(url, c.var.deps.fetch);
    if (!point) {
      throw new AppError(422, "Не нашли точку по ссылке. Поставьте пин на карте вручную");
    }
    return c.json({ point });
  })

  .post("/orders", async (c) => {
    const user = requireUser(c);
    const order = createOrder(c.var.deps, user.id, await jsonBody(c));
    return c.json(customerView(c.var.deps.db, order), 201);
  })

  .get("/orders", (c) => {
    const user = requireUser(c);
    return c.json({ orders: listCustomerOrders(c.var.deps.db, user.id) });
  })

  .get("/orders/:id", (c) => {
    const user = requireUser(c);
    const order = getOrder(c.var.deps.db, orderIdParam(c));
    if (order.customerId !== user.id) throw new AppError(404, "Заказ не найден");
    return c.json(customerView(c.var.deps.db, order));
  })

  /** «Отменить» (пока «Оформлен») или «Попросить отменить» — сервер решает сам. */
  .post("/orders/:id/cancel", (c) => {
    const user = requireUser(c);
    const order = customerCancel(c.var.deps, user.id, orderIdParam(c));
    return c.json(customerView(c.var.deps.db, order));
  });
