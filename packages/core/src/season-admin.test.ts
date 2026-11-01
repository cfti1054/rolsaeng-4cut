import { describe, expect, it } from 'vitest';
import { SEASON_EDIT_MIN_LEAD_SEC, SEASON_LENGTH_MAX_DAYS, SEASON_LENGTH_MIN_DAYS } from '@gcd/shared';
import {
  DAY_MS,
  HOUR_MS,
  seasonEditable,
  seasonPhase,
  validateSeasonDelete,
  validateSeasonWrite,
  type SeasonPhase,
} from './index';

const kst = (s: string) => new Date(`${s}+09:00`);
type S = { id: string; startsAt: Date; endsAt: Date; closedAt: Date | null };
const season = (id: string, start: string, end: string, closedAt: Date | null = null): S => ({
  id,
  startsAt: kst(start),
  endsAt: kst(end),
  closedAt,
});
const policy = {
  minLeadMs: SEASON_EDIT_MIN_LEAD_SEC * 1000,
  minLengthMs: SEASON_LENGTH_MIN_DAYS * DAY_MS,
  maxLengthMs: SEASON_LENGTH_MAX_DAYS * DAY_MS,
};
const NOW = kst('2026-11-10T12:00:00.000');
const at = (ms: number) => new Date(NOW.getTime() + ms);

describe('seasonPhase·seasonEditable', () => {
  const s = season('s', '2026-11-01T00:00:00.000', '2026-12-01T00:00:00.000');

  it('경계: now = startsAt → current, startsAt − 1ms → upcoming, now = endsAt → ended', () => {
    expect(seasonPhase(s, new Date(s.startsAt.getTime() - 1))).toBe('upcoming');
    expect(seasonPhase(s, s.startsAt)).toBe('current');
    expect(seasonPhase(s, new Date(s.endsAt.getTime() - 1))).toBe('current');
    expect(seasonPhase(s, s.endsAt)).toBe('ended');
  });

  it('closedAt 있으면 시간 무관 closed', () => {
    const c = { ...s, closedAt: kst('2026-12-01T00:01:00.000') };
    expect(seasonPhase(c, new Date(s.startsAt.getTime() - DAY_MS))).toBe('closed');
    expect(seasonPhase(c, NOW)).toBe('closed');
    expect(seasonPhase(c, kst('2027-06-01T00:00:00.000'))).toBe('closed');
  });

  it('11-1 표', () => {
    const table: Record<SeasonPhase, ReturnType<typeof seasonEditable>> = {
      upcoming: { name: true, startsAt: true, endsAt: true, delete: true },
      current: { name: true, startsAt: false, endsAt: true, delete: false },
      ended: { name: true, startsAt: false, endsAt: false, delete: false },
      closed: { name: true, startsAt: false, endsAt: false, delete: false },
    };
    for (const [phase, expected] of Object.entries(table)) expect(seasonEditable(phase as SeasonPhase)).toEqual(expected);
  });

  it('알 수 없는 단계·잘못된 now는 RangeError', () => {
    expect(() => seasonEditable('x' as SeasonPhase)).toThrow(RangeError);
    expect(() => seasonPhase(s, new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe('validateSeasonWrite', () => {
  const create = (startsAt: Date, endsAt: Date, seasons: S[] = []) =>
    validateSeasonWrite({ seasons, target: null, next: { startsAt, endsAt }, changed: { startsAt: true, endsAt: true }, now: NOW, policy });

  it('생성 정상 → []', () => {
    expect(create(at(DAY_MS), at(31 * DAY_MS))).toEqual([]);
  });

  it('lead: 정확히 now + 1시간 허용, 1시간 − 1ms 실패(path starts_at)', () => {
    expect(SEASON_EDIT_MIN_LEAD_SEC).toBe(3600);
    expect(create(at(HOUR_MS), at(HOUR_MS + 30 * DAY_MS))).toEqual([]);
    expect(create(at(HOUR_MS - 1), at(HOUR_MS + 30 * DAY_MS))).toEqual([
      { kind: 'invalid', path: 'starts_at', message: expect.any(String) },
    ]);
  });

  it('길이: 7일 정확 허용·7일 − 1ms·6일 실패·366일 허용·366일 + 1ms·367일 실패(path ends_at)', () => {
    const st = at(DAY_MS);
    const len = (ms: number) => create(st, new Date(st.getTime() + ms));
    const bad = [{ kind: 'invalid', path: 'ends_at', message: expect.any(String) }];
    expect(len(7 * DAY_MS)).toEqual([]);
    expect(len(7 * DAY_MS - 1)).toEqual(bad);
    expect(len(6 * DAY_MS)).toEqual(bad);
    expect(len(366 * DAY_MS)).toEqual([]);
    expect(len(366 * DAY_MS + 1)).toEqual(bad);
    expect(len(367 * DAY_MS)).toEqual(bad);
  });

  it('ends ≤ starts → invalid 1개(길이 문구를 겹쳐 내지 않음)', () => {
    const st = at(DAY_MS);
    expect(create(st, st)).toEqual([{ kind: 'invalid', path: 'ends_at', message: expect.any(String) }]);
    expect(create(st, new Date(st.getTime() - DAY_MS))).toHaveLength(1);
  });

  it('반열림 겹침: 끝 = 다음 시작이면 겹치지 않음, 1ms 겹치면 overlap', () => {
    const other = season('o', '2026-12-01T00:00:00.000', '2027-01-01T00:00:00.000');
    const prev = season('p', '2026-10-01T00:00:00.000', '2026-11-11T00:00:00.000');
    const st = prev.endsAt;
    expect(create(st, other.startsAt, [other, prev])).toEqual([]);
    expect(create(st, new Date(other.startsAt.getTime() + 1), [other, prev])).toEqual([{ kind: 'overlap', seasonId: 'o' }]);
    expect(create(new Date(st.getTime() - 1), other.startsAt, [other, prev])).toEqual([{ kind: 'overlap', seasonId: 'p' }]);
  });

  it('겹치는 시즌 여럿은 startsAt ASC, id ASC', () => {
    const a = season('b-id', '2026-12-01T00:00:00.000', '2026-12-10T00:00:00.000');
    const b = season('a-id', '2026-12-01T00:00:00.000', '2026-12-20T00:00:00.000');
    const c = season('c', '2026-11-20T00:00:00.000', '2026-12-01T00:00:00.000');
    expect(create(kst('2026-11-25T00:00:00.000'), kst('2026-12-15T00:00:00.000'), [a, b, c])).toEqual([
      { kind: 'overlap', seasonId: 'c' },
      { kind: 'overlap', seasonId: 'a-id' },
      { kind: 'overlap', seasonId: 'b-id' },
    ]);
  });

  it('자기 자신과는 겹침으로 보지 않음(upcoming 기간 수정)', () => {
    const up = season('u', '2026-12-01T00:00:00.000', '2027-01-01T00:00:00.000');
    const r = validateSeasonWrite({
      seasons: [up],
      target: up,
      next: { startsAt: up.startsAt, endsAt: kst('2027-01-15T00:00:00.000') },
      changed: { startsAt: false, endsAt: true },
      now: NOW,
      policy,
    });
    expect(r).toEqual([]);
  });

  it('upcoming 시작 변경도 lead 적용, 이름만 바꾸면 lead를 보지 않는다', () => {
    const soon = season('u', '2026-11-10T12:30:00.000', '2026-12-10T12:30:00.000'); // 30분 뒤 시작
    const base = { seasons: [soon], target: soon, now: NOW, policy };
    expect(
      validateSeasonWrite({ ...base, next: { startsAt: at(HOUR_MS - 1), endsAt: soon.endsAt }, changed: { startsAt: true, endsAt: false } }),
    ).toEqual([{ kind: 'invalid', path: 'starts_at', message: expect.any(String) }]);
    expect(
      validateSeasonWrite({ ...base, next: { startsAt: soon.startsAt, endsAt: soon.endsAt }, changed: { startsAt: false, endsAt: false } }),
    ).toEqual([]);
  });

  describe('current', () => {
    const cur = season('c', '2026-11-01T00:00:00.000', '2026-12-01T00:00:00.000');
    const base = { seasons: [cur], target: cur, now: NOW, policy };

    it('starts_at 변경 → not_editable', () => {
      expect(
        validateSeasonWrite({
          ...base,
          next: { startsAt: kst('2026-11-02T00:00:00.000'), endsAt: cur.endsAt },
          changed: { startsAt: true, endsAt: false },
        }),
      ).toEqual([{ kind: 'not_editable', field: 'starts_at' }]);
    });

    it('끝 단축: now + 1h 허용, 그보다 1ms 이르면 invalid(ends_at)', () => {
      // 길이 조건(7일)을 만족하도록 now가 시작 + 9일 이상인 상태
      expect(validateSeasonWrite({ ...base, next: { startsAt: cur.startsAt, endsAt: at(HOUR_MS) }, changed: { startsAt: false, endsAt: true } })).toEqual(
        [],
      );
      expect(
        validateSeasonWrite({ ...base, next: { startsAt: cur.startsAt, endsAt: at(HOUR_MS - 1) }, changed: { startsAt: false, endsAt: true } }),
      ).toEqual([{ kind: 'invalid', path: 'ends_at', message: expect.any(String) }]);
    });

    it('끝 연장 허용, 다음 시즌과 겹치면 overlap', () => {
      const nxt = season('n', '2026-12-01T00:00:00.000', '2027-01-01T00:00:00.000');
      const b = { ...base, seasons: [cur, nxt] };
      expect(validateSeasonWrite({ ...b, next: { startsAt: cur.startsAt, endsAt: nxt.startsAt }, changed: { startsAt: false, endsAt: true } })).toEqual(
        [],
      );
      expect(
        validateSeasonWrite({ ...b, next: { startsAt: cur.startsAt, endsAt: kst('2026-12-05T00:00:00.000') }, changed: { startsAt: false, endsAt: true } }),
      ).toEqual([{ kind: 'overlap', seasonId: 'n' }]);
    });

    it('이름만 바꾸면 []', () => {
      expect(validateSeasonWrite({ ...base, next: { startsAt: cur.startsAt, endsAt: cur.endsAt }, changed: { startsAt: false, endsAt: false } })).toEqual(
        [],
      );
    });
  });

  it('ended·closed 끝 변경 → not_editable', () => {
    const ended = season('e', '2026-10-01T00:00:00.000', '2026-11-01T00:00:00.000');
    const closed = { ...ended, id: 'x', closedAt: kst('2026-11-01T00:01:00.000') };
    for (const t of [ended, closed]) {
      const r = validateSeasonWrite({
        seasons: [t],
        target: t,
        next: { startsAt: t.startsAt, endsAt: kst('2026-11-05T00:00:00.000') },
        changed: { startsAt: false, endsAt: true },
        now: NOW,
        policy,
      });
      expect(r[0]).toEqual({ kind: 'not_editable', field: 'ends_at' });
      expect(r.every((i) => i.kind !== 'overlap')).toBe(true);
    }
  });

  it('반환 순서: not_editable 전부 → invalid 전부 → overlap', () => {
    const ended = season('e', '2026-10-01T00:00:00.000', '2026-11-01T00:00:00.000');
    const other = season('o', '2026-09-01T00:00:00.000', '2026-10-05T00:00:00.000');
    const r = validateSeasonWrite({
      seasons: [ended, other],
      target: ended,
      next: { startsAt: kst('2026-10-02T00:00:00.000'), endsAt: kst('2026-10-04T00:00:00.000') }, // 2일 → 길이 위반, o와 겹침
      changed: { startsAt: true, endsAt: true },
      now: NOW,
      policy,
    });
    expect(r.map((i) => i.kind)).toEqual(['not_editable', 'not_editable', 'invalid', 'overlap']);
    expect(r.slice(0, 2)).toEqual([
      { kind: 'not_editable', field: 'starts_at' },
      { kind: 'not_editable', field: 'ends_at' },
    ]);
  });

  it('잘못된 policy·시각은 RangeError', () => {
    expect(() =>
      validateSeasonWrite({
        seasons: [],
        target: null,
        next: { startsAt: at(DAY_MS), endsAt: at(10 * DAY_MS) },
        changed: { startsAt: true, endsAt: true },
        now: NOW,
        policy: { ...policy, maxLengthMs: 1 },
      }),
    ).toThrow(RangeError);
    expect(() => create(new Date(Number.NaN), at(DAY_MS))).toThrow(RangeError);
  });
});

describe('validateSeasonDelete', () => {
  it('upcoming만 []', () => {
    const s = season('s', '2026-12-01T00:00:00.000', '2027-01-01T00:00:00.000');
    const del = [{ kind: 'not_editable', field: 'delete' }];
    expect(validateSeasonDelete(s, NOW)).toEqual([]);
    expect(validateSeasonDelete(s, s.startsAt)).toEqual(del); // current
    expect(validateSeasonDelete(s, s.endsAt)).toEqual(del); // ended
    expect(validateSeasonDelete({ ...s, closedAt: NOW }, NOW)).toEqual(del); // closed
  });
});
