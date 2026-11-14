/** Часы работы по дням: время «с — до» или выходной. Ночная смена (18:00–02:00) тоже можно. */
import { type DayHours, WEEKDAY_LABELS, WEEKDAYS, type WeekHours } from "@store/schema";
import { Toggle } from "./ui.tsx";

export const DEFAULT_DAY: NonNullable<DayHours> = { from: "10:00", to: "22:00" };

export function defaultHours(): WeekHours {
  return Object.fromEntries(WEEKDAYS.map((d) => [d, { ...DEFAULT_DAY }])) as WeekHours;
}

export function HoursEditor({
  value,
  onChange,
}: {
  value: WeekHours;
  onChange: (v: WeekHours) => void;
}) {
  const set = (day: keyof WeekHours, h: DayHours) => onChange({ ...value, [day]: h });
  return (
    <div className="flex flex-col rounded-2xl bg-card">
      {WEEKDAYS.map((day) => {
        const h = value[day];
        return (
          <div
            key={day}
            className="flex h-14 items-center gap-3 border-b border-line px-3.5 last:border-b-0"
          >
            <span className="w-8 font-semibold">{WEEKDAY_LABELS[day]}</span>
            {h ? (
              <div className="flex flex-1 items-center gap-2">
                <input
                  type="time"
                  value={h.from}
                  aria-label={`${WEEKDAY_LABELS[day]}: с`}
                  onChange={(e) => set(day, { ...h, from: e.target.value })}
                  className="h-9 rounded-lg bg-page px-2 outline-none"
                />
                <span className="text-hint">—</span>
                <input
                  type="time"
                  value={h.to}
                  aria-label={`${WEEKDAY_LABELS[day]}: до`}
                  onChange={(e) => set(day, { ...h, to: e.target.value })}
                  className="h-9 rounded-lg bg-page px-2 outline-none"
                />
              </div>
            ) : (
              <span className="flex-1 text-hint">Выходной</span>
            )}
            <Toggle
              checked={!!h}
              label={`${WEEKDAY_LABELS[day]}: работаем`}
              onChange={(on) => set(day, on ? { ...DEFAULT_DAY } : null)}
            />
          </div>
        );
      })}
    </div>
  );
}
