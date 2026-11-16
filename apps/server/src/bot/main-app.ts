/**
 * Включён ли у бота Main Mini App (BotFather → Bot Settings → Configure Mini App). Без него
 * ссылки t.me/<бот>?startapp=… не открывают магазин — админка показывает предупреждение.
 * Спрашиваем getMe не чаще раза в минуту: после настройки в BotFather предупреждение
 * пропадает само, без перезапуска сервера (botInfo из bot.init() снят один раз при старте).
 */
export function mainAppCheck(
  hasMainWebApp: () => Promise<boolean>,
  now: () => number,
  ttlMs = 60_000,
): () => Promise<boolean> {
  let cached: { value: boolean; at: number } | null = null;
  return async () => {
    if (cached && now() - cached.at < ttlMs) return cached.value;
    try {
      cached = { value: await hasMainWebApp(), at: now() };
    } catch (err) {
      console.error("Бот: getMe не ответил:", String(err));
      // Telegram недоступен — оставляем прошлый ответ, повторим через минуту.
      cached = { value: cached?.value ?? false, at: now() };
    }
    return cached.value;
  };
}
