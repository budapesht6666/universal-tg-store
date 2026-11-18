import { type AttributeDefinition, formatMoney, inStock, portionsText } from "@store/schema";
import { useQuery } from "@tanstack/react-query";
import { api, type Product, type ShopData } from "./api.ts";
import { useCart } from "./cart.ts";

export function useShop() {
  return useQuery({ queryKey: ["shop"], queryFn: api.shop, refetchInterval: 60_000 });
}

/** Данные магазина, когда он настроен (экраны рендерятся только после загрузки). */
export function useReadyShop(): ShopData {
  const { data } = useShop();
  if (!data?.ready) throw new Error("Магазин не загружен");
  return data;
}

export function useMoney() {
  const { region } = useReadyShop();
  return (minor: number) => formatMoney(minor, region.currency, region.locale);
}

/**
 * Значение характеристики текстом: список — через запятую, «да» — название характеристики,
 * «нет» — пустая строка (не показываем), с единицей измерения, если она есть.
 */
export function attributeText(def: AttributeDefinition, value: unknown): string {
  const text = Array.isArray(value)
    ? value.join(", ")
    : typeof value === "boolean"
      ? value
        ? def.label
        : ""
      : String(value);
  return text && "unit" in def && def.unit ? `${text} ${def.unit}` : text;
}

export type CartLine = { product: Product; qty: number };

/**
 * Корзина, сверенная с актуальным меню: блюда, которых больше нет, не показываем.
 * soldOut — закончились совсем, short — в корзине больше, чем осталось порций.
 */
export function useCartLines() {
  const shop = useReadyShop();
  const items = useCart((s) => s.items);
  const byId = new Map(shop.catalog.products.map((p) => [p.id, p]));
  const lines: CartLine[] = [];
  for (const [id, qty] of Object.entries(items)) {
    const product = byId.get(id);
    if (product) lines.push({ product, qty });
  }
  const available = lines.filter((l) => inStock(l.product));
  return {
    lines,
    count: available.reduce((n, l) => n + l.qty, 0),
    total: available.reduce((sum, l) => sum + l.product.price * l.qty, 0),
    soldOut: lines.filter((l) => !inStock(l.product)),
    short: available.filter((l) => isShort(l)),
  };
}

/** В корзине больше порций, чем осталось. */
export function isShort({ product, qty }: CartLine): boolean {
  return product.stock !== null && qty > product.stock;
}

/** «Осталось 1 · у вас 2» — подпись строки, где порций меньше, чем в корзине. */
export function shortText({ product, qty }: CartLine): string {
  return `Осталось ${product.stock ?? 0} · у вас ${qty}`;
}

/** «Борщ»: осталась 1 порция, а у вас 2. */
export function shortMessage({ product, qty }: CartLine): string {
  const n = product.stock ?? 0;
  return `«${product.title}»: ${n % 10 === 1 && n % 100 !== 11 ? "осталась" : "осталось"} ${portionsText(n)}, а у вас ${qty}.`;
}

/** «Открыто до 22:00» / «Закрыто · откроемся завтра в 10:00». */
export function statusText(
  status: ShopData["status"],
  hours?: ShopData["hours"],
): { open: boolean; text: string } {
  const allDay = hours && Object.values(hours).every((d) => d && d.from === d.to);
  if (status.open) {
    return { open: true, text: allDay ? "Открыто круглосуточно" : `Открыто до ${status.closesAt}` };
  }
  const when = status.opensAt ? ` · откроемся ${status.opensAt}` : "";
  return { open: false, text: `${status.reason === "paused" ? "Пауза" : "Закрыто"}${when}` };
}
