import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { indexDocument, MATCH_PAGE, searchDocument } from "../lib/documentSearch";
import { IconChevron, IconClose } from "./Icons";

interface Props {
  inputRef: RefObject<HTMLInputElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  content: string;
  renderHtml: boolean;
  onReveal: (range: Range) => void;
  onClose: () => void;
}

export function DocumentSearch({ inputRef, contentRef, content, renderHtml, onReveal, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<ReturnType<typeof searchDocument> | null>(null);
  const [active, setActive] = useState(0);
  const index = useRef<ReturnType<typeof indexDocument> | null>(null);

  useLayoutEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, [inputRef]);
  useLayoutEffect(() => { index.current = null; }, [content, renderHtml]);
  useLayoutEffect(() => {
    setActive(0);
    setResult(null);
    if (!query.trim()) return;
    const timer = window.setTimeout(() => {
      if (!contentRef.current) return;
      index.current ??= indexDocument(contentRef.current);
      setResult(searchDocument(index.current, query));
    }, 90);
    return () => window.clearTimeout(timer);
  }, [query, content, renderHtml, contentRef]);

  const count = result?.count ?? 0;
  const page = Math.floor(active / MATCH_PAGE);
  const ranges = useMemo(() => result?.ranges(page) ?? [], [result, page]);
  const current = ranges[active % MATCH_PAGE];

  useLayoutEffect(() => {
    if (!ranges.length || !CSS.highlights) return;
    CSS.highlights.set("find-matches", new Highlight(...ranges));
    return () => { CSS.highlights.delete("find-matches"); };
  }, [ranges]);
  useLayoutEffect(() => {
    if (!current) return;
    onReveal(current);
    if (CSS.highlights) {
      const highlight = new Highlight(current);
      highlight.priority = 1;
      CSS.highlights.set("find-current", highlight);
      return () => { CSS.highlights.delete("find-current"); };
    }
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(current);
    return () => {
      if (selection?.rangeCount && selection.getRangeAt(0) === current) selection.removeRange(current);
    };
  }, [current, onReveal]);

  const step = (direction: number) => {
    if (count > 1) setActive((position) => (position + direction + count) % count);
    else if (current) onReveal(current);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "F3" || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, current, onReveal]);

  return (
    <div className="find-bar" role="search" aria-label="文档内查找">
      <div className="find-entry">
        <input ref={inputRef} value={query} aria-label="查找文档内容" placeholder="查找文档内容"
          autoComplete="off" spellCheck={false} onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            event.preventDefault();
            step(event.shiftKey ? -1 : 1);
          }} />
        <output aria-live="polite" aria-atomic="true" className={count ? "find-count num" : "find-count"}>
          {result && (count ? `${active + 1} / ${count}` : "无匹配")}
        </output>
      </div>
      <button type="button" className="find-btn" disabled={count < 2} aria-label="上一处" title="上一处 (Shift+Enter)" onClick={() => step(-1)}><IconChevron up /></button>
      <button type="button" className="find-btn" disabled={count < 2} aria-label="下一处" title="下一处 (Enter)" onClick={() => step(1)}><IconChevron /></button>
      <button type="button" className="find-btn" aria-label="关闭查找" title="关闭查找 (Esc)" onClick={onClose}><IconClose size={16} /></button>
    </div>
  );
}
