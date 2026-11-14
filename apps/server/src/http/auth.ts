/**
 * Кто делает запрос:
 * - Mini App: заголовок `Authorization: tma <initData>`, подпись проверяется токеном бота;
 * - браузер на компьютере: cookie сессии после одноразовой ссылки из /login.
 */
import { can, type Permission, type Role } from "@store/schema";
import { parse, validate } from "@tma.js/init-data-node";
import { eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { users } from "../db/schema.ts";
import type { Deps } from "../deps.ts";
import { AppError } from "../errors.ts";
import { rolesOf, sessionUser, type TgUser, upsertUser } from "../repo/team.ts";

export const SESSION_COOKIE = "sid";

/** initData Mini App живёт сутки: рабочий экран менеджера открыт подолгу. */
const INIT_DATA_TTL_S = 24 * 60 * 60;

export type AuthUser = TgUser & { roles: Role[] };

export type AppEnv = { Variables: { deps: Deps; user: AuthUser | null } };

function fromInitData(deps: Deps, raw: string): TgUser {
  try {
    validate(raw, deps.env.BOT_TOKEN, { expiresIn: INIT_DATA_TTL_S });
  } catch {
    throw new AppError(401, "Откройте магазин заново из Telegram");
  }
  const u = parse(raw).user;
  if (!u) throw new AppError(401, "Откройте магазин заново из Telegram");
  return { id: u.id, firstName: u.first_name, lastName: u.last_name, username: u.username };
}

export function authMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const deps = c.var.deps;
    const now = deps.now();
    let tg: TgUser | null = null;

    const header = c.req.header("authorization") ?? "";
    if (header.startsWith("tma ")) {
      tg = fromInitData(deps, header.slice(4));
      upsertUser(deps.db, tg, now);
    } else {
      const sid = getCookie(c, SESSION_COOKIE);
      const id = sid ? sessionUser(deps.db, deps.env, sid, now) : null;
      const row =
        id === null ? undefined : deps.db.select().from(users).where(eq(users.id, id)).get();
      if (row)
        tg = {
          id: row.id,
          firstName: row.firstName,
          lastName: row.lastName ?? undefined,
          username: row.username ?? undefined,
        };
    }

    c.set("user", tg ? { ...tg, roles: rolesOf(deps.db, deps.env, tg.id) } : null);
    await next();
  };
}

export function requireUser(c: Context<AppEnv>): AuthUser {
  const user = c.var.user;
  if (!user) throw new AppError(401, "Откройте магазин из Telegram");
  return user;
}

export function requirePermission(c: Context<AppEnv>, permission: Permission): AuthUser {
  const user = requireUser(c);
  if (!can(user.roles, permission)) throw new AppError(403, "Нет доступа");
  return user;
}
