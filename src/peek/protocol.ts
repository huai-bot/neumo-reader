import type { DocKind } from "../lib/fileTypes";
import type { Anchor } from "../lib/state";

/** 悬浮层窗口的 label，需与 src-tauri/src/overlay.rs 一致 */
export const PEEK_LABEL = "overlay";

export const PEEK = {
  /** 主窗口 → 悬浮层：当前文档（null 表示没有打开文件） */
  doc: "peek:doc",
  /** 主窗口 → 悬浮层：显示样式 */
  style: "peek:style",
  /** 主窗口 → 悬浮层：主窗口的阅读位置 */
  anchor: "peek:anchor",
  /** 悬浮层 → 主窗口：悬浮层已加载，请求同步 */
  ready: "peek:ready",
  /** 悬浮层 → 主窗口：在悬浮层里翻到的位置 */
  anchorBack: "peek:anchor-back",
  /** 后端 → 悬浮层：显示状态 */
  visible: "peek:visible",
  /** 后端 → 悬浮层：导航热键 */
  nav: "peek:nav",
} as const;

export interface PeekDoc {
  key: string;
  name: string;
  path: string;
  kind: DocKind;
  content: string;
  renderHtml: boolean;
}

export interface PeekStyle {
  opacity: number;
  fontSize: number;
}

export interface PeekAnchor {
  key: string;
  anchor: Anchor;
}

export interface PeekVisible {
  visible: boolean;
  pinned: boolean;
  interactive: boolean;
}

export interface PeekNav {
  action: "scroll" | "page" | "heading";
  dir: -1 | 1;
  /** scroll：true 为按下，false 为松开 */
  held: boolean;
}
