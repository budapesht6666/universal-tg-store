import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sign } from "@tma.js/init-data-node";
import { createApp } from "../src/app.ts";
import { openDb } from "../src/db/client.ts";
import type { Deps } from "../src/deps.ts";
import { loadEnv } from "../src/env.ts";
import type { OrderNotice } from "../src/notify.ts";

export const BOT_TOKEN = "123456:TEST-token-for-signing-init-data-xyz";
export const OWNER = 1000;
export const ANNA = 2001;
export const IVAN = 3001; // курьер
export const PUBLIC_URL = "https://shop.example";

/** Сб 14.11.2026 12:00 в Хойане (UTC+7) — магазин открыт (10:00–22:00). */
export const NOON = new Date("2026-11-14T05:00:00Z");

export function setup() {
  const env = loadEnv({
    NODE_ENV: "test",
    BOT_TOKEN,
    OWNER_TELEGRAM_ID: String(OWNER),
    PUBLIC_URL,
    DATABASE_PATH: ":memory:",
    UPLOADS_DIR: mkdtempSync(join(tmpdir(), "store-uploads-")),
    SESSION_SECRET: "s".repeat(32),
    WEBHOOK_SECRET: "w".repeat(32),
    BOT_MODE: "off",
  });
  const notices: OrderNotice[] = [];
  const clock = { now: NOON };
  const fetchCalls: string[] = [];
  const redirects = new Map<string, string>();
  const deps: Deps = {
    db: openDb(":memory:"),
    env,
    now: () => clock.now,
    notifier: { notify: (n) => notices.push(n) },
    fetch: (async (input: string | URL | Request) => {
      const url = String(input);
      fetchCalls.push(url);
      const location = redirects.get(url);
      return location
        ? new Response(null, { status: 302, headers: { location } })
        : new Response("ok", { status: 200 });
    }) as typeof fetch,
    botUsername: "pechka_test_bot",
    syncBotProfile: () => {},
  };
  const app = createApp(deps);

  function initData(id: number, firstName = `User${id}`) {
    return sign({ user: { id, first_name: firstName } } as never, BOT_TOKEN, new Date());
  }

  async function call(
    method: string,
    path: string,
    opts: { as?: number; body?: unknown; headers?: Record<string, string> } = {},
  ) {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.as !== undefined) headers.authorization = `tma ${initData(opts.as)}`;
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(path, {
      method,
      headers,
      ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }),
    });
    const text = await res.text();
    // biome-ignore lint/suspicious/noExplicitAny: ответы API в тестах разбираем как есть
    const json: any = text ? JSON.parse(text) : null;
    return { status: res.status, json, res };
  }

  return { app, deps, env, notices, clock, fetchCalls, redirects, call, initData };
}

export type TestCtx = ReturnType<typeof setup>;

export const SETUP_BODY = {
  country: "VN",
  shop: { name: "Печка", manager: "@pechka_manager" },
  menu: "demo",
};

export const ORDER_BODY = {
  items: [
    { productId: "borscht", qty: 2 },
    { productId: "pelmeni", qty: 1 },
  ],
  customer: {
    name: "Анна",
    phone: "0912 345 678",
    location: { lat: 15.8801, lng: 108.338, accuracy: 12, source: "gps" },
    address: "Вилла 12",
    comment: "Без лука",
  },
};

export async function openShop(t: TestCtx) {
  const r = await t.call("POST", "/api/setup", { as: OWNER, body: SETUP_BODY });
  if (r.status !== 201) throw new Error(`setup: ${JSON.stringify(r.json)}`);
}
