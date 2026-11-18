/** Админка: меню (категории и блюда), фото, настройки, команда. */
import {
  AnalyticsPeriodSchema,
  CategoryInputSchema,
  InviteCreateSchema,
  ProductPatchSchema,
  productInputSchema,
  ReorderSchema,
  SettingsSchema,
  SettingsUpdateSchema,
  StaffUpdateSchema,
} from "@store/schema";
import { Hono } from "hono";
import { AppError, parseInput } from "../../errors.ts";
import { saveImage } from "../../lib/images.ts";
import { analyticsReport } from "../../repo/analytics.ts";
import {
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
  loadCatalog,
  patchProduct,
  reorderCategories,
  reorderProducts,
  updateCategory,
  updateProduct,
} from "../../repo/catalog.ts";
import { getShop, saveSettings } from "../../repo/settings.ts";
import { createInvite, listStaff, updateStaff } from "../../repo/team.ts";
import { type AppEnv, requirePermission } from "../auth.ts";
import { intParam, jsonBody } from "../util.ts";

function productSchema(c: { var: AppEnv["Variables"] }) {
  return productInputSchema(loadCatalog(c.var.deps.db).attributes);
}

export const adminRoutes = new Hono<AppEnv>()
  // ───────────── Меню ─────────────
  .get("/admin/catalog", async (c) => {
    requirePermission(c, "catalog.manage");
    const { db, botUsername, mainAppReady } = c.var.deps;
    // Ссылка на блюдо: base + dishStartParam(id). Бот не подключён (BOT_MODE=off, вебхук занят) — null.
    const dishLink = botUsername
      ? {
          base: `https://t.me/${botUsername}?startapp=`,
          mainAppReady: mainAppReady ? await mainAppReady() : false,
        }
      : null;
    return c.json({ ...loadCatalog(db), dishLink });
  })

  .post("/admin/categories", async (c) => {
    requirePermission(c, "catalog.manage");
    const input = parseInput(CategoryInputSchema, await jsonBody(c));
    return c.json(createCategory(c.var.deps.db, input), 201);
  })

  .put("/admin/categories/order", async (c) => {
    requirePermission(c, "catalog.manage");
    const { ids } = parseInput(ReorderSchema, await jsonBody(c));
    reorderCategories(c.var.deps.db, ids);
    return c.json({ ok: true });
  })

  .patch("/admin/categories/:id", async (c) => {
    requirePermission(c, "catalog.manage");
    const input = parseInput(CategoryInputSchema, await jsonBody(c));
    return c.json(updateCategory(c.var.deps.db, c.req.param("id"), input));
  })

  .delete("/admin/categories/:id", (c) => {
    requirePermission(c, "catalog.manage");
    deleteCategory(c.var.deps.db, c.req.param("id"));
    return c.json({ ok: true });
  })

  .put("/admin/categories/:id/products/order", async (c) => {
    requirePermission(c, "catalog.manage");
    const { ids } = parseInput(ReorderSchema, await jsonBody(c));
    reorderProducts(c.var.deps.db, c.req.param("id"), ids);
    return c.json({ ok: true });
  })

  .post("/admin/products", async (c) => {
    requirePermission(c, "catalog.manage");
    const input = parseInput(productSchema(c), await jsonBody(c));
    return c.json(createProduct(c.var.deps.db, input, c.var.deps.now()), 201);
  })

  .put("/admin/products/:id", async (c) => {
    requirePermission(c, "catalog.manage");
    const input = parseInput(productSchema(c), await jsonBody(c));
    return c.json(updateProduct(c.var.deps.db, c.req.param("id"), input, c.var.deps.now()));
  })

  /** «Есть / Закончилось» и «Скрыто» — одним касанием, с телефона тоже. */
  .patch("/admin/products/:id", async (c) => {
    requirePermission(c, "catalog.manage");
    const patch = parseInput(ProductPatchSchema, await jsonBody(c));
    return c.json(patchProduct(c.var.deps.db, c.req.param("id"), patch, c.var.deps.now()));
  })

  .delete("/admin/products/:id", (c) => {
    requirePermission(c, "catalog.manage");
    deleteProduct(c.var.deps.db, c.req.param("id"));
    return c.json({ ok: true });
  })

  .post("/admin/uploads", async (c) => {
    requirePermission(c, "catalog.manage");
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new AppError(400, "Прикрепите фото в поле file");
    return c.json(await saveImage(file, c.var.deps.env.UPLOADS_DIR), 201);
  })

  // ───────────── Настройки ─────────────
  .get("/admin/settings", (c) => {
    requirePermission(c, "settings.manage");
    const shop = getShop(c.var.deps.db);
    if (!shop) throw new AppError(409, "Магазин ещё не настроен");
    return c.json(shop.settings);
  })

  /** Регион (валюта, часовой пояс, код страны) не меняется — берём сохранённый. */
  .put("/admin/settings", async (c) => {
    requirePermission(c, "settings.manage");
    const { db } = c.var.deps;
    const shop = getShop(db);
    if (!shop) throw new AppError(409, "Магазин ещё не настроен");
    const update = parseInput(SettingsUpdateSchema, await jsonBody(c));
    const settings = parseInput(SettingsSchema, { ...update, region: shop.settings.region });
    saveSettings(db, settings, c.var.deps.now());
    c.var.deps.syncBotProfile();
    return c.json(settings);
  })

  // ───────────── Команда ─────────────
  .get("/admin/team", (c) => {
    requirePermission(c, "team.manage");
    return c.json({ members: listStaff(c.var.deps.db, c.var.deps.env) });
  })

  /** Одноразовая ссылка-приглашение на сутки: t.me/<бот>?start=inv_<токен>. */
  .post("/admin/team/invites", async (c) => {
    const user = requirePermission(c, "team.manage");
    const { role } = parseInput(InviteCreateSchema, await jsonBody(c));
    const { db, env, now, botUsername } = c.var.deps;
    const { token, expiresAt } = createInvite(db, env, role, user.id, now());
    const startParam = `inv_${token}`;
    return c.json(
      {
        link: botUsername ? `https://t.me/${botUsername}?start=${startParam}` : null,
        startParam,
        role,
        expiresAt: expiresAt.toISOString(),
      },
      201,
    );
  })

  .patch("/admin/team/:userId", async (c) => {
    requirePermission(c, "team.manage");
    const patch = parseInput(StaffUpdateSchema, await jsonBody(c));
    const { db, env } = c.var.deps;
    return c.json(updateStaff(db, env, intParam(c, "userId", "Участник"), patch));
  })

  // ───────────── Аналитика ─────────────
  .get("/admin/analytics", (c) => {
    requirePermission(c, "analytics.view");
    const period = parseInput(AnalyticsPeriodSchema, c.req.query("period") ?? "7d");
    const { db, env, now } = c.var.deps;
    const shop = getShop(db);
    if (!shop) throw new AppError(409, "Магазин ещё не настроен");
    return c.json(
      analyticsReport({
        db,
        env,
        now: now(),
        period,
        timeZone: shop.settings.region.timeZone,
        hours: shop.settings.hours,
      }),
    );
  });
