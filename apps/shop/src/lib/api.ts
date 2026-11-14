/**
 * Запросы к серверу. Типы ответов выводятся из маршрутов сервера (hono/client), поэтому
 * поменять ответ API и забыть про магазин не получится — упадёт проверка типов.
 */
import type { CatalogIssue, CreateOrderInput } from "@store/schema";
import type { ApiType } from "@store/server/api";
import type { hc, InferResponseType } from "hono/client";
import { authHeader } from "./telegram.ts";

type Client = ReturnType<typeof hc<ApiType>>;

export type ShopData = Extract<InferResponseType<Client["shop"]["$get"]>, { ready: true }>;
export type ShopResponse = InferResponseType<Client["shop"]["$get"]>;
export type Product = ShopData["catalog"]["products"][number];
export type Category = ShopData["catalog"]["categories"][number];
export type Me = InferResponseType<Client["me"]["$get"]>;
export type Order = InferResponseType<Client["orders"][":id"]["$get"]>;

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
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        ...authHeader(),
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, "Нет связи с магазином. Проверьте интернет");
  }
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: undefined })
    | { error: string; issues?: CatalogIssue[] }
    | null;
  if (!res.ok) {
    const err = data && "error" in data && data.error ? data : null;
    throw new ApiError(
      res.status,
      err?.error ?? "Что-то пошло не так. Попробуйте ещё раз",
      err?.issues,
    );
  }
  return data as T;
}

/** Тело заказа: то, что схема принимает на вход (до значений по умолчанию). */
export type OrderBody = Omit<CreateOrderInput, "customer"> & {
  customer: Omit<CreateOrderInput["customer"], "address" | "comment"> & {
    address?: string;
    comment?: string;
  };
};

export const api = {
  shop: () => request<ShopResponse>("GET", "/shop"),
  me: () => request<Me>("GET", "/me"),
  orders: () => request<{ orders: Order[] }>("GET", "/orders"),
  order: (id: number) => request<Order>("GET", `/orders/${id}`),
  createOrder: (body: OrderBody) => request<Order>("POST", "/orders", body),
  cancelOrder: (id: number) => request<Order>("POST", `/orders/${id}/cancel`),
  resolveMapsUrl: (url: string) =>
    request<{ point: { lat: number; lng: number } }>(
      "GET",
      `/geo/resolve?url=${encodeURIComponent(url)}`,
    ),
};
