/**
 * 패치노트 자동 등록(사용자 결정 2026-11-01).
 * 공개 패치 번호는 Data Dragon 버전과 다르다(16.21.1 ≠ 26.21).
 * 버전은 한국어 패치노트 목록에 나온 슬러그의 앞 두 숫자이고, 주소는 그 번호로 만든다.
 * 글 본문은 읽지 않는다. 같은 앞 두 자리의 핫픽스는 새 글이 아니다.
 */

export type PatchLine = { major: number; minor: number };

const LOL_SLUG = /league-of-legends-patch-(\d+)-(\d+)-notes(?![0-9A-Za-z-])/;
const TFT_SLUG = /teamfight-tactics-patch-(\d+)-(\d+)(?![0-9A-Za-z-])/;

export function parsePatchLine(version: string): PatchLine | null {
  const m = /^(\d+)\.(\d+)$/.exec(version.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

export function formatPatchLine(line: PatchLine): string {
  return `${line.major}.${line.minor}`;
}

/** 양수면 a가 b보다 새 패치 */
export function comparePatchLine(a: PatchLine, b: PatchLine): number {
  return a.major - b.major || a.minor - b.minor;
}

/** 목록 HTML에서 문서 순서상 첫 슬러그. 최신이 위에 있다는 전제이며, 숫자 최댓값을 고르지 않는다. */
export function firstPatchSlug(text: string, game: 'lol' | 'tft'): PatchLine | null {
  const m = (game === 'lol' ? LOL_SLUG : TFT_SLUG).exec(text);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

export function latestStoredPatchLine(versions: readonly (string | null)[]): PatchLine | null {
  let best: PatchLine | null = null;
  for (const version of versions) {
    if (!version) continue;
    const line = parsePatchLine(version);
    if (!line) continue;
    if (!best || comparePatchLine(line, best) > 0) best = line;
  }
  return best;
}

/**
 * 최신 슬러그와 이미 저장된 version을 비교해 넣을 글을 정한다.
 * 해석되는 version이 없으면 현재 최신 1건, 알림 없음(이미 공개된 패치).
 * 더 새 줄이면 알림을 켠다. 같거나 오래된 줄은 null.
 */
export function planPatchNoteInsert(
  latest: PatchLine | null,
  storedVersions: readonly (string | null)[],
): { version: string; notifyDiscord: boolean } | null {
  if (!latest) return null;
  const best = latestStoredPatchLine(storedVersions);
  if (!best) return { version: formatPatchLine(latest), notifyDiscord: false };
  if (comparePatchLine(latest, best) > 0) return { version: formatPatchLine(latest), notifyDiscord: true };
  return null;
}

export function patchNoteUrl(game: 'lol' | 'tft', line: PatchLine): string {
  if (game === 'lol') {
    return `https://www.leagueoflegends.com/ko-kr/news/game-updates/league-of-legends-patch-${line.major}-${line.minor}-notes/`;
  }
  return `https://teamfighttactics.leagueoflegends.com/ko-kr/news/game-updates/teamfight-tactics-patch-${line.major}-${line.minor}/`;
}

export const PATCH_NOTE_AUTO_TITLE = '패치노트';
export const PATCH_NOTE_AUTO_SUMMARY = '공식 패치노트가 올라왔습니다.';
