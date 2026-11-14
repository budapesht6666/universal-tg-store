/** Команда магазина: роли и приглашения (docs/product-decisions.md → «Команда и курьеры»). */
import { z } from "./zod.ts";

export const ROLES = ["owner", "manager", "courier"] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.output<typeof RoleSchema>;

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Владелец",
  manager: "Менеджер",
  courier: "Курьер",
};

/** Кого можно пригласить ссылкой. Владелец задаётся через OWNER_ID в .env. */
export const INVITABLE_ROLES = ["manager", "courier"] as const satisfies readonly Role[];
export const InviteRoleSchema = z.enum(INVITABLE_ROLES);
export type InviteRole = z.output<typeof InviteRoleSchema>;

/** Ссылка-приглашение одноразовая и живёт сутки. */
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export type Permission =
  | "orders.manage"
  | "catalog.manage"
  | "settings.manage"
  | "team.manage"
  | "delivery.work";

const PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: ["orders.manage", "catalog.manage", "settings.manage", "team.manage", "delivery.work"],
  manager: ["orders.manage", "catalog.manage"],
  courier: ["delivery.work"],
};

/** Есть ли право хотя бы у одной из ролей человека (ролей может быть несколько). */
export function can(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((role) => PERMISSIONS[role].includes(permission));
}

/** Ссылка входа на компьютере (/login в боте) живёт 5 минут, сессия в браузере — 30 дней. */
export const LOGIN_LINK_TTL_MS = 5 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const InviteCreateSchema = z.strictObject({ role: InviteRoleSchema });

/**
 * Правка участника: роли (кроме «Владельца» — он задан в .env) и «выключен».
 * Выключенный сразу теряет доступ. Владелец может снять с себя роль курьера.
 */
export const StaffUpdateSchema = z.strictObject({
  roles: z
    .array(InviteRoleSchema)
    .max(INVITABLE_ROLES.length)
    .refine((r) => new Set(r).size === r.length, { error: "Роль повторяется" })
    .optional(),
  active: z.boolean().optional(),
});
export type StaffUpdate = z.output<typeof StaffUpdateSchema>;

/** Страница входа на компьютере отправляет токен из ссылки бота. */
export const LoginInputSchema = z.strictObject({ token: z.string().min(10).max(100) });
