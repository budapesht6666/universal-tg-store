# Universal TG Store

Шаблон интернет-магазина в виде Telegram Mini App: каталог, карточка товара, корзина, оформление заказа и веб-админка.
Каталог задаётся типизированным JSON-файлом (см. [docs/catalog-format.md](docs/catalog-format.md)).

> Черновик. Полная инструкция (BotFather, env-переменные, деплой, адаптация шаблона) появится после реализации.

## Быстрый старт

```bash
corepack enable pnpm
pnpm install
pnpm dev
```

## Что уже есть

- **`packages/schema`** — формат каталога, заказов и настроек: zod-схемы, типы, `parseCatalog` с понятными ошибками на русском, деньги в копейках, статусы заказа и правила отмены, роли команды.
- **`catalog/example.catalog.json`** — демо-магазин (15 товаров, 4 категории, характеристики) и `catalog.schema.json` для подсказок в VS Code.
- **`design/`** — утверждённые макеты; **`docs/product-decisions.md`** — правила работы с заказами и курьерами.

```bash
pnpm typecheck && pnpm lint && pnpm test   # проверки
pnpm schema:gen                            # обновить JSON Schema каталога
```
