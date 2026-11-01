import { createHash, randomBytes } from 'node:crypto';
import { API_KEY_DISPLAY_PREFIX_LENGTH, API_KEY_PREFIX, API_KEY_RANDOM_BYTES } from '@gcd/shared';

/** 봇 API 키 발급(계약 6-1). raw = `gcd_` + 32바이트 난수 base64url(43자). 원문은 저장하지 않는다 */
export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = API_KEY_PREFIX + randomBytes(API_KEY_RANDOM_BYTES).toString('base64url');
  return {
    raw,
    prefix: raw.slice(API_KEY_PREFIX.length, API_KEY_PREFIX.length + API_KEY_DISPLAY_PREFIX_LENGTH),
    hash: hashApiKey(raw),
  };
}

/** SHA-256 hex */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}
