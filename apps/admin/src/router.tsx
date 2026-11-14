import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Navigate,
  Outlet,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { ClipboardList, LogOut, Settings, Users, UtensilsCrossed } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { Spinner } from "./components/ui.tsx";
import { ApiError, api } from "./lib/api.ts";
import { useMe, useShopInfo, useStaff } from "./lib/session.ts";
import { isInTelegram, setBackButton } from "./lib/telegram.ts";
import { LoginHint, LoginScreen } from "./screens/LoginScreen.tsx";
import { MenuScreen } from "./screens/MenuScreen.tsx";
import { OrderScreen } from "./screens/OrderScreen.tsx";
import { OrdersScreen } from "./screens/OrdersScreen.tsx";
import { SettingsScreen } from "./screens/SettingsScreen.tsx";
import { SetupScreen } from "./screens/SetupScreen.tsx";
import { TeamScreen } from "./screens/TeamScreen.tsx";

const NAV = [
  {
    to: "/",
    label: "Заказы",
    icon: ClipboardList,
    show: (s: ReturnType<typeof useStaff>) => s.can("orders.manage") || s.can("delivery.work"),
  },
  {
    to: "/menu",
    label: "Меню",
    icon: UtensilsCrossed,
    show: (s: ReturnType<typeof useStaff>) => s.can("catalog.manage"),
  },
  {
    to: "/team",
    label: "Команда",
    icon: Users,
    show: (s: ReturnType<typeof useStaff>) => s.can("team.manage"),
  },
  {
    to: "/settings",
    label: "Настройки",
    icon: Settings,
    show: (s: ReturnType<typeof useStaff>) => s.can("settings.manage"),
  },
] as const;

function useTelegramBack() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(
    () =>
      setBackButton(pathname.startsWith("/orders/"), () => {
        router.navigate({ to: "/", replace: true });
      }),
    [pathname, router],
  );
}

function Shell() {
  const staff = useStaff();
  const shop = useShopInfo();
  const queryClient = useQueryClient();
  const items = NAV.filter((n) => n.show(staff));
  const name = shop.data?.ready ? shop.data.shop.name : "Магазин";

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen flex-col gap-1 border-r border-line bg-card p-3 lg:flex">
        <span className="px-3 pt-1 pb-3 text-lg font-bold">{name}</span>
        {items.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            activeOptions={{ exact: n.to === "/" }}
            className="flex h-10 items-center gap-2.5 rounded-xl px-3 font-medium text-ink"
            activeProps={{ className: "bg-accent-soft text-accent-ink font-semibold" }}
          >
            <n.icon size={18} /> {n.label}
          </Link>
        ))}
        <div className="mt-auto flex flex-col gap-1 px-3 text-[13px] text-hint">
          <span>{staff.user.firstName}</span>
          {!isInTelegram() && (
            <button
              type="button"
              onClick={async () => {
                await api.logout().catch(() => {});
                await queryClient.invalidateQueries({ queryKey: ["me"] });
              }}
              className="flex items-center gap-1.5 py-1 text-left font-semibold"
            >
              <LogOut size={14} /> Выйти
            </button>
          )}
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        {items.length > 1 && (
          <nav className="no-scrollbar sticky top-0 z-20 flex gap-1 overflow-x-auto border-b border-line bg-card px-2 lg:hidden">
            {items.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                activeOptions={{ exact: n.to === "/" }}
                className="flex h-11 flex-none items-center gap-1.5 border-b-[3px] border-transparent px-3 font-medium text-hint"
                activeProps={{ className: "border-accent! text-accent font-semibold" }}
              >
                <n.icon size={16} /> {n.label}
              </Link>
            ))}
          </nav>
        )}
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function Root() {
  useTelegramBack();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const me = useMe();
  const isOwner = me.data?.roles.includes("owner") ?? false;
  const setup = useQuery({ queryKey: ["setup"], queryFn: api.setupInfo, enabled: isOwner });

  if (pathname === "/login") return <LoginScreen />;
  if (me.isPending || (isOwner && setup.isPending)) return <Spinner />;
  if (me.isError) {
    return me.error instanceof ApiError && me.error.status === 401 ? (
      <LoginHint />
    ) : (
      <div className="p-8 text-center text-hint">{me.error.message}</div>
    );
  }
  if (me.data.roles.length === 0) {
    return (
      <div className="p-8 text-center text-hint">
        Нет доступа. Попросите владельца пригласить вас в команду.
      </div>
    );
  }
  if (setup.data?.needed && pathname !== "/setup") return <Navigate to="/setup" replace />;
  if (pathname === "/setup") return <Outlet />;
  return <Shell />;
}

function Guard({
  permission,
  children,
}: {
  permission: Parameters<ReturnType<typeof useStaff>["can"]>[0];
  children: ReactNode;
}) {
  const staff = useStaff();
  if (!staff.can(permission))
    return <div className="p-8 text-center text-hint">Нет доступа к этому разделу.</div>;
  return <>{children}</>;
}

const rootRoute = createRootRoute({ component: Root });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: OrdersScreen }),
  createRoute({ getParentRoute: () => rootRoute, path: "/login", component: () => null }),
  createRoute({ getParentRoute: () => rootRoute, path: "/setup", component: SetupScreen }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/orders/$id",
    component: function OrderRoute() {
      const id = Number(useRouterState({ select: (s) => s.location.pathname.split("/").pop() }));
      return <OrderScreen id={id} />;
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/menu",
    component: () => (
      <Guard permission="catalog.manage">
        <MenuScreen />
      </Guard>
    ),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/team",
    component: () => (
      <Guard permission="team.manage">
        <TeamScreen />
      </Guard>
    ),
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    component: () => (
      <Guard permission="settings.manage">
        <SettingsScreen />
      </Guard>
    ),
  }),
]);

export const router = createRouter({ routeTree, basepath: "/admin" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
