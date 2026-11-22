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
export const takeStartupFile = () => invoke<string | null>("take_startup_file");
