/** Первая настройка магазина: только владелец и только один раз. */
import { REGIONS, SetupInputSchema, settingsFromSetup } from "@store/schema";
import { Hono } from "hono";
import { AppError, parseInput, unwrap } from "../../errors.ts";
import { emptyCatalog, loadDemoCatalog, replaceCatalog } from "../../repo/catalog.ts";
import { getShop, saveSettings } from "../../repo/settings.ts";
import { ensureOwner } from "../../repo/team.ts";
import { type AppEnv, requireUser } from "../auth.ts";
import { jsonBody } from "../util.ts";

export const setupRoutes = new Hono<AppEnv>()
  .get("/setup", (c) => {
    const user = requireUser(c);
    const { db, env } = c.var.deps;
    return c.json({
      needed: getShop(db) === null,
      isOwner: user.id === env.OWNER_TELEGRAM_ID,
      regions: Object.entries(REGIONS).map(([code, r]) => ({ code, ...r })),
    });
  })

  .post("/setup", async (c) => {
    const user = requireUser(c);
    const { db, env } = c.var.deps;
    const now = c.var.deps.now();
    if (user.id !== env.OWNER_TELEGRAM_ID) throw new AppError(403, "Настраивает магазин владелец");
    if (getShop(db)) throw new AppError(409, "Магазин уже настроен — меняйте настройки в админке");

    const input = parseInput(SetupInputSchema, await jsonBody(c));
    const settings = unwrap(settingsFromSetup(input));
    db.transaction(() => {
      replaceCatalog(db, input.menu === "demo" ? loadDemoCatalog() : emptyCatalog(), now);
      saveSettings(db, settings, now);
      ensureOwner(db, env, now);
    });
    return c.json({ ok: true }, 201);
  });
