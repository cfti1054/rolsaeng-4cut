import {
  SettingsPageQuery,
  type GameAccountSyncInfo,
  type GameAccountView,
  type GetMyGameAccountsResponse,
  type RankValue,
  type RiotLinkVerificationView,
  type SteamLinkErrorCode,
} from '@gcd/shared';

/**
 * 게임 계정 화면 로직(순수 함수, 단위 테스트 대상). 계약 S1 4·5·6·12절.
 */

/** 라이엇 ID 하나 = lol·tft 두 행 → 카드 1장 */
export interface RiotAccountGroup {
  /** 카드 키·액션 대상. lol 행 id(없으면 tft 행 id). 해제·대표 지정·갱신은 어느 행 id든 같은 라이엇 ID 전체에 적용된다 */
  id: string;
  display_name: string;
  is_primary: boolean;
  verified_at: string;
  sync: GameAccountSyncInfo;
  lolRank: RankValue | null;
  tftRank: RankValue | null;
}

/**
 * provider=riot 행을 display_name으로 묶는다(계약 4절: 웹은 provider + display_name으로 묶음).
 * 입력 정렬(대표 → 부계정 verified_at 순)을 유지한다. 대표 플래그는 둘 중 하나라도 true면 true.
 */
export function groupRiotAccounts(accounts: readonly GameAccountView[]): RiotAccountGroup[] {
  const groups = new Map<string, RiotAccountGroup>();
  for (const a of accounts) {
    if (a.provider !== 'riot') continue;
    let g = groups.get(a.display_name);
    if (!g) {
      g = {
        id: a.id,
        display_name: a.display_name,
        is_primary: a.is_primary,
        verified_at: a.verified_at,
        sync: a.sync,
        lolRank: null,
        tftRank: null,
      };
      groups.set(a.display_name, g);
    }
    if (a.game === 'lol') {
      g.id = a.id;
      g.lolRank = a.rank;
      g.sync = a.sync;
    } else if (a.game === 'tft') {
      g.tftRank = a.rank;
    }
    g.is_primary ||= a.is_primary;
  }
  return [...groups.values()];
}

export function steamAccount(accounts: readonly GameAccountView[]): GameAccountView | null {
  return accounts.find((a) => a.provider === 'steam') ?? null;
}

/** 연동할 수 있는 라이엇 ID 최대 개수 = 서버 설정값(limits.riot_accounts_max, D61). 화면은 이 함수로만 읽는다 */
export function riotAccountsMax(data: Pick<GetMyGameAccountsResponse, 'limits'>): number {
  return data.limits.riot_accounts_max;
}

export type RiotAddState =
  /** 「라이엇 ID 연동」(하나도 없음) */
  | 'first'
  /** 「+ 부계정 추가」 */
  | 'more'
  /** 진행 중인 소유 확인이 있음 → 확인 카드가 대신 보인다 */
  | 'verifying'
  /** 최대 개수 도달 → 버튼 비활성 */
  | 'full';

/** 부계정 추가 버튼 상태(D58: 라이엇 ID 수 < 최대이고 진행 중 확인이 없을 때만) */
export function riotAddState(
  data: Pick<GetMyGameAccountsResponse, 'accounts' | 'riot_verification' | 'limits'>,
  max: number = riotAccountsMax(data),
): RiotAddState {
  if (data.riot_verification) return 'verifying';
  const n = groupRiotAccounts(data.accounts).length;
  if (n >= max) return 'full';
  return n === 0 ? 'first' : 'more';
}

/** 소유 확인 남은 초(올림). 지났으면 0 */
export function verificationRemainingSec(v: Pick<RiotLinkVerificationView, 'expires_at'>, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(v.expires_at) - now) / 1000));
}

/** 서버가 expired로 내려줬거나 화면 카운트다운이 0이 되면 「다시 시작」 상태 */
export function isVerificationExpired(v: Pick<RiotLinkVerificationView, 'expires_at' | 'status'>, now: number): boolean {
  return v.status !== 'pending' || verificationRemainingSec(v, now) === 0;
}

/**
 * 대표 지정 낙관적 갱신: 대상 행과 같은 라이엇 ID(display_name)의 lol·tft를 true, 다른 라이엇 행은 false.
 * 스팀 행은 손대지 않는다(항상 true). 정렬도 서버 규칙(대표 → 부계정 verified_at 순 → 스팀)으로 다시 맞춘다.
 * 대상이 없거나 스팀이면 입력을 그대로 돌려준다.
 */
export function applyPrimary<T extends { accounts: GameAccountView[] }>(data: T, accountId: string): T {
  const target = data.accounts.find((a) => a.id === accountId);
  if (!target || target.provider !== 'riot') return data;
  const accounts = data.accounts.map((a) =>
    a.provider === 'riot' ? { ...a, is_primary: a.display_name === target.display_name } : a,
  );
  return { ...data, accounts: sortAccounts(accounts) };
}

/** 계약 4절 정렬: 대표 라이엇(lol, tft) → 부계정(verified_at 오름차순, 같으면 id, 각 lol, tft) → 스팀 */
export function sortAccounts(accounts: readonly GameAccountView[]): GameAccountView[] {
  const rank = (a: GameAccountView) => (a.provider === 'steam' ? 2 : a.is_primary ? 0 : 1);
  const gameOrder = (a: GameAccountView) => (a.game === 'lol' ? 0 : 1);
  return [...accounts].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r) return r;
    if (a.display_name !== b.display_name) {
      const t = Date.parse(a.verified_at) - Date.parse(b.verified_at);
      if (t) return t;
      return a.display_name < b.display_name ? -1 : 1;
    }
    return gameOrder(a) - gameOrder(b);
  });
}

/** 해제 낙관 갱신에 쓰지는 않지만 확인 대화상자 문구에 필요: 이 그룹이 대표이고 다른 라이엇 ID가 남는가 */
export function unlinkPromotes(groups: readonly RiotAccountGroup[], id: string): RiotAccountGroup | null {
  const g = groups.find((x) => x.id === id);
  if (!g?.is_primary) return null;
  const rest = groups.filter((x) => x.id !== id);
  if (rest.length === 0) return null;
  return [...rest].sort((a, b) => Date.parse(a.verified_at) - Date.parse(b.verified_at))[0] ?? null;
}

// -----------------------------------------------------------------------------
// 폴링(계약 6-1): sync.state ≠ idle인 계정이 있으면 2초 간격, 최대 60초
// -----------------------------------------------------------------------------

export const SYNC_POLL_INTERVAL_MS = 2_000;
export const SYNC_POLL_MAX_MS = 60_000;

export function hasPendingSync(accounts: readonly GameAccountView[] | undefined): boolean {
  return !!accounts?.some((a) => a.sync.state !== 'idle');
}

/**
 * 다음 폴링 간격. pendingSince = 진행 중 상태를 처음 본 시각(없으면 null).
 * 반환: [간격(ms) | false, 다음 pendingSince]
 */
export function nextPollInterval(
  accounts: readonly GameAccountView[] | undefined,
  pendingSince: number | null,
  now: number,
): [number | false, number | null] {
  if (!hasPendingSync(accounts)) return [false, null];
  const since = pendingSince ?? now;
  return [now - since < SYNC_POLL_MAX_MS ? SYNC_POLL_INTERVAL_MS : false, since];
}

// -----------------------------------------------------------------------------
// 스팀 콜백 결과 쿼리(/settings?steam=linked | ?steam_error=CODE)
// -----------------------------------------------------------------------------

export type SteamCallbackResult = { kind: 'linked' } | { kind: 'error'; code: SteamLinkErrorCode } | null;

/**
 * 계약: 알 수 없는 값은 무시(파싱 실패 시 빈 쿼리 취급). 둘 다 있으면 오류를 우선한다.
 */
export function parseSteamCallbackQuery(search: string | URLSearchParams): SteamCallbackResult {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const raw: Record<string, string> = {};
  for (const key of ['steam', 'steam_error'] as const) {
    const v = params.get(key);
    if (v !== null) raw[key] = v;
  }
  const parsed = SettingsPageQuery.safeParse(raw);
  if (!parsed.success) return null;
  if (parsed.data.steam_error) return { kind: 'error', code: parsed.data.steam_error };
  if (parsed.data.steam === 'linked') return { kind: 'linked' };
  return null;
}

/** 쿼리에 스팀 결과 키가 있는가(값이 잘못돼도 지워야 하므로 파싱과 별개) */
export function hasSteamCallbackKeys(search: string): boolean {
  const p = new URLSearchParams(search);
  return p.has('steam') || p.has('steam_error');
}
