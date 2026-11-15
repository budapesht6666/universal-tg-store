/**
 * Telegram Mini App: инициализация SDK, тема, кнопка «Назад», вибрация, геопозиция.
 * Вне Telegram (локальная разработка в браузере) окружение подменяется: initData подписывает
 * сервер (/api/dev/init-data, только NODE_ENV=development).
 */
import {
  backButton,
  hapticFeedback,
  init,
  isTMA,
  locationManager,
  miniApp,
  mockTelegramEnv,
  openTelegramLink,
  retrieveLaunchParams,
  retrieveRawInitData,
  swipeBehavior,
  themeParams,
  viewport,
} from "@tma.js/sdk-react";

let rawInitData = "";
/** false — локальная разработка в браузере (окружение Telegram подменено). */
let inTelegram = false;

/** Не падаем, если метод не поддерживается этой версией Telegram. */
function attempt(fn: () => unknown): void {
  try {
    const r = fn();
    if (r instanceof Promise) r.catch(() => {});
  } catch {
    // метод недоступен — ничего страшного
  }
}

async function mockOutsideTelegram(): Promise<void> {
  const res = await fetch("/api/dev/init-data");
  if (!res.ok) throw new Error("Откройте магазин из Telegram");
  const initData = await res.text();
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  mockTelegramEnv({
    launchParams: {
      tgWebAppData: initData,
      tgWebAppVersion: "9.1",
      // Как веб-версия Telegram: в браузере работает геопозиция, кнопка «Я сейчас здесь» видна.
      tgWebAppPlatform: "weba",
      tgWebAppThemeParams: dark
        ? {
            bg_color: "#1c1c1e",
            secondary_bg_color: "#000000",
            text_color: "#ffffff",
            hint_color: "#98989f",
          }
        : {
            bg_color: "#ffffff",
            secondary_bg_color: "#f2f2f7",
            text_color: "#0b0b0c",
            hint_color: "#6b6b73",
          },
    },
  });
}

export async function initTelegram(): Promise<void> {
  inTelegram = await isTMA("complete");
  if (!inTelegram) {
    if (!import.meta.env.DEV) throw new Error("Откройте магазин из Telegram");
    await mockOutsideTelegram();
  }
  init();
  rawInitData = retrieveRawInitData() ?? "";

  attempt(() => {
    miniApp.mount();
    themeParams.bindCssVars();
    miniApp.bindCssVars();
  });
  const applyScheme = () => {
    document.documentElement.dataset.theme = miniApp.isDark() ? "dark" : "light";
  };
  attempt(() => {
    applyScheme();
    miniApp.isDark.sub(applyScheme);
  });
  attempt(() => miniApp.setHeaderColor("bg_color"));
  attempt(() => miniApp.setBgColor("secondary_bg_color"));
  attempt(() => miniApp.setBottomBarColor("secondary_bg_color"));
  attempt(async () => {
    await viewport.mount();
    viewport.bindCssVars();
    viewport.expand();
  });
  // Карту двигают пальцем: вертикальный свайп не должен закрывать приложение.
  attempt(() => {
    swipeBehavior.mount();
    swipeBehavior.disableVertical();
  });
  attempt(() => backButton.mount());
  attempt(() => miniApp.ready());
}

export function authHeader(): Record<string, string> {
  return rawInitData ? { authorization: `tma ${rawInitData}` } : {};
}

export function setBackButton(visible: boolean, onClick: () => void): () => void {
  let off = () => {};
  attempt(() => {
    if (visible) {
      backButton.show();
      off = backButton.onClick(onClick);
    } else {
      backButton.hide();
    }
  });
  return () => off();
}

export const haptic = {
  tap: () => attempt(() => hapticFeedback.impactOccurred("light")),
  success: () => attempt(() => hapticFeedback.notificationOccurred("success")),
  error: () => attempt(() => hapticFeedback.notificationOccurred("error")),
};

/**
 * Telegram на компьютере геопозицию не отдаёт (Windows, Linux, macOS), да и точка ноутбука
 * по Wi-Fi неточная — там кнопку «Я сейчас здесь» не показываем, остаются карта и ссылка.
 */
const DESKTOP_PLATFORMS = new Set(["tdesktop", "macos", "unigram"]);

export function canLocate(): boolean {
  try {
    return !DESKTOP_PLATFORMS.has(retrieveLaunchParams().tgWebAppPlatform);
  } catch {
    return true;
  }
}

export type GpsResult =
  | { ok: true; lat: number; lng: number; accuracy: number | undefined }
  | { ok: false; reason: "unsupported" | "denied" | "unavailable" };

/** «Я сейчас здесь»: геопозиция через Telegram (Bot API 8.0), с погрешностью. */
export async function requestGps(): Promise<GpsResult> {
  try {
    if (!locationManager.isSupported()) return browserGps();
    if (!locationManager.isMounted()) await locationManager.mount();
    if (!locationManager.isAvailable()) return { ok: false, reason: "unavailable" };
    const loc = await locationManager.requestLocation({ timeout: 30_000 });
    if (!loc) {
      return { ok: false, reason: locationManager.isAccessGranted() ? "unavailable" : "denied" };
    }
    return {
      ok: true,
      lat: loc.latitude,
      lng: loc.longitude,
      accuracy: loc.horizontal_accuracy ?? undefined,
    };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export function openLocationSettings(): void {
  attempt(() => locationManager.openSettings());
}

/** Старые версии Telegram и браузер при разработке — обычный Geolocation API. */
function browserGps(): Promise<GpsResult> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ ok: false, reason: "unsupported" });
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          ok: true,
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      (e) =>
        resolve({ ok: false, reason: e.code === e.PERMISSION_DENIED ? "denied" : "unavailable" }),
      { enableHighAccuracy: true, timeout: 20_000 },
    );
  });
}

export function closeApp(): void {
  attempt(() => miniApp.close());
}

/** Чат по ссылке t.me (менеджер магазина): Telegram открывает переписку, Mini App закрывается. */
export function openTelegramChat(url: string): void {
  if (inTelegram) {
    try {
      openTelegramLink(url);
      return;
    } catch {
      // ниже — запасной путь
    }
  }
  window.open(url, "_blank", "noopener");
}

/**
 * Копирует текст (номер телефона). Ссылки `tel:` внутри Mini App Telegram не открывает —
 * ни <a href>, ни openLink, — поэтому номер копируем, а позвонить можно из любого приложения.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // старый WebView — через скрытое поле
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.append(el);
    el.select();
    const ok = document.execCommand("copy");
    el.remove();
    return ok;
  } catch {
    return false;
  }
}
