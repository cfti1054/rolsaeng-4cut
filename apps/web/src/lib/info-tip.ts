/** InfoTip 패널 위치 계산(순수 함수). 계약 19-3 「위치」 */

export const INFO_TIP_MAX_WIDTH = 340;
const EDGE = 16;
const GAP = 4;

export interface TipPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

/**
 * 버튼 아래가 기본, 패널이 안 들어가는데 위쪽 공간이 더 크면 위. 좌우는 화면 안쪽 16px로 자른다.
 * 높이 상한은 고른 쪽의 쓸 수 있는 공간이다(넘치면 패널 안 스크롤). bottomInset = 모바일 하단 탭 자리.
 */
export function tipPosition(
  anchor: { top: number; bottom: number; left: number; right: number },
  viewport: { width: number; height: number },
  panelHeight: number,
  bottomInset: number,
): TipPosition {
  const width = Math.min(INFO_TIP_MAX_WIDTH, viewport.width - EDGE * 2);
  const center = (anchor.left + anchor.right) / 2;
  const left = Math.max(EDGE, Math.min(center - width / 2, viewport.width - EDGE - width));
  // 스크롤로 버튼이 화면 밖에 있어도 패널은 화면 안에 둔다
  const anchorBottom = Math.max(anchor.bottom, 0);
  const anchorTop = Math.min(anchor.top, viewport.height);
  const below = viewport.height - bottomInset - EDGE - anchorBottom - GAP;
  const above = anchorTop - GAP - EDGE;
  const placeBelow = panelHeight <= below || below >= above;
  const maxHeight = Math.max(0, placeBelow ? below : above);
  const top = placeBelow ? anchorBottom + GAP : anchorTop - GAP - Math.min(panelHeight, maxHeight);
  return { top, left, width, maxHeight };
}
