/**
 * Переменные окружения (.env в корне репозитория, пример — .env.example).
 * Относительные пути считаются от корня репозитория — там же лежит .env.
 */
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "@store/schema";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const secret = (name: string) =>
  z.string().min(32, { error: `${name}: случайная строка от 32 символов` });

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    BOT_TOKEN: z.string().regex(/^\d+:[\w-]{30,}$/, {
      error: "BOT_TOKEN: токен от @BotFather вида 123456:ABC…",
    }),
    OWNER_TELEGRAM_ID: z.coerce.number().int().positive({
      error: "OWNER_TELEGRAM_ID: ваш числовой Telegram ID (узнать у @userinfobot)",
    }),
    PUBLIC_URL: z
      .url({
        protocol: /^https$/,
        error: "PUBLIC_URL: https-адрес, по которому открывается Mini App",
      })
      .transform((u) => u.replace(/\/+$/, "")),
    PORT: z.coerce.number().int().default(3000),
    DATABASE_PATH: z.string().default("./data/store.db"),
    UPLOADS_DIR: z.string().default("./data/uploads"),
    SESSION_SECRET: secret("SESSION_SECRET"),
    WEBHOOK_SECRET: secret("WEBHOOK_SECRET"),
    /** polling — локально без вебхука; webhook — на сервере; off — без бота. */
    BOT_MODE: z.enum(["polling", "webhook", "off"]).optional(),
  })
  .transform((env) => ({
    ...env,
    BOT_MODE: env.BOT_MODE ?? (env.NODE_ENV === "production" ? "webhook" : "polling"),
    DATABASE_PATH: fromRoot(env.DATABASE_PATH),
    UPLOADS_DIR: fromRoot(env.UPLOADS_DIR),
  }));

export type Env = z.output<typeof EnvSchema>;

function fromRoot(path: string): string {
  return path === ":memory:" || isAbsolute(path) ? path : resolve(ROOT, path);
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (parsed.success) return parsed.data;
  const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
  throw new Error(`Проверьте .env:\n${lines.join("\n")}`);
}
