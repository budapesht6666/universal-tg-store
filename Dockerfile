# Один образ: сервер (API + бот на вебхуке) и собранные Mini App и админка.
# TypeScript сервера запускается прямо в Node 24 — отдельной сборки сервера нет.

FROM node:24-slim AS build
ENV CI=true
RUN corepack enable
WORKDIR /app

# Сначала только манифесты — слой с зависимостями кешируется между сборками
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/schema/package.json packages/schema/
COPY apps/server/package.json apps/server/
COPY apps/shop/package.json apps/shop/
COPY apps/admin/package.json apps/admin/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @store/shop build && pnpm --filter @store/admin build
# Убираем dev-зависимости (vite, drizzle-kit, vitest…) — в рантайме они не нужны
RUN pnpm install --frozen-lockfile --prod

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
# База и фото — в томе /app/data (DATABASE_PATH и UPLOADS_DIR по умолчанию)
VOLUME /app/data
EXPOSE 3000
CMD ["node", "apps/server/src/main.ts"]
