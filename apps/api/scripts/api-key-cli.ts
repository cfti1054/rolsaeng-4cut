/**
 * api-key CLI의 순수 부분(인자 파싱·출력 형식). DB·콘솔을 건드리지 않는다(단위 테스트 대상).
 * 계약 6-1: create(--name --scopes) / list / revoke(--id | --prefix)
 */
import { API_KEY_DISPLAY_PREFIX_LENGTH, ApiKeyScope } from '@gcd/shared';

export const EXIT_OK = 0;
/** 인자 오류(모르는 명령·scope, 필수 값 없음 등) */
export const EXIT_USAGE = 1;
/** 대상 없음·모호함 */
export const EXIT_TARGET = 2;
/** DB 등 예기치 못한 실패 */
export const EXIT_FAILURE = 3;

export const NAME_MAX_LENGTH = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX_RE = new RegExp(`^[A-Za-z0-9_-]{${API_KEY_DISPLAY_PREFIX_LENGTH}}$`);

export type CliCommand =
  | { command: 'create'; name: string; scopes: ApiKeyScope[] }
  | { command: 'list' }
  | { command: 'revoke'; target: { by: 'id'; id: string } | { by: 'prefix'; prefix: string } };

export type ParseResult = { ok: true; value: CliCommand } | { ok: false; error: string };

export const USAGE = [
  '사용법:',
  '  api-key create --name "<이름>" --scopes <scope,scope,...>',
  '  api-key list',
  '  api-key revoke --id <uuid>   (또는 --prefix <8자>)',
  `scope: ${ApiKeyScope.options.join(', ')}`,
].join('\n');

/** `--key value` 와 `--key=value` 를 모두 받는다. 값이 없거나 모르는 옵션이면 오류 */
function readFlags(args: string[], allowed: string[]): { flags: Map<string, string> } | { error: string } {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (!a.startsWith('--')) return { error: `알 수 없는 인자: ${a}` };
    const eq = a.indexOf('=');
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (!allowed.includes(key)) return { error: `알 수 없는 옵션: --${key}` };
    if (flags.has(key)) return { error: `옵션이 두 번 나왔다: --${key}` };
    let value: string | undefined;
    if (eq !== -1) value = a.slice(eq + 1);
    else {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        value = next;
        i++;
      }
    }
    if (value === undefined || value === '') return { error: `--${key} 값이 필요하다` };
    flags.set(key, value);
  }
  return { flags };
}

/** 쉼표 목록 → ApiKeyScope[](중복 제거, 입력 순서 유지). 모르는 값이 하나라도 있으면 오류 */
export function parseScopes(input: string): { ok: true; scopes: ApiKeyScope[] } | { ok: false; error: string } {
  const parts = input.split(',').map((s) => s.trim());
  if (parts.some((p) => p === '')) return { ok: false, error: '--scopes 에 빈 항목이 있다' };
  const unknown = parts.filter((p) => !ApiKeyScope.safeParse(p).success);
  if (unknown.length > 0) return { ok: false, error: `모르는 scope: ${unknown.join(', ')}` };
  return { ok: true, scopes: [...new Set(parts)] as ApiKeyScope[] };
}

export function parseCliArgs(argv: string[]): ParseResult {
  const [command, ...rest] = argv;
  if (command === undefined) return { ok: false, error: '명령이 없다' };

  if (command === 'list') {
    if (rest.length > 0) return { ok: false, error: `list 는 인자가 없다: ${rest.join(' ')}` };
    return { ok: true, value: { command: 'list' } };
  }

  if (command === 'create') {
    const r = readFlags(rest, ['name', 'scopes']);
    if ('error' in r) return { ok: false, error: r.error };
    const name = r.flags.get('name')?.trim();
    const scopesRaw = r.flags.get('scopes');
    if (!name) return { ok: false, error: '--name 이 필요하다' };
    if (name.length > NAME_MAX_LENGTH) return { ok: false, error: `--name 은 ${NAME_MAX_LENGTH}자 이하` };
    if (!scopesRaw) return { ok: false, error: '--scopes 가 필요하다' };
    const s = parseScopes(scopesRaw);
    if (!s.ok) return { ok: false, error: s.error };
    return { ok: true, value: { command: 'create', name, scopes: s.scopes } };
  }

  if (command === 'revoke') {
    const r = readFlags(rest, ['id', 'prefix']);
    if ('error' in r) return { ok: false, error: r.error };
    const id = r.flags.get('id');
    const prefix = r.flags.get('prefix');
    if ((id === undefined) === (prefix === undefined)) return { ok: false, error: '--id 와 --prefix 중 하나만 필요하다' };
    if (id !== undefined) {
      if (!UUID_RE.test(id)) return { ok: false, error: '--id 는 UUID 여야 한다' };
      return { ok: true, value: { command: 'revoke', target: { by: 'id', id: id.toLowerCase() } } };
    }
    if (!PREFIX_RE.test(prefix as string)) {
      return { ok: false, error: `--prefix 는 ${API_KEY_DISPLAY_PREFIX_LENGTH}자(영숫자·-·_)여야 한다` };
    }
    return { ok: true, value: { command: 'revoke', target: { by: 'prefix', prefix: prefix as string } } };
  }

  return { ok: false, error: `모르는 명령: ${command}` };
}

export type KeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

const iso = (d: Date | null): string => (d ? d.toISOString() : '-');

/** create 출력. 원문은 이 한 번만 보인다 */
export function formatCreated(row: Pick<KeyRow, 'id' | 'name' | 'keyPrefix' | 'scopes'>, raw: string): string {
  return [
    `API 키를 만들었다. 원문은 지금 한 번만 표시된다. 안전한 곳에 바로 옮겨 적어라.`,
    '',
    `  key:        ${raw}`,
    `  id:         ${row.id}`,
    `  name:       ${row.name}`,
    `  key_prefix: ${row.keyPrefix}`,
    `  scopes:     ${row.scopes.join(',')}`,
  ].join('\n');
}

/** list 출력. 원문·해시는 넣지 않는다 */
export function formatList(rows: KeyRow[]): string {
  if (rows.length === 0) return '발급된 키가 없다.';
  const header = ['id', 'name', 'key_prefix', 'scopes', 'last_used_at', 'revoked_at'];
  const body = rows.map((r) => [r.id, r.name, r.keyPrefix, r.scopes.join(',') || '-', iso(r.lastUsedAt), iso(r.revokedAt)]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((b) => (b[i] as string).length)));
  const line = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i] as number)).join('  ').trimEnd();
  return [line(header), ...body.map(line)].join('\n');
}

export function formatRevoked(row: Pick<KeyRow, 'id' | 'name' | 'keyPrefix'>, revokedAt: Date, already: boolean): string {
  return already
    ? `이미 폐기된 키다: ${row.keyPrefix} (${row.name}, id ${row.id}) revoked_at=${revokedAt.toISOString()}`
    : `폐기했다: ${row.keyPrefix} (${row.name}, id ${row.id}) revoked_at=${revokedAt.toISOString()}`;
}

export type PrefixMatch =
  | { kind: 'one'; row: KeyRow }
  | { kind: 'none' }
  | { kind: 'many'; rows: KeyRow[] };

export function classifyMatches(rows: KeyRow[]): PrefixMatch {
  if (rows.length === 0) return { kind: 'none' };
  if (rows.length === 1) return { kind: 'one', row: rows[0] as KeyRow };
  return { kind: 'many', rows };
}
