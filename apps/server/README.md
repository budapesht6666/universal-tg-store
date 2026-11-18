# @store/server

Один процесс: API, бот (grammY), SQLite (Drizzle + better-sqlite3), фото блюд и статика Mini App (`/`) и админки (`/admin`).
TypeScript запускается прямо в Node 24, без сборки.

```bash
pnpm --filter @store/server dev          # node --watch, переменные из ../../.env
pnpm --filter @store/server test
pnpm --filter @store/server db:generate  # после правки src/db/schema.ts → новая миграция в drizzle/
```

Переменные — `.env.example` в корне. Локально бот работает через polling, на сервере (`NODE_ENV=production`) — через вебхук `PUBLIC_URL/bot/webhook`. Миграции применяются при запуске. Номера заказов начинаются с 1001.

## Как устроено

| Где                     | Что                                                                             |
| ----------------------- | ------------------------------------------------------------------------------- |
| `src/main.ts`           | запуск: БД → бот → HTTP                                                         |
| `src/app.ts`            | `createApp(deps)` — HTTP без запуска (тесты через `app.request()`)              |
| `src/db/`               | схема и подключение; миграции — `drizzle/`                                      |
| `src/repo/`             | меню, настройки, команда (приглашения, вход на компьютере)                      |
| `src/orders/service.ts` | оформление, отмена, действия менеджера и курьера, напоминания, карточки заказов |
| `src/bot/`              | команды бота, уведомления (`notifier.ts`), тексты, напоминания                  |
| `src/http/`             | вход (initData или cookie) и маршруты                                           |

Сервис заказов не пишет в Telegram сам: он сообщает событие `Notifier` (`src/notify.ts`), а бот решает, кому и что отправить. В тестах вместо бота — запись событий.

## Вход

- **Mini App**: `Authorization: tma <initData>`. Подпись проверяется токеном бота, срок — сутки.
- **Компьютер**: `/login` в боте → `PUBLIC_URL/admin/login#<токен>` (5 минут, один раз). Страница отправляет токен в `POST /api/auth/login` и получает httpOnly-cookie на 30 дней. Токен стоит после `#`, чтобы превью ссылок в Telegram его не «сжигало». Для cookie включена защита от CSRF.
- Роли: `OWNER_TELEGRAM_ID` всегда владелец (после настройки — ещё и курьер, роль курьера можно снять). Остальных приглашают ссылкой.

## API

Ошибки: `{ error: "текст для человека", issues?: [{ path, message }] }`.

**Покупатель**

| Запрос                        | Что                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET /api/shop`               | магазин, часы и «открыт ли сейчас», зона доставки, меню (без скрытых блюд). Без входа                        |
| `GET /api/me`                 | кто я, роли, данные прошлого заказа для автозаполнения                                                       |
| `GET /api/geo/resolve?url=`   | короткая ссылка `maps.app.goo.gl` → `{ point }` (только домены Google)                                       |
| `POST /api/orders`            | оформить (`createOrderInputSchema`). Вне часов работы и на паузе — 409, точка вне зоны доставки — 400        |
| `GET /api/orders`, `/:id`     | мои заказы                                                                                                   |
| `POST /api/orders/:id/cancel` | отменить сам («Оформлен») или попросить отменить                                                             |
| `POST /api/orders/:id/review` | оценка после доставки (`OrderReviewInputSchema`), один раз                                                   |
| `POST /api/events`            | аналитика: события Mini App пачкой до 50 (`AnalyticsBatchSchema`): visit, dish_view, cart_add, checkout_open |
| `POST /api/cart`              | аналитика: снимок корзины (`CartSnapshotSchema`), сумма — по ценам БД; пустая корзина и заказ удаляют снимок |

**Первая настройка** (владелец, один раз): `GET /api/setup`, `POST /api/setup` (`SetupInputSchema`).

**Менеджер и курьер**

| Запрос                                   | Что                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `GET /api/staff/orders?mode=`            | Новые · В работе · Готово (за сутки); `mode=courier` — «Мои доставки»   |
| `POST /api/staff/orders/:id/actions`     | `StaffOrderActionSchema`: accept, assign, pickup, deliver, fail, cancel |
| `POST /api/staff/orders/:id/review-seen` | менеджер открыл заказ с отзывом — снять «новый отзыв»                   |
| `GET /api/staff/couriers`                | кого можно назначить                                                    |
| `POST /api/staff/pause`                  | `{ pause: "30m" \| "1h" \| "today" \| "off" }`                          |

**Админка**: `GET /api/admin/catalog` (меню + `dishLink: { base, mainAppReady } | null` — ссылка на блюдо `base + dish_<id>`; `null`, если бот не подключён; `mainAppReady` — `getMe().has_main_web_app`, раз в минуту, `src/bot/main-app.ts`); категории — `POST /api/admin/categories`, `PATCH|DELETE /api/admin/categories/:id`, `PUT /api/admin/categories/order`, `PUT /api/admin/categories/:id/products/order`; блюда — `POST /api/admin/products`, `PUT|PATCH|DELETE /api/admin/products/:id`; фото — `POST /api/admin/uploads` (multipart, поле `file`, → WebP); настройки — `GET|PUT /api/admin/settings` (регион не меняется); команда — `GET /api/admin/team`, `POST /api/admin/team/invites`, `PATCH /api/admin/team/:userId`; аналитика — `GET /api/admin/analytics?period=today|7d|30d` (владелец и менеджер, `src/repo/analytics.ts`; сотрудники не считаются).

## Бот

- Профиль бота (`src/bot/profile.ts`): имя, «О себе» и описание в пустом чате — из настроек магазина, при запуске и после сохранения настроек (меняется только отличающееся).
- `/start` — приветствие с инструкцией, как заказать, и кнопка «Меню»; у команды ещё «Заказы» и кнопка меню чата «Заказы». Владельцу до настройки — «Настроить магазин».
- `/start inv_<токен>` — приглашение: человек сразу в команде, ссылка гаснет.
- `/login` — ссылка входа на компьютере; в списке команд — только у владельца и менеджеров.
- Уведомления: новый заказ менеджерам со звуком и кнопкой «Принять» (у первого заказа покупателя — «· первый заказ»), напоминание каждые 3 минуты, сообщение обновляется на месте; покупателю, если заказ не приняли за 15 минут, — одно сообщение «ещё не приняли»; курьеру — карточка с «Картой», «Забрал, еду», «Доставлен»; покупателю — каждая смена статуса.
- Переписка: сообщение покупателя уходит менеджерам, ответ свайпом пересылается покупателю.
- Блокировка (`src/bot/blocked.ts`): заблокировавшим бот ничего не отправляет. Отметка `users.bot_blocked_at` ставится по `my_chat_member` (kicked) и по 403 «bot was blocked» при любой отправке (преобразователь Bot API), снимается по `member` и по новому сообщению от человека.
