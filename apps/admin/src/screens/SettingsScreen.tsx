/** «Настройки»: магазин, часы работы, отмена покупателем, фичи меню. Регион — только для чтения. */
import {
  FEATURE_HINTS,
  FEATURE_LABELS,
  type FeatureKey,
  REGIONS,
  type WeekHours,
} from "@store/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { HoursEditor } from "../components/HoursEditor.tsx";
import { ImageUpload } from "../components/ImageUpload.tsx";
import {
  FIELD_LABEL,
  FieldError,
  issuesToErrors,
  PrimaryButton,
  Spinner,
  TEXTAREA,
  TextField,
  Toggle,
} from "../components/ui.tsx";
import { ApiError, api, type Settings } from "../lib/api.ts";
import { atUsername, fromAtInput } from "../lib/telegram.ts";

export function SettingsScreen() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  if (settings.isPending) return <Spinner />;
  if (settings.isError)
    return <div className="p-8 text-center text-hint">{settings.error.message}</div>;
  return <SettingsForm initial={settings.data} />;
}

function SettingsForm({ initial }: { initial: Settings }) {
  const queryClient = useQueryClient();
  const [shop, setShop] = useState(initial.shop);
  const [hours, setHours] = useState<WeekHours>(initial.hours);
  const [features, setFeatures] = useState(initial.features);
  const [orders, setOrders] = useState(initial.orders);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // «Сохранено», пока форма совпадает с тем, что вернул сервер; любая правка — снова «Сохранить».
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const saved = savedSnapshot === JSON.stringify({ shop, hours, features, orders });

  const save = useMutation({
    mutationFn: () => api.saveSettings({ shop, hours, features, orders }),
    onMutate: () => setErrors({}),
    onSuccess: (s) => {
      setShop(s.shop);
      setHours(s.hours);
      setFeatures(s.features);
      setOrders(s.orders);
      setSavedSnapshot(
        JSON.stringify({ shop: s.shop, hours: s.hours, features: s.features, orders: s.orders }),
      );
      queryClient.setQueryData(["settings"], s);
      void queryClient.invalidateQueries({ queryKey: ["shop"] });
      void queryClient.invalidateQueries({ queryKey: ["board"] });
    },
    onError: (err) =>
      setErrors(
        err instanceof ApiError && err.issues.length
          ? issuesToErrors(err.issues)
          : { form: err.message },
      ),
  });

  const region = initial.region;
  const regionLabel = REGIONS[region.country]?.label ?? region.country;
  const current = JSON.stringify({ shop, hours, features, orders });
  const base =
    savedSnapshot ??
    JSON.stringify({
      shop: initial.shop,
      hours: initial.hours,
      features: initial.features,
      orders: initial.orders,
    });
  const dirty = current !== base;
  const saveLabel = saved ? "Сохранено" : "Сохранить";

  return (
    <form
      className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 p-4 pb-28 lg:px-7 lg:py-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 flex-1 basis-48 text-2xl font-bold">Настройки</h1>
        {dirty && <span className="hidden text-hint lg:inline">Есть несохранённые изменения</span>}
        <button
          type="submit"
          disabled={save.isPending}
          className="hidden h-[38px] rounded-lg bg-accent px-[18px] font-semibold text-white disabled:opacity-60 lg:block"
        >
          {save.isPending ? "Сохраняем…" : saveLabel}
        </button>
      </header>

      <div className="flex flex-wrap items-start gap-5 lg:gap-4">
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-5 lg:gap-4">
          <Card title="Магазин">
            <TextField
              label="Название"
              value={shop.name}
              onChange={(name) => setShop({ ...shop, name })}
              error={errors["shop.name"]}
            />
            <div className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Логотип — в шапке магазина</span>
              <ImageUpload
                value={shop.logo}
                onChange={(logo) => {
                  const { logo: _old, ...rest } = shop;
                  setShop(logo ? { ...rest, logo } : rest);
                }}
                hint="Квадрат, от 256 px. Обычно тот же, что аватар бота."
                error={errors["shop.logo.url"]}
                noun="логотип"
              />
            </div>
            <TextField
              label="Telegram менеджера — необязательно"
              value={atUsername(shop.manager)}
              onChange={(v) => setShop({ ...shop, manager: fromAtInput(v) })}
              placeholder="@pechka_manager"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              hint="Покупатели смогут написать ему со страницы заказа."
              error={errors["shop.manager"]}
            />
          </Card>

          <Card
            title="Бот в Telegram"
            hint="Название, описание и «О себе» бот обновит сам после сохранения."
          >
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Приветствие на /start</span>
              <textarea
                rows={8}
                value={shop.greeting}
                onChange={(e) => setShop({ ...shop, greeting: e.target.value })}
                maxLength={1000}
                className={TEXTAREA}
              />
              <FieldError message={errors["shop.greeting"]} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={FIELD_LABEL}>Описание — в пустом чате до первого /start</span>
              <textarea
                rows={7}
                value={shop.botDescription}
                onChange={(e) => setShop({ ...shop, botDescription: e.target.value })}
                maxLength={512}
                className={TEXTAREA}
              />
              <FieldError message={errors["shop.botDescription"]} />
            </label>
            <TextField
              label="«О себе» в профиле бота"
              value={shop.botAbout}
              onChange={(botAbout) => setShop({ ...shop, botAbout })}
              maxLength={120}
              error={errors["shop.botAbout"]}
              hint={`${shop.botAbout.length} из 120 символов`}
            />
          </Card>
        </div>

        <div className="flex min-w-0 flex-[1_1_380px] flex-col gap-5 lg:gap-4">
          <Card title="Часы работы" hint="Вне этих часов меню видно, но оформить заказ нельзя.">
            <HoursEditor value={hours} onChange={setHours} />
            <FieldError
              message={Object.entries(errors).find(([k]) => k.startsWith("hours"))?.[1]}
            />
            <p className="m-0 flex flex-col text-xs leading-[17px] text-hint">
              <span>Работаете за полночь, например 18:00–02:00, — тоже можно.</span>
              <span>Если на кухне завал — в заказах есть пауза.</span>
            </p>
          </Card>

          <Card title="Заказы и меню">
            <div className="flex flex-col rounded-2xl bg-card lg:rounded-none">
              <Row
                title="Покупатель может отменить заказ сам"
                hint="Пока заказ «Оформлен». Потом — только просьба менеджеру"
                checked={orders.customerCanCancel}
                onChange={(customerCanCancel) => setOrders({ ...orders, customerCanCancel })}
              />
              {(Object.keys(FEATURE_LABELS) as FeatureKey[]).map((key) => (
                <Row
                  key={key}
                  title={FEATURE_LABELS[key]}
                  hint={FEATURE_HINTS[key]}
                  checked={features[key]}
                  onChange={(v) => setFeatures({ ...features, [key]: v })}
                />
              ))}
            </div>
          </Card>

          <Card title="Регион">
            <span className="font-semibold">
              {regionLabel} · {region.currency} · {region.timeZone} · +{region.phoneCode}
            </span>
            <span className="-mt-2 text-[13px] text-hint">
              Страну и валюту после настройки не поменять: от них зависят все цены.
            </span>
          </Card>
        </div>
      </div>

      <FieldError message={errors.form} />
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-10 bg-page px-4 pt-3 lg:hidden">
        <PrimaryButton type="submit" loading={save.isPending}>
          {saveLabel}
        </PrimaryButton>
      </div>
    </form>
  );
}

/** Секция настроек: на телефоне — заголовок и поля, на компьютере — карточка. */
function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 lg:rounded-xl lg:bg-card lg:p-4 lg:shadow-[inset_0_0_0_1px_var(--line)]">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 text-[17px] font-bold lg:text-base">{title}</h2>
        {hint && <span className="text-[13px] text-hint">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Row({
  title,
  hint,
  checked,
  onChange,
}: {
  title: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-line px-3.5 py-3 last:border-b-0">
      <div className="flex flex-1 flex-col">
        <span className="font-semibold">{title}</span>
        <span className="text-xs text-hint">{hint}</span>
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} />
    </div>
  );
}
