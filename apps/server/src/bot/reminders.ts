import type { Deps } from "../deps.ts";
import { dueReminders, dueWaitingNotices } from "../orders/service.ts";

/**
 * Раз в 30 секунд ищем непринятые заказы: команде — напоминание каждые 3 минуты,
 * покупателю — одно сообщение, если заказ не приняли за 15 минут.
 */
export function startReminders(deps: Deps): () => void {
  const timer = setInterval(() => {
    try {
      for (const { order, waitingMinutes } of dueReminders(deps)) {
        deps.notifier.notify({ type: "reminder", orderId: order.id, waitingMinutes });
      }
      for (const order of dueWaitingNotices(deps)) {
        deps.notifier.notify({ type: "waiting", orderId: order.id });
      }
    } catch (err) {
      console.error("Напоминания:", err);
    }
  }, 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
