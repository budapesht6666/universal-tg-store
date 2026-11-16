/** Запуск: БД → бот (polling локально, вебхук на сервере) → HTTP. */
import { mkdirSync } from "node:fs";
import { serve } from "@hono/node-server";
import { webhookCallback } from "grammy";
import { type AppOptions, createApp } from "./app.ts";
import { createBot, setupBotUi } from "./bot/bot.ts";
import { mainAppCheck } from "./bot/main-app.ts";
import { createBotNotifier } from "./bot/notifier.ts";
import { syncBotProfile } from "./bot/profile.ts";
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
  mainAppReady: null,
  syncBotProfile: () => {},
};

const ALLOWED_UPDATES = ["message", "callback_query"] as const;
let webhook: AppOptions["webhook"];
let stopBot = async () => {};

/**
 * Локальный polling с тем же токеном снял бы вебхук боевого сервера — и бот на проде
 * молча перестал бы получать сообщения. Поэтому, если вебхук уже стоит, локально бот не
 * запускаем (для разработки — отдельный тестовый бот или BOT_MODE=off).
 */
async function webhookTakenElsewhere(bot: ReturnType<typeof createBot>): Promise<string | null> {
  if (env.BOT_MODE !== "polling") return null;
  const info = await bot.api.getWebhookInfo();
  return info.url || null;
}

const probe = env.BOT_MODE === "off" ? null : createBot(deps);
const takenBy = probe ? await webhookTakenElsewhere(probe) : null;
if (takenBy) {
  console.warn(
    `Бот уже работает на сервере (вебхук ${takenBy}) — локально запускаемся без бота.
` + "Для разработки заведите отдельного тестового бота или задайте BOT_MODE=off.",
  );
}

if (probe && !takenBy) {
  const bot = probe;
  await bot.init();
  deps.botUsername = bot.botInfo.username;
  deps.mainAppReady = mainAppCheck(
    async () => (await bot.api.getMe()).has_main_web_app,
    () => Date.now(),
  );
  deps.notifier = createBotNotifier(bot.api, deps);
  await setupBotUi(bot, deps);
  deps.syncBotProfile = () => {
    syncBotProfile(bot.api, deps).catch((err) =>
      console.error("Бот: не обновился профиль:", String(err)),
    );
  };
  deps.syncBotProfile();
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
