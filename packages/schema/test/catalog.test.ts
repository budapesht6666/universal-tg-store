import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type CatalogIssue,
  canOrderProduct,
  catalogJsonSchema,
  parseCatalog,
  serializeCatalog,
} from "../src/index.ts";

const root = new URL("../../../catalog/", import.meta.url);
const example = JSON.parse(readFileSync(new URL("example.catalog.json", root), "utf8")) as Record<
  string,
  unknown
>;

/** Глубокая копия примера с правкой. */
// biome-ignore lint/suspicious/noExplicitAny: тест правит произвольные места JSON, включая неверные поля
function variant(edit: (c: any) => void): unknown {
  const copy = structuredClone(example);
  edit(copy);
  return copy;
}

function issuesOf(input: unknown): CatalogIssue[] {
  const r = parseCatalog(input);
  if (r.ok) throw new Error("ожидались ошибки");
  return r.issues;
}

const minimal = {
  version: 1,
  categories: [{ id: "soups", title: "Супы" }],
  products: [{ id: "pho", title: "Фо", price: 75000, categoryId: "soups" }],
};

describe("parseCatalog: корректное меню", () => {
  it("демо-меню из репозитория проходит проверку", () => {
    const r = parseCatalog(example);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.products).toHaveLength(15);
    expect(r.value.categories.map((c) => c.id)).toEqual(["soups", "hot", "snacks", "drinks"]);
    expect(r.value.products.filter((p) => !canOrderProduct(p)).map((p) => p.id)).toEqual([
      "soup-of-the-day",
      "banh-mi",
    ]);
  });

  it("минимальное меню дополняется значениями по умолчанию", () => {
    const r = parseCatalog(minimal);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.products[0]).toEqual({
      id: "pho",
      title: "Фо",
      description: "",
      price: 75000,
      categoryId: "soups",
      badges: [],
      available: true,
      isActive: true,
      sort: 0,
      attributes: {},
    });
  });

  it("экспорт → импорт даёт то же меню", () => {
    const first = parseCatalog(example);
    if (!first.ok) throw new Error("пример невалиден");
    const exported = JSON.parse(JSON.stringify(serializeCatalog(first.value)));
    expect(exported.$schema).toBe("./catalog.schema.json");
    const second = parseCatalog(exported);
    if (!second.ok) throw new Error("экспорт невалиден");
    expect(second.value).toEqual({ ...first.value, $schema: "./catalog.schema.json" });
  });
});

describe("parseCatalog: ошибки с понятными путями", () => {
  it("не объект и без версии", () => {
    expect(issuesOf([])[0]?.message).toBe("Меню должно быть JSON-объектом");
    expect(issuesOf({ products: [] })).toEqual([
      { path: "version", message: 'Укажите версию формата: "version": 1' },
    ]);
    expect(issuesOf({ ...minimal, version: 7 })[0]?.message).toMatch(/версии 7.*до 1/);
  });

  it("ошибки структуры — с путём до поля", () => {
    const issues = issuesOf(
      variant((c) => {
        c.products[3].price = -100;
        c.products[0].title = "";
        c.products[1].prise = 100;
        c.products[2].id = "Бун бо";
        c.products[5].price = 70000.5;
      }),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        { path: "products[3].price", message: "Сумма не может быть отрицательной" },
        { path: "products[0].title", message: "Не может быть пустым" },
        { path: "products[1]", message: "Неизвестное поле «prise» — проверьте написание" },
        {
          path: "products[2].id",
          message: "id — латиница в нижнем регистре, цифры и дефис, например pho-bo",
        },
        { path: "products[5].price", message: expect.stringMatching(/^Сумма — целое число/) },
      ]),
    );
  });

  it("старая цена не меньше текущей", () => {
    const issues = issuesOf(variant((c) => (c.products[0].compareAtPrice = c.products[0].price)));
    expect(issues).toEqual([
      {
        path: "products[0].compareAtPrice",
        message: "Старая цена должна быть больше текущей — иначе это не скидка",
      },
    ]);
  });

  it("ссылки и уникальность", () => {
    const issues = issuesOf(
      variant((c) => {
        c.products[1].id = c.products[0].id;
        c.products[0].categoryId = "desserts";
        c.categories.push({ id: "soups", title: "Ещё супы" });
      }),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        { path: "products[1].id", message: "Блюдо «pho-bo» уже есть (повтор, первый — №1)" },
        { path: "products[0].categoryId", message: "Нет категории «desserts»" },
        { path: "categories[4].id", message: "Категория «soups» уже есть (повтор, первый — №1)" },
      ]),
    );
  });

  it("характеристики проверяются по их описанию", () => {
    const issues = issuesOf(
      variant((c) => {
        c.products[0].attributes.kcal = 9000;
        c.products[1].attributes.spicy = true;
      }),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        { path: "products[0].attributes.kcal", message: "Не больше 5000" },
        {
          path: "products[1].attributes.spicy",
          message: expect.stringMatching(/^Нет такой характеристики\. Есть: portion, kcal/),
        },
      ]),
    );
  });

  it("обязательная характеристика", () => {
    const issues = issuesOf(variant((c) => (c.attributes[0].required = true)));
    expect(issues.some((i) => i.path === "products[4].attributes.portion")).toBe(true);
  });
});

describe("JSON Schema", () => {
  it("закоммиченная схема совпадает со сгенерированной — иначе запустите pnpm schema:gen", () => {
    const committed = JSON.parse(readFileSync(new URL("catalog.schema.json", root), "utf8"));
    expect(committed).toEqual(catalogJsonSchema());
  });
});
