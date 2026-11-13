import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  type CatalogIssue,
  catalogJsonSchema,
  isSoldOut,
  maxQtyFor,
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
  settings: { shop: { name: "Магазин" } },
  products: [{ id: "tee", title: "Футболка", price: 199000 }],
};

describe("parseCatalog: корректные каталоги", () => {
  it("пример из репозитория проходит проверку", () => {
    const r = parseCatalog(example);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.products).toHaveLength(15);
    expect(r.value.categories.map((c) => c.id)).toEqual(["wear", "acc", "home", "paper"]);
    expect(r.value.settings.delivery.shopPhone).toBe("+74950000000");
  });

  it("минимальный каталог дополняется значениями по умолчанию", () => {
    const r = parseCatalog(minimal);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { settings, products } = r.value;
    expect(settings.shop).toMatchObject({ locale: "ru-RU", currency: "RUB" });
    expect(Object.values(settings.features).every(Boolean)).toBe(true);
    expect(settings.catalog.defaultView).toBe("grid");
    expect(settings.checkout.maxQtyPerItem).toBe(100);
    expect(settings.checkout.fields.map((f) => f.key)).toEqual([
      "name",
      "phone",
      "address",
      "comment",
    ]);
    expect(settings.orders.customerCanCancel).toBe(true);
    expect(settings.delivery.assignment).toBe("manual");
    expect(products[0]).toMatchObject({
      stock: null,
      isActive: true,
      images: [],
      attributes: {},
      categoryIds: [],
    });
  });

  it("экспорт → импорт даёт тот же каталог", () => {
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
    expect(issuesOf([])[0]?.message).toBe("Каталог должен быть JSON-объектом");
    expect(issuesOf({ settings: {} })).toEqual([
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
        c.products[2].id = "Худи";
      }),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        { path: "products[3].price", message: "Сумма не может быть отрицательной" },
        { path: "products[0].title", message: "Не может быть пустым" },
        { path: "products[1]", message: "Неизвестное поле «prise» — проверьте написание" },
        {
          path: "products[2].id",
          message: "id — латиница в нижнем регистре, цифры и дефис, например tee-basic",
        },
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
        c.products[2].sku = c.products[0].sku;
        c.products[0].categoryIds = ["wear", "shoes"];
        c.categories.push({ id: "wear", title: "Ещё одежда" });
      }),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        { path: "products[1].id", message: "Товар «tee-base» уже есть (повтор, первый — №1)" },
        { path: "products[2].sku", message: "Артикул «TB-001» уже есть (повтор, первый — №1)" },
        { path: "products[0].categoryIds[1]", message: "Нет категории «shoes»" },
        { path: "categories[4].id", message: "Категория «wear» уже есть (повтор, первый — №1)" },
      ]),
    );
  });

  it("характеристики проверяются по их описанию", () => {
    const issues = issuesOf(
      variant((c) => {
        c.products[0].attributes.density = 5000;
        c.products[0].attributes.material = "Шёлк";
        c.products[1].attributes.colour = "red";
      }),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        { path: "products[0].attributes.density", message: "Не больше 600" },
        {
          path: "products[0].attributes.material",
          message: expect.stringMatching(/^Выберите один из вариантов/),
        },
        {
          path: "products[1].attributes.colour",
          message: expect.stringMatching(/^Нет такой характеристики\. Есть: material/),
        },
      ]),
    );
  });

  it("обязательная характеристика", () => {
    const issues = issuesOf(variant((c) => (c.attributes[0].required = true)));
    expect(issues.some((i) => i.path === "products[12].attributes.material")).toBe(true);
  });

  it("в оформлении обязателен телефон — курьер должен дозвониться", () => {
    const issues = issuesOf(
      variant((c) => {
        c.settings.checkout.fields = [{ key: "name", label: "Имя", type: "text", required: true }];
      }),
    );
    expect(issues[0]).toEqual({
      path: "settings.checkout.fields",
      message:
        "Нужно ровно одно обязательное поле типа phone — без телефона курьер не сможет передать заказ",
    });
  });
});

describe("лимит количества", () => {
  const settings = { features: { stock: true }, checkout: { maxQtyPerItem: 100 } } as const;

  it("min(лимит, остаток)", () => {
    expect(maxQtyFor({ stock: 3 }, settings)).toBe(3);
    expect(maxQtyFor({ stock: 500 }, settings)).toBe(100);
    expect(maxQtyFor({ stock: null }, settings)).toBe(100);
  });

  it("без учёта остатков — только лимит", () => {
    expect(maxQtyFor({ stock: 3 }, { ...settings, features: { stock: false } })).toBe(100);
    expect(isSoldOut({ stock: 0 }, { stock: false })).toBe(false);
    expect(isSoldOut({ stock: 0 }, { stock: true })).toBe(true);
  });
});

describe("JSON Schema", () => {
  it("закоммиченная схема совпадает со сгенерированной — иначе запустите pnpm schema:gen", () => {
    const committed = JSON.parse(readFileSync(new URL("catalog.schema.json", root), "utf8"));
    expect(committed).toEqual(catalogJsonSchema());
  });
});
