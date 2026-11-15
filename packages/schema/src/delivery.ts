/**
 * Зона доставки — несколько кругов (центр и радиус). Заказ с точкой вне всех кругов не оформить:
 * покупатель видит это на карте, сервер проверяет тоже. Круги, а не многоугольник: владелец
 * сам двигает их в админке. Расстояние — по прямой, не по дорогам.
 */
import type { GeoPoint } from "./geo.ts";
import { z } from "./zod.ts";

export const DELIVERY_CIRCLES_MAX = 20;
export const DELIVERY_RADIUS_MIN_KM = 0.3;
export const DELIVERY_RADIUS_MAX_KM = 100;

export const DeliveryCircleSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, { error: "Как назвать круг? Например, Дананг" })
    .max(40, { error: "Название круга — до 40 символов" }),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusKm: z
    .number({ error: "Радиус в километрах, например 12" })
    .min(DELIVERY_RADIUS_MIN_KM, { error: "Радиус — от 0,3 км" })
    .max(DELIVERY_RADIUS_MAX_KM, { error: "Радиус — до 100 км" }),
});
export type DeliveryCircle = z.output<typeof DeliveryCircleSchema>;

export const DeliveryZoneSchema = z
  .strictObject({
    enabled: z
      .boolean()
      .default(false)
      .meta({ description: "Принимать заказы только с точкой внутри кругов" }),
    label: z
      .string()
      .trim()
      .max(60, { error: "Название зоны — до 60 символов" })
      .default("")
      .meta({ description: "Как называть зону покупателям: «Доставка: Дананг и Хойан»" }),
    circles: z
      .array(DeliveryCircleSchema)
      .max(DELIVERY_CIRCLES_MAX, { error: `Не больше ${DELIVERY_CIRCLES_MAX} кругов` })
      .default([]),
  })
  .refine((zone) => !zone.enabled || zone.circles.length > 0, {
    error: "Добавьте хотя бы один круг — или выключите зону",
    path: ["circles"],
  });
export type DeliveryZone = z.output<typeof DeliveryZoneSchema>;

const EARTH_RADIUS_KM = 6371;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Расстояние между точками по прямой (гаверсинус), км. */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Доставляем ли в эту точку. Зона выключена — доставляем везде. */
export function inDeliveryZone(zone: DeliveryZone, point: GeoPoint): boolean {
  if (!zone.enabled) return true;
  return zone.circles.some((c) => distanceKm(c, point) <= c.radiusKm);
}

/** Строка для покупателя: «Доставка: Дананг и Хойан». null — зона выключена или без названия. */
export function deliveryAreaLine(zone: DeliveryZone): string | null {
  return zone.enabled && zone.label ? `Доставка: ${zone.label}` : null;
}

/** Почему заказ сюда не оформить. */
export function outsideZoneMessage(zone: DeliveryZone): string {
  return zone.label
    ? `Сюда не доставляем — только ${zone.label}. Подвиньте точку в зону`
    : "Сюда не доставляем — точка вне зоны доставки. Подвиньте её";
}
