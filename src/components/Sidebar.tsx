import type { OpenDoc, OutlineItem } from "../lib/types";
import type { SidebarTab } from "../lib/state";
import { basename, dirname, pathKey } from "../lib/paths";
import { extLabel } from "../lib/fileTypes";
import { Lamp, NeuButton, Segmented } from "./neu";
import { IconClose, IconOpen } from "./Icons";

interface SidebarProps {
  collapsed: boolean;
  tab: SidebarTab;
  onTab: (t: SidebarTab) => void;
  docs: OpenDoc[];
  activeKey: string | null;
  recent: string[];
  outline: OutlineItem[];
  activeHeading: string | null;
  onSelect: (key: string) => void;
  onCloseDoc: (key: string) => void;
  onOpenRecent: (path: string) => void;
  onRemoveRecent: (path: string) => void;
  onClearRecent: () => void;
  onPickFiles: () => void;
  onOutline: (id: string) => void;
}

export function Sidebar(p: SidebarProps) {
  const openKeys = new Set(p.docs.map((d) => d.key));
  const recent = p.recent.filter((r) => !openKeys.has(pathKey(r)));
  const activeDoc = p.docs.find((d) => d.key === p.activeKey);
  const minLevel = p.outline.reduce((m, o) => Math.min(m, o.level), 6);

  return (
    <aside className={`sidebar-shell ${p.collapsed ? "is-collapsed" : ""}`} aria-hidden={p.collapsed}>
      <div className="sidebar card" inert={p.collapsed}>
        <Segmented
          label="侧边栏视图"
          value={p.tab}
          onChange={p.onTab}
          options={[
            { value: "files", label: "文件" },
            { value: "outline", label: "大纲" },
          ]}
        />

        {p.tab === "files" ? (
          <>
            <NeuButton shape="wide" onClick={p.onPickFiles}>
              <IconOpen size={18} />
              <span>打开文件</span>
              <kbd className="num">Ctrl O</kbd>
            </NeuButton>

            <div className="sb-scroll">
              <div className="sb-section">
                <div className="sb-title">
                  <span>已打开</span>
                  <span className="num sb-count">{p.docs.length}</span>
                </div>
                {p.docs.length === 0 && <p className="sb-empty">还没有打开的文件</p>}
                {p.docs.map((d) => (
                  <div key={d.key} className={`sb-item ${d.key === p.activeKey ? "is-current" : ""}`}>
                    <button type="button" className="sb-item-main" onClick={() => p.onSelect(d.key)} title={d.path}>
                      <Lamp state={d.missing ? "warn" : d.key === p.activeKey ? "on" : "off"} />
                      <span className="sb-ext num">{extLabel(d.path)}</span>
                      <span className="sb-text">
                        <span className="sb-name">{d.name}</span>
                        <span className="sb-dir">{dirname(d.path)}</span>
                      </span>
                    </button>
                    <button type="button" className="sb-x" onClick={() => p.onCloseDoc(d.key)} aria-label={`关闭 ${d.name}`}>
                      <IconClose size={14} />
                    </button>
                  </div>
                ))}
              </div>

              {recent.length > 0 && (
                <div className="sb-section">
                  <div className="sb-title">
                    <span>最近</span>
                    <button type="button" className="sb-link" onClick={p.onClearRecent}>
                      清空
                    </button>
                  </div>
                  {recent.map((r) => (
                    <div key={r} className="sb-item">
                      <button type="button" className="sb-item-main" onClick={() => p.onOpenRecent(r)} title={r}>
                        <span className="sb-ext num">{extLabel(r)}</span>
                        <span className="sb-text">
                          <span className="sb-name">{basename(r)}</span>
                          <span className="sb-dir">{dirname(r)}</span>
                        </span>
                      </button>
                      <button type="button" className="sb-x" onClick={() => p.onRemoveRecent(r)} aria-label={`从最近移除 ${basename(r)}`}>
                        <IconClose size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="sb-scroll">
            {activeDoc && <div className="sb-title sb-title-doc">{activeDoc.name}</div>}
            {p.outline.length === 0 ? (
              <p className="sb-empty">{activeDoc ? (activeDoc.kind === "markdown" ? "此文档没有标题" : "纯文本文件没有大纲") : "打开文件后显示大纲"}</p>
            ) : (
              <nav className="outline">
                {p.outline.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={`ol-item ${o.id === p.activeHeading ? "is-current" : ""}`}
                    style={{ paddingLeft: 14 + (o.level - minLevel) * 14 }}
                    onClick={() => p.onOutline(o.id)}
                    title={o.text}
                  >
                    <span className="ol-dot" />
                    <span className={`ol-text lv-${o.level - minLevel}`}>{o.text}</span>
                  </button>
                ))}
              </nav>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
