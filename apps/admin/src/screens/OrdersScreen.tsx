/**
 * Экран «Заказы» — рабочее место менеджера и курьера на телефоне. Всё на одном экране:
 * приём заказов и пауза, вкладки Новые · В работе · Готово, карточки раскрываются на месте.
 * Пока экран открыт, новые заказы появляются сами — со звуком и вибрацией.
 */
import { PAUSE_LABELS, type PauseOption } from "@store/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DoneRow, type Mode, OrderCard } from "../components/OrderCard.tsx";
import { FieldError, SecondaryButton, Sheet, Spinner } from "../components/ui.tsx";
import { api, type Board, type StaffOrder } from "../lib/api.ts";
import { useIsDesktop } from "../lib/media.ts";
import { useMoney, useStaff } from "../lib/session.ts";
import { beep } from "../lib/telegram.ts";

type Tab = "new" | "active" | "done";

function statusLine(board: Board) {
  const s = board.status;
  if (!s) return { open: false, text: "Магазин не настроен" };
  if (s.open) return { open: true, text: `Принимаем заказы до ${s.closesAt}` };
  if (s.reason === "paused") {
    const until = board.pausedUntil
      ? new Date(board.pausedUntil).toLocaleTimeString("ru-RU", {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "";
    return { open: false, text: `Пауза${until ? ` до ${until}` : ""}` };
  }
  return { open: false, text: `Закрыто${s.opensAt ? ` · откроемся ${s.opensAt}` : ""}` };
}

export function OrdersScreen() {
  const staff = useStaff();
  const isManager = staff.can("orders.manage");
  const isCourier = staff.can("delivery.work");
  const [mode, setMode] = useState<Mode>(isManager ? "manager" : "courier");
  const [tab, setTab] = useState<Tab>(mode === "manager" ? "new" : "active");
  const [open, setOpen] = useState<number | null>(null);
  const [pauseSheet, setPauseSheet] = useState(false);
  const [, tick] = useState(0);
  const queryClient = useQueryClient();
  const desktop = useIsDesktop();

  const board = useQuery({
    queryKey: ["board", mode],
    queryFn: () => api.board(mode),
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });
  // Счётчик «Мои доставки» для того, кто и менеджер, и курьер.
  const mine = useQuery({
    queryKey: ["board", "courier"],
    queryFn: () => api.board("courier"),
    enabled: isManager && isCourier && mode === "manager",
    refetchInterval: 15_000,
  });

  // «ждёт 4 мин» обновляется раз в 30 секунд.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  // Новый заказ (или новая доставка курьеру) — звук и вибрация.
  const seen = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!board.data) return;
    const ids = (mode === "manager" ? board.data.new : board.data.active).map((o) => o.id);
    if (seen.current && ids.some((id) => !seen.current?.has(id))) beep();
    seen.current = new Set(ids);
  }, [board.data, mode]);

  const pause = useMutation({
    mutationFn: (p: PauseOption) => api.pause(p),
    onSuccess: () => {
      setPauseSheet(false);
      void queryClient.invalidateQueries({ queryKey: ["board"] });
      void queryClient.invalidateQueries({ queryKey: ["shop"] });
    },
  });

  const switchMode = (m: Mode) => {
    setMode(m);
    setTab(m === "manager" ? "new" : "active");
    setOpen(null);
    seen.current = null;
  };

  if (board.isPending) return <Spinner />;
  if (board.isError) {
    return <div className="p-8 text-center text-hint">{board.error.message}</div>;
  }
  const b = board.data;
  const status = statusLine(b);
  const list = b[tab];
  const expandedId = open ?? (tab !== "done" ? list[0]?.id : undefined) ?? null;
  const tabs: { key: Tab; label: string }[] =
    mode === "manager"
      ? [
          { key: "new", label: "Новые" },
          { key: "active", label: `В работе${b.active.length ? ` · ${b.active.length}` : ""}` },
          { key: "done", label: "Готово" },
        ]
      : [
          { key: "active", label: `Мои доставки${b.active.length ? ` · ${b.active.length}` : ""}` },
          { key: "done", label: "Доставлено" },
        ];

  const paused = !!b.status && !b.status.open && b.status.reason === "paused";
  const pauseSheetEl = pauseSheet && (
    <Sheet title="Пауза приёма заказов" onClose={() => setPauseSheet(false)}>
      <span className="flex flex-col text-[13px] text-hint">
        <span>Меню остаётся открытым, оформить заказ нельзя.</span>
        <span>Пауза снимется сама.</span>
      </span>
      {(["30m", "1h", "today"] as const).map((p) => (
        <SecondaryButton key={p} disabled={pause.isPending} onClick={() => pause.mutate(p)}>
          {PAUSE_LABELS[p]}
        </SecondaryButton>
      ))}
      {paused && (
        <SecondaryButton
          tone="accent"
          disabled={pause.isPending}
          onClick={() => pause.mutate("off")}
        >
          {PAUSE_LABELS.off}
        </SecondaryButton>
      )}
      <FieldError message={pause.error?.message} />
    </Sheet>
  );

  if (desktop) {
    const columns: { key: Tab; title: string; hint?: string }[] =
      mode === "manager"
        ? [
            { key: "new", title: "Новые" },
            { key: "active", title: "В работе" },
            { key: "done", title: "Готово", hint: "за сутки" },
          ]
        : [
            { key: "active", title: "Мои доставки" },
            { key: "done", title: "Доставлено", hint: "за сутки" },
          ];
    return (
      <div className="flex flex-col gap-4 px-7 py-6">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="m-0 flex-1 basis-40 text-2xl font-bold">Заказы</h1>
          {isManager && isCourier && (
            <div
              role="tablist"
              aria-label="Режим"
              className="flex gap-0.5 rounded-[10px] bg-muted p-[3px]"
            >
              {(["manager", "courier"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => switchMode(m)}
                  className={`h-8 rounded-lg px-3.5 ${
                    mode === m ? "bg-card font-semibold shadow-sm" : "font-medium text-hint"
                  }`}
                >
                  {m === "manager"
                    ? "Все заказы"
                    : `Мои доставки${mine.data?.active.length ? ` · ${mine.data.active.length}` : ""}`}
                </button>
              ))}
            </div>
          )}
          {mode === "manager" && (
            <div className="flex h-[38px] items-center gap-2.5 rounded-[10px] bg-card pr-1.5 pl-3.5 shadow-[inset_0_0_0_1px_var(--line)]">
              <span
                className={`h-2.5 w-2.5 flex-none rounded-full ${status.open ? "bg-ok" : "bg-hint"}`}
              />
              <span className="font-semibold">{status.text}</span>
              <button
                type="button"
                onClick={() => setPauseSheet(true)}
                className="flex h-7 items-center gap-1.5 rounded-[7px] bg-muted px-2.5 text-sm font-semibold"
              >
                {paused ? <Play size={14} /> : <Pause size={14} />}
                {paused ? "Снять паузу" : "Пауза"}
              </button>
            </div>
          )}
        </header>

        <div className="flex flex-wrap items-start gap-4">
          {columns.map((col) => {
            const orders = b[col.key];
            return (
              <section
                key={col.key}
                aria-label={col.title}
                className="flex min-w-0 flex-1 basis-[300px] flex-col gap-2.5"
              >
                <h2 className="m-0 flex items-center gap-2 px-1 text-[15px] leading-[22px] font-bold">
                  {col.title}
                  {col.hint ? (
                    <span className="text-[13px] font-medium text-hint">{col.hint}</span>
                  ) : (
                    orders.length > 0 && (
                      <span
                        className={`flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-[7px] text-xs font-bold ${
                          col.key === "new" ? "bg-accent text-white" : "bg-muted text-ink"
                        }`}
                      >
                        {orders.length}
                      </span>
                    )
                  )}
                </h2>
                {orders.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-[13px] text-hint">
                    {col.key === "new"
                      ? "Новых заказов нет"
                      : col.key === "active"
                        ? mode === "courier"
                          ? "Доставок пока нет — назначенные заказы появятся здесь"
                          : "В работе ничего нет"
                        : "За сутки ничего не закрыто"}
                  </div>
                )}
                {col.key === "done" ? (
                  <DoneColumn
                    orders={orders}
                    mode={mode}
                    open={open}
                    onOpen={(id) => setOpen(open === id ? null : id)}
                  />
                ) : (
                  orders.map((o) => <OrderCard key={o.id} order={o} mode={mode} expanded />)
                )}
                {col.key === "new" && (
                  <p className="m-0 flex flex-col px-1 text-xs leading-[17px] text-hint">
                    <span>Новые заказы появляются сами — со звуком, пока страница открыта.</span>
                    <span>Пока заказ не приняли, он обведён.</span>
                  </p>
                )}
              </section>
            );
          })}
        </div>
        {pauseSheetEl}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col">
      <div className="flex flex-col gap-2.5 border-b border-line bg-card px-4 pt-2 pb-3">
        {isManager && isCourier && (
          <div
            role="tablist"
            aria-label="Режим"
            className="grid grid-cols-2 gap-0.5 rounded-[11px] bg-muted p-[3px]"
          >
            {(["manager", "courier"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => switchMode(m)}
                className={`h-8 rounded-[9px] text-sm ${
                  mode === m ? "bg-card font-semibold shadow-sm" : "font-medium text-hint"
                }`}
              >
                {m === "manager"
                  ? "Все заказы"
                  : `Мои доставки${mine.data?.active.length ? ` · ${mine.data.active.length}` : ""}`}
              </button>
            ))}
          </div>
        )}
        {mode === "manager" && (
          <div className="flex items-center gap-2.5">
            <span
              className={`h-2.5 w-2.5 flex-none rounded-full ${status.open ? "bg-ok" : "bg-hint"}`}
            />
            <span className="flex-1 font-semibold">{status.text}</span>
            <button
              type="button"
              onClick={() => setPauseSheet(true)}
              className="flex h-[34px] items-center gap-1.5 rounded-[10px] bg-muted px-3 text-sm font-semibold"
            >
              {b.status && !b.status.open && b.status.reason === "paused" ? (
                <>
                  <Play size={14} /> Снять паузу
                </>
              ) : (
                <>
                  <Pause size={14} /> Пауза
                </>
              )}
            </button>
          </div>
        )}
      </div>

      <div
        role="tablist"
        aria-label="Заказы по этапам"
        className="no-scrollbar flex gap-2 overflow-x-auto px-4 pt-3 pb-1"
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => {
              setTab(t.key);
              setOpen(null);
            }}
            className={`flex h-9 flex-none items-center gap-1.5 rounded-full px-3.5 ${
              tab === t.key ? "bg-accent font-semibold text-white" : "bg-card font-medium"
            }`}
          >
            {t.label}
            {t.key === "new" && b.new.length > 0 && (
              <span
                className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold ${
                  tab === "new" ? "bg-white text-accent-ink" : "bg-accent text-white"
                }`}
              >
                {b.new.length}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2.5 px-4 pt-2 pb-6">
        {list.length === 0 && (
          <div className="py-12 text-center text-hint">
            {tab === "new"
              ? "Новых заказов нет"
              : tab === "active"
                ? mode === "courier"
                  ? "Доставок пока нет — назначенные заказы появятся здесь"
                  : "В работе ничего нет"
                : "За сутки ничего не закрыто"}
          </div>
        )}
        {list.map((o) => (
          <OrderCard
            key={o.id}
            order={o}
            mode={mode}
            expanded={expandedId === o.id}
            onToggle={() => setOpen(expandedId === o.id ? -1 : o.id)}
          />
        ))}
        {tab === "new" && (
          <p className="m-0 mt-1 text-center text-[13px] leading-[18px] text-hint">
            Новые заказы появляются сами — со звуком и вибрацией, пока экран открыт
          </p>
        )}
      </div>

      {pauseSheetEl}
    </div>
  );
}

/**
 * «Готово» на компьютере (макет AdminOrdersBoard): раскрытый заказ — карточкой,
 * непрочитанные отзывы — строками с рамкой, остальное — одним списком через разделитель.
 */
function DoneColumn({
  orders,
  mode,
  open,
  onOpen,
}: {
  orders: StaffOrder[];
  mode: Mode;
  open: number | null;
  onOpen: (id: number) => void;
}) {
  const money = useMoney();
  const rest = orders.filter((o) => o.id !== open && !(o.review && !o.review.seen));
  const delivered = orders.filter((o) => o.status === "done");
  return (
    <>
      {orders.map((o) =>
        o.id === open ? (
          <OrderCard key={o.id} order={o} mode={mode} expanded onToggle={() => onOpen(o.id)} />
        ) : o.review && !o.review.seen ? (
          <DoneRow key={o.id} order={o} boxed onOpen={() => onOpen(o.id)} />
        ) : null,
      )}
      {rest.length > 0 && (
        <div className="flex flex-col overflow-hidden rounded-[14px] bg-card shadow-[inset_0_0_0_1px_var(--line)]">
          {rest.map((o) => (
            <DoneRow key={o.id} order={o} boxed={false} onOpen={() => onOpen(o.id)} />
          ))}
        </div>
      )}
      {mode === "manager" && orders.some((o) => o.review) && (
        <p className="m-0 flex flex-col px-1 text-xs leading-[17px] text-hint">
          <span>
            Новый отзыв подсвечен, пока заказ не раскрыли. Звука нет — это не новый заказ.
          </span>
          <span>Курьеру отзывы не показываются.</span>
        </p>
      )}
      {delivered.length > 0 && (
        <p className="m-0 px-1 text-xs leading-[17px] text-hint">
          Доставлено: {delivered.length} · {money(delivered.reduce((s, o) => s + o.total, 0))}
        </p>
      )}
    </>
  );
}
