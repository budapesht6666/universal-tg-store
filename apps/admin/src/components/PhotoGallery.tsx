/**
 * Фото блюда: до 5, первое — главное (в меню и первым на странице блюда).
 * Несколько файлов сразу (выбор или перетаскивание на блок), каждый — отдельный запрос,
 * параллельно; фото встают в порядке выбора. Порядок — перетаскиванием или ★ «Сделать главным».
 * Сохраняется вместе с формой блюда.
 */
import { type ImageRef, MAX_PRODUCT_IMAGES } from "@store/schema";
import { Plus, Star, X } from "lucide-react";
import {
  type Dispatch,
  type DragEvent,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import { api } from "../lib/api.ts";
import { FIELD_LABEL, FieldError } from "./ui.tsx";

/** Файл в загрузке: url появляется, когда сервер ответил. */
type Pending = { key: number; url?: string };

const REORDER = "application/x-photo-index";

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

export function PhotoGallery({
  images,
  setImages,
  onBusyChange,
  error,
}: {
  images: ImageRef[];
  setImages: Dispatch<SetStateAction<ImageRef[]>>;
  /** true, пока идёт загрузка, — форма не сохраняется. */
  onBusyChange: (busy: boolean) => void;
  error?: string | undefined;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);
  const [pending, setPending] = useState<Pending[]>([]);
  const [problem, setProblem] = useState<string>();
  const [dropping, setDropping] = useState(false);

  const busy = pending.length > 0;
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

  // Готовые загрузки переезжают в фото по порядку выбора: пока первая не готова, ждём.
  useEffect(() => {
    let ready = 0;
    while (pending[ready]?.url) ready++;
    if (ready === 0) return;
    const done = pending.slice(0, ready).map((p) => ({ url: p.url as string }));
    setImages((prev) => [...prev, ...done]);
    setPending((prev) => prev.slice(ready));
  }, [pending, setImages]);

  const total = images.length + pending.length;
  const free = MAX_PRODUCT_IMAGES - total;

  /** Удалить или переставить: старое сообщение («Добавили 2 из 3…») уже не к месту. */
  const change = (fn: (prev: ImageRef[]) => ImageRef[]) => {
    setProblem(undefined);
    setImages(fn);
  };

  const addFiles = (list: FileList | null) => {
    const files = [...(list ?? [])];
    if (files.length === 0) return;
    const take = files.slice(0, Math.max(free, 0));
    setProblem(
      take.length === files.length
        ? undefined
        : take.length === 0
          ? `Больше ${MAX_PRODUCT_IMAGES} фото нельзя`
          : `Добавили ${take.length} фото из ${files.length} — больше ${MAX_PRODUCT_IMAGES} нельзя`,
    );
    for (const file of take) {
      const key = nextKey.current++;
      setPending((prev) => [...prev, { key }]);
      api.upload(file).then(
        ({ url }) => setPending((prev) => prev.map((p) => (p.key === key ? { key, url } : p))),
        (err: Error) => {
          setPending((prev) => prev.filter((p) => p.key !== key));
          setProblem(`${file.name}: ${err.message}`);
        },
      );
    }
  };

  const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes("Files");

  const hint =
    images.length === 0
      ? "Без фото в меню будет фирменная заглушка. Можно выбрать сразу несколько файлов или перетащить их сюда."
      : images.length < MAX_PRODUCT_IMAGES
        ? "Главное фото видно в меню и открывается первым на странице блюда. Порядок остальных — перетаскиванием."
        : "Это максимум. Чтобы добавить другое, удалите одно из фото.";

  return (
    <section
      aria-label="Фото"
      className={`flex flex-col gap-2 rounded-xl ${dropping ? "outline-2 outline-offset-4 outline-accent outline-dashed" : ""}`}
      onDragOver={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => {
        if (!isFileDrag(e)) return;
        e.preventDefault();
        setDropping(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={FIELD_LABEL}>Фото</span>
        <span className="text-xs text-hint">
          {images.length} из {MAX_PRODUCT_IMAGES}
        </span>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {images.map((img, i) => (
          // biome-ignore lint/a11y/noStaticElementInteractions: порядок мышью; с клавиатуры и на телефоне — ★ «Сделать главным»
          <div
            key={img.url}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(REORDER, String(i));
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(REORDER)) e.preventDefault();
            }}
            onDrop={(e) => {
              const from = Number(e.dataTransfer.getData(REORDER));
              if (!e.dataTransfer.types.includes(REORDER) || Number.isNaN(from)) return;
              e.preventDefault();
              e.stopPropagation();
              if (from !== i) change((prev) => move(prev, from, i));
            }}
            className={`relative aspect-square cursor-grab overflow-hidden rounded-[10px] bg-muted ${
              i === 0 ? "shadow-[0_0_0_2px_var(--accent)]" : "shadow-[inset_0_0_0_1px_var(--line)]"
            }`}
          >
            <img
              src={img.url}
              alt={img.alt ?? `Фото ${i + 1}`}
              draggable={false}
              className="h-full w-full object-cover"
            />
            {i === 0 ? (
              <span className="absolute bottom-1 left-1 flex h-[18px] items-center rounded-[5px] bg-accent px-1.5 text-[10px] leading-3 font-bold text-white">
                Главное
              </span>
            ) : (
              <button
                type="button"
                aria-label={`Сделать фото ${i + 1} главным`}
                title="Сделать главным"
                onClick={() => change((prev) => move(prev, i, 0))}
                className={`${TILE_BUTTON} left-1`}
              >
                <Star size={14} strokeWidth={2.2} />
              </button>
            )}
            <button
              type="button"
              aria-label={`Удалить фото ${i + 1}`}
              title="Удалить"
              onClick={() => change((prev) => prev.filter((_, j) => j !== i))}
              className={`${TILE_BUTTON} right-1`}
            >
              <X size={12} strokeWidth={3} />
            </button>
          </div>
        ))}

        {pending.map((p) => (
          <div
            key={p.key}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-[10px] bg-muted text-[11px] text-hint shadow-[inset_0_0_0_1px_var(--line)]"
          >
            <span className="h-5 w-5 animate-spin rounded-full border-[2.4px] border-accent/25 border-t-accent" />
            Загрузка
          </div>
        ))}

        {free > 0 && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex aspect-square flex-col items-center justify-center gap-0.5 rounded-[10px] border-[1.5px] border-dashed border-dash bg-dash-bg text-[11px] font-semibold text-accent-ink"
          >
            <Plus size={20} strokeWidth={2.2} />
            Добавить
          </button>
        )}
      </div>

      <span className="text-xs leading-4 text-hint">{hint}</span>
      <FieldError message={problem ?? error} />

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </section>
  );
}

const TILE_BUTTON =
  "absolute top-1 flex h-6 w-6 items-center justify-center rounded-full bg-white/92 text-[#52525b]";
