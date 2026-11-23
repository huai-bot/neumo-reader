import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MarkdownView } from "../markdown/MarkdownView";
import { dirname, extOf } from "../lib/paths";
import type { Anchor } from "../lib/state";
import { applyAnchor, captureAnchor } from "../lib/anchor";
import { PEEK } from "./protocol";
import { DEFAULT_HOTKEYS, formatHotkey, formatPair } from "../lib/hotkeys";
import type { PeekAnchor, PeekDoc, PeekNav, PeekStyle, PeekVisible } from "./protocol";

const MAIN = "main";
const PROSE_TEXT = ["txt", "text", ""];
const noop = () => undefined;
/** 按住滚动键超过这个时长后开始连续滚动 */
const HOLD_DELAY = 220;

export default function PeekApp() {
  const [doc, setDoc] = useState<PeekDoc | null>(null);
  const [style, setStyle] = useState<PeekStyle>({ opacity: 0.9, fontSize: 16, hotkeys: DEFAULT_HOTKEYS });
  const [vis, setVis] = useState<PeekVisible>({ visible: false, pinned: false, interactive: false });
  const [section, setSection] = useState("");
  const [pct, setPct] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PeekDoc | null>(null);
  docRef.current = doc;
  const visRef = useRef(vis);
  visRef.current = vis;
  /** 主窗口最近一次的阅读位置 */
  const mainAnchor = useRef<PeekAnchor | null>(null);
  /** 本次显示期间用户是否在悬浮层里翻动过 */
  const dirty = useRef(false);
  const sendTimer = useRef<number | undefined>(undefined);
  const hold = useRef<{ dir: number; timer?: number; frame?: number; last?: number } | null>(null);

  const headings = () => Array.from(contentRef.current?.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6") ?? []);

  /* ---------------- 位置 ---------------- */

  const sendBack = useCallback(() => {
    window.clearTimeout(sendTimer.current);
    const d = docRef.current;
    const a = captureAnchor(scrollRef.current, contentRef.current);
    if (!d || !a) return;
    void emitTo(MAIN, PEEK.anchorBack, { key: d.key, anchor: a } satisfies PeekAnchor);
  }, []);

  const refreshMeta = useCallback(() => {
    const s = scrollRef.current;
    if (!s) return;
    const max = s.scrollHeight - s.clientHeight;
    setPct(max > 0 ? Math.round((s.scrollTop / max) * 100) : 100);
    const limit = s.getBoundingClientRect().top + 40;
    let current = "";
    for (const h of headings()) {
      if (h.getBoundingClientRect().top <= limit) current = (h.textContent ?? "").trim();
      else break;
    }
    setSection(current);
  }, []);

  const applyMain = useCallback(() => {
    const m = mainAnchor.current;
    const d = docRef.current;
    if (!m || !d || m.key !== d.key) return;
    applyAnchor(scrollRef.current, contentRef.current, m.anchor);
    refreshMeta();
  }, [refreshMeta]);

  const onScroll = useCallback(() => {
    refreshMeta();
    if (!visRef.current.visible || !dirty.current) return;
    window.clearTimeout(sendTimer.current);
    sendTimer.current = window.setTimeout(sendBack, 120);
  }, [refreshMeta, sendBack]);

  /* ---------------- 导航 ---------------- */

  const stopHold = useCallback(() => {
    const h = hold.current;
    if (!h) return;
    window.clearTimeout(h.timer);
    if (h.frame) cancelAnimationFrame(h.frame);
    hold.current = null;
  }, []);

  const nav = useCallback(
    (n: PeekNav) => {
      const s = scrollRef.current;
      if (!s) return;
      if (n.action === "scroll") {
        if (!n.held) {
          stopHold();
          return;
        }
        stopHold();
        dirty.current = true;
        s.scrollBy({ top: n.dir * Math.max(60, s.clientHeight * 0.22), behavior: "smooth" });
        const h: NonNullable<typeof hold.current> = { dir: n.dir };
        hold.current = h;
        h.timer = window.setTimeout(() => {
          const speed = 900 * (style.fontSize / 16); // px/s
          const tick = (t: number) => {
            if (hold.current !== h) return;
            const dt = h.last ? Math.min(50, t - h.last) : 16;
            h.last = t;
            s.scrollTop += (h.dir * speed * dt) / 1000;
            h.frame = requestAnimationFrame(tick);
          };
          h.frame = requestAnimationFrame(tick);
        }, HOLD_DELAY);
        return;
      }
      dirty.current = true;
      if (n.action === "page") {
        s.scrollBy({ top: n.dir * (s.clientHeight - 56), behavior: "smooth" });
        return;
      }
      // 上一节 / 下一节
      const top = s.getBoundingClientRect().top;
      const hs = headings();
      if (!hs.length) {
        s.scrollBy({ top: n.dir * (s.clientHeight - 56), behavior: "smooth" });
        return;
      }
      const pos = hs.map((h) => h.getBoundingClientRect().top - top);
      let target: number | undefined;
      if (n.dir > 0) target = pos.find((p) => p > 12);
      else {
        const before = pos.filter((p) => p < -12);
        target = before.length ? before[before.length - 1] : undefined;
      }
      if (target === undefined) {
        s.scrollTo({ top: n.dir > 0 ? s.scrollHeight : 0, behavior: "smooth" });
        return;
      }
      s.scrollTo({ top: s.scrollTop + target - 8, behavior: "smooth" });
    },
    [stopHold, style.fontSize],
  );
  const navRef = useRef(nav);
  navRef.current = nav;

  /* ---------------- 事件 ---------------- */

  useEffect(() => {
    const uns = [
      listen<PeekDoc | null>(PEEK.doc, (e) => setDoc(e.payload)),
      listen<PeekStyle>(PEEK.style, (e) => setStyle(e.payload)),
      listen<PeekAnchor>(PEEK.anchor, (e) => {
        mainAnchor.current = e.payload;
        // 显示期间以悬浮层自己的位置为准
        if (!visRef.current.visible) applyMain();
      }),
      listen<PeekVisible>(PEEK.visible, (e) => {
        const prev = visRef.current;
        const next = e.payload;
        if (prev.visible && !next.visible) {
          stopHold();
          if (dirty.current) sendBack();
          dirty.current = false;
        }
        if (!prev.visible && next.visible) dirty.current = false;
        visRef.current = next;
        setVis(next);
      }),
      listen<PeekNav>(PEEK.nav, (e) => navRef.current(e.payload)),
    ];
    void emitTo(MAIN, PEEK.ready, null);
    return () => uns.forEach((u) => void u.then((f) => f()));
  }, [applyMain, sendBack, stopHold]);

  // 文档或字号变化后回到主窗口的位置
  useLayoutEffect(() => {
    applyMain();
  }, [doc, style.fontSize, applyMain]);

  // 图片加载、窗口缩放等导致布局变化时保持位置
  useEffect(() => {
    const c = contentRef.current;
    if (!c) return;
    let anchor: Anchor | null = null;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (anchor) applyAnchor(scrollRef.current, contentRef.current, anchor);
        refreshMeta();
      });
    });
    const s = scrollRef.current;
    const remember = () => {
      anchor = captureAnchor(s, c);
    };
    s?.addEventListener("scroll", remember, { passive: true });
    ro.observe(c);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      s?.removeEventListener("scroll", remember);
    };
  }, [doc, refreshMeta]);

  /* ---------------- 渲染 ---------------- */

  const halo = style.opacity < 0.97;
  const hk = style.hotkeys;
  const hints = [
    [formatPair(hk.scrollUp, hk.scrollDown), "滚动"],
    [formatPair(hk.pageUp, hk.pageDown), "翻页"],
    [formatPair(hk.prevSection, hk.nextSection), "换节"],
  ].filter(([k]) => k);
  const ext = doc ? extOf(doc.path) : "";
  const win = getCurrentWindow();

  return (
    <div
      className="peek"
      data-interactive={vis.interactive || undefined}
      data-halo={halo || undefined}
      style={{ ["--peek-alpha" as string]: String(style.opacity) }}
    >
      <header
        className="peek-head"
        onPointerDown={(e) => {
          if (vis.interactive && e.button === 0) void win.startDragging();
        }}
      >
        <span className={`peek-dot ${vis.pinned ? "on" : ""}`} title={vis.pinned ? "已固定" : "按住显示"} />
        <span className="peek-title">{doc ? doc.name : "拟物阅读"}</span>
        {section && <span className="peek-sec">{section}</span>}
        <span className="peek-pct num">{doc ? `${pct}%` : ""}</span>
      </header>

      <div
        className="peek-scroll"
        ref={scrollRef}
        onScroll={onScroll}
        onWheel={() => {
          dirty.current = true;
        }}
      >
        <div className="peek-content" style={{ fontSize: `${style.fontSize}px` }}>
          {!doc ? (
            <p className="peek-empty">主窗口还没有打开文件。</p>
          ) : doc.kind === "markdown" ? (
            <div className="md" ref={contentRef}>
              <MarkdownView content={doc.content} renderHtml={doc.renderHtml} baseDir={dirname(doc.path)} onLink={noop} />
            </div>
          ) : (
            <div ref={contentRef}>
              <pre className={`plain-text ${PROSE_TEXT.includes(ext) ? "" : "mono"}`}>{doc.content}</pre>
            </div>
          )}
        </div>
      </div>

      <footer className="peek-foot">
        {vis.interactive ? (
          <span>
            调整模式：拖动标题栏移动，拖右下角缩放
            {hk.adjust && (
              <>
                {" "}
                · <kbd>{formatHotkey(hk.adjust)}</kbd> 退出
              </>
            )}
          </span>
        ) : (
          <span>
            {hints.map(([k, t]) => (
              <span key={t}>
                <kbd>{k}</kbd> {t} ·{" "}
              </span>
            ))}
            轻按 <kbd>{formatHotkey(hk.peek)}</kbd> {vis.pinned ? "取消固定" : "固定"}
          </span>
        )}
      </footer>

      {vis.interactive && (
        <div
          className="peek-grip"
          onPointerDown={(e) => {
            if (e.button === 0) void win.startResizeDragging("SouthEast");
          }}
        />
      )}
    </div>
  );
}
