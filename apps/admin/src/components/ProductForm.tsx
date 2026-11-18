/**
 * Форма блюда. Проверка — productInputSchema из @store/schema (та же, что на сервере),
 * характеристики (порция, калорийность…) строятся по их описаниям в меню.
 * Цены вводятся как на ценнике («85 000» или «85.000»), хранятся в минимальных единицах.
 */
import {
  type AttributeDefinition,
  currencyDigits,
  type ImageRef,
  LOW_STOCK,
  MAX_STOCK,
  productInputSchema,
  toMinor,
} from "@store/schema";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Minus, Plus, X } from "lucide-react";
import { useState } from "react";
import { ApiError, api, type Catalog, type Product } from "../lib/api.ts";
import { DishLink } from "./DishLink.tsx";
import { PhotoGallery } from "./PhotoGallery.tsx";
import {
  FIELD_LABEL,
  FieldError,
  issuesToErrors,
  PrimaryButton,
  SecondaryButton,
  scrollToFirstError,
  TEXTAREA,
  TextField,
  Toggle,
} from "./ui.tsx";

type Errors = Record<string, string>;

/** Цена для поля ввода как на ценнике: 85000 → «85 000», 199000 копеек → «1 990,00». */
function amount(minor: number, currency: string): string {
  const d = currencyDigits(currency);
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(minor / 10 ** d);
}

export function ProductForm({
  catalog,
  product,
  defaultCategoryId,
  onClose,
  onSaved,
}: {
  catalog: Catalog;
  product: Product | null;
  defaultCategoryId: string;
  onClose: () => void;
  onSaved: (p: Product) => void;
}) {
  const shop = useQuery({ queryKey: ["shop"], queryFn: api.shop });
  const currency = shop.data?.ready ? shop.data.region.currency : "VND";
  const features = shop.data?.ready ? shop.data.features : { discounts: true, badges: true };

  const [title, setTitle] = useState(product?.title ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [price, setPrice] = useState(product ? amount(product.price, currency) : "");
  const [oldPrice, setOldPrice] = useState(
    product?.compareAtPrice !== undefined ? amount(product.compareAtPrice, currency) : "",
  );
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? defaultCategoryId);
  const [badges, setBadges] = useState<string[]>(product?.badges ?? []);
  const [badgeInput, setBadgeInput] = useState("");
  const [images, setImages] = useState<ImageRef[]>(product?.images ?? []);
  const [uploading, setUploading] = useState(false);
  const [available, setAvailable] = useState(product?.available ?? true);
  const [hidden, setHidden] = useState(product ? !product.isActive : false);
  const [attrs, setAttrs] = useState<Record<string, unknown>>(product?.attributes ?? {});
  const [limit, setLimit] = useState(product ? product.stock !== null : false);
  const [stock, setStock] = useState(product?.stock != null ? String(product.stock) : "");
  // Остаток уходит на сервер, только если его трогали: пока форма открыта, заказы списывают порции.
  const [stockTouched, setStockTouched] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const errs: Errors = {};
      const priceMinor = toMinor(price, currency);
      if (priceMinor === null) errs.price = "Цена — число, например 85 000";
      const oldMinor = oldPrice.trim() ? toMinor(oldPrice, currency) : undefined;
      if (oldMinor === null) errs.compareAtPrice = "Старая цена — число, например 100 000";
      const stockNum = /^\d+$/.test(stock.trim()) ? Number(stock.trim()) : null;
      if (limit && stockNum === null)
        errs.stock = "Сколько порций осталось — целое число, например 12";
      const sendStock = !product || stockTouched;
      const payload = {
        title,
        description,
        price: priceMinor ?? -1,
        ...(oldMinor != null && { compareAtPrice: oldMinor }),
        images,
        categoryId,
        badges,
        available,
        ...(sendStock && { stock: limit ? (stockNum ?? -1) : null }),
        isActive: !hidden,
        sort: product?.sort ?? 0,
        attributes: Object.fromEntries(
          Object.entries(attrs).filter(([, v]) => v !== "" && v !== undefined),
        ),
      };
      const parsed = productInputSchema(catalog.attributes).safeParse(payload);
      if (!parsed.success) {
        for (const i of parsed.error.issues) errs[i.path.join(".")] ??= i.message;
      }
      if (Object.keys(errs).length || !parsed.success)
        throw new ApiError(
          400,
          "Проверьте поля",
          Object.entries(errs).map(([path, message]) => ({ path, message })),
        );
      return product ? api.updateProduct(product.id, parsed.data) : api.createProduct(parsed.data);
    },
    onMutate: () => setErrors({}),
    onSuccess: onSaved,
    onError: (err) => {
      if (err instanceof ApiError && err.issues.length) setErrors(issuesToErrors(err.issues));
      else setErrors({ form: err.message });
      scrollToFirstError();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteProduct(product?.id ?? ""),
    onSuccess: () => product && onSaved({ ...product }),
    onError: (err) => setErrors({ form: err.message }),
  });

  const addBadge = () => {
    const b = badgeInput.trim();
    if (b && badges.length < 3 && !badges.includes(b)) setBadges([...badges, b]);
    setBadgeInput("");
  };

  return (
    <form
      className="mx-auto flex w-full max-w-[560px] flex-col gap-4 rounded-2xl bg-card p-4 pb-28 lg:rounded-xl lg:pb-4 lg:shadow-[inset_0_0_0_1px_var(--line)]"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <header className="flex items-center justify-between">
        <h2 className="m-0 text-base leading-[22px] font-bold">
          {product ? product.title : "Новое блюдо"}
        </h2>
        <button
          type="button"
          aria-label="Закрыть"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center text-hint"
        >
          <X size={20} />
        </button>
      </header>

      {product && catalog.dishLink && <DishLink link={catalog.dishLink} dishId={product.id} />}

      <PhotoGallery
        images={images}
        setImages={setImages}
        onBusyChange={setUploading}
        error={errors.images ?? Object.entries(errors).find(([k]) => k.startsWith("images."))?.[1]}
      />

      <TextField
        label="Название"
        value={title}
        onChange={setTitle}
        maxLength={120}
        error={errors.title}
      />
      <label className="flex flex-col gap-1.5">
        <span className={FIELD_LABEL}>Состав</span>
        <textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
          placeholder="Со сметаной и чесночной пампушкой"
          className={TEXTAREA}
        />
        <span className="text-xs leading-4 text-hint">
          В меню видны первые две строки, целиком — на странице блюда
        </span>
        <FieldError message={errors.description} />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <TextField
          label={`Цена, ${currency}`}
          value={price}
          onChange={setPrice}
          inputMode="decimal"
          placeholder="85 000"
          error={errors.price}
        />
        {features.discounts && (
          <TextField
            label="Старая цена"
            value={oldPrice}
            onChange={setOldPrice}
            inputMode="decimal"
            placeholder="необязательно"
            error={errors.compareAtPrice}
          />
        )}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={FIELD_LABEL}>Категория</span>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="h-11 rounded-xl border border-line bg-card px-3 outline-none lg:h-[38px] lg:rounded-lg"
        >
          {catalog.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <FieldError message={errors.categoryId} />
      </label>

      <StockField
        limit={limit}
        stock={stock}
        error={errors.stock}
        onLimit={(v) => {
          setLimit(v);
          setStockTouched(true);
        }}
        onStock={(v) => {
          setStock(v);
          setStockTouched(true);
        }}
      />

      {features.badges && (
        <div className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL}>Метки · до трёх</span>
          <div className="flex flex-wrap items-center gap-2">
            {badges.map((b) => (
              <span
                key={b}
                className="flex h-8 items-center gap-1 rounded-lg bg-accent-soft pr-1 pl-2.5 text-sm font-semibold text-accent-ink"
              >
                {b}
                <button
                  type="button"
                  aria-label={`Убрать метку ${b}`}
                  onClick={() => setBadges(badges.filter((x) => x !== b))}
                  className="flex h-6 w-6 items-center justify-center"
                >
                  <X size={14} />
                </button>
              </span>
            ))}
            {badges.length < 3 && (
              <input
                value={badgeInput}
                onChange={(e) => setBadgeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addBadge();
                  }
                }}
                onBlur={addBadge}
                maxLength={24}
                placeholder="+ метка: Хит, Острое 🌶"
                className="h-8 min-w-[140px] flex-1 rounded-lg border border-dashed border-line bg-transparent px-2.5 text-sm outline-none"
              />
            )}
          </div>
          <FieldError message={errors.badges} />
        </div>
      )}

      {catalog.attributes.map((def) => (
        <AttributeField
          key={def.key}
          def={def}
          value={attrs[def.key]}
          error={errors[`attributes.${def.key}`]}
          onChange={(v) => setAttrs({ ...attrs, [def.key]: v })}
        />
      ))}

      <div className="flex flex-col rounded-xl bg-page">
        <div className="flex items-center gap-3 px-3.5 py-3">
          <div className="flex flex-1 flex-col">
            <span className="font-semibold">Есть в наличии</span>
            <span className="text-xs text-hint">Выключено — «Закончилось», заказать нельзя</span>
          </div>
          <Toggle checked={available} onChange={setAvailable} label="Есть в наличии" />
        </div>
        <div className="flex items-center gap-3 border-t border-line px-3.5 py-3">
          <div className="flex flex-1 flex-col">
            <span className="font-semibold">Скрыть из меню</span>
            <span className="text-xs text-hint">Не видно покупателям, например сезонное</span>
          </div>
          <Toggle checked={hidden} onChange={setHidden} label="Скрыть из меню" />
        </div>
      </div>

      <FieldError message={errors.form ?? (Object.keys(errors).length ? undefined : undefined)} />
      <div className="flex gap-2">
        <PrimaryButton type="submit" loading={save.isPending} disabled={uploading}>
          Сохранить
        </PrimaryButton>
      </div>
      {product &&
        (confirmDelete ? (
          <div className="flex flex-col gap-2 rounded-xl bg-page p-3">
            <span className="text-sm">
              Удалить «{product.title}»? В прошлых заказах блюдо останется.
            </span>
            <div className="flex gap-2">
              <SecondaryButton
                tone="danger"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                Удалить
              </SecondaryButton>
              <SecondaryButton onClick={() => setConfirmDelete(false)}>Нет</SecondaryButton>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="h-10 text-sm font-semibold text-danger"
          >
            Удалить блюдо
          </button>
        ))}
    </form>
  );
}

/** «Ограничить порции» и сколько осталось: на нуле блюдо в магазине «Закончилось». */
function StockField({
  limit,
  stock,
  error,
  onLimit,
  onStock,
}: {
  limit: boolean;
  stock: string;
  error: string | undefined;
  onLimit: (v: boolean) => void;
  onStock: (v: string) => void;
}) {
  const n = /^\d+$/.test(stock.trim()) ? Number(stock.trim()) : null;
  const step = (d: number) => onStock(String(Math.min(Math.max((n ?? 0) + d, 0), MAX_STOCK)));
  return (
    <div className="flex flex-col gap-2.5 rounded-xl bg-page px-3.5 py-3">
      <div className="flex items-center gap-3">
        <div className="flex flex-1 flex-col">
          <span className="font-semibold">Ограничить порции</span>
          <span className="text-xs text-hint">Сверх остатка заказать нельзя</span>
        </div>
        <Toggle checked={limit} onChange={onLimit} label="Ограничить порции" />
      </div>
      {limit && (
        <>
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="product-stock" className="font-semibold">
              Осталось порций
            </label>
            <div className="flex h-11 items-center overflow-hidden rounded-xl border border-line bg-card lg:h-[38px] lg:rounded-lg">
              <button
                type="button"
                aria-label="На одну меньше"
                onClick={() => step(-1)}
                className="flex h-full w-10 items-center justify-center text-hint"
              >
                <Minus size={16} />
              </button>
              <input
                id="product-stock"
                inputMode="numeric"
                value={stock}
                onChange={(e) => onStock(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="0"
                className="h-full w-16 border-x border-line bg-transparent text-center font-semibold tabular-nums outline-none"
              />
              <button
                type="button"
                aria-label="На одну больше"
                onClick={() => step(1)}
                className="flex h-full w-10 items-center justify-center text-hint"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
          <FieldError message={error} />
          {n === 0 && (
            <span className="rounded-lg bg-warn-bg px-2.5 py-2 text-xs leading-4 text-warn-ink">
              Порции закончились — в магазине блюдо «Закончилось». Приготовили ещё — впишите новое
              число.
            </span>
          )}
          <span className="text-xs leading-4 text-hint">
            Заказ списывает порции, отмена возвращает. Когда останется {LOW_STOCK} и меньше,
            покупатели увидят «Осталось 3».
          </span>
        </>
      )}
    </div>
  );
}

/** Поле характеристики по её описанию (FieldDefinition). */
function AttributeField({
  def,
  value,
  error,
  onChange,
}: {
  def: AttributeDefinition;
  value: unknown;
  error: string | undefined;
  onChange: (v: unknown) => void;
}) {
  const label = `${def.label}${"unit" in def && def.unit ? `, ${def.unit}` : ""}`;
  switch (def.type) {
    case "boolean":
      return (
        <div className="flex items-center justify-between gap-3">
          <span className="font-semibold">{def.label}</span>
          <Toggle checked={value === true} onChange={onChange} label={def.label} />
        </div>
      );
    case "number":
    case "money":
      return (
        <TextField
          label={label}
          value={value === undefined ? "" : String(value)}
          inputMode="decimal"
          onChange={(v) => onChange(v.trim() === "" ? undefined : Number(v.replace(",", ".")))}
          error={error}
          {...(def.hint && { hint: def.hint })}
        />
      );
    case "select":
      return (
        <label className="flex flex-col gap-1.5">
          <span className={FIELD_LABEL}>{label}</span>
          <select
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value || undefined)}
            className="h-11 rounded-xl border border-line bg-card px-3 outline-none lg:h-[38px] lg:rounded-lg"
          >
            <option value="">—</option>
            {def.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <FieldError message={error} />
        </label>
      );
    case "text":
    case "textarea":
    case "markdown":
    case "url":
    case "color":
    case "date":
      return (
        <TextField
          label={label}
          value={typeof value === "string" ? value : ""}
          onChange={(v) => onChange(v)}
          placeholder={"placeholder" in def && def.placeholder ? def.placeholder : ""}
          error={error}
          {...(def.hint && { hint: def.hint })}
        />
      );
    default:
      return null; // multiselect, images, tags — редактор позже (в MVP не нужны)
  }
}
