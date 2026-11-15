/**
 * Карточка заказа на экране «Заказы». Раскрывается на месте: состав, сумма, контакты,
 * кнопки Номер (копирует — `tel:` в Mini App не работает) · Написать · Карта и одна большая кнопка следующего шага.
 * Отмена и «Не получилось» — в меню «⋯». Отзыв покупателя видит менеджер: пока карточку
 * не раскрыли, на ней «новый отзыв» (без звука), раскрыли — пометка снимается.
 */
import {
  CANCEL_REASON_LABELS,
  CANCEL_REASONS,
  type CancelReason,
  DELIVERY_FAILURE_LABELS,
  DELIVERY_FAILURE_REASONS,
  type DeliveryFailureReason,
  ORDER_STATUS_LABELS,
  RATING_MAX,
  type StaffOrderAction,
} from "@store/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  Copy,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Navigation,
  Star,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, api, type StaffOrder } from "../lib/api.ts";
import { useMoney, usePhone } from "../lib/session.ts";
import { copyText, haptic, openExternal, openTelegram } from "../lib/telegram.ts";
import { FieldError, PrimaryButton, SecondaryButton, Sheet } from "./ui.tsx";

export type Mode = "manager" | "courier";

export function waitingMinutes(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

function portions(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} порция`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} порции`;
  return `${n} порций`;
}

export function OrderCard({
  order: o,
  mode,
  expanded,
  onToggle,
}: {
  order: StaffOrder;
  mode: Mode;
  expanded: boolean;
  onToggle?: () => void;
}) {
  const money = useMoney();
  const phone = usePhone();
  const queryClient = useQueryClient();
  const [sheet, setSheet] = useState<null | "menu" | "cancel" | "fail" | "assign">(null);
  const [error, setError] = useState<string | null>(null);
  const count = o.items.reduce((n, i) => n + i.qty, 0);
  const waiting = o.status === "new" ? waitingMinutes(o.createdAt) : null;
  const finished = o.status === "done" || o.status === "cancelled";

  const act = useMutation({
    mutationFn: (a: StaffOrderAction) => api.action(o.id, a),
    onMutate: () => setError(null),
    onSuccess: (fresh) => {
      haptic.success();
      setSheet(null);
      queryClient.setQueryData(["order", o.id], fresh);
      void queryClient.invalidateQueries({ queryKey: ["board"] });
    },
    onError: (err) => {
      haptic.error();
      setError(err instanceof ApiError ? err.message : "Не получилось");
      void queryClient.invalidateQueries({ queryKey: ["board"] });
    },
  });

  // Главная кнопка: следующий шаг для этой роли.
  let primary:
    | { label: string; action: StaffOrderAction }
    | { label: string; open: "assign" }
    | null = null;
  if (mode === "manager") {
    if (o.status === "new") primary = { label: "Принять и готовить", action: { action: "accept" } };
    else if (o.status === "processing" && !o.courier)
      primary = { label: "Передать курьеру", open: "assign" };
  } else {
    if (o.status === "processing") primary = { label: "Забрал, еду", action: { action: "pickup" } };
    else if (o.status === "shipping")
      primary = { label: "Доставлен", action: { action: "deliver" } };
  }

  const newReview = o.review !== null && !o.review.seen;
  // Раньше этому покупателю ничего не доставляли — менеджеру стоит присмотреться (оплата курьеру).
  const firstOrder = mode === "manager" && o.firstOrder && !finished;
  const highlight = o.status === "new" || o.cancelRequested || o.deliveryIssue || newReview;

  // Раскрыли карточку с новым отзывом — отзыв прочитан.
  useEffect(() => {
    if (!expanded || !newReview) return;
    api
      .reviewSeen(o.id)
      .then(() => queryClient.invalidateQueries({ queryKey: ["board"] }))
      .catch(() => {});
  }, [expanded, newReview, o.id, queryClient]);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-center gap-3 rounded-[18px] bg-card p-3.5 text-left lg:rounded-[14px] ${
          newReview
            ? "shadow-[inset_0_0_0_2px_var(--accent)]"
            : highlight
              ? "shadow-[inset_0_0_0_2px_#ebc2b3]"
              : ""
        }`}
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-bold">#{o.id}</span>
            <StatusChip order={o} waiting={waiting} />
            {firstOrder && <FirstOrderChip />}
            {o.review && <RatingChip rating={o.review.rating} fresh={newReview} />}
          </div>
          <span className="truncate text-sm text-hint">
            {o.customer.name} · {portions(count)}
            {o.courier && mode === "manager" && !finished ? ` · ${o.courier.name}` : ""}
          </span>
        </div>
        <span className="font-bold">{money(o.total)}</span>
        <ChevronDown size={18} className="flex-none text-hint" />
      </button>
    );
  }

  return (
    <article
      className={`flex flex-col gap-3 rounded-[18px] bg-card p-3.5 lg:rounded-[14px] ${
        highlight ? "shadow-[inset_0_0_0_2px_var(--accent)]" : ""
      }`}
    >
      <header className="flex items-center gap-2">
        <button type="button" onClick={onToggle} className="flex items-center gap-2">
          <span className="text-[17px] leading-[22px] font-bold">#{o.id}</span>
          <StatusChip order={o} waiting={waiting} />
          {firstOrder && <FirstOrderChip />}
          {o.review && <RatingChip rating={o.review.rating} fresh={false} />}
        </button>
        <span className="ml-auto text-[17px] font-bold">{money(o.total)}</span>
        {!finished && (
          <button
            type="button"
            aria-label="Ещё действия"
            onClick={() => setSheet("menu")}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-hint"
          >
            <MoreHorizontal size={20} />
          </button>
        )}
      </header>

      {mode === "courier" && !finished && (
        <div className="flex items-center justify-between rounded-[14px] bg-warn-bg px-3.5 py-3 text-warn-ink">
          <span className="font-semibold">Получить при доставке</span>
          <span className="text-[22px] leading-7 font-extrabold">{money(o.total)}</span>
        </div>
      )}

      {o.cancelRequested && (
        <div className="flex items-center gap-2 rounded-xl bg-warn-bg px-3 py-2.5 text-sm text-warn-ink">
          <AlertTriangle size={16} /> Покупатель просит отменить заказ
        </div>
      )}
      {o.deliveryIssue && (
        <div className="flex flex-col gap-0.5 rounded-xl bg-warn-bg px-3 py-2.5 text-sm text-warn-ink">
          <span className="flex items-center gap-2 font-semibold">
            <AlertTriangle size={16} /> Не получилось доставить
          </span>
          <span>
            {o.deliveryIssue.text}
            {o.deliveryIssue.by ? ` · ${o.deliveryIssue.by.name}` : ""}
          </span>
        </div>
      )}

      {o.review && (
        <div className="flex flex-col gap-1 rounded-[10px] bg-page px-3 py-2.5 text-sm">
          <span className="flex items-center gap-2">
            <span className="text-[13px] font-bold">Отзыв</span>
            <span className="flex" role="img" aria-label={`${o.review.rating} из ${RATING_MAX}`}>
              {Array.from({ length: RATING_MAX }, (_, i) => (
                <Star
                  key={i}
                  size={15}
                  strokeWidth={1.8}
                  className={`text-accent ${i < (o.review?.rating ?? 0) ? "fill-accent" : ""}`}
                />
              ))}
            </span>
            <span className="ml-auto text-xs text-hint">{reviewTime(o.review.at)}</span>
          </span>
          {o.review.text ? (
            <span className="text-[13px] leading-[18px] whitespace-pre-line">
              «{o.review.text}»
            </span>
          ) : (
            <span className="text-hint">Без текста — только оценка</span>
          )}
        </div>
      )}

      {mode === "courier" && !finished ? (
        <>
          {o.customer.phone && (
            <div className="flex flex-col gap-0.5 text-sm leading-[19px]">
              <span>
                <b>{o.customer.name}</b> · {phone(o.customer.phone)}
              </span>
              {o.address && <span className="text-[#4a4a52]">{o.address}</span>}
              {o.comment && <span className="text-[#4a4a52]">«{o.comment}»</span>}
              {o.location?.accuracy && o.location.accuracy > 50 && (
                <span className="text-warn-ink">
                  Точка неточная: ±{Math.round(o.location.accuracy)} м
                </span>
              )}
            </div>
          )}
          {o.location && (
            <button
              type="button"
              onClick={() => o.location && openExternal(o.location.mapsUrl)}
              className="flex h-[52px] items-center justify-center gap-2 rounded-[14px] bg-[#1f73d6] text-base font-bold text-white"
            >
              <Navigation size={20} strokeWidth={2.2} /> Открыть в Google Maps
            </button>
          )}
          {o.customer.phone && (
            <div className={`grid gap-2 ${o.customer.username ? "grid-cols-2" : "grid-cols-1"}`}>
              <CopyPhone phone={o.customer.phone} />
              {o.customer.username && (
                <SecondaryButton
                  onClick={() => openTelegram(`https://t.me/${o.customer.username}`)}
                >
                  <MessageCircle size={16} /> Написать
                </SecondaryButton>
              )}
            </div>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer text-hint">Состав · {portions(count)}</summary>
            <div className="pt-1.5 text-[#4a4a52]">
              {o.items.map((i) => `${i.qty}× ${i.title}`).join(" · ")}
            </div>
          </details>
        </>
      ) : (
        <>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {o.items.map((i) => (
              <li key={i.productId} className="flex gap-2">
                <span className="w-7 flex-none font-bold">{i.qty}×</span>
                <span className="flex-1">{i.title}</span>
                <span className="text-hint">{money(i.price * i.qty)}</span>
              </li>
            ))}
          </ul>

          {o.customer.phone && (
            <div className="flex flex-col gap-0.5 rounded-xl bg-page px-3 py-2.5 text-sm leading-[19px]">
              <span>
                <b>{o.customer.name}</b> · {phone(o.customer.phone)}
                {o.customer.phoneFromTelegram && <span className="text-hint"> · из Telegram</span>}
              </span>
              {o.address && <span className="text-[#4a4a52]">{o.address}</span>}
              {o.comment && <span className="text-[#4a4a52]">«{o.comment}»</span>}
              {o.location?.accuracy && o.location.accuracy > 50 && (
                <span className="text-warn-ink">
                  Точка неточная: ±{Math.round(o.location.accuracy)} м
                </span>
              )}
            </div>
          )}

          {!finished && o.customer.phone && (
            <div className={`grid gap-2 ${o.customer.username ? "grid-cols-3" : "grid-cols-2"}`}>
              <CopyPhone phone={o.customer.phone} />
              {o.customer.username && (
                <SecondaryButton
                  onClick={() => openTelegram(`https://t.me/${o.customer.username}`)}
                >
                  <MessageCircle size={16} /> Написать
                </SecondaryButton>
              )}
              {o.location && (
                <SecondaryButton onClick={() => o.location && openExternal(o.location.mapsUrl)}>
                  <MapPin size={16} /> Карта
                </SecondaryButton>
              )}
            </div>
          )}
        </>
      )}

      {mode === "manager" && o.courier && !finished && (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-hint">
            Курьер: <b className="text-ink">{o.courier.name}</b>
            {o.status === "processing" && " — заберёт, когда будет готово"}
          </span>
          {o.status === "processing" && (
            <button
              type="button"
              className="font-semibold text-accent"
              onClick={() => setSheet("assign")}
            >
              Сменить
            </button>
          )}
        </div>
      )}
      {o.cancelReason && <span className="text-sm text-hint">{o.cancelReason}</span>}

      {/* Покупатель просит отменить — отмена главной кнопкой, искать в «⋯» не нужно. */}
      {mode === "manager" && o.cancelRequested && !finished && (
        <button
          type="button"
          onClick={() => setSheet("cancel")}
          className="h-11 rounded-xl bg-[#fdecec] font-bold text-[#b42318] lg:rounded-[10px]"
        >
          Отменить заказ
        </button>
      )}
      {primary && !(mode === "manager" && o.cancelRequested) && (
        <PrimaryButton
          tone={mode === "courier" && o.status === "shipping" ? "ok" : "accent"}
          compactOnDesktop
          loading={act.isPending}
          onClick={() =>
            "action" in primary ? act.mutate(primary.action) : setSheet(primary.open)
          }
        >
          {primary.label}
        </PrimaryButton>
      )}
      <FieldError message={error ?? undefined} />

      {sheet === "menu" && (
        <Sheet title={`Заказ #${o.id}`} onClose={() => setSheet(null)}>
          {mode === "manager" && o.status === "processing" && o.courier && (
            <SecondaryButton onClick={() => act.mutate({ action: "pickup" })}>
              Курьер забрал заказ
            </SecondaryButton>
          )}
          {mode === "manager" && o.status === "shipping" && (
            <SecondaryButton onClick={() => act.mutate({ action: "deliver" })}>
              Отметить: доставлен
            </SecondaryButton>
          )}
          {(o.status === "shipping" || o.status === "processing") && mode === "courier" && (
            <SecondaryButton onClick={() => setSheet("fail")}>
              Не получилось доставить
            </SecondaryButton>
          )}
          {mode === "manager" && (
            <SecondaryButton tone="danger" onClick={() => setSheet("cancel")}>
              Отменить заказ
            </SecondaryButton>
          )}
          <FieldError message={error ?? undefined} />
        </Sheet>
      )}
      {sheet === "cancel" && (
        <ReasonSheet
          title={`Отменить заказ #${o.id}?`}
          hint="Причина уйдёт покупателю"
          reasons={CANCEL_REASONS}
          labels={CANCEL_REASON_LABELS}
          confirm="Отменить заказ"
          pending={act.isPending}
          error={error}
          onClose={() => setSheet(null)}
          onConfirm={(reason: CancelReason, comment) =>
            act.mutate({ action: "cancel", reason, ...(comment && { comment }) })
          }
        />
      )}
      {sheet === "fail" && (
        <ReasonSheet
          title="Что случилось?"
          hint="Заказ вернётся менеджеру"
          reasons={DELIVERY_FAILURE_REASONS}
          labels={DELIVERY_FAILURE_LABELS}
          confirm="Сообщить менеджеру"
          pending={act.isPending}
          error={error}
          onClose={() => setSheet(null)}
          onConfirm={(reason: DeliveryFailureReason, comment) =>
            act.mutate({ action: "fail", reason, ...(comment && { comment }) })
          }
        />
      )}
      {sheet === "assign" && (
        <AssignSheet
          current={o.courier?.id ?? null}
          pending={act.isPending}
          error={error}
          onClose={() => setSheet(null)}
          onPick={(courierId) => act.mutate({ action: "assign", courierId })}
        />
      )}
    </article>
  );
}

/**
 * Строка колонки «Готово» на компьютере: №, статус цветом, «★ 4», время · имя · курьер, сумма.
 * Непрочитанный отзыв — отдельной строкой-карточкой с рамкой (boxed).
 */
export function DoneRow({
  order: o,
  boxed,
  onOpen,
}: {
  order: StaffOrder;
  boxed: boolean;
  onOpen: () => void;
}) {
  const money = useMoney();
  const cancelled = o.status === "cancelled";
  const time = new Date(o.updatedAt).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const meta = [time, o.customer.name, o.courier && `курьер ${o.courier.name}`]
    .filter(Boolean)
    .join(" · ");
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-center gap-2.5 px-3.5 py-3 text-left ${
        boxed
          ? "rounded-[14px] bg-card shadow-[inset_0_0_0_2px_var(--accent)]"
          : "border-b border-[#f0f0f2] last:border-b-0"
      }`}
    >
      <span className="w-[52px] flex-none font-bold">#{o.id}</span>
      <span className="flex min-w-0 flex-1 flex-col leading-[18px]">
        <span className="flex items-center gap-1.5">
          <span className={`text-[13px] font-semibold ${cancelled ? "text-[#b42318]" : "text-ok"}`}>
            {ORDER_STATUS_LABELS[o.status]}
          </span>
          {o.review && <RatingChip rating={o.review.rating} fresh={!o.review.seen} />}
        </span>
        <span className="truncate text-xs text-hint">{meta}</span>
      </span>
      <span className={`flex-none font-semibold ${cancelled ? "text-[#a1a1aa]" : ""}`}>
        {money(o.total)}
      </span>
    </button>
  );
}

function StatusChip({ order: o, waiting }: { order: StaffOrder; waiting: number | null }) {
  if (waiting !== null) {
    return (
      <span className="flex h-6 items-center gap-1 rounded-lg bg-accent-soft px-2 text-[13px] font-bold whitespace-nowrap text-accent-ink">
        <Clock size={13} /> ждёт {waiting} мин
      </span>
    );
  }
  // Цвета — по макетам (StaffOrders — телефон, AdminOrdersBoard — компьютер).
  const tone = {
    new: "bg-muted text-ink",
    processing: "bg-[#fdf1dc] text-[#6b3f05] lg:bg-[#fef3e2] lg:text-[#92400e]",
    shipping: "bg-[#e4eefa] text-[#1a5cab]",
    done: "bg-[#e3f2e7] text-[#17753a]",
    cancelled: "bg-muted text-hint",
  }[o.status];
  return (
    <span className={`flex h-6 items-center rounded-lg px-2 text-[13px] font-semibold ${tone}`}>
      {ORDER_STATUS_LABELS[o.status]}
    </span>
  );
}

function reviewTime(iso: string) {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Покупателю ещё ничего не доставляли. Цвет — по макетам StaffOrders и AdminOrdersBoard. */
function FirstOrderChip() {
  return (
    <span className="flex h-6 items-center rounded-lg bg-[#efe8fb] px-2 text-[13px] font-semibold whitespace-nowrap text-[#5b3aa8] lg:h-5 lg:rounded-md lg:px-1.5 lg:text-xs">
      Первый заказ
    </span>
  );
}

/** «★ 4» у статуса; новый (непрочитанный) отзыв — мягкий чип с подписью. */
export function RatingChip({ rating, fresh }: { rating: number; fresh: boolean }) {
  if (!fresh) {
    return (
      <span className="flex items-center gap-0.5 text-xs font-semibold text-hint">
        <Star size={11} className="fill-accent text-accent" /> {rating}
      </span>
    );
  }
  return (
    <span className="flex h-6 items-center gap-1 rounded-lg bg-accent-soft px-2 text-[13px] font-bold whitespace-nowrap text-accent-ink lg:h-5 lg:rounded-md lg:px-1.5 lg:text-xs">
      <Star size={12} className="fill-current" /> {rating} · новый отзыв
    </span>
  );
}

function ReasonSheet<R extends string>({
  title,
  hint,
  reasons,
  labels,
  confirm,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  title: string;
  hint: string;
  reasons: readonly R[];
  labels: Record<R, string>;
  confirm: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (reason: R, comment: string) => void;
}) {
  const [reason, setReason] = useState<R | null>(null);
  const [comment, setComment] = useState("");
  return (
    <Sheet title={title} onClose={onClose}>
      <span className="text-[13px] text-hint">{hint}</span>
      <div className="flex flex-col gap-2">
        {reasons.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReason(r)}
            className={`h-11 rounded-xl px-3.5 text-left font-medium ${
              reason === r
                ? "bg-accent-soft text-accent-ink shadow-[inset_0_0_0_2px_var(--accent)]"
                : "bg-page"
            }`}
          >
            {labels[r]}
          </button>
        ))}
      </div>
      {reason === "other" && (
        <textarea
          rows={2}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Опишите причину"
          maxLength={500}
          className="resize-none rounded-xl border border-line bg-card px-3.5 py-3 outline-none"
        />
      )}
      <PrimaryButton
        loading={pending}
        disabled={!reason || (reason === "other" && !comment.trim())}
        onClick={() => reason && onConfirm(reason, comment.trim())}
      >
        {confirm}
      </PrimaryButton>
      <FieldError message={error ?? undefined} />
    </Sheet>
  );
}

function AssignSheet({
  current,
  pending,
  error,
  onClose,
  onPick,
}: {
  current: number | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onPick: (id: number) => void;
}) {
  const couriers = useQuery({ queryKey: ["couriers"], queryFn: api.couriers });
  return (
    <Sheet title="Кому передать?" onClose={onClose}>
      {couriers.data?.couriers.length === 0 && (
        <span className="text-sm text-hint">
          Курьеров пока нет — пригласите в разделе «Команда».
        </span>
      )}
      {couriers.data?.couriers.map((c) => (
        <button
          key={c.id}
          type="button"
          disabled={pending}
          onClick={() => onPick(c.id)}
          className={`h-12 rounded-xl px-3.5 text-left font-semibold ${
            c.id === current ? "bg-accent-soft text-accent-ink" : "bg-page"
          }`}
        >
          {c.name}
          {c.id === current && " · сейчас"}
        </button>
      ))}
      <FieldError message={error ?? undefined} />
    </Sheet>
  );
}

/** Номер покупателя в буфер: дальше — звонок из телефона, Zalo или WhatsApp. */
function CopyPhone({ phone }: { phone: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <SecondaryButton
      onClick={async () => {
        if (await copyText(phone)) {
          haptic.success();
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      }}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
      {copied ? "Скопирован" : "Номер"}
    </SecondaryButton>
  );
}
