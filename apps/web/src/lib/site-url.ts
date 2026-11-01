/**
 * Railway 웹 서비스 변수. `process.env.WEB_ORIGIN`처럼 쓰면 빌드 때 빈 값으로 박히므로
 * 실행 중에 읽는다. 값을 바꾸면 컨테이너를 다시 시작하면 된다.
 */
export function webOriginFromEnv(): string | undefined {
  const value = process.env['WEB_ORIGIN']?.trim();
  return value ? value : undefined;
}

/** 공유 미리보기 이미지의 절대 주소 기준. 상대 경로는 이 오리진 뒤에 붙는다. */
export function metadataBaseFrom(input: {
  siteUrl?: string | null;
  forwardedHost?: string | null;
  host?: string | null;
  forwardedProto?: string | null;
}): URL {
  const fromEnv = originOf(input.siteUrl);
  if (fromEnv) return fromEnv;
  const raw = first(input.forwardedHost) || first(input.host);
  if (isHost(raw)) return new URL(`${protoFor(raw, input.forwardedProto)}://${raw}`);
  return new URL('http://localhost:3000');
}

function first(value: string | null | undefined): string {
  return value?.split(',')[0]?.trim() ?? '';
}

function isHost(value: string): boolean {
  return /^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(value);
}

function protoFor(host: string, forwardedProto: string | null | undefined): 'http' | 'https' {
  const proto = first(forwardedProto);
  if (proto === 'http' || proto === 'https') return proto;
  return host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
}

/** `WEB_ORIGIN` 뒤에 사이트 안 경로를 붙여 공유 이미지 주소로 쓴다. */
export function absoluteFromBase(base: URL, path: string): string {
  return new URL(path, base).href;
}

function originOf(value: string | null | undefined): URL | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return new URL(url.origin);
  } catch {
    return null;
  }
}
