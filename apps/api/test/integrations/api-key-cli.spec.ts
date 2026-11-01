import { API_KEY_PATTERN, API_KEY_PREFIX, ApiKeyScope } from '@gcd/shared';
import { describe, expect, it } from 'vitest';
import { generateApiKey, hashApiKey } from '../../src/common/api-key';
import {
  NAME_MAX_LENGTH,
  classifyMatches,
  formatCreated,
  formatList,
  formatRevoked,
  parseCliArgs,
  parseScopes,
  type KeyRow,
} from '../../scripts/api-key-cli';

const UUID = '3f2b8c1e-9d4a-4b6e-8a1f-0c2d3e4f5a6b';
const ALL = ApiKeyScope.options.join(',');

describe('generateApiKey / hashApiKey', () => {
  it('형식: gcd_ + 43자(47자), prefix = gcd_ 뒤 8자, hash = sha256 hex(64자)', () => {
    const k = generateApiKey();
    expect(k.raw).toMatch(API_KEY_PATTERN);
    expect(k.raw).toHaveLength(47);
    expect(k.prefix).toBe(k.raw.slice(API_KEY_PREFIX.length, API_KEY_PREFIX.length + 8));
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(k.hash).toBe(hashApiKey(k.raw));
  });
  it('매번 다르다', () => {
    expect(generateApiKey().raw).not.toBe(generateApiKey().raw);
  });
  it('알려진 값: sha256("abc")', () => {
    expect(hashApiKey('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('parseScopes', () => {
  it('6개 전부 parse, 중복 제거, 공백 허용', () => {
    const r = parseScopes(ALL);
    expect(r).toEqual({ ok: true, scopes: ApiKeyScope.options });
    expect(parseScopes('bot:members, bot:members ,bot:activity')).toEqual({ ok: true, scopes: ['bot:members', 'bot:activity'] });
  });
  it('모르는 값·빈 항목은 오류', () => {
    expect(parseScopes('bot:activity,bot:nope')).toEqual({ ok: false, error: '모르는 scope: bot:nope' });
    expect(parseScopes('bot:activity,').ok).toBe(false);
    // r2(D237): bot:link는 더 이상 scope가 아니다
    expect(parseScopes('bot:link')).toEqual({ ok: false, error: '모르는 scope: bot:link' });
  });
});

describe('parseCliArgs', () => {
  it('create: --key value, --key=value 모두', () => {
    expect(parseCliArgs(['create', '--name', '디스코드 봇', '--scopes', ALL])).toEqual({
      ok: true,
      value: { command: 'create', name: '디스코드 봇', scopes: ApiKeyScope.options },
    });
    expect(parseCliArgs(['create', '--name=봇', '--scopes=bot:activity'])).toEqual({
      ok: true,
      value: { command: 'create', name: '봇', scopes: ['bot:activity'] },
    });
  });
  it('create 오류: name·scopes 없음, 긴 이름, 모르는 scope, 모르는 옵션, 중복 옵션', () => {
    expect(parseCliArgs(['create', '--scopes', 'bot:activity']).ok).toBe(false);
    expect(parseCliArgs(['create', '--name', 'x']).ok).toBe(false);
    expect(parseCliArgs(['create', '--name', 'x'.repeat(NAME_MAX_LENGTH + 1), '--scopes', 'bot:activity']).ok).toBe(false);
    expect(parseCliArgs(['create', '--name', 'x', '--scopes', 'admin']).ok).toBe(false);
    expect(parseCliArgs(['create', '--name', 'x', '--scopes', 'bot:activity', '--force']).ok).toBe(false);
    expect(parseCliArgs(['create', '--name', 'a', '--name', 'b', '--scopes', 'bot:activity']).ok).toBe(false);
    expect(parseCliArgs(['create', '--name', '--scopes', 'bot:activity']).ok).toBe(false); // name 값 없음
  });
  it('list', () => {
    expect(parseCliArgs(['list'])).toEqual({ ok: true, value: { command: 'list' } });
    expect(parseCliArgs(['list', 'x']).ok).toBe(false);
  });
  it('revoke: id 또는 prefix 하나만', () => {
    expect(parseCliArgs(['revoke', '--id', UUID.toUpperCase()])).toEqual({
      ok: true,
      value: { command: 'revoke', target: { by: 'id', id: UUID } },
    });
    expect(parseCliArgs(['revoke', '--prefix', 'Ab3_-xYz'])).toEqual({
      ok: true,
      value: { command: 'revoke', target: { by: 'prefix', prefix: 'Ab3_-xYz' } },
    });
    expect(parseCliArgs(['revoke']).ok).toBe(false);
    expect(parseCliArgs(['revoke', '--id', UUID, '--prefix', 'Ab3_-xYz']).ok).toBe(false);
    expect(parseCliArgs(['revoke', '--id', 'not-uuid']).ok).toBe(false);
    expect(parseCliArgs(['revoke', '--prefix', 'short']).ok).toBe(false);
  });
  it('명령 없음·모르는 명령', () => {
    expect(parseCliArgs([]).ok).toBe(false);
    expect(parseCliArgs(['delete']).ok).toBe(false);
  });
});

const row = (over: Partial<KeyRow> = {}): KeyRow => ({
  id: UUID,
  name: '디스코드 봇',
  keyPrefix: 'Ab3_-xYz',
  scopes: ['bot:members', 'bot:activity'],
  lastUsedAt: null,
  revokedAt: null,
  ...over,
});

describe('출력 형식', () => {
  it('create: 원문·id·key_prefix·scopes 포함', () => {
    const k = generateApiKey();
    const out = formatCreated(row(), k.raw);
    expect(out).toContain(k.raw);
    expect(out).toContain(UUID);
    expect(out).toContain('Ab3_-xYz');
    expect(out).toContain('bot:members,bot:activity');
  });
  it('list: 원문·해시 열 없음, 시각은 ISO, 없으면 -', () => {
    const out = formatList([row(), row({ id: 'x', lastUsedAt: new Date('2026-10-31T00:00:00Z'), revokedAt: new Date('2026-10-31T01:00:00Z') })]);
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/^id\s+name\s+key_prefix\s+scopes\s+last_used_at\s+revoked_at$/);
    expect(lines[1]).toContain('-');
    expect(lines[2]).toContain('2026-10-31T00:00:00.000Z');
    expect(out).not.toMatch(/gcd_|hash/i);
  });
  it('list 비어 있음', () => {
    expect(formatList([])).toBe('발급된 키가 없다.');
  });
  it('revoke: 새로 폐기 / 이미 폐기', () => {
    const at = new Date('2026-10-31T01:00:00Z');
    expect(formatRevoked(row(), at, false)).toMatch(/^폐기했다/);
    expect(formatRevoked(row(), at, true)).toMatch(/^이미 폐기/);
  });
  it('prefix 일치 분류', () => {
    expect(classifyMatches([]).kind).toBe('none');
    expect(classifyMatches([row()]).kind).toBe('one');
    expect(classifyMatches([row(), row({ id: 'y' })]).kind).toBe('many');
  });
});
