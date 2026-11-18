/**
 * Запросы к серверу: в Telegram — с initData, в браузере — с cookie сессии.
 * Типы ответов выводятся из маршрутов сервера (hono/client).
 */
import type {
  AnalyticsPeriod,
  CatalogIssue,
  CategoryInput,
  PauseOption,
  ProductInput,
  SettingsUpdate,
  SetupInput,
  StaffOrderAction,
  StaffUpdate,
} from "@store/schema";
import type { ApiType } from "@store/server/api";
import type { hc, InferResponseType } from "hono/client";
import { authHeader } from "./telegram.ts";

type Client = ReturnType<typeof hc<ApiType>>;

export type Me = InferResponseType<Client["me"]["$get"]>;
export type ShopResponse = InferResponseType<Client["shop"]["$get"]>;
export type Board = InferResponseType<Client["staff"]["orders"]["$get"]>;
export type StaffOrder = InferResponseType<Client["staff"]["orders"][":id"]["$get"]>;
export type Catalog = InferResponseType<Client["admin"]["catalog"]["$get"]>;
export type Product = Catalog["products"][number];
export type CategoryRow = Catalog["categories"][number];
export type Settings = InferResponseType<Client["admin"]["settings"]["$get"]>;
export type Team = InferResponseType<Client["admin"]["team"]["$get"]>;
export type Member = Team["members"][number];
export type Invite = InferResponseType<Client["admin"]["team"]["invites"]["$post"]>;
export type SetupInfo = InferResponseType<Client["setup"]["$get"]>;
export type Analytics = InferResponseType<Client["admin"]["analytics"]["$get"]>;

export class ApiError extends Error {
  readonly status: number;
  readonly issues: CatalogIssue[];
  constructor(status: number, message: string, issues: CatalogIssue[] = []) {
    super(message);
    this.status = status;
    this.issues = issues;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        ...authHeader(),
        ...(body !== undefined && !isForm && { "content-type": "application/json" }),
      },
      ...(body !== undefined && { body: isForm ? body : JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, "Нет связи с сервером. Проверьте интернет");
  }
  const data = (await res.json().catch(() => null)) as {
    error?: string;
    issues?: CatalogIssue[];
  } | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error ?? "Что-то пошло не так. Попробуйте ещё раз",
      data?.issues,
    );
  }
  return data as T;
}

export const api = {
  me: () => request<Me>("GET", "/me"),
  shop: () => request<ShopResponse>("GET", "/shop"),
  login: (token: string) => request<{ ok: true }>("POST", "/auth/login", { token }),
  logout: () => request<{ ok: true }>("POST", "/auth/logout"),

  setupInfo: () => request<SetupInfo>("GET", "/setup"),
  setup: (body: SetupInput) => request<{ ok: true }>("POST", "/setup", body),

  board: (mode: "manager" | "courier") => request<Board>("GET", `/staff/orders?mode=${mode}`),
  order: (id: number) => request<StaffOrder>("GET", `/staff/orders/${id}`),
  action: (id: number, action: StaffOrderAction) =>
    request<StaffOrder>("POST", `/staff/orders/${id}/actions`, action),
  reviewSeen: (id: number) => request<StaffOrder>("POST", `/staff/orders/${id}/review-seen`),
  couriers: () => request<{ couriers: { id: number; name: string }[] }>("GET", "/staff/couriers"),
  pause: (pause: PauseOption) =>
    request<{ pausedUntil: string | null }>("POST", "/staff/pause", { pause }),

  catalog: () => request<Catalog>("GET", "/admin/catalog"),
  createCategory: (body: CategoryInput) => request<CategoryRow>("POST", "/admin/categories", body),
  updateCategory: (id: string, body: CategoryInput) =>
    request<CategoryRow>("PATCH", `/admin/categories/${id}`, body),
  deleteCategory: (id: string) => request<{ ok: true }>("DELETE", `/admin/categories/${id}`),
  reorderCategories: (ids: string[]) =>
    request<{ ok: true }>("PUT", "/admin/categories/order", { ids }),
  reorderProducts: (categoryId: string, ids: string[]) =>
    request<{ ok: true }>("PUT", `/admin/categories/${categoryId}/products/order`, { ids }),
  createProduct: (body: ProductInput) => request<Product>("POST", "/admin/products", body),
  updateProduct: (id: string, body: ProductInput) =>
    request<Product>("PUT", `/admin/products/${id}`, body),
  patchProduct: (id: string, body: { available?: boolean; isActive?: boolean }) =>
    request<Product>("PATCH", `/admin/products/${id}`, body),
  deleteProduct: (id: string) => request<{ ok: true }>("DELETE", `/admin/products/${id}`),
  upload: (file: File) => {
    const form = new FormData();
    form.set("file", file);
    return request<{ url: string }>("POST", "/admin/uploads", form);
  },

  settings: () => request<Settings>("GET", "/admin/settings"),
  saveSettings: (body: SettingsUpdate) => request<Settings>("PUT", "/admin/settings", body),

  team: () => request<Team>("GET", "/admin/team"),
  invite: (role: "manager" | "courier") => request<Invite>("POST", "/admin/team/invites", { role }),
  updateMember: (id: number, body: StaffUpdate) =>
    request<Member>("PATCH", `/admin/team/${id}`, body),

  analytics: (period: AnalyticsPeriod) =>
    request<Analytics>("GET", `/admin/analytics?period=${period}`),
};
