/** Запуск: БД → бот (polling локально, вебхук на сервере) → HTTP. */
import { mkdirSync } from "node:fs";
import { serve } from "@hono/node-server";
import { webhookCallback } from "grammy";
import { type AppOptions, createApp } from "./app.ts";
import { createBot, setupBotUi } from "./bot/bot.ts";
import { createBotNotifier } from "./bot/notifier.ts";
import { startReminders } from "./bot/reminders.ts";
import { closeDb, openDb } from "./db/client.ts";
import type { Deps } from "./deps.ts";
import { loadEnv } from "./env.ts";
import { silentNotifier } from "./notify.ts";

const env = loadEnv();
const db = openDb(env.DATABASE_PATH);
mkdirSync(env.UPLOADS_DIR, { recursive: true });
const deps: Deps = {
  db,
  env,
  now: () => new Date(),
  notifier: silentNotifier,
  fetch,
  botUsername: null,
};

const ALLOWED_UPDATES = ["message", "callback_query"] as const;
let webhook: AppOptions["webhook"];
let stopBot = async () => {};

if (env.BOT_MODE !== "off") {
  const bot = createBot(deps);
  await bot.init();
  deps.botUsername = bot.botInfo.username;
  deps.notifier = createBotNotifier(bot.api, deps);
  await setupBotUi(bot, deps);
  const stopReminders = startReminders(deps);

  if (env.BOT_MODE === "webhook") {
    webhook = webhookCallback(bot, "hono", { secretToken: env.WEBHOOK_SECRET });
    await bot.api.setWebhook(`${env.PUBLIC_URL}/bot/webhook`, {
      secret_token: env.WEBHOOK_SECRET,
      allowed_updates: [...ALLOWED_UPDATES],
    });
  } else {
    await bot.api.deleteWebhook();
    void bot.start({ allowed_updates: [...ALLOWED_UPDATES] });
  }
  stopBot = async () => {
    stopReminders();
    if (bot.isRunning()) await bot.stop();
  };
  console.log(`Бот @${deps.botUsername} (${env.BOT_MODE})`);
}

const app = createApp(deps, webhook ? { webhook } : {});
const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Сервер: http://localhost:${info.port} · ${env.PUBLIC_URL}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await stopBot();
    server.close();
    closeDb(db);
    process.exit(0);
  });
}
