/**
 * Вход на компьютере: /login в боте → ссылка <PUBLIC_URL>/admin/login#<токен> на 5 минут.
 * Токен в #фрагменте: превью ссылок в Telegram его не видит и не «сжигает».
 * Страница входа отправляет токен сюда и получает cookie сессии на 30 дней.
 */
import { LoginInputSchema } from "@store/schema";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { parseInput } from "../../errors.ts";
import { deleteSession, exchangeLoginToken } from "../../repo/team.ts";
import { type AppEnv, SESSION_COOKIE } from "../auth.ts";
import { jsonBody } from "../util.ts";

export const authRoutes = new Hono<AppEnv>()
  .post("/auth/login", async (c) => {
    const { token } = parseInput(LoginInputSchema, await jsonBody(c));
    const { db, env, now } = c.var.deps;
    const { session, expiresAt } = exchangeLoginToken(db, env, token, now());
    setCookie(c, SESSION_COOKIE, session, {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      expires: expiresAt,
    });
    return c.json({ ok: true });
  })

  .post("/auth/logout", (c) => {
    const sid = getCookie(c, SESSION_COOKIE);
    if (sid) deleteSession(c.var.deps.db, c.var.deps.env, sid);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });
