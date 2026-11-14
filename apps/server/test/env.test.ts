import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env.ts";

const base = {
  BOT_TOKEN: "123456:TEST-token-for-signing-init-data-xyz",
  OWNER_TELEGRAM_ID: "1000",
  SESSION_SECRET: "s".repeat(32),
  WEBHOOK_SECRET: "w".repeat(32),
};

describe(".env", () => {
  it("локально с polling PUBLIC_URL можно не задавать — без кнопок Mini App", () => {
    const env = loadEnv({ ...base, PUBLIC_URL: "" });
    expect(env).toMatchObject({
      BOT_MODE: "polling",
      PUBLIC_URL: "http://localhost:3000",
      WEB_APP_ENABLED: false,
    });
    expect(loadEnv({ ...base, PUBLIC_URL: "https://x.trycloudflare.com/" })).toMatchObject({
      PUBLIC_URL: "https://x.trycloudflare.com",
      WEB_APP_ENABLED: true,
    });
  });

  it("на сервере нужен https; ошибки — по одной строке на переменную", () => {
    expect(() => loadEnv({ ...base, NODE_ENV: "production" })).toThrow(
      "PUBLIC_URL: на сервере и для вебхука нужен https-адрес",
    );
    expect(() => loadEnv({ ...base, BOT_TOKEN: "x", PUBLIC_URL: "" })).toThrow(
      "Проверьте .env:\n  BOT_TOKEN: токен от @BotFather вида 123456:ABC…",
    );
  });
});
