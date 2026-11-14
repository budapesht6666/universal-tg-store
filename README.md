# Universal TG Store

Шаблон интернет-магазина в виде Telegram Mini App: меню, корзина, оформление заказа с доставкой курьером, рабочий экран менеджера и курьера, веб-админка.
Меню задаётся типизированным JSON-файлом (см. [docs/catalog-format.md](docs/catalog-format.md)).

> Черновик. Полная инструкция (BotFather, env-переменные, деплой, адаптация шаблона) появится после реализации.

## Быстрый старт

```bash
corepack enable pnpm
pnpm install
pnpm dev
```

## Что уже есть

- **`packages/schema`** — формат меню, заказов и настроек: zod-схемы, типы, `parseCatalog` с понятными ошибками на русском, деньги в минимальных единицах валюты, телефоны, часы работы, статусы заказа и правила отмены, роли команды.
- **`apps/server`** — API, бот с уведомлениями и напоминаниями, база SQLite, фото блюд, вход в админку по ссылке из бота ([подробно](apps/server/README.md)). Нужен `.env` по образцу `.env.example`.
- **`catalog/example.catalog.json`** — демо-меню домашней кухни «Печки» (12 блюд, 6 категорий) и `catalog.schema.json` для подсказок в VS Code.
- **`design/`** — утверждённые макеты; **`docs/product-decisions.md`** — правила работы с заказами и курьерами.

```bash
pnpm typecheck && pnpm lint && pnpm test   # проверки
pnpm schema:gen                            # обновить JSON Schema каталога
```
