'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { tipPosition, type TipPosition } from '@/lib/info-tip';
import { InfoIcon } from './icons';

/** 호버가 벗어난 뒤 닫을 때까지(버튼 ↔ 패널 이동 여유) */
const HOVER_CLOSE_MS = 150;
/** md 미만 하단 탭이 차지하는 높이(화면 끝에서 18px + 탭 72px + 여유) */
const MOBILE_TAB_INSET = 96;

/**
 * 설명 패널(계약 19-3, D177). 호버·키보드·터치를 모두 지원하는 공개 패널이다.
 * - 패널 자체만 Tab으로 들어갈 수 있다(D180). 넘치는 내용을 ↑↓로 읽기 위해서다. 패널 안에 다른 포커스 요소는 두지 않는다.
 * - 포커스가 버튼·패널 안에 있으면 닫지 않고, 둘 다 벗어나면 닫는다. Esc는 닫은 뒤 패널에 있던 포커스를 버튼으로 돌린다.
 * - position: fixed라 조상에 transform·filter가 있으면 안 된다.
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  const panelId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinKind = useRef<'key' | 'pointer' | null>(null);
  /** Esc로 버튼에 포커스를 돌릴 때 다시 열리지 않게 한다 */
  const skipFocusOpen = useRef(false);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pos, setPos] = useState<TipPosition | null>(null);
  const open = pinned || hovered || focused;

  const cancelClose = () => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const closeAll = useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    pinKind.current = null;
    setPinned(false);
    setHovered(false);
    setFocused(false);
  }, []);
  useEffect(() => () => cancelClose(), []);

  const place = useCallback(() => {
    const button = buttonRef.current;
    const panel = panelRef.current;
    if (!button || !panel) return;
    const inset = window.matchMedia('(min-width: 768px)').matches ? 0 : MOBILE_TAB_INSET;
    // 높이 상한이 걸린 값이 아니라 내용 전체 높이로 잰다
    setPos(tipPosition(button.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }, panel.scrollHeight, inset));
  }, []);

  useLayoutEffect(() => {
    if (open) place();
    else setPos(null);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (panelRef.current?.contains(document.activeElement)) {
        skipFocusOpen.current = true;
        buttonRef.current?.focus();
        skipFocusOpen.current = false;
      }
      closeAll();
    };
    const onOutsideDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!buttonRef.current?.contains(target) && !panelRef.current?.contains(target)) closeAll();
    };
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      // 키보드 포커스가 안에 있으면 닫지 않고 따라간다(D180)
      if (focused) place();
      else closeAll();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onOutsideDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onOutsideDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [open, focused, closeAll, place]);

  /** 포커스가 버튼·패널 밖으로 나갔을 때. 둘 사이 이동이면 그대로 둔다 */
  const onFocusOut = (e: ReactFocusEvent) => {
    // 창을 떠난 것뿐이면 돌아왔을 때 포커스가 그대로 복구되므로 닫지 않는다
    if (!document.hasFocus()) return;
    const next = e.relatedTarget as Node | null;
    if (next && (buttonRef.current?.contains(next) || panelRef.current?.contains(next))) return;
    setFocused(false);
    if (pinKind.current === 'key') {
      pinKind.current = null;
      setPinned(false);
    }
  };

  const onEnter = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    cancelClose();
    setHovered(true);
  };
  const onLeave = (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    cancelClose();
    closeTimer.current = setTimeout(() => setHovered(false), HOVER_CLOSE_MS);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={panelId}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        onFocus={(e) => {
          // 터치·마우스 포커스로 열면 뒤따르는 클릭이 바로 닫으므로 키보드 포커스만 연다
          if (!skipFocusOpen.current && e.currentTarget.matches(':focus-visible')) setFocused(true);
        }}
        onBlur={onFocusOut}
        onClick={(e) => {
          const next = !pinned;
          setPinned(next);
          // detail 0 = Enter·Space
          pinKind.current = next ? (e.detail === 0 ? 'key' : 'pointer') : null;
          if (!next) closeAll();
        }}
        className="relative -my-3.5 ml-0 inline-flex size-11 items-center justify-center rounded-full align-middle text-faint hover:text-text"
      >
        <InfoIcon size={16} />
      </button>
      <div
        ref={panelRef}
        id={panelId}
        role="region"
        aria-label={label}
        tabIndex={0}
        hidden={!open}
        onFocus={(e) => {
          // 패널 안 마우스 클릭은 키보드 포커스가 아니다. 호버·고정 닫힘 규칙을 그대로 따른다
          if (e.currentTarget.matches(':focus-visible')) setFocused(true);
        }}
        onBlur={onFocusOut}
        onPointerEnter={onEnter}
        onPointerLeave={onLeave}
        style={pos ? { top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight } : { top: 0, left: 0, visibility: 'hidden' }}
        className="fixed z-50 w-[min(340px,calc(100vw-32px))] overflow-y-auto overscroll-contain rounded-2xl border border-line-2 bg-surface-3 p-4 text-left text-[13px] font-normal leading-relaxed text-text-2 shadow-[0_12px_30px_var(--shadow)]"
      >
        {children}
      </div>
    </>
  );
}
