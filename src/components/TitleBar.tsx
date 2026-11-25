import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { NeuButton } from "./neu";
import {
  IconClose,
  IconEdit,
  IconSave,
  IconMinus,
  IconOpen,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSidebar,
  IconWinMax,
  IconWinMin,
  IconWinRestore,
} from "./Icons";
import { FONT_MAX, FONT_MIN } from "../lib/state";

interface TitleBarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpen: () => void;
  canFind: boolean;
  findOpen: boolean;
  onFind: () => void;
  canEdit: boolean;
  editing: boolean;
  dirty: boolean;
  saving: boolean;
  onEdit: () => void;
  onSave: () => void;
  title: string;
  subtitle: string;
  fontSize: number;
  onFontStep: (delta: number) => void;
  onFontReset: () => void;
  onSettings: () => void;
  settingsOpen: boolean;
}

export function TitleBar(p: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    void win.isMaximized().then(setMaximized);
    const un = win.onResized(() => void win.isMaximized().then(setMaximized));
    return () => void un.then((f) => f());
  }, []);

  const win = getCurrentWindow();

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="tb-group">
        <NeuButton on={p.sidebarOpen} onClick={p.onToggleSidebar} title="侧边栏 (Ctrl+B)" aria-label="切换侧边栏">
          <IconSidebar />
        </NeuButton>
        <NeuButton onClick={p.onOpen} title="打开文件 (Ctrl+O)" aria-label="打开文件">
          <IconOpen />
        </NeuButton>
      </div>

      <div className="tb-title" data-tauri-drag-region>
        <span className="tb-name" data-tauri-drag-region>
          {p.title}{p.dirty && <span className="edit-dirty" aria-label="未保存" title="未保存" />}
        </span>
        {p.subtitle && (
          <span className="tb-sub" data-tauri-drag-region title={p.subtitle}>
            {p.subtitle}
          </span>
        )}
      </div>

      <div className="tb-group">
        <NeuButton on={p.editing} disabled={!p.canEdit || p.saving} onClick={p.onEdit} title={p.editing ? "返回阅读 (Ctrl+E)" : "编辑文档 (Ctrl+E)"} aria-label={p.editing ? "返回阅读" : "编辑文档"}>
          <IconEdit />
        </NeuButton>
        {p.editing ? <NeuButton disabled={!p.dirty || p.saving} onClick={p.onSave} title="保存 (Ctrl+S)" aria-label="保存文档"><IconSave /></NeuButton> : (
        <NeuButton disabled={!p.canFind} on={p.findOpen} onClick={p.onFind} title="文档内查找 (Ctrl+F)" aria-label="文档内查找" aria-expanded={p.findOpen}>
          <IconSearch />
        </NeuButton>)}
        <div className="font-ctl" role="group" aria-label="字号">
          <NeuButton size="sm" onClick={() => p.onFontStep(-1)} disabled={p.fontSize <= FONT_MIN} title="缩小 (Ctrl+-)" aria-label="缩小字号">
            <IconMinus size={18} />
          </NeuButton>
          <button type="button" className="font-val num" onClick={p.onFontReset} title="重置字号 (Ctrl+0)">
            {p.fontSize}
          </button>
          <NeuButton size="sm" onClick={() => p.onFontStep(1)} disabled={p.fontSize >= FONT_MAX} title="放大 (Ctrl+=)" aria-label="放大字号">
            <IconPlus size={18} />
          </NeuButton>
        </div>
        <NeuButton on={p.settingsOpen} onClick={p.onSettings} title="设置 (Ctrl+,)" aria-label="设置">
          <IconSettings />
        </NeuButton>
      </div>

      <div className="tb-group win-ctl">
        <NeuButton size="sm" onClick={() => void win.minimize()} aria-label="最小化">
          <IconWinMin size={18} />
        </NeuButton>
        <NeuButton size="sm" onClick={() => void win.toggleMaximize()} aria-label={maximized ? "还原" : "最大化"}>
          {maximized ? <IconWinRestore size={18} /> : <IconWinMax size={18} />}
        </NeuButton>
        <NeuButton size="sm" tone="danger" onClick={() => void win.close()} aria-label="关闭">
          <IconClose size={18} />
        </NeuButton>
      </div>
    </header>
  );
}
