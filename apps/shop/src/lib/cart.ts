/**
 * Корзина и черновик оформления — в localStorage: закрыли Mini App и вернулись — всё на месте.
 * Цены здесь не хранятся: они всегда из актуального меню (а при заказе — из БД сервера).
 */
import { MAX_QTY_PER_ITEM } from "@store/schema";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type DraftLocation = {
  lat: number;
  lng: number;
  accuracy?: number | undefined;
  source: "pin" | "gps" | "link";
};

export type Draft = {
  name: string;
  phone: string;
  phoneFromTelegram: boolean;
  location: DraftLocation | null;
  address: string;
  comment: string;
};

type CartState = {
  items: Record<string, number>;
  draft: Draft;
  add: (id: string) => void;
  remove: (id: string) => void;
  drop: (id: string) => void;
  clear: () => void;
  setDraft: (patch: Partial<Draft>) => void;
};

const emptyDraft: Draft = {
  name: "",
  phone: "",
  phoneFromTelegram: false,
  location: null,
  address: "",
  comment: "",
};

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      items: {},
      draft: emptyDraft,
      add: (id) =>
        set((s) => ({
          items: { ...s.items, [id]: Math.min((s.items[id] ?? 0) + 1, MAX_QTY_PER_ITEM) },
        })),
      remove: (id) =>
        set((s) => {
          const qty = (s.items[id] ?? 0) - 1;
          const { [id]: _, ...rest } = s.items;
          return { items: qty > 0 ? { ...s.items, [id]: qty } : rest };
        }),
      drop: (id) =>
        set((s) => {
          const { [id]: _, ...rest } = s.items;
          return { items: rest };
        }),
      clear: () => set({ items: {} }),
      setDraft: (patch) => set((s) => ({ draft: { ...s.draft, ...patch } })),
    }),
    { name: "store-cart", version: 1 },
  ),
);
