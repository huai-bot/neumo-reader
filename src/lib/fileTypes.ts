import { extOf } from "./paths";

export type DocKind = "markdown" | "text";

export const MARKDOWN_EXT = ["md", "markdown", "mdown", "mkd", "mkdn", "mdx"];
export const TEXT_EXT = ["txt", "text", "log", "csv", "json", "jsonc", "yaml", "yml", "toml", "ini", "conf", "xml"];

export function docKind(path: string): DocKind {
  return MARKDOWN_EXT.includes(extOf(path)) ? "markdown" : "text";
}

export function extLabel(path: string): string {
  const ext = extOf(path);
  if (!ext) return "TXT";
  if (MARKDOWN_EXT.includes(ext)) return "MD";
  return ext.slice(0, 4).toUpperCase();
}
