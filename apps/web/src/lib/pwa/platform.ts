/**
 * 설치 환경 판별(순수 함수, DOM에 의존하지 않는다). 입력은 호출한 쪽이 navigator·matchMedia에서 읽어 넘긴다.
 *
 * - installed: 이미 홈 화면 앱으로 실행 중(display-mode: standalone 또는 iOS navigator.standalone)
 * - ios-safari: iPhone·iPad의 Safari. 설치 창을 띄울 수 없어 「공유 → 홈 화면에 추가」를 안내한다
 * - ios-other: iOS의 Chrome·인앱 브라우저 등. 이 브라우저에서는 홈 화면 추가가 안 되므로 Safari로 열도록 안내한다
 * - android: Android 브라우저(Chrome·Samsung Internet 등). beforeinstallprompt가 오면 버튼으로 설치한다
 * - desktop / other: 그 밖. 브라우저 메뉴의 설치 항목을 안내한다
 */

export type InstallKind = 'installed' | 'ios-safari' | 'ios-other' | 'android' | 'desktop' | 'other';

export interface InstallEnvInput {
  userAgent: string;
  /** navigator.platform (iPadOS 13+는 MacIntel로 보고된다) */
  platform?: string;
  maxTouchPoints?: number;
  /** matchMedia('(display-mode: standalone)').matches */
  displayStandalone?: boolean;
  /** iOS Safari가 독자적으로 두는 navigator.standalone */
  navigatorStandalone?: boolean;
}

/** iOS 계열 브라우저 중 Safari가 아닌 것과 인앱 브라우저 표식 */
const IOS_NON_SAFARI = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\//i;

export function isIosDevice(input: Pick<InstallEnvInput, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean {
  if (/iPad|iPhone|iPod/i.test(input.userAgent)) return true;
  // iPadOS 13 이후 데스크톱 Safari는 UA에 iPad가 없고 MacIntel + 터치 지원으로 보인다
  return input.platform === 'MacIntel' && (input.maxTouchPoints ?? 0) > 1;
}

export function detectInstallKind(input: InstallEnvInput): InstallKind {
  if (input.displayStandalone || input.navigatorStandalone) return 'installed';
  const ua = input.userAgent;
  if (isIosDevice(input)) {
    const isSafari = /Safari/i.test(ua) && !IOS_NON_SAFARI.test(ua);
    return isSafari ? 'ios-safari' : 'ios-other';
  }
  if (/Android/i.test(ua)) return 'android';
  if (/Windows|Macintosh|X11|Linux/i.test(ua)) return 'desktop';
  return 'other';
}
