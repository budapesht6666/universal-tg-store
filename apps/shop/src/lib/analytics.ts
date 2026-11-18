/**
 * Аналитика магазина: заход (с параметром startapp), страница блюда, «в корзину», оформление
 * и снимок корзины для суммы брошенных корзин. Всё отправляется в фоне, пачками; ошибки молча
 * игнорируются — покупателю аналитика не мешает никогда. Экраны ничего не знают: страницы
 * отслеживаются по переходам роутера, корзина — подпиской на её хранилище.
 */
import type { AnalyticsEvent } from "@store/schema";
import { useCart } from "./cart.ts";
import { authHeader, startParam } from "./telegram.ts";

const FLUSH_MS = 1500;
const CART_DEBOUNCE_MS = 2000;

const queue: AnalyticsEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let started = false;

function post(path: string, body: unknown): void {
  const headers = authHeader();
  if (!headers.authorization) return;
  fetch(`/api${path}`, {
    method: "POST",
    keepalive: true,
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

function flush(): void {
  clearTimeout(flushTimer);
  flushTimer = undefined;
  while (queue.length > 0) post("/events", { events: queue.splice(0, 50) });
}

export function track(event: AnalyticsEvent): void {
  queue.push(event);
  flushTimer ??= setTimeout(flush, FLUSH_MS);
}

/** Переходы, которые считаем: страница блюда и форма оформления. */
type RouterLike = {
  subscribe: (
    event: "onResolved",
    fn: (e: { toLocation: { pathname: string } }) => void,
  ) => () => void;
};

/** Один раз при запуске Mini App. */
export function startAnalytics(router: RouterLike): void {
  if (started) return;
  started = true;

  const source = startParam();
  track({ type: "visit", ...(source && { source }) });

  let lastPath = "";
  router.subscribe("onResolved", ({ toLocation }) => {
    const path = toLocation.pathname;
    if (path === lastPath) return;
    lastPath = path;
    const dish = /^\/dish\/([a-z0-9-]+)$/.exec(path);
    if (dish?.[1]) track({ type: "dish_view", productId: dish[1] });
    else if (path === "/checkout") track({ type: "checkout_open" });
  });

  // Корзина уже восстановлена из localStorage — дальше смотрим только изменения покупателя.
  const added = new Set<string>();
  let cartTimer: ReturnType<typeof setTimeout> | undefined;
  useCart.subscribe((state, prev) => {
    if (state.items === prev.items) return;
    for (const [id, qty] of Object.entries(state.items)) {
      if (qty > (prev.items[id] ?? 0) && !added.has(id)) {
        added.add(id);
        track({ type: "cart_add", productId: id });
      }
    }
    clearTimeout(cartTimer);
    cartTimer = setTimeout(
      () => post("/cart", { items: useCart.getState().items }),
      CART_DEBOUNCE_MS,
    );
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}
