/**
 * «Меню» — один экран: слева категории (порядок, переименование, добавление, удаление пустой),
 * в середине блюда выбранной категории с переключателем «Есть», справа форма блюда.
 * На телефоне категории — лентой сверху, форма открывается поверх.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Check,
  EyeOff,
  Pencil,
  Plus,
  Trash2,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { ProductForm } from "../components/ProductForm.tsx";
import { FieldError, Spinner, Toggle } from "../components/ui.tsx";
import { api, type Catalog, type CategoryRow, type Product } from "../lib/api.ts";
import { useMoney } from "../lib/session.ts";

function move<T>(list: T[], index: number, delta: number): T[] {
  const next = [...list];
  const [item] = next.splice(index, 1);
  if (item === undefined) return list;
  next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, item);
  return next;
}

export function MenuScreen() {
  const queryClient = useQueryClient();
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: api.catalog });
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["catalog"] });
    void queryClient.invalidateQueries({ queryKey: ["shop"] });
  };

  if (catalog.isPending) return <Spinner />;
  if (catalog.isError)
    return <div className="p-8 text-center text-hint">{catalog.error.message}</div>;
  const c = catalog.data;
  const current = c.categories.find((x) => x.id === categoryId) ?? c.categories[0] ?? null;
  const products = current ? c.products.filter((p) => p.categoryId === current.id) : [];
  const soldOut = c.products.filter((p) => !p.available).length;

  return (
    <div className="flex flex-col gap-3 p-4 lg:p-6">
      <div className="flex flex-col">
        <h1 className="m-0 text-2xl font-bold">Меню</h1>
        <span className="text-[13px] text-hint">
          {c.categories.length} категорий · {c.products.length} блюд
          {soldOut ? ` · ${soldOut} закончились` : ""}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)_minmax(360px,420px)]">
        <Categories catalog={c} current={current} onSelect={setCategoryId} onChanged={refresh} />
        <Products
          catalog={c}
          category={current}
          products={products}
          selected={editing === "new" ? null : (editing?.id ?? null)}
          onEdit={setEditing}
          onChanged={refresh}
        />
        {editing && (
          <div className="fixed inset-0 z-40 overflow-y-auto bg-page lg:static lg:z-auto lg:overflow-visible lg:bg-transparent">
            <ProductForm
              key={editing === "new" ? `new-${current?.id}` : editing.id}
              catalog={c}
              product={editing === "new" ? null : editing}
              defaultCategoryId={current?.id ?? ""}
              onClose={() => setEditing(null)}
              onSaved={(p) => {
                refresh();
                setCategoryId(p.categoryId);
                setEditing(null);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Categories({
  catalog,
  current,
  onSelect,
  onChanged,
}: {
  catalog: Catalog;
  current: CategoryRow | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const counts = new Map<string, number>();
  for (const p of catalog.products) counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1);

  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onMutate: () => setError(null),
    onSuccess: () => {
      setAdding(false);
      setRenaming(null);
      setTitle("");
      onChanged();
    },
    onError: (err) => setError(err.message),
  });

  const ids = catalog.categories.map((x) => x.id);

  return (
    <aside className="flex min-w-0 flex-col gap-2">
      <div className="no-scrollbar flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible lg:rounded-2xl lg:bg-card lg:p-2">
        <span className="hidden px-2 pt-1 text-[13px] font-semibold text-hint lg:block">
          Категории
        </span>
        {catalog.categories.map((cat, i) =>
          renaming === cat.id ? (
            <form
              key={cat.id}
              className="flex flex-none items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                run.mutate(() => api.updateCategory(cat.id, { title: title.trim() }));
              }}
            >
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={60}
                className="h-9 min-w-0 flex-1 rounded-lg border border-accent bg-card px-2 outline-none"
              />
              <button
                type="submit"
                aria-label="Сохранить"
                className="flex h-9 w-9 items-center justify-center text-accent"
              >
                <Check size={18} />
              </button>
              <button
                type="button"
                aria-label="Отмена"
                onClick={() => setRenaming(null)}
                className="flex h-9 w-9 items-center justify-center text-hint"
              >
                <X size={18} />
              </button>
            </form>
          ) : (
            <div
              key={cat.id}
              className={`group flex flex-none items-center gap-1 rounded-xl ${
                current?.id === cat.id
                  ? "bg-accent-soft text-accent-ink"
                  : "bg-card lg:bg-transparent"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(cat.id)}
                className="flex h-10 flex-1 items-center gap-2 px-3 text-left font-semibold whitespace-nowrap"
              >
                {cat.title}
                <span className="text-xs font-normal text-hint">{counts.get(cat.id) ?? 0}</span>
              </button>
              {current?.id === cat.id && (
                <span className="hidden items-center lg:flex">
                  <IconButton
                    label="Выше"
                    disabled={i === 0}
                    onClick={() => run.mutate(() => api.reorderCategories(move(ids, i, -1)))}
                  >
                    <ArrowUp size={15} />
                  </IconButton>
                  <IconButton
                    label="Ниже"
                    disabled={i === ids.length - 1}
                    onClick={() => run.mutate(() => api.reorderCategories(move(ids, i, 1)))}
                  >
                    <ArrowDown size={15} />
                  </IconButton>
                  <IconButton
                    label="Переименовать"
                    onClick={() => {
                      setTitle(cat.title);
                      setRenaming(cat.id);
                    }}
                  >
                    <Pencil size={15} />
                  </IconButton>
                  {!counts.get(cat.id) && (
                    <IconButton
                      label="Удалить"
                      onClick={() => run.mutate(() => api.deleteCategory(cat.id))}
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  )}
                </span>
              )}
            </div>
          ),
        )}
        {adding ? (
          <form
            className="flex flex-none items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) run.mutate(() => api.createCategory({ title: title.trim() }));
            }}
          >
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например, Напитки"
              maxLength={60}
              className="h-9 min-w-0 flex-1 rounded-lg border border-accent bg-card px-2 outline-none"
            />
            <button
              type="submit"
              aria-label="Добавить"
              className="flex h-9 w-9 items-center justify-center text-accent"
            >
              <Check size={18} />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => {
              setTitle("");
              setAdding(true);
            }}
            className="flex h-10 flex-none items-center gap-1.5 rounded-xl px-3 font-semibold whitespace-nowrap text-accent"
          >
            <Plus size={16} /> Категория
          </button>
        )}
      </div>
      <span className="hidden px-1 text-xs text-hint lg:block">
        Удалить можно пустую категорию.
      </span>
      <FieldError message={error ?? undefined} />
    </aside>
  );
}

function Products({
  catalog,
  category,
  products,
  selected,
  onEdit,
  onChanged,
}: {
  catalog: Catalog;
  category: CategoryRow | null;
  products: Product[];
  selected: string | null;
  onEdit: (p: Product | "new") => void;
  onChanged: () => void;
}) {
  const money = useMoney();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const toggle = useMutation({
    mutationFn: ({ id, available }: { id: string; available: boolean }) =>
      api.patchProduct(id, { available }),
    onMutate: ({ id, available }) => {
      setError(null);
      // Сразу показываем новое состояние — переключатель не «думает».
      queryClient.setQueryData<Catalog>(["catalog"], (old) =>
        old
          ? { ...old, products: old.products.map((p) => (p.id === id ? { ...p, available } : p)) }
          : old,
      );
    },
    onSettled: onChanged,
    onError: (err) => setError(err.message),
  });
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.reorderProducts(category?.id ?? "", ids),
    onSuccess: onChanged,
    onError: (err) => setError(err.message),
  });
  const ids = products.map((p) => p.id);

  if (!category) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl bg-card p-8 text-center text-hint">
        Сначала добавьте категорию — например, «Супы».
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col overflow-hidden rounded-2xl bg-card">
        {products.length === 0 && (
          <div className="p-6 text-center text-hint">В категории пока нет блюд</div>
        )}
        {products.map((p, i) => (
          <div
            key={p.id}
            className={`flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0 ${
              selected === p.id ? "bg-accent-soft" : ""
            }`}
          >
            <button
              type="button"
              onClick={() => onEdit(p)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              <span className="flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-xl bg-accent-soft text-accent-ink">
                {p.image ? (
                  <img src={p.image.url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <UtensilsCrossed size={18} />
                )}
              </span>
              <span className={`flex min-w-0 flex-col ${p.available ? "" : "opacity-55"}`}>
                <span className="truncate font-semibold">{p.title}</span>
                <span className="flex items-center gap-1.5 text-[13px] text-hint">
                  {money(p.price)}
                  {!p.isActive && (
                    <span className="flex items-center gap-1 rounded bg-muted px-1.5 text-xs">
                      <EyeOff size={11} /> скрыто
                    </span>
                  )}
                  {!p.available && <span className="text-xs">· закончилось</span>}
                </span>
                {p.badges.length > 0 && (
                  <span className="flex flex-wrap gap-1 pt-0.5">
                    {p.badges.map((b) => (
                      <span
                        key={b}
                        className="rounded bg-accent-soft px-1.5 text-xs font-semibold text-accent-ink"
                      >
                        {b}
                      </span>
                    ))}
                  </span>
                )}
              </span>
            </button>
            <span className="hidden items-center md:flex">
              <IconButton
                label="Выше"
                disabled={i === 0}
                onClick={() => reorder.mutate(move(ids, i, -1))}
              >
                <ArrowUp size={15} />
              </IconButton>
              <IconButton
                label="Ниже"
                disabled={i === ids.length - 1}
                onClick={() => reorder.mutate(move(ids, i, 1))}
              >
                <ArrowDown size={15} />
              </IconButton>
            </span>
            <Toggle
              checked={p.available}
              label={`${p.title}: есть в наличии`}
              onChange={(available) => toggle.mutate({ id: p.id, available })}
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onEdit("new")}
        className="flex h-11 items-center justify-center gap-1.5 rounded-xl bg-accent-soft font-semibold text-accent-ink"
      >
        <Plus size={16} /> Блюдо в «{category.title}»
      </button>
      <span className="text-xs text-hint">
        Выключили «Есть» — блюдо остаётся в меню серым с надписью «Закончилось». То же переключается
        с телефона.
      </span>
      <FieldError message={error ?? undefined} />
      {catalog.categories.length === 0 && null}
    </section>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-hint hover:bg-muted disabled:opacity-30"
    >
      {children}
    </button>
  );
}
