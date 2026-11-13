/**
 * FieldDefinition — описание поля без кода: из него строятся проверка значения (на сервере и в
 * админке одна и та же), поле формы в админке и поля оформления заказа в магазине.
 * Пользовательские характеристики товара (attributes) — тоже FieldDefinition.
 */
import { MoneySchema } from "./money.ts";
import { PhoneSchema } from "./phone.ts";
import { z } from "./zod.ts";

export const FIELD_KEY_PATTERN = /^[a-z][a-zA-Z0-9_]{0,39}$/;

export const FieldKeySchema = z.string().regex(FIELD_KEY_PATTERN, {
  error: "Ключ — латиница и цифры, начинается с маленькой буквы, например material или maxWeight",
});

/** Картинка: внешняя ссылка https://… или файл, загруженный через админку (/uploads/…). */
export const ImageUrlSchema = z
  .string()
  .max(2048)
  .refine(
    (v) =>
      (/^https?:\/\//.test(v) && URL.canParse(v)) || /^\/uploads\/[\w.-]+(\/[\w.-]+)*$/.test(v),
    { error: "Нужна ссылка https://… или путь к загруженному файлу /uploads/…" },
  );

export const ImageRefSchema = z.strictObject({
  url: ImageUrlSchema,
  alt: z.string().trim().max(200).optional(),
});
export type ImageRef = z.output<typeof ImageRefSchema>;

const OptionsSchema = z
  .array(z.string().trim().min(1).max(60))
  .min(1, { error: "Нужен хотя бы один вариант" })
  .max(100)
  .refine((list) => new Set(list).size === list.length, {
    error: "Варианты не должны повторяться",
  });

const baseShape = {
  key: FieldKeySchema,
  label: z.string().trim().min(1).max(60),
  hint: z.string().trim().max(200).optional(),
  placeholder: z.string().trim().max(100).optional(),
  required: z.boolean().default(false),
};

/**
 * Проверка «минимум ≤ максимума». Внутри фабрики с дженериком zod не выводит тип объекта
 * для refine, поэтому принимаем object и читаем поля явно.
 */
const rangeCheck = (minKey: string, maxKey: string) => (d: object) => {
  const min = (d as Record<string, unknown>)[minKey];
  const max = (d as Record<string, unknown>)[maxKey];
  return typeof min !== "number" || typeof max !== "number" || min <= max;
};

/**
 * Варианты полей. Фабрика нужна, чтобы характеристики товара (attributes) получили те же типы
 * плюс свои флаги показа, а объекты остались строгими — опечатка в ключе JSON видна сразу.
 */
function fieldVariants<E extends z.core.$ZodLooseShape>(extra: E) {
  const b = { ...baseShape, ...extra };
  return [
    z
      .strictObject({
        ...b,
        type: z.literal("text"),
        minLength: z.int().min(0).optional(),
        maxLength: z.int().min(1).max(10_000).optional(),
      })
      .refine(rangeCheck("minLength", "maxLength"), {
        error: "minLength больше maxLength",
        path: ["minLength"],
      }),
    z.strictObject({
      ...b,
      type: z.literal("textarea"),
      maxLength: z.int().min(1).max(20_000).optional(),
    }),
    z.strictObject({
      ...b,
      type: z.literal("markdown"),
      maxLength: z.int().min(1).max(50_000).optional(),
    }),
    z
      .strictObject({
        ...b,
        type: z.literal("number"),
        min: z.number().optional(),
        max: z.number().optional(),
        integer: z.boolean().default(false),
        unit: z.string().trim().max(16).optional(),
      })
      .refine(rangeCheck("min", "max"), { error: "min больше max", path: ["min"] }),
    z
      .strictObject({
        ...b,
        type: z.literal("money"),
        min: MoneySchema.optional(),
        max: MoneySchema.optional(),
      })
      .refine(rangeCheck("min", "max"), { error: "min больше max", path: ["min"] }),
    z.strictObject({ ...b, type: z.literal("boolean") }),
    z.strictObject({ ...b, type: z.literal("select"), options: OptionsSchema }),
    z.strictObject({
      ...b,
      type: z.literal("multiselect"),
      options: OptionsSchema,
      maxItems: z.int().min(1).optional(),
    }),
    z.strictObject({ ...b, type: z.literal("url") }),
    z.strictObject({ ...b, type: z.literal("image") }),
    z.strictObject({
      ...b,
      type: z.literal("images"),
      maxItems: z.int().min(1).max(50).optional(),
    }),
    z.strictObject({ ...b, type: z.literal("tags"), maxItems: z.int().min(1).max(50).optional() }),
    z.strictObject({ ...b, type: z.literal("date") }),
    z.strictObject({ ...b, type: z.literal("color") }),
    z.strictObject({ ...b, type: z.literal("phone") }),
  ] as const;
}

export const FieldDefinitionSchema = z.discriminatedUnion("type", fieldVariants({}));
export type FieldDefinition = z.output<typeof FieldDefinitionSchema>;
export type FieldDefinitionInput = z.input<typeof FieldDefinitionSchema>;
export type FieldType = FieldDefinition["type"];

/** Характеристика товара: поле + где её показывать. */
export const AttributeDefinitionSchema = z.discriminatedUnion(
  "type",
  fieldVariants({
    showInCard: z
      .boolean()
      .default(false)
      .meta({ description: "Показывать в карточке каталога (в списке товаров)" }),
    showInSpecs: z
      .boolean()
      .default(true)
      .meta({ description: "Показывать в блоке «Характеристики» на странице товара" }),
  }),
);
export type AttributeDefinition = z.output<typeof AttributeDefinitionSchema>;

export const FIELD_TYPES = [
  "text",
  "textarea",
  "markdown",
  "number",
  "money",
  "boolean",
  "select",
  "multiselect",
  "url",
  "image",
  "images",
  "tags",
  "date",
  "color",
  "phone",
] as const satisfies readonly FieldType[];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Текст",
  textarea: "Длинный текст",
  markdown: "Текст с разметкой",
  number: "Число",
  money: "Цена",
  boolean: "Да / нет",
  select: "Выбор из списка",
  multiselect: "Несколько из списка",
  url: "Ссылка",
  image: "Картинка",
  images: "Галерея",
  tags: "Метки",
  date: "Дата",
  color: "Цвет",
  phone: "Телефон",
};

function assertNever(value: never): never {
  throw new Error(`Неизвестный тип поля: ${JSON.stringify(value)}`);
}

/** Пустые значения из форм ("", null) считаем «не заполнено». */
const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

function asEnum(options: readonly string[]) {
  return z.enum(options as [string, ...string[]], {
    error: `Выберите один из вариантов: ${options.join(", ")}`,
  });
}

function baseValueSchema(def: FieldDefinition): z.ZodType {
  switch (def.type) {
    case "text": {
      let s = z.string().trim();
      if (def.minLength !== undefined) s = s.min(def.minLength);
      s = s.max(def.maxLength ?? 500);
      return s;
    }
    case "textarea":
      return z
        .string()
        .trim()
        .max(def.maxLength ?? 5000);
    case "markdown":
      return z
        .string()
        .trim()
        .max(def.maxLength ?? 20_000);
    case "number": {
      let s = def.integer ? z.int() : z.number();
      if (def.min !== undefined) s = s.min(def.min);
      if (def.max !== undefined) s = s.max(def.max);
      return s;
    }
    case "money": {
      let s = MoneySchema;
      if (def.min !== undefined) s = s.min(def.min);
      if (def.max !== undefined) s = s.max(def.max);
      return s;
    }
    case "boolean":
      return z.boolean();
    case "select":
      return asEnum(def.options);
    case "multiselect": {
      let s = z.array(asEnum(def.options));
      if (def.maxItems !== undefined) s = s.max(def.maxItems);
      return s.refine((list) => new Set(list).size === list.length, {
        error: "Варианты не должны повторяться",
      });
    }
    case "url":
      return z.url({ protocol: /^https?$/, error: "Нужна ссылка вида https://…" });
    case "image":
      return ImageRefSchema;
    case "images":
      return z.array(ImageRefSchema).max(def.maxItems ?? 20);
    case "tags":
      return z.array(z.string().trim().min(1).max(40)).max(def.maxItems ?? 20);
    case "date":
      return z.iso.date();
    case "color":
      return z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, { error: "Цвет в формате #RRGGBB, например #1F73D6" });
    case "phone":
      return PhoneSchema;
    default:
      return assertNever(def);
  }
}

/** Схема значения одного поля с учётом required. */
export function fieldValueSchema(def: FieldDefinition): z.ZodType {
  let schema = baseValueSchema(def);
  if (def.required && def.type === "phone") {
    // Пустой телефон — не «обязательное поле», а объяснение, зачем он нужен.
    return z.preprocess((v) => v ?? "", schema);
  }
  if (def.required) {
    if (def.type === "multiselect" || def.type === "images" || def.type === "tags") {
      schema = (schema as z.ZodArray<z.ZodType>).min(1, {
        error: "Выберите хотя бы одно значение",
      });
    }
    if (def.type === "text" || def.type === "textarea" || def.type === "markdown") {
      schema = (schema as z.ZodString).min(1, { error: "Обязательное поле" });
    }
    return z.preprocess(emptyToUndefined, schema);
  }
  return z.preprocess(emptyToUndefined, schema.optional());
}

/**
 * Валидатор объекта по списку полей — один и тот же на сервере и в админке (RHF + zodResolver).
 * Неизвестные ключи — ошибка: так не потеряются данные из-за опечатки.
 */
export function buildZodSchema(defs: readonly FieldDefinition[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const def of defs) shape[def.key] = fieldValueSchema(def);
  return z.strictObject(shape);
}
