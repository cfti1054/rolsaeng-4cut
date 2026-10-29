import { describe, expect, it } from 'vitest';
import {
  buildScrimPatch,
  capacityFloor,
  capacityPips,
  defaultScheduleInputs,
  formatHms,
  isoToKstInputs,
  kstClock,
  kstInputsToIso,
  restrictionText,
  scrimCardAction,
  scrimCardBadge,
  scrimDayLabel,
  scrimDetailBadge,
  scrimNeedLine,
  scrimOptionTags,
  scrimSteps,
  startBlockedReason,
  toPreferredPositions,
} from './scrims';

// 2026-10-28(수) 12:00 KST
const NOW = Date.parse('2026-10-28T03:00:00.000Z');

describe('KST 시각', () => {
  it('날짜 라벨: 오늘·내일·어제·요일(6일 안)·MM.DD (요일)', () => {
    expect(scrimDayLabel('2026-10-28T12:00:00.000Z', NOW)).toBe('오늘'); // 21:00 KST
    expect(scrimDayLabel('2026-10-28T15:30:00.000Z', NOW)).toBe('내일'); // 00:30 KST 다음 날
    expect(scrimDayLabel('2026-10-27T14:00:00.000Z', NOW)).toBe('어제'); // 23:00 KST 27일
    expect(scrimDayLabel('2026-10-31T11:00:00.000Z', NOW)).toBe('토요일');
    expect(scrimDayLabel('2026-11-04T11:00:00.000Z', NOW)).toBe('11.04 (수)');
    expect(kstClock('2026-10-28T12:00:00.000Z')).toBe('21:00');
  });

  it('입력값 ↔ ISO(+09:00), 없는 날짜는 null', () => {
    expect(kstInputsToIso('2026-10-28', '21:00')).toBe('2026-10-28T21:00:00+09:00');
    expect(kstInputsToIso('2026-02-31', '21:00')).toBeNull();
    expect(kstInputsToIso('2026-10-28', '')).toBeNull();
    expect(isoToKstInputs('2026-10-28T15:30:00.000Z')).toEqual({ date: '2026-10-29', time: '00:30' });
  });

  it('작성 기본 시각: 1시간 뒤 이후의 가장 가까운 정각', () => {
    expect(defaultScheduleInputs(NOW)).toEqual({ date: '2026-10-28', time: '13:00' });
    expect(defaultScheduleInputs(NOW + 60_000)).toEqual({ date: '2026-10-28', time: '14:00' });
  });

  it('카운트다운 HH:MM:SS, 하루 이상은 N일', () => {
    expect(formatHms(2 * 3600 + 14 * 60 + 33)).toBe('02:14:33');
    expect(formatHms(-5)).toBe('00:00:00');
    expect(formatHms(86_400 + 61)).toBe('1일 00:01:01');
  });
});

describe('카드 표시', () => {
  const base = {
    status: 'recruiting' as const,
    join_closed: false,
    my_status: null,
    capacity: 10,
    joined_count: 8,
    waitlist_count: 0,
    open_positions: [] as { position: string; count: number }[],
  };

  it('배지: 내 상태 우선, 그다음 status·join_closed', () => {
    expect(scrimCardBadge({ ...base, my_status: 'joined' }).label).toBe('참가 중');
    expect(scrimCardBadge({ ...base, my_status: 'waitlist' }).label).toBe('대기 중');
    expect(scrimCardBadge(base).label).toBe('모집 중');
    expect(scrimCardBadge({ ...base, status: 'full' }).label).toBe('정원 마감');
    expect(scrimCardBadge({ ...base, join_closed: true }).label).toBe('시작 대기');
    expect(scrimCardBadge({ ...base, status: 'playing', my_status: 'joined' }).label).toBe('진행 중');
    expect(scrimCardBadge({ ...base, status: 'cancelled' }).label).toBe('취소됨');
  });

  it('보조 줄: 포지션 구함 / N자리 남음 / 대기 N명 / 정원 마감', () => {
    expect(scrimNeedLine({ ...base, open_positions: [{ position: 'support', count: 1 }, { position: 'jungle', count: 1 }] }).text).toBe(
      '서포터 1 · 정글 1 구함',
    );
    expect(scrimNeedLine(base).text).toBe('2자리 남음');
    expect(scrimNeedLine({ ...base, status: 'full', joined_count: 10, waitlist_count: 2 }).text).toBe('대기 2명');
    expect(scrimNeedLine({ ...base, status: 'full', joined_count: 10 }).text).toBe('정원 마감');
    expect(scrimNeedLine({ ...base, status: 'finished', joined_count: 10 }).text).toBe('참가 10명');
  });

  it('버튼 문구(D91)', () => {
    expect(scrimCardAction(base).label).toBe('참가하기');
    expect(scrimCardAction({ ...base, status: 'full', joined_count: 10 }).label).toBe('대기열 등록');
    expect(scrimCardAction({ ...base, my_status: 'joined' }).label).toBe('참가 중 · 상세 보기');
    expect(scrimCardAction({ ...base, join_closed: true }).label).toBe('상세 보기');
  });

  it('태그·인원 칸', () => {
    expect(scrimOptionTags({ rated: false, auto_balance: true, use_positions: true })).toEqual(['자동 밸런스', '포지션 선택', 'ELO 미반영']);
    expect(capacityPips(2, 4)).toEqual([true, true, false, false]);
  });
});

describe('상세 표시', () => {
  it('진행 단계(계약 6절)', () => {
    expect(scrimSteps('recruiting')).toEqual(['current', 'todo', 'todo', 'todo']);
    expect(scrimSteps('full')).toEqual(['done', 'current', 'todo', 'todo']);
    expect(scrimSteps('playing')).toEqual(['done', 'done', 'current', 'todo']);
    expect(scrimSteps('finished')).toEqual(['done', 'done', 'done', 'done']);
    expect(scrimSteps('cancelled')).toBeNull();
  });

  it('헤더 배지', () => {
    expect(scrimDetailBadge({ status: 'full', join_closed: false }).label).toBe('정원 마감 · 팀 구성 중');
    expect(scrimDetailBadge({ status: 'full', join_closed: true }).label).toBe('시작 대기');
    expect(scrimDetailBadge({ status: 'cancelled', join_closed: true }).label).toBe('취소된 내전');
  });

  it('시작 불가 이유: 고정 정원 / 2명 이상', () => {
    expect(startBlockedReason(6, { min: 2, max: 10, default: 10, step: 2, start_requires_full: true })).toContain('정원 6명');
    expect(startBlockedReason(8, { min: 2, max: 8, default: 8, step: 1, start_requires_full: false })).toContain('2명 이상');
  });

  it('capacityFloor: 참가 인원 이상의 step 간격 값으로 올림', () => {
    const lol = { min: 2, max: 10, default: 10, step: 2, start_requires_full: true };
    expect(capacityFloor(lol, 1)).toBe(2);
    expect(capacityFloor(lol, 4)).toBe(4);
    expect(capacityFloor(lol, 5)).toBe(6);
    expect(capacityFloor({ min: 2, max: 8, default: 8, step: 1, start_requires_full: false }, 5)).toBe(5);
  });

  it('희망 포지션 조립: 1지망 없으면 [], 2지망이 같으면 버림', () => {
    expect(toPreferredPositions(null, 'mid')).toEqual([]);
    expect(toPreferredPositions('mid', 'mid')).toEqual(['mid']);
    expect(toPreferredPositions('mid', 'top')).toEqual(['mid', 'top']);
  });

  it('노쇼 제한 문구(KST MM.DD HH:mm)', () => {
    expect(restrictionText({ restricted: true, until: '2026-11-02T06:00:00.000Z', recent_no_show_count: 3 })).toBe(
      '노쇼 3회로 11.02 15:00까지 내전 참가·모집이 제한돼요.',
    );
    expect(restrictionText({ restricted: false, until: null, recent_no_show_count: 1 })).toBeNull();
  });
});

describe('수정 PATCH 조립', () => {
  const s = {
    title: '화요일 내전',
    scheduled_at: '2026-10-28T12:00:00.000Z',
    capacity: 8,
    rules: null,
    options: { rated: true, auto_balance: true, use_positions: false },
  };
  const same = { title: '화요일 내전', scheduledIso: '2026-10-28T21:00:00+09:00', capacity: 8, rules: '', rated: true, autoBalance: true };
  it('바뀐 게 없으면 null(같은 시각을 +09:00으로 써도 같음)', () => {
    expect(buildScrimPatch(s, same)).toBeNull();
    expect(buildScrimPatch(s, { ...same, title: '  화요일   내전 ' })).toBeNull();
  });
  it('바뀐 필드만, 규칙을 비우면 null', () => {
    expect(buildScrimPatch(s, { ...same, capacity: 6, rated: false })).toEqual({ capacity: 6, rated: false });
    expect(buildScrimPatch({ ...s, rules: '옛 규칙' }, { ...same, rules: '  ' })).toEqual({ rules: null });
    expect(buildScrimPatch(s, { ...same, scheduledIso: '2026-10-28T22:00:00+09:00' })).toEqual({
      scheduled_at: '2026-10-28T22:00:00+09:00',
    });
  });
});
