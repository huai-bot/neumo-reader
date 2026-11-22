// 改写自 Floral Notepaper (MIT, © Achilng)
import type { Root, Blockquote } from "mdast";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";

const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/;

/** 识别 GitHub 风格提示块：> [!NOTE] ... */
const remarkAlerts: Plugin<[], Root> = () => (tree) => {
  visit(tree, "blockquote", (node: Blockquote) => {
    const first = node.children[0];
    if (first?.type !== "paragraph") return;
    const text = first.children[0];
    if (text?.type !== "text") return;
    const match = text.value.match(ALERT_RE);
    if (!match) return;

    text.value = text.value.slice(match[0].length);
    if (!text.value) {
      first.children.shift();
      if (first.children[0]?.type === "break") first.children.shift();
      if (first.children.length === 0) node.children.shift();
    }

    node.data ??= {};
    node.data.hProperties = {
      ...(node.data.hProperties as Record<string, unknown>),
      "data-alert-type": match[1].toLowerCase(),
    };
  });
};

export default remarkAlerts;
