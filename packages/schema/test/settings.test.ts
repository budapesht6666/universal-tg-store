import { describe, expect, it } from "vitest";
import {
  formatPhone,
  normalizePhone,
  phoneSchema,
  SettingsSchema,
  type SetupInput,
  SetupInputSchema,
  settingsFromSetup,
  shopStatus,
  type WeekHours,
  WeekHoursSchema,
} from "../src/index.ts";

const TZ = "Asia/Ho_Chi_Minh"; // UTC+7, без перехода на летнее время
/** Местное время во Вьетнаме → Date. 16.11.2026 — понедельник. */
const vn = (local: string) => new Date(`${local}+07:00`);

const defaults = WeekHoursSchema.parse({});
const hours = (patch: Partial<WeekHours>): WeekHours => ({ ...defaults, ...patch });
const closedWeek: WeekHours = {
  mon: null,
  tue: null,
  wed: null,
  thu: null,
  fri: null,
  sat: null,
  sun: null,
};

describe("телефон", () => {
  it("для показа — группами, хранится без пробелов", () => {
    expect(formatPhone("+84912345678")).toBe("+84 91 234 56 78");
    expect(formatPhone("+84393385504")).toBe("+84 39 338 55 04");
    expect(formatPhone("+79993334455")).toBe("+7 999 333 44 55");
    expect(formatPhone("+79993334455", "7")).toBe("+7 999 333 44 55");
    expect(formatPhone("+442079460958")).toBe("+442079460958");
    expect(formatPhone("не номер")).toBe("не номер");
  });

  it("местные вьетнамские номера получают +84", () => {
    expect(normalizePhone("0912 345 678")).toBe("+84912345678");
    expect(normalizePhone("912345678")).toBe("+84912345678");
    expect(normalizePhone("+84 912 345 678")).toBe("+84912345678");
    expect(normalizePhone("84912345678")).toBe("+84912345678");
  });

  it("российские и другие международные номера не портятся", () => {
    expect(normalizePhone("+7 999 123-45-67")).toBe("+79991234567");
    expect(normalizePhone("8 999 123-45-67")).toBe("+79991234567");
    expect(normalizePhone("0044 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("8 (999) 123-45-67", "7")).toBe("+79991234567");
    expect(normalizePhone("12345")).toBeNull();
  });

  it("схема объясняет, зачем нужен номер", () => {
    expect(phoneSchema().safeParse("").error?.issues[0]?.message).toBe(
      "Без телефона курьер не сможет передать заказ",
    );
    expect(phoneSchema().safeParse("+84 12").error?.issues[0]?.message).toBe(
      "Номер неполный — проверьте цифры",
    );
  });
});

describe("первая настройка", () => {
  it("из страны, названия и Telegram менеджера получаются полные настройки", () => {
    const input: SetupInput = { shop: { name: "Фо на углу", manager: "@Pho_Manager" } };
    const r = settingsFromSetup(SetupInputSchema.parse(input));
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.region).toEqual({
      country: "VN",
      currency: "VND",
      timeZone: "Asia/Ho_Chi_Minh",
      phoneCode: "84",
      locale: "ru-RU",
    });
    expect(r.data.shop.manager).toBe("Pho_Manager");
    expect(r.data.hours.mon).toEqual({ from: "10:00", to: "22:00" });
    expect(r.data.features).toEqual({
      discounts: true,
      badges: true,
      reviews: true,
      dishPage: true,
    });
    expect(r.data.orders.customerCanCancel).toBe(true);
  });

  it("без названия не обойтись, Telegram менеджера — необязательно", () => {
    const r = SetupInputSchema.safeParse({ shop: { name: "", manager: "" } });
    expect(r.error?.issues.map((i) => i.message)).toEqual(["Как называется магазин?"]);
    const ok = SetupInputSchema.parse({ shop: { name: "М", manager: "  " } });
    expect(ok.shop.manager).toBeUndefined();
  });

  it("телефона магазина в настройках нет", () => {
    const r = SetupInputSchema.safeParse({ shop: { name: "М", phone: "0912345678" } });
    expect(r.success).toBe(false);
  });

  it("неизвестный часовой пояс — ошибка", () => {
    const r = SettingsSchema.safeParse({
      region: { timeZone: "Mars/Olympus" },
      shop: { name: "М" },
    });
    expect(r.error?.issues[0]?.message).toMatch(/часовой пояс/);
  });
});

describe("часы работы", () => {
  it("открыто днём, закрыто до открытия и после закрытия", () => {
    expect(shopStatus(defaults, TZ, vn("2026-11-16T12:00"))).toEqual({
      open: true,
      closesAt: "22:00",
    });
    expect(shopStatus(defaults, TZ, vn("2026-11-16T09:00"))).toEqual({
      open: false,
      reason: "hours",
      opensAt: "сегодня в 10:00",
    });
    expect(shopStatus(defaults, TZ, vn("2026-11-16T23:30"))).toMatchObject({
      opensAt: "завтра в 10:00",
    });
  });

  it("выходной день пропускается", () => {
    expect(shopStatus(hours({ mon: null }), TZ, vn("2026-11-15T23:00"))).toMatchObject({
      open: false,
      opensAt: "во вт в 10:00",
    });
  });

  it("ночная смена через полночь и через конец недели", () => {
    const night = { ...closedWeek, sat: { from: "18:00", to: "02:00" } };
    expect(shopStatus(night, TZ, vn("2026-11-15T01:00"))).toEqual({
      open: true,
      closesAt: "02:00",
    });
    const sunday = { ...closedWeek, sun: { from: "20:00", to: "03:00" } };
    expect(shopStatus(sunday, TZ, vn("2026-11-16T01:00"))).toEqual({
      open: true,
      closesAt: "03:00",
    });
  });

  it("ручная пауза приёма заказов", () => {
    const now = vn("2026-11-16T12:00");
    expect(shopStatus(defaults, TZ, now, vn("2026-11-16T13:00"))).toEqual({
      open: false,
      reason: "paused",
      opensAt: "сегодня в 13:00",
    });
    expect(shopStatus(defaults, TZ, now, vn("2026-11-16T23:00"))).toMatchObject({
      opensAt: "завтра в 10:00",
    });
    expect(shopStatus(defaults, TZ, now, vn("2026-11-16T11:00"))).toMatchObject({ open: true });
  });

  it("пустое расписание — неизвестно, когда откроемся", () => {
    expect(shopStatus(closedWeek, TZ, vn("2026-11-16T12:00"))).toEqual({
      open: false,
      reason: "hours",
      opensAt: null,
    });
  });
});
