/**
 * Где открыта админка:
 * - в Telegram (кнопка «Заказы» в боте) — вход по initData, тема и кнопки Telegram;
 * - в браузере на компьютере — вход по cookie после ссылки из /login;
 * - локально в браузере без cookie — подписанный сервером initData (/api/dev/init-data).
 */

import { normalizeTelegramUsername } from "@store/schema";
import {
  backButton,
  hapticFeedback,
  init,
  isTMA,
  miniApp,
  mockTelegramEnv,
  openLink,
  openTelegramLink,
  retrieveRawInitData,
  themeParams,
  viewport,
} from "@tma.js/sdk-react";

let rawInitData = "";
let inTelegram = false;

function attempt(fn: () => unknown): void {
  try {
    const r = fn();
    if (r instanceof Promise) r.catch(() => {});
  } catch {
    // метод недоступен в этой версии Telegram
  }
}

/**
 * В браузере (компьютер) админка всегда светлая, как в макетах. По prefers-color-scheme
 * тёмными становились только наши токены (--line, --accent), а фон и текст из запасных
 * значений tg-theme оставались светлыми — границы полей пропадали.
 */
function applyBrowserTheme() {
  document.documentElement.dataset.theme = "light";
}

async function hasBrowserSession(): Promise<boolean> {
  const res = await fetch("/api/me", { credentials: "same-origin" }).catch(() => null);
  return res?.ok ?? false;
}

export async function initTelegram(): Promise<void> {
  inTelegram = await isTMA("complete");
  const onLoginPage = location.pathname.endsWith("/login");
  if (!inTelegram && import.meta.env.DEV && !onLoginPage && !(await hasBrowserSession())) {
    const res = await fetch("/api/dev/init-data");
    if (res.ok) {
      mockTelegramEnv({
        launchParams: {
          tgWebAppData: await res.text(),
          tgWebAppVersion: "9.1",
          tgWebAppPlatform: "tdesktop",
          tgWebAppThemeParams: {},
        },
      });
      inTelegram = true;
    }
  }
  if (!inTelegram) {
    applyBrowserTheme();
    return;
  }
  init();
  rawInitData = retrieveRawInitData() ?? "";
  attempt(() => {
    miniApp.mount();
    themeParams.bindCssVars();
  });
  const scheme = () => {
    document.documentElement.dataset.theme = miniApp.isDark() ? "dark" : "light";
  };
  attempt(() => {
    scheme();
    miniApp.isDark.sub(scheme);
  });
  attempt(() => miniApp.setHeaderColor("bg_color"));
  attempt(() => miniApp.setBgColor("secondary_bg_color"));
  attempt(async () => {
    await viewport.mount();
    viewport.bindCssVars();
    viewport.expand();
  });
  attempt(() => backButton.mount());
  attempt(() => miniApp.ready());
}

export const isInTelegram = () => inTelegram;

export function authHeader(): Record<string, string> {
  return rawInitData ? { authorization: `tma ${rawInitData}` } : {};
}

export function setBackButton(visible: boolean, onClick: () => void): () => void {
  let off = () => {};
  if (!inTelegram) return off;
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
  warning: () => attempt(() => hapticFeedback.notificationOccurred("warning")),
  error: () => attempt(() => hapticFeedback.notificationOccurred("error")),
};

/** Внешняя ссылка (Google Maps): в Telegram — через openLink, иначе новая вкладка. */
export function openExternal(url: string): void {
  if (inTelegram) {
    try {
      openLink(url);
      return;
    } catch {
      // ниже — запасной путь
    }
  }
  window.open(url, "_blank", "noopener");
}

/** Ссылка t.me (чат с покупателем, «Поделиться»). */
export function openTelegram(url: string): void {
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

/** Короткий сигнал о новом заказе (без файла): два тона через Web Audio. */
export function beep(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const tone = (freq: number, start: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + 0.3);
    };
    tone(880, 0);
    tone(1175, 0.18);
    setTimeout(() => void ctx.close(), 800);
  } catch {
    // звук недоступен — остаётся вибрация
  }
  haptic.warning();
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

/**
 * Поле «Telegram менеджера»: храним имя без @, в поле показываем с @ — как в подсказке
 * и плейсхолдере. Ссылку t.me/… сразу превращаем в имя.
 */
export function atUsername(stored: string | undefined): string {
  return stored ? `@${stored}` : "";
}

export function fromAtInput(input: string): string {
  const raw = input.trim().replace(/^@+/, "");
  return /t(?:elegram)?\.me\//i.test(raw) ? (normalizeTelegramUsername(raw) ?? raw) : raw;
}
