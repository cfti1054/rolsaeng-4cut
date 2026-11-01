import { describe, expect, it } from 'vitest';
import { tipPosition } from './info-tip';

const desktop = { width: 1440, height: 900 };
const mobile = { width: 390, height: 844 };
const at = (top: number, left: number) => ({ top, bottom: top + 44, left, right: left + 44 });

describe('InfoTip 위치', () => {
  it('공간이 있으면 버튼 아래, 폭 340', () => {
    const p = tipPosition(at(100, 600), desktop, 300, 0);
    expect(p).toMatchObject({ top: 148, width: 340 });
    expect(p.left).toBe(452);
  });
  it('아래가 모자라고 위가 더 크면 위', () => {
    const p = tipPosition(at(700, 600), desktop, 300, 0);
    expect(p.top + 300).toBe(696);
  });
  it('좌우는 화면 안쪽 16px로 자른다', () => {
    expect(tipPosition(at(100, 0), desktop, 100, 0).left).toBe(16);
    expect(tipPosition(at(100, 1396), desktop, 100, 0).left).toBe(1440 - 16 - 340);
  });
  it('좁은 화면은 폭이 100vw − 32px', () => {
    const p = tipPosition(at(100, 300), { width: 320, height: 640 }, 100, 0);
    expect(p.width).toBe(288);
    expect(p.left).toBe(16);
  });
  it('양쪽 다 모자라면 넓은 쪽 + 높이 상한(패널 안 스크롤), 화면을 넘지 않는다', () => {
    const p = tipPosition(at(100, 100), mobile, 2000, 96);
    expect(p.top).toBe(148);
    expect(p.top + p.maxHeight).toBe(844 - 96 - 16);
    const q = tipPosition(at(640, 100), mobile, 2000, 96);
    expect(q.top).toBe(16);
    expect(q.top + q.maxHeight).toBe(636);
  });
  it('버튼이 스크롤로 화면 밖이어도 패널은 화면 안', () => {
    const up = tipPosition({ top: -200, bottom: -156, left: 100, right: 144 }, desktop, 300, 0);
    expect(up.top).toBeGreaterThanOrEqual(0);
    const down = tipPosition({ top: 1200, bottom: 1244, left: 100, right: 144 }, desktop, 300, 0);
    expect(down.top + 300).toBeLessThanOrEqual(900);
  });
  it('모바일 하단 탭 자리만큼 아래 공간이 줄어든다', () => {
    expect(tipPosition(at(560, 100), mobile, 150, 0).top).toBe(608);
    expect(tipPosition(at(560, 100), mobile, 150, 96).top).toBe(406);
  });
});
