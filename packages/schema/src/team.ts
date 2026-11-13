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

/** Кого можно пригласить ссылкой. Владелец задаётся через ADMIN_IDS в .env. */
export const INVITABLE_ROLES = ["manager", "courier"] as const satisfies readonly Role[];
export const InviteRoleSchema = z.enum(INVITABLE_ROLES);

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
