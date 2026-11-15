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

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 p-4 lg:p-6">
      <h1 className="m-0 text-2xl font-bold">Команда</h1>
      <div className="flex flex-col overflow-hidden rounded-2xl bg-card">
        {team.data.members.map((m) => (
          <MemberRow key={m.id} member={m} />
        ))}
      </div>

      <div className="flex flex-col gap-2 rounded-2xl bg-card p-4">
        <span className="flex items-center gap-2 font-bold">
          <UserPlus size={18} /> Пригласить
        </span>
        <span className="text-[13px] text-hint">
          Ссылка одноразовая, на 24 часа. Человек открывает её в Telegram и делится номером — и он в
          команде.
        </span>
        <div className="flex gap-2">
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
          <span className="text-[13px] text-warn-ink">Бот не запущен — ссылку создать нельзя.</span>
        )}
        <FieldError message={create.error?.message} />
      </div>
    </div>
  );
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
      className={`flex flex-col gap-2 border-b border-line px-4 py-3 last:border-b-0 ${m.active ? "" : "opacity-60"}`}
    >
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold">
            {m.name}
            {m.username && <span className="font-normal text-hint"> · @{m.username}</span>}
          </span>
          <span className="text-[13px] text-hint">
            {m.roles.map((r) => ROLE_LABELS[r]).join(", ") || "Без роли"}
            {m.phone ? ` · ${m.phone}` : ""}
          </span>
        </div>
        {!isOwner && (
          <Toggle
            checked={m.active}
            label={`${m.name}: доступ`}
            onChange={(active) => update.mutate({ active })}
          />
        )}
      </div>
      {isOwner && (
        <span className="flex flex-col text-[13px] text-hint">
          <span>Владелец может всё, что менеджер: принимает заказы, ведёт меню.</span>
          <span>Роль курьера — если развозите сами.</span>
        </span>
      )}
      <div className="flex flex-wrap gap-2">
        {(isOwner ? (["courier"] as const) : (["manager", "courier"] as const)).map((role) => (
          <button
            key={role}
            type="button"
            disabled={update.isPending}
            onClick={() => toggleRole(role)}
            className={`h-8 rounded-lg px-3 text-sm font-semibold ${
              extra.includes(role) ? "bg-accent-soft text-accent-ink" : "bg-page text-hint"
            }`}
          >
            {ROLE_LABELS[role]}
          </button>
        ))}
      </div>
      <FieldError message={update.error?.message} />
    </div>
  );
}
