/**
 * Оформление — одна страница: точка на карте, дом/этаж, имя и телефон, комментарий.
 * Проверка — той же схемой, что на сервере (createOrderInputSchema); ошибки сервера
 * показываются у своих полей.
 */
import {
  createOrderInputSchema,
  GPS_ACCURACY_WARN_M,
  normalizePhone,
  parseLocationText,
} from "@store/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AlertCircle, Check, Link2, Navigation } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MapPicker } from "../components/MapPicker.tsx";
import { BottomBar, FieldError, PrimaryButton, Screen, Section } from "../components/ui.tsx";
import { ApiError, api } from "../lib/api.ts";
import { type DraftLocation, useCart } from "../lib/cart.ts";
import { useCartLines, useMoney, useReadyShop } from "../lib/shop.ts";
import { canLocate, haptic, openLocationSettings, requestGps } from "../lib/telegram.ts";
import { ClosedNotice } from "./CartScreen.tsx";

type Errors = Record<string, string>;

export function CheckoutScreen() {
  const shop = useReadyShop();
  const money = useMoney();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { lines, count, total } = useCartLines();
  const draft = useCart((s) => s.draft);
  const setDraft = useCart((s) => s.setDraft);
  const clearCart = useCart((s) => s.clear);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });

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
      location: draft.location ?? (last ? { ...last.location, source: "pin" } : null),
    });
  }, [me.data, draft, setDraft]);

  const body = {
    items: lines
      .filter((l) => l.product.available)
      .map((l) => ({ productId: l.product.id, qty: l.qty })),
    customer: {
      name: draft.name,
      phone: draft.phone,
      location: draft.location,
      address: draft.address,
      comment: draft.comment,
    },
  };

  const submit = useMutation({
    mutationFn: () => {
      const parsed = createOrderInputSchema(shop).safeParse(body);
      if (!parsed.success) {
        throw new ApiError(
          400,
          "Проверьте поля",
          parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
      return api.createOrder(body as Parameters<typeof api.createOrder>[0]);
    },
    onMutate: () => {
      setErrors({});
      setFormError(null);
    },
    onSuccess: (order) => {
      haptic.success();
      clearCart();
      setDraft({ comment: "" });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate({ to: "/orders/$id", params: { id: String(order.id) }, replace: true });
    },
    onError: (err) => {
      haptic.error();
      if (err instanceof ApiError && err.issues.length > 0) {
        const byField: Errors = {};
        for (const i of err.issues) byField[i.path.replace(/^customer\./, "")] ??= i.message;
        setErrors(byField);
        const fieldKeys = ["name", "phone", "location", "address", "comment"];
        if (!Object.keys(byField).some((k) => fieldKeys.includes(k.split(".")[0] ?? ""))) {
          setFormError(err.message);
        }
        const first = document.querySelector("[data-error='true']");
        first?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        setFormError(err instanceof Error ? err.message : "Не получилось оформить заказ");
      }
      queryClient.invalidateQueries({ queryKey: ["shop"] });
    },
  });

  if (count === 0 && !submit.isPending) {
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
          submit.mutate();
        }}
      >
        <ClosedNotice />
        <Section
          title="Куда привезти"
          hint="Курьер приедет туда, где стоит пин. Поставьте его на свой вход."
        >
          <LocationField
            value={draft.location}
            onChange={(location) => {
              setDraft({ location });
              setErrors(({ location: _, ...rest }) => rest);
            }}
            error={errors.location ?? errors["location.lat"]}
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
          <span className="text-center text-[13px] text-hint">
            {count} {portions(count)} · доставка бесплатно · оплата курьеру
          </span>
          <PrimaryButton type="submit" loading={submit.isPending} disabled={!shop.status.open}>
            Оформить заказ · {money(total)}
          </PrimaryButton>
        </BottomBar>
      </form>
    </Screen>
  );
}

function portions(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return "порция";
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return "порции";
  return "порций";
}

/** Карта + «Я сейчас здесь» (только на телефоне) + ИЛИ + ссылка Google Maps / координаты. */
function LocationField({
  value,
  onChange,
  error,
}: {
  value: DraftLocation | null;
  onChange: (l: DraftLocation) => void;
  error: string | undefined;
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

  const poor = value?.source === "gps" && (value.accuracy ?? 0) > GPS_ACCURACY_WARN_M;

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
      onChange({ ...parsed.point, source: "link" });
      return;
    }
    if (parsed.kind === "invalid") return setLinkState({ loading: false, error: parsed.message });
    setLinkState({ loading: true, error: null });
    try {
      const { point } = await api.resolveMapsUrl(parsed.url);
      setLinkState({ loading: false, error: null });
      onChange({ ...point, source: "link" });
    } catch (err) {
      setLinkState({ loading: false, error: err instanceof Error ? err.message : "Не получилось" });
    }
  };

  return (
    <>
      <div className="flex flex-col overflow-hidden rounded-2xl bg-card" data-error={!!error}>
        <MapPicker value={value} onChange={onChange} />
        <div
          className={`flex items-center gap-3 px-3.5 py-3 ${poor ? "bg-warn-bg text-warn-ink" : ""}`}
        >
          <span
            className={`flex h-7 w-7 flex-none items-center justify-center rounded-full ${
              !value || poor ? "bg-warn-bg text-warn-ink" : "bg-[#e3f2e7] text-[#17753a]"
            }`}
          >
            {!value || poor ? (
              <AlertCircle size={16} strokeWidth={2.6} />
            ) : (
              <Check size={16} strokeWidth={2.6} />
            )}
          </span>
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold">
              {!value
                ? "Точка не поставлена"
                : poor
                  ? `Неточно: ±${Math.round(value.accuracy ?? 0)} м`
                  : `Точка поставлена${value.accuracy ? ` · ±${Math.round(value.accuracy)} м` : ""}`}
            </span>
            <span className="text-[13px] leading-[17px] text-hint">
              {!value
                ? gpsShown
                  ? "Подвиньте карту, нажмите «Я сейчас здесь» или вставьте ссылку"
                  : "Подвиньте карту или вставьте ссылку"
                : poor
                  ? "Подвиньте карту, чтобы пин встал на ваш дом"
                  : `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}`}
            </span>
          </div>
        </div>
      </div>
      <FieldError message={error} />

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
          <span>Вставьте ссылку из Google Maps — пин встанет туда сам.</span>
          <span>В картах: выберите место → «Поделиться» → «Копировать».</span>
        </label>
        <div className="flex h-11 items-center gap-2 rounded-xl bg-card pr-1.5 pl-3.5">
          <Link2 size={16} className="flex-none text-hint" />
          <input
            id="co-link"
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
            }}
            placeholder="Ссылка Google Maps или координаты"
            className="h-10 min-w-0 flex-1 bg-transparent outline-none placeholder:text-hint"
          />
          {linkState.loading && (
            <span className="h-4 w-4 flex-none animate-spin rounded-full border-2 border-line border-t-accent" />
          )}
        </div>
        <FieldError message={linkState.error ?? undefined} />
      </div>
    </>
  );
}
