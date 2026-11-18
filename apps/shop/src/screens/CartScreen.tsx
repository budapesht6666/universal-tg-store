/** Корзина: состав, итого, и — если закрыто или пауза — почему оформить пока нельзя. */
import { inStock, maxOrderQty } from "@store/schema";
import { Link, useNavigate } from "@tanstack/react-router";
import { Clock, Moon, ShoppingBag, X } from "lucide-react";
import { BottomBar, Notice, PrimaryButton, Screen, Stepper } from "../components/ui.tsx";
import { useCart } from "../lib/cart.ts";
import { isShort, shortText, useCartLines, useMoney, useReadyShop } from "../lib/shop.ts";
import { DishImage } from "./MenuScreen.tsx";

export function ClosedNotice() {
  const { status, hours } = useReadyShop();
  if (status.open) return null;
  const when = status.opensAt ? `Откроемся ${status.opensAt}.` : "";
  if (status.reason === "paused") {
    return (
      <Notice tone="warn" icon={<Clock size={20} />} title="Кухня на паузе">
        Сейчас много заказов. Меню можно смотреть и собирать корзину — оформить получится позже.{" "}
        {when}
      </Notice>
    );
  }
  const days = Object.values(hours);
  const same = days.every((d) => d && days[0] && d.from === days[0].from && d.to === days[0].to);
  const schedule =
    same && days[0] ? `Принимаем заказы каждый день с ${days[0].from} до ${days[0].to}. ` : "";
  return (
    <Notice tone="neutral" icon={<Moon size={20} />} title="Сейчас закрыто">
      {schedule}
      {when}
    </Notice>
  );
}

export function CartScreen() {
  const { status } = useReadyShop();
  const money = useMoney();
  const navigate = useNavigate();
  const { lines, count, total, soldOut, short } = useCartLines();
  const add = useCart((s) => s.add);
  const remove = useCart((s) => s.remove);
  const drop = useCart((s) => s.drop);

  if (lines.length === 0) {
    return (
      <Screen>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-24 text-center">
          <ShoppingBag size={40} className="text-hint" />
          <span className="text-[17px] font-semibold">Корзина пуста</span>
          <Link to="/" className="font-semibold text-accent">
            В меню
          </Link>
        </div>
      </Screen>
    );
  }

  const blocked = !status.open || soldOut.length > 0 || short.length > 0 || count === 0;
  const buttonText = !status.open
    ? `${status.reason === "paused" ? "Пауза" : "Закрыто"}${status.opensAt ? ` · откроемся ${status.opensAt}` : ""}`
    : soldOut.length > 0
      ? "Уберите то, что закончилось"
      : short.length > 0
        ? "Уменьшите количество"
        : `Оформить · ${money(total)}`;

  return (
    <Screen>
      <div className="flex flex-col gap-4 p-4 pb-36">
        <ClosedNotice />
        <div className="flex flex-col overflow-hidden rounded-2xl bg-card">
          {lines.map(({ product: p, qty }) => (
            <div key={p.id} className="flex items-center gap-3 border-b border-line px-3.5 py-3">
              <DishImage product={p} size={52} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{p.title}</span>
                {!inStock(p) ? (
                  <span className="text-[13px] font-semibold text-danger">Закончилось</span>
                ) : isShort({ product: p, qty }) ? (
                  <span className="text-[13px] font-semibold text-danger">
                    {shortText({ product: p, qty })}
                  </span>
                ) : (
                  <span className="text-[13px] text-hint">{money(p.price * qty)}</span>
                )}
              </div>
              {inStock(p) ? (
                <Stepper
                  tone="plain"
                  qty={qty}
                  max={maxOrderQty(p)}
                  onAdd={() => add(p.id)}
                  onRemove={() => remove(p.id)}
                />
              ) : (
                <button
                  type="button"
                  aria-label={`Убрать ${p.title}`}
                  onClick={() => drop(p.id)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl bg-page text-hint"
                >
                  <X size={18} />
                </button>
              )}
            </div>
          ))}
          <div className="flex flex-col gap-1.5 p-3.5">
            <div className="flex justify-between text-hint">
              <span>Доставка</span>
              <span className="font-semibold text-ok">Бесплатно</span>
            </div>
            <div className="flex justify-between text-[17px] leading-[22px] font-bold">
              <span>Итого</span>
              <span>{money(total)}</span>
            </div>
            <span className="text-[13px] text-hint">
              Оплата курьеру при получении — наличными или переводом
            </span>
          </div>
        </div>
      </div>
      <BottomBar>
        <PrimaryButton disabled={blocked} onClick={() => navigate({ to: "/checkout" })}>
          {buttonText}
        </PrimaryButton>
        {!status.open && (
          <span className="text-center text-[13px] text-hint">Корзина сохранится до открытия</span>
        )}
      </BottomBar>
    </Screen>
  );
}
