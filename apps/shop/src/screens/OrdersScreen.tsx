import { isFinalStatus, ORDER_STATUS_LABELS } from "@store/schema";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { Screen, Spinner } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { useMoney } from "../lib/shop.ts";

export function OrdersScreen() {
  const money = useMoney();
  const orders = useQuery({ queryKey: ["orders"], queryFn: api.orders });
  if (orders.isPending) return <Spinner />;
  const list = orders.data?.orders ?? [];

  return (
    <Screen>
      <div className="flex flex-col gap-3 p-4">
        <h1 className="m-0 text-xl font-bold">Мои заказы</h1>
        {list.length === 0 && <span className="text-hint">Заказов пока нет</span>}
        <div className="flex flex-col overflow-hidden rounded-2xl bg-card">
          {list.map((o) => (
            <Link
              key={o.id}
              to="/orders/$id"
              params={{ id: String(o.id) }}
              className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">
                  #{o.id} · {money(o.total)}
                </span>
                <span className="truncate text-[13px] text-hint">
                  {new Date(o.createdAt).toLocaleDateString("ru-RU", {
                    day: "numeric",
                    month: "long",
                  })}{" "}
                  · {o.items.map((i) => i.title).join(", ")}
                </span>
              </div>
              <span
                className={`flex-none rounded-lg px-2 py-0.5 text-xs font-semibold ${
                  isFinalStatus(o.status) ? "bg-muted text-hint" : "bg-accent-soft text-accent-ink"
                }`}
              >
                {ORDER_STATUS_LABELS[o.status]}
              </span>
              <ChevronRight size={18} className="flex-none text-hint" />
            </Link>
          ))}
        </div>
      </div>
    </Screen>
  );
}
