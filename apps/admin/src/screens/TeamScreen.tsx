/**
 * «Команда»: кто работает, роли, выключить доступ, пригласить курьера или менеджера
 * одноразовой ссылкой на 24 часа (человек открывает её в Telegram и делится номером).
 */
import { type InviteRole, ROLE_LABELS } from "@store/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Send, UserPlus } from "lucide-react";
import { useState } from "react";
import { FieldError, SecondaryButton, Spinner, Toggle } from "../components/ui.tsx";
import { api, type Invite, type Member } from "../lib/api.ts";
import { openTelegram } from "../lib/telegram.ts";

export function TeamScreen() {
  const team = useQuery({ queryKey: ["team"], queryFn: api.team });
  const [invite, setInvite] = useState<Invite | null>(null);
  const create = useMutation({
    mutationFn: (role: InviteRole) => api.invite(role),
    onSuccess: setInvite,
  });

  if (team.isPending) return <Spinner />;
  if (team.isError) return <div className="p-8 text-center text-hint">{team.error.message}</div>;

  const members = team.data.members;
  const couriers = members.filter((m) => m.active && m.roles.includes("courier")).length;
  const managers = members.filter((m) => m.active && m.roles.includes("manager")).length;

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-4 p-4 lg:gap-5 lg:px-7 lg:py-6">
      <header className="flex flex-col">
        <h1 className="m-0 text-2xl font-bold">Команда</h1>
        <span className="text-[13px] text-hint lg:text-sm">
          {people(members.length)} · курьеров: {couriers} · менеджеров: {managers}
        </span>
      </header>

      <div className="flex flex-wrap items-start gap-4">
        <section
          aria-label="Кто работает"
          className="flex min-w-0 flex-[3_1_480px] flex-col overflow-hidden rounded-2xl bg-card lg:rounded-xl lg:shadow-[inset_0_0_0_1px_var(--line)]"
        >
          {members.map((m) => (
            <MemberRow key={m.id} member={m} />
          ))}
          <p className="m-0 flex flex-col px-4 py-3 text-xs leading-[17px] text-hint">
            <span>Владелец может всё, что менеджер: принимает заказы, ведёт меню.</span>
            <span>
              Выключенный доступ — человек остаётся в списке, но заказов и админки не видит.
            </span>
          </p>
        </section>

        <section
          aria-label="Пригласить"
          className="flex min-w-0 flex-[1_1_320px] flex-col gap-3 rounded-2xl bg-card p-4 lg:max-w-[420px] lg:rounded-xl lg:shadow-[inset_0_0_0_1px_var(--line)]"
        >
          <h2 className="m-0 flex items-center gap-2 text-base font-bold">
            <UserPlus size={18} /> Пригласить
          </h2>
          <p className="m-0 flex flex-col text-[13px] leading-[18px] text-hint">
            <span>Ссылка одноразовая, на 24 часа.</span>
            <span>Человек открывает её в Telegram, делится номером — и он в команде.</span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            <SecondaryButton
              tone="accent"
              disabled={create.isPending}
              onClick={() => create.mutate("courier")}
            >
              Курьера
            </SecondaryButton>
            <SecondaryButton
              tone="accent"
              disabled={create.isPending}
              onClick={() => create.mutate("manager")}
            >
              Менеджера
            </SecondaryButton>
          </div>
          {invite?.link && <InviteLink link={invite.link} role={invite.role} />}
          {invite && !invite.link && (
            <span className="text-[13px] text-warn-ink">
              Бот не запущен — ссылку создать нельзя.
            </span>
          )}
          <FieldError message={create.error?.message} />
          <span className="text-xs text-hint">Когда человек вступит, бот напишет вам.</span>
        </section>
      </div>
    </div>
  );
}

function people(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} человек`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} человека`;
  return `${n} человек`;
}

function InviteLink({ link, role }: { link: string; role: InviteRole }) {
  const [copied, setCopied] = useState(false);
  const text = `Приглашение в команду: ${ROLE_LABELS[role].toLowerCase()}`;
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-page p-3">
      <span className="text-sm font-semibold">{ROLE_LABELS[role]}: ссылка готова</span>
      <code className="text-xs break-all text-hint">{link}</code>
      <div className="flex gap-2">
        <SecondaryButton
          tone="accent"
          onClick={() =>
            openTelegram(
              `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`,
            )
          }
        >
          <Send size={16} /> Отправить
        </SecondaryButton>
        <SecondaryButton
          onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}
        >
          <Copy size={16} /> {copied ? "Скопировано" : "Копировать"}
        </SecondaryButton>
      </div>
    </div>
  );
}

function MemberRow({ member: m }: { member: Member }) {
  const queryClient = useQueryClient();
  const isOwner = m.roles.includes("owner");
  const update = useMutation({
    mutationFn: (body: { roles?: InviteRole[]; active?: boolean }) => api.updateMember(m.id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["team"] });
      void queryClient.invalidateQueries({ queryKey: ["couriers"] });
    },
  });
  const extra = m.roles.filter((r): r is InviteRole => r !== "owner");
  const toggleRole = (role: InviteRole) =>
    update.mutate({
      roles: extra.includes(role) ? extra.filter((r) => r !== role) : [...extra, role],
    });

  return (
    <div
      className={`flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 ${m.active ? "" : "opacity-55"}`}
    >
      <span
        className={`flex h-9 w-9 flex-none items-center justify-center rounded-full font-bold ${
          isOwner ? "bg-accent-soft text-accent-ink" : "bg-muted"
        }`}
      >
        {m.name.charAt(0)}
      </span>
      <div className="flex min-w-0 flex-[1_1_180px] flex-col leading-[18px]">
        <span className="font-semibold">
          {m.name}
          {m.username && <span className="font-normal text-hint"> @{m.username}</span>}
        </span>
        <span className="text-[13px] text-hint">
          {m.active
            ? m.roles.map((r) => ROLE_LABELS[r]).join(", ") || "Без роли"
            : "Доступ выключен"}
          {m.phone ? ` · ${m.phone}` : ""}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5 lg:w-[200px]">
        {isOwner && (
          <span className="flex h-7 items-center rounded-[7px] bg-accent-soft px-2.5 text-[13px] font-semibold text-accent-ink">
            {ROLE_LABELS.owner}
          </span>
        )}
        {(isOwner ? (["courier"] as const) : (["manager", "courier"] as const)).map((role) => (
          <button
            key={role}
            type="button"
            aria-pressed={extra.includes(role)}
            disabled={update.isPending}
            onClick={() => toggleRole(role)}
            className={`h-7 rounded-[7px] px-2.5 text-[13px] font-semibold ${
              extra.includes(role) ? "bg-accent-soft text-accent-ink" : "bg-page text-hint"
            }`}
          >
            {ROLE_LABELS[role]}
          </button>
        ))}
      </div>
      <div className="flex w-11 justify-end">
        {!isOwner && (
          <Toggle
            checked={m.active}
            label={`${m.name}: доступ`}
            onChange={(active) => update.mutate({ active })}
          />
        )}
      </div>
      {update.error && (
        <div className="basis-full">
          <FieldError message={update.error.message} />
        </div>
      )}
    </div>
  );
}
