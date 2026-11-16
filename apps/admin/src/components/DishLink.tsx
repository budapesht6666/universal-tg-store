/**
 * Ссылка на блюдо для поста в канале или чата: t.me/<бот>?startapp=dish_<id> открывает
 * Mini App сразу на странице блюда. Работает, когда в BotFather включён Main Mini App —
 * иначе показываем предупреждение (сервер спрашивает getMe раз в минуту).
 */
import { dishStartParam } from "@store/schema";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import type { Catalog } from "../lib/api.ts";
import { copyText } from "../lib/telegram.ts";
import { FIELD_LABEL } from "./ui.tsx";

export function DishLink({
  link,
  dishId,
}: {
  link: NonNullable<Catalog["dishLink"]>;
  dishId: string;
}) {
  const url = `${link.base}${dishStartParam(dishId)}`;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div className="flex flex-col gap-1.5">
      <span className={FIELD_LABEL}>Ссылка на блюдо</span>
      <div className="flex gap-2">
        <span className="flex h-11 min-w-0 flex-1 items-center rounded-xl bg-readonly px-3.5 text-[13px] text-readonly-ink lg:h-[38px] lg:rounded-lg lg:px-3">
          <span className="truncate">{url.replace(/^https:\/\//, "")}</span>
        </span>
        <button
          type="button"
          onClick={async () => {
            if (await copyText(url)) setCopied(true);
          }}
          className={`flex h-11 flex-none items-center gap-1.5 rounded-xl bg-card px-3 font-medium shadow-[inset_0_0_0_1px_var(--line)] lg:h-[38px] lg:rounded-lg ${
            copied ? "text-ok" : ""
          }`}
        >
          {copied ? <Check size={16} strokeWidth={2.4} /> : <Copy size={16} />}
          {copied ? "Скопировано" : "Скопировать"}
        </button>
      </div>
      {link.mainAppReady ? (
        <span className="text-xs leading-4 text-hint">
          Вставьте в пост канала или отправьте в чат — блюдо откроется сразу в магазине
        </span>
      ) : (
        <span className="rounded-lg bg-caution px-2.5 py-2 text-xs leading-4 text-caution-ink">
          Ссылка заработает, когда в @BotFather у бота включат Main Mini App
        </span>
      )}
    </div>
  );
}
