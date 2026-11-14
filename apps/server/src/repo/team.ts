/** Пользователи, команда, приглашения, вход на компьютере. */
import {
  can,
  INVITE_TTL_MS,
  type InviteRole,
  LOGIN_LINK_TTL_MS,
  type Permission,
  type Role,
  SESSION_TTL_MS,
} from "@store/schema";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { authTokens, invites, staff, users } from "../db/schema.ts";
import type { Env } from "../env.ts";
import { AppError } from "../errors.ts";
import { hashToken, randomToken } from "../lib/tokens.ts";

export type TgUser = {
  id: number;
  firstName: string;
  lastName?: string | undefined;
  username?: string | undefined;
};

export function upsertUser(db: Db, u: TgUser, now: Date): void {
  const values = {
    firstName: u.firstName,
    lastName: u.lastName ?? null,
    username: u.username ?? null,
    lastSeenAt: now,
  };
  db.insert(users)
    .values({ id: u.id, ...values, createdAt: now })
    .onConflictDoUpdate({ target: users.id, set: values })
    .run();
}

export function displayName(u: { firstName: string; lastName?: string | null }): string {
  return [u.firstName, u.lastName].filter(Boolean).join(" ");
}

export function userName(db: Db, id: number): string {
  const u = db.select().from(users).where(eq(users.id, id)).get();
  return u ? displayName(u) : `id ${id}`;
}

/** Роли человека. Владелец из .env — владелец всегда, даже если строку в staff выключили. */
export function rolesOf(db: Db, env: Env, userId: number): Role[] {
  const row = db.select().from(staff).where(eq(staff.userId, userId)).get();
  const roles = row?.active ? [...row.roles] : [];
  if (userId === env.OWNER_TELEGRAM_ID && !roles.includes("owner")) roles.unshift("owner");
  return roles;
}

/**
 * Строка владельца в команде. Владелец по умолчанию и первый курьер: пока курьер один,
 * заказы назначаются ему автоматически. Роль курьера можно снять в «Команде».
 */
export function ensureOwner(db: Db, env: Env, now: Date): void {
  const id = env.OWNER_TELEGRAM_ID;
  db.insert(users)
    .values({ id, firstName: "Владелец", createdAt: now, lastSeenAt: now })
    .onConflictDoNothing()
    .run();
  db.insert(staff)
    .values({ userId: id, roles: ["owner", "courier"], active: true, createdAt: now })
    .onConflictDoNothing()
    .run();
}

export type StaffMember = {
  id: number;
  name: string;
  username: string | null;
  phone: string | null;
  roles: Role[];
  active: boolean;
};

export function listStaff(db: Db, env: Env): StaffMember[] {
  return db
    .select()
    .from(staff)
    .innerJoin(users, eq(users.id, staff.userId))
    .all()
    .map(({ staff: s, users: u }) => ({
      id: s.userId,
      name: displayName(u),
      username: u.username,
      phone: s.phone,
      roles:
        s.userId === env.OWNER_TELEGRAM_ID && !s.roles.includes("owner")
          ? ["owner", ...s.roles]
          : s.roles,
      active: s.active || s.userId === env.OWNER_TELEGRAM_ID,
    }));
}

/** Активные участники с правом — кому слать уведомления, кого предлагать курьером. */
export function staffWith(db: Db, env: Env, permission: Permission): StaffMember[] {
  return listStaff(db, env).filter((m) => m.active && can(m.roles, permission));
}

export function updateStaff(
  db: Db,
  env: Env,
  userId: number,
  patch: { roles?: InviteRole[] | undefined; active?: boolean | undefined },
): StaffMember {
  const row = db.select().from(staff).where(eq(staff.userId, userId)).get();
  if (!row) throw new AppError(404, "Нет такого участника");
  const isOwner = userId === env.OWNER_TELEGRAM_ID;
  if (isOwner && patch.active === false) throw new AppError(409, "Владельца выключить нельзя");
  const roles: Role[] = patch.roles
    ? [...(isOwner ? (["owner"] as const) : []), ...patch.roles]
    : row.roles;
  if (roles.length === 0)
    throw new AppError(400, "Оставьте хотя бы одну роль или выключите участника");
  db.update(staff)
    .set({ roles, ...(patch.active !== undefined && { active: patch.active }) })
    .where(eq(staff.userId, userId))
    .run();
  const member = listStaff(db, env).find((m) => m.id === userId);
  if (!member) throw new AppError(404, "Нет такого участника");
  return member;
}

// ───────────── Приглашения ─────────────

export function createInvite(db: Db, env: Env, role: InviteRole, createdBy: number, now: Date) {
  const token = randomToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  db.insert(invites)
    .values({
      tokenHash: hashToken(token, env.SESSION_SECRET),
      role,
      createdBy,
      createdAt: now,
      expiresAt,
    })
    .run();
  return { token, expiresAt };
}

/** Человек открыл ссылку-приглашение: запоминаем его и ждём номер телефона. */
export function claimInvite(
  db: Db,
  env: Env,
  token: string,
  userId: number,
  now: Date,
): InviteRole {
  const row = db
    .select()
    .from(invites)
    .where(eq(invites.tokenHash, hashToken(token, env.SESSION_SECRET)))
    .get();
  if (!row || row.usedAt || row.expiresAt <= now) {
    throw new AppError(409, "Ссылка-приглашение устарела. Попросите новую");
  }
  if (row.claimedBy !== null && row.claimedBy !== userId) {
    throw new AppError(409, "По этой ссылке уже присоединился другой человек");
  }
  db.update(invites).set({ claimedBy: userId }).where(eq(invites.tokenHash, row.tokenHash)).run();
  return row.role;
}

/** Номер получен — человек в команде. null — открытого приглашения нет. */
export function completeInvite(
  db: Db,
  userId: number,
  phone: string,
  now: Date,
): { role: InviteRole; createdBy: number } | null {
  return db.transaction((tx) => {
    const row = tx
      .select()
      .from(invites)
      .where(and(eq(invites.claimedBy, userId), isNull(invites.usedAt), gt(invites.expiresAt, now)))
      .get();
    if (!row) return null;
    tx.update(invites)
      .set({ usedBy: userId, usedAt: now })
      .where(eq(invites.tokenHash, row.tokenHash))
      .run();
    const existing = tx.select().from(staff).where(eq(staff.userId, userId)).get();
    if (existing) {
      const roles = existing.roles.includes(row.role)
        ? existing.roles
        : [...existing.roles, row.role];
      tx.update(staff).set({ roles, active: true, phone }).where(eq(staff.userId, userId)).run();
    } else {
      tx.insert(staff)
        .values({ userId, roles: [row.role], active: true, phone, createdAt: now })
        .run();
    }
    return { role: row.role, createdBy: row.createdBy };
  });
}

// ───────────── Вход на компьютере ─────────────

/** /login в боте → ссылка на 5 минут. */
export function createLoginToken(db: Db, env: Env, userId: number, now: Date): string {
  const token = randomToken();
  db.delete(authTokens).where(lt(authTokens.expiresAt, now)).run();
  db.insert(authTokens)
    .values({
      tokenHash: hashToken(token, env.SESSION_SECRET),
      kind: "login",
      userId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + LOGIN_LINK_TTL_MS),
    })
    .run();
  return token;
}

/** Одноразовая ссылка → сессия браузера на 30 дней. */
export function exchangeLoginToken(db: Db, env: Env, token: string, now: Date) {
  return db.transaction((tx) => {
    const row = tx
      .update(authTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(authTokens.tokenHash, hashToken(token, env.SESSION_SECRET)),
          eq(authTokens.kind, "login"),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, now),
        ),
      )
      .returning()
      .get();
    if (!row) throw new AppError(401, "Ссылка для входа устарела. Отправьте боту /login ещё раз");
    const session = randomToken();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    tx.insert(authTokens)
      .values({
        tokenHash: hashToken(session, env.SESSION_SECRET),
        kind: "session",
        userId: row.userId,
        createdAt: now,
        expiresAt,
      })
      .run();
    return { session, userId: row.userId, expiresAt };
  });
}

export function sessionUser(db: Db, env: Env, session: string, now: Date): number | null {
  const row = db
    .select()
    .from(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, hashToken(session, env.SESSION_SECRET)),
        eq(authTokens.kind, "session"),
        gt(authTokens.expiresAt, now),
      ),
    )
    .get();
  return row?.userId ?? null;
}

export function deleteSession(db: Db, env: Env, session: string): void {
  db.delete(authTokens)
    .where(eq(authTokens.tokenHash, hashToken(session, env.SESSION_SECRET)))
    .run();
}
