/**
 * Меню — одна лента по разделам, вкладки категорий закреплены сверху (как в Grab Food):
 * нажал вкладку — лента прокрутилась к разделу; листаешь — вкладка подсвечивается сама.
 */
import {
  discountPercent,
  isFinalStatus,
  MAX_QTY_PER_ITEM,
  ORDER_STATUS_LABELS,
} from "@store/schema";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronRight, ReceiptText, UtensilsCrossed } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AddButton, BottomBar, Screen, Stepper } from "../components/ui.tsx";
import { api, type Product } from "../lib/api.ts";
import { useCart } from "../lib/cart.ts";
import { statusText, useCartLines, useMoney, useReadyShop } from "../lib/shop.ts";

export function MenuScreen() {
  const shop = useReadyShop();
  const { categories, products } = shop.catalog;
  const status = statusText(shop.status, shop.hours);
  const { count, total } = useCartLines();
  const money = useMoney();
  const orders = useQuery({ queryKey: ["orders"], queryFn: api.orders });
  const active = orders.data?.orders.find((o) => !isFinalStatus(o.status));

  const sections = useMemo(
    () =>
      categories
        .map((c) => ({ ...c, items: products.filter((p) => p.categoryId === c.id) }))
        .filter((s) => s.items.length > 0),
    [categories, products],
  );

  const [current, setCurrent] = useState(sections[0]?.id ?? "");
  const tabsRef = useRef<HTMLElement>(null);
  const clickedAt = useRef(0);

  // Подсветка вкладки по прокрутке.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() - clickedAt.current < 800) return;
        const visible = entries.filter((e) => e.isIntersecting);
        const top = visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setCurrent(top.target.id.replace(/^sec-/, ""));
      },
      { rootMargin: "-100px 0px -60% 0px" },
    );
    for (const s of sections) {
      const el = document.getElementById(`sec-${s.id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);

  // Активная вкладка всегда видна в ленте вкладок.
  useEffect(() => {
    tabsRef.current
      ?.querySelector(`[data-tab="${current}"]`)
      ?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [current]);

  const goTo = (id: string) => {
    clickedAt.current = Date.now();
    setCurrent(id);
    const el = document.getElementById(`sec-${id}`);
    if (!el) return;
    const offset = (tabsRef.current?.offsetHeight ?? 0) + 4;
    window.scrollTo({
      top: el.getBoundingClientRect().top + window.scrollY - offset,
      behavior: "smooth",
    });
  };

  return (
    <Screen>
      <header className="flex items-center gap-3 bg-card px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h1 className="m-0 truncate text-[17px] leading-[22px] font-bold">{shop.shop.name}</h1>
          <span className="text-[13px] leading-[18px] text-hint">
            <span className={`font-semibold ${status.open ? "text-ok" : "text-ink"}`}>
              {status.text}
            </span>
            {" · доставка бесплатно"}
          </span>
        </div>
        {orders.data && orders.data.orders.length > 0 && (
          <Link
            to="/orders"
            aria-label="Мои заказы"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-page text-accent"
          >
            <ReceiptText size={20} />
          </Link>
        )}
      </header>

      {active && (
        <Link
          to="/orders/$id"
          params={{ id: String(active.id) }}
          className="flex items-center gap-3 bg-accent-soft px-4 py-2.5 text-accent-ink"
        >
          <span className="flex-1 text-sm font-semibold">
            Заказ #{active.id} · {ORDER_STATUS_LABELS[active.status]}
          </span>
          <ChevronRight size={18} />
        </Link>
      )}

      {sections.length > 1 && (
        <nav
          ref={tabsRef}
          aria-label="Разделы меню"
          className="no-scrollbar sticky top-0 z-10 flex gap-5 overflow-x-auto border-b border-line bg-card px-4"
        >
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              data-tab={s.id}
              aria-current={current === s.id}
              onClick={() => goTo(s.id)}
              className={`flex h-11 flex-none items-center border-b-[3px] whitespace-nowrap ${
                current === s.id
                  ? "border-accent font-bold text-accent"
                  : "border-transparent font-medium text-hint"
              }`}
            >
              {s.title}
            </button>
          ))}
        </nav>
      )}

      <main className="flex flex-col gap-1 pb-28">
        {sections.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-8 py-24 text-center text-hint">
            <UtensilsCrossed size={36} />
            Меню скоро появится
          </div>
        )}
        {sections.map((s) => (
          <section key={s.id} id={`sec-${s.id}`} className="flex flex-col">
            <h2 className="m-0 px-4 pt-4 pb-2 text-xl leading-[26px] font-bold">{s.title}</h2>
            <div className="flex flex-col bg-card">
              {s.items.map((p) => (
                <DishRow key={p.id} product={p} />
              ))}
            </div>
          </section>
        ))}
      </main>

      {count > 0 && (
        <BottomBar>
          <Link
            to="/cart"
            className="flex h-[52px] items-center justify-between rounded-[14px] bg-accent px-[18px] text-base font-semibold text-white"
          >
            <span>Корзина · {count}</span>
            <span>{money(total)}</span>
          </Link>
        </BottomBar>
      )}
    </Screen>
  );
}

/** Значения характеристик, которые показываются в карточке (порция и т. п.). */
function useCardAttributes(product: Product): string[] {
  const { catalog } = useReadyShop();
  return catalog.attributes
    .filter((a) => a.showInCard && product.attributes[a.key] !== undefined)
    .map((a) => {
      const v = product.attributes[a.key];
      const text = Array.isArray(v)
        ? v.join(", ")
        : typeof v === "boolean"
          ? v
            ? a.label
            : ""
          : String(v);
      return "unit" in a && a.unit ? `${text} ${a.unit}` : text;
    })
    .filter(Boolean);
}

export function DishImage({ product, size }: { product: Product; size: number }) {
  return (
    <div
      className="relative flex flex-none items-center justify-center overflow-hidden rounded-[14px] bg-accent-soft text-accent-ink"
      style={{ width: size, height: size }}
    >
      {product.image ? (
        <img
          src={product.image.url}
          alt={product.image.alt ?? ""}
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : (
        <UtensilsCrossed size={size * 0.36} strokeWidth={1.6} />
      )}
    </div>
  );
}

function DishRow({ product: p }: { product: Product }) {
  const money = useMoney();
  const qty = useCart((s) => s.items[p.id] ?? 0);
  const add = useCart((s) => s.add);
  const remove = useCart((s) => s.remove);
  const attrs = useCardAttributes(p);
  const badge = p.badges[0];

  return (
    <article
      className={`flex gap-3 border-b border-line px-4 py-3 last:border-b-0 ${p.available ? "" : "opacity-55"}`}
    >
      <div className="relative">
        <DishImage product={p} size={92} />
        {badge && (
          <span className="absolute top-1.5 left-1.5 flex h-5 items-center rounded-md bg-white px-1.5 text-[11px] font-bold text-[#8f3520]">
            {badge}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h3 className="m-0 text-[15px] leading-5 font-semibold">{p.title}</h3>
        {p.description && (
          <p className="m-0 line-clamp-2 text-[13px] leading-[17px] text-hint">{p.description}</p>
        )}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="text-[15px] font-bold">{money(p.price)}</span>
            {p.compareAtPrice !== undefined && (
              <>
                <span className="text-[13px] text-hint line-through">
                  {money(p.compareAtPrice)}
                </span>
                <span className="inline-flex h-[18px] items-center rounded-[5px] bg-[#c2410c] px-1.5 text-[11px] font-bold text-white">
                  −{discountPercent(p.price, p.compareAtPrice)}%
                </span>
              </>
            )}
            {attrs.length > 0 && <span className="text-xs text-hint">{attrs.join(" · ")}</span>}
          </div>
          {!p.available ? (
            <span className="flex h-8 flex-none items-center rounded-[10px] bg-muted px-2.5 text-[13px] font-semibold text-hint">
              Закончилось
            </span>
          ) : qty > 0 ? (
            <Stepper
              qty={qty}
              max={MAX_QTY_PER_ITEM}
              onAdd={() => add(p.id)}
              onRemove={() => remove(p.id)}
            />
          ) : (
            <AddButton label={p.title} onClick={() => add(p.id)} />
          )}
        </div>
      </div>
    </article>
  );
}
