// Markdown 渲染管线改写自 Floral Notepaper (MIT, © Achilng)，去除了编辑相关逻辑。
import { memo, useCallback, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import type { Root, Element as HastElement } from "hast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import { convertFileSrc } from "@tauri-apps/api/core";
import "katex/dist/katex.min.css";
import remarkAlerts from "./remarkAlerts";
import { resolvePath } from "../lib/paths";

type RehypePlugins = NonNullable<Parameters<typeof Markdown>[0]["rehypePlugins"]>;

const remarkPlugins = [remarkGfm, remarkMath, remarkAlerts];
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "mark", "center", "font", "u", "abbr"],
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "style", "className", "data-alert-type", "dataAlertType"],
    font: ["color", "size", "face"],
    abbr: ["title"],
  },
};
const rehypeDefault: RehypePlugins = [rehypeKatex, rehypeSlug];
const rehypeWithHtml: RehypePlugins = [rehypeRaw, [rehypeSanitize, sanitizeSchema], rehypeKatex, rehypeSlug];
const sourcePositions: Plugin<[], Root> = () => (tree, file) => {
  const source = String(file);
  const extraByLine = [0];
  if (source.includes("\r\n")) {
    let extra = 0;
    for (const lineEnd of source.matchAll(/\r\n|[\r\n]/g)) extraByLine.push(extra += lineEnd[0].length - 1);
  }
  visit(tree, "element", (node) => {
    const { start, end } = node.position ?? {};
    if (start?.offset !== undefined && end?.offset !== undefined) {
      node.properties.dataSourcePos = `${start.offset - (extraByLine[start.line - 1] ?? 0)}:${end.offset - (extraByLine[end.line - 1] ?? 0)}`;
    }
  });
};
const mappedMarkdown: RehypePlugins = [...rehypeDefault, sourcePositions];
const mappedHtml: RehypePlugins = [...rehypeWithHtml, sourcePositions];
const sourcePos = (node?: HastElement) => typeof node?.properties.dataSourcePos === "string" ? node.properties.dataSourcePos : undefined;

const ALERT_TITLES: Record<string, string> = {
  note: "备注",
  tip: "提示",
  important: "重要",
  warning: "警告",
  caution: "注意",
};

function extractText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    return extractText((node as ReactElement<{ children?: ReactNode }>).props.children);
  }
  return "";
}

function CodeBlock({ children, language, position }: { children: ReactNode; language: string; position?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(extractText(children).replace(/\n$/, "")).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }, [children]);
  return (
    <div className={`md-code ${language ? "has-lang" : ""}`} data-source-pos={position}>
      <pre>{children}</pre>
      {language && <span className="md-code-lang">{language}</span>}
      <button type="button" className={`md-copy ${copied ? "is-done" : ""}`} onClick={copy}>
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  );
}

function resolveImageSrc(src: unknown, baseDir: string): string | undefined {
  if (typeof src !== "string" || !src) return undefined;
  if (/^(https?:|data:|blob:|asset:)/i.test(src) || src.startsWith("http://asset.localhost")) return src;
  let raw = src.replace(/^file:\/\//i, "").replace(/^\/([a-zA-Z]:)/, "$1");
  try {
    raw = decodeURI(raw);
  } catch {
    /* 保留原值 */
  }
  return convertFileSrc(resolvePath(baseDir, raw));
}

interface MarkdownViewProps {
  content: string;
  trackSource?: boolean;
  renderHtml: boolean;
  baseDir: string;
  onLink: (href: string) => void;
}

export const MarkdownView = memo(function MarkdownView({ content, renderHtml, baseDir, onLink, trackSource }: MarkdownViewProps) {
  const components = useMemo<Components>(
    () => ({
      pre: ({ children, node }) => {
        let language = "";
        if (children != null && typeof children === "object" && "props" in (children as ReactElement)) {
          const cls = (children as ReactElement<{ className?: string }>).props.className;
          language = cls?.match(/language-(\S+)/)?.[1] ?? "";
        }
        if (language === "math") return <pre data-source-pos={sourcePos(node)}>{children}</pre>;
        return <CodeBlock language={language} position={sourcePos(node)}>{children}</CodeBlock>;
      },
      blockquote: ({ children, node }) => {
        const props = (node?.properties ?? {}) as Record<string, unknown>;
        const type = String(props.dataAlertType ?? props["data-alert-type"] ?? "");
        if (type) {
          return (
            <div className={`md-alert md-alert-${type}`} role="note" data-source-pos={sourcePos(node)}>
              <p className="md-alert-title">{ALERT_TITLES[type] ?? type.toUpperCase()}</p>
              {children}
            </div>
          );
        }
        return <blockquote data-source-pos={sourcePos(node)}>{children}</blockquote>;
      },
      a: ({ href, children, title, node }) => (
        <a
          data-source-pos={sourcePos(node)}
          href={href}
          title={title ?? href}
          onClick={(e) => {
            e.preventDefault();
            if (href) onLink(href);
          }}
        >
          {children}
        </a>
      ),
      img: ({ src, alt, title, width, height, node }) => (
        <img src={resolveImageSrc(src, baseDir)} alt={alt ?? ""} title={title} width={width} height={height} data-source-pos={sourcePos(node)} />
      ),
      table: ({ children, node }) => (
        <div className="md-table-wrap" data-source-pos={sourcePos(node)}>
          <table>{children}</table>
        </div>
      ),
      input: ({ type, checked }) =>
        type === "checkbox" ? <input type="checkbox" className="md-task" checked={Boolean(checked)} readOnly disabled /> : null,
    }),
    [baseDir, onLink],
  );

  const plugins = trackSource ? (renderHtml ? mappedHtml : mappedMarkdown) : (renderHtml ? rehypeWithHtml : rehypeDefault);
  return (
    <Markdown remarkPlugins={remarkPlugins} rehypePlugins={plugins} components={components}>
      {content}
    </Markdown>
  );
});
