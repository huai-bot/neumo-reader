import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { NeuButton } from "./neu";
import {
  IconClose,
  IconMinus,
  IconOpen,
  IconPlus,
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
          {p.title}
        </span>
        {p.subtitle && (
          <span className="tb-sub" data-tauri-drag-region title={p.subtitle}>
            {p.subtitle}
          </span>
        )}
      </div>

      <div className="tb-group">
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
