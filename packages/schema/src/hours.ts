/**
 * Часы работы и «открыт ли магазин сейчас». Ночью заказ оформить нельзя: магазин показывает
 * «Откроемся завтра в 10:00», сервер отклоняет заказ. Плюс ручная пауза приёма заказов.
 */
import { z } from "./zod.ts";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Пн",
  tue: "Вт",
  wed: "Ср",
  thu: "Чт",
  fri: "Пт",
  sat: "Сб",
  sun: "Вс",
};

const WEEKDAY_IN = ["в пн", "во вт", "в ср", "в чт", "в пт", "в сб", "в вс"];

const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, {
  error: "Время в формате ЧЧ:ММ, например 09:30",
});

/**
 * Часы одного дня. `null` — выходной. Если `to` раньше `from` — работаем после полуночи
 * (18:00–02:00). Одинаковые `from` и `to` — круглосуточно.
 */
export const DayHoursSchema = z.strictObject({ from: TimeSchema, to: TimeSchema }).nullable();
export type DayHours = z.output<typeof DayHoursSchema>;

const day = () => DayHoursSchema.default({ from: "10:00", to: "22:00" });

export const WeekHoursSchema = z.strictObject({
  mon: day(),
  tue: day(),
  wed: day(),
  thu: day(),
  fri: day(),
  sat: day(),
  sun: day(),
});
export type WeekHours = z.output<typeof WeekHoursSchema>;

const DAY = 24 * 60;
const WEEK = 7 * DAY;

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const fmt = (minute: number) => {
  const m = ((minute % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Минута недели по местному времени магазина: пн 00:00 = 0. */
export function localWeekMinute(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const dayIndex = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
  return dayIndex * DAY + Number(get("hour")) * 60 + Number(get("minute"));
}

/** Интервалы работы в минутах недели; ночные смены заходят за конец дня (и недели). */
function intervals(hours: WeekHours): [number, number][] {
  const result: [number, number][] = [];
  WEEKDAYS.forEach((key, i) => {
    const h = hours[key];
    if (!h) return;
    const from = toMinutes(h.from);
    const to = toMinutes(h.to);
    const start = i * DAY + from;
    const end = to === from ? start + DAY : i * DAY + to + (to < from ? DAY : 0);
    result.push([start, end]);
  });
  return result;
}

/** Интервал, внутри которого минута `t` (в любой неделе), с концом в той же шкале, что `t`. */
function containing(list: [number, number][], t: number): number | null {
  const base = t - (((t % WEEK) + WEEK) % WEEK);
  for (const [start, end] of list) {
    for (const shift of [-WEEK, 0]) {
      if (base + start + shift <= t && t < base + end + shift) return base + end + shift;
    }
  }
  return null;
}

/** Ближайшее открытие не раньше минуты `t`. */
function nextOpening(list: [number, number][], t: number): number | null {
  if (containing(list, t) !== null) return t;
  const base = t - (((t % WEEK) + WEEK) % WEEK);
  let best: number | null = null;
  for (const [start] of list) {
    for (const shift of [0, WEEK]) {
      const c = base + start + shift;
      if (c > t && (best === null || c < best)) best = c;
    }
  }
  return best;
}

function describeOpening(opening: number, now: number): string {
  const days = Math.floor(opening / DAY) - Math.floor(now / DAY);
  const time = fmt(opening);
  if (days === 0) return `сегодня в ${time}`;
  if (days === 1) return `завтра в ${time}`;
  return `${WEEKDAY_IN[Math.floor(opening / DAY) % 7]} в ${time}`;
}

export type ShopStatus =
  | { open: true; closesAt: string }
  | {
      open: false;
      reason: "hours" | "paused";
      /** «завтра в 10:00»; null — расписание пустое, когда откроемся — неизвестно. */
      opensAt: string | null;
    };

/**
 * Открыт ли магазин в момент `now`. `pausedUntil` — ручная пауза приёма заказов
 * из админки («Пауза на час», «До завтра»); пауза в прошлом ничего не значит.
 */
export function shopStatus(
  hours: WeekHours,
  timeZone: string,
  now: Date,
  pausedUntil?: Date | null,
): ShopStatus {
  const list = intervals(hours);
  const t = localWeekMinute(now, timeZone);
  const pausedFor = pausedUntil ? Math.ceil((pausedUntil.getTime() - now.getTime()) / 60_000) : 0;

  if (pausedFor > 0) {
    const opening = nextOpening(list, t + pausedFor);
    return {
      open: false,
      reason: "paused",
      opensAt: opening === null ? null : describeOpening(opening, t),
    };
  }
  const closesAt = containing(list, t);
  if (closesAt !== null) return { open: true, closesAt: fmt(closesAt) };
  const opening = nextOpening(list, t);
  return {
    open: false,
    reason: "hours",
    opensAt: opening === null ? null : describeOpening(opening, t),
  };
}
