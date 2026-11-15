/**
 * Настройки магазина. Хранятся в БД, первый раз задаются мастером настройки при установке,
 * потом меняются в админке. Регион (валюта, часовой пояс, код страны) после настройки
 * не меняется: смена валюты молча переоценила бы все цены (65000 ₫ ≠ 65000 копеек).
 */
import { ImageRefSchema } from "./fields.ts";
import { WeekHoursSchema } from "./hours.ts";
import { telegramUsernameSchema } from "./telegram.ts";
import { z } from "./zod.ts";

export const REGIONS = {
  VN: { label: "Вьетнам", currency: "VND", timeZone: "Asia/Ho_Chi_Minh", phoneCode: "84" },
  TH: { label: "Таиланд", currency: "THB", timeZone: "Asia/Bangkok", phoneCode: "66" },
  ID: { label: "Индонезия", currency: "IDR", timeZone: "Asia/Makassar", phoneCode: "62" },
  RU: { label: "Россия", currency: "RUB", timeZone: "Europe/Moscow", phoneCode: "7" },
} as const;
export type RegionCode = keyof typeof REGIONS;
export const RegionCodeSchema = z.enum(Object.keys(REGIONS) as [RegionCode, ...RegionCode[]]);

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export const RegionSchema = z.strictObject({
  country: RegionCodeSchema.default("VN"),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, { error: "Код валюты ISO 4217 из трёх заглавных букв, например VND" })
    .default("VND"),
  timeZone: z
    .string()
    .default("Asia/Ho_Chi_Minh")
    // Не Intl.supportedValuesOf: там ICU-имена (Asia/Saigon), и Asia/Ho_Chi_Minh не найдётся.
    .refine(isValidTimeZone, { error: "Неизвестный часовой пояс, пример: Asia/Ho_Chi_Minh" }),
  phoneCode: z
    .string()
    .regex(/^\d{1,3}$/, { error: "Код страны без плюса, например 84" })
    .default("84"),
  /** Формат чисел и дат. Интерфейс пока только на русском. */
  locale: z.string().default("ru-RU"),
});
export type Region = z.output<typeof RegionSchema>;

/** Регион из пресета страны — для мастера настройки. */
export function regionFor(country: RegionCode): Region {
  const { label: _label, ...rest } = REGIONS[country];
  return { country, ...rest, locale: "ru-RU" };
}

export const ShopInfoSchema = z.strictObject({
  name: z.string().trim().min(1, { error: "Как называется магазин?" }).max(64),
  /** Телефона магазина нет намеренно: покупателю показываем только Telegram менеджера. */
  manager: telegramUsernameSchema.meta({
    description: "Telegram менеджера (без @) — покупатель напишет или позвонит по вопросам",
  }),
  logo: ImageRefSchema.optional().meta({
    description: "Логотип в шапке магазина — квадрат, обычно тот же, что аватар бота",
  }),
  greeting: z
    .string()
    .trim()
    .max(1000)
    .default(
      [
        "Привет! Здесь можно заказать еду с доставкой.",
        "",
        "Как заказать:",
        "1. Нажмите «Меню» и выберите блюда.",
        "2. Укажите адрес и телефон. Оплата курьеру при получении.",
        "3. Статус заказа придёт сюда, в этот чат.",
        "",
        "Вопрос по заказу? Напишите сюда — ответит менеджер.",
      ].join("\n"),
    )
    .meta({ description: "Ответ бота на /start, под ним кнопка «Меню»" }),
  botAbout: z
    .string()
    .trim()
    .max(120)
    .default("Еда с доставкой: меню, заказ и статус доставки — прямо в Telegram.")
    .meta({ description: "«О себе» в профиле бота и в превью ссылки на бота" }),
  botDescription: z
    .string()
    .trim()
    .max(512)
    .default(
      [
        "Закажите еду с доставкой прямо в Telegram.",
        "",
        "• Меню с фото и ценами",
        "• Заказ в пару нажатий, без регистрации",
        "• Оплата курьеру при получении",
        "• Статус заказа приходит в этот чат",
        "",
        "Нажмите кнопку внизу, чтобы начать.",
      ].join("\n"),
    )
    .meta({ description: "Текст в пустом чате с ботом, до первого /start" }),
});

export const FeaturesSchema = z
  .strictObject({
    discounts: z.boolean().default(true),
    badges: z.boolean().default(true),
    reviews: z
      .boolean()
      .default(true)
      .meta({ description: "Оценка (1–5 звёзд) и отзыв покупателя после доставки" }),
  })
  .meta({ description: "Фичи магазина: выключенная пропадает из магазина, данные остаются" });
export type Features = z.output<typeof FeaturesSchema>;
export type FeatureKey = keyof Features;

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  discounts: "Старая цена и скидка",
  badges: "Метки на блюдах",
  reviews: "Оценка и отзыв после доставки",
};

export const FEATURE_HINTS: Record<FeatureKey, string> = {
  discounts: "Зачёркнутая цена и «−15%» на карточке",
  badges: "«Хит», «Острое 🌶», «Вег»",
  reviews: "Покупатель ставит звёзды и пишет отзыв, когда заказ доставлен",
};

export const OrderSettingsSchema = z.strictObject({
  customerCanCancel: z
    .boolean()
    .default(true)
    .meta({ description: "Покупатель может сам отменить заказ, пока он в статусе «Оформлен»" }),
});

export const SettingsSchema = z.strictObject({
  region: RegionSchema.prefault({}),
  shop: ShopInfoSchema,
  hours: WeekHoursSchema.prefault({}),
  features: FeaturesSchema.prefault({}),
  orders: OrderSettingsSchema.prefault({}),
});
export type Settings = z.output<typeof SettingsSchema>;
export type SettingsInput = z.input<typeof SettingsSchema>;

/**
 * Мастер первой настройки: страна, название, Telegram менеджера, часы работы и меню (демо или пустое).
 * Всё остальное — значения по умолчанию, их можно поменять потом в админке.
 */
export const SetupInputSchema = z.strictObject({
  country: RegionCodeSchema.default("VN"),
  shop: ShopInfoSchema,
  hours: WeekHoursSchema.prefault({}),
  menu: z.enum(["demo", "empty"]).default("demo"),
});
export type SetupInput = z.input<typeof SetupInputSchema>;

export function settingsFromSetup(input: z.output<typeof SetupInputSchema>) {
  return SettingsSchema.safeParse({
    region: regionFor(input.country),
    shop: input.shop,
    hours: input.hours,
  });
}
