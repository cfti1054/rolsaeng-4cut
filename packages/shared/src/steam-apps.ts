import { z } from 'zod';

// =============================================================================
// GET /steam-apps?q= — 스팀 내전 게임 선택(D98)과 플레이타임 랭킹 게임 선택(S5 10절).
// 작성 폼·수정 창의 「스팀 게임 선택」, /rankings 플레이타임 탭 게임 select가 쓴다.
//
// 「보유자」(S5 D234) = 플레이타임 랭킹(계약 7-2)과 같은 조건의 steam_playtime 행:
//   대표(is_primary)·확인된(verified) 스팀 계정, minutes_total > 0, 순위 대상 회원(rankableUserSql, 탈퇴 제외).
//   부계정·미확인 계정·0분·탈퇴 회원의 행은 세지 않는다.
// - q 없음: 보유자 수 많은 순(같으면 app_id ASC — 랭킹 미리 갱신 대상과 같은 순서) 최대 STEAM_APP_SEARCH_LIMIT개.
//   모든 항목 owner_count ≥ 1 → 어느 항목을 골라도 순위가 비지 않는다(캐시 주기 차이는 계약 7절)
// - q 있음: 이름이 q를 포함하는 보유 게임 먼저, 이어서 스팀 상점 검색 결과(중복 제외), 합쳐 최대 STEAM_APP_SEARCH_LIMIT개.
//   상점 결과의 owner_count도 같은 보유자 조건(0일 수 있다)
// - name: 보유자 행 app_name 중 null 아닌 값, 가장 최근 synced_at 우선(랭킹 app.name과 같은 규칙). 이름이 없는 app은 목록에 없다
// 상점 검색이 실패해도 200이고 store_unavailable=true(멤버 보유 결과만)
// =============================================================================

export const STEAM_APP_SEARCH_LIMIT = 20;
export const STEAM_APP_QUERY_MAX_LENGTH = 50;

export const SteamAppId = z.number().int().min(1).max(2_147_483_647);
export type SteamAppId = z.infer<typeof SteamAppId>;

/** 내전에 저장된 스팀 게임. name은 고른 시점의 이름(서버가 정한 값) */
export const SteamAppRef = z.object({
  app_id: SteamAppId,
  name: z.string().min(1),
});
export type SteamAppRef = z.infer<typeof SteamAppRef>;

export const SearchSteamAppsQuery = z.object({
  q: z
    .string()
    .transform((v) => v.trim().replace(/\s+/g, ' '))
    .pipe(z.string().max(STEAM_APP_QUERY_MAX_LENGTH))
    .default(''),
});
export type SearchSteamAppsQuery = z.infer<typeof SearchSteamAppsQuery>;

export const SteamAppOption = SteamAppRef.extend({
  /** 이 게임의 보유자 수(머리 주석 「보유자」, 플레이타임 랭킹 순위 인원과 같은 조건). q 없음이면 1 이상, 상점 결과는 0일 수 있다 */
  owner_count: z.number().int().min(0),
});
export type SteamAppOption = z.infer<typeof SteamAppOption>;

export const SearchSteamAppsResponse = z.object({
  items: z.array(SteamAppOption).max(STEAM_APP_SEARCH_LIMIT),
  /** q가 있었는데 스팀 상점 검색이 실패했으면 true(결과는 멤버 보유 게임만) */
  store_unavailable: z.boolean(),
});
export type SearchSteamAppsResponse = z.infer<typeof SearchSteamAppsResponse>;

/**
 * 플레이타임 랭킹 화면의 기본 게임(S5 10절, D234): GET /steam-apps(q 없음) items 순서에서 owner_count ≥ 1인 첫 app_id.
 * 없으면 null(화면은 select 비활성 + 「스팀 계정을 연동한 멤버가 아직 없어요」).
 */
export function pickDefaultPlaytimeAppId(items: readonly Pick<SteamAppOption, 'app_id' | 'owner_count'>[]): SteamAppId | null {
  return items.find((i) => i.owner_count >= 1)?.app_id ?? null;
}

/** 스팀 CDN 헤더 이미지(460×215). 키·API 호출 없이 app id로 만든다 */
export function steamAppHeaderImageUrl(appId: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;
}
