/** 다시 시도해도 같은 결과인 디스코드 오류. 50007 DM 거부, 10013 없는 사용자, 50001 권한 없음. */
const PERMANENT_DISCORD_CODES = new Set([50007, 10013, 50001]);

export function discordErrorCode(err: unknown): number | null {
  if (typeof err !== 'object' || err === null || !('code' in err)) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'number' ? code : null;
}

export function isPermanentDiscordCode(code: number | null): boolean {
  return code !== null && PERMANENT_DISCORD_CODES.has(code);
}
