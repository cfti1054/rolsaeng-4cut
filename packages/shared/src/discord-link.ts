// =============================================================================
// S5 디스코드 연동 판정. 계약: _workspace/01_architect_contract.md 5절(r2에서 축소)
//
// 로그인이 디스코드 OAuth라 가입·로그인 때 users.discord_id에 snowflake가 들어간다 = 자동 연동(S0 D23).
// 연동 코드 발급·봇 연결(POST /me/discord-link/code, POST /bot/link)과 discord_link_codes 표는 만들지 않는다
// (사용자 결정 2026-10-31, D237). 연동 해제도 없다(discord_id가 로그인 식별자, D204).
//
// 「연동됨」의 정의(D203): users.discord_id가 디스코드 snowflake 형식이다.
// null·개발 전용 로그인 값(`dev-…`)은 미연동이다. 미연동 회원은 봇 이벤트가 저장되지 않는다(unlinked, D213).
// 웹 설정 화면은 GET /me의 discord_id·discord_username으로 상태를 그린다(별도 엔드포인트 없음, D238).
// =============================================================================

/** users.discord_id가 실제 디스코드 snowflake인가(= 연동됨). null·`dev-…`는 false */
export function isLinkedDiscordId(discordId: string | null | undefined): boolean {
  return typeof discordId === 'string' && /^\d{17,20}$/.test(discordId);
}
