'use client';

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, Notice } from '@/components/ui/controls';
import { Card, Eyebrow } from '@/components/ui/primitives';
import { getInstallState, promptInstall, subscribeInstall } from '@/lib/pwa/install-store';
import { detectInstallKind, type InstallKind } from '@/lib/pwa/platform';

const SERVER_SNAPSHOT = { deferred: null, installed: false } as const;

/**
 * 설정 「앱으로 설치」 섹션. 기기별로 다르게 동작한다.
 * - 이미 설치됨: 안내만
 * - Android·데스크톱 Chrome 계열(설치 프롬프트 사용 가능): [앱 설치] 버튼이 설치 창을 띄운다
 * - iPhone·iPad Safari: 버튼이 「공유 → 홈 화면에 추가」 단계를 펼쳐 보여 준다(iOS는 자동 설치 API가 없다)
 * - iOS의 다른 브라우저·인앱 브라우저: Safari로 열어야 한다고 안내한다
 * - 프롬프트를 못 받은 Android·데스크톱: 브라우저 메뉴의 설치 항목을 안내한다
 */
export function AppInstallSection() {
  // 기기 판별은 브라우저에서만 가능하므로 마운트 후에 정한다(서버 렌더와 어긋나지 않게)
  const [kind, setKind] = useState<InstallKind | null>(null);
  const [showIosSteps, setShowIosSteps] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const install = useSyncExternalStore(subscribeInstall, getInstallState, () => SERVER_SNAPSHOT);

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    setKind(
      detectInstallKind({
        userAgent: nav.userAgent,
        platform: nav.platform,
        maxTouchPoints: nav.maxTouchPoints,
        displayStandalone: window.matchMedia('(display-mode: standalone)').matches,
        navigatorStandalone: nav.standalone === true,
      }),
    );
  }, []);

  const installed = install.installed || kind === 'installed';
  const canPrompt = install.deferred !== null;

  const onInstall = async () => {
    const result = await promptInstall();
    if (result === 'dismissed') setDismissed(true);
  };

  let body: ReactNode = null;
  if (kind === null) {
    body = null;
  } else if (installed) {
    body = <Notice tone="info" title="이미 앱으로 설치되어 있어요">홈 화면의 롤생네컷 아이콘으로 실행 중이에요.</Notice>;
  } else if (canPrompt) {
    body = (
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] leading-relaxed text-muted">홈 화면에 아이콘을 추가하고 주소 입력 없이 바로 실행할 수 있어요.</p>
        <div>
          <Button variant="primary" size="lg" onClick={() => void onInstall()}>
            앱 설치
          </Button>
        </div>
      </div>
    );
  } else if (kind === 'ios-safari') {
    body = (
      <div className="flex flex-col gap-3">
        <p className="m-0 text-[13px] leading-relaxed text-muted">
          iPhone·iPad는 버튼으로 바로 설치할 수 없어요. 아래 순서대로 홈 화면에 추가해 주세요.
        </p>
        <div>
          <Button variant="primary" size="lg" aria-expanded={showIosSteps} onClick={() => setShowIosSteps((v) => !v)}>
            {showIosSteps ? '안내 닫기' : '홈 화면에 추가 방법 보기'}
          </Button>
        </div>
        {showIosSteps && (
          <ol className="m-0 flex flex-col gap-2 pl-5 text-sm leading-relaxed text-text">
            <li>
              Safari 하단의 <b>공유</b> 버튼(상자에서 위 화살표가 나오는 아이콘)을 누르세요.
            </li>
            <li>
              목록에서 <b>홈 화면에 추가</b>를 고르세요.
            </li>
            <li>
              오른쪽 위 <b>추가</b>를 누르면 홈 화면에 아이콘이 생겨요.
            </li>
          </ol>
        )}
      </div>
    );
  } else if (kind === 'ios-other') {
    body = (
      <Notice tone="warn" title="Safari에서 열어야 설치할 수 있어요">
        지금 브라우저(Chrome·인앱 브라우저 등)에서는 홈 화면 추가가 안 돼요. 주소를 Safari로 열어 다시 시도해 주세요.
      </Notice>
    );
  } else {
    // Android·데스크톱인데 설치 프롬프트를 못 받은 경우(아직 조건 미충족, 이전에 닫음, 인앱 브라우저 등)
    body = (
      <Notice tone="info" title={dismissed ? '설치를 취소했어요' : '브라우저 메뉴에서 설치할 수 있어요'}>
        {kind === 'desktop'
          ? '주소창 오른쪽의 설치 아이콘, 또는 브라우저 메뉴의 「앱 설치」를 선택해 주세요.'
          : '브라우저 메뉴(⋮)에서 「앱 설치」 또는 「홈 화면에 추가」를 선택해 주세요.'}
      </Notice>
    );
  }

  return (
    <Card aria-labelledby="app-install-title">
      <div className="flex flex-col gap-1">
        <Eyebrow>APP</Eyebrow>
        <h2 id="app-install-title" className="m-0 text-lg font-bold">
          앱으로 설치
        </h2>
      </div>
      {body}
    </Card>
  );
}
