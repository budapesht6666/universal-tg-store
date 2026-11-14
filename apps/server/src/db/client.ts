import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Номера заказов начинаются с 1001: «Заказ #1» выглядит как первый заказ магазина. */
const FIRST_ORDER_ID = 1001;

/** Открывает БД (":memory:" — для тестов) и применяет миграции. */
export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });
  const seq = db.get<{ n: number }>(
    sql`SELECT count(*) AS n FROM sqlite_sequence WHERE name = 'orders'`,
  );
  if (!seq?.n) {
    db.run(sql`INSERT INTO sqlite_sequence (name, seq) VALUES ('orders', ${FIRST_ORDER_ID - 1})`);
  }
  return db;
}

export function closeDb(db: Db): void {
  db.$client.close();
}
