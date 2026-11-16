/** Экран заказа: крупно — что сейчас и чего ждать, полоса прогресса, оценка, состав, отмена. */
import {
  formatPhone,
  isFinalStatus,
  ORDER_FLOW,
  ORDER_STATUS_LABELS,
  type OrderStatus,
  RATING_MAX,
  telegramLink,
} from "@store/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Send, Star } from "lucide-react";
import { useState } from "react";
import { BottomBar, Screen, Spinner } from "../components/ui.tsx";
import { api, type Order } from "../lib/api.ts";
import { useMoney, useReadyShop } from "../lib/shop.ts";
import { haptic, openTelegramChat } from "../lib/telegram.ts";

const EXPECT: Record<OrderStatus, { title: string; text: (o: Order, sum: string) => string }> = {
  new: {
    title: "Заказ оформлен",
    text: () => "Ждём, когда магазин примет заказ — обычно это пара минут.",
  },
  processing: { title: "Готовим", text: () => "Курьер привезёт, как только всё будет готово." },
  shipping: { title: "Курьер в пути", text: (_o, sum) => `Приготовьте ${sum} — оплата курьеру.` },
  done: { title: "Доставлен", text: () => "Приятного аппетита! Будем рады видеть снова." },
  cancelled: { title: "Заказ отменён", text: (o) => o.cancelReason ?? "" },
};

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function OrderScreen({ id }: { id: number }) {
  const money = useMoney();
  const shop = useReadyShop();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const order = useQuery({
    queryKey: ["order", id],
    queryFn: () => api.order(id),
    refetchInterval: (q) => (q.state.data && isFinalStatus(q.state.data.status) ? false : 15_000),
  });
  const cancel = useMutation({
    mutationFn: () => api.cancelOrder(id),
    onSuccess: (o) => {
      haptic.success();
      queryClient.setQueryData(["order", id], o);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      setConfirming(false);
    },
    onError: () => haptic.error(),
  });

  if (order.isPending) return <Spinner />;
  if (order.isError || !order.data) {
    return (
      <Screen>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-hint">
          {order.error?.message ?? "Заказ не найден"}
          <Link to="/" className="font-semibold text-accent">
            В меню
          </Link>
        </div>
      </Screen>
    );
  }

  const o = order.data;
  const sum = money(o.total);
  const step = ORDER_FLOW.indexOf(o.status as (typeof ORDER_FLOW)[number]);
  const at = new Map(o.history.map((h) => [h.status, h.at]));
  const expect = EXPECT[o.status];

  return (
    <Screen>
      <div className="flex flex-col gap-4 p-4 pb-32">
        <div className="flex flex-col gap-3 rounded-2xl bg-card p-4">
          <span className="text-[13px] text-hint">
            Заказ #{o.id} · {time(o.createdAt)}
          </span>
          <h1
            className={`m-0 text-[22px] leading-[28px] font-bold ${o.status === "cancelled" ? "text-hint" : ""}`}
          >
            {expect.title}
          </h1>
          <p className="m-0 text-[15px] text-ink">{expect.text(o, sum)}</p>
          {o.status !== "cancelled" && (
            <ol className="m-0 flex list-none gap-1.5 p-0" aria-label="Ход заказа">
              {ORDER_FLOW.map((s, i) => (
                <li key={s} className="flex flex-1 flex-col gap-1.5">
                  <span
                    className={`h-1.5 rounded-full ${
                      i > step ? "bg-muted" : o.status === "done" ? "bg-ok" : "bg-accent"
                    }`}
                  />
                  <span
                    className={`text-[11px] leading-[14px] ${i <= step ? "font-semibold text-ink" : "text-hint"}`}
                  >
                    {ORDER_STATUS_LABELS[s]}
                    {at.get(s) && (
                      <span className="block font-normal text-hint">{time(at.get(s) ?? "")}</span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {o.cancelRequested && o.status !== "cancelled" && (
            <span className="rounded-xl bg-warn-bg px-3 py-2 text-[13px] text-warn-ink">
              Попросили отменить — магазин свяжется с вами
            </span>
          )}
        </div>

        {(o.canReview || o.review) && <ReviewCard order={o} />}

        <div className="flex flex-col rounded-2xl bg-card">
          {o.items.map((i) => (
            <div
              key={i.productId}
              className="flex justify-between gap-3 border-b border-line px-4 py-3"
            >
              <span>
                {i.title} <span className="text-hint">× {i.qty}</span>
              </span>
              <span className="flex-none">{money(i.price * i.qty)}</span>
            </div>
          ))}
          <div className="flex justify-between px-4 py-3 text-[17px] font-bold">
            <span>Итого</span>
            <span>{sum}</span>
          </div>
          <span className="px-4 pb-3 text-[13px] text-hint">
            Доставка бесплатно · оплата курьеру при получении
          </span>
        </div>

        <div className="flex flex-col gap-1 rounded-2xl bg-card px-4 py-3 text-[15px]">
          <span className="text-[13px] text-hint">Доставка</span>
          <span>
            {o.name} · {formatPhone(o.phone, shop.region.phoneCode)}
          </span>
          {o.address && <span>{o.address}</span>}
          {o.comment && <span className="text-hint">«{o.comment}»</span>}
        </div>

        {o.chatOpen && (
          <span className="text-center text-[13px] text-hint">
            Вопрос по заказу — напишите в чат с ботом, ответит менеджер
          </span>
        )}
        {shop.shop.manager && <ManagerContact username={shop.shop.manager} />}

        {o.cancelMode !== "none" && !(o.cancelMode === "request" && o.cancelRequested) && (
          <div className="flex flex-col gap-2">
            {confirming ? (
              <div className="flex flex-col gap-2 rounded-2xl bg-card p-4">
                <span className="font-semibold">
                  {o.cancelMode === "cancel"
                    ? "Отменить заказ?"
                    : "Попросить магазин отменить заказ?"}
                </span>
                {o.cancelMode === "request" && (
                  <span className="text-[13px] text-hint">
                    Заказ уже готовят — менеджер свяжется с вами.
                  </span>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => cancel.mutate()}
                    disabled={cancel.isPending}
                    className="h-11 flex-1 rounded-xl bg-danger font-semibold text-white disabled:opacity-60"
                  >
                    {o.cancelMode === "cancel" ? "Да, отменить" : "Да, попросить"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    className="h-11 flex-1 rounded-xl bg-page font-semibold"
                  >
                    Нет
                  </button>
                </div>
                {cancel.error && (
                  <span className="text-[13px] text-danger">{cancel.error.message}</span>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="h-11 rounded-xl font-semibold text-danger"
              >
                {o.cancelMode === "cancel" ? "Отменить заказ" : "Попросить отменить"}
              </button>
            )}
          </div>
        )}
      </div>
      <BottomBar>
        <Link
          to="/"
          className="flex h-[52px] items-center justify-center rounded-[14px] bg-accent-soft text-base font-semibold text-accent-ink"
        >
          В меню
        </Link>
      </BottomBar>
    </Screen>
  );
}

/**
 * Контакт магазина — Telegram менеджера (телефон магазина не показываем). В его профиле
 * покупатель может и написать, и позвонить через Telegram.
 */
function ManagerContact({ username }: { username: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-card py-2 pr-2 pl-4">
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-accent-soft text-accent-ink">
        <Send size={17} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13px] text-hint">Менеджер в Telegram</span>
        <span className="truncate font-semibold">@{username}</span>
      </div>
      <button
        type="button"
        onClick={() => {
          haptic.tap();
          openTelegramChat(telegramLink(username));
        }}
        className="flex h-9 flex-none items-center rounded-lg bg-muted px-3 text-[13px] font-semibold text-ink"
      >
        Написать
      </button>
    </div>
  );
}

function Stars({
  value,
  onPick,
  size,
}: {
  value: number;
  onPick?: (n: number) => void;
  size: number;
}) {
  const icon = (n: number) => (
    <Star
      size={size}
      strokeWidth={1.8}
      className={n <= value ? "fill-accent text-accent" : "text-[#c7c7cc]"}
    />
  );
  const all = Array.from({ length: RATING_MAX }, (_, i) => i + 1);
  if (!onPick) {
    return (
      <span className="flex gap-1" role="img" aria-label={`${value} из ${RATING_MAX}`}>
        {all.map((n) => (
          <span key={n}>{icon(n)}</span>
        ))}
      </span>
    );
  }
  return (
    <div className="flex gap-2">
      {all.map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={n === value}
          aria-label={`${n} из ${RATING_MAX}`}
          onClick={() => onPick(n)}
          className="flex h-12 w-12 items-center justify-center"
        >
          {icon(n)}
        </button>
      ))}
    </div>
  );
}

/** Оценка после доставки: звёзды обязательны, отзыв — нет. После отправки — «Спасибо». */
function ReviewCard({ order: o }: { order: Order }) {
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const send = useMutation({
    mutationFn: () => api.reviewOrder(o.id, { rating, text }),
    onSuccess: (fresh) => {
      haptic.success();
      queryClient.setQueryData(["order", o.id], fresh);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: () => haptic.error(),
  });

  if (o.review) {
    return (
      <div className="flex flex-col gap-2 rounded-2xl bg-card p-4">
        <span className="font-semibold">Спасибо за отзыв!</span>
        <Stars value={o.review.rating} size={22} />
        {o.review.text && <p className="m-0 text-[15px] text-hint">«{o.review.text}»</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-card p-4">
      <span className="text-[17px] font-semibold">Как вам заказ?</span>
      <div className="-mx-1.5">
        <Stars
          value={rating}
          size={36}
          onPick={(n) => {
            haptic.tap();
            setRating(n);
          }}
        />
      </div>
      <textarea
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Напишите отзыв — необязательно"
        maxLength={1000}
        aria-label="Отзыв"
        className="resize-none rounded-xl bg-page px-3.5 py-3 outline-none placeholder:text-hint"
      />
      <button
        type="button"
        onClick={() => send.mutate()}
        disabled={rating === 0 || send.isPending}
        className="h-11 rounded-xl bg-accent font-semibold text-white disabled:opacity-50"
      >
        {send.isPending ? "Отправляем…" : "Отправить"}
      </button>
      {send.error && <span className="text-[13px] text-danger">{send.error.message}</span>}
    </div>
  );
}
