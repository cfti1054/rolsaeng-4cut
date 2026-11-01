import { describe, expect, it } from 'vitest';
import { absoluteFromBase, metadataBaseFrom } from './site-url';

describe('공유 미리보기 주소', () => {
  it('WEB_ORIGIN이 있으면 요청 호스트보다 먼저 쓰고, 그 뒤에 카드 경로를 붙인다', () => {
    const base = metadataBaseFrom({
      siteUrl: 'https://web-production-c1e0e.up.railway.app/',
      forwardedHost: 'localhost:8080',
      forwardedProto: 'http',
    });
    expect(base.origin).toBe('https://web-production-c1e0e.up.railway.app');
    expect(absoluteFromBase(base, '/brand/og-card.jpg')).toBe(
      'https://web-production-c1e0e.up.railway.app/brand/og-card.jpg',
    );
  });

  it('프록시가 알려 준 공개 호스트를 쓴다', () => {
    expect(
      metadataBaseFrom({
        forwardedHost: 'web-qa-fa20.up.railway.app',
        forwardedProto: 'https',
        host: 'localhost:8080',
      }).href,
    ).toBe('https://web-qa-fa20.up.railway.app/');
  });

  it('쉼표로 이어진 호스트는 첫 값만 쓴다', () => {
    expect(metadataBaseFrom({ forwardedHost: 'club.example.com, internal', forwardedProto: 'https' }).origin).toBe(
      'https://club.example.com',
    );
  });

  it('로컬 호스트는 http', () => {
    expect(metadataBaseFrom({ host: 'localhost:3000' }).href).toBe('http://localhost:3000/');
  });

  it('호스트가 없으면 환경 주소, 그것도 없으면 로컬', () => {
    expect(metadataBaseFrom({ siteUrl: 'https://club.example.com/app/' }).origin).toBe('https://club.example.com');
    expect(metadataBaseFrom({ host: 'bad host', siteUrl: 'not a url' }).href).toBe('http://localhost:3000/');
  });
});
