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
