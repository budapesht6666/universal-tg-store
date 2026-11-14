/**
 * Вход на компьютере: ссылка из /login в боте ведёт сюда, токен — после «#».
 * Отправляем его на сервер, получаем cookie сессии на 30 дней.
 */
import { KeyRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api.ts";

export function LoginScreen() {
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = location.hash.slice(1);
    history.replaceState(null, "", location.pathname); // токен одноразовый — убираем из адреса
    if (!token) {
      setError("Ссылка без ключа. Напишите боту /login — пришлём новую");
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

/** Экран «войдите»: в браузере без сессии. */
export function LoginHint({ error, pending }: { error?: string | undefined; pending?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
        <KeyRound size={26} />
      </span>
      <h1 className="m-0 text-xl font-bold">{pending ? "Входим…" : "Вход в админку"}</h1>
      {!pending && (
        <p className="m-0 max-w-[340px] text-hint">
          {error ? `${error}. ` : ""}Напишите боту <b className="text-ink">/login</b> — пришлём
          ссылку для входа на 5 минут.
        </p>
      )}
    </div>
  );
}
