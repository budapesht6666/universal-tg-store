/**
 * Формы админки: категория, блюдо, быстрые переключатели, порядок, настройки.
 * Те же схемы проверяют запросы на сервере.
 */
import {
  CategorySchema,
  checkCompareAtPrice,
  IdSchema,
  ProductBaseSchema,
  StockSchema,
} from "./catalog.ts";
import { DeliveryZoneSchema } from "./delivery.ts";
import { type AttributeDefinition, buildZodSchema } from "./fields.ts";
import { WeekHoursSchema } from "./hours.ts";
import { FeaturesSchema, OrderSettingsSchema, ShopInfoSchema } from "./settings.ts";
import { z } from "./zod.ts";

const RU = "абвгдеёжзийклмнопрстуфхцчшщъыьэюя";
const LAT = "a,b,v,g,d,e,e,zh,z,i,y,k,l,m,n,o,p,r,s,t,u,f,h,ts,ch,sh,sch,,y,,e,yu,ya".split(",");
const TRANSLIT = new Map([...RU].map((ch, i) => [ch, LAT[i] ?? ""]));

/**
 * id из названия: «Борщ с говядиной» → borsch-s-govyadinoy. Латиница, цифры и дефис,
 * до 48 символов. Пустая строка, если в названии нет ни букв, ни цифр.
 */
export function slugify(title: string): string {
  // Сначала транслит, потом снятие диакритики: NFKD разложил бы «й» на «и» + знак.
  return [...title.toLowerCase()]
    .map((ch) => TRANSLIT.get(ch) ?? ch)
    .join("")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
}

export const CategoryInputSchema = CategorySchema.pick({ title: true }).extend({
  sort: z.int().optional(),
});
export type CategoryInput = z.output<typeof CategoryInputSchema>;

/** Новый порядок: id в нужной последовательности (перетаскивание в списке). */
export const ReorderSchema = z.strictObject({
  ids: z
    .array(IdSchema)
    .min(1)
    .max(1000)
    .refine((ids) => new Set(ids).size === ids.length, { error: "id повторяется" }),
});

/**
 * Форма блюда. Характеристики проверяются по их описаниям из меню, поэтому схема строится
 * от списка характеристик. id можно не указывать: сервер возьмёт его из названия.
 * stock не передан — остаток не меняется: пока форма была открыта, заказы могли его списать.
 */
export function productInputSchema(attributes: readonly AttributeDefinition[]) {
  return ProductBaseSchema.omit({ id: true, createdAt: true, updatedAt: true })
    .extend({
      id: IdSchema.optional(),
      stock: StockSchema.optional(),
      attributes: buildZodSchema(attributes).prefault({}),
    })
    .superRefine(checkCompareAtPrice);
}
export type ProductInput = z.output<ReturnType<typeof productInputSchema>>;

/** Быстрые переключатели в списке: «Есть / Закончилось» и «Скрыто». */
export const ProductPatchSchema = z
  .strictObject({ available: z.boolean().optional(), isActive: z.boolean().optional() })
  .refine((v) => v.available !== undefined || v.isActive !== undefined, {
    error: "Нечего менять",
  });

/** Настройки из админки. Регион не меняется — его сервер берёт из сохранённых настроек. */
export const SettingsUpdateSchema = z.strictObject({
  shop: ShopInfoSchema,
  hours: WeekHoursSchema.prefault({}),
  features: FeaturesSchema.prefault({}),
  orders: OrderSettingsSchema.prefault({}),
  delivery: DeliveryZoneSchema.prefault({}),
});
export type SettingsUpdate = z.input<typeof SettingsUpdateSchema>;
