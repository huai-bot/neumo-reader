import { invoke } from "@tauri-apps/api/core";

export interface TextFile {
  path: string;
  name: string;
  content: string;
  modified: number;
  size: number;
  encoding: string;
}

export interface FileStat {
  exists: boolean;
  modified: number;
  size: number;
}

export const readTextFile = (path: string) => invoke<TextFile>("read_text_file", { path });
export const fileStat = (path: string) => invoke<FileStat>("file_stat", { path });
export const loadState = () => invoke<string | null>("load_state");
export const saveState = (state: string) => invoke<void>("save_state", { state });
export interface AppInfo {
  /** 便携模式：数据保存在软件目录的 data 文件夹 */
  portable: boolean;
  /** 软件目录有 portable.flag 但不可写，已回退到用户目录 */
  portableFailed: boolean;
  dataDir: string;
}

export const appInfo = () => invoke<AppInfo>("app_info");
export const openDataDir = () => invoke<void>("open_data_dir");
export const takeStartupFile = () => invoke<string | null>("take_startup_file");
/** 隐藏主窗口，程序留在托盘 */
export const hideMain = () => invoke<void>("hide_main");
/** 保存窗口状态后退出程序 */
export const quitApp = () => invoke<void>("quit_app");

/* ---------------- 悬浮层 ---------------- */

export interface OverlayStatus {
  available: boolean;
  visible: boolean;
  pinned: boolean;
}

export interface HotkeyReport {
  /** 动作名 → 错误说明 */
  errors: Record<string, string>;
}

export const overlayInit = (hotkeys: Record<string, string>) => invoke<HotkeyReport>("overlay_init", { hotkeys });
export const overlaySetHotkeys = (hotkeys: Record<string, string>) =>
  invoke<HotkeyReport>("overlay_set_hotkeys", { hotkeys });
export const overlaySuspendHotkeys = (suspend: boolean) => invoke<HotkeyReport>("overlay_suspend_hotkeys", { suspend });
export const overlayToggle = () => invoke<void>("overlay_toggle");
export const overlaySetBlur = (enabled: boolean) => invoke<void>("overlay_set_blur", { enabled });
export const overlayStatus = () => invoke<OverlayStatus>("overlay_status");
