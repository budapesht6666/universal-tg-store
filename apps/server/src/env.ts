/**
 * Переменные окружения (.env в корне репозитория, пример — .env.example).
 * Относительные пути считаются от корня репозитория — там же лежит .env.
 */
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "@store/schema";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const secret = z.string().min(32, { error: "случайная строка от 32 символов" });

/** Пустая строка в .env («PUBLIC_URL=») — как будто переменной нет. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    BOT_TOKEN: z
      .string()
      .regex(/^\d+:[\w-]{30,}$/, { error: "токен от @BotFather вида 123456:ABC…" }),
    OWNER_TELEGRAM_ID: z.coerce
      .number()
      .int()
      .positive({ error: "ваш числовой Telegram ID (узнать у @userinfobot)" }),
    /** https-адрес Mini App и вебхука. Локально с polling можно не задавать. */
    PUBLIC_URL: optional(
      z.url({ protocol: /^https?$/, error: "адрес вида https://shop.example.com" }),
    ),
    PORT: z.coerce.number().int().default(3000),
    DATABASE_PATH: z.string().default("./data/store.db"),
    UPLOADS_DIR: z.string().default("./data/uploads"),
    SESSION_SECRET: secret,
    WEBHOOK_SECRET: secret,
    /** polling — локально без вебхука; webhook — на сервере; off — без бота. */
    BOT_MODE: optional(z.enum(["polling", "webhook", "off"])),
  })
  .transform((env, ctx) => {
    const BOT_MODE = env.BOT_MODE ?? (env.NODE_ENV === "production" ? "webhook" : "polling");
    const https = env.PUBLIC_URL?.startsWith("https://") ?? false;
    if (!https && (BOT_MODE === "webhook" || env.NODE_ENV === "production")) {
      ctx.issues.push({
        code: "custom",
        path: ["PUBLIC_URL"],
        input: env.PUBLIC_URL,
        message: "на сервере и для вебхука нужен https-адрес, по которому открывается Mini App",
      });
      return z.NEVER;
    }
    return {
      ...env,
      BOT_MODE,
      PUBLIC_URL: (env.PUBLIC_URL ?? `http://localhost:${env.PORT}`).replace(/\/+$/, ""),
      /** Кнопки Mini App в Telegram работают только с https: без него бот шлёт сообщения без них. */
      WEB_APP_ENABLED: https,
      DATABASE_PATH: fromRoot(env.DATABASE_PATH),
      UPLOADS_DIR: fromRoot(env.UPLOADS_DIR),
    };
  });

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
