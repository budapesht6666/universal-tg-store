/**
 * Мастер первой настройки (владелец, один раз): страна и магазин → часы работы → меню.
 * Потом — «Магазин открыт»: пригласить курьера и войти с компьютера.
 */
import { type RegionCode, regionFor, SetupInputSchema, type WeekHours } from "@store/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, Copy, Send } from "lucide-react";
import { useState } from "react";
import { defaultHours, HoursEditor } from "../components/HoursEditor.tsx";
import {
  FieldError,
  issuesToErrors,
  PrimaryButton,
  SecondaryButton,
  Spinner,
  TextField,
} from "../components/ui.tsx";
import { ApiError, api } from "../lib/api.ts";
import { openTelegram } from "../lib/telegram.ts";

export function SetupScreen() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const info = useQuery({ queryKey: ["setup"], queryFn: api.setupInfo });
  const [step, setStep] = useState(1);
  const [country, setCountry] = useState<RegionCode>("VN");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [hours, setHours] = useState<WeekHours>(defaultHours);
  const [menu, setMenu] = useState<"demo" | "empty">("demo");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  const body = { country, shop: { name, phone }, hours, menu };
  const save = useMutation({
    mutationFn: () => api.setup(body),
    onSuccess: async () => {
      setDone(true);
      await queryClient.invalidateQueries();
    },
    onError: (err) => {
      if (err instanceof ApiError) setErrors(issuesToErrors(err.issues));
    },
  });

  if (info.isPending) return <Spinner />;
  if (info.data && !info.data.needed && !done) {
    return (
      <div className="flex flex-col items-center gap-3 p-8 text-center">
        Магазин уже настроен.
        <SecondaryButton onClick={() => navigate({ to: "/" })}>К заказам</SecondaryButton>
      </div>
    );
  }
  if (info.data && !info.data.isOwner) {
    return <div className="p-8 text-center text-hint">Настраивает магазин владелец.</div>;
  }
  if (done)
    return <SetupDone shopName={name} onOpen={() => navigate({ to: "/", replace: true })} />;

  const region = regionFor(country);
  const next = () => {
    if (step === 1) {
      const r = SetupInputSchema.safeParse(body);
      const shopIssues = r.success ? [] : r.error.issues.filter((i) => i.path[0] === "shop");
      if (shopIssues.length) {
        setErrors(Object.fromEntries(shopIssues.map((i) => [i.path.join("."), i.message])));
        return;
      }
    }
    setErrors({});
    if (step < 3) setStep(step + 1);
    else save.mutate();
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[560px] flex-col gap-4 p-4 pb-32">
      <span className="text-[13px] font-semibold text-hint">Шаг {step} из 3</span>

      {step === 1 && (
        <>
          <h1 className="m-0 text-2xl font-bold">Страна и магазин</h1>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] text-hint">Страна</span>
            <div className="grid grid-cols-2 gap-2">
              {info.data?.regions.map((r) => (
                <button
                  key={r.code}
                  type="button"
                  onClick={() => setCountry(r.code as RegionCode)}
                  className={`h-11 rounded-xl font-semibold ${
                    country === r.code
                      ? "bg-accent-soft text-accent-ink shadow-[inset_0_0_0_2px_var(--accent)]"
                      : "bg-card"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <span className="flex flex-col text-[13px] text-hint">
              <span>
                Валюта {region.currency} · часовой пояс {region.timeZone} · код телефона +
                {region.phoneCode}
              </span>
              <span>Страну потом не поменять: от неё зависят все цены в меню.</span>
            </span>
          </div>
          <TextField
            label="Название магазина"
            value={name}
            onChange={setName}
            maxLength={64}
            error={errors["shop.name"]}
          />
          <TextField
            label="Телефон магазина — покажем покупателям"
            value={phone}
            onChange={setPhone}
            type="tel"
            inputMode="tel"
            placeholder={`+${region.phoneCode} …`}
            error={errors["shop.phone"]}
          />
        </>
      )}

      {step === 2 && (
        <>
          <h1 className="m-0 text-2xl font-bold">Когда принимаете заказы?</h1>
          <span className="flex flex-col gap-1 text-[13px] text-hint">
            <span>Вне этих часов меню видно, но оформить заказ нельзя.</span>
            <span>Работаете за полночь, например 18:00–02:00, — тоже можно.</span>
            <span>Если на кухне завал — в заказах есть пауза.</span>
          </span>
          <HoursEditor value={hours} onChange={setHours} />
          <FieldError message={Object.entries(errors).find(([k]) => k.startsWith("hours"))?.[1]} />
        </>
      )}

      {step === 3 && (
        <>
          <h1 className="m-0 text-2xl font-bold">С чего начать меню?</h1>
          {(
            [
              {
                key: "demo",
                title: "Загрузить демо-меню",
                text: "12 блюд домашней кухни в 6 категориях. Цены и названия поменяете с компьютера, лишнее удалите. Удобно, чтобы сразу пройти заказ самому.",
              },
              {
                key: "empty",
                title: "Начать с пустого",
                text: "Магазин откроется без блюд — добавите сами в разделе «Меню».",
              },
            ] as const
          ).map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setMenu(o.key)}
              className={`flex flex-col gap-1 rounded-2xl p-4 text-left ${
                menu === o.key ? "bg-accent-soft shadow-[inset_0_0_0_2px_var(--accent)]" : "bg-card"
              }`}
            >
              <span className="font-bold">{o.title}</span>
              <span className="text-[13px] text-hint">{o.text}</span>
            </button>
          ))}
          <FieldError
            message={
              save.error && !(save.error instanceof ApiError && save.error.issues.length)
                ? save.error.message
                : undefined
            }
          />
        </>
      )}

      <div className="safe-bottom fixed inset-x-0 bottom-0 bg-page px-4 pt-3">
        <div className="mx-auto flex max-w-[528px] gap-2">
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="h-[52px] rounded-[14px] bg-card px-5 font-semibold"
            >
              Назад
            </button>
          )}
          <PrimaryButton loading={save.isPending} onClick={next}>
            {step < 3 ? "Дальше" : "Готово"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function SetupDone({ shopName, onOpen }: { shopName: string; onOpen: () => void }) {
  const invite = useMutation({ mutationFn: () => api.invite("courier") });
  const [copied, setCopied] = useState(false);
  const link = invite.data?.link;
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[560px] flex-col gap-4 p-4 pb-32">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#e3f2e7] text-[#17753a]">
        <Check size={28} strokeWidth={2.6} />
      </span>
      <h1 className="m-0 text-2xl font-bold">Магазин «{shopName}» открыт</h1>
      <span className="text-hint">Новые заказы придут в чат с ботом — со звуком.</span>

      <div className="flex flex-col gap-2 rounded-2xl bg-card p-4">
        <span className="font-bold">Пригласите курьера</span>
        <span className="text-[13px] text-hint">
          Ссылка на 24 часа. Пока курьер один, заказы назначаются ему сами.
        </span>
        {link ? (
          <div className="flex gap-2">
            <SecondaryButton
              tone="accent"
              onClick={() =>
                openTelegram(
                  `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("Приглашение в команду курьером")}`,
                )
              }
            >
              <Send size={16} /> Отправить
            </SecondaryButton>
            <SecondaryButton
              onClick={() => {
                void navigator.clipboard.writeText(link).then(() => setCopied(true));
              }}
            >
              <Copy size={16} /> {copied ? "Скопировано" : "Копировать"}
            </SecondaryButton>
          </div>
        ) : (
          <SecondaryButton
            tone="accent"
            disabled={invite.isPending}
            onClick={() => invite.mutate()}
          >
            Создать ссылку для курьера
          </SecondaryButton>
        )}
        <FieldError message={invite.error?.message} />
      </div>

      <div className="flex flex-col gap-1 rounded-2xl bg-card p-4">
        <span className="font-bold">Меню удобнее с компьютера</span>
        <span className="text-[13px] text-hint">
          Напишите боту /login — пришлём ссылку для входа.
        </span>
      </div>

      <div className="safe-bottom fixed inset-x-0 bottom-0 bg-page px-4 pt-3">
        <div className="mx-auto max-w-[528px]">
          <PrimaryButton onClick={onOpen}>Открыть заказы</PrimaryButton>
        </div>
      </div>
    </div>
  );
}
