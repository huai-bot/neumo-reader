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
export const IconSearch = (props: P) => (
  <Svg {...props}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 4.5 4.5" />
  </Svg>
);
export const IconChevron = ({ up = false }: { up?: boolean }) => (
  <Svg size={16}><path d={up ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></Svg>
);
export const IconEdit = (props: P) => <Svg {...props}><path d="m4 20 4.8-1.1L20 7.7a2.1 2.1 0 0 0-3.7-3.7L5.1 15.2 4 20ZM14.5 5.8l3.7 3.7" /></Svg>;
export const IconSave = (props: P) => <Svg {...props}><path d="M5 4.5h12l3 3v12H4.5v-15ZM8 4.5v5h8v-5M8 19v-6h8v6" /></Svg>;
export const IconUnderline = (props: P) => <Svg {...props}><path d="M7 4v6a5 5 0 0 0 10 0V4M4.5 20h15" /></Svg>;
export const IconHighlight = (props: P) => <Svg {...props}><path d="m7 13 8.5-9 4.5 4.5-9 8.5L7 13Zm1.3 1.5-3.5 3.6 1.6 1.4L10 16M4 21h9" /></Svg>;
export const IconNote = (props: P) => <Svg {...props}><path d="M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v10a1.5 1.5 0 0 1-1.5 1.5h-7L6 21v-3.5H5A1.5 1.5 0 0 1 3.5 16V6A1.5 1.5 0 0 1 5 4.5Z M8 9h8m-8 4h5" /></Svg>;
export const IconTrash = (props: P) => <Svg {...props}><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 10.5v6m4-6v6" /></Svg>;
export const IconCopy = (props: P) => <Svg {...props}><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15.5 5V3.5h-12v13H5"/></Svg>;
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
