/** Один заказ — по кнопке «Открыть» из сообщения бота. */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { OrderCard } from "../components/OrderCard.tsx";
import { Spinner } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { useStaff } from "../lib/session.ts";

export function OrderScreen({ id }: { id: number }) {
  const staff = useStaff();
  const order = useQuery({
    queryKey: ["order", id],
    queryFn: () => api.order(id),
    refetchInterval: 10_000,
  });
  if (order.isPending) return <Spinner />;
  if (order.isError) return <div className="p-8 text-center text-hint">{order.error.message}</div>;
  const mode =
    staff.can("orders.manage") && order.data.courier?.id !== staff.user.id ? "manager" : "courier";
  return (
    <div className="flex flex-col gap-3 p-4">
      <OrderCard order={order.data} mode={staff.can("orders.manage") ? mode : "courier"} expanded />
      <Link to="/" className="py-2 text-center font-semibold text-accent">
        Все заказы
      </Link>
    </div>
  );
}
