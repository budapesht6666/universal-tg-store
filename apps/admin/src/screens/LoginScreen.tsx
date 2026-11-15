/**
 * Вход на компьютере: ссылка из /login в боте ведёт сюда, токен — после «#».
 * Отправляем его на сервер, получаем cookie сессии на 30 дней.
 */
import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ShopMark } from "../components/ShopMark.tsx";
import { api } from "../lib/api.ts";
import { useShopInfo } from "../lib/session.ts";

export function LoginScreen() {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = location.hash.slice(1);
    history.replaceState(null, "", location.pathname); // токен одноразовый — убираем из адреса
    if (!token) {
      setError("В ссылке нет ключа");
      return;
    }
    api
      .login(token)
      // Полная перезагрузка: все запросы заново, уже с cookie сессии.
      .then(() => location.replace(`${import.meta.env.BASE_URL}menu`))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Не получилось войти"),
      );
  }, []);

  return <LoginHint error={error ?? undefined} pending={!error} />;
}

/** Экран «войдите»: в браузере без сессии, «Входим…» и ссылка, которая не сработала. */
export function LoginHint({ error, pending }: { error?: string | undefined; pending?: boolean }) {
  const shop = useShopInfo();
  const info = shop.data;
  const name = info?.ready ? info.shop.name : "Магазин";
  const logo = info?.ready ? info.shop.logo : undefined;
  const bot = info?.bot ?? null;
  const expired = !!error && /устарел/i.test(error);

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-6">
      <section
        aria-label="Вход в админку"
        className="flex w-full max-w-[400px] flex-col items-center gap-4 rounded-2xl bg-card px-7 py-8 text-center shadow-[inset_0_0_0_1px_var(--line)]"
      >
        <ShopMark name={name} logo={logo} size={56} />
        {pending ? (
          <>
            <div className="flex flex-col gap-2">
              <h1 className="m-0 text-[22px] leading-7 font-bold">Входим…</h1>
              <p className="m-0 text-hint">Проверяем ссылку из бота.</p>
            </div>
            <span
              aria-hidden="true"
              className="h-7 w-7 animate-spin rounded-full border-[3px] border-accent-soft border-t-accent"
            />
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <h1 className="m-0 text-[22px] leading-7 font-bold">
                {error
                  ? expired
                    ? "Ссылка устарела"
                    : "Не получилось войти"
                  : `Вход в админку «${name}»`}
              </h1>
              <p className="m-0 flex flex-col text-hint">
                {error ? (
                  <>
                    <span>
                      {expired ? "Её уже открывали, или прошло больше 5 минут." : `${error}.`}
                    </span>
                    <span>
                      Напишите боту <b className="text-ink">/login</b> — пришлём новую.
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      Напишите боту <b className="text-ink">/login</b> — пришлём ссылку для входа.
                    </span>
                    <span>Ссылка действует 5 минут и срабатывает один раз.</span>
                  </>
                )}
              </p>
            </div>
            {bot && (
              <a
                href={`https://t.me/${bot}`}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-accent font-semibold text-white no-underline"
              >
                <Send size={16} /> Открыть бота
              </a>
            )}
            {!error && <span className="text-xs text-hint">Войти могут владелец и менеджеры.</span>}
          </>
        )}
      </section>
    </div>
  );
}
