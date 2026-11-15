# CLAUDE.md — universal-tg-store

Шаблон интернет-магазина в виде Telegram Mini App. Его берут за основу и дорабатывают под конкретный проект.
Первый проект — доставка еды во Вьетнаме (донги, интерфейс на русском, оплата курьеру). Цель — быстро запустить MVP: лишнего не усложнять, решения принимать по best practices, пользователя спрашивать только о необходимом.
С пользователем общаемся по-русски.

## Стек

pnpm 12 workspaces, TypeScript 7 (strict), Biome 2, Vitest.

- `packages/schema` — **ядро**: zod-схемы формата каталога, FieldDefinition, `parseCatalog`, работа с деньгами, генерация JSON Schema.
- `apps/server` — Hono, grammY (бот), Drizzle + better-sqlite3, sharp (загрузка картинок). Сервер раздаёт статику обоих SPA.
- `apps/shop` — Mini App: React 19, Vite, Tailwind 4, `@tma.js/sdk-react`, TanStack Router/Query, Zustand.
- `apps/admin` — админка (заказы на телефоне, меню/команда/настройки на компьютере): React, Tailwind, TanStack Router/Query.

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
- Меню (формат JSON) — `src/catalog.ts`; настройки магазина (в БД, не в файле меню) — `src/settings.ts`; часы работы и «открыт ли сейчас» — `src/hours.ts`; зона доставки (круги, `inDeliveryZone`) — `src/delivery.ts`.
- Телефона магазина нет намеренно: контакт для покупателей — Telegram менеджера `shop.manager` (`src/telegram.ts`, необязательный). Убранные поля старых настроек из БД (`shop.phone`) отрезает `upgrade` в `apps/server/src/repo/settings.ts` — иначе `strictObject` их отвергнет.
- Статусы заказа, переходы, отмена, форма оформления, роли — `src/order.ts`, `src/team.ts`; правила — `docs/product-decisions.md`.
- Формы админки (категория, блюдо, настройки, порядок) и `slugify` — `src/admin.ts`; пауза приёма заказов — `src/hours.ts`.

## apps/server — как устроено

Подробно — `apps/server/README.md` (структура, API, бот). Главное:

- TS запускается прямо в Node 24 (`node src/main.ts`), импорты с `.ts`. `createApp(deps)` не стартует сервер: тесты гоняют его через `app.request()` с БД в памяти, своими часами и записью уведомлений.
- Сервис заказов (`src/orders/service.ts`) не пишет в Telegram: сообщает событие `Notifier`, бот (`src/bot/notifier.ts`) решает, кому писать. События одного заказа идут по очереди.
- Смена статуса — условный `UPDATE … WHERE status = <ожидаемый>`. better-sqlite3 синхронный и с одним соединением: запросы к `db` внутри `db.transaction(() => …)` идут в той же транзакции.
- После правки `src/db/schema.ts` — `pnpm --filter @store/server db:generate`, миграция применяется при запуске.

## apps/shop — как устроено

Подробно — `apps/shop/README.md`. Локально открывается в обычном браузере: сервер в `NODE_ENV=development` подписывает initData (`/api/dev/init-data`), магазин подменяет окружение Telegram. Типы ответов API берутся из сервера (`@store/server/api` + `hono/client`), запросы — обычным `fetch`.

## apps/admin — как устроено

Подробно — `apps/admin/README.md`. Одно приложение на `/admin` (Vite `base: "/admin/"`, роутер `basepath: "/admin"`): в Telegram — initData, в браузере — cookie после `/login`. Формы — на `useState` + схемы из `@store/schema` (без react-hook-form и shadcn: экранов мало, так быстрее); порядок — стрелками.

## Инварианты (не нарушать)

1. **Деньги** — целые числа в минимальных единицах валюты (у донга дробной части нет: 65 000 ₫ = 65000; у рубля — копейки). Форматирование и ввод — только `formatMoney` / `toMinor` из `@store/schema`. Валюта задаётся при первой настройке и не меняется.
2. **Валидация** — только схемами из `packages/schema`. Сервер и админка используют одни и те же схемы, своих копий не заводим.
3. **Сервер не доверяет клиенту**: при оформлении заказа цены и наличие (стоп-лист) берутся из БД в одной транзакции, часы работы и пауза проверяются на сервере.
4. **Фичи меню** включаются флагами `settings.features`. Новую фичу добавляем вместе с флагом.
5. **Произвольные поля товара** описываются через `attributes` (FieldDefinition), а не новыми колонками.
6. Секреты хранятся только в `.env` (в git лежит `.env.example`).

## Проверенные факты (ноябрь 2026)

- TMA SDK: `@tma.js/*`. Пакеты `@telegram-apps/*` заморожены, их `init-data-node` deprecated, а `@telegram-apps/telegram-ui` заброшен.
- Вход в админку из браузера — Telegram Login через OIDC (`oauth.telegram.org`, PKCE, JWKS); старый iframe-виджет в архиве. В MVP не используем: на компьютере вход по одноразовой ссылке от бота.
- `Intl.supportedValuesOf("timeZone")` в Node отдаёт ICU-имена (`Asia/Saigon`), `Asia/Ho_Chi_Minh` там нет. Часовой пояс проверяем через `new Intl.DateTimeFormat("en", { timeZone })`.
- Telegram `requestContact` отдаёт номер без плюса (`84912345678`) — `normalizePhone` считает номер с кодом страны магазина международным.
- pnpm 11+: скрипты установки разрешаются через `allowBuilds` в `pnpm-workspace.yaml`. `onlyBuiltDependencies` удалён.
- pnpm 12 не ставит версии моложе `minimumReleaseAge` (сутки), но при `pnpm install` может сам дописать свежий пакет в `minimumReleaseAgeExclude`. Такие строки не коммитим: берём версию постарше (`~13.0.3`) и обновляем lockfile через `pnpm up -r <пакет>`.
- Biome 2.2+: чтобы исключить папку, пишем `!**/dir`, без `/**`.
- TS 7: `types` по умолчанию `[]`, поэтому `@types/node` подключаем явно в tsconfig пакета.
- `@tma.js/init-data-node` 2.x: `validate(raw, token, { expiresIn })` синхронный и бросает ошибку, `parse(raw)` отдаёт поля в snake_case (`user.first_name`), `sign()` — для тестов. `@tma.js/init-data` из примеров в документации — deprecated.
- Hono: `serveStatic({ onFound })` вызывается после того, как ответ собран, — заголовки оттуда теряются; ставим их отдельным middleware после `next()`. `csrf()` отклоняет POST без `Content-Type` и без `Origin`, поэтому для запросов с `Authorization` её пропускаем (подделать заголовок чужой сайт не может).
- Кеш статики (`src/app.ts`): HTML — `no-cache`, файлы сборки с хешем — `immutable`. Без этого после обновления браузер и WebView Telegram берут старый `index.html` со ссылками на удалённые файлы — пустая страница.
- Ссылку входа из бота даём с токеном после `#`: превью ссылок в Telegram открывает URL и «сжёг» бы одноразовый токен из query.
- `normalize("NFKD")` раскладывает «й» на «и» + знак: в `slugify` сначала транслит, потом снятие диакритики.
- Карта: `tile.openstreetmap.org` из Вьетнама не открывается, растровые плитки CARTO теперь требуют ключ API. Берём MapLibre GL + OpenFreeMap (`tiles.openfreemap.org/styles/liberty`, без ключа). MapLibre v6 + Vite 8: воркер — `import("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url")` и `setWorkerUrl` (с `?url` в dev Vite вставляет в воркер свой клиент, и он падает). CSS MapLibre ставит контейнеру карты `position: relative` — классы позиционирования вешаем на обёртку.
- `@tma.js/sdk` 3.x: цвет фона — `miniApp.setBgColor`, а не `setBackgroundColor`. `requestContact` типизирован как TaskEither — удобнее `requestContactFp(...)()` и проверка `_tag === "Right"`.
- `requestContact` не тихий: Telegram отправляет контакт пользователя сообщением в чат с ботом сразу, ещё до заказа. Поэтому кнопки «Взять из Telegram» в оформлении нет. Геопозицию Telegram Desktop (Windows, macOS) не отдаёт — «Я сейчас здесь» там скрыта по `tgWebAppPlatform`.
- Ссылки `tel:` внутри Mini App не открываются (ни `<a href>`, ни `openLink` — WebView Telegram не передаёт схему системе). Номер показываем текстом с кнопкой «Скопировать» (`copyText` в `lib/telegram.ts` обоих приложений).
- Mini App: `readTextFromClipboard` работает только у ботов из меню вложений, поэтому ссылку на точку принимаем обычным полем ввода. Геопозиция — LocationManager (Bot API 8.0), отдаёт `horizontal_accuracy`. Короткие ссылки `maps.app.goo.gl` координат не содержат: сервер сам раскрывает перенаправление.
- `<input type="number">` с `step="0.5"` молча блокирует отправку формы, если значение не кратно шагу (радиус 10,7 км, выставленный перетаскиванием на карте), — для свободных чисел `step="any"`.
- Bot API: `setMyProfilePhoto` каждый раз добавляет новое фото в профиль (переиспользовать нельзя) — аватар ставим один раз, а имя и описания синхронизируем из настроек, сверяя с `getMy*` (у `setMyName` жёсткий лимит частоты). «Allow Groups» и Main Mini App — только в BotFather.

## Прод

- https://pechka.p1gog.duckdns.org (админка — `/admin`), бот @pechka_hoian_bot, вебхук.
- Сервер — общий VPS по скиллу `vps-ops` (`ssh vps`, Токио): приложение `pechka` в `/srv/apps/pechka` (`.env` там же, база и фото — `data/`). Выкатка: push в `main`, затем `ssh vps 'vps deploy pechka'`; логи — `vps logs pechka`.
- Локальный сервер с боевым токеном бота не запускается (вебхук занят): для разработки — тестовый бот или `BOT_MODE=off`.

## Документация

`README.md` — быстрый старт и адаптация шаблона. `docs/catalog-format.md` — формат JSON-каталога.
`docs/product-decisions.md` — согласованные правила (статусы, отмена, курьеры, телефон) — сверяться перед правками заказов. `design/` — исходники утверждённых макетов Claude Design.
Перед использованием библиотек сверяться с Context7.
