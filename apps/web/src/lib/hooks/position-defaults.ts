'use client';

import type { GameCode } from '@gcd/shared';
import { useEffect, useRef, useState } from 'react';
import { positionSuggestionFill, positionSuggestionHint } from '@/lib/scrims';
import { usePositionSuggestions } from './scrims';

/**
 * 작성 폼·상세 참가 영역의 1지망·2지망 기본 선택(계약 S4 20-5, D192).
 * 사용자가 고르면 touch(), 게임을 바꾸면 reset()을 부른다. 건드린 뒤 도착한 추천은 쓰지 않는다.
 */
export function usePositionDefaults(o: {
  game: GameCode | null;
  /** 요청 여부(포지션 받는 게임일 때만) */
  enabled: boolean;
  /** 지금 채워도 되는 상태(포지션 사용 중, 신청 전 등) */
  eligible: boolean;
  allowed: readonly string[];
  first: string | null;
  second: string | null;
  fill: (first: string, second: string | null) => void;
}) {
  const q = usePositionSuggestions(o.game, o.enabled);
  const [touched, setTouched] = useState(false);
  const [filled, setFilled] = useState<{ game: GameCode; sampleSize: number } | null>(null);
  const fillRef = useRef(o.fill);
  fillRef.current = o.fill;

  const next = positionSuggestionFill({
    eligible: o.eligible,
    touched,
    game: o.game,
    allowed: o.allowed,
    first: o.first,
    second: o.second,
    suggestion: q.data,
  });
  const game = o.game;
  const nextFirst = next?.first ?? null;
  const nextSecond = next?.second ?? null;
  const nextSample = next?.sampleSize ?? 0;
  useEffect(() => {
    if (nextFirst === null || !game) return;
    fillRef.current(nextFirst, nextSecond);
    setFilled({ game, sampleSize: nextSample });
  }, [nextFirst, nextSecond, nextSample, game]);

  return {
    hint: filled && !touched && o.eligible && filled.game === o.game ? positionSuggestionHint(filled.sampleSize) : null,
    touch: () => setTouched(true),
    reset: () => {
      setTouched(false);
      setFilled(null);
    },
  };
}
