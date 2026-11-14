import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { Store } from "lucide-react";
import { useEffect } from "react";
import { Screen, Spinner } from "./components/ui.tsx";
import { useShop } from "./lib/shop.ts";
import { setBackButton } from "./lib/telegram.ts";
import { CartScreen } from "./screens/CartScreen.tsx";
import { CheckoutScreen } from "./screens/CheckoutScreen.tsx";
import { MenuScreen } from "./screens/MenuScreen.tsx";
import { OrderScreen } from "./screens/OrderScreen.tsx";
import { OrdersScreen } from "./screens/OrdersScreen.tsx";

/** Нативная кнопка «Назад» Telegram: на всех экранах, кроме меню. */
function useTelegramBack() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(
    () =>
      setBackButton(pathname !== "/", () => {
        // Открыли сразу экран заказа из сообщения бота — истории нет, ведём в меню.
        if (window.history.state?.__TSR_index > 0) router.history.back();
        else router.navigate({ to: "/", replace: true });
      }),
    [pathname, router],
  );
  // Новый экран — сверху.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
}

function Root() {
  useTelegramBack();
  const shop = useShop();
  if (shop.isPending) return <Spinner />;
  if (shop.isError) {
    return (
      <Screen>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-hint">
          {shop.error.message}
          <button
            type="button"
            className="font-semibold text-accent"
            onClick={() => shop.refetch()}
          >
            Повторить
          </button>
        </div>
      </Screen>
    );
  }
  if (!shop.data.ready) {
    return (
      <Screen>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-hint">
          <Store size={40} />
          Магазин скоро откроется
        </div>
      </Screen>
    );
  }
  return <Outlet />;
}

const rootRoute = createRootRoute({ component: Root });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: MenuScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: "/cart", component: CartScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: "/checkout", component: CheckoutScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: "/orders", component: OrdersScreen }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/orders/$id",
    component: function OrderRoute() {
      const id = Number(useRouterState({ select: (s) => s.location.pathname.split("/").pop() }));
      return <OrderScreen id={id} />;
    },
  }),
]);

export const router = createRouter({ routeTree, defaultPreload: false });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
