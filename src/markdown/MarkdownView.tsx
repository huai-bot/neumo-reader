// Markdown 渲染管线改写自 Floral Notepaper (MIT, © Achilng)，去除了编辑相关逻辑。
import { memo, useCallback, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
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

function CodeBlock({ children, language }: { children: ReactNode; language: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    void navigator.clipboard.writeText(extractText(children).replace(/\n$/, "")).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }, [children]);
  return (
    <div className={`md-code ${language ? "has-lang" : ""}`}>
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
  renderHtml: boolean;
  baseDir: string;
  onLink: (href: string) => void;
}

export const MarkdownView = memo(function MarkdownView({ content, renderHtml, baseDir, onLink }: MarkdownViewProps) {
  const components = useMemo<Components>(
    () => ({
      pre: ({ children }) => {
        let language = "";
        if (children != null && typeof children === "object" && "props" in (children as ReactElement)) {
          const cls = (children as ReactElement<{ className?: string }>).props.className;
          language = cls?.match(/language-(\S+)/)?.[1] ?? "";
        }
        if (language === "math") return <pre>{children}</pre>;
        return <CodeBlock language={language}>{children}</CodeBlock>;
      },
      blockquote: ({ children, node }) => {
        const props = (node?.properties ?? {}) as Record<string, unknown>;
        const type = String(props.dataAlertType ?? props["data-alert-type"] ?? "");
        if (type) {
          return (
            <div className={`md-alert md-alert-${type}`} role="note">
              <p className="md-alert-title">{ALERT_TITLES[type] ?? type.toUpperCase()}</p>
              {children}
            </div>
          );
        }
        return <blockquote>{children}</blockquote>;
      },
      a: ({ href, children, title }) => (
        <a
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
      img: ({ src, alt, title, width, height }) => (
        <img src={resolveImageSrc(src, baseDir)} alt={alt ?? ""} title={title} width={width} height={height} />
      ),
      table: ({ children }) => (
        <div className="md-table-wrap">
          <table>{children}</table>
        </div>
      ),
      input: ({ type, checked }) =>
        type === "checkbox" ? <input type="checkbox" className="md-task" checked={Boolean(checked)} readOnly disabled /> : null,
    }),
    [baseDir, onLink],
  );

  return (
    <Markdown remarkPlugins={remarkPlugins} rehypePlugins={renderHtml ? rehypeWithHtml : rehypeDefault} components={components}>
      {content}
    </Markdown>
  );
});
