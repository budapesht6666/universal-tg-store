/**
 * Оформление — одна страница: точка на карте, дом/этаж, имя и телефон, комментарий.
 * Проверка — той же схемой, что на сервере (createOrderInputSchema). Заказ отсюда не уходит:
 * «Проверить заказ» ведёт на экран проверки (ConfirmScreen), отправка — там.
 */
import {
  createOrderInputSchema,
  type DeliveryZone,
  inDeliveryZone,
  inStock,
  normalizePhone,
  parseLocationText,
  telegramLink,
} from "@store/schema";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, Check, Link2, Navigation, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MapPicker } from "../components/MapPicker.tsx";
import { BottomBar, FieldError, PrimaryButton, Screen, Section } from "../components/ui.tsx";
import { api, type ShopData } from "../lib/api.ts";
import { type DraftLocation, useCart } from "../lib/cart.ts";
import { coordsText, isCoarse, isPoorGps, toOrderLocation } from "../lib/location.ts";
import { useCartLines, useReadyShop } from "../lib/shop.ts";
import {
  canLocate,
  haptic,
  openLocationSettings,
  openTelegramChat,
  requestGps,
} from "../lib/telegram.ts";
import { ClosedNotice } from "./CartScreen.tsx";

type Errors = Record<string, string>;
type Issue = { path: string; message: string };

/** Тело заказа из корзины и черновика — одно для проверки на оформлении и отправки. */
export function useOrderBody() {
  const { lines } = useCartLines();
  const draft = useCart((s) => s.draft);
  return {
    items: lines
      .filter((l) => inStock(l.product))
      .map((l) => ({ productId: l.product.id, qty: l.qty })),
    customer: {
      name: draft.name,
      phone: draft.phone,
      location: toOrderLocation(draft.location),
      address: draft.address,
      comment: draft.comment,
    },
  };
}

/** Та же схема, что на сервере: пусто — можно отправлять. */
export function orderIssues(shop: ShopData, body: ReturnType<typeof useOrderBody>): Issue[] {
  const parsed = createOrderInputSchema(shop).safeParse(body);
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

const FIELD_KEYS = ["name", "phone", "location", "address", "comment"];

/** Ошибки по полям формы: customer.phone → phone. */
export function fieldErrors(issues: Issue[]): Errors {
  const byField: Errors = {};
  for (const i of issues) {
    const key = i.path.replace(/^customer\./, "");
    if (FIELD_KEYS.includes(key.split(".")[0] ?? "")) byField[key] ??= i.message;
  }
  return byField;
}

export function CheckoutScreen() {
  const shop = useReadyShop();
  const navigate = useNavigate();
  const { count } = useCartLines();
  const draft = useCart((s) => s.draft);
  const setDraft = useCart((s) => s.setDraft);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [linkState, setLinkState] = useState<LinkState>("idle");
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const body = useOrderBody();

  // Второй заказ — одним нажатием: подставляем данные прошлого заказа или имя из Telegram.
  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !me.data) return;
    prefilled.current = true;
    const last = me.data.lastDetails;
    setDraft({
      name: draft.name || last?.name || me.data.user.firstName,
      phone: draft.phone || last?.phone || "",
      address: draft.address || last?.address || "",
      location:
        draft.location ?? (last ? { ...last.location, source: "pin", fromLastOrder: true } : null),
    });
  }, [me.data, draft, setDraft]);

  const review = () => {
    setFormError(null);
    const issues = orderIssues(shop, body);
    if (issues.length === 0) {
      setErrors({});
      haptic.tap();
      navigate({ to: "/checkout/confirm" });
      return;
    }
    haptic.error();
    const byField = fieldErrors(issues);
    setErrors(byField);
    if (Object.keys(byField).length === 0) setFormError(issues[0]?.message ?? "Проверьте поля");
    requestAnimationFrame(() =>
      document
        .querySelector("[data-error='true']")
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  };

  const zone = shop.delivery;
  const outside = !!draft.location && !inDeliveryZone(zone, draft.location);

  if (count === 0) {
    return (
      <Screen>
        <div className="flex flex-1 items-center justify-center p-8 text-hint">Корзина пуста</div>
      </Screen>
    );
  }

  return (
    <Screen>
      <form
        className="flex flex-col gap-5 p-4 pb-40"
        onSubmit={(e) => {
          e.preventDefault();
          review();
        }}
      >
        <ClosedNotice />
        <Section
          title="Куда привезти"
          hint={[
            "Курьер приедет туда, где стоит пин. Поставьте его на свой вход.",
            zone.label ? `Доставляем: ${zone.label}.` : null,
          ]}
        >
          <LocationField
            zone={zone}
            manager={shop.shop.manager}
            value={draft.location}
            onChange={(location) => {
              setDraft({ location });
              setErrors(({ location: _, ...rest }) => rest);
            }}
            error={errors.location ?? errors["location.lat"]}
            onLinkState={setLinkState}
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="co-house" className="text-[13px] text-hint">
              Дом, этаж, квартира — если нужно
            </label>
            <input
              id="co-house"
              value={draft.address}
              onChange={(e) => setDraft({ address: e.target.value })}
              placeholder="Вилла 12, второй этаж"
              maxLength={300}
              className="h-11 rounded-xl bg-card px-3.5 outline-none placeholder:text-hint"
            />
          </div>
        </Section>

        <Section title="Как с вами связаться">
          <div className="flex flex-col rounded-2xl bg-card">
            <label
              className="flex h-12 items-center gap-3 border-b border-line px-3.5"
              data-error={!!errors.name}
            >
              <span className="w-[76px] flex-none text-hint">Имя</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ name: e.target.value })}
                autoComplete="given-name"
                maxLength={80}
                aria-label="Имя"
                className="h-11 min-w-0 flex-1 bg-transparent outline-none"
              />
            </label>
            <label className="flex h-12 items-center gap-3 px-3.5" data-error={!!errors.phone}>
              <span className="w-[76px] flex-none text-hint">Телефон</span>
              <input
                value={draft.phone}
                onChange={(e) => setDraft({ phone: e.target.value })}
                onBlur={() => {
                  const n = normalizePhone(draft.phone, shop.region.phoneCode);
                  if (n) setDraft({ phone: n });
                }}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={`+${shop.region.phoneCode} …`}
                aria-label="Телефон"
                className="h-11 min-w-0 flex-1 bg-transparent outline-none placeholder:text-hint"
              />
            </label>
          </div>
          <FieldError message={errors.name} />
          <FieldError message={errors.phone} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="co-comment" className="text-[13px] text-hint">
              Комментарий
            </label>
            <textarea
              id="co-comment"
              rows={2}
              value={draft.comment}
              onChange={(e) => setDraft({ comment: e.target.value })}
              placeholder="Без лука, позвонить у ворот"
              maxLength={500}
              className="resize-none rounded-xl bg-card px-3.5 py-3 outline-none placeholder:text-hint"
            />
          </div>
        </Section>
        {formError && (
          <div role="alert" className="rounded-xl bg-warn-bg px-3.5 py-3 text-[13px] text-warn-ink">
            {formError}
          </div>
        )}
        <BottomBar>
          {outside ? (
            <span className="text-center text-[13px] font-semibold text-bad-ink">
              Точка вне зоны доставки
            </span>
          ) : linkState === "error" ? (
            <span className="text-center text-[13px] font-semibold text-bad-ink">
              Ссылку на точку не распознали
            </span>
          ) : linkState === "loading" ? (
            <span className="text-center text-[13px] text-hint">Ищем точку по ссылке…</span>
          ) : (
            <span className="text-center text-[13px] text-hint">
              {count} {portions(count)} · доставка бесплатно · оплата курьеру
            </span>
          )}
          <PrimaryButton
            type="submit"
            disabled={!shop.status.open || outside || linkState !== "idle"}
          >
            Проверить заказ
          </PrimaryButton>
        </BottomBar>
      </form>
    </Screen>
  );
}

export function portions(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "порция";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "порции";
  return "порций";
}

/** Поле ссылки: пусто или точка взята — idle; ищем — loading; не нашли — error. */
type LinkState = "idle" | "loading" | "error";

/**
 * Карта + «Я сейчас здесь» (только на телефоне) + ИЛИ + ссылка Google Maps / Apple Maps /
 * координаты. С зоной доставки: граница на карте, точка вне зоны — «Сюда не доставляем».
 * Нераспознанная ссылка не пускает дальше (onLinkState): иначе заказ ушёл бы на старую точку
 * карты, а покупатель думал бы, что на точку из ссылки.
 */
function LocationField({
  zone,
  manager,
  value,
  onChange,
  error,
  onLinkState,
}: {
  zone: DeliveryZone;
  manager: string | undefined;
  value: DraftLocation | null;
  onChange: (l: DraftLocation) => void;
  error: string | undefined;
  onLinkState: (state: LinkState) => void;
}) {
  const [gpsState, setGpsState] = useState<"idle" | "loading" | "denied" | "unavailable">("idle");
  const [gpsShown] = useState(canLocate);
  const [link, setLink] = useState("");
  const [linkState, setLinkState] = useState<{ loading: boolean; error: string | null }>({
    loading: false,
    error: null,
  });

  // Разбираем вставленное, когда покупатель перестал печатать.
  useEffect(() => {
    const t = setTimeout(() => void applyLink(link), 400);
    return () => clearTimeout(t);
  }, [link]);

  useEffect(() => {
    onLinkState(
      !link.trim() ? "idle" : linkState.loading ? "loading" : linkState.error ? "error" : "idle",
    );
  }, [link, linkState, onLinkState]);

  const poor = !!value && isPoorGps(value);
  const coarse = !!value && isCoarse(value);
  const outside = !!value && !inDeliveryZone(zone, value);
  const warn = !value || poor || coarse;

  const locate = async () => {
    setGpsState("loading");
    const r = await requestGps();
    if (r.ok) {
      setGpsState("idle");
      onChange({ lat: r.lat, lng: r.lng, accuracy: r.accuracy, source: "gps" });
    } else {
      setGpsState(r.reason === "denied" ? "denied" : "unavailable");
    }
  };

  const applyLink = async (text: string) => {
    if (!text.trim()) return setLinkState({ loading: false, error: null });
    const parsed = parseLocationText(text);
    if (parsed.kind === "point") {
      setLinkState({ loading: false, error: null });
      onChange({ ...parsed.point, source: "link", via: parsed.via, label: parsed.label });
      return;
    }
    if (parsed.kind === "invalid") return setLinkState({ loading: false, error: parsed.message });
    setLinkState({ loading: true, error: null });
    try {
      const { point, label } = await api.resolveMapsUrl(parsed.url);
      setLinkState({ loading: false, error: null });
      onChange({ ...point, source: "link", via: parsed.via, label });
    } catch (err) {
      setLinkState({ loading: false, error: err instanceof Error ? err.message : "Не получилось" });
    }
  };

  return (
    <>
      <div className="flex flex-col overflow-hidden rounded-2xl bg-card" data-error={!!error}>
        <MapPicker value={value} onChange={onChange} zone={zone.enabled ? zone.circles : []} />
        <div
          className={`flex items-center gap-3 px-3.5 py-3 ${
            outside ? "bg-bad-bg text-bad-ink" : poor || coarse ? "bg-warn-bg text-warn-ink" : ""
          }`}
        >
          <span
            className={`flex h-7 w-7 flex-none items-center justify-center rounded-full ${
              outside
                ? "bg-bad-ink/15 text-bad-ink"
                : warn
                  ? "bg-warn-bg text-warn-ink"
                  : "bg-[#e3f2e7] text-[#17753a]"
            }`}
          >
            {outside || warn ? (
              <AlertCircle size={16} strokeWidth={2.6} />
            ) : (
              <Check size={16} strokeWidth={2.6} />
            )}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold">
              {outside
                ? "Сюда не доставляем"
                : !value
                  ? "Точка не поставлена"
                  : poor
                    ? `Неточно: ±${Math.round(value.accuracy ?? 0)} м`
                    : coarse
                      ? "Точка примерная"
                      : `Точка поставлена${value.accuracy ? ` · ±${Math.round(value.accuracy)} м` : ""}`}
            </span>
            <span className={`text-[13px] leading-[17px] ${outside ? "" : "text-hint"}`}>
              {outside
                ? zone.label
                  ? `Доставляем только: ${zone.label}. Подвиньте точку в зону`
                  : "Точка вне зоны доставки. Подвиньте её"
                : !value
                  ? gpsShown
                    ? "Подвиньте карту, нажмите «Я сейчас здесь» или вставьте ссылку"
                    : "Подвиньте карту или вставьте ссылку"
                  : poor
                    ? "Подвиньте карту, чтобы пин встал на ваш дом"
                    : coarse
                      ? "Приблизьте карту и поставьте пин на свой вход"
                      : value.label
                        ? `${value.label} · ${coordsText(value)}`
                        : coordsText(value)}
            </span>
          </div>
        </div>
        {outside && manager && (
          <div className="flex items-center gap-3 border-t border-bad-ink/15 bg-bad-bg px-3.5 py-2.5">
            <span className="min-w-0 flex-1 text-[13px] leading-[17px] text-bad-ink">
              Вы у самой границы? Спросите менеджера — может, довезём.
            </span>
            <button
              type="button"
              onClick={() => {
                haptic.tap();
                openTelegramChat(telegramLink(manager));
              }}
              className="flex h-9 flex-none items-center rounded-[10px] bg-card px-3.5 text-sm font-semibold text-accent-ink"
            >
              Написать
            </button>
          </div>
        )}
      </div>
      {!outside && <FieldError message={error} />}

      {gpsShown && (
        <>
          <button
            type="button"
            onClick={locate}
            disabled={gpsState === "loading"}
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-accent-soft font-semibold text-accent-ink disabled:opacity-60"
          >
            <Navigation size={18} />
            {gpsState === "loading" ? "Определяем…" : "Я сейчас здесь"}
          </button>
          {gpsState === "denied" && (
            <span className="text-[13px] text-hint">
              Нет доступа к геопозиции.{" "}
              <button
                type="button"
                className="font-semibold text-accent"
                onClick={openLocationSettings}
              >
                Разрешить
              </button>{" "}
              или подвиньте карту вручную.
            </span>
          )}
          {gpsState === "unavailable" && (
            <span className="text-[13px] text-hint">
              Не получилось определить место — подвиньте карту вручную.
            </span>
          )}
        </>
      )}

      <div className="my-0.5 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[17px] leading-[22px] font-extrabold tracking-[0.08em] text-hint">
          ИЛИ
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="co-link" className="flex flex-col text-[13px] leading-[18px] text-hint">
          <span>Вставьте ссылку из Google Maps или Apple Maps — пин встанет туда сам.</span>
          <span>В картах: выберите место → «Поделиться» → «Копировать».</span>
        </label>
        <div
          className={`flex h-11 items-center gap-2 rounded-xl pr-1 pl-3.5 ${
            linkState.error ? "bg-bad-bg ring-[1.5px] ring-[#e3a08e] ring-inset" : "bg-card"
          }`}
          data-error={!!linkState.error}
        >
          <Link2 size={16} className="flex-none text-hint" />
          <input
            id="co-link"
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
            }}
            placeholder="Ссылка на карту или координаты"
            className="h-10 min-w-0 flex-1 bg-transparent outline-none placeholder:text-hint"
          />
          {linkState.loading && (
            <span className="mr-1.5 h-4 w-4 flex-none animate-spin rounded-full border-2 border-line border-t-accent" />
          )}
          {linkState.error && (
            <button
              type="button"
              aria-label="Очистить ссылку"
              onClick={() => setLink("")}
              className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-hint"
            >
              <X size={18} strokeWidth={2.2} />
            </button>
          )}
        </div>
        {linkState.error && (
          <span role="alert" className="flex flex-col text-[13px] leading-[18px] text-bad-ink">
            <span className="font-semibold">
              {/https?:\/\//.test(link)
                ? "Не нашли точку в ссылке."
                : "Не нашли здесь ссылку или координаты."}
            </span>
            <span>Вставьте другую ссылку или очистите поле и подвиньте карту.</span>
          </span>
        )}
      </div>
    </>
  );
}
