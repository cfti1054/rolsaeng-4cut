# zod 3.25.76 → 4.6.7 이전 보고서

- 날짜: 2026-10-31
- 사유: GHSA(zod <4.6.6, 제약이 큰 컬렉션을 검증할 때 메모리가 고갈됨). 4.6.6 이상에서 고쳐졌고, 최신 버전인 4.6.7로 올림
- 결과: **이전 완료, 되돌리지 않음.** 다른 의존성 변경(vitest 5, react 19.3.1, override)은 그대로 둠

## 변경 파일

| 파일 | 변경 |
| --- | --- |
| `packages/shared/package.json` | `zod` 3.25.76 → 4.6.7 |
| `apps/api/package.json` | `zod` 3.25.76 → 4.6.7 |
| `apps/web/package.json` | `zod` 3.25.76 → 4.6.7 |
| `pnpm-lock.yaml` | zod 항목만 바뀜(specifier 3곳과 패키지 2곳). integrity가 레지스트리 값 `sha512-g8W2…CGwg==`와 같음 |
| `apps/api/src/config/env.ts` | `errorMap` 1곳과 `required_error` 3곳을 `error` 옵션으로 바꿈 |
| `apps/api/src/integrations/ddragon.ts` | `z.record(값)`을 `z.record(z.string(), 값)`으로, `z.ZodType<T, z.ZodTypeDef, unknown>`을 `z.ZodType<T, unknown>`으로 바꿈 |
| `apps/api/src/integrations/steam/steam-client.ts` | 위와 같음(record 1곳, 제네릭 2곳) |
| `apps/api/src/integrations/riot/riot-client.ts` | 제네릭 1곳 |

packages/shared와 apps/web 소스는 고칠 필요가 없었다(typecheck와 테스트 모두 통과).

## 호환성 변경 점검 결과

| 항목 | 판단 | 조치 |
| --- | --- | --- |
| `z.record` 단일 인자 | 4에서는 컴파일 오류 | 남아 있던 2곳(ddragon, steam)에 `z.string()` 키를 넣음. `game-accounts` mock과 `RankingBaselineRanks`는 이미 인자 2개 |
| `ZodTypeDef` | 4에서 없어짐 | `ZodType<Output, Input>`으로 바꿈 |
| `ZodTypeAny`, `z.ZodIssueCode.custom`, `message:` 옵션, `.strict()` | deprecated지만 동작함 | 그대로 둠(최소 변경) |
| `errorMap` / `required_error` | 4에서 없어짐 | `error`로 바꿈. `required_error`는 `(iss) => iss.input === undefined ? 'X 필수' : undefined`로 옮겨서 "없음일 때만 이 문구, 타입이 틀리면 기본 문구"라는 3의 동작을 그대로 유지함. 직접 실행해 `DATABASE_URL: DATABASE_URL 필수`, `strictBool('yes')` → `true 또는 false`가 나오는 것을 확인 |
| `.uuid()` RFC 엄격 검증 | 영향 없음 | 저장소 안 UUID 리터럴 35개(시드·테스트·mock)가 모두 zod 4 `uuid()`를 통과. 템플릿으로 만드는 픽스처(`…-4000-8000-…`, `44444444-4444-4444-8444-…`)도 v4 모양이고, Prisma는 `@default(uuid())`(v4), 코드는 `randomUUID()`(v4)를 씀. 그래서 `z.guid()`로 바꾸지 않음 |
| `z.coerce` 입력 타입이 `unknown`으로 바뀜 | typecheck 통과 | 없음. 런타임 확인: `limit` 생략 → 20, `""` → 0이 되어 too_small(3과 같음), env의 `preprocess(빈값→undefined) + coerce + default` → 기본값 적용 |
| `.default()` 단락 평가와 `optional` 조합 | `.default().optional()`과 `.optional().default()` 조합이 코드에 없음 | 없음 |
| `.pipe()` (trim → 길이 제한, coerce → SteamAppId) | 동작 같음 | 없음 |
| `discriminatedUnion` | 판별자 값이 틀리거나 없으면 path가 `[판별자]`로 3과 같음(code는 `invalid_union`) | 없음 |
| `.strict()` 모르는 키 | path `[]`, code `unrecognized_keys`로 3과 같음. 문구만 `Unrecognized key: "b"`로 바뀜 | 없음 |
| `refine` / `superRefine` | 사용자 정의 문구와 path가 같음. 관련 테스트 모두 통과 | 없음 |
| `.int()`는 안전 정수만 허용 | Riot·Steam 응답 정수는 범위 안 | 없음 |
| `.url()` | `http://localhost:3000`과 Discord 콜백 URL 통과, 잘못된 값은 거부 | 없음 |
| ZodError → `VALIDATION_FAILED` 변환 (`zod.pipe.ts` `zodIssuesToDetails`, web mock) | `issue.path.join('.')`와 `issue.message`만 쓰고, 둘 다 4에 있음 | 없음 |
| shared CJS + `moduleResolution: node10` | zod 4 타입이 해석됨(typecheck·build 통과). 빌드된 `dist/index.js`를 `require`하면 export 359개가 로드되고 `Uuid` 검증이 정상 | tsconfig 그대로 |

## 검증 결과 (Node 24.22.2)

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm install --no-frozen-lockfile` | 통과 |
| `corepack pnpm -r typecheck` | shared, core, api, web 모두 통과 |
| `vitest run` packages/shared | 6개 파일, 테스트 135개 통과(계약 테스트 `contract.test.ts` 포함) |
| `vitest run` packages/core | 10개 파일, 테스트 418개 통과 |
| `vitest run` apps/web | 27개 파일, 테스트 305개 통과 |
| `vitest run` apps/api | 38개 파일, 테스트 583개 통과. 건너뜀: 파일 8개, 테스트 47개(DB e2e) |
| `corepack pnpm -r build` | 4개 패키지 모두 통과. web 빌드에 webpack 캐시 경고(`Unable to snapshot resolve dependencies`)가 나오지만 빌드는 성공. 캐시 쓰기 단계의 경고라 zod와 관계없음 |
| `corepack pnpm audit` | `No known vulnerabilities found`(zod 항목 없어짐) |

계약 응답 모양: shared 계약 테스트와 api e2e(`serialize()`로 응답 스키마를 검증하고 JSON을 비교)가 모두 통과했다. 응답 JSON 모양은 바뀌지 않았다.

## 남은 위험

1. **zod 기본 오류 문구가 바뀜.** 예: `Required` → `Invalid input: expected string, received undefined`, `Number must be greater than or equal to 1` → `Too small: expected number to be >=1`. 사용자 정의 문구가 없는 검증 실패에서는 API `VALIDATION_FAILED.details[].message`의 문구가 영어로 달라진다. `path`, `code`, 응답 모양은 같고, 기본 문구를 기대하는 테스트는 없었다. web의 `scrim-bits.tsx`가 `details[].message`를 화면에 이어 붙여 보여 주므로, 그 경로에서는 사용자에게 바뀐 영어 문구가 보일 수 있다(3에서도 영어였음).
2. **DB e2e 8개 파일은 실행하지 않음**(Docker/DB 없음). DB 경로에서 zod가 쓰이는 곳은 `scrim-result-json.ts`(placements JSON 파싱)와 랭킹 캐시 `RankingBaselineRanks`(`z.record(Uuid, …)`)인데, 같은 스키마를 fake-prisma 테스트가 거친다. 실제 DB의 기존 데이터는 `gen_random_uuid()`/Prisma `uuid()`로 만든 v4라 엄격해진 uuid 검증에 걸리지 않을 것으로 본다. DB가 있는 환경에서 `*.db.e2e.spec.ts`를 한 번 돌려 확인하기를 권한다.
3. **deprecated API를 남김**: `ZodTypeAny`, `z.ZodIssueCode.custom`, `message:`, `.strict()`, `.uuid()`, `.url()`. 지금은 동작하지만 다음 메이저 버전에서 없어질 수 있다. 나중에 한꺼번에 `z.strictObject`, `z.uuid()`, `error:`, `code: 'custom'`으로 옮기면 된다.
4. **외부 데이터의 UUID가 엄격 검증을 통과하지 못할 수 있음.** 봇이나 외부에서 버전 비트가 0인 UUID를 보내면, 3에서는 통과했지만 이제 400이 된다. 지금 저장소 안의 데이터에는 그런 값이 없다.
