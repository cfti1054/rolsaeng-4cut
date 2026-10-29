import type { SVGProps } from 'react';

/** 목업에서 그대로 옮긴 선 아이콘. 색은 currentColor(또는 className의 stroke-*)를 따른다. */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...rest }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...rest,
  };
}

export function SunIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function MoonIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
    </svg>
  );
}

export function HomeIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />
    </svg>
  );
}

export function SwordsIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
      <path d="m13 19 6-6" />
      <path d="m16 16 4 4" />
      <path d="m19 21 2-2" />
      <path d="M9.5 17.5 21 6V3h-3L6.5 14.5" />
      <path d="m11 19-6-6" />
      <path d="m8 16-4 4" />
      <path d="m5 21-2-2" />
    </svg>
  );
}

export function TrophyIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M8 4h8v6a4 4 0 0 1-8 0z" />
      <path d="M8 6H5a3 3 0 0 0 3 5" />
      <path d="M16 6h3a3 3 0 0 1-3 5" />
      <path d="M12 14v4" />
      <path d="M8 21h8" />
    </svg>
  );
}

export function UserIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

export function SlidersIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M4 6h9" />
      <path d="M19 6h1" />
      <circle cx="16" cy="6" r="2.5" />
      <path d="M4 12h3" />
      <path d="M13 12h7" />
      <circle cx="10" cy="12" r="2.5" />
      <path d="M4 18h11" />
      <circle cx="18" cy="18" r="2.5" />
    </svg>
  );
}

export function ShieldIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6z" />
    </svg>
  );
}

export function LogoutIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 17l-5-5 5-5" />
      <path d="M5 12h11" />
    </svg>
  );
}

export function CheckIcon(p: IconProps) {
  return (
    <svg {...base({ strokeWidth: 3, ...p })}>
      <path d="m5 12 5 5 9-10" />
    </svg>
  );
}

export function XIcon(p: IconProps) {
  return (
    <svg {...base({ strokeWidth: 3, ...p })}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function DiscordIcon(p: IconProps) {
  return (
    <svg {...base({ size: 22, ...p })}>
      <path d="M7 5.5c1.6-.7 3.3-1 5-1s3.4.3 5 1c1.8 2.6 2.7 5.6 2.5 9.2-1.5 1.2-3.1 2-4.8 2.5l-1-1.7" />
      <path d="M7 5.5C5.2 8.1 4.3 11.1 4.5 14.7c1.5 1.2 3.1 2 4.8 2.5l1-1.7" />
      <path d="M8 15c2.6 1.2 5.4 1.2 8 0" />
      <circle cx="9.5" cy="11.5" r="1.2" />
      <circle cx="14.5" cy="11.5" r="1.2" />
    </svg>
  );
}

export function AlertIcon(p: IconProps) {
  return (
    <svg {...base(p)}>
      <path d="M12 3 2 20h20z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** 로고 마크(목업 36x36). 채움 색은 토큰 */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 36 36">
      <path d="M11 3h22l-7 30H4z" className="fill-accent" />
      <path d="M15 10h9.5l-1.3 6H19l-2.3 10h-4.6z" className="fill-on-accent" />
    </svg>
  );
}

export function RefreshIcon(p: IconProps) {
  return (
    <svg {...base({ strokeWidth: 2, ...p })}>
      <path d="M20 11a8 8 0 0 0-14.6-4.5L4 8" />
      <path d="M4 3v5h5" />
      <path d="M4 13a8 8 0 0 0 14.6 4.5L20 16" />
      <path d="M20 21v-5h-5" />
    </svg>
  );
}

export function ShieldCheckIcon(p: IconProps) {
  return (
    <svg {...base({ strokeWidth: 1.6, ...p })}>
      <path d="M12 3 4 7v6c0 4.5 3.4 7.4 8 8 4.6-.6 8-3.5 8-8V7z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
