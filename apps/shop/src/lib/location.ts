/**
 * Точка доставки на экранах магазина: насколько ей можно верить и как её описать покупателю.
 * Правила — docs/product-decisions.md, «Оформление» и «Проверка заказа».
 */
import { GPS_ACCURACY_WARN_M } from "@store/schema";
import type { DraftLocation } from "./cart.ts";

/** Пин, поставленный мельче этого масштаба (обзор города), — точка примерная. */
export const COARSE_ZOOM = 15;

export const isCoarse = (l: DraftLocation) =>
  l.source === "pin" && l.zoom !== undefined && l.zoom < COARSE_ZOOM;

export const isPoorGps = (l: DraftLocation) =>
  l.source === "gps" && (l.accuracy ?? 0) > GPS_ACCURACY_WARN_M;

/** В заказ — только то, что принимает сервер (DeliveryLocationSchema строгая). */
export function toOrderLocation(l: DraftLocation | null) {
  if (!l) return null;
  return {
    lat: l.lat,
    lng: l.lng,
    source: l.source,
    ...(l.accuracy !== undefined ? { accuracy: l.accuracy } : {}),
  };
}

export const coordsText = (l: DraftLocation) => `${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}`;

const VIA_TEXT = {
  google: "Из ссылки Google Maps",
  apple: "Из ссылки Apple Maps",
  coords: "По координатам",
} as const;

export type PointSummary = {
  tone: "neutral" | "warn";
  icon: "link" | "gps" | "pin" | "last" | "warn";
  title: string;
  lines: string[];
};

/** Строка под картой на экране проверки: откуда точка и можно ли ей верить. */
export function pointSummary(l: DraftLocation): PointSummary {
  if (isCoarse(l)) {
    return {
      tone: "warn",
      icon: "warn",
      title: "Точка примерная",
      lines: ["Курьеру будет трудно вас найти.", "Приблизьте карту и поставьте пин на свой вход"],
    };
  }
  if (isPoorGps(l)) {
    return {
      tone: "warn",
      icon: "warn",
      title: `Неточно: ±${Math.round(l.accuracy ?? 0)} м`,
      lines: ["Курьеру будет трудно вас найти.", "Подвиньте карту, чтобы пин встал на ваш дом"],
    };
  }
  if (l.fromLastOrder) {
    return {
      tone: "neutral",
      icon: "last",
      title: "Как в прошлом заказе",
      lines: ["Переехали? Нажмите «Изменить»"],
    };
  }
  if (l.source === "gps") {
    const acc = l.accuracy ? ` · ±${Math.round(l.accuracy)} м` : "";
    return {
      tone: "neutral",
      icon: "gps",
      title: `Ваше место${acc}`,
      lines: ["По геопозиции Telegram"],
    };
  }
  if (l.source === "link") {
    return {
      tone: "neutral",
      icon: "link",
      title: l.label ?? "Точка из ссылки",
      lines: [l.via ? VIA_TEXT[l.via] : coordsText(l)],
    };
  }
  return { tone: "neutral", icon: "pin", title: "Точка на карте", lines: [coordsText(l)] };
}
