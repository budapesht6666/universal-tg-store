/**
 * Формат меню: характеристики, категории, блюда (товары). Это же — формат импорта/экспорта JSON
 * и демо-меню для первого запуска. Настройки магазина сюда не входят — они в settings.ts.
 * Описание для людей — docs/catalog-format.md.
 */
import { AttributeDefinitionSchema, ImageRefSchema } from "./fields.ts";
import { MoneySchema } from "./money.ts";
import { z } from "./zod.ts";

/** Текущая версия формата. При изменении формата — новая версия и миграция в parse.ts. */
export const CATALOG_FORMAT_VERSION = 2;

export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const IdSchema = z.string().max(64).regex(ID_PATTERN, {
  error: "id — латиница в нижнем регистре, цифры и дефис, например borscht",
});

/** Сколько фото может быть у блюда. */
export const MAX_PRODUCT_IMAGES = 5;

/** Сколько порций одного блюда можно положить в корзину. */
export const MAX_QTY_PER_ITEM = 50;

export const CategorySchema = z.strictObject({
  id: IdSchema,
  title: z.string().trim().min(1).max(60),
  sort: z.int().default(0).meta({ description: "Порядок в меню, по возрастанию" }),
});
export type Category = z.output<typeof CategorySchema>;

const DateTimeSchema = z.iso.datetime({ offset: true });

/** Поля блюда без межполевых проверок — основа и для формы админки (productInputSchema). */
export const ProductBaseSchema = z.strictObject({
  id: IdSchema,
  title: z.string().trim().min(1).max(120),
  description: z
    .string()
    .trim()
    .max(1000)
    .default("")
    .meta({ description: "Состав и описание, обычный текст" }),
  price: MoneySchema,
  compareAtPrice: MoneySchema.optional().meta({
    description: "Старая цена: показывается зачёркнутой рядом с «−20%»",
  }),
  images: z
    .array(ImageRefSchema)
    .max(MAX_PRODUCT_IMAGES, { error: `Не больше ${MAX_PRODUCT_IMAGES} фото` })
    .default([])
    .meta({
      description: "Фото в порядке показа. Первое — главное: оно в меню и первым на странице блюда",
    }),
  categoryId: IdSchema,
  badges: z
    .array(z.string().trim().min(1).max(24))
    .max(3)
    .default([])
    .meta({ description: "Метки на карточке: «Хит», «Острое 🌶», «Вег»" }),
  available: z
    .boolean()
    .default(true)
    .meta({ description: "false — «Закончилось»: блюдо видно в меню, но заказать нельзя" }),
  isActive: z.boolean().default(true).meta({ description: "false — блюдо скрыто из меню" }),
  sort: z.int().default(0),
  attributes: z
    .record(z.string(), z.unknown())
    .default({})
    .meta({ description: "Значения характеристик: ключ из attributes → значение" }),
  createdAt: DateTimeSchema.optional(),
  updatedAt: DateTimeSchema.optional(),
});

/** Старая цена больше текущей — иначе это не скидка. Общая проверка для меню и формы. */
export function checkCompareAtPrice(
  p: { price: number; compareAtPrice?: number | undefined },
  ctx: z.core.$RefinementCtx,
): void {
  if (p.compareAtPrice !== undefined && p.compareAtPrice <= p.price) {
    ctx.addIssue({
      code: "custom",
      path: ["compareAtPrice"],
      message: "Старая цена должна быть больше текущей — иначе это не скидка",
    });
  }
}

export const ProductSchema = ProductBaseSchema.superRefine(checkCompareAtPrice);
export type Product = z.output<typeof ProductSchema>;

export const CatalogSchema = z
  .strictObject({
    $schema: z.string().optional(),
    version: z.literal(CATALOG_FORMAT_VERSION),
    attributes: z.array(AttributeDefinitionSchema).default([]),
    categories: z.array(CategorySchema).default([]),
    products: z.array(ProductSchema).default([]),
  })
  .meta({ title: "Меню Universal TG Store", description: "Формат импорта/экспорта меню" });

export type Catalog = z.output<typeof CatalogSchema>;
export type CatalogInput = z.input<typeof CatalogSchema>;

/** Можно ли заказать блюдо прямо сейчас (часы работы магазина проверяются отдельно). */
export function canOrderProduct(product: Pick<Product, "isActive" | "available">): boolean {
  return product.isActive && product.available;
}
