/**
 * Экран «Заказы» — рабочее место менеджера и курьера на телефоне. Всё на одном экране:
 * приём заказов и пауза, вкладки Новые · В работе · Готово, карточки раскрываются на месте.
 * Пока экран открыт, новые заказы появляются сами — со звуком и вибрацией.
 */
import { PAUSE_LABELS, type PauseOption } from "@store/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type Mode, OrderCard } from "../components/OrderCard.tsx";
import { FieldError, SecondaryButton, Sheet, Spinner } from "../components/ui.tsx";
import { api, type Board } from "../lib/api.ts";
import { useStaff } from "../lib/session.ts";
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

      {pauseSheet && (
        <Sheet title="Пауза приёма заказов" onClose={() => setPauseSheet(false)}>
          <span className="text-[13px] text-hint">
            Меню остаётся открытым, оформить заказ нельзя. Пауза снимется сама.
          </span>
          {(["30m", "1h", "today"] as const).map((p) => (
            <SecondaryButton key={p} disabled={pause.isPending} onClick={() => pause.mutate(p)}>
              {PAUSE_LABELS[p]}
            </SecondaryButton>
          ))}
          {b.status && !b.status.open && b.status.reason === "paused" && (
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
      )}
    </div>
  );
}
