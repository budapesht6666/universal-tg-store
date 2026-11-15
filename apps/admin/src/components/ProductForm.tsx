/**
 * Форма блюда. Проверка — productInputSchema из @store/schema (та же, что на сервере),
 * характеристики (порция, калорийность…) строятся по их описаниям в меню.
 * Цены вводятся как на ценнике («85 000» или «85.000»), хранятся в минимальных единицах.
 */
import {
  type AttributeDefinition,
  currencyDigits,
  productInputSchema,
  toMinor,
} from "@store/schema";
import { useMutation, useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import { ApiError, api, type Catalog, type Product } from "../lib/api.ts";
import { ImageUpload } from "./ImageUpload.tsx";
import {
  FieldError,
  issuesToErrors,
  PrimaryButton,
  SecondaryButton,
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
  const [image, setImage] = useState(product?.image);
  const [available, setAvailable] = useState(product?.available ?? true);
  const [hidden, setHidden] = useState(product ? !product.isActive : false);
  const [attrs, setAttrs] = useState<Record<string, unknown>>(product?.attributes ?? {});
  const [errors, setErrors] = useState<Errors>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const errs: Errors = {};
      const priceMinor = toMinor(price, currency);
      if (priceMinor === null) errs.price = "Цена — число, например 85 000";
      const oldMinor = oldPrice.trim() ? toMinor(oldPrice, currency) : undefined;
      if (oldMinor === null) errs.compareAtPrice = "Старая цена — число, например 100 000";
      const payload = {
        title,
        description,
        price: priceMinor ?? -1,
        ...(oldMinor != null && { compareAtPrice: oldMinor }),
        ...(image && { image }),
        categoryId,
        badges,
        available,
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
      className="mx-auto flex w-full max-w-[560px] flex-col gap-4 rounded-2xl bg-card p-4 pb-28 lg:pb-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <header className="flex items-center justify-between">
        <h2 className="m-0 text-lg font-bold">{product ? product.title : "Новое блюдо"}</h2>
        <button
          type="button"
          aria-label="Закрыть"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center text-hint"
        >
          <X size={20} />
        </button>
      </header>

      <ImageUpload
        value={image}
        onChange={setImage}
        hint="Квадрат, от 800 px. Сожмём сами."
        error={errors["image.url"]}
      />

      <TextField
        label="Название"
        value={title}
        onChange={setTitle}
        maxLength={120}
        error={errors.title}
      />
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] text-hint">Состав</span>
        <textarea
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1000}
          placeholder="Со сметаной и чесночной пампушкой"
          className="resize-y rounded-xl border border-line bg-card px-3.5 py-3 outline-none focus:border-accent"
        />
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
        <span className="text-[13px] text-hint">Категория</span>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="h-11 rounded-xl border border-line bg-card px-3 outline-none"
        >
          {catalog.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <FieldError message={errors.categoryId} />
      </label>

      {features.badges && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-hint">Метки · до трёх</span>
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
        <PrimaryButton type="submit" loading={save.isPending}>
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
          <span className="text-[13px] text-hint">{label}</span>
          <select
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value || undefined)}
            className="h-11 rounded-xl border border-line bg-card px-3 outline-none"
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
