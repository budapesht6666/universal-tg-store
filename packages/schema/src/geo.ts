/**
 * Точка доставки. Покупатель ставит пин на карте (по центру карты, карту двигают под ним),
 * жмёт «Я сейчас здесь» (геопозиция Telegram LocationManager, с погрешностью) или вставляет
 * ссылку / координаты. В заказ попадают координаты итоговой точки — курьер получает ссылку
 * на Google Maps, собранную из них.
 */
import { z } from "./zod.ts";

export const LOCATION_SOURCES = ["pin", "gps", "link"] as const;

/** При такой погрешности геопозиции (м) просим подвинуть карту и уточнить точку. */
export const GPS_ACCURACY_WARN_M = 50;

export const GeoPointSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export type GeoPoint = z.output<typeof GeoPointSchema>;

export const DeliveryLocationSchema = z.strictObject(
  {
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    /** Погрешность геопозиции в метрах (horizontal_accuracy), если точка из GPS. */
    accuracy: z.number().min(0).max(100_000).optional(),
    source: z.enum(LOCATION_SOURCES).default("pin"),
  },
  { error: "Поставьте точку на карте — так курьер быстрее вас найдёт" },
);
export type DeliveryLocation = z.output<typeof DeliveryLocationSchema>;

/** Ссылка для курьера: открывается в Google Maps на телефоне. */
export function mapsUrlFromCoords(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

const GOOGLE_HOST = /^(www\.|maps\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/;
const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl"]);
/** maps.apple/p/… — короткая ссылка из «Поделиться» в Apple Maps, maps.apple.com — полная. */
const APPLE_HOSTS = new Set(["maps.apple", "maps.apple.com"]);

function parseUrl(value: string): URL | null {
  if (!URL.canParse(value)) return null;
  const url = new URL(value);
  return url.protocol === "https:" || url.protocol === "http:" ? url : null;
}

/** Короткая ссылка Google Maps — координат в ней нет, сервер раскрывает перенаправление. */
export function isShortMapsUrl(value: string): boolean {
  const url = parseUrl(value);
  if (!url) return false;
  const host = url.hostname.toLowerCase();
  if (host === "maps.app.goo.gl") return url.pathname.length > 1;
  return host === "goo.gl" && url.pathname.startsWith("/maps");
}

/** Ссылка ведёт на Google Maps: короткая maps.app.goo.gl или google.com/maps, maps.google.com. */
export function isGoogleMapsUrl(value: string): boolean {
  const url = parseUrl(value);
  if (!url) return false;
  if (isShortMapsUrl(value)) return true;
  const host = url.hostname.toLowerCase();
  if (!GOOGLE_HOST.test(host)) return false;
  return host.startsWith("maps.") || url.pathname.startsWith("/maps");
}

/** Ссылка Apple Maps: короткая maps.apple/p/… или maps.apple.com. */
export function isAppleMapsUrl(value: string): boolean {
  const url = parseUrl(value);
  return !!url && APPLE_HOSTS.has(url.hostname.toLowerCase());
}

/**
 * Куда серверу можно идти, раскрывая ссылку: только домены Google и Apple Maps.
 * Иначе ссылка от покупателя заставила бы сервер ходить по произвольным адресам (SSRF).
 */
export function isAllowedMapsRedirectHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    SHORT_HOSTS.has(host) ||
    GOOGLE_HOST.test(host) ||
    host === "consent.google.com" ||
    APPLE_HOSTS.has(host)
  );
}

const NUM = String.raw`-?\d{1,3}\.\d+`;
const COORDS_IN_URL = [
  // !3d<lat>!4d<lng> — точка выбранного места, точнее всего
  new RegExp(`!3d(${NUM})!4d(${NUM})`),
  // ?q=<lat>,<lng>, query=, ll=, destination=; у Apple — coordinate=, ll=, sll=, center=
  new RegExp(
    String.raw`[?&](?:q|query|ll|destination|daddr|coordinate|sll|center)=(${NUM}),\s?(${NUM})`,
  ),
  // /@<lat>,<lng>,17z — центр карты
  new RegExp(`@(${NUM}),(${NUM})`),
];
const PLAIN_COORDS = new RegExp(String.raw`(?:^|[^\d.])(${NUM})\s*[,;\s]\s*(${NUM})(?![\d.])`);

function point(lat: string | undefined, lng: string | undefined): GeoPoint | null {
  const p = GeoPointSchema.safeParse({ lat: Number(lat), lng: Number(lng) });
  return p.success ? p.data : null;
}

/** Откуда точка: из ссылки Google Maps, Apple Maps или просто координаты. */
export type LocationVia = "google" | "apple" | "coords";

export type LocationTextResult =
  /** label — название места, если оно есть в ссылке («Con Market»). */
  | { kind: "point"; point: GeoPoint; via: LocationVia; label?: string }
  /** Короткая ссылка или страница места: координаты узнает сервер (GET /api/geo/resolve). */
  | { kind: "resolve"; url: string; via: "google" | "apple" }
  | { kind: "invalid"; message: string };

/** Названия, которые карты ставят точке без имени, — показывать их покупателю незачем. */
const GENERIC_PLACE = /^(dropped pin|marked location|my location|метка|выбранное место)$/i;

function cleanLabel(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  let text: string;
  try {
    text = decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    text = raw;
  }
  text = text.replace(/\s+/g, " ").trim();
  if (!text || text.length > 120 || GENERIC_PLACE.test(text) || PLAIN_COORDS.test(text)) {
    return undefined;
  }
  return text;
}

/** Название места из ссылки: google.com/maps/place/<имя>/…, у Apple — ?name= или ?q=. */
function labelFromUrl(link: string, via: "google" | "apple"): string | undefined {
  const url = parseUrl(link);
  if (!url) return undefined;
  if (via === "google") return cleanLabel(url.pathname.match(/\/maps\/place\/([^/@]+)/)?.[1]);
  return cleanLabel(url.searchParams.get("name")) ?? cleanLabel(url.searchParams.get("q"));
}

function coordsInUrl(link: string): GeoPoint | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(link);
  } catch {
    decoded = link;
  }
  for (const re of COORDS_IN_URL) {
    const m = decoded.match(re);
    const p = m && point(m[1], m[2]);
    if (p) return p;
  }
  return null;
}

/**
 * Разбирает то, что покупатель вставил в поле: ссылку Google Maps или Apple Maps (в том числе
 * внутри текста из «Поделиться»), короткую ссылку maps.app.goo.gl / maps.apple/p/… или просто
 * координаты «15.8801, 108.3380» (так их копируют из Zalo, Grab и самих карт).
 */
export function parseLocationText(text: string): LocationTextResult {
  const value = text.trim();
  const link = value.match(/https?:\/\/\S+/)?.[0];
  if (link) {
    if (isShortMapsUrl(link)) return { kind: "resolve", url: link, via: "google" };
    const via = isGoogleMapsUrl(link) ? "google" : isAppleMapsUrl(link) ? "apple" : null;
    if (via) {
      const p = coordsInUrl(link);
      if (p) {
        const label = labelFromUrl(link, via);
        return label ? { kind: "point", point: p, via, label } : { kind: "point", point: p, via };
      }
      // Apple: короткая maps.apple/p/… и страница места ?place-id=… — координаты знает сервер.
      if (via === "apple" && (parseUrl(link)?.pathname.length ?? 0) > 1) {
        return { kind: "resolve", url: link, via };
      }
    }
  }
  const m = value.match(PLAIN_COORDS);
  const p = m && point(m[1], m[2]);
  if (p) return { kind: "point", point: p, via: "coords" };
  return {
    kind: "invalid",
    message: link
      ? "Не нашли точку в ссылке. Откройте карты, выберите место, «Поделиться» → «Копировать»"
      : "Вставьте ссылку из Google Maps или Apple Maps или координаты, например 15.8801, 108.3380",
  };
}
