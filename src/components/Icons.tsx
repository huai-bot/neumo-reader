import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 20, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconSidebar = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3.5" />
    <path d="M9.5 4.5v15" />
    <path d="M6 8.5h1M6 11.5h1" />
  </Svg>
);
export const IconOpen = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 8V6.5a2 2 0 0 1 2-2h3.6l2 2h7.4a2 2 0 0 1 2 2V9" />
    <path d="M3.2 10.5h17.6l-1.6 7.4a2 2 0 0 1-2 1.6H6.8a2 2 0 0 1-2-1.6z" />
  </Svg>
);
export const IconSettings = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.2v2.2M12 18.6v2.2M3.2 12h2.2M18.6 12h2.2M5.8 5.8l1.5 1.5M16.7 16.7l1.5 1.5M5.8 18.2l1.5-1.5M16.7 7.3l1.5-1.5" />
  </Svg>
);
export const IconMinus = (p: P) => (
  <Svg {...p}>
    <path d="M6 12h12" />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 6v12M6 12h12" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M7 7l10 10M17 7 7 17" />
  </Svg>
);
export const IconWinMin = (p: P) => (
  <Svg {...p}>
    <path d="M7 12.5h10" />
  </Svg>
);
export const IconWinMax = (p: P) => (
  <Svg {...p}>
    <rect x="7" y="7" width="10" height="10" rx="2.5" />
  </Svg>
);
export const IconWinRestore = (p: P) => (
  <Svg {...p}>
    <rect x="6.5" y="9" width="8.5" height="8.5" rx="2.2" />
    <path d="M9.5 6.5h6a2.5 2.5 0 0 1 2.5 2.5v6" />
  </Svg>
);
export const IconFile = (p: P) => (
  <Svg {...p}>
    <path d="M14 3.5H8a2.5 2.5 0 0 0-2.5 2.5v12A2.5 2.5 0 0 0 8 20.5h8a2.5 2.5 0 0 0 2.5-2.5V8z" />
    <path d="M14 3.5V8h4.5M9 12.5h6M9 16h4" />
  </Svg>
);
export const IconList = (p: P) => (
  <Svg {...p}>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <circle cx="4.5" cy="6.5" r=".6" fill="currentColor" />
    <circle cx="4.5" cy="12" r=".6" fill="currentColor" />
    <circle cx="4.5" cy="17.5" r=".6" fill="currentColor" />
  </Svg>
);
export const IconClock = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);
export const IconRefresh = (p: P) => (
  <Svg {...p}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4.5v4h-4" />
  </Svg>
);
