/**
 * parseCatalog — разбор и проверка каталога из JSON: структура, ссылки между сущностями,
 * значения характеристик. Ошибки — с понятным путём: `products[3].price: Не меньше 0`.
 */
import { CATALOG_FORMAT_VERSION, type Catalog, CatalogSchema } from "./catalog.ts";
import { fieldValueSchema } from "./fields.ts";
import type { z } from "./zod.ts";

export type CatalogIssue = {
  /** Путь в JSON: "products[3].price"; пустая строка — корень файла. */
  path: string;
  message: string;
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: CatalogIssue[] };

const IDENT = /^[A-Za-z_$][\w$]*$/;

export function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const key of path) {
    if (typeof key === "number") out += `[${key}]`;
    else if (typeof key === "string" && IDENT.test(key)) out += out ? `.${key}` : key;
    else out += `[${JSON.stringify(String(key))}]`;
  }
  return out;
}

export function issuesFromZod(
  error: z.ZodError,
  prefix: readonly PropertyKey[] = [],
): CatalogIssue[] {
  return error.issues.map((issue) => ({
    path: formatPath([...prefix, ...issue.path]),
    message: issue.message,
  }));
}

/** Список ошибок одной строкой на ошибку — для консоли и отчёта импорта. */
export function formatIssues(issues: readonly CatalogIssue[]): string {
  return issues.map((i) => `${i.path || "(корень)"}: ${i.message}`).join("\n");
}

type Migration = (input: Record<string, unknown>) => Record<string, unknown>;

/**
 * Миграции формата: MIGRATIONS[n] переводит версию n в n + 1.
 * Пока версия одна; при изменении формата добавляем шаг сюда и поднимаем CATALOG_FORMAT_VERSION.
 */
const MIGRATIONS: Record<number, Migration> = {};

function migrate(input: unknown): ParseResult<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, issues: [{ path: "", message: "Каталог должен быть JSON-объектом" }] };
  }
  let data = input as Record<string, unknown>;
  const version = data.version;
  if (version === undefined) {
    return {
      ok: false,
      issues: [
        {
          path: "version",
          message: `Укажите версию формата: "version": ${CATALOG_FORMAT_VERSION}`,
        },
      ],
    };
  }
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return {
      ok: false,
      issues: [{ path: "version", message: "Версия формата — целое число, начиная с 1" }],
    };
  }
  if (version > CATALOG_FORMAT_VERSION) {
    return {
      ok: false,
      issues: [
        {
          path: "version",
          message: `Каталог в формате версии ${version}, а шаблон понимает до ${CATALOG_FORMAT_VERSION}. Обновите шаблон`,
        },
      ],
    };
  }
  for (let v = version; v < CATALOG_FORMAT_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) {
      return {
        ok: false,
        issues: [{ path: "version", message: `Нет миграции формата с версии ${v}` }],
      };
    }
    data = { ...step(data), version: v + 1 };
  }
  return { ok: true, value: data };
}

function duplicates<T>(
  items: readonly T[],
  key: (item: T) => string | undefined,
  path: (i: number) => string,
  what: string,
): CatalogIssue[] {
  const firstIndex = new Map<string, number>();
  const issues: CatalogIssue[] = [];
  items.forEach((item, i) => {
    const k = key(item);
    if (k === undefined) return;
    const first = firstIndex.get(k);
    if (first === undefined) firstIndex.set(k, i);
    else
      issues.push({
        path: path(i),
        message: `${what} «${k}» уже есть (повтор, первый — №${first + 1})`,
      });
  });
  return issues;
}

/** Проверки, которые не выразить схемой одного объекта: уникальность и ссылки. */
function checkReferences(catalog: Catalog): { catalog: Catalog; issues: CatalogIssue[] } {
  const issues: CatalogIssue[] = [
    ...duplicates(
      catalog.attributes,
      (a) => a.key,
      (i) => `attributes[${i}].key`,
      "Характеристика",
    ),
    ...duplicates(
      catalog.categories,
      (c) => c.id,
      (i) => `categories[${i}].id`,
      "Категория",
    ),
    ...duplicates(
      catalog.products,
      (p) => p.id,
      (i) => `products[${i}].id`,
      "Товар",
    ),
    ...duplicates(
      catalog.products,
      (p) => p.sku,
      (i) => `products[${i}].sku`,
      "Артикул",
    ),
  ];

  const categoryIds = new Set(catalog.categories.map((c) => c.id));
  const attributeDefs = new Map(catalog.attributes.map((a) => [a.key, a]));
  const attributeSchemas = new Map(catalog.attributes.map((a) => [a.key, fieldValueSchema(a)]));
  const knownKeys = [...attributeDefs.keys()].join(", ") || "характеристик пока нет";

  const products = catalog.products.map((product, i) => {
    product.categoryIds.forEach((id, j) => {
      if (!categoryIds.has(id)) {
        issues.push({ path: `products[${i}].categoryIds[${j}]`, message: `Нет категории «${id}»` });
      }
    });

    const attributes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(product.attributes)) {
      const schema = attributeSchemas.get(key);
      if (!schema) {
        issues.push({
          path: formatPath(["products", i, "attributes", key]),
          message: `Нет такой характеристики. Есть: ${knownKeys}`,
        });
        continue;
      }
      const parsed = schema.safeParse(value);
      if (parsed.success) {
        if (parsed.data !== undefined) attributes[key] = parsed.data;
      } else {
        issues.push(...issuesFromZod(parsed.error, ["products", i, "attributes", key]));
      }
    }
    for (const def of catalog.attributes) {
      if (def.required && !(def.key in product.attributes)) {
        issues.push({
          path: formatPath(["products", i, "attributes", def.key]),
          message: `Обязательная характеристика «${def.label}» не заполнена`,
        });
      }
    }
    return { ...product, attributes };
  });

  return { catalog: { ...catalog, products }, issues };
}

/**
 * Разбирает каталог: миграция версии → схема → ссылки и характеристики.
 * Возвращает либо нормализованный каталог (значения по умолчанию подставлены, телефоны
 * приведены к +7…), либо все найденные ошибки сразу.
 */
export function parseCatalog(input: unknown): ParseResult<Catalog> {
  const migrated = migrate(input);
  if (!migrated.ok) return migrated;

  const parsed = CatalogSchema.safeParse(migrated.value);
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) };

  const { catalog, issues } = checkReferences(parsed.data);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: catalog };
}

/** Каталог → объект для экспорта в JSON (со ссылкой на JSON Schema для автодополнения в IDE). */
export function serializeCatalog(
  catalog: Catalog,
  schemaUrl = "./catalog.schema.json",
): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = catalog;
  return { $schema: schemaUrl, ...rest };
}
