import type { Context } from "hono";
import { AppError } from "../errors.ts";

export async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new AppError(400, "Ожидался JSON");
  }
}

export function intParam(c: Context, name: string, what: string): number {
  const n = Number(c.req.param(name));
  if (!Number.isSafeInteger(n) || n <= 0) throw new AppError(404, `${what} не найден`);
  return n;
}

export const orderIdParam = (c: Context) => intParam(c, "id", "Заказ");
