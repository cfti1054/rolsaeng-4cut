import { z } from 'zod';

// =============================================================================
// GET /steam-apps?q= — 스팀 내전 게임 선택(D98). 작성 폼·수정 창의 「스팀 게임 선택」이 쓴다.
// - q 없음: 멤버들이 가진 게임(steam_playtime, 연동 계정 수 많은 순) 최대 STEAM_APP_SEARCH_LIMIT개
// - q 있음: 이름이 q를 포함하는 멤버 보유 게임 먼저, 이어서 스팀 상점 검색 결과(중복 제외), 합쳐 최대 STEAM_APP_SEARCH_LIMIT개
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
  /** 이 게임을 가진 연동 스팀 계정 수(공개 프로필·동기화된 것만). 상점 결과는 0일 수 있다 */
  owner_count: z.number().int().min(0),
});
export type SteamAppOption = z.infer<typeof SteamAppOption>;

export const SearchSteamAppsResponse = z.object({
  items: z.array(SteamAppOption).max(STEAM_APP_SEARCH_LIMIT),
  /** q가 있었는데 스팀 상점 검색이 실패했으면 true(결과는 멤버 보유 게임만) */
  store_unavailable: z.boolean(),
});
export type SearchSteamAppsResponse = z.infer<typeof SearchSteamAppsResponse>;

/** 스팀 CDN 헤더 이미지(460×215). 키·API 호출 없이 app id로 만든다 */
export function steamAppHeaderImageUrl(appId: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`;
}
