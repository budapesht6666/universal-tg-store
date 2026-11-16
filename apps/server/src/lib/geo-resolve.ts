/**
 * Ссылки без координат: короткие maps.app.goo.gl и maps.apple/p/…, страница места Apple
 * (maps.apple.com/place?place-id=…). Идём по перенаправлениям сами; у Apple координаты и
 * название — в мета-тегах страницы места (place:location:latitude, og:title).
 * Только https и только домены Google и Apple Maps (isAllowedMapsRedirectHost): ссылка от
 * покупателя не должна заставить сервер ходить по произвольным адресам (SSRF). Не больше
 * 5 переходов, на каждый — таймаут, страницу читаем не дальше 256 КБ.
 */
import {
  type GeoPoint,
  GeoPointSchema,
  isAllowedMapsRedirectHost,
  isAppleMapsUrl,
  parseLocationText,
} from "@store/schema";

const MAX_HOPS = 5;
const HOP_TIMEOUT_MS = 4000;
const MAX_PAGE_BYTES = 256 * 1024;

export type ResolvedPlace = { point: GeoPoint; label?: string };

export async function resolveMapsUrl(
  url: string,
  fetchFn: typeof fetch,
): Promise<ResolvedPlace | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (!URL.canParse(current)) return null;
    const u = new URL(current);
    if (u.protocol !== "https:" || !isAllowedMapsRedirectHost(u.hostname)) return null;

    // Страница согласия на cookies (ЕС) — настоящая ссылка в параметре continue.
    if (u.hostname === "consent.google.com") {
      const next = u.searchParams.get("continue");
      if (!next) return null;
      current = next;
      continue;
    }

    const parsed = parseLocationText(current);
    if (parsed.kind === "point") {
      return parsed.label ? { point: parsed.point, label: parsed.label } : { point: parsed.point };
    }
    if (hop === MAX_HOPS) return null;

    let res: Response;
    try {
      res = await fetchFn(current, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(HOP_TIMEOUT_MS),
        headers: { "user-agent": "Mozilla/5.0 (compatible; store-bot)" },
      });
    } catch {
      return null;
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      current = new URL(location, current).toString();
      continue;
    }
    if (res.status === 200 && isAppleMapsUrl(current)) {
      try {
        return applePlaceFromHtml(await readLimited(res, MAX_PAGE_BYTES));
      } catch {
        return null;
      }
    }
    await res.body?.cancel();
    return null;
  }
  return null;
}

/** Страница места Apple Maps: координаты и название — в мета-тегах в начале страницы. */
export function applePlaceFromHtml(html: string): ResolvedPlace | null {
  const meta = (name: string) =>
    html.match(new RegExp(`<meta[^>]+property="${name}"[^>]+content="([^"]*)"`))?.[1];
  const p = GeoPointSchema.safeParse({
    lat: Number(meta("place:location:latitude") ?? Number.NaN),
    lng: Number(meta("place:location:longitude") ?? Number.NaN),
  });
  if (!p.success) return null;
  const label = decodeEntities(meta("og:title") ?? "").trim();
  return label && label.length <= 120 ? { point: p.data, label } : { point: p.data };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function readLimited(res: Response, limit: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel();
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, limit));
}
