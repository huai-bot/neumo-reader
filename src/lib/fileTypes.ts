import { extOf } from "./paths";

export type DocKind = "markdown" | "text";

export const MARKDOWN_EXT = ["md", "markdown", "mdown", "mkd", "mkdn", "mdx"];
export const TEXT_EXT = ["txt", "text", "log", "csv", "json", "jsonc", "yaml", "yml", "toml", "ini", "conf", "xml"];

export function docKind(path: string): DocKind {
  return MARKDOWN_EXT.includes(extOf(path)) ? "markdown" : "text";
}
