import type { Db } from "./db/client.ts";
import type { Env } from "./env.ts";
import type { Notifier } from "./notify.ts";

/** Всё, от чего зависит сервер: в тестах подменяется БД в памяти, часы, уведомления и fetch. */
export type Deps = {
  db: Db;
  env: Env;
  now: () => Date;
  notifier: Notifier;
  fetch: typeof fetch;
  /** Имя бота без @ (после запуска бота) — для ссылок t.me/<бот>?start=… */
  botUsername: string | null;
  /** Обновить профиль бота (имя, описания) из настроек — после их сохранения. Не ждёт и не падает. */
  syncBotProfile: () => void;
};
