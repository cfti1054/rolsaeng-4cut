import { describe, expect, it } from 'vitest';
import { detectInstallKind } from './platform';

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.0.0 Mobile/15E148 Safari/604.1';
const IPHONE_KAKAO = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.0.0';
const IPAD_DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; SM-S911N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const WINDOWS_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

describe('detectInstallKind', () => {
  it('iPhone Safari는 ios-safari', () => {
    expect(detectInstallKind({ userAgent: IPHONE_SAFARI })).toBe('ios-safari');
  });

  it('iOS Chrome(CriOS)과 인앱 브라우저는 ios-other(Safari로 열도록 안내)', () => {
    expect(detectInstallKind({ userAgent: IPHONE_CHROME })).toBe('ios-other');
    expect(detectInstallKind({ userAgent: IPHONE_KAKAO })).toBe('ios-other');
  });

  it('iPadOS 데스크톱 모드(MacIntel + 터치)도 iOS로 본다', () => {
    expect(detectInstallKind({ userAgent: IPAD_DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 5 })).toBe('ios-safari');
  });

  it('맥 데스크톱(터치 없음)은 iOS가 아니다', () => {
    expect(detectInstallKind({ userAgent: IPAD_DESKTOP_UA, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('desktop');
  });

  it('Android Chrome은 android (Windows 문자열이 없는 UA)', () => {
    expect(detectInstallKind({ userAgent: ANDROID_CHROME })).toBe('android');
  });

  it('Windows Chrome은 desktop', () => {
    expect(detectInstallKind({ userAgent: WINDOWS_CHROME })).toBe('desktop');
  });

  it('display-mode standalone 또는 iOS navigator.standalone이면 installed가 우선한다', () => {
    expect(detectInstallKind({ userAgent: ANDROID_CHROME, displayStandalone: true })).toBe('installed');
    expect(detectInstallKind({ userAgent: IPHONE_SAFARI, navigatorStandalone: true })).toBe('installed');
  });
});
