import { can, formatMoney, type Permission } from "@store/schema";
import { useQuery } from "@tanstack/react-query";
import { api, type Me } from "./api.ts";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: api.me, retry: false, staleTime: 60_000 });
}

/** Текущий сотрудник (экраны рендерятся только после входа). */
export function useStaff(): Me & { can: (p: Permission) => boolean } {
  const { data } = useMe();
  if (!data) throw new Error("Не выполнен вход");
  return { ...data, can: (p) => can(data.roles, p) };
}

export function useShopInfo() {
  return useQuery({ queryKey: ["shop"], queryFn: api.shop, staleTime: 60_000 });
}

export function useMoney() {
  const { data } = useShopInfo();
  return (minor: number) =>
    data?.ready ? formatMoney(minor, data.region.currency, data.region.locale) : String(minor);
}
