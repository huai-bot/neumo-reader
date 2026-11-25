import type { DocKind } from "./fileTypes";

export interface OpenDoc {
  key: string;
  path: string;
  name: string;
  content: string;
  modified: number;
  size: number;
  encoding: string;
  revision: string;
  kind: DocKind;
  missing: boolean;
}

export interface OutlineItem {
  id: string;
  text: string;
  level: number;
}

export type ToastTone = "info" | "warn";

export interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
}
