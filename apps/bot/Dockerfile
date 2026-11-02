# syntax=docker/dockerfile:1
#
# 디스코드 봇 이미지. 빌드 컨텍스트는 저장소 루트다.
#   docker build -f apps/bot/Dockerfile -t gcd-bot .
# Railway: 서비스 변수 RAILWAY_DOCKERFILE_PATH=apps/bot/Dockerfile (루트 디렉터리는 비워 둠)
# 공개 도메인은 만들지 않는다. 레플리카는 1.

FROM node:22.23.4-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/bot/package.json apps/bot/
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile --prod=false --filter "@gcd/bot..."

COPY packages/shared ./packages/shared
COPY apps/bot ./apps/bot
RUN pnpm --filter "@gcd/bot..." build

ENV NODE_ENV=production \
    CHECKPOINT_DISABLE=1

WORKDIR /app/apps/bot
USER node

CMD ["node", "dist/index.js"]
