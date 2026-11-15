/** Картинка с загрузкой: превью, «Загрузить / Заменить», удалить. Сервер сам сжимает в WebP. */
import type { ImageRef } from "@store/schema";
import { useMutation } from "@tanstack/react-query";
import { ImagePlus, Trash2 } from "lucide-react";
import { useRef } from "react";
import { api } from "../lib/api.ts";
import { FieldError, SecondaryButton } from "./ui.tsx";

export function ImageUpload({
  value,
  onChange,
  hint,
  error,
  noun = "фото",
}: {
  value: ImageRef | undefined;
  onChange: (image: ImageRef | undefined) => void;
  hint: string;
  error?: string | undefined;
  noun?: string;
}) {
  const file = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (f: File) => api.upload(f),
    onSuccess: ({ url }) => onChange({ url }),
  });

  return (
    <div className="flex items-center gap-3">
      <span className="flex h-24 w-24 flex-none items-center justify-center overflow-hidden rounded-2xl bg-accent-soft text-accent-ink">
        {value ? (
          <img src={value.url} alt="" className="h-full w-full object-cover" />
        ) : (
          <ImagePlus size={28} />
        )}
      </span>
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <SecondaryButton
            tone="accent"
            disabled={upload.isPending}
            onClick={() => file.current?.click()}
          >
            {upload.isPending ? "Загружаем…" : value ? `Заменить ${noun}` : `Загрузить ${noun}`}
          </SecondaryButton>
          {value && (
            <SecondaryButton onClick={() => onChange(undefined)}>
              <Trash2 size={15} />
            </SecondaryButton>
          )}
        </div>
        <span className="text-xs text-hint">{hint}</span>
        <FieldError message={upload.error?.message ?? error} />
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
