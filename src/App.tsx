import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { Reader } from "./components/Reader";
import type { ReaderHandle } from "./components/Reader";
import { SettingsPanel } from "./components/SettingsPanel";
import { Toasts } from "./components/Toasts";
import { NeuButton, Lamp } from "./components/neu";
import { IconOpen } from "./components/Icons";
import { fileStat, loadState, readTextFile, saveState, takeStartupFile } from "./lib/api";
import type { TextFile } from "./lib/api";
import { basename, dirname, extOf, pathKey, resolvePath } from "./lib/paths";
import { docKind, extLabel, MARKDOWN_EXT, TEXT_EXT } from "./lib/fileTypes";
import type { OpenDoc, OutlineItem } from "./lib/types";
import type { PersistedState, ReadingPosition, Settings } from "./lib/state";
import { clampFont, DEFAULT_SETTINGS, MAX_RECENT, parseState, prunePositions } from "./lib/state";
import { useToasts } from "./lib/useToasts";

const toDoc = (f: TextFile): OpenDoc => ({
  key: pathKey(f.path),
  path: f.path,
  name: f.name,
  content: f.content,
  modified: f.modified,
  size: f.size,
  encoding: f.encoding,
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

  const onPosition = useCallback(
    (key: string, pos: ReadingPosition) => {
      positionsRef.current[key] = pos;
      schedulePersist();
    },
    [schedulePersist],
  );

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

  const closeDoc = useCallback((key: string) => {
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
  }, []);

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
      if (!doc) return;
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
        setDocs((prev) => prev.map((d) => (d.key === key ? { ...toDoc(f), key: d.key } : d)));
        if (force) pushToast(`已重新载入 ${doc.name}`);
      } catch (e) {
        if (force) pushToast(`重新载入失败：${errText(e)}`, "warn");
      }
    },
    [pushToast],
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

  // 退出前写盘
  useEffect(() => {
    const un = getCurrentWindow().onCloseRequested(async () => {
      await flushPersist();
    });
    return () => void un.then((f) => f());
  }, [flushPersist]);

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
    if (e.key === "Escape" && live.current.settingsOpen) {
      setSettingsOpen(false);
      return;
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    const ak = live.current.activeKey;
    let handled = true;
    if (k === "o") void pickFiles();
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
        title={activeDoc ? activeDoc.name : "花笺阅读"}
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
          outline={activeDoc ? outline : []}
          activeHeading={activeHeading}
          onSelect={selectDoc}
          onCloseDoc={closeDoc}
          onOpenRecent={(p) => void openPaths([p])}
          onRemoveRecent={(p) => setRecent((prev) => prev.filter((r) => pathKey(r) !== pathKey(p)))}
          onClearRecent={() => setRecent([])}
          onPickFiles={() => void pickFiles()}
          onOutline={(id) => readerRef.current?.scrollToId(id)}
        />

        <section className="stage">
          {activeDoc ? (
            <Reader
              key={activeDoc.key}
              ref={readerRef}
              doc={activeDoc}
              fontSize={settings.fontSize}
              contentWidth={settings.contentWidth}
              renderHtml={settings.renderHtml}
              autoReload={settings.autoReload}
              initialPosition={positionsRef.current[activeDoc.key]}
              onPosition={onPosition}
              onOutline={setOutline}
              onActiveHeading={setActiveHeading}
              onLink={handleLink}
              onFontStep={fontStep}
            />
          ) : (
            ready && (
              <div className="empty card">
                <NeuButton shape="round" size="lg" onClick={() => void pickFiles()} aria-label="打开文件">
                  <IconOpen size={30} />
                </NeuButton>
                <h1>打开一个文件开始阅读</h1>
                <p>
                  支持 Markdown 与纯文本，也可以直接把文件拖进窗口。<span className="num">Ctrl O</span>
                </p>
                {recentForEmpty.length > 0 && (
                  <div className="empty-recent">
                    {recentForEmpty.map((r) => (
                      <button key={r} type="button" className="chip" onClick={() => void openPaths([r])} title={r}>
                        <span className="num">{extLabel(r)}</span>
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

      {settingsOpen && <SettingsPanel settings={settings} onChange={patchSettings} onClose={() => setSettingsOpen(false)} />}

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
