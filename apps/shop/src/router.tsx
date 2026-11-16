import { parseStartParam } from "@store/schema";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useParams,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { Store } from "lucide-react";
import { useEffect } from "react";
import { Screen, Spinner } from "./components/ui.tsx";
import { useShop } from "./lib/shop.ts";
import { setBackButton, startParam } from "./lib/telegram.ts";
import { CartScreen } from "./screens/CartScreen.tsx";
import { CheckoutScreen } from "./screens/CheckoutScreen.tsx";
import { DishScreen } from "./screens/DishScreen.tsx";
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
}

let startLinkHandled = false;

/**
 * Ссылка на блюдо (t.me/<бот>?startapp=dish_<id>): один раз при запуске открываем страницу
 * блюда так, чтобы под ней в истории было меню, — «Назад» ведёт в меню. Страница блюда
 * выключена (features.dishPage) — просто меню. Блюда нет — на странице блюда своя заглушка.
 */
function useStartLink(dishPage: boolean | undefined) {
  const router = useRouter();
  useEffect(() => {
    if (startLinkHandled || dishPage === undefined) return;
    startLinkHandled = true;
    const target = parseStartParam(startParam());
    if (!target) return;
    void (async () => {
      await router.navigate({ to: "/", replace: true });
      if (dishPage) await router.navigate({ to: "/dish/$id", params: { id: target.dishId } });
    })();
  }, [dishPage, router]);
}

function Root() {
  useTelegramBack();
  const shop = useShop();
  useStartLink(shop.data?.ready ? shop.data.features.dishPage : undefined);
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
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/dish/$id",
    component: function DishRoute() {
      const { id = "" } = useParams({ strict: false });
      return <DishScreen id={id} />;
    },
  }),
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

// Новый экран открывается сверху, а «Назад» возвращает меню на то место, где его листали.
export const router = createRouter({ routeTree, defaultPreload: false, scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
