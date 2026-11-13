# CLAUDE.md — universal-tg-store

Шаблон интернет-магазина в виде Telegram Mini App. Его берут за основу и дорабатывают под конкретный проект.
С пользователем общаемся по-русски.

## Стек

pnpm 12 workspaces, TypeScript 7 (strict), Biome 2, Vitest.

- `packages/schema` — **ядро**: zod-схемы формата каталога, FieldDefinition, `parseCatalog`, работа с деньгами, генерация JSON Schema.
- `apps/server` — Hono, grammY (бот), Drizzle + better-sqlite3, sharp (загрузка картинок). Сервер раздаёт статику обоих SPA.
- `apps/shop` — Mini App: React 19, Vite, Tailwind 4, `@tma.js/sdk-react`, TanStack Router/Query, Zustand.
- `apps/admin` — веб-админка: React, shadcn/ui, react-hook-form + zod, TanStack Table.

## Команды

```bash
pnpm install          # корень
pnpm dev              # все приложения параллельно
pnpm typecheck && pnpm lint && pnpm test
pnpm format           # biome check --write
pnpm schema:gen       # catalog/catalog.schema.json из zod-схем (тест сверяет, что она актуальна)
```

## packages/schema — как устроено

- Пакет без сборки: `exports` указывает на `src/index.ts`, импорты внутри — с расширением `.ts` (`allowImportingTsExtensions` + `erasableSyntaxOnly`). Поэтому скрипты запускаются прямо `node file.ts` (Node 24, type stripping): без enum, namespace и parameter properties.
- zod импортируем только из `src/zod.ts`: там включены русская локаль и свои понятные сообщения (`src/errors.ts`). Настройка глобальная.
- Объекты каталога — `z.strictObject`: опечатка в ключе JSON = ошибка. Вложенные объекты настроек с дефолтами внутри — `.prefault({})`, а не `.default({})` (в zod 4 `default` не прогоняет значение через схему).
- Статусы заказа, переходы, отмена, роли — `src/order.ts`, `src/team.ts`; правила — `docs/product-decisions.md`.

## Инварианты (не нарушать)

1. **Деньги** — целые числа в минорных единицах (копейки). Форматирование только через `formatMoney` из `@store/schema`.
2. **Валидация** — только схемами из `packages/schema`. Сервер и админка используют одни и те же схемы, своих копий не заводим.
3. **Сервер не доверяет клиенту**: при оформлении заказа цены и остатки пересчитываются из БД, остатки списываются в одной транзакции.
4. **Фичи каталога** включаются флагами `settings.features`. Новую фичу добавляем вместе с флагом.
5. **Произвольные поля товара** описываются через `attributes` (FieldDefinition), а не новыми колонками.
6. Секреты хранятся только в `.env` (в git лежит `.env.example`).

## Проверенные факты (ноябрь 2026)

- TMA SDK: `@tma.js/*`. Пакеты `@telegram-apps/*` заморожены, их `init-data-node` deprecated, а `@telegram-apps/telegram-ui` заброшен.
- Вход в админку из браузера — Telegram Login через OIDC (`oauth.telegram.org`, PKCE, JWKS). Старый iframe-виджет в архиве.
- pnpm 11+: скрипты установки разрешаются через `allowBuilds` в `pnpm-workspace.yaml`. `onlyBuiltDependencies` удалён.
- Biome 2.2+: чтобы исключить папку, пишем `!**/dir`, без `/**`.
- TS 7: `types` по умолчанию `[]`, поэтому `@types/node` подключаем явно в tsconfig пакета.

## Документация

`README.md` — быстрый старт и адаптация шаблона. `docs/catalog-format.md` — формат JSON-каталога.
`docs/product-decisions.md` — согласованные правила (статусы, отмена, курьеры, телефон) — сверяться перед правками заказов. `design/` — исходники утверждённых макетов Claude Design.
Перед использованием библиотек сверяться с Context7.
