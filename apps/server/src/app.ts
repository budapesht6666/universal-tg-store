/**
 * HTTP-приложение: API, вебхук бота, фото блюд и статика Mini App (/) и админки (/admin).
 * createApp не запускает сервер и бота — так его удобно проверять через app.request().
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import type { Deps } from "./deps.ts";
import { AppError } from "./errors.ts";
import { type AppEnv, authMiddleware } from "./http/auth.ts";
import { adminRoutes } from "./http/routes/admin.ts";
import { authRoutes } from "./http/routes/auth.ts";
import { setupRoutes } from "./http/routes/setup.ts";
import { shopRoutes } from "./http/routes/shop.ts";
import { staffRoutes } from "./http/routes/staff.ts";
import { MAX_UPLOAD_BYTES } from "./lib/images.ts";

const SHOP_DIST = fileURLToPath(new URL("../../shop/dist", import.meta.url));
const ADMIN_DIST = fileURLToPath(new URL("../../admin/dist", import.meta.url));

export type AppOptions = {
  /** Обработчик вебхука Telegram (grammY webhookCallback). */
  webhook?: (c: Context) => Promise<Response>;
};

const api = new Hono<AppEnv>()
  .route("/", shopRoutes)
  .route("/", setupRoutes)
  .route("/", staffRoutes)
  .route("/", adminRoutes)
  .route("/", authRoutes);

/** Тип API для типизированного клиента (hono/client) в магазине и админке. */
export type ApiType = typeof api;

export function createApp(deps: Deps, options: AppOptions = {}) {
  const app = new Hono<AppEnv>();
  const dev = deps.env.NODE_ENV !== "production";

  app.use("*", async (c, next) => {
    c.set("deps", deps);
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: err.message, ...(err.issues && { issues: err.issues }) }, err.status);
    }
    if (err instanceof HTTPException) return err.getResponse();
    console.error(err);
    return c.json({ error: "Что-то пошло не так. Попробуйте ещё раз" }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  // Защита от подделки запросов нужна только входу по cookie (компьютер): заголовок
  // Authorization чужой сайт подставить не может. Локально разрешаем Vite (localhost).
  const csrfCheck = csrf({
    origin: (origin) =>
      origin === deps.env.PUBLIC_URL || (dev && /^http:\/\/localhost:\d+$/.test(origin)),
  });
  app.use(
    "/api/*",
    (c, next) => (c.req.header("authorization") ? next() : csrfCheck(c, next)),
    bodyLimit({
      maxSize: MAX_UPLOAD_BYTES + 64 * 1024,
      onError: (c) => c.json({ error: "Слишком большой запрос" }, 413),
    }),
    authMiddleware(),
  );
  app.route("/api", api);
  app.all("/api/*", (c) => c.json({ error: "Нет такого адреса" }, 404));

  if (options.webhook) app.post("/bot/webhook", options.webhook);

  // Имя файла случайное и не меняется — кешируем навсегда.
  app.use("/uploads/*", async (c, next) => {
    await next();
    if (c.res.status === 200)
      c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
  });
  app.use(
    "/uploads/*",
    serveStatic({
      root: deps.env.UPLOADS_DIR,
      rewriteRequestPath: (p) => p.replace(/^\/uploads/, ""),
    }),
  );

  // Собранные SPA: файлы как есть, остальные пути — index.html (маршрутизация на клиенте).
  if (existsSync(ADMIN_DIST)) {
    app.use(
      "/admin/*",
      serveStatic({ root: ADMIN_DIST, rewriteRequestPath: (p) => p.replace(/^\/admin/, "") }),
    );
    app.get("/admin/*", serveStatic({ root: ADMIN_DIST, path: "index.html" }));
  }
  if (existsSync(SHOP_DIST)) {
    app.use("/*", serveStatic({ root: SHOP_DIST }));
    app.get("/*", serveStatic({ root: SHOP_DIST, path: "index.html" }));
  }

  return app;
}
