export type ContentWidth = "narrow" | "medium" | "wide" | "full";
export type SidebarTab = "files" | "outline";

export interface Settings {
  /** 未指定新文件启动时，恢复上次退出时打开的文件与阅读位置 */
  restoreLastSession: boolean;
  /** 跨会话记住每个文件的阅读位置 */
  rememberPositions: boolean;
  autoReload: boolean;
  renderHtml: boolean;
  fontSize: number;
  contentWidth: ContentWidth;
  sidebarCollapsed: boolean;
  sidebarTab: SidebarTab;
}

export interface Anchor {
  /** 正文顶层块元素序号 */
  i: number;
  /** 视口顶部落在该块内的比例（可略小于 0） */
  f: number;
}

export interface ReadingPosition {
  top: number;
  anchor?: Anchor;
  ratio: number;
  fontSize: number;
  width: ContentWidth;
  updatedAt: number;
}

export interface PersistedState {
  version: 1;
  settings: Settings;
  openFiles: string[];
  activeFile: string | null;
  recent: string[];
  positions: Record<string, ReadingPosition>;
}

export const FONT_MIN = 12;
export const FONT_MAX = 32;
export const MAX_RECENT = 12;
export const MAX_POSITIONS = 300;

export const CONTENT_WIDTHS: Record<ContentWidth, string> = {
  narrow: "640px",
  medium: "780px",
  wide: "960px",
  full: "none",
};

export const DEFAULT_SETTINGS: Settings = {
  restoreLastSession: true,
  rememberPositions: true,
  autoReload: true,
  renderHtml: false,
  fontSize: 16,
  contentWidth: "medium",
  sidebarCollapsed: false,
  sidebarTab: "files",
};

export const clampFont = (v: number) => Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(v)));

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function parseState(raw: string | null): PersistedState {
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  const d = isObj(data) ? data : {};
  const s = isObj(d.settings) ? d.settings : {};
  const width = s.contentWidth;
  const settings: Settings = {
    restoreLastSession: bool(s.restoreLastSession, DEFAULT_SETTINGS.restoreLastSession),
    rememberPositions: bool(s.rememberPositions, DEFAULT_SETTINGS.rememberPositions),
    autoReload: bool(s.autoReload, DEFAULT_SETTINGS.autoReload),
    renderHtml: bool(s.renderHtml, DEFAULT_SETTINGS.renderHtml),
    fontSize: typeof s.fontSize === "number" ? clampFont(s.fontSize) : DEFAULT_SETTINGS.fontSize,
    contentWidth:
      width === "narrow" || width === "medium" || width === "wide" || width === "full"
        ? width
        : DEFAULT_SETTINGS.contentWidth,
    sidebarCollapsed: bool(s.sidebarCollapsed, DEFAULT_SETTINGS.sidebarCollapsed),
    sidebarTab: s.sidebarTab === "outline" ? "outline" : "files",
  };
  const positions: Record<string, ReadingPosition> = {};
  if (isObj(d.positions)) {
    for (const [k, v] of Object.entries(d.positions)) {
      if (!isObj(v) || typeof v.top !== "number" || typeof v.ratio !== "number") continue;
      const a = v.anchor;
      positions[k] = {
        top: v.top,
        anchor: isObj(a) && typeof a.i === "number" && typeof a.f === "number" ? { i: a.i, f: a.f } : undefined,
        ratio: v.ratio,
        fontSize: typeof v.fontSize === "number" ? v.fontSize : settings.fontSize,
        width: (typeof v.width === "string" ? v.width : settings.contentWidth) as ContentWidth,
        updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : 0,
      };
    }
  }
  return {
    version: 1,
    settings,
    openFiles: strings(d.openFiles),
    activeFile: typeof d.activeFile === "string" ? d.activeFile : null,
    recent: strings(d.recent).slice(0, MAX_RECENT),
    positions,
  };
}

export function prunePositions(map: Record<string, ReadingPosition>, max = MAX_POSITIONS) {
  const entries = Object.entries(map);
  if (entries.length <= max) return map;
  entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  return Object.fromEntries(entries.slice(0, max));
}
