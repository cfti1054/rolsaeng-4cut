import type { Me } from '@gcd/shared';
import { HomeIcon, MegaphoneIcon, SlidersIcon, SwordsIcon, TrophyIcon, UserIcon } from '@/components/ui/icons';
import { routes } from '@/lib/routes';

export interface NavItem {
  key: 'home' | 'scrims' | 'rankings' | 'news' | 'profile' | 'settings';
  /** 모바일 하단 탭에도 두는가(하단 탭은 5칸이 꽉 차 있어 「정보」는 사이드바·모바일 머리에만, 계약 S6 13절) */
  tab: boolean;
  /** 사이드바 표시 이름 */
  label: string;
  /** 하단 탭 표시 이름(좁아서 짧게) */
  tabLabel: string;
  href: string;
  Icon: typeof HomeIcon;
  match: (pathname: string) => boolean;
}

/** 사이드바 MENU와 모바일 하단 탭 5개(계약 9-5, D19)는 같은 목록이다. S6 「정보」는 사이드바에만(tab false) */
export function navItems(me: Pick<Me, 'id'> | undefined): NavItem[] {
  const profile = me ? routes.member(me.id) : null;
  return [
    { key: 'home', label: '홈', tabLabel: '홈', tab: true, href: routes.home(), Icon: HomeIcon, match: (p) => p === '/' },
    {
      key: 'scrims',
      label: '내전/모집',
      tabLabel: '내전/모집',
      tab: true,
      href: routes.scrims(),
      Icon: SwordsIcon,
      match: (p) => p === '/scrims' || p.startsWith('/scrims/'),
    },
    {
      key: 'rankings',
      label: '랭킹',
      tabLabel: '랭킹',
      tab: true,
      href: routes.rankings(),
      Icon: TrophyIcon,
      match: (p) => p === '/rankings',
    },
    {
      key: 'news',
      label: '정보',
      tabLabel: '정보',
      tab: false,
      href: routes.news(),
      Icon: MegaphoneIcon,
      match: (p) => p === '/news',
    },
    {
      key: 'profile',
      label: '내 프로필',
      tabLabel: '프로필',
      tab: true,
      // me를 받기 전에는 링크 대상이 없다 → 홈 대신 비활성처리는 컴포넌트에서
      href: profile ?? '#',
      Icon: UserIcon,
      match: (p) => profile !== null && p === profile,
    },
    {
      key: 'settings',
      label: '설정',
      tabLabel: '설정',
      tab: true,
      href: routes.settings(),
      Icon: SlidersIcon,
      match: (p) => p === '/settings',
    },
  ];
}
