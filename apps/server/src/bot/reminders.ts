import type { Deps } from "../deps.ts";
import { dueReminders } from "../orders/service.ts";

/** Раз в 30 секунд ищем непринятые заказы, о которых пора напомнить (каждые 3 минуты). */
export function startReminders(deps: Deps): () => void {
  const timer = setInterval(() => {
    try {
      for (const { order, waitingMinutes } of dueReminders(deps)) {
        deps.notifier.notify({ type: "reminder", orderId: order.id, waitingMinutes });
      }
    } catch (err) {
      console.error("Напоминания:", err);
    }
  }, 30_000);
  timer.unref();
  return () => clearInterval(timer);
}
