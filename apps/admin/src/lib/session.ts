import { can, formatMoney, formatPhone, type Permission } from "@store/schema";
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

/** Телефон для показа: «+84 91 234 56 78» (код страны — из настроек магазина). */
export function usePhone() {
  const { data } = useShopInfo();
  const code = data?.ready ? data.region.phoneCode : "84";
  return (phone: string) => formatPhone(phone, code);
}

export function useMoney() {
  const { data } = useShopInfo();
  return (minor: number) =>
    data?.ready ? formatMoney(minor, data.region.currency, data.region.locale) : String(minor);
}
