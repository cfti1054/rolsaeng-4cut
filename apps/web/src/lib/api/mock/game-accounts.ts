import {
  ApiPath,
  GameAccountView,
  IsoDateTime,
  LinkGameAccountRequest,
  LolPosition,
  PROFILE_RECENT_MATCHES_LIMIT,
  RECENT_MATCHES_MAX,
  RECENT_MATCHES_TTL_HOURS,
  RIOT_ACCOUNTS_MAX_DEFAULT,
  RIOT_VERIFICATION_CHECK_INTERVAL_SEC,
  RIOT_VERIFICATION_DAILY_START_LIMIT,
  RIOT_VERIFICATION_ICON_IDS,
  RIOT_VERIFICATION_TTL_SEC_DEFAULT,
  RecentLolMatch,
  RiotLinkVerificationView,
  STEAM_ACCOUNTS_MAX,
  SYNC_DAILY_LIMIT_DEFAULT,
  Uuid,
  formatRiotId,
  type ConfirmRiotVerificationResponse,
  type ErrorCode,
  type GetMyGameAccountsResponse,
  type GetUserProfileResponse,
  type LinkGameAccountResponse,
  type MainPosition,
  type Me,
  type ProfileTierCard,
  type RankValue,
  type SetPrimaryGameAccountResponse,
  type SyncGameAccountResponse,
  type SyncQuota,
} from '@gcd/shared';
import { z } from 'zod';

/**
 * [목] S1 게임 계정·프로필 엔드포인트(계약 4–8절). backend.ts가 인증을 끝낸 뒤 이 핸들러를 부른다.
 *
 * 흉내 내는 규칙(실제 서버와 같은 순서로 검사):
 * - 라이엇 ID 게임 이름으로 오류를 고를 수 있다: `notfound` → RIOT_ID_NOT_FOUND, `nosummoner` → RIOT_SUMMONER_NOT_FOUND,
 *   `taken` → GAME_ACCOUNT_ALREADY_LINKED(다른 멤버), `busy` → GAME_PROVIDER_RATE_LIMITED(Retry-After 30).
 *   이미 내 목록에 있는 라이엇 ID(대소문자 무시) → GAME_ACCOUNT_ALREADY_LINKED_TO_ME
 * - 소유 확인: 첫 「확인」은 OWNERSHIP_CHECK_FAILED(아이콘을 아직 안 바꾼 상황), 두 번째부터 성공. 확인 간격 5초
 * - 동기화 「작업자」: queued → (1.5초) → running → (1.5초) → idle. 요청이 올 때마다 시간을 보고 진행시킨다
 * - 스팀: 시작하면 바로 연동되고 authorize_url은 /settings?steam=linked. 첫 동기화는 STEAM_PROFILE_PRIVATE, 다음부터 성공
 * - 다른 멤버 프로필 하나(MOCK_OTHER_MEMBER_ID)를 고정으로 둔다. 그 밖의 id는 NOT_FOUND
 */

export const MOCK_OTHER_MEMBER_ID = '0b9f6a52-8c1d-4e3a-9f27-5d6c7b8a9e10';

const MockRow = GameAccountView.extend({
  /** 외부 계정 키(PUUID·스팀 ID 흉내). 응답에는 넣지 않는다 */
  key: z.string(),
  sync_state_at: IsoDateTime.nullable(),
  /** 스팀: 남은 「비공개」 응답 횟수 */
  private_left: z.number().int().min(0),
});
type MockRow = z.infer<typeof MockRow>;

const MockVerification = RiotLinkVerificationView.extend({
  key: z.string(),
  check_count: z.number().int().min(0),
  last_checked_at: IsoDateTime.nullable(),
});
type MockVerification = z.infer<typeof MockVerification>;

export const MockS1State = z.object({
  rows: z.array(MockRow),
  verifications: z.array(MockVerification),
  /** game_account_sync_requests.created_at */
  sync_requests: z.array(IsoDateTime),
  /** lol 행 id → 최근 전적(최신순) */
  matches: z.record(z.string(), z.array(RecentLolMatch)),
});
export type MockS1State = z.infer<typeof MockS1State>;

export const emptyS1State = (): MockS1State => ({ rows: [], verifications: [], sync_requests: [], matches: {} });

export interface MockS1Options {
  /** false면 GAME_PROVIDER_NOT_CONFIGURED */
  riotConfigured?: boolean;
  steamConfigured?: boolean;
  /** 라이엇 ID 최대 개수(서버 RIOT_ACCOUNTS_MAX 흉내, 기본 3) */
  riotAccountsMax?: number;
  /** authorize_url 절대 주소의 오리진(브라우저: location.origin) */
  origin?: () => string;
}

export interface MockS1Context {
  method: string;
  path: string;
  body: unknown;
  me: Me;
  now: number;
  state: MockS1State;
  save: (s: MockS1State) => void;
  json: (status: number, body: unknown) => Response;
  error: (code: ErrorCode, message: string, opts?: { retryAfterSec?: number; details?: { path: string; message: string }[] }) => Response;
  opts: MockS1Options;
}

const STEP_MS = 1_500;
const STALE_MS = 10 * 60_000;

// -----------------------------------------------------------------------------
// 작은 도우미
// -----------------------------------------------------------------------------

const iso = (t: number) => new Date(t).toISOString();

/** KST 오늘 00:00과 다음 00:00(UTC 밀리초) */
function kstDay(now: number): { start: number; end: number } {
  const offset = 9 * 3_600_000;
  const start = Math.floor((now + offset) / 86_400_000) * 86_400_000 - offset;
  return { start, end: start + 86_400_000 };
}

function kstMidnightIso(t: number): string {
  const d = new Date(t + 9 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T00:00:00.000+09:00`;
}

function quota(state: MockS1State, now: number): SyncQuota {
  const { start, end } = kstDay(now);
  const used = state.sync_requests.filter((t) => Date.parse(t) >= start).length;
  return {
    limit: SYNC_DAILY_LIMIT_DEFAULT,
    used,
    remaining: Math.max(0, SYNC_DAILY_LIMIT_DEFAULT - used),
    resets_at: kstMidnightIso(end),
  };
}

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** 응답용 행(내부 필드 제거). 스키마 parse로 모르는 키를 지운다(D38과 같은 방식) */
const view = (r: MockRow): GameAccountView => GameAccountView.parse(r);

/** 계약 4절 정렬 */
function sorted(rows: readonly MockRow[]): MockRow[] {
  const group = (r: MockRow) => (r.provider === 'steam' ? 2 : r.is_primary ? 0 : 1);
  return [...rows].sort((a, b) => {
    const g = group(a) - group(b);
    if (g) return g;
    if (a.key !== b.key) {
      const t = Date.parse(a.verified_at) - Date.parse(b.verified_at);
      return t || (a.key < b.key ? -1 : 1);
    }
    return a.game === 'lol' ? -1 : 1;
  });
}

const riotKeys = (rows: readonly MockRow[]) => [...new Set(rows.filter((r) => r.provider === 'riot').map((r) => r.key))];

// -----------------------------------------------------------------------------
// 동기화 「작업자」
// -----------------------------------------------------------------------------

const RANKS: RankValue[] = [
  { tier: 'EMERALD', division: 'III', lp: 12, wins: 48, losses: 41 },
  { tier: 'DIAMOND', division: 'IV', lp: 67, wins: 102, losses: 95 },
  { tier: 'GOLD', division: 'I', lp: 88, wins: 30, losses: 33 },
  { tier: 'UNRANKED', division: null, lp: 0, wins: 0, losses: 0 },
];
const TFT_RANKS: RankValue[] = [
  { tier: 'PLATINUM', division: 'II', lp: 33, wins: 52, losses: 38 },
  { tier: 'MASTER', division: null, lp: 120, wins: 70, losses: 61 },
  { tier: 'UNRANKED', division: null, lp: 0, wins: 0, losses: 0 },
];

const CHAMPS = [
  { id: 266, key: 'Aatrox', name: '아트록스', pos: 'top' },
  { id: 516, key: 'Ornn', name: '오른', pos: 'top' },
  { id: 64, key: 'LeeSin', name: '리 신', pos: 'jungle' },
  { id: 126, key: 'Jayce', name: '제이스', pos: 'top' },
  { id: 104, key: 'Graves', name: '그레이브즈', pos: 'jungle' },
  { id: 103, key: 'Ahri', name: '아리', pos: 'mid' },
] as const;

export function makeMatches(seed: string, now: number, count = 12): RecentLolMatch[] {
  const h = hash(seed);
  return Array.from({ length: count }, (_, i) => {
    const c = CHAMPS[(h + i * 7) % CHAMPS.length]!;
    const r = (h >> (i % 24)) & 0xff;
    return {
      id: crypto.randomUUID(),
      played_at: iso(now - (2 + i * 9) * 3_600_000),
      win: (r + i) % 3 !== 0,
      champion_id: c.id,
      champion_key: c.key,
      champion_name: c.name,
      champion_image_url: null,
      position: i % 5 === 4 ? null : (c.pos as LolPosition),
      kills: (r % 11) + 1,
      deaths: (r % 7) + 1,
      assists: (r % 13) + 2,
      duration_sec: 1_380 + ((r * 13) % 900),
    };
  });
}

function completeSync(state: MockS1State, row: MockRow, now: number): void {
  if (row.provider === 'steam') {
    if (row.private_left > 0) {
      row.private_left -= 1;
      row.sync = { ...row.sync, error: { code: 'STEAM_PROFILE_PRIVATE', at: iso(now) } };
    } else {
      row.sync = { ...row.sync, synced_at: iso(now), error: null };
      row.steam_owned_game_count = 84;
    }
    return;
  }
  const h = hash(row.key);
  row.rank = row.game === 'lol' ? RANKS[h % RANKS.length]! : TFT_RANKS[h % TFT_RANKS.length]!;
  row.sync = { ...row.sync, synced_at: iso(now), error: null };
  if (row.game === 'lol' && row.is_primary) {
    state.matches[row.id] = makeMatches(row.key, now);
    row.sync = { ...row.sync, matches_synced_at: iso(now) };
  }
}

/** 요청마다 호출: 시간이 지난 queued/running을 다음 상태로 */
export function advanceSync(state: MockS1State, now: number): boolean {
  let changed = false;
  for (const row of state.rows) {
    if (row.sync.state === 'idle' || !row.sync_state_at) continue;
    const at = Date.parse(row.sync_state_at);
    if (row.sync.state === 'queued' && now - at >= STEP_MS) {
      row.sync = { ...row.sync, state: 'running' };
      row.sync_state_at = iso(at + STEP_MS);
      changed = true;
    }
    if (row.sync.state === 'running' && now - Date.parse(row.sync_state_at) >= STEP_MS) {
      completeSync(state, row, now);
      row.sync = { ...row.sync, state: 'idle' };
      row.sync_state_at = iso(now);
      changed = true;
    }
  }
  return changed;
}

// -----------------------------------------------------------------------------
// 프로필
// -----------------------------------------------------------------------------

function mainPosition(matches: readonly RecentLolMatch[]): MainPosition | null {
  const sample = matches.slice(0, RECENT_MATCHES_MAX).map((m) => m.position).filter((p): p is LolPosition => p !== null);
  if (sample.length === 0) return null;
  const counts = LolPosition.options
    .map((position) => ({ position, count: sample.filter((p) => p === position).length }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count || LolPosition.options.indexOf(a.position) - LolPosition.options.indexOf(b.position))
    .slice(0, 2);
  return {
    source: 'riot_ranked_solo',
    sample_size: sample.length,
    positions: counts.map((c) => ({ ...c, ratio: Math.round((c.count / sample.length) * 100) / 100 })),
  };
}

function buildProfile(
  user: GetUserProfileResponse['user'],
  rows: MockRow[],
  matches: MockS1State['matches'],
  isSelf: boolean,
  q: SyncQuota | null,
  refreshQueued: boolean,
): GetUserProfileResponse {
  const list = sorted(rows);
  const lol = list.find((r) => r.provider === 'riot' && r.game === 'lol' && r.is_primary);
  const tft = list.find((r) => r.provider === 'riot' && r.game === 'tft' && r.is_primary);
  const tiers: ProfileTierCard[] = [];
  if (lol) tiers.push({ game_account_id: lol.id, game: 'lol', queue: 'RANKED_SOLO_5x5', rank: lol.rank, synced_at: lol.sync.synced_at });
  if (tft) tiers.push({ game_account_id: tft.id, game: 'tft', queue: 'RANKED_TFT', rank: tft.rank, synced_at: tft.sync.synced_at });
  const ms = lol ? (matches[lol.id] ?? []) : [];
  return {
    user,
    is_self: isSelf,
    game_accounts: list.map(view),
    tiers,
    main_position: lol ? mainPosition(ms) : null,
    recent_matches: lol
      ? { items: ms.slice(0, PROFILE_RECENT_MATCHES_LIMIT), synced_at: lol.sync.matches_synced_at, refresh_queued: refreshQueued }
      : null,
    sync_quota: isSelf ? q : null,
    scrim: null,
    badges: null,
  };
}

function otherMemberProfile(now: number): GetUserProfileResponse {
  const day = 86_400_000;
  const base = {
    verified_at: iso(now - 40 * day),
    sync_state_at: null,
    private_left: 0,
    steam_owned_game_count: null,
  };
  const synced = { state: 'idle' as const, synced_at: iso(now - 25 * 60_000), matches_synced_at: iso(now - 3_600_000), error: null };
  const rows: MockRow[] = [
    { ...base, id: 'c1d2e3f4-0000-4000-8000-000000000001', key: 'o-main', game: 'lol', provider: 'riot', display_name: '정글차이#KR2', is_primary: true, rank: RANKS[1]!, sync: synced },
    { ...base, id: 'c1d2e3f4-0000-4000-8000-000000000002', key: 'o-main', game: 'tft', provider: 'riot', display_name: '정글차이#KR2', is_primary: true, rank: TFT_RANKS[2]!, sync: { ...synced, matches_synced_at: null } },
    { ...base, id: 'c1d2e3f4-0000-4000-8000-000000000003', key: 'o-sub', game: 'lol', provider: 'riot', display_name: '정글부캐#0001', is_primary: false, verified_at: iso(now - 10 * day), rank: RANKS[2]!, sync: { ...synced, matches_synced_at: null } },
    { ...base, id: 'c1d2e3f4-0000-4000-8000-000000000004', key: 'o-sub', game: 'tft', provider: 'riot', display_name: '정글부캐#0001', is_primary: false, verified_at: iso(now - 10 * day), rank: null, sync: { ...synced, matches_synced_at: null } },
  ];
  return buildProfile(
    { id: MOCK_OTHER_MEMBER_ID, nickname: '정글차이', role: 'member', avatar_url: null, discord_linked: true, joined_at: iso(now - 200 * day) },
    rows,
    { [rows[0]!.id]: makeMatches('o-main', now, 15) },
    false,
    null,
    false,
  );
}

// -----------------------------------------------------------------------------
// 라우터
// -----------------------------------------------------------------------------

const matchPath = (template: string, path: string): string | null => {
  const re = new RegExp(`^${template.replace(/:id/g, '([^/]+)')}$`);
  const m = re.exec(path);
  return m ? decodeURIComponent(m[1] ?? '') : null;
};

/** S1 경로가 아니면 null */
export function handleS1(ctx: MockS1Context): Response | null {
  const { method, path, now, state, me } = ctx;
  const { json, error } = ctx;
  if (advanceSync(state, now)) ctx.save(state);

  const listResponse = (): GetMyGameAccountsResponse => {
    const pending = [...state.verifications]
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .find((v) => v.status === 'pending');
    return {
      accounts: sorted(state.rows).map(view),
      riot_verification: pending
        ? RiotLinkVerificationView.parse({ ...pending, status: Date.parse(pending.expires_at) <= now ? 'expired' : 'pending' })
        : null,
      sync_quota: quota(state, now),
      limits: { riot_accounts_max: riotMax, steam_accounts_max: STEAM_ACCOUNTS_MAX },
    };
  };
  const riotMax = ctx.opts.riotAccountsMax ?? RIOT_ACCOUNTS_MAX_DEFAULT;
  const invalidId = (id: string) =>
    Uuid.safeParse(id).success ? null : error('VALIDATION_FAILED', 'id 형식이 올바르지 않습니다.', { details: [{ path: 'id', message: 'uuid' }] });

  // GET /me/game-accounts
  if (path === ApiPath.myGameAccounts && method === 'GET') return json(200, listResponse());

  // POST /me/game-accounts
  if (path === ApiPath.myGameAccounts && method === 'POST') {
    const parsed = LinkGameAccountRequest.safeParse(ctx.body);
    if (!parsed.success) {
      return error('VALIDATION_FAILED', '요청 형식이 올바르지 않습니다.', {
        details: parsed.error.issues.map((i) => ({ path: i.path.join('.') || 'riot_id', message: i.message })),
      });
    }
    if (parsed.data.provider === 'steam') {
      if (ctx.opts.steamConfigured === false) return error('GAME_PROVIDER_NOT_CONFIGURED', 'STEAM_API_KEY 없음');
      if (state.rows.some((r) => r.provider === 'steam')) return error('GAME_ACCOUNT_LIMIT_REACHED', '스팀은 1개');
      // 실제: OpenID 왕복 후 콜백이 행을 만든다. 목: 바로 만들고 콜백 결과 위치로 보낸다
      state.rows.push({
        id: crypto.randomUUID(),
        key: `steam-${me.id}`,
        game: 'steam',
        provider: 'steam',
        display_name: `${me.nickname}_steam`,
        verified_at: iso(now),
        is_primary: true,
        rank: null,
        sync: { state: 'queued', synced_at: null, matches_synced_at: null, error: null },
        steam_owned_game_count: null,
        sync_state_at: iso(now),
        private_left: 1,
      });
      ctx.save(state);
      const origin = ctx.opts.origin?.() ?? 'http://localhost:3000';
      const res: LinkGameAccountResponse = { provider: 'steam', authorize_url: `${origin}/settings?steam=linked` };
      return json(200, res);
    }

    const { game_name, tag_line } = parsed.data.riot_id;
    if (ctx.opts.riotConfigured === false) return error('GAME_PROVIDER_NOT_CONFIGURED', 'RIOT_API_KEY 없음');
    if (riotKeys(state.rows).length >= riotMax) return error('GAME_ACCOUNT_LIMIT_REACHED', '라이엇 ID 최대 개수');
    const { start, end } = kstDay(now);
    if (state.verifications.filter((v) => Date.parse(v.created_at) >= start).length >= RIOT_VERIFICATION_DAILY_START_LIMIT) {
      return error('RATE_LIMITED', '오늘 소유 확인 시작 횟수 초과', { retryAfterSec: Math.ceil((end - now) / 1000) });
    }
    const name = game_name.toLowerCase();
    if (name === 'notfound') return error('RIOT_ID_NOT_FOUND', 'Account-V1 404');
    if (name === 'busy') return error('GAME_PROVIDER_RATE_LIMITED', '라이엇 429', { retryAfterSec: 30 });
    const key = `riot-${name}#${tag_line.toLowerCase()}`;
    if (state.rows.some((r) => r.key === key)) return error('GAME_ACCOUNT_ALREADY_LINKED_TO_ME', '내가 이미 연동함');
    if (name === 'taken') return error('GAME_ACCOUNT_ALREADY_LINKED', '다른 멤버가 연동함');
    if (name === 'nosummoner') return error('RIOT_SUMMONER_NOT_FOUND', 'Summoner-V4 404');

    for (const v of state.verifications) if (v.status === 'pending') v.status = 'cancelled';
    const current = hash(key) % RIOT_VERIFICATION_ICON_IDS.length;
    // 「다른 아이콘 받기」(D65)로 다시 시작하면 직전 아이콘과도 다른 번호를 준다
    const previous = [...state.verifications].reverse().find((x) => x.key === key)?.icon_id;
    const candidates = RIOT_VERIFICATION_ICON_IDS.filter((i) => i !== current && i !== previous);
    const v: MockVerification = {
      id: crypto.randomUUID(),
      key,
      display_name: formatRiotId({ game_name, tag_line }),
      icon_id: candidates[(hash(key) + state.verifications.length) % candidates.length]!,
      icon_image_url: null,
      status: 'pending',
      expires_at: iso(now + RIOT_VERIFICATION_TTL_SEC_DEFAULT * 1000),
      created_at: iso(now),
      check_count: 0,
      last_checked_at: null,
    };
    state.verifications.push(v);
    ctx.save(state);
    const res: LinkGameAccountResponse = { provider: 'riot', verification: RiotLinkVerificationView.parse(v) };
    return json(200, res);
  }

  // POST …/riot-verifications/:id/confirm
  let id = matchPath(ApiPath.riotVerificationConfirm, path);
  if (id !== null && method === 'POST') {
    const bad = invalidId(id);
    if (bad) return bad;
    const v = state.verifications.find((x) => x.id === id);
    if (!v) return error('NOT_FOUND', '확인 없음');
    const accountsOf = () => sorted(state.rows.filter((r) => r.key === v.key)).map(view);
    if (v.status === 'verified') {
      const res: ConfirmRiotVerificationResponse = { verification: RiotLinkVerificationView.parse(v), accounts: accountsOf() };
      return json(200, res);
    }
    if (v.status !== 'pending') return error('OWNERSHIP_CHECK_EXPIRED', '확인 종료');
    if (Date.parse(v.expires_at) <= now) {
      v.status = 'expired';
      ctx.save(state);
      return error('OWNERSHIP_CHECK_EXPIRED', '시간 초과');
    }
    if (v.last_checked_at) {
      const wait = RIOT_VERIFICATION_CHECK_INTERVAL_SEC * 1000 - (now - Date.parse(v.last_checked_at));
      if (wait > 0) return error('RATE_LIMITED', '확인 간격 5초', { retryAfterSec: Math.ceil(wait / 1000) });
    }
    v.last_checked_at = iso(now);
    v.check_count += 1;
    if (v.check_count === 1) {
      ctx.save(state);
      return error('OWNERSHIP_CHECK_FAILED', '아이콘 불일치');
    }
    if (riotKeys(state.rows).length >= riotMax) return error('GAME_ACCOUNT_LIMIT_REACHED', '최대 개수');
    if (state.rows.some((r) => r.key === v.key)) return error('GAME_ACCOUNT_ALREADY_LINKED_TO_ME', '내가 이미 연동함');
    const isPrimary = riotKeys(state.rows).length === 0;
    for (const game of ['lol', 'tft'] as const) {
      state.rows.push({
        id: crypto.randomUUID(),
        key: v.key,
        game,
        provider: 'riot',
        display_name: v.display_name,
        verified_at: iso(now),
        is_primary: isPrimary,
        rank: null,
        sync: { state: 'queued', synced_at: null, matches_synced_at: null, error: null },
        steam_owned_game_count: null,
        sync_state_at: iso(now),
        private_left: 0,
      });
    }
    v.status = 'verified';
    ctx.save(state);
    const res: ConfirmRiotVerificationResponse = { verification: RiotLinkVerificationView.parse(v), accounts: accountsOf() };
    return json(200, res);
  }

  // DELETE …/riot-verifications/:id
  id = matchPath(ApiPath.riotVerification, path);
  if (id !== null && method === 'DELETE') {
    const bad = invalidId(id);
    if (bad) return bad;
    const v = state.verifications.find((x) => x.id === id);
    if (!v) return error('NOT_FOUND', '확인 없음');
    if (v.status === 'pending') {
      v.status = 'cancelled';
      ctx.save(state);
    }
    return new Response(null, { status: 204 });
  }

  // POST /me/game-accounts/:id/primary
  id = matchPath(ApiPath.myGameAccountPrimary, path);
  if (id !== null && method === 'POST') {
    const bad = invalidId(id);
    if (bad) return bad;
    const row = state.rows.find((r) => r.id === id);
    if (!row) return error('NOT_FOUND', '계정 없음');
    if (row.provider === 'riot' && !row.is_primary) {
      for (const r of state.rows) if (r.provider === 'riot') r.is_primary = false;
      for (const r of state.rows) if (r.key === row.key) r.is_primary = true;
      ctx.save(state);
    }
    const res: SetPrimaryGameAccountResponse = { accounts: sorted(state.rows).map(view) };
    return json(200, res);
  }

  // POST /me/game-accounts/:id/sync
  id = matchPath(ApiPath.myGameAccountSync, path);
  if (id !== null && method === 'POST') {
    const bad = invalidId(id);
    if (bad) return bad;
    const row = state.rows.find((r) => r.id === id);
    if (!row) return error('NOT_FOUND', '계정 없음');
    if (row.provider === 'riot' && ctx.opts.riotConfigured === false) return error('GAME_PROVIDER_NOT_CONFIGURED', '키 없음');
    if (row.provider === 'steam' && ctx.opts.steamConfigured === false) return error('GAME_PROVIDER_NOT_CONFIGURED', '키 없음');
    const targets = state.rows.filter((r) => r.key === row.key);
    const busy = targets.some(
      (r) => r.sync.state !== 'idle' && r.sync_state_at !== null && now - Date.parse(r.sync_state_at) < STALE_MS,
    );
    if (busy) {
      const res: SyncGameAccountResponse = { accounts: sorted(state.rows).map(view), sync_quota: quota(state, now), quota_consumed: false };
      return json(202, res);
    }
    const q = quota(state, now);
    if (q.remaining <= 0) {
      return error('SYNC_LIMIT_EXCEEDED', '오늘 한도 소진', { retryAfterSec: Math.ceil((kstDay(now).end - now) / 1000) });
    }
    state.sync_requests.push(iso(now));
    for (const r of targets) {
      r.sync = { ...r.sync, state: 'queued' };
      r.sync_state_at = iso(now);
    }
    ctx.save(state);
    const res: SyncGameAccountResponse = { accounts: sorted(state.rows).map(view), sync_quota: quota(state, now), quota_consumed: true };
    return json(202, res);
  }

  // DELETE /me/game-accounts/:id  (sync·primary 경로보다 뒤에서 검사)
  id = matchPath(ApiPath.myGameAccount, path);
  if (id !== null && method === 'DELETE') {
    const bad = invalidId(id);
    if (bad) return bad;
    const row = state.rows.find((r) => r.id === id);
    if (!row) return error('NOT_FOUND', '계정 없음');
    const wasPrimaryRiot = row.provider === 'riot' && row.is_primary;
    for (const r of state.rows) if (r.key === row.key) delete state.matches[r.id];
    state.rows = state.rows.filter((r) => r.key !== row.key);
    if (wasPrimaryRiot) {
      const next = sorted(state.rows.filter((r) => r.provider === 'riot'))[0];
      if (next) for (const r of state.rows) if (r.key === next.key) r.is_primary = true;
    }
    ctx.save(state);
    return new Response(null, { status: 204 });
  }

  // GET /users/:id/profile
  id = matchPath(ApiPath.userProfile, path);
  if (id !== null && method === 'GET') {
    const bad = invalidId(id);
    if (bad) return bad;
    if (id === MOCK_OTHER_MEMBER_ID) return json(200, otherMemberProfile(now));
    if (id !== me.id) return error('NOT_FOUND', '사용자 없음');
    // 대표 lol 행의 전적이 6시간 지났으면 전적 갱신을 바로 실행(idle → running), 차감 없음
    const lol = state.rows.find((r) => r.provider === 'riot' && r.game === 'lol' && r.is_primary);
    let refreshQueued = false;
    if (lol) {
      const stale =
        lol.sync.matches_synced_at === null ||
        now - Date.parse(lol.sync.matches_synced_at) >= RECENT_MATCHES_TTL_HOURS * 3_600_000;
      if (lol.sync.state !== 'idle') refreshQueued = true;
      else if (stale && lol.sync.error === null) {
        for (const r of state.rows) {
          if (r.key !== lol.key) continue;
          r.sync = { ...r.sync, state: 'running' };
          r.sync_state_at = iso(now);
        }
        ctx.save(state);
        refreshQueued = true;
      }
    }
    const user = {
      id: me.id,
      nickname: me.nickname,
      role: me.role,
      avatar_url: me.avatar_url,
      discord_linked: !!me.discord_id && !me.discord_id.startsWith('dev-'),
      joined_at: me.created_at,
    };
    return json(200, buildProfile(user, state.rows, state.matches, true, quota(state, now), refreshQueued));
  }

  return null;
}
