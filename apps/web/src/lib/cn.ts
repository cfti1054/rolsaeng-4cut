/** 조건부 클래스 이어 붙이기(의존성 없는 최소 구현). */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
