/** Мелкие общие элементы интерфейса магазина. */
import { Minus, Plus } from "lucide-react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { haptic } from "../lib/telegram.ts";

export { haptic };

export function Stepper({
  qty,
  onAdd,
  onRemove,
  max,
  tone = "accent",
}: {
  qty: number;
  onAdd: () => void;
  onRemove: () => void;
  max: number;
  tone?: "accent" | "plain";
}) {
  const cls = tone === "accent" ? "bg-accent text-white" : "bg-page text-ink";
  return (
    <div className={`flex h-9 flex-none items-center rounded-xl font-bold ${cls}`}>
      <button
        type="button"
        aria-label="Убрать одну порцию"
        className="flex h-9 w-9 items-center justify-center"
        onClick={() => {
          haptic.tap();
          onRemove();
        }}
      >
        <Minus size={18} strokeWidth={2.4} />
      </button>
      <span className="min-w-4 text-center tabular-nums">{qty}</span>
      <button
        type="button"
        aria-label="Добавить порцию"
        disabled={qty >= max}
        className="flex h-9 w-9 items-center justify-center disabled:opacity-40"
        onClick={() => {
          haptic.tap();
          onAdd();
        }}
      >
        <Plus size={18} strokeWidth={2.4} />
      </button>
    </div>
  );
}

export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Добавить: ${label}`}
      className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-accent-soft text-accent-ink"
      onClick={() => {
        haptic.tap();
        onClick();
      }}
    >
      <Plus size={18} strokeWidth={2.4} />
    </button>
  );
}

/** Нижняя панель с главной кнопкой экрана. */
export function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="safe-bottom fixed inset-x-0 bottom-0 z-20 bg-page px-4 pt-3">
      <div className="mx-auto flex w-full max-w-[528px] flex-col gap-2">{children}</div>
    </div>
  );
}

/**
 * Главная кнопка. tone="ok" — зелёная крупная «Доставлен» у курьера;
 * compactOnDesktop — 44px на компьютере (карточки заказов в колонках).
 */
export function PrimaryButton({
  children,
  disabled,
  loading,
  onClick,
  type = "button",
  tone = "accent",
  compactOnDesktop = false,
}: {
  children: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  tone?: "accent" | "ok";
  compactOnDesktop?: boolean;
}) {
  const look =
    tone === "ok"
      ? "h-14 bg-ok text-[17px] font-bold"
      : "h-[52px] bg-accent text-base font-semibold";
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={`flex w-full items-center justify-center gap-2 rounded-[14px] px-[18px] text-white disabled:bg-muted disabled:text-hint ${look} ${
        compactOnDesktop ? "lg:h-11 lg:rounded-xl lg:text-[15px]" : ""
      }`}
    >
      {loading ? (
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
      ) : (
        children
      )}
    </button>
  );
}

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 text-[17px] leading-[22px] font-bold">{title}</h2>
        {hint && <span className="text-[13px] leading-[18px] text-hint">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

export function FieldError({ message }: { message: string | undefined }) {
  if (!message) return null;
  return <span className="text-[13px] leading-[18px] text-danger">{message}</span>;
}

export function Screen({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex min-h-screen w-full max-w-[560px] flex-col">{children}</div>;
}

export function Spinner() {
  return (
    <div className="flex flex-1 items-center justify-center py-24">
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-line border-t-accent" />
    </div>
  );
}

export function Notice({
  tone,
  icon,
  title,
  children,
}: {
  tone: "warn" | "neutral" | "accent";
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  const cls = {
    warn: "bg-warn-bg text-warn-ink",
    neutral: "bg-muted text-ink",
    accent: "bg-accent-soft text-accent-ink",
  }[tone];
  return (
    <div role="status" className={`flex gap-3 rounded-2xl p-3.5 ${cls}`}>
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-card">
        {icon}
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="font-bold">{title}</span>
        {children && <span className="text-[13px] leading-[18px]">{children}</span>}
      </div>
    </div>
  );
}

/** Переключатель «да / нет» (Есть в наличии, Скрыто, фичи). */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[31px] w-[51px] flex-none rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-ok" : "bg-line"
      }`}
    >
      <span
        className={`absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-all ${
          checked ? "left-[22px]" : "left-[2px]"
        }`}
      />
    </button>
  );
}

/** Нижняя шторка с выбором: курьер, причина отмены, пауза. */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <button
        type="button"
        aria-label="Закрыть"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-label={title}
        className="safe-bottom relative flex max-h-[85vh] w-full max-w-[480px] flex-col gap-3 overflow-y-auto rounded-t-3xl bg-card p-4 md:rounded-3xl"
      >
        <h2 className="m-0 text-[17px] font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Подпись поля: на телефоне мелкая серая, на компьютере — тёмная, как в макетах админки. */
export const FIELD_LABEL = "text-[13px] text-hint lg:text-sm lg:font-medium lg:text-ink";
/** Многострочное поле в том же стиле, что TextField. */
export const TEXTAREA =
  "resize-y rounded-xl border border-line bg-card px-3.5 py-3 outline-none focus:border-accent lg:rounded-lg lg:px-3 lg:py-2";

export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  ...rest
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  hint?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <label className="flex flex-col gap-1.5" data-error={!!error}>
      <span className={FIELD_LABEL}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`h-11 rounded-xl border bg-card px-3.5 outline-none placeholder:text-hint focus:border-accent lg:h-[38px] lg:rounded-lg lg:px-3 ${
          error ? "border-danger" : "border-line"
        }`}
        {...rest}
      />
      {hint && !error && <span className="text-xs text-hint">{hint}</span>}
      <FieldError message={error} />
    </label>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
  tone = "plain",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "plain" | "accent" | "danger";
}) {
  const cls = {
    plain: "bg-muted text-ink",
    accent: "bg-accent-soft text-accent-ink",
    danger: "bg-muted text-danger",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-11 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}

/** Ошибки сервера по полям: { "shop.name": "…" }. */
export function issuesToErrors(
  issues: { path: string; message: string }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) out[i.path] ??= i.message;
  return out;
}
