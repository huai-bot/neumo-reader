import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Ref } from "react";
import type { OpenDoc, OutlineItem } from "../lib/types";
import type { Anchor, ContentWidth, ReadingPosition } from "../lib/state";
import { CONTENT_WIDTHS } from "../lib/state";
import { dirname, extOf } from "../lib/paths";
import { MarkdownView } from "../markdown/MarkdownView";
import { DocumentSearch } from "./DocumentSearch";
import { Lamp } from "./neu";

export interface ReaderHandle {
  focusFind: () => void;
  focusReading: () => void;
  scrollToId: (id: string) => boolean;
  flushPosition: () => void;
  /** 跳到指定阅读位置（悬浮层里翻到的地方） */
  jumpToAnchor: (a: Anchor) => void;
}

interface ReaderProps {
  ref?: Ref<ReaderHandle>;
  doc: OpenDoc;
  fontSize: number;
  contentWidth: ContentWidth;
  renderHtml: boolean;
  autoReload: boolean;
  findOpen: boolean;
  onCloseFind: () => void;
  initialPosition?: ReadingPosition;
  onPosition: (key: string, pos: ReadingPosition) => void;
  onOutline: (items: OutlineItem[]) => void;
  onActiveHeading: (id: string | null) => void;
  onLink: (href: string) => void;
  onFontStep: (delta: number) => void;
}

const PROSE_TEXT = ["txt", "text", ""];
const fmtNum = (n: number) => n.toLocaleString("en-US");
function fmtSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export const Reader = memo(function Reader(props: ReaderProps) {
  const { doc, fontSize, contentWidth, renderHtml, autoReload, initialPosition, ref } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const anchorRef = useRef<Anchor | null>(initialPosition?.anchor ?? null);
  const pinnedRef = useRef(Boolean(initialPosition));
  const headingsRef = useRef<HTMLElement[]>([]);
  const activeHeadingRef = useRef<string | null>(null);
  const live = useRef(props);
  live.current = props;
  const [progress, setProgress] = useState(0);

  const baseDir = useMemo(() => dirname(doc.path), [doc.path]);
  const chars = useMemo(() => doc.content.replace(/\s+/g, "").length, [doc.content]);

  /** 记录视口顶部所在的正文块及块内比例，字号 / 宽度 / 图片加载变化后据此还原 */
  const capture = useCallback((): Anchor | null => {
    const s = scrollRef.current;
    const c = contentRef.current;
    if (!s || !c) return null;
    if (s.scrollTop <= 1) return { i: 0, f: -1 };
    const top = s.getBoundingClientRect().top;
    const kids = c.children;
    let lo = 0;
    let hi = kids.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (kids[mid].getBoundingClientRect().bottom > top + 1) {
        found = mid;
        hi = mid - 1;
      } else lo = mid + 1;
    }
    if (found < 0) return null;
    const r = kids[found].getBoundingClientRect();
    return { i: found, f: r.height > 0 ? (top - r.top) / r.height : 0 };
  }, []);

  const applyAnchor = useCallback((a: Anchor | null) => {
    const s = scrollRef.current;
    const c = contentRef.current;
    if (!s || !c || !a) return false;
    if (a.f <= -1 && a.i === 0) {
      s.scrollTop = 0;
      return true;
    }
    const el = c.children[a.i] as HTMLElement | undefined;
    if (!el) return false;
    const sr = s.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    s.scrollTop = s.scrollTop + (r.top - sr.top) + a.f * r.height;
    return true;
  }, []);

  const report = useCallback(() => {
    const s = scrollRef.current;
    if (!s) return;
    const max = s.scrollHeight - s.clientHeight;
    const ratio = max > 0 ? Math.min(1, Math.max(0, s.scrollTop / max)) : 0;
    setProgress(max > 0 ? ratio : 1);
    const p = live.current;
    p.onPosition(p.doc.key, {
      top: s.scrollTop,
      ratio,
      anchor: anchorRef.current ?? undefined,
      fontSize: p.fontSize,
      width: p.contentWidth,
      updatedAt: Date.now(),
    });
    // 当前章节
    const hs = headingsRef.current;
    let current: string | null = null;
    if (hs.length) {
      const limit = s.getBoundingClientRect().top + 96;
      for (const h of hs) {
        if (h.getBoundingClientRect().top <= limit) current = h.id;
        else break;
      }
      if (!current && ratio >= 0.999) current = hs[hs.length - 1].id;
    }
    if (current !== activeHeadingRef.current) {
      activeHeadingRef.current = current;
      p.onActiveHeading(current);
    }
  }, []);

  const unpin = useCallback(() => {
    pinnedRef.current = false;
  }, []);

  const revealMatch = useCallback((range: Range) => {
    const scroll = scrollRef.current;
    const element = range.startContainer.parentElement;
    if (!scroll || !element) return;
    unpin();
    for (let details = element.closest("details"); details; details = details.parentElement?.closest("details") ?? null) {
      if (!details.open) details.open = true;
    }
    const horizontal = element.closest<HTMLElement>(".md-code pre,.md-table-wrap,.katex-display");
    const rect = range.getBoundingClientRect();
    if (horizontal && horizontal.scrollWidth > horizontal.clientWidth) {
      const box = horizontal.getBoundingClientRect();
      if (rect.left < box.left || rect.right > box.right) horizontal.scrollLeft += rect.left - box.left - 16;
    }
    const viewport = scroll.getBoundingClientRect();
    if (rect.top < viewport.top + 8 || rect.bottom > viewport.bottom - 8) {
      scroll.scrollTop += rect.top - viewport.top - (viewport.height - Math.min(rect.height, viewport.height)) / 2;
    }
    anchorRef.current = capture();
    report();
  }, [capture, report, unpin]);

  useImperativeHandle(
    ref,
    () => ({
      focusFind: () => { findInput.current?.focus(); findInput.current?.select(); },
      focusReading: () => scrollRef.current?.focus({ preventScroll: true }),
      scrollToId: (id: string) => {
        const s = scrollRef.current;
        const c = contentRef.current;
        if (!s || !c) return false;
        const el =
          c.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`) ??
          c.querySelector<HTMLElement>(`[id="${CSS.escape(`user-content-${id}`)}"]`) ??
          c.querySelector<HTMLElement>(`[id="${CSS.escape(id.toLowerCase())}"]`);
        if (!el) return false;
        unpin();
        const top = s.scrollTop + el.getBoundingClientRect().top - s.getBoundingClientRect().top - 12;
        s.scrollTo({ top, behavior: "smooth" });
        return true;
      },
      flushPosition: () => {
        if (!pinnedRef.current) anchorRef.current = capture();
        report();
      },
      jumpToAnchor: (a: Anchor) => {
        unpin();
        anchorRef.current = a;
        applyAnchor(a);
        report();
      },
    }),
    [capture, report, unpin],
  );

  // 大纲
  useLayoutEffect(() => {
    const c = contentRef.current;
    if (!c || doc.kind !== "markdown") {
      headingsRef.current = [];
      props.onOutline([]);
      return;
    }
    const hs = Array.from(c.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"));
    hs.forEach((h, i) => {
      if (!h.id) h.id = `heading-${i}`;
    });
    headingsRef.current = hs;
    props.onOutline(
      hs.map((h) => ({ id: h.id, text: (h.textContent ?? "").trim() || "（无标题）", level: Number(h.tagName[1]) })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.content, doc.kind, renderHtml]);

  // 首次挂载：还原阅读位置
  useLayoutEffect(() => {
    const s = scrollRef.current;
    if (s && initialPosition) {
      if (!applyAnchor(anchorRef.current)) {
        const max = s.scrollHeight - s.clientHeight;
        s.scrollTop = initialPosition.ratio * max;
      }
    }
    report();
    const t = window.setTimeout(unpin, 2500);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 布局变化（字号、宽度、窗口、图片加载、文件刷新）时保持阅读位置
  useEffect(() => {
    const c = contentRef.current;
    if (!c) return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        applyAnchor(anchorRef.current);
        report();
      });
    });
    ro.observe(c);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [applyAnchor, report]);

  // 滚动、交互、Ctrl+滚轮
  useEffect(() => {
    const s = scrollRef.current;
    if (!s) return;
    let frame = 0;
    let lastWheel = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!pinnedRef.current) anchorRef.current = capture();
        report();
      });
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const now = performance.now();
        if (now - lastWheel < 70 || e.deltaY === 0) return;
        lastWheel = now;
        live.current.onFontStep(e.deltaY < 0 ? 1 : -1);
        return;
      }
      unpin();
    };
    const onInteract = () => unpin();
    s.addEventListener("scroll", onScroll, { passive: true });
    s.addEventListener("wheel", onWheel, { passive: false });
    s.addEventListener("pointerdown", onInteract);
    s.addEventListener("keydown", onInteract);
    s.addEventListener("touchstart", onInteract, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      s.removeEventListener("scroll", onScroll);
      s.removeEventListener("wheel", onWheel);
      s.removeEventListener("pointerdown", onInteract);
      s.removeEventListener("keydown", onInteract);
      s.removeEventListener("touchstart", onInteract);
    };
  }, [capture, report, unpin]);

  const seek = (clientX: number, el: HTMLElement) => {
    const s = scrollRef.current;
    if (!s) return;
    const r = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    unpin();
    s.scrollTo({ top: ratio * (s.scrollHeight - s.clientHeight), behavior: "smooth" });
  };

  const ext = extOf(doc.path);
  const pct = Math.round(progress * 100);

  return (
    <div className="reader">
      {props.findOpen && <DocumentSearch inputRef={findInput} contentRef={contentRef} content={doc.content}
        renderHtml={renderHtml} onReveal={revealMatch} onClose={props.onCloseFind} />}
      <div className="reader-scroll" ref={scrollRef} tabIndex={-1}>
        <div
          className="reader-content"
          style={{ fontSize: `${fontSize}px`, maxWidth: CONTENT_WIDTHS[contentWidth] }}
        >
          {doc.kind === "markdown" ? (
            <div className="md" ref={contentRef}>
              <MarkdownView content={doc.content} renderHtml={renderHtml} baseDir={baseDir} onLink={props.onLink} />
            </div>
          ) : (
            <div ref={contentRef}>
              <pre className={`plain-text ${PROSE_TEXT.includes(ext) ? "" : "mono"}`}>{doc.content}</pre>
            </div>
          )}
        </div>
      </div>

      <footer className="statusbar">
        <span className="st-item">
          <Lamp state={doc.missing ? "warn" : autoReload ? "on" : "off"} />
          <span className={doc.missing ? "st-warn" : ""}>{doc.missing ? "文件已被移除或改名" : autoReload ? "同步中" : "未同步"}</span>
        </span>
        <span className="st-item num">{doc.encoding}</span>
        <span className="st-item num">{fmtSize(doc.size)}</span>
        <span className="st-item">
          <span className="num">{fmtNum(chars)}</span>&nbsp;字
        </span>
        <span className="st-spacer" />
        <div
          className="progress"
          role="slider"
          aria-label="阅读进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          title="点击跳转"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            seek(e.clientX, e.currentTarget);
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) {
              const s = scrollRef.current;
              const r = e.currentTarget.getBoundingClientRect();
              if (s) s.scrollTop = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (s.scrollHeight - s.clientHeight);
            }
          }}
        >
          <span className="progress-fill" style={{ transform: `scaleX(${progress})` }} />
        </div>
        <span className="st-pct num">{pct}%</span>
      </footer>
    </div>
  );
});
