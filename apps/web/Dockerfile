# syntax=docker/dockerfile:1
#
# 웹(Next.js) 이미지. 빌드 컨텍스트는 저장소 루트다.
#   docker build -f apps/web/Dockerfile -t gcd-web --build-arg API_ORIGIN=https://api.example.com .
# Railway: 서비스 변수 RAILWAY_DOCKERFILE_PATH=apps/web/Dockerfile (루트 디렉터리는 비워 둠)
#
# 주의: 아래 ARG 값은 빌드할 때 코드에 박힌다. 값을 바꾸면 이미지를 다시 빌드해야 한다.
#   - NEXT_PUBLIC_*: 브라우저 번들에 들어간다
#   - API_ORIGIN: next.config.ts의 rewrites가 빌드 때 계산되어 라우트 표에 저장된다

FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# 1) 의존성
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile --prod=false --filter "web..."

# 2) 소스 복사 → 빌드. 웹은 @gcd/shared·@gcd/core를 TS 소스로 가져오므로 따로 빌드하지 않는다
COPY packages/shared ./packages/shared
COPY packages/core ./packages/core
COPY apps/web ./apps/web

# 기본값은 로컬용이다. Railway에서는 같은 이름의 서비스 변수로 덮어쓴다
ARG API_ORIGIN=http://localhost:4000
ARG NEXT_PUBLIC_API_MOCK=false
ARG NEXT_PUBLIC_API_MOCK_ACCESS_TTL_SEC=900
ARG NEXT_PUBLIC_AUTH_DEV_LOGIN=false
ENV API_ORIGIN=$API_ORIGIN \
    NEXT_PUBLIC_API_MOCK=$NEXT_PUBLIC_API_MOCK \
    NEXT_PUBLIC_API_MOCK_ACCESS_TTL_SEC=$NEXT_PUBLIC_API_MOCK_ACCESS_TTL_SEC \
    NEXT_PUBLIC_AUTH_DEV_LOGIN=$NEXT_PUBLIC_AUTH_DEV_LOGIN \
    NEXT_TELEMETRY_DISABLED=1

RUN if [ "$API_ORIGIN" = "http://localhost:4000" ]; then \
      echo "경고: API_ORIGIN이 기본값(localhost)입니다. 배포용이면 API 서비스 주소를 빌드 변수로 넘기세요."; \
    fi

WORKDIR /app/apps/web
RUN pnpm build

ENV NODE_ENV=production
# next start가 런타임에 .next/cache에 쓰므로 node 사용자에게 쓰기 권한을 준다
RUN mkdir -p .next/cache && chown -R node:node .next
USER node

# 포트는 Railway가 주입하는 PORT를 next start가 읽는다(없으면 3000)
CMD ["./node_modules/.bin/next", "start"]
