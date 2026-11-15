/** «Настройки»: магазин, часы работы, отмена покупателем, фичи меню. Регион — только для чтения. */
import { FEATURE_LABELS, type FeatureKey, REGIONS, type WeekHours } from "@store/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { HoursEditor } from "../components/HoursEditor.tsx";
import { ImageUpload } from "../components/ImageUpload.tsx";
import {
  FieldError,
  issuesToErrors,
  PrimaryButton,
  Spinner,
  TextField,
  Toggle,
} from "../components/ui.tsx";
import { ApiError, api, type Settings } from "../lib/api.ts";

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
  const [saved, setSaved] = useState(false);

  useEffect(() => setSaved(false), [shop, hours, features, orders]);

  const save = useMutation({
    mutationFn: () => api.saveSettings({ shop, hours, features, orders }),
    onMutate: () => setErrors({}),
    onSuccess: (s) => {
      setShop(s.shop);
      queryClient.setQueryData(["settings"], s);
      void queryClient.invalidateQueries({ queryKey: ["shop"] });
      void queryClient.invalidateQueries({ queryKey: ["board"] });
      setSaved(true);
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

  return (
    <form
      className="mx-auto flex w-full max-w-[640px] flex-col gap-5 p-4 pb-28 lg:p-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h1 className="m-0 text-2xl font-bold">Настройки</h1>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-[17px] font-bold">Магазин</h2>
        <TextField
          label="Название"
          value={shop.name}
          onChange={(name) => setShop({ ...shop, name })}
          error={errors["shop.name"]}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-hint">Логотип — в шапке магазина</span>
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
          label="Телефон — покажем покупателям"
          value={shop.phone}
          onChange={(phone) => setShop({ ...shop, phone })}
          type="tel"
          error={errors["shop.phone"]}
        />
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] text-hint">Приветствие бота на /start</span>
          <textarea
            rows={8}
            value={shop.greeting}
            onChange={(e) => setShop({ ...shop, greeting: e.target.value })}
            maxLength={1000}
            className="resize-y rounded-xl border border-line bg-card px-3.5 py-3 outline-none focus:border-accent"
          />
          <FieldError message={errors["shop.greeting"]} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] text-hint">
            Описание бота — видно в пустом чате до первого /start
          </span>
          <textarea
            rows={8}
            value={shop.botDescription}
            onChange={(e) => setShop({ ...shop, botDescription: e.target.value })}
            maxLength={512}
            className="resize-y rounded-xl border border-line bg-card px-3.5 py-3 outline-none focus:border-accent"
          />
          <FieldError message={errors["shop.botDescription"]} />
        </label>
        <TextField
          label="«О себе» в профиле бота — до 120 символов"
          value={shop.botAbout}
          onChange={(botAbout) => setShop({ ...shop, botAbout })}
          maxLength={120}
          error={errors["shop.botAbout"]}
        />
        <span className="text-[13px] text-hint">
          Название, описание и «О себе» бот обновит сам после сохранения.
        </span>
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="m-0 mb-2 text-[17px] font-bold">Регион</h2>
        <span className="font-semibold">
          {regionLabel} · {region.currency} · {region.timeZone} · +{region.phoneCode}
        </span>
        <span className="text-[13px] text-hint">
          Страну и валюту после настройки не поменять: от них зависят все цены.
        </span>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-[17px] font-bold">Часы работы</h2>
        <HoursEditor value={hours} onChange={setHours} />
        <FieldError message={Object.entries(errors).find(([k]) => k.startsWith("hours"))?.[1]} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="m-0 text-[17px] font-bold">Заказы и меню</h2>
        <div className="flex flex-col rounded-2xl bg-card">
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
              hint={
                key === "discounts"
                  ? "Зачёркнутая цена и «−15%» на карточке"
                  : "«Хит», «Острое 🌶», «Вег»"
              }
              checked={features[key]}
              onChange={(v) => setFeatures({ ...features, [key]: v })}
            />
          ))}
        </div>
      </section>

      <FieldError message={errors.form} />
      <div className="safe-bottom fixed inset-x-0 bottom-0 z-10 bg-page px-4 pt-3 lg:static lg:p-0">
        <div className="mx-auto max-w-[608px]">
          <PrimaryButton type="submit" loading={save.isPending}>
            {saved ? "Сохранено" : "Сохранить"}
          </PrimaryButton>
        </div>
      </div>
    </form>
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
