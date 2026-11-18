/**
 * «Аналитика» (макет AdminAnalytics): период, пять главных цифр с изменением к прошлому
 * такому же периоду, график выбранной цифры, воронка, блюда, часы заказов, покупатели,
 * источники, работа команды и бот. Сотрудников сервер в статистике не считает.
 * Графики — свои div без библиотек: столбики одного цвета, наведение показывает значение.
 */
import {
  type AnalyticsPeriod,
  currencyDigits,
  percentChange,
  WEEKDAYS,
  type WeekHours,
} from "@store/schema";
import { useQuery } from "@tanstack/react-query";
import { Info, ShoppingCart } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Spinner } from "../components/ui.tsx";
import { type Analytics, api } from "../lib/api.ts";
import { useMoney, useShopInfo } from "../lib/session.ts";

type Metric = "visitors" | "orders" | "revenue" | "avgCheck" | "conversion";

const PERIODS: { id: AnalyticsPeriod; label: string; compare: string }[] = [
  { id: "today", label: "Сегодня", compare: "ко вчера" },
  { id: "7d", label: "7 дней", compare: "к прошлым 7 дням" },
  { id: "30d", label: "30 дней", compare: "к прошлым 30 дням" },
];

const CARD =
  "flex min-w-0 flex-col gap-3 rounded-2xl bg-card p-4 lg:rounded-xl lg:px-5 lg:shadow-[inset_0_0_0_1px_var(--line)]";

const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
};

const num = (n: number) => n.toLocaleString("ru-RU");
const pctText = (n: number) => `${String(n).replace(".", ",")}%`;

export function AnalyticsScreen() {
  const [period, setPeriod] = useState<AnalyticsPeriod>("7d");
  const [metric, setMetric] = useState<Metric>("visitors");
  const report = useQuery({
    queryKey: ["analytics", period],
    queryFn: () => api.analytics(period),
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
  });
  const shop = useShopInfo();
  const timeZone = shop.data?.ready ? shop.data.region.timeZone : undefined;

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-4 p-4 lg:px-7 lg:py-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-[1_1_260px] flex-col">
          <h1 className="m-0 text-2xl leading-[30px] font-bold">Аналитика</h1>
          <span className="text-[13px] text-hint lg:text-sm">
            {report.data ? rangeText(report.data, timeZone) : " "}
          </span>
        </div>
        <fieldset className="m-0 flex h-[38px] gap-0.5 rounded-[10px] border-0 bg-muted p-[3px]">
          <legend className="sr-only">Период</legend>
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={period === p.id}
              onClick={() => setPeriod(p.id)}
              className={`h-8 rounded-lg px-3.5 ${period === p.id ? "bg-card font-semibold shadow-sm" : "font-medium text-hint"}`}
            >
              {p.label}
            </button>
          ))}
        </fieldset>
      </header>

      {report.isPending && <Spinner />}
      {report.isError && <div className="p-8 text-center text-hint">{report.error.message}</div>}
      {report.data && (
        <Report
          data={report.data}
          period={period}
          metric={metric}
          onMetric={setMetric}
          timeZone={timeZone}
          hours={shop.data?.ready ? shop.data.hours : undefined}
          bot={shop.data?.bot ?? null}
        />
      )}
    </div>
  );
}

function rangeText(r: Analytics, timeZone: string | undefined): string {
  const from = new Date(r.from);
  const to = new Date(r.to);
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone }).format(d);
  if (r.period === "today") {
    const time = new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    }).format(to);
    return `Сегодня, ${fmt(to)}, до ${time}`;
  }
  const compare = PERIODS.find((p) => p.id === r.period)?.label ?? "";
  return `${fmt(from)} – ${fmt(to)} · сравнение с прошлыми ${compare}`;
}

function Report({
  data,
  period,
  metric,
  onMetric,
  timeZone,
  hours,
  bot,
}: {
  data: Analytics;
  period: AnalyticsPeriod;
  metric: Metric;
  onMetric: (m: Metric) => void;
  timeZone: string | undefined;
  hours: WeekHours | undefined;
  bot: string | null;
}) {
  const money = useMoney();
  const shop = useShopInfo();
  const currency = shop.data?.ready ? shop.data.region.currency : "VND";
  const compact = (minor: number) =>
    new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(
      minor / 10 ** currencyDigits(currency),
    );
  const compare = PERIODS.find((p) => p.id === period)?.compare ?? "";

  const since = data.trackingSince ? new Date(data.trackingSince) : null;
  const fresh = !since || since > new Date(data.from);
  const sinceText = since
    ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone }).format(since)
    : null;

  const tiles: {
    id: Metric;
    label: string;
    value: string;
    delta: { text: string; tone: "up" | "down" | "flat" } | null;
    chart: string;
    unit: (n: number) => string;
    axis: (n: number) => string;
  }[] = [
    {
      id: "visitors",
      label: "Посетители",
      value: num(data.kpi.visitors.value ?? 0),
      delta: percentDelta(data.kpi.visitors.value, data.kpi.visitors.prev),
      chart: "Посетители",
      unit: (n) => `${num(n)} ${plural(n, "посетитель", "посетителя", "посетителей")}`,
      axis: num,
    },
    {
      id: "orders",
      label: "Заказы",
      value: num(data.kpi.orders.value ?? 0),
      delta: percentDelta(data.kpi.orders.value, data.kpi.orders.prev),
      chart: "Заказы",
      unit: (n) => `${num(n)} ${plural(n, "заказ", "заказа", "заказов")}`,
      axis: num,
    },
    {
      id: "revenue",
      label: "Выручка",
      value: money(data.kpi.revenue.value ?? 0),
      delta: percentDelta(data.kpi.revenue.value, data.kpi.revenue.prev),
      chart: "Выручка, доставленные заказы",
      unit: money,
      axis: compact,
    },
    {
      id: "avgCheck",
      label: "Средний чек",
      value: data.kpi.avgCheck.value === null ? "—" : money(data.kpi.avgCheck.value),
      delta: percentDelta(data.kpi.avgCheck.value, data.kpi.avgCheck.prev),
      chart: "Средний чек",
      unit: money,
      axis: compact,
    },
    {
      id: "conversion",
      label: "Конверсия в заказ",
      value: data.kpi.conversion.value === null ? "—" : pctText(data.kpi.conversion.value),
      delta: pointsDelta(data.kpi.conversion.value, data.kpi.conversion.prev),
      chart: "Конверсия: заказали из зашедших",
      unit: pctText,
      axis: (n) => `${n}%`,
    },
  ];
  // biome-ignore lint/style/noNonNullAssertion: список плиток не пустой
  const tile = tiles.find((t) => t.id === metric) ?? tiles[0]!;

  return (
    <>
      {fresh && (
        <div
          role="status"
          className="flex gap-2.5 rounded-xl bg-accent-soft px-3.5 py-3 text-accent-ink"
        >
          <Info size={18} className="mt-px flex-none" />
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold">
              {sinceText
                ? `Посещения, корзины и источники считаем с ${sinceText}`
                : "Посещения, корзины и источники начнём считать с первого захода в магазин"}
            </span>
            <span className="text-[13px] leading-[18px]">
              Раньше этих данных нет — первые дни воронка будет неполной. Заказы, выручка и блюда —
              за всё время.
            </span>
          </div>
        </div>
      )}

      <section
        aria-label="Главные цифры"
        className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3"
      >
        {tiles.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={metric === t.id}
            onClick={() => onMetric(t.id)}
            className={`flex min-h-28 flex-col items-start gap-1 rounded-xl bg-card px-4 py-3.5 text-left ${
              metric === t.id
                ? "shadow-[inset_0_0_0_2px_var(--accent)]"
                : "shadow-[inset_0_0_0_1px_var(--line)]"
            }`}
          >
            <span className="text-[13px] font-medium text-hint">{t.label}</span>
            <span className="text-[26px] leading-8 font-bold tracking-tight whitespace-nowrap">
              {t.value}
            </span>
            <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-hint">
              {t.delta ? (
                <span
                  className={`font-semibold ${t.delta.tone === "up" ? "text-ok" : t.delta.tone === "down" ? "text-danger" : ""}`}
                >
                  {t.delta.text}
                </span>
              ) : (
                <span>нет данных</span>
              )}
              {compare}
            </span>
          </button>
        ))}
      </section>

      <BarChart
        title={`${tile.chart}${period === "today" ? " по часам" : " по дням"}`}
        buckets={data.series.map((b, i) => ({
          label: xLabel(period, b.label, i, data.series.length),
          title: period === "today" ? `Сегодня, ${b.title}` : b.title,
          value: b[metric] ?? 0,
        }))}
        unit={tile.unit}
        axis={tile.axis}
        dense={data.series.length > 20}
        integer={metric === "visitors" || metric === "orders"}
      />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] items-start gap-4">
        <Funnel data={data} money={money} />
        <TopDishes data={data} compact={compact} money={money} />
        <ByHour byHour={data.byHour} hours={hours} />
        <Customers data={data} money={money} />
        <Sources data={data} bot={bot} />
        <Operations data={data} />
        <BotCard data={data} period={period} />
      </div>
    </>
  );
}

function percentDelta(value: number | null, prev: number | null) {
  const p = percentChange(value, prev);
  if (p === null) return null;
  return { text: p > 0 ? `+${p}%` : p < 0 ? `−${-p}%` : "0%", tone: tone(p) };
}

function pointsDelta(value: number | null, prev: number | null) {
  if (value === null || prev === null) return null;
  const d = Math.round((value - prev) * 10) / 10;
  const abs = String(Math.abs(d)).replace(".", ",");
  return { text: d > 0 ? `+${abs} п.п.` : d < 0 ? `−${abs} п.п.` : "0 п.п.", tone: tone(d) };
}

const tone = (d: number): "up" | "down" | "flat" => (d > 0 ? "up" : d < 0 ? "down" : "flat");

/** Подписи под столбиками: часы — через один, 30 дней — число каждого пятого дня. */
function xLabel(period: AnalyticsPeriod, label: string, i: number, total: number): string {
  if (period === "today") return i % 2 === 0 ? label : "";
  if (period === "30d") return (total - 1 - i) % 5 === 0 ? (label.split(" ")[1] ?? label) : "";
  return label;
}

/** Круглый верх шкалы: 4 деления по 1, 2, 2.5, 3 или 5 × 10ⁿ; у штук — только целые деления. */
function niceStep(max: number, integer: boolean): number {
  if (max <= 0) return 1;
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 3, 5, 10]
    .map((m) => m * mag)
    .filter((s) => !integer || Number.isInteger(s))
    .find((s) => s >= raw);
  return step ?? (integer ? Math.max(Math.ceil(raw), 1) : raw);
}

function BarChart({
  title,
  buckets,
  unit,
  axis,
  dense,
  integer,
}: {
  title: string;
  buckets: { label: string; title: string; value: number }[];
  unit: (n: number) => string;
  axis: (n: number) => string;
  dense: boolean;
  integer: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const active = hover !== null && hover < buckets.length ? hover : buckets.length - 1;
  const step = niceStep(Math.max(...buckets.map((b) => b.value), 0), integer);
  const top = step * 4;
  const current = buckets[active];
  const gap = dense ? "gap-[3px]" : "gap-1.5 lg:gap-2.5";

  return (
    <section aria-label={title} className={CARD}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="m-0 flex-[1_1_200px] text-base leading-[22px] font-bold">{title}</h2>
        {current && (
          <span className="text-[13px] text-hint">
            {current.title} · {unit(current.value)}
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <div className="relative h-[200px] w-14 flex-none lg:w-16">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="absolute right-1 -translate-y-1/2 text-xs leading-[14px] whitespace-nowrap text-hint"
              style={{ top: `${100 - i * 25}%` }}
            >
              {axis(Math.round(step * i * 10) / 10)}
            </span>
          ))}
        </div>
        <div className="relative h-[200px] min-w-0 flex-1 border-b border-line">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="absolute inset-x-0 border-t border-line opacity-60"
              style={{ top: `${100 - i * 25}%` }}
            />
          ))}
          <div className={`absolute inset-0 flex items-end ${gap}`}>
            {buckets.map((b, i) => (
              <button
                key={i}
                type="button"
                aria-label={`${b.title}: ${unit(b.value)}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onClick={() => setHover(i)}
                className="flex h-full min-w-0 flex-1 cursor-default items-end"
              >
                <span
                  className={`w-full rounded-t ${i === active ? "bg-accent-ink" : "bg-accent"}`}
                  style={{
                    height: `${top > 0 ? Math.max((b.value / top) * 100, b.value > 0 ? 1.5 : 0) : 0}%`,
                  }}
                />
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className={`flex pl-16 lg:pl-[72px] ${gap}`}>
        {buckets.map((b, i) => (
          <span
            key={i}
            className="min-w-0 flex-1 overflow-visible text-center text-xs leading-4 whitespace-nowrap text-hint"
          >
            {b.label}
          </span>
        ))}
      </div>
    </section>
  );
}

function CardHead({ title, hint, right }: { title: string; hint?: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <div className="flex min-w-0 flex-[1_1_180px] flex-col">
        <h2 className="m-0 text-base leading-[22px] font-bold">{title}</h2>
        {hint && <span className="text-[13px] text-hint">{hint}</span>}
      </div>
      {right}
    </div>
  );
}

/** Горизонтальная полоска: подпись, значение, правая колонка и столбик доли. */
function HBar({
  label,
  value,
  right,
  share,
  title,
}: {
  label: string;
  value: string;
  right?: string;
  share: number;
  title?: string;
}) {
  return (
    <div title={title} className="flex flex-col gap-1">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="font-semibold">{value}</span>
        {right !== undefined && (
          <span className="w-[72px] text-right text-[13px] whitespace-nowrap text-hint lg:w-24">
            {right}
          </span>
        )}
      </div>
      <div className="h-2.5 rounded-r bg-muted">
        <div
          className="h-2.5 rounded-r bg-accent"
          style={{ width: `${Math.min(Math.max(share, share > 0 ? 1 : 0), 100)}%` }}
        />
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 py-2 text-[13px] text-hint">{children}</p>;
}

function Funnel({ data, money }: { data: Analytics; money: (n: number) => string }) {
  const f = data.funnel;
  const base = f.visited;
  const steps: [string, number][] = [
    ["Открыли магазин", f.visited],
    ["Положили в корзину", f.addedToCart],
    ["Перешли к оформлению", f.checkout],
    ["Оформили заказ", f.ordered],
    ["Получили заказ", f.delivered],
  ];
  const share = (n: number) => (base > 0 ? Math.min((n / base) * 100, 100) : 0);
  const people = data.abandoned.count;
  return (
    <section aria-label="Воронка" className={CARD}>
      <CardHead title="Воронка" hint="Уникальные покупатели за период" />
      {steps.map(([label, n], i) => {
        const prevStep = i > 0 ? steps[i - 1]?.[1] : undefined;
        return (
          <HBar
            key={label}
            label={label}
            value={num(n)}
            right={base > 0 ? `${Math.round(share(n))}%` : "—"}
            share={share(n)}
            {...(prevStep && {
              title: `${label}: ${Math.round((n / prevStep) * 100)}% от прошлого шага`,
            })}
          />
        );
      })}
      <div className="mt-1 flex items-center gap-3 rounded-lg bg-muted px-3.5 py-3">
        <ShoppingCart size={20} className="flex-none text-hint" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold">
            Бросили корзину: {num(people)} {plural(people, "человек", "человека", "человек")}
          </span>
          <span className="text-[13px] text-hint">
            {people > 0
              ? `Положили блюда на ${money(data.abandoned.total)} и не заказали`
              : "Все, кто положил блюда в корзину, заказали"}
          </span>
        </div>
      </div>
    </section>
  );
}

function TopDishes({
  data,
  compact,
  money,
}: {
  data: Analytics;
  compact: (n: number) => string;
  money: (n: number) => string;
}) {
  const max = Math.max(...data.topDishes.map((d) => d.qty), 1);
  return (
    <section aria-label="Популярные блюда" className={CARD}>
      <CardHead title="Популярные блюда" hint="Порций в доставленных заказах" />
      {data.topDishes.length === 0 && <Empty>Доставленных заказов за период пока нет</Empty>}
      {data.topDishes.map((d) => (
        <HBar
          key={d.productId}
          label={d.title}
          value={num(d.qty)}
          right={compact(d.revenue)}
          share={(d.qty / max) * 100}
          title={`${d.title}: ${d.qty} ${plural(d.qty, "порция", "порции", "порций")} · ${money(d.revenue)}`}
        />
      ))}
    </section>
  );
}

/** Часы на графике: рабочие часы недели плюс часы, когда были заказы. */
function hourSpan(byHour: number[], hours: WeekHours | undefined): [number, number] {
  let from = 23;
  let to = 0;
  for (const key of WEEKDAYS) {
    const d = hours?.[key];
    if (!d) continue;
    const open = Number(d.from.slice(0, 2));
    const close = Number(d.to.slice(0, 2)) - (d.to.endsWith(":00") ? 1 : 0);
    if (close <= open) return [0, 23];
    from = Math.min(from, open);
    to = Math.max(to, close);
  }
  byHour.forEach((n, h) => {
    if (n > 0) {
      from = Math.min(from, h);
      to = Math.max(to, h);
    }
  });
  return from <= to ? [from, to] : [0, 23];
}

function ByHour({ byHour, hours }: { byHour: number[]; hours: WeekHours | undefined }) {
  const [hover, setHover] = useState<number | null>(null);
  const [h0, h1] = hourSpan(byHour, hours);
  const list = Array.from({ length: h1 - h0 + 1 }, (_, i) => ({
    h: h0 + i,
    n: byHour[h0 + i] ?? 0,
  }));
  const max = Math.max(...list.map((x) => x.n), 1);
  const peak = Math.max(...list.map((x) => x.n));
  const peaks = list.filter((x) => x.n === peak && peak > 0).map((x) => `${x.h}:00`);
  const word = (n: number) => `${n} ${plural(n, "заказ", "заказа", "заказов")}`;
  const readout =
    hover !== null
      ? `${hover}:00–${hover + 1}:00 · ${word(byHour[hover] ?? 0)}`
      : peaks.length > 0
        ? `Пик — ${peaks.slice(0, 3).join(" и ")}`
        : "Заказов за период нет";
  return (
    <section aria-label="Когда заказывают" className={CARD}>
      <CardHead
        title="Когда заказывают"
        hint="Заказы по часу оформления"
        right={<span className="text-[13px] text-hint">{readout}</span>}
      />
      <div className="flex h-[140px] items-end gap-1 border-b border-line">
        {list.map((x) => (
          <button
            key={x.h}
            type="button"
            aria-label={`${x.h}:00–${x.h + 1}:00: ${word(x.n)}`}
            onMouseEnter={() => setHover(x.h)}
            onFocus={() => setHover(x.h)}
            onClick={() => setHover(x.h)}
            className="flex h-full min-w-0 flex-1 cursor-default items-end"
          >
            <span
              className={`w-full rounded-t ${hover === x.h ? "bg-accent-ink" : "bg-accent"}`}
              style={{ height: `${Math.max((x.n / max) * 100, x.n > 0 ? 2 : 0)}%` }}
            />
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        {list.map((x, i) => (
          <span
            key={x.h}
            className="min-w-0 flex-1 text-center text-[11px] leading-[14px] text-hint"
          >
            {i % 2 === 0 ? x.h : ""}
          </span>
        ))}
      </div>
    </section>
  );
}

function Customers({ data, money }: { data: Analytics; money: (n: number) => string }) {
  const c = data.customers;
  const total = c.newBuyers + c.returningBuyers;
  const newShare = total > 0 ? (c.newBuyers / total) * 100 : 50;
  return (
    <section aria-label="Покупатели" className={CARD}>
      <CardHead title="Покупатели" hint="Кто заказал за период" />
      <div className="flex h-3.5 gap-0.5 overflow-hidden rounded">
        {total === 0 ? (
          <div className="flex-1 bg-muted" />
        ) : (
          <>
            {c.newBuyers > 0 && (
              <div
                title="Первый заказ"
                className="bg-accent/45"
                style={{ width: `${newShare}%` }}
              />
            )}
            {c.returningBuyers > 0 && (
              <div title="Заказывали раньше" className="flex-1 bg-accent" />
            )}
          </>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label={
            <>
              <span className="h-2.5 w-2.5 rounded-[3px] bg-accent/45" />
              Первый заказ
            </>
          }
          value={num(c.newBuyers)}
        />
        <Stat
          label={
            <>
              <span className="h-2.5 w-2.5 rounded-[3px] bg-accent" />
              Заказывали раньше
            </>
          }
          value={num(c.returningBuyers)}
        />
      </div>
      <div className="flex flex-col border-t border-line">
        <Row
          label="Заказали 2 раза и больше"
          value={c.repeatShare === null ? "—" : pctText(c.repeatShare)}
        />
        <Row
          label="Средний чек у вернувшихся"
          value={c.returningAvgCheck === null ? "—" : money(c.returningAvgCheck)}
          last
        />
      </div>
    </section>
  );
}

function Sources({ data, bot }: { data: Analytics; bot: string | null }) {
  const max = Math.max(...data.sources.map((s) => s.visitors), 1);
  return (
    <section aria-label="Откуда пришли" className={CARD}>
      <CardHead title="Откуда пришли" hint="Как открыли магазин в первый раз за период" />
      {data.sources.length === 0 && <Empty>Заходов за период пока нет</Empty>}
      {data.sources.map((s) => (
        <HBar
          key={s.key}
          label={s.label}
          value={num(s.visitors)}
          right={`${num(s.buyers)} зак.`}
          share={(s.visitors / max) * 100}
        />
      ))}
      <span className="text-xs leading-4 break-words text-hint">
        Справа — сколько из них заказали. Своя метка для поста или рекламы: t.me/
        {bot ?? "<бот>"}?startapp=src_instagram — появится здесь строкой «instagram».
      </span>
    </section>
  );
}

function Operations({ data }: { data: Analytics }) {
  const o = data.operations;
  const minutes = (m: number | null) =>
    m === null ? "—" : m >= 120 ? `${Math.round(m / 6) / 10} ч` : `${m} мин`;
  const share = data.kpi.orders.value ? Math.round((o.cancelled / data.kpi.orders.value) * 100) : 0;
  return (
    <section aria-label="Работа и качество" className={CARD}>
      <CardHead title="Работа и качество" />
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Принимают за" value={minutes(o.acceptMinutes)} />
        <Stat label="Привозят за" value={minutes(o.deliverMinutes)} />
        <Stat
          label="Оценка"
          value={o.rating === null ? "—" : `★ ${String(o.rating).replace(".", ",")}`}
          note={`${num(o.reviews)} ${plural(o.reviews, "отзыв", "отзыва", "отзывов")}`}
        />
      </div>
      <div className="flex flex-col border-t border-line">
        <div className="flex justify-between gap-3 py-2.5 font-semibold">
          <span>Отменено</span>
          <span>
            {num(o.cancelled)}
            {o.cancelled > 0 && ` · ${share}%`}
          </span>
        </div>
        {o.cancelReasons.map((r) => (
          <div key={r.reason} className="flex justify-between gap-3 py-1 pl-3 text-hint">
            <span>{r.label}</span>
            <span>{num(r.count)}</span>
          </div>
        ))}
      </div>
      <span className="text-xs leading-4 text-hint">
        Среднее от оформления до «Готовим» и до «Доставлен».
      </span>
    </section>
  );
}

function BotCard({ data, period }: { data: Analytics; period: AnalyticsPeriod }) {
  const b = data.bot;
  const span = period === "today" ? "сегодня" : period === "7d" ? "за 7 дней" : "за 30 дней";
  const share = b.users > 0 ? Math.round((b.blocked / b.users) * 1000) / 10 : 0;
  return (
    <section aria-label="Бот" className={CARD}>
      <CardHead title="Бот" />
      <div className="grid grid-cols-2 gap-3">
        <Stat
          label="Пользователей всего"
          value={num(b.users)}
          note={`+${num(b.usersNew)} ${span}`}
        />
        <Stat
          label="Заблокировали бота"
          value={`${num(b.blocked)}${b.users > 0 ? ` · ${pctText(share)}` : ""}`}
          note={`+${num(b.blockedNew)} ${span}`}
        />
      </div>
      <span className="text-xs leading-4 text-hint">
        Заблокировавшим бот больше ничего не отправляет. Разблокировали — снова получают статусы
        заказов.
      </span>
    </section>
  );
}

function Stat({ label, value, note }: { label: ReactNode; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="flex items-center gap-1.5 text-[13px] text-hint">{label}</span>
      <span className="text-[22px] leading-7 font-bold whitespace-nowrap">{value}</span>
      {note && <span className="text-xs text-hint">{note}</span>}
    </div>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 py-2.5 ${last ? "" : "border-b border-line"}`}>
      <span>{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}
