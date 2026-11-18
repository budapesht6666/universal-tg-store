/**
 * Страница блюда: фото (свайп), метки, цена, описание целиком, характеристики (showInSpecs)
 * и нижняя панель «Добавить» / счётчик + корзина. Данные — из уже загруженного меню.
 * Открывается из меню, если включён флаг features.dishPage.
 */
import { discountPercent, inStock, lowStockLeft, maxOrderQty, portionsText } from "@store/schema";
import { Link, useNavigate } from "@tanstack/react-router";
import { Minus, Plus } from "lucide-react";
import { type ReactNode, useRef, useState, type WheelEvent } from "react";
import { BrandMark } from "../brand.tsx";
import { Screen } from "../components/ui.tsx";
import type { Product } from "../lib/api.ts";
import { useCart } from "../lib/cart.ts";
import { attributeText, useCartLines, useMoney, useReadyShop } from "../lib/shop.ts";
import { haptic } from "../lib/telegram.ts";

export function DishScreen({ id }: { id: string }) {
  const shop = useReadyShop();
  const product = shop.catalog.products.find((p) => p.id === id);
  if (!product) return <DishGone />;
  return <Dish product={product} />;
}

function Dish({ product: p }: { product: Product }) {
  const money = useMoney();
  const { catalog } = useReadyShop();
  const specs = catalog.attributes
    .filter((a) => a.showInSpecs && p.attributes[a.key] !== undefined)
    .map((a) => ({ key: a.key, label: a.label, value: attributeText(a, p.attributes[a.key]) }))
    .filter((s) => s.value);

  return (
    <Screen>
      <Photos product={p} />

      <section className="relative -mt-[20px] flex flex-1 flex-col gap-2.5 rounded-t-[20px] bg-card px-4 pt-[18px] pb-[calc(108px+var(--tg-viewport-safe-area-inset-bottom,0px))]">
        {p.badges.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {p.badges.map((b) => (
              <span
                key={b}
                className="flex h-6 items-center rounded-[7px] bg-accent-soft px-2 text-xs font-bold text-accent-ink"
              >
                {b}
              </span>
            ))}
          </div>
        )}
        <h1 className="m-0 text-2xl leading-[30px] font-bold [overflow-wrap:anywhere]">
          {p.title}
        </h1>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[22px] leading-7 font-bold">{money(p.price)}</span>
          {p.compareAtPrice !== undefined && (
            <>
              <span className="text-[15px] text-hint line-through">{money(p.compareAtPrice)}</span>
              <span className="inline-flex h-5 items-center self-center rounded-md bg-[#c2410c] px-1.5 text-xs font-bold text-white">
                −{discountPercent(p.price, p.compareAtPrice)}%
              </span>
            </>
          )}
          {!inStock(p) && (
            <span className="inline-flex h-6 items-center self-center rounded-[7px] bg-muted px-2 text-[13px] font-semibold text-hint">
              Закончилось
            </span>
          )}
        </div>
        <StockLeft product={p} />
        {p.description && (
          <p className="m-0 text-[15px] leading-[21px] whitespace-pre-line text-ink-soft [overflow-wrap:anywhere]">
            {p.description}
          </p>
        )}
        {specs.length > 0 && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            {specs.map((s) => (
              <div key={s.key} className="flex min-w-0 flex-col rounded-xl bg-page px-3 py-2.5">
                <span className="text-xs leading-4 text-hint">{s.label}</span>
                <span className="font-semibold [overflow-wrap:anywhere]">{s.value}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <DishBar product={p} />
    </Screen>
  );
}

/** Фото во всю ширину: свайп — горизонтальный scroll-snap, точки — при 2+ фото. */
function Photos({ product: p }: { product: Product }) {
  const stripRef = useRef<HTMLDivElement>(null);
  const [slide, setSlide] = useState(0);

  if (p.images.length === 0) {
    return (
      <div className="dish-placeholder flex aspect-[390/340] w-full flex-none items-center justify-center pb-5">
        <BrandMark className="w-[150px] drop-shadow-[0_4px_6px_rgb(143_53_32/0.18)]" />
      </div>
    );
  }

  const goTo = (i: number) => {
    const el = stripRef.current;
    if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
  };
  // Зоны лежат поверх ленты, а не в ней: горизонтальную прокрутку трекпада передаём ленте.
  const wheelToStrip = (e: WheelEvent<HTMLButtonElement>) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) stripRef.current?.scrollBy({ left: e.deltaX });
  };

  return (
    // overflow-hidden: иначе квадратное фото с h-full распирает блок до квадрата.
    <div className="relative aspect-[390/340] w-full flex-none overflow-hidden bg-muted">
      <div
        ref={stripRef}
        className="no-scrollbar flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
        onScroll={(e) => {
          const el = e.currentTarget;
          setSlide(Math.round(el.scrollLeft / Math.max(el.clientWidth, 1)));
        }}
      >
        {p.images.map((img, i) => (
          <img
            key={img.url}
            src={img.url}
            alt={img.alt ?? (p.images.length > 1 ? `${p.title}, фото ${i + 1}` : p.title)}
            loading={i === 0 ? "eager" : "lazy"}
            draggable={false}
            className="h-full w-full flex-none snap-center snap-always object-cover"
          />
        ))}
      </div>
      {/*
       * Зоны «предыдущее / следующее» по трети ширины — для мыши и трекпада (ПК, Telegram Desktop).
       * На сенсорных экранах их нет: кнопка поверх ленты забрала бы касание, и свайп по краям
       * перестал бы работать.
       */}
      {p.images.length > 1 && (
        <>
          <button
            type="button"
            aria-label="Предыдущее фото"
            disabled={slide === 0}
            onClick={() => goTo(slide - 1)}
            onWheel={wheelToStrip}
            className="absolute inset-y-0 left-0 hidden w-1/3 disabled:cursor-default [@media(pointer:fine)]:block"
          />
          <button
            type="button"
            aria-label="Следующее фото"
            disabled={slide === p.images.length - 1}
            onClick={() => goTo(slide + 1)}
            onWheel={wheelToStrip}
            className="absolute inset-y-0 right-0 hidden w-1/3 disabled:cursor-default [@media(pointer:fine)]:block"
          />
        </>
      )}
      {p.images.length > 1 && (
        <div className="absolute bottom-[32px] left-1/2 flex h-[20px] -translate-x-1/2 items-center gap-[6px] rounded-[10px] bg-[rgb(11_11_12/0.35)] px-[8px]">
          {p.images.map((img, i) => (
            <button
              key={img.url}
              type="button"
              aria-label={`Фото ${i + 1}`}
              aria-current={i === slide}
              onClick={() => goTo(i)}
              className={`h-[6px] rounded-[3px] transition-[width] duration-200 ${
                i === slide ? "w-[18px] bg-white" : "w-[6px] bg-white/55"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** «Осталось 3 порции», когда порций мало; весь остаток в корзине — «все оставшиеся». */
function StockLeft({ product: p }: { product: Product }) {
  const qty = useCart((s) => s.items[p.id] ?? 0);
  if (!inStock(p) || p.stock === null) return null;
  const all = qty >= p.stock;
  const left = lowStockLeft(p);
  if (!all && left === null) return null;
  return (
    <span className="inline-flex h-[26px] items-center self-start rounded-lg bg-warn-bg px-2.5 text-[13px] font-semibold text-warn-ink">
      {all ? "В корзине все оставшиеся порции" : `Осталось ${portionsText(left ?? 0)}`}
    </span>
  );
}

/** Нижняя панель: «Добавить · цена» → счётчик и «Корзина · N»; закончилось — неактивная кнопка. */
function DishBar({ product: p }: { product: Product }) {
  const money = useMoney();
  const qty = useCart((s) => s.items[p.id] ?? 0);
  const add = useCart((s) => s.add);
  const remove = useCart((s) => s.remove);
  const { count, total } = useCartLines();

  const tap = (fn: () => void) => () => {
    haptic.tap();
    fn();
  };

  let content: ReactNode;
  if (!inStock(p)) {
    content = (
      <button
        type="button"
        disabled
        className="h-[52px] flex-1 rounded-[14px] bg-muted text-base font-semibold text-hint"
      >
        Закончилось
      </button>
    );
  } else if (qty === 0) {
    content = (
      <button
        type="button"
        onClick={tap(() => add(p.id))}
        className="flex h-[52px] flex-1 items-center justify-between rounded-[14px] bg-accent px-[18px] text-base font-semibold text-white"
      >
        <span>Добавить</span>
        <span>{money(p.price)}</span>
      </button>
    );
  } else {
    content = (
      <>
        <div className="flex h-[52px] flex-none items-center rounded-[14px] bg-accent-soft text-[17px] font-bold text-accent-ink">
          <button
            type="button"
            aria-label="Убрать одну порцию"
            onClick={tap(() => remove(p.id))}
            className="flex h-[52px] w-11 items-center justify-center"
          >
            <Minus size={20} strokeWidth={2.4} />
          </button>
          <span className="min-w-5 text-center tabular-nums">{qty}</span>
          <button
            type="button"
            aria-label="Добавить порцию"
            disabled={qty >= maxOrderQty(p)}
            onClick={tap(() => add(p.id))}
            className="flex h-[52px] w-11 items-center justify-center disabled:opacity-40"
          >
            <Plus size={20} strokeWidth={2.4} />
          </button>
        </div>
        <Link
          to="/cart"
          className="flex h-[52px] min-w-0 flex-1 items-center justify-between gap-2 rounded-[14px] bg-accent px-4 text-base font-semibold text-white"
        >
          <span className="truncate">Корзина · {count}</span>
          <span className="whitespace-nowrap">{money(total)}</span>
        </Link>
      </>
    );
  }

  return (
    <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card px-4 pt-3">
      <div className="mx-auto flex w-full max-w-[528px] gap-2.5">{content}</div>
    </div>
  );
}

/** Блюдо скрыли или удалили, а ссылка на него осталась. */
function DishGone() {
  const navigate = useNavigate();
  return (
    <Screen>
      <main className="flex flex-1 flex-col items-center justify-center gap-3 px-10 pb-20 text-center">
        <div className="dish-placeholder flex h-24 w-24 items-center justify-center rounded-3xl">
          <BrandMark className="w-12 opacity-50 grayscale" />
        </div>
        <h1 className="m-0 text-xl leading-[26px] font-bold">Этого блюда больше нет в меню</h1>
        <p className="m-0 text-hint">Загляните в меню — там много другого вкусного</p>
        <button
          type="button"
          onClick={() => navigate({ to: "/", replace: true })}
          className="mt-2 flex h-12 items-center rounded-[14px] bg-accent px-7 text-base font-semibold text-white"
        >
          В меню
        </button>
      </main>
    </Screen>
  );
}
