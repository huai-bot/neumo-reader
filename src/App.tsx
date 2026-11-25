import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { emitTo, listen } from "@tauri-apps/api/event";
import { message as messageDialog, open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { Reader } from "./components/Reader";
import type { ReaderHandle } from "./components/Reader";
import { SettingsPanel } from "./components/SettingsPanel";
import { Toasts } from "./components/Toasts";
import { NeuButton, Lamp } from "./components/neu";
import { IconOpen } from "./components/Icons";
import {
  appInfo,
  fileStat,
  hideMain,
  loadState,
  overlayInit,
  overlaySetBlur,
  overlaySetHotkeys,
  overlaySuspendHotkeys,
  quitApp,
  readTextFile,
  saveState,
  takeStartupFile,
} from "./lib/api";
import { PEEK, PEEK_LABEL } from "./peek/protocol";
import type { PeekAnchor, PeekDoc, PeekStyle } from "./peek/protocol";
import type { TextFile } from "./lib/api";
import { basename, dirname, extOf, pathKey, resolvePath } from "./lib/paths";
import { docKind, MARKDOWN_EXT, TEXT_EXT } from "./lib/fileTypes";
import type { OpenDoc, OutlineItem } from "./lib/types";
import type { PersistedState, ReadingPosition, Settings } from "./lib/state";
import { clampFont, CONTENT_WIDTHS, DEFAULT_SETTINGS, MAX_RECENT, parseState, prunePositions } from "./lib/state";
import { isDirty, useEditor } from "./lib/useEditor";
import { useToasts } from "./lib/useToasts";
import { effectiveHotkeys } from "./lib/hotkeys";

const toDoc = (f: TextFile): OpenDoc => ({
  key: pathKey(f.path),
  path: f.path,
  name: f.name,
  content: f.content,
  modified: f.modified,
  size: f.size,
  encoding: f.encoding,
  revision: f.revision,
  kind: docKind(f.path),
  missing: false,
});

function mergeRecent(prev: string[], paths: string[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of [...[...paths].reverse(), ...prev]) {
    const k = pathKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out.slice(0, MAX_RECENT);
}

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "未知错误");

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [docs, setDocs] = useState<OpenDoc[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [findKey, setFindKey] = useState<string | null>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [activeHeading, setActiveHeading] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const { toasts, pushToast } = useToasts();

  const positionsRef = useRef<Record<string, ReadingPosition>>({});
  const readerRef = useRef<ReaderHandle>(null);
  const pendingHash = useRef<{ key: string; id: string } | null>(null);
  const persistTimer = useRef<number | undefined>(undefined);
  const live = useRef({ settings, docs, activeKey, recent, settingsOpen });
  live.current = { settings, docs, activeKey, recent, settingsOpen };

  const activeDoc = docs.find((d) => d.key === activeKey) ?? null;
  const editor = useEditor((key, saved) => setDocs((items) => items.map((item) => item.key === key ? toDoc(saved) : item)));
  const { current: editingDocs, leave: leaveEditor } = editor;
  const draft = activeDoc ? editor.drafts[activeDoc.key] : undefined;
  const toggleEditor = () => {
    if (!activeDoc || settingsOpen) return;
    if (draft) void leaveEditor(activeDoc.key);
    else { readerRef.current?.flushPosition(); setFindKey(null); editor.begin(activeDoc); }
  };
  const findOpen = !!activeDoc && findKey === activeDoc.key;
  const closeFind = useCallback(() => {
    setFindKey(null);
    readerRef.current?.focusReading();
  }, []);
  const openFind = () => {
    if (!activeDoc || settingsOpen || draft) return;
    if (findOpen) readerRef.current?.focusFind();
    else setFindKey(activeDoc.key);
  };

  /* ---------------- 持久化 ---------------- */

  const buildState = useCallback((): PersistedState => {
    readerRef.current?.flushPosition();
    const { settings: s, docs: ds, activeKey: ak, recent: rc } = live.current;
    let positions = positionsRef.current;
    if (!s.rememberPositions) {
      const keep = new Set(ds.map((d) => d.key));
      positions = Object.fromEntries(Object.entries(positions).filter(([k]) => keep.has(k)));
    }
    positions = prunePositions(positions);
    positionsRef.current = positions;
    return {
      version: 1,
      settings: s,
      openFiles: ds.map((d) => d.path),
      activeFile: ds.find((d) => d.key === ak)?.path ?? null,
      recent: rc,
      positions,
    };
  }, []);

  const flushPersist = useCallback(async () => {
    window.clearTimeout(persistTimer.current);
    try {
      await saveState(JSON.stringify(buildState()));
    } catch (e) {
      console.error("保存状态失败", e);
    }
  }, [buildState]);

  const schedulePersist = useCallback(() => {
    window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => void flushPersist(), 600);
  }, [flushPersist]);

  useEffect(() => {
    if (ready) schedulePersist();
  }, [ready, settings, docs, activeKey, recent, schedulePersist]);

  /* ---------------- 悬浮层同步 ---------------- */

  const peekAnchor = useRef<PeekAnchor | null>(null);
  const peekTimer = useRef<number | undefined>(undefined);

  const peekDocOf = (d: OpenDoc | null, renderHtml: boolean): PeekDoc | null =>
    d ? { key: d.key, name: d.name, path: d.path, kind: d.kind, content: d.content, renderHtml } : null;
  const peekStyleOf = (s: Settings): PeekStyle => ({
    opacity: s.overlayOpacity,
    fontSize: s.overlayFontSize,
    hotkeys: effectiveHotkeys(s),
    view: s.overlayView,
    split: s.overlayCardSplit,
    autoAdvance: s.overlayAutoAdvance,
  });

  /* 热键：注册 / 暂停按顺序执行，避免录制结束与应用新热键交错 */
  const [hotkeyErrors, setHotkeyErrors] = useState<Record<string, string>>({});
  const hotkeysReady = useRef(false);
  const hotkeyQueue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueueHotkeys = useCallback((task: () => Promise<{ errors: Record<string, string> } | void>) => {
    hotkeyQueue.current = hotkeyQueue.current
      .then(task)
      .then((r) => {
        if (r) setHotkeyErrors(r.errors);
      })
      .catch((e) => console.error("热键", e));
  }, []);
  const onHotkeyRecording = useCallback(
    (recording: boolean) => {
      if (!hotkeysReady.current) return;
      if (recording) enqueueHotkeys(async () => void (await overlaySuspendHotkeys(true)));
      else {
        enqueueHotkeys(async () => void (await overlaySuspendHotkeys(false)));
        enqueueHotkeys(() => overlaySetHotkeys(effectiveHotkeys(live.current.settings)));
      }
    },
    [enqueueHotkeys],
  );

  const sendPeekAnchor = useCallback(() => {
    window.clearTimeout(peekTimer.current);
    if (peekAnchor.current) void emitTo(PEEK_LABEL, PEEK.anchor, peekAnchor.current).catch(() => undefined);
  }, []);

  const onPosition = useCallback(
    (key: string, pos: ReadingPosition) => {
      positionsRef.current[key] = pos;
      schedulePersist();
      if (pos.anchor) {
        peekAnchor.current = { key, anchor: pos.anchor };
        window.clearTimeout(peekTimer.current);
        peekTimer.current = window.setTimeout(sendPeekAnchor, 100);
      }
    },
    [schedulePersist, sendPeekAnchor],
  );

  useEffect(() => {
    void emitTo(PEEK_LABEL, PEEK.doc, peekDocOf(activeDoc, settings.renderHtml)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDoc?.key, activeDoc?.content, activeDoc?.name, settings.renderHtml]);

  useEffect(() => {
    void emitTo(PEEK_LABEL, PEEK.style, peekStyleOf(settings)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    settings.overlayOpacity,
    settings.overlayFontSize,
    settings.hotkeys,
    settings.hotkeyEnabled,
    settings.overlayView,
    settings.overlayCardSplit,
    settings.overlayAutoAdvance,
  ]);

  useEffect(() => {
    if (hotkeysReady.current) enqueueHotkeys(() => overlaySetHotkeys(effectiveHotkeys(settings)));
  }, [settings.hotkeys, settings.hotkeyEnabled, enqueueHotkeys]);

  useEffect(() => {
    if (ready) void overlaySetBlur(settings.overlayBlur).catch(() => undefined);
  }, [ready, settings.overlayBlur]);

  useEffect(() => {
    const uns = [
      // 悬浮层加载完成后补发一次当前状态
      listen(PEEK.ready, () => {
        const { docs: ds, activeKey: ak, settings: s } = live.current;
        void emitTo(PEEK_LABEL, PEEK.doc, peekDocOf(ds.find((d) => d.key === ak) ?? null, s.renderHtml));
        void emitTo(PEEK_LABEL, PEEK.style, peekStyleOf(s));
        void overlaySetBlur(s.overlayBlur).catch(() => undefined);
        sendPeekAnchor();
      }),
      // 在悬浮层里翻到哪，主窗口就跟到哪
      listen<PeekAnchor>(PEEK.anchorBack, (e) => {
        if (e.payload.key === live.current.activeKey) readerRef.current?.jumpToAnchor(e.payload.anchor);
      }),
      // 悬浮层热键：切换全文 / 卡片
      listen(PEEK.setView, () => {
        setSettings((s) => {
          const next: Settings = { ...s, overlayView: s.overlayView === "card" ? "scroll" : "card" };
          live.current.settings = next;
          return next;
        });
      }),
    ];
    return () => uns.forEach((u) => void u.then((f) => f()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendPeekAnchor]);

  /* ---------------- 打开 / 关闭 ---------------- */

  const openPaths = useCallback(
    async (paths: string[]): Promise<string | null> => {
      const loaded: OpenDoc[] = [];
      const opened: string[] = [];
      let target: string | null = null;
      let failed = 0;
      let lastErr = "";
      for (const p of paths) {
        const existing = live.current.docs.find((d) => d.key === pathKey(p));
        if (existing) {
          target = existing.key;
          opened.push(existing.path);
          continue;
        }
        try {
          const doc = toDoc(await readTextFile(p));
          if (!live.current.docs.some((d) => d.key === doc.key) && !loaded.some((d) => d.key === doc.key)) {
            loaded.push(doc);
          }
          target = doc.key;
          opened.push(doc.path);
        } catch (e) {
          failed += 1;
          lastErr = `${basename(p)}：${errText(e)}`;
        }
      }
      if (loaded.length) {
        live.current.docs = [...live.current.docs, ...loaded];
        setDocs((prev) => {
          const keys = new Set(prev.map((d) => d.key));
          return [...prev, ...loaded.filter((d) => !keys.has(d.key))];
        });
      }
      if (target) {
        readerRef.current?.flushPosition();
        live.current.activeKey = target;
        setActiveKey(target);
      }
      if (opened.length) setRecent((prev) => mergeRecent(prev, opened));
      if (failed) pushToast(failed === 1 ? `无法打开 ${lastErr}` : `${failed} 个文件无法打开`, "warn");
      return target;
    },
    [pushToast],
  );

  const pickFiles = useCallback(async () => {
    try {
      const sel = await openDialog({
        multiple: true,
        directory: false,
        filters: [
          { name: "Markdown / 文本", extensions: [...MARKDOWN_EXT, ...TEXT_EXT] },
          { name: "所有文件", extensions: ["*"] },
        ],
      });
      if (!sel) return;
      await openPaths(Array.isArray(sel) ? sel : [sel]);
    } catch (e) {
      pushToast(`打开失败：${errText(e)}`, "warn");
    }
  }, [openPaths, pushToast]);

  const selectDoc = useCallback((key: string) => {
    if (key === live.current.activeKey) return;
    readerRef.current?.flushPosition();
    live.current.activeKey = key;
    setActiveKey(key);
  }, []);

  const closeDoc = useCallback(async (key: string) => {
    if (!await leaveEditor(key)) return;
    readerRef.current?.flushPosition();
    const list = live.current.docs;
    const idx = list.findIndex((d) => d.key === key);
    if (idx < 0) return;
    const next = list.filter((d) => d.key !== key);
    live.current.docs = next;
    setDocs(next);
    if (live.current.activeKey === key) {
      const k = next[Math.min(idx, next.length - 1)]?.key ?? null;
      live.current.activeKey = k;
      setActiveKey(k);
    }
  }, [leaveEditor]);

  const cycleDoc = useCallback(
    (dir: 1 | -1) => {
      const { docs: ds, activeKey: ak } = live.current;
      if (ds.length < 2) return;
      const i = ds.findIndex((d) => d.key === ak);
      selectDoc(ds[(i + dir + ds.length) % ds.length].key);
    },
    [selectDoc],
  );

  /* ---------------- 文件同步 ---------------- */

  const checkDoc = useCallback(
    async (key: string, force = false) => {
      const doc = live.current.docs.find((d) => d.key === key);
      if (!doc || editingDocs.current[key]) return;
      try {
        const st = await fileStat(doc.path);
        if (!st.exists) {
          if (!doc.missing) {
            setDocs((prev) => prev.map((d) => (d.key === key ? { ...d, missing: true } : d)));
            pushToast(`${doc.name} 已被移除或改名`, "warn");
          }
          return;
        }
        if (!force && !doc.missing && st.modified === doc.modified && st.size === doc.size) return;
        const f = await readTextFile(doc.path);
        if (editingDocs.current[key]) return;
        setDocs((prev) => prev.map((d) => (d.key === key ? { ...toDoc(f), key: d.key } : d)));
        if (force) pushToast(`已重新载入 ${doc.name}`);
      } catch (e) {
        if (force) pushToast(`重新载入失败：${errText(e)}`, "warn");
      }
    },
    [pushToast, editingDocs],
  );

  useEffect(() => {
    if (!ready || !settings.autoReload) return;
    const id = window.setInterval(() => {
      const k = live.current.activeKey;
      if (k && document.visibilityState === "visible") void checkDoc(k);
    }, 1500);
    const onFocus = () => live.current.docs.forEach((d) => void checkDoc(d.key));
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [ready, settings.autoReload, checkDoc]);

  useEffect(() => {
    if (ready && activeKey && settings.autoReload) void checkDoc(activeKey);
    setActiveHeading(null);
    setFindKey(null);
    const ph = pendingHash.current;
    if (ph && ph.key === activeKey) {
      pendingHash.current = null;
      window.setTimeout(() => readerRef.current?.scrollToId(ph.id), 60);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  /* ---------------- 启动 ---------------- */

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const st = parseState(await loadState().catch(() => null));
      if (cancelled) return;
      positionsRef.current = st.positions;
      live.current.settings = st.settings;
      live.current.recent = st.recent;
      setSettings(st.settings);
      setRecent(st.recent);

      void appInfo()
        .then((info) => {
          if (info.portableFailed) pushToast("软件目录不可写，便携模式未生效，数据暂存到用户目录", "warn");
        })
        .catch(() => undefined);


      const startup = await takeStartupFile().catch(() => null);
      if (startup) {
        await openPaths([startup]);
      } else if (st.settings.restoreLastSession && st.openFiles.length) {
        const results = await Promise.allSettled(st.openFiles.map((p) => readTextFile(p)));
        const loaded: OpenDoc[] = [];
        for (const r of results) {
          if (r.status !== "fulfilled") continue;
          const d = toDoc(r.value);
          if (!loaded.some((x) => x.key === d.key)) loaded.push(d);
        }
        const missing = results.length - loaded.length;
        const want = st.activeFile ? pathKey(st.activeFile) : null;
        const k = loaded.find((d) => d.key === want)?.key ?? loaded[0]?.key ?? null;
        live.current.docs = loaded;
        live.current.activeKey = k;
        setDocs(loaded);
        setActiveKey(k);
        if (missing > 0) pushToast(`上次打开的 ${missing} 个文件已找不到`, "warn");
      }
      setReady(true);

      // 主窗口就绪后再创建悬浮层
      hotkeysReady.current = true;
      enqueueHotkeys(async () => {
        const report = await overlaySetHotkeys(effectiveHotkeys(live.current.settings));
        const count = Object.keys(report.errors).length;
        if (count) pushToast(`有 ${count} 个热键无法使用，请在设置中查看`, "warn");
        return report;
      });
      void overlayInit().catch((error) => pushToast(`悬浮层创建失败：${errText(error)}`, "warn"));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 单实例：再次双击文件时由后端转发
  useEffect(() => {
    const un = listen<string>("open-file", (e) => void openPaths([e.payload]));
    return () => void un.then((f) => f());
  }, [openPaths]);

  /* ---------------- 关闭 / 后台运行 ---------------- */

  const quitting = useRef(false);
  const closeDialogOpen = useRef(false);

  /** 关闭按钮：根据设置收到托盘或退出；首次关闭时询问 */
  const decideClose = useCallback(async (): Promise<"tray" | "exit" | "cancel"> => {
    const action = live.current.settings.closeAction;
    if (action !== "ask") return action;
    if (closeDialogOpen.current) return "cancel";
    closeDialogOpen.current = true;
    try {
      const TRAY = "收到托盘";
      const EXIT = "直接退出";
      const r = await messageDialog(
        "收到托盘后，拟物阅读会在后台继续运行，悬浮层热键仍然可用；点击托盘图标可以重新打开，右键托盘图标可以退出。\n\n你的选择会被记住，之后可以在 设置 → 常规 中修改。",
        { title: "关闭拟物阅读", kind: "info", buttons: { yes: TRAY, no: EXIT, cancel: "取消" } },
      );
      const choice: "tray" | "exit" | "cancel" =
        r === TRAY || r === "Yes" ? "tray" : r === EXIT || r === "No" ? "exit" : "cancel";
      if (choice !== "cancel") {
        const next: Settings = { ...live.current.settings, closeAction: choice };
        live.current.settings = next;
        setSettings(next);
      }
      return choice;
    } catch {
      return "exit";
    } finally {
      closeDialogOpen.current = false;
    }
  }, []);

  useEffect(() => {
    const un = getCurrentWindow().onCloseRequested(async (event) => {
      if (!quitting.current) {
        const choice = await decideClose();
        if (choice !== "exit") {
          event.preventDefault();
          if (choice === "tray") {
            setSettingsOpen(false);
            await flushPersist();
            await hideMain().catch(() => undefined);
          }
          return;
        }
      }
      // 退出前写盘
      if (!await leaveEditor()) { event.preventDefault(); return; }
      await flushPersist();
    });
    return () => void un.then((f) => f());
  }, [flushPersist, decideClose, leaveEditor]);

  // 托盘菜单“退出”：保存状态后退出
  useEffect(() => {
    const un = listen("app-quit", async () => {
      if (Object.values(editingDocs.current).some(isDirty)) {
        const main = getCurrentWindow();
        await main.show(); await main.unminimize(); await main.setFocus();
      }
      if (!await leaveEditor()) return;
      quitting.current = true;
      await flushPersist();
      await quitApp();
    });
    return () => void un.then((f) => f());
  }, [flushPersist, editingDocs, leaveEditor]);

  // 拖拽打开
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      const t = e.payload.type;
      if (t === "enter" || t === "over") setDragging(true);
      else if (t === "leave") setDragging(false);
      else if (t === "drop") {
        setDragging(false);
        if (e.payload.paths.length) void openPaths(e.payload.paths);
      }
    });
    return () => void un.then((f) => f());
  }, [openPaths]);

  /* ---------------- 设置 / 字号 ---------------- */

  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      if (patch.fontSize !== undefined) next.fontSize = clampFont(patch.fontSize);
      live.current.settings = next;
      return next;
    });
  }, []);

  const fontStep = useCallback(
    (d: number) => patchSettings({ fontSize: live.current.settings.fontSize + d }),
    [patchSettings],
  );

  const toggleSidebar = useCallback(
    () => patchSettings({ sidebarCollapsed: !live.current.settings.sidebarCollapsed }),
    [patchSettings],
  );

  /* ---------------- 链接 ---------------- */

  const handleLink = useCallback(
    (href: string) => {
      if (href.startsWith("#")) {
        if (!readerRef.current?.scrollToId(safeDecode(href.slice(1)))) pushToast("找不到对应的标题", "warn");
        return;
      }
      if (/^(https?:|mailto:)/i.test(href)) {
        void openUrl(href).catch((e) => pushToast(`无法打开链接：${errText(e)}`, "warn"));
        return;
      }
      if (/^[a-z][a-z0-9+.-]+:/i.test(href) && !/^file:/i.test(href) && !/^[a-zA-Z]:[\\/]/.test(href)) {
        pushToast("不支持此类链接", "warn");
        return;
      }
      const doc = live.current.docs.find((d) => d.key === live.current.activeKey);
      if (!doc) return;
      const hashAt = href.indexOf("#");
      const rawPath = hashAt >= 0 ? href.slice(0, hashAt) : href;
      const hash = hashAt >= 0 ? safeDecode(href.slice(hashAt + 1)) : "";
      const p = safeDecode(rawPath.replace(/^file:\/\/\/?/i, "").split("?")[0]);
      if (!p) return;
      const target = resolvePath(dirname(doc.path), p);
      const ext = extOf(target);
      if (ext && ![...MARKDOWN_EXT, ...TEXT_EXT].includes(ext)) {
        pushToast(`暂不支持在阅读器中打开 .${ext} 文件`, "warn");
        return;
      }
      void openPaths([target]).then((key) => {
        if (!key || !hash) return;
        if (key === live.current.activeKey && key === doc.key) readerRef.current?.scrollToId(hash);
        else pendingHash.current = { key, id: hash };
      });
    },
    [openPaths, pushToast],
  );

  /* ---------------- 快捷键 ---------------- */

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
    if ((e.target as HTMLElement | null)?.closest(".annotation-tools")) return;
    if (!settingsOpen && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
      if (e.key.toLowerCase() === "e") { e.preventDefault(); toggleEditor(); return; }
      if (e.key.toLowerCase() === "s") { e.preventDefault(); if (draft && activeDoc) void editor.save(activeDoc); return; }
    }
    if (e.key === "Escape" && live.current.settingsOpen) {
      setSettingsOpen(false);
      return;
    }
    if (e.key === "Escape" && findOpen) {
      e.preventDefault();
      closeFind();
      return;
    }
    if (e.key === "F3" && !e.altKey && !e.ctrlKey && !e.metaKey && (!findOpen || settingsOpen)) {
      e.preventDefault();
      openFind();
      return;
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    const ak = live.current.activeKey;
    let handled = true;
    if (k === "o") void pickFiles();
    else if (k === "f" && !e.shiftKey) openFind();
    else if (k === "b") toggleSidebar();
    else if (k === "=" || k === "+") fontStep(1);
    else if (k === "-" || k === "_") fontStep(-1);
    else if (k === "0") patchSettings({ fontSize: DEFAULT_SETTINGS.fontSize });
    else if (k === ",") setSettingsOpen((v) => !v);
    else if (k === "w") ak && closeDoc(ak);
    else if (k === "r") ak && void checkDoc(ak, true);
    else if (k === "tab") cycleDoc(e.shiftKey ? -1 : 1);
    else if (k === "p" || k === "u" || k === "g" || k === "j") handled = true;
    else handled = false;
    if (handled) e.preventDefault();
  };
  useEffect(() => {
    const fn = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", fn);
    const block = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest(".reader-content")) e.preventDefault();
    };
    window.addEventListener("contextmenu", block);
    return () => {
      window.removeEventListener("keydown", fn);
      window.removeEventListener("contextmenu", block);
    };
  }, []);

  /* ---------------- 渲染 ---------------- */

  const recentForEmpty = recent.slice(0, 5);

  return (
    <div className="app">
      <TitleBar
        sidebarOpen={!settings.sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        onOpen={() => void pickFiles()}
        canFind={!!activeDoc}
        findOpen={findOpen}
        onFind={findOpen ? closeFind : openFind}
        canEdit={!!activeDoc}
        editing={!!draft}
        dirty={!!draft && isDirty(draft)}
        saving={!!draft?.saving}
        onEdit={toggleEditor}
        onSave={() => { if (activeDoc) void editor.save(activeDoc); }}
        title={activeDoc ? activeDoc.name : "拟物阅读"}
        subtitle={activeDoc ? dirname(activeDoc.path) : ""}
        fontSize={settings.fontSize}
        onFontStep={fontStep}
        onFontReset={() => patchSettings({ fontSize: DEFAULT_SETTINGS.fontSize })}
        onSettings={() => setSettingsOpen((v) => !v)}
        settingsOpen={settingsOpen}
      />

      <main className="main">
        <Sidebar
          collapsed={settings.sidebarCollapsed}
          tab={settings.sidebarTab}
          onTab={(t) => patchSettings({ sidebarTab: t })}
          docs={docs}
          activeKey={activeKey}
          recent={recent}
          outline={activeDoc && !draft ? outline : []}
          activeHeading={activeHeading}
          editing={!!draft}
          dirtyKeys={Object.keys(editor.drafts).filter((key) => isDirty(editor.drafts[key]))}
          onSelect={selectDoc}
          onCloseDoc={closeDoc}
          onOpenRecent={(p) => void openPaths([p])}
          onRemoveRecent={(p) => setRecent((prev) => prev.filter((r) => pathKey(r) !== pathKey(p)))}
          onClearRecent={() => setRecent([])}
          onPickFiles={() => void pickFiles()}
          onOutline={(id) => readerRef.current?.scrollToId(id)}
        />

        <section className="stage">
          {activeDoc && draft ? (
            <div className="source-editor" key={activeDoc.key}>
              <textarea className="source-text" aria-label={activeDoc.kind === "markdown" ? "Markdown 源文" : "正文编辑"}
                style={{ fontSize: settings.fontSize, maxWidth: CONTENT_WIDTHS[settings.contentWidth] }}
                spellCheck={false} autoFocus readOnly={draft.saving} value={draft.text} onChange={(event) => editor.change(activeDoc.key, event.target.value)} />
              {draft.error && <p className="editor-error" role="alert">{draft.error}</p>}
            </div>
          ) : activeDoc ? (
            <Reader
              key={activeDoc.key}
              ref={readerRef}
              doc={activeDoc}
              fontSize={settings.fontSize}
              contentWidth={settings.contentWidth}
              renderHtml={settings.renderHtml}
              autoReload={settings.autoReload}
              findOpen={findOpen}
              onCloseFind={closeFind}
              initialPosition={positionsRef.current[activeDoc.key]}
              onPosition={onPosition}
              onOutline={setOutline}
              onActiveHeading={setActiveHeading}
              onLink={handleLink}
              onFontStep={fontStep}
              onWarn={pushToast}
            />
          ) : (
            ready && (
              <div className="empty card">
                <NeuButton shape="round" size="lg" onClick={() => void pickFiles()} aria-label="打开文件">
                  <IconOpen size={30} />
                </NeuButton>
                <h1>打开或拖入文件</h1>
                {recentForEmpty.length > 0 && (
                  <div className="empty-recent">
                    {recentForEmpty.map((r) => (
                      <button key={r} type="button" className="chip" onClick={() => void openPaths([r])} title={r}>
                        {basename(r)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          )}
        </section>
      </main>

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onChange={patchSettings}
          onClose={() => setSettingsOpen(false)}
          hotkeyErrors={hotkeyErrors}
          onHotkeyRecording={onHotkeyRecording}
        />
      )}

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-inner">
            <Lamp state="on" />
            松开以打开文件
          </div>
        </div>
      )}

      <Toasts items={toasts} />
    </div>
  );
}
