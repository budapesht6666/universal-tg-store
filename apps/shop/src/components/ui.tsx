/** Мелкие общие элементы интерфейса магазина. */
import { Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { haptic } from "../lib/telegram.ts";

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

export function PrimaryButton({
  children,
  disabled,
  loading,
  onClick,
  type = "button",
}: {
  children: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-accent px-[18px] text-base font-semibold text-white disabled:bg-muted disabled:text-hint"
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
