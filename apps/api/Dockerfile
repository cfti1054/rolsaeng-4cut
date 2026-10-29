# syntax=docker/dockerfile:1
#
# API 서버(NestJS) 이미지. 빌드 컨텍스트는 저장소 루트다.
#   docker build -f apps/api/Dockerfile -t gcd-api .
# Railway: 서비스 변수 RAILWAY_DOCKERFILE_PATH=apps/api/Dockerfile (루트 디렉터리는 비워 둠)
#
# 이미지에 개발 의존성을 남기는 이유: 시작할 때 쓰는 prisma(마이그레이션)와 tsx(게임 시드 실행)가
# devDependencies이기 때문이다. 이미지를 줄이려면 prisma·tsx를 dependencies로 옮긴 뒤 --prod로 설치한다.

FROM node:22-bookworm-slim

# Prisma 엔진이 OpenSSL을 쓴다
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# 루트 package.json의 packageManager와 같은 버전
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# 1) 의존성: 매니페스트만 먼저 복사해 소스가 바뀌어도 설치 레이어를 재사용한다
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
# NODE_ENV=production을 이 단계 뒤에 설정한다(앞에 두면 빌드에 필요한 devDependencies가 빠진다)
RUN pnpm install --frozen-lockfile --prod=false --filter "api..."

# 2) 소스 복사 → Prisma 클라이언트 생성 → shared, core, api 순서로 빌드
COPY packages ./packages
COPY apps/api ./apps/api
# generate는 DB에 접속하지 않지만 schema가 DATABASE_URL을 요구하므로 빌드용 가짜 값을 준다
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build pnpm --filter api prisma:generate
RUN pnpm --filter "api..." build

ENV NODE_ENV=production \
    CHECKPOINT_DISABLE=1

WORKDIR /app/apps/api
USER node

# 시작 순서: 마이그레이션 적용 → 게임 기본 데이터(upsert라 반복 실행해도 안전) → 서버
# 포트는 Railway가 주입하는 PORT를 API가 읽는다(API_PORT가 있으면 그 값 우선).
# 필수 환경 변수(DATABASE_URL, JWT_ACCESS_SECRET, COOKIE_SECRET)가 없으면 서버가 시작하지 않는다.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/tsx --conditions=source prisma/seed.ts && node dist/main.js"]
