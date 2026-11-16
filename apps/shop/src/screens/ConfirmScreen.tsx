/**
 * «Проверьте заказ» — последний шаг перед отправкой: куда, кому, что и сколько.
 * Карта здесь только показывает точку: случайно сдвинуть её нельзя, правят через «Изменить».
 * Заказ уходит только отсюда. Сервер отклонил (закончилось, закрыто, пауза) — плашка здесь же.
 */
import { formatPhone, inDeliveryZone } from "@store/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { AlertCircle, Clock, House, Link2, MapPin, Navigation } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { MapPreview } from "../components/MapPicker.tsx";
import { BottomBar, PrimaryButton, Screen } from "../components/ui.tsx";
import { ApiError, api } from "../lib/api.ts";
import { useCart } from "../lib/cart.ts";
import { type PointSummary, pointSummary } from "../lib/location.ts";
import { useCartLines, useMoney, useReadyShop } from "../lib/shop.ts";
import { haptic } from "../lib/telegram.ts";
import { ClosedNotice } from "./CartScreen.tsx";
import { orderIssues, useOrderBody } from "./CheckoutScreen.tsx";

type Failure = { lines: string[]; action: "cart" | "form" | null };

const historyIndex = (): number => window.history.state?.__TSR_index ?? 0;

export function ConfirmScreen() {
  const shop = useReadyShop();
  const money = useMoney();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { lines, count, total, soldOut } = useCartLines();
  const draft = useCart((s) => s.draft);
  const setDraft = useCart((s) => s.setDraft);
  const clearCart = useCart((s) => s.clear);
  const body = useOrderBody();
  const [failure, setFailure] = useState<Failure | null>(null);
  const issues = orderIssues(shop, body);
  // Ошибки в точке или контактах правятся на оформлении; в составе — плашкой здесь.
  const customerInvalid = issues.some((i) => !i.path.startsWith("items"));

  /** Точка и контакты правятся на оформлении — оно лежит в истории прямо под этим экраном. */
  const toForm = () => {
    if (historyIndex() > 0) router.history.back();
    else navigate({ to: "/checkout", replace: true });
  };
  /** Корзина — на два шага назад (корзина → оформление → проверка). */
  const toCart = () => {
    if (historyIndex() >= 2) router.history.go(-2);
    else navigate({ to: "/cart", replace: true });
  };

  const submit = useMutation({
    mutationFn: () => api.createOrder(body as Parameters<typeof api.createOrder>[0]),
    onMutate: () => setFailure(null),
    onSuccess: (order) => {
      haptic.success();
      clearCart();
      // В следующий раз точка подставится с пометкой «Как в прошлом заказе».
      setDraft({
        comment: "",
        location: draft.location ? { ...draft.location, fromLastOrder: true } : null,
      });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["me"] });
      navigate({ to: "/orders/$id", params: { id: String(order.id) }, replace: true });
    },
    onError: (err) => {
      haptic.error();
      queryClient.invalidateQueries({ queryKey: ["shop"] });
      if (err instanceof ApiError && err.issues.length > 0) {
        const items = err.issues.filter((i) => i.path.startsWith("items"));
        setFailure(
          items.length > 0
            ? { lines: items.map((i) => `${i.message}.`), action: "cart" }
            : { lines: err.issues.map((i) => i.message), action: "form" },
        );
      } else {
        setFailure({
          lines: [err instanceof Error ? err.message : "Не получилось оформить заказ"],
          action: null,
        });
      }
    },
  });

  // Сюда попали с неполными данными (перезагрузка, зона поменялась) — обратно на оформление,
  // там видно, что исправить.
  const settled = submit.isPending || submit.isSuccess;
  useEffect(() => {
    if (!settled && lines.length > 0 && customerInvalid) {
      navigate({ to: "/checkout", replace: true });
    }
  }, [settled, lines.length, customerInvalid, navigate]);

  if (lines.length === 0 && !settled) {
    return (
      <Screen>
        <div className="flex flex-1 items-center justify-center p-8 text-hint">Корзина пуста</div>
      </Screen>
    );
  }
  const location = draft.location;
  if (!location) return null;

  const outside = !inDeliveryZone(shop.delivery, location);
  const blocked =
    soldOut.length > 0 || count === 0 || !shop.status.open || issues.length > 0 || outside;

  return (
    <Screen>
      <div className="flex flex-col gap-5 p-4 pb-28">
        <ClosedNotice />
        {soldOut.length > 0 ? (
          <Alert
            title={failure ? "Заказ не отправлен" : "Часть блюд закончилась"}
            lines={[
              ...soldOut.map((l) => `«${l.product.title}» закончилось.`),
              soldOut.length === 1
                ? "Уберите его в корзине — остальное сохранится."
                : "Уберите их в корзине — остальное сохранится.",
            ]}
            action={{ label: "В корзину", onClick: toCart }}
          />
        ) : (
          failure && (
            <Alert
              title="Заказ не отправлен"
              lines={failure.lines}
              action={
                failure.action === "cart"
                  ? { label: "В корзину", onClick: toCart }
                  : failure.action === "form"
                    ? { label: "Исправить", onClick: toForm }
                    : undefined
              }
            />
          )
        )}

        <Block title="Куда привезти" onEdit={toForm}>
          <div className="flex flex-col overflow-hidden rounded-2xl bg-card">
            <MapPreview
              value={location}
              zone={shop.delivery.enabled ? shop.delivery.circles : []}
            />
            <PointRow summary={pointSummary(location)} />
            {draft.address.trim() && (
              <div className="flex items-center gap-3 border-t border-line px-3.5 py-3">
                <span className="flex h-7 w-7 flex-none items-center justify-center text-hint">
                  <House size={18} />
                </span>
                <span className="min-w-0 flex-1 break-words">{draft.address}</span>
              </div>
            )}
          </div>
        </Block>

        <Block title="Получатель" onEdit={toForm}>
          <div className="flex flex-col rounded-2xl bg-card">
            <div className="flex flex-col gap-0.5 px-3.5 py-3">
              <span className="text-[13px] leading-[17px] text-hint">{draft.name}</span>
              <span className="text-xl leading-[26px] font-bold tracking-[0.01em] tabular-nums">
                {formatPhone(draft.phone, shop.region.phoneCode)}
              </span>
              <span className="text-[13px] leading-[17px] text-hint">
                Курьер позвонит на этот номер
              </span>
            </div>
            {draft.comment.trim() && (
              <div className="flex flex-col gap-0.5 border-t border-line px-3.5 py-3">
                <span className="text-[13px] leading-[17px] text-hint">Комментарий</span>
                <span className="break-words whitespace-pre-line">{draft.comment}</span>
              </div>
            )}
          </div>
        </Block>

        <Block title="Заказ" onEdit={toCart}>
          <div className="flex flex-col overflow-hidden rounded-2xl bg-card">
            {lines.map(({ product: p, qty }) => (
              <div
                key={p.id}
                className="flex items-center gap-3 border-b border-line px-3.5 py-[11px]"
              >
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">{p.title}</span>
                  {p.available ? (
                    <span className="text-[13px] leading-[17px] text-hint">
                      {qty} × {money(p.price)}
                    </span>
                  ) : (
                    <span className="text-[13px] leading-[17px] font-semibold text-danger">
                      Закончилось
                    </span>
                  )}
                </div>
                <span
                  className={`flex-none font-semibold ${p.available ? "" : "text-hint line-through"}`}
                >
                  {money(p.price * qty)}
                </span>
              </div>
            ))}
            <div className="flex flex-col gap-1.5 p-3.5">
              <div className="flex justify-between text-hint">
                <span>Доставка</span>
                <span className="font-semibold text-ok">Бесплатно</span>
              </div>
              <div className="flex justify-between text-[17px] leading-[22px] font-bold">
                <span>Итого</span>
                <span>{money(total)}</span>
              </div>
              <span className="text-[13px] text-hint">
                Оплата курьеру при получении — наличными или переводом
              </span>
            </div>
          </div>
        </Block>
      </div>
      <BottomBar>
        <PrimaryButton
          loading={submit.isPending}
          disabled={blocked}
          onClick={() => submit.mutate()}
        >
          Подтвердить заказ · {money(total)}
        </PrimaryButton>
      </BottomBar>
    </Screen>
  );
}

function Block({
  title,
  onEdit,
  children,
}: {
  title: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex h-6 items-center justify-between">
        <h2 className="m-0 text-[17px] leading-[22px] font-bold">{title}</h2>
        <button
          type="button"
          onClick={() => {
            haptic.tap();
            onEdit();
          }}
          className="-mr-1 flex h-11 items-center px-1 font-semibold text-accent"
        >
          Изменить
        </button>
      </div>
      {children}
    </section>
  );
}

const POINT_ICONS = {
  link: Link2,
  gps: Navigation,
  pin: MapPin,
  last: Clock,
  warn: AlertCircle,
} as const;

function PointRow({ summary }: { summary: PointSummary }) {
  const warn = summary.tone === "warn";
  const Icon = POINT_ICONS[summary.icon];
  return (
    <div
      className={`flex items-center gap-3 px-3.5 py-3 ${warn ? "bg-warn-bg text-warn-ink" : ""}`}
    >
      <span
        className={`flex h-7 w-7 flex-none items-center justify-center rounded-full ${
          warn ? "bg-[#f7ddb0] text-[#8a4b06]" : "bg-accent-soft text-accent-ink"
        }`}
      >
        <Icon size={16} strokeWidth={2.4} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold break-words">{summary.title}</span>
        {summary.lines.map((line) => (
          <span key={line} className={`text-[13px] leading-[17px] ${warn ? "" : "text-hint"}`}>
            {line}
          </span>
        ))}
      </div>
    </div>
  );
}

function Alert({
  title,
  lines,
  action,
}: {
  title: string;
  lines: string[];
  action?: { label: string; onClick: () => void } | undefined;
}) {
  return (
    <div role="alert" className="flex flex-col gap-2.5 rounded-2xl bg-bad-bg p-3.5 text-bad-ink">
      <div className="flex gap-3">
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[#f6cfc5] text-[#9a2b12]">
          <AlertCircle size={16} strokeWidth={2.6} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-bold">{title}</span>
          {lines.map((line) => (
            <span key={line} className="text-[13px] leading-[18px]">
              {line}
            </span>
          ))}
        </div>
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="flex h-10 items-center justify-center rounded-[10px] bg-card text-sm font-semibold text-accent-ink"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
