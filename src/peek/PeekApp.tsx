import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MarkdownView } from "../markdown/MarkdownView";
import { dirname, extOf } from "../lib/paths";
import type { Anchor } from "../lib/state";
import { applyAnchor, captureAnchor } from "../lib/anchor";
import { DEFAULT_HOTKEYS, formatHotkey, formatPair } from "../lib/hotkeys";
import { PEEK } from "./protocol";
import type { PeekAnchor, PeekDoc, PeekNav, PeekStyle, PeekVisible } from "./protocol";
import { buildCards, cardForAnchor, resetCards, showCard } from "./cards";
import type { Card } from "./cards";

const MAIN = "main";
const PROSE_TEXT = ["txt", "text", ""];
const noop = () => undefined;
/** 按住滚动键超过这个时长后开始连续滚动 */
const HOLD_DELAY = 220;
/** 按住偷看超过这个时长才算“看过”，松开后自动翻到下一步 */
const READ_MS = 1000;
/** 回传位置后，忽略主窗口随之报回来的位置，避免卡片被来回改动 */
const ECHO_MS = 1500;

const DEFAULT_STYLE: PeekStyle = {
  opacity: 0.9,
  fontSize: 16,
  hotkeys: DEFAULT_HOTKEYS,
  view: "card",
  split: "step",
  autoAdvance: true,
};

export default function PeekApp() {
  const [doc, setDoc] = useState<PeekDoc | null>(null);
  const [style, setStyle] = useState<PeekStyle>(DEFAULT_STYLE);
  const [vis, setVis] = useState<PeekVisible>({ visible: false, pinned: false, interactive: false });
  const [section, setSection] = useState("");
  const [pct, setPct] = useState(0);
  const [cardIdx, setCardIdx] = useState(0);
  const [cardTotal, setCardTotal] = useState(0);
  const [advanced, setAdvanced] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PeekDoc | null>(null);
  docRef.current = doc;
  const visRef = useRef(vis);
  visRef.current = vis;
  const styleRef = useRef(style);
  styleRef.current = style;
  const cardMode = style.view === "card" && doc?.kind === "markdown";
  const cardModeRef = useRef(cardMode);
  cardModeRef.current = cardMode;

  /** 主窗口最近一次的阅读位置 */
  const mainAnchor = useRef<PeekAnchor | null>(null);
  const ignoreMainUntil = useRef(0);
  /** 本次显示期间用户是否在悬浮层里翻动过 */
  const dirty = useRef(false);
  /** 本次显示期间用户是否手动换过卡片 */
  const navigated = useRef(false);
  const shownAt = useRef(0);
  const pendingAdvanced = useRef(false);
  const sendTimer = useRef<number | undefined>(undefined);
  const hold = useRef<{ dir: number; timer?: number; frame?: number; last?: number } | null>(null);
  const cards = useRef<Card[]>([]);
  const idxRef = useRef(0);
  const anim = useRef<Animation | null>(null);

  const headings = () => Array.from(contentRef.current?.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6") ?? []);

  /* ---------------- 位置 ---------------- */

  const sendBack = useCallback(() => {
    window.clearTimeout(sendTimer.current);
    const d = docRef.current;
    if (!d) return;
    const a: Anchor | null = cardModeRef.current
      ? (cards.current[idxRef.current]?.anchor ?? null)
      : captureAnchor(scrollRef.current, contentRef.current);
    if (!a) return;
    const payload: PeekAnchor = { key: d.key, anchor: a };
    mainAnchor.current = payload;
    ignoreMainUntil.current = performance.now() + ECHO_MS;
    void emitTo(MAIN, PEEK.anchorBack, payload);
  }, []);

  const refreshMeta = useCallback(() => {
    const s = scrollRef.current;
    if (!s) return;
    if (cardModeRef.current) {
      const c = cards.current[idxRef.current];
      setSection(c ? c.title + (c.step ? ` · 第 ${c.step.n}/${c.step.total} 步` : "") : "");
      return;
    }
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

  /** 切换到第 idx 张卡片；dir 为 0 时不播放动画。返回是否真的换了卡片 */
  const go = useCallback(
    (idx: number, dir: number) => {
      const root = contentRef.current;
      const list = cards.current;
      if (!root || !list.length) return false;
      const next = Math.min(list.length - 1, Math.max(0, idx));
      if (dir !== 0 && next === idxRef.current) return false;
      idxRef.current = next;
      setCardIdx(next);
      showCard(root, list, next);
      const s = scrollRef.current;
      if (s) s.scrollTop = 0;
      anim.current?.cancel();
      anim.current = null;
      if (dir !== 0 && typeof root.animate === "function") {
        anim.current = root.animate(
          [
            { opacity: 0, transform: `translateY(${dir * 14}px)` },
            { opacity: 1, transform: "none" },
          ],
          { duration: 240, easing: "cubic-bezier(.34,1.56,.64,1)" },
        );
      }
      refreshMeta();
      return true;
    },
    [refreshMeta],
  );

  const applyMain = useCallback(() => {
    const m = mainAnchor.current;
    const d = docRef.current;
    if (!m || !d || m.key !== d.key) return;
    if (cardModeRef.current) {
      go(cardForAnchor(cards.current, m.anchor), 0);
      return;
    }
    applyAnchor(scrollRef.current, contentRef.current, m.anchor);
    refreshMeta();
  }, [go, refreshMeta]);

  const onScroll = useCallback(() => {
    refreshMeta();
    if (cardModeRef.current || !visRef.current.visible || !dirty.current) return;
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

  const step = useCallback(
    (dir: number) => {
      if (go(idxRef.current + dir, dir)) {
        navigated.current = true;
        dirty.current = true;
        sendBack();
      }
    },
    [go, sendBack],
  );

  const nav = useCallback(
    (n: PeekNav) => {
      const s = scrollRef.current;
      if (!s) return;
      if (n.action === "view") {
        void emitTo(MAIN, PEEK.setView, null);
        return;
      }
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
          const speed = 900 * (styleRef.current.fontSize / 16); // px/s
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

      if (cardModeRef.current) {
        if (n.action === "heading") {
          step(n.dir);
          return;
        }
        // 翻页：卡片内容较长时先在卡片内翻页，翻到头再换卡片
        const atEdge = n.dir > 0 ? s.scrollTop + s.clientHeight >= s.scrollHeight - 2 : s.scrollTop <= 1;
        if (atEdge) step(n.dir);
        else {
          dirty.current = true;
          s.scrollBy({ top: n.dir * (s.clientHeight - 56), behavior: "smooth" });
        }
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
    [stopHold, step],
  );
  const navRef = useRef(nav);
  navRef.current = nav;

  /* ---------------- 事件 ---------------- */

  useEffect(() => {
    const uns = [
      listen<PeekDoc | null>(PEEK.doc, (e) => setDoc(e.payload)),
      listen<PeekStyle>(PEEK.style, (e) => setStyle({ ...DEFAULT_STYLE, ...e.payload })),
      listen<PeekAnchor>(PEEK.anchor, (e) => {
        // 刚回传过位置时，主窗口报回来的是同一个位置，忽略
        if (performance.now() < ignoreMainUntil.current) return;
        mainAnchor.current = e.payload;
        // 显示期间以悬浮层自己的位置为准
        if (!visRef.current.visible) applyMain();
      }),
      listen<PeekVisible>(PEEK.visible, (e) => {
        const prev = visRef.current;
        const next = e.payload;
        if (!prev.visible && next.visible) {
          dirty.current = false;
          navigated.current = false;
          shownAt.current = performance.now();
          if (pendingAdvanced.current) {
            pendingAdvanced.current = false;
            setAdvanced(true);
            window.setTimeout(() => setAdvanced(false), 1600);
          }
        }
        if (prev.visible && !next.visible) {
          stopHold();
          const st = styleRef.current;
          const read = performance.now() - shownAt.current >= READ_MS;
          const canAdvance =
            cardModeRef.current &&
            st.autoAdvance &&
            !prev.pinned &&
            !navigated.current &&
            read &&
            idxRef.current < cards.current.length - 1;
          if (canAdvance) {
            // 按住偷看、看完松开：下次偷看直接显示下一步
            go(idxRef.current + 1, 0);
            pendingAdvanced.current = true;
            sendBack();
          } else if (dirty.current) sendBack();
          dirty.current = false;
        }
        visRef.current = next;
        setVis(next);
      }),
      listen<PeekNav>(PEEK.nav, (e) => navRef.current(e.payload)),
    ];
    void emitTo(MAIN, PEEK.ready, null);
    return () => uns.forEach((u) => void u.then((f) => f()));
  }, [applyMain, go, sendBack, stopHold]);

  // 文档、显示方式、拆分方式、字号变化后：重新拆分卡片，并回到主窗口的位置
  useLayoutEffect(() => {
    const root = contentRef.current;
    // 接下来的滚动是程序跳转，不是用户翻动，不要回传给主窗口
    dirty.current = false;
    if (root && cards.current.length) resetCards(root, cards.current);
    cards.current = [];
    if (!root || !cardMode) {
      setCardTotal(0);
      applyMain();
      refreshMeta();
      return;
    }
    const list = buildCards(root, style.split);
    cards.current = list;
    setCardTotal(list.length);
    if (!list.length) return;
    const m = mainAnchor.current;
    const d = docRef.current;
    const idx = m && d && m.key === d.key ? cardForAnchor(list, m.anchor) : Math.min(idxRef.current, list.length - 1);
    go(idx, 0);
  }, [doc, cardMode, style.split, style.fontSize, applyMain, go, refreshMeta]);

  // 图片加载、窗口缩放等导致布局变化时保持位置（仅全文模式）
  useEffect(() => {
    const c = contentRef.current;
    if (!c) return;
    let anchor: Anchor | null = null;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (anchor && !cardModeRef.current) applyAnchor(scrollRef.current, contentRef.current, anchor);
        refreshMeta();
      });
    });
    const s = scrollRef.current;
    const remember = () => {
      if (!cardModeRef.current) anchor = captureAnchor(s, c);
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
  const ext = doc ? extOf(doc.path) : "";
  const win = getCurrentWindow();
  const hk = style.hotkeys;
  const viewKey = hk.toggleView ? formatHotkey(hk.toggleView) : "";
  const hints = (
    cardMode
      ? [
          [formatPair(hk.prevSection, hk.nextSection), "上一步 / 下一步"],
          [formatPair(hk.scrollUp, hk.scrollDown), "滚动"],
          [viewKey, "看全文"],
        ]
      : [
          [formatPair(hk.scrollUp, hk.scrollDown), "滚动"],
          [formatPair(hk.pageUp, hk.pageDown), "翻页"],
          [formatPair(hk.prevSection, hk.nextSection), "换节"],
          [viewKey, "卡片"],
        ]
  ).filter(([k]) => k);
  const plainInCard = style.view === "card" && doc !== null && doc.kind !== "markdown";
  const counter = !doc ? "" : cardMode && cardTotal ? `${cardIdx + 1} / ${cardTotal}` : `${pct}%`;
  const progress = cardMode && cardTotal ? (cardIdx + 1) / cardTotal : pct / 100;

  return (
    <div
      className="peek"
      data-interactive={vis.interactive || undefined}
      data-halo={halo || undefined}
      data-card={cardMode || undefined}
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
        {(plainInCard || section) && <span className="peek-sec">{plainInCard ? "纯文本只能全文显示" : section}</span>}
        {advanced && <span className="peek-badge">已翻到下一步</span>}
        <span className="peek-pct num">{counter}</span>
        {doc && <span className="peek-bar" style={{ transform: `scaleX(${progress})` }} />}
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
