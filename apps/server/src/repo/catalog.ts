/** Меню в БД: чтение целиком, загрузка демо-меню, правка категорий и блюд из админки. */
import { readFileSync } from "node:fs";
import {
  CATALOG_FORMAT_VERSION,
  type Catalog,
  type Category,
  type CategoryInput,
  type Features,
  type Product,
  type ProductInput,
  parseCatalog,
  slugify,
} from "@store/schema";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { attributes, categories, products } from "../db/schema.ts";
import { AppError } from "../errors.ts";

type ProductRow = typeof products.$inferSelect;

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    price: row.price,
    ...(row.compareAtPrice !== null && { compareAtPrice: row.compareAtPrice }),
    images: row.images,
    categoryId: row.categoryId,
    badges: row.badges,
    available: row.available,
    isActive: row.isActive,
    sort: row.sort,
    attributes: row.attributes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Всё меню в формате каталога (как в JSON-файле). */
export function loadCatalog(db: Db): Catalog {
  return {
    version: CATALOG_FORMAT_VERSION,
    attributes: db
      .select()
      .from(attributes)
      .orderBy(asc(attributes.sort))
      .all()
      .map((a) => a.definition),
    categories: db
      .select()
      .from(categories)
      .orderBy(asc(categories.sort), asc(categories.id))
      .all(),
    products: db
      .select()
      .from(products)
      .orderBy(asc(products.sort), asc(products.id))
      .all()
      .map(toProduct),
  };
}

/**
 * Меню для покупателя: только видимые блюда, без служебных полей; выключенные фичи
 * (старая цена, метки) убираются, данные блюд в БД остаются.
 */
export function publicCatalog(db: Db, features: Features) {
  const catalog = loadCatalog(db);
  const visible = catalog.products.filter((p) => p.isActive);
  const used = new Set(visible.map((p) => p.categoryId));
  return {
    attributes: catalog.attributes,
    categories: catalog.categories.filter((c) => used.has(c.id)),
    products: visible.map(
      ({ isActive: _a, createdAt: _c, updatedAt: _u, compareAtPrice, badges, ...p }) => ({
        ...p,
        ...(features.discounts && compareAtPrice !== undefined && { compareAtPrice }),
        badges: features.badges ? badges : [],
      }),
    ),
  };
}
export type PublicCatalog = ReturnType<typeof publicCatalog>;

/** Заменяет меню целиком (демо-меню при первой настройке, позже — импорт). */
export function replaceCatalog(db: Db, catalog: Catalog, now: Date): void {
  db.transaction((tx) => {
    tx.delete(products).run();
    tx.delete(categories).run();
    tx.delete(attributes).run();
    catalog.attributes.forEach((definition, i) => {
      tx.insert(attributes).values({ key: definition.key, sort: i, definition }).run();
    });
    for (const c of catalog.categories) tx.insert(categories).values(c).run();
    for (const p of catalog.products) {
      tx.insert(products)
        .values({
          ...p,
          compareAtPrice: p.compareAtPrice ?? null,
          createdAt: p.createdAt ? new Date(p.createdAt) : now,
          updatedAt: p.updatedAt ? new Date(p.updatedAt) : now,
        })
        .run();
    }
  });
}

const DEMO_CATALOG = new URL("../../../../catalog/example.catalog.json", import.meta.url);

export function loadDemoCatalog(): Catalog {
  const r = parseCatalog(JSON.parse(readFileSync(DEMO_CATALOG, "utf8")));
  if (!r.ok) throw new Error(`Демо-меню не прошло проверку: ${r.issues[0]?.message}`);
  return r.value;
}

/** Меню без блюд и категорий, но с характеристиками демо (порция, калорийность). */
export function emptyCatalog(): Catalog {
  return { ...loadDemoCatalog(), categories: [], products: [] };
}

// ───────────── Правка из админки ─────────────

/** Свободный id: borscht, borscht-2, borscht-3… */
function freeId(taken: (id: string) => boolean, title: string, fallback: string): string {
  const base = slugify(title) || `${fallback}-${Date.now().toString(36)}`;
  if (!taken(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base.slice(0, 60)}-${n}`;
    if (!taken(id)) return id;
  }
}

const nextSort = (sorts: number[]) => (sorts.length ? Math.max(...sorts) + 10 : 10);

export function createCategory(db: Db, input: CategoryInput): Category {
  const all = db.select().from(categories).all();
  const ids = new Set(all.map((c) => c.id));
  const category: Category = {
    id: freeId((id) => ids.has(id), input.title, "category"),
    title: input.title,
    sort: input.sort ?? nextSort(all.map((c) => c.sort)),
  };
  db.insert(categories).values(category).run();
  return category;
}

export function updateCategory(db: Db, id: string, input: CategoryInput): Category {
  const row = db
    .update(categories)
    .set({ title: input.title, ...(input.sort !== undefined && { sort: input.sort }) })
    .where(eq(categories.id, id))
    .returning()
    .get();
  if (!row) throw new AppError(404, "Категория не найдена");
  return row;
}

export function deleteCategory(db: Db, id: string): void {
  const n = db.select({ n: count() }).from(products).where(eq(products.categoryId, id)).get()?.n;
  if (n) throw new AppError(409, "В категории есть блюда — перенесите или удалите их");
  const r = db.delete(categories).where(eq(categories.id, id)).run();
  if (r.changes === 0) throw new AppError(404, "Категория не найдена");
}

/** Порядок по перетаскиванию: sort = 10, 20, 30… в переданной последовательности. */
export function reorderCategories(db: Db, ids: string[]): void {
  db.transaction((tx) => {
    const found = tx
      .select({ id: categories.id })
      .from(categories)
      .where(inArray(categories.id, ids))
      .all();
    if (found.length !== ids.length) throw new AppError(404, "Категория не найдена");
    ids.forEach((id, i) => {
      tx.update(categories)
        .set({ sort: (i + 1) * 10 })
        .where(eq(categories.id, id))
        .run();
    });
  });
}

export function reorderProducts(db: Db, categoryId: string, ids: string[]): void {
  db.transaction((tx) => {
    const found = tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.categoryId, categoryId), inArray(products.id, ids)))
      .all();
    if (found.length !== ids.length) throw new AppError(404, "Блюдо не найдено в этой категории");
    ids.forEach((id, i) => {
      tx.update(products)
        .set({ sort: (i + 1) * 10 })
        .where(eq(products.id, id))
        .run();
    });
  });
}

function assertCategory(db: Db, id: string): void {
  if (!db.select().from(categories).where(eq(categories.id, id)).get()) {
    throw new AppError(400, "Нет такой категории", [
      { path: "categoryId", message: "Нет такой категории" },
    ]);
  }
}

function productValues(input: ProductInput) {
  const { id: _id, compareAtPrice, ...rest } = input;
  return { ...rest, compareAtPrice: compareAtPrice ?? null };
}

export function createProduct(db: Db, input: ProductInput, now: Date): Product {
  assertCategory(db, input.categoryId);
  const exists = (id: string) => !!db.select().from(products).where(eq(products.id, id)).get();
  if (input.id && exists(input.id)) {
    throw new AppError(409, "Блюдо с таким id уже есть", [
      { path: "id", message: "Блюдо с таким id уже есть" },
    ]);
  }
  const id = input.id ?? freeId(exists, input.title, "dish");
  const sorts = db
    .select({ sort: products.sort })
    .from(products)
    .where(eq(products.categoryId, input.categoryId))
    .all();
  const row = db
    .insert(products)
    .values({
      ...productValues(input),
      id,
      sort: input.sort || nextSort(sorts.map((s) => s.sort)),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return toProduct(row);
}

export function updateProduct(db: Db, id: string, input: ProductInput, now: Date): Product {
  assertCategory(db, input.categoryId);
  const row = db
    .update(products)
    .set({ ...productValues(input), updatedAt: now })
    .where(eq(products.id, id))
    .returning()
    .get();
  if (!row) throw new AppError(404, "Блюдо не найдено");
  return toProduct(row);
}

export function patchProduct(
  db: Db,
  id: string,
  patch: { available?: boolean | undefined; isActive?: boolean | undefined },
  now: Date,
): Product {
  const row = db
    .update(products)
    .set({
      ...(patch.available !== undefined && { available: patch.available }),
      ...(patch.isActive !== undefined && { isActive: patch.isActive }),
      updatedAt: now,
    })
    .where(eq(products.id, id))
    .returning()
    .get();
  if (!row) throw new AppError(404, "Блюдо не найдено");
  return toProduct(row);
}

export function deleteProduct(db: Db, id: string): void {
  // Заказы хранят снимок позиций, поэтому блюдо можно удалить без следа в истории.
  const r = db.delete(products).where(eq(products.id, id)).run();
  if (r.changes === 0) throw new AppError(404, "Блюдо не найдено");
}

export function getProductsByIds(db: Db, ids: string[]): Product[] {
  if (ids.length === 0) return [];
  return db.select().from(products).where(inArray(products.id, ids)).all().map(toProduct);
}
