/**
 * Уведомления о заказах. Сервис заказов только сообщает, что произошло; кому и что написать,
 * решает реализация (бот — src/bot/notifier.ts). Вызов не ждёт отправки и не падает.
 */
export type OrderNotice =
  | { type: "created"; orderId: number }
  | { type: "accepted"; orderId: number; actorId: number }
  | {
      type: "courier_assigned";
      orderId: number;
      courierId: number;
      previousCourierId: number | null;
    }
  /** «Курьер в пути», «Доставлен», «Отменён» (actorId null — отменил покупатель). */
  | { type: "status"; orderId: number; actorId: number | null }
  | { type: "cancel_requested"; orderId: number }
  | { type: "delivery_failed"; orderId: number; actorId: number }
  | { type: "reminder"; orderId: number; waitingMinutes: number };

export interface Notifier {
  notify(notice: OrderNotice): void;
}

export const silentNotifier: Notifier = { notify() {} };
