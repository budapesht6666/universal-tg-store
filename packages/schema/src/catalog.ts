/**
 * Формат каталога: настройки магазина, характеристики, категории, товары.
 * Это же — формат импорта/экспорта JSON. Описание для людей — docs/catalog-format.md.
 */
import {
  AttributeDefinitionSchema,
  type FieldDefinitionInput,
  FieldDefinitionSchema,
  ImageRefSchema,
} from "./fields.ts";
import { MoneySchema } from "./money.ts";
import { PhoneSchema } from "./phone.ts";
import { z } from "./zod.ts";

/** Текущая версия формата. При изменении формата — новая версия и миграция в parse.ts. */
export const CATALOG_FORMAT_VERSION = 1;

export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const IdSchema = z.string().max(64).regex(ID_PATTERN, {
  error: "id — латиница в нижнем регистре, цифры и дефис, например tee-basic",
});

// ───────────── Настройки ─────────────

export const ShopSettingsSchema = z.strictObject({
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().max(500).default(""),
  greeting: z
    .string()
    .trim()
    .max(1000)
    .default("")
    .meta({ description: "Ответ бота на /start, под ним кнопка «Открыть магазин»" }),
  locale: z
    .string()
    .default("ru-RU")
    .refine((v) => Intl.NumberFormat.supportedLocalesOf(v).length > 0, {
      error: "Неизвестная локаль, пример: ru-RU, en-US",
    }),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, { error: "Код валюты ISO 4217 из трёх заглавных букв, например RUB" })
    .default("RUB"),
});

export const FeaturesSchema = z
  .strictObject({
    categories: z.boolean().default(true),
    search: z.boolean().default(true),
    sort: z.boolean().default(true),
    gallery: z.boolean().default(true),
    discounts: z.boolean().default(true),
    badges: z.boolean().default(true),
    stock: z.boolean().default(true),
  })
  .meta({
    description: "Фичи каталога: выключенная пропадает из магазина, данные товаров остаются",
  });
export type Features = z.output<typeof FeaturesSchema>;
export type FeatureKey = keyof Features;

export const CatalogViewSchema = z.enum(["grid", "list"]);
export type CatalogView = z.output<typeof CatalogViewSchema>;

export const DEFAULT_CHECKOUT_FIELDS: FieldDefinitionInput[] = [
  { key: "name", label: "Имя", type: "text", required: true, maxLength: 80 },
  {
    key: "phone",
    label: "Телефон",
    type: "phone",
    required: true,
    hint: "Курьер позвонит перед доставкой",
  },
  {
    key: "address",
    label: "Адрес",
    type: "textarea",
    required: true,
    placeholder: "Город, улица, дом, квартира",
    maxLength: 300,
  },
  { key: "comment", label: "Комментарий", type: "textarea", maxLength: 500 },
];

export const CheckoutSettingsSchema = z
  .strictObject({
    fields: z.array(FieldDefinitionSchema).prefault(DEFAULT_CHECKOUT_FIELDS),
    phoneFromTelegramOnly: z
      .boolean()
      .default(false)
      .meta({ description: "Номер только из Telegram (requestContact), ручной ввод запрещён" }),
    maxQtyPerItem: z.int().min(1).max(10_000).default(100).meta({
      description: "Максимум штук одного товара в заказе; если остаток меньше — ограничит остаток",
    }),
  })
  .superRefine((checkout, ctx) => {
    const seen = new Set<string>();
    checkout.fields.forEach((field, i) => {
      if (seen.has(field.key)) {
        ctx.addIssue({
          code: "custom",
          path: ["fields", i, "key"],
          message: `Ключ «${field.key}» уже есть`,
        });
      }
      seen.add(field.key);
    });
    const phones = checkout.fields.filter((f) => f.type === "phone");
    if (phones.length !== 1 || !phones[0]?.required) {
      ctx.addIssue({
        code: "custom",
        path: ["fields"],
        message:
          "Нужно ровно одно обязательное поле типа phone — без телефона курьер не сможет передать заказ",
      });
    }
  });

export const OrderSettingsSchema = z.strictObject({
  customerCanCancel: z
    .boolean()
    .default(true)
    .meta({ description: "Покупатель может сам отменить заказ, пока он в статусе «Оформлен»" }),
});

export const DeliverySettingsSchema = z.strictObject({
  assignment: z
    .enum(["manual", "pool"])
    .default("manual")
    .meta({ description: "manual — менеджер выбирает курьера; pool — курьеры берут сами" }),
  shopPhone: PhoneSchema.optional().meta({
    description: "Сюда звонит покупатель, если курьер скрыл свой номер",
  }),
});

export const SettingsSchema = z.strictObject({
  shop: ShopSettingsSchema,
  features: FeaturesSchema.prefault({}),
  catalog: z.strictObject({ defaultView: CatalogViewSchema.default("grid") }).prefault({}),
  checkout: CheckoutSettingsSchema.prefault({}),
  orders: OrderSettingsSchema.prefault({}),
  delivery: DeliverySettingsSchema.prefault({}),
});
export type Settings = z.output<typeof SettingsSchema>;

// ───────────── Категории и товары ─────────────

export const CategorySchema = z.strictObject({
  id: IdSchema,
  title: z.string().trim().min(1).max(60),
  sort: z.int().default(0),
});
export type Category = z.output<typeof CategorySchema>;

const DateTimeSchema = z.iso.datetime({ offset: true });

export const ProductSchema = z
  .strictObject({
    id: IdSchema,
    sku: z.string().trim().min(1).max(64).optional(),
    title: z.string().trim().min(1).max(120),
    shortDescription: z
      .string()
      .trim()
      .max(160)
      .default("")
      .meta({ description: "Для карточки в каталоге, до 160 символов" }),
    description: z
      .string()
      .trim()
      .max(20_000)
      .default("")
      .meta({ description: "Markdown без HTML" }),
    price: MoneySchema,
    compareAtPrice: MoneySchema.optional().meta({ description: "Старая цена (зачёркнутая)" }),
    images: z.array(ImageRefSchema).max(20).default([]),
    categoryIds: z.array(IdSchema).default([]),
    badges: z.array(z.string().trim().min(1).max(24)).max(5).default([]),
    stock: z
      .int()
      .min(0)
      .nullable()
      .default(null)
      .meta({ description: "Остаток; null — без учёта остатков" }),
    isActive: z.boolean().default(true),
    sort: z.int().default(0),
    attributes: z
      .record(z.string(), z.unknown())
      .default({})
      .meta({ description: "Значения характеристик: ключ из attributes → значение" }),
    createdAt: DateTimeSchema.optional(),
    updatedAt: DateTimeSchema.optional(),
  })
  .refine((p) => p.compareAtPrice === undefined || p.compareAtPrice > p.price, {
    error: "Старая цена должна быть больше текущей — иначе это не скидка",
    path: ["compareAtPrice"],
  });
export type Product = z.output<typeof ProductSchema>;

// ───────────── Каталог целиком ─────────────

export const CatalogSchema = z
  .strictObject({
    $schema: z.string().optional(),
    version: z.literal(CATALOG_FORMAT_VERSION),
    settings: SettingsSchema,
    attributes: z.array(AttributeDefinitionSchema).default([]),
    categories: z.array(CategorySchema).default([]),
    products: z.array(ProductSchema).default([]),
  })
  .meta({ title: "Каталог Universal TG Store", description: "Формат импорта/экспорта каталога" });

export type Catalog = z.output<typeof CatalogSchema>;
export type CatalogInput = z.input<typeof CatalogSchema>;

/** Сколько штук можно положить в корзину: min(лимит из настроек, остаток). */
export function maxQtyFor(
  product: Pick<Product, "stock">,
  settings: {
    features: Pick<Features, "stock">;
    checkout: Pick<Settings["checkout"], "maxQtyPerItem">;
  },
): number {
  const limit = settings.checkout.maxQtyPerItem;
  if (!settings.features.stock || product.stock === null) return limit;
  return Math.min(limit, product.stock);
}

export function isSoldOut(
  product: Pick<Product, "stock">,
  features: Pick<Features, "stock">,
): boolean {
  return features.stock && product.stock === 0;
}
