import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";

const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));
const temp: string[] = [];

afterEach(() => {
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Копия папки миграций, в журнале которой только миграции до `tag` включительно. */
function migrationsUpTo(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), "store-migrations-"));
  temp.push(dir);
  cpSync(MIGRATIONS, dir, { recursive: true });
  const journalPath = join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  const last = journal.entries.findIndex((e: { tag: string }) => e.tag === tag);
  expect(last).toBeGreaterThanOrEqual(0);
  journal.entries = journal.entries.slice(0, last + 1);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

describe("миграции БД", () => {
  it("одно фото блюда переезжает в images первым, без фото — пустой список", () => {
    const sqlite = new Database(":memory:");
    const db = drizzle(sqlite);
    migrate(db, { migrationsFolder: migrationsUpTo("0003_staff_no_phone") });

    const now = Date.now();
    sqlite.prepare("INSERT INTO categories (id, title, sort) VALUES ('soups', 'Супы', 10)").run();
    const insert = sqlite.prepare(
      `INSERT INTO products (id, category_id, title, price, image, badges, attributes, created_at, updated_at)
       VALUES (?, 'soups', ?, 85000, ?, '[]', '{}', ?, ?)`,
    );
    insert.run(
      "borscht",
      "Борщ",
      JSON.stringify({ url: "/uploads/a.webp", alt: "Борщ" }),
      now,
      now,
    );
    insert.run("pho", "Фо", null, now, now);

    migrate(db, { migrationsFolder: MIGRATIONS });

    const rows = sqlite.prepare("SELECT id, images FROM products ORDER BY id").all() as {
      id: string;
      images: string;
    }[];
    expect(rows.map((r) => [r.id, JSON.parse(r.images)])).toEqual([
      ["borscht", [{ url: "/uploads/a.webp", alt: "Борщ" }]],
      ["pho", []],
    ]);
    const columns = sqlite.prepare("PRAGMA table_info(products)").all() as { name: string }[];
    expect(columns.map((c) => c.name)).not.toContain("image");
    sqlite.close();
  });
});
