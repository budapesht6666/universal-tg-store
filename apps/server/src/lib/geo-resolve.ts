/**
 * Короткие ссылки maps.app.goo.gl координат не содержат — идём по перенаправлениям сами.
 * Только https и только домены Google (isAllowedMapsRedirectHost): ссылка от покупателя
 * не должна заставить сервер ходить по произвольным адресам (SSRF). Не больше 5 переходов,
 * на каждый — таймаут.
 */
import { type GeoPoint, isAllowedMapsRedirectHost, parseLocationText } from "@store/schema";

const MAX_HOPS = 5;
const HOP_TIMEOUT_MS = 4000;

export async function resolveMapsUrl(url: string, fetchFn: typeof fetch): Promise<GeoPoint | null> {
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
    if (parsed.kind === "point") return parsed.point;
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
    await res.body?.cancel();
    if (res.status < 300 || res.status >= 400 || !location) return null;
    current = new URL(location, current).toString();
  }
  return null;
}
