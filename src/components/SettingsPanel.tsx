import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { ContentWidth, Settings } from "../lib/state";
import { appInfo, openDataDir } from "../lib/api";
import type { AppInfo } from "../lib/api";
import { DEFAULT_SETTINGS, FONT_MAX, FONT_MIN } from "../lib/state";
import { Knob, Lamp, NeuButton, Segmented, Toggle } from "./neu";
import { IconClose } from "./Icons";

function Row({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        <span className="set-title">{title}</span>
        {desc && <span className="set-desc">{desc}</span>}
      </div>
      <div className="set-ctl">{children}</div>
    </div>
  );
}

export function SettingsPanel({
  settings,
  onChange,
  onClose,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}) {
  const [version, setVersion] = useState("");
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => {
    void getVersion().then(setVersion).catch(() => setVersion(""));
    void appInfo().then(setInfo).catch(() => setInfo(null));
  }, []);

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="settings card" role="dialog" aria-modal="true" aria-label="设置">
        <header className="set-head">
          <h2>设置</h2>
          <NeuButton size="sm" onClick={onClose} aria-label="关闭设置">
            <IconClose size={18} />
          </NeuButton>
        </header>

        <h3 className="set-group">阅读恢复</h3>
        <Row title="启动时恢复上次阅读" desc="未通过双击文件或命令行打开新文件时，重新打开上次退出时的文件，并回到当时的阅读位置。">
          <Toggle label="启动时恢复上次阅读" checked={settings.restoreLastSession} onChange={(v) => onChange({ restoreLastSession: v })} />
        </Row>
        <Row title="记住每个文件的阅读位置" desc="以后再次打开同一文件时，自动跳到上次读到的地方。">
          <Toggle label="记住每个文件的阅读位置" checked={settings.rememberPositions} onChange={(v) => onChange({ rememberPositions: v })} />
        </Row>

        <h3 className="set-group">显示</h3>
        <div className="set-row set-row-knob">
          <div className="set-label">
            <span className="set-title">正文字号</span>
            <span className="set-desc">
              拖动或滚动旋钮调整，范围 <span className="num">{FONT_MIN}</span>–<span className="num">{FONT_MAX}</span> px。阅读时也可用 Ctrl + 滚轮。
            </span>
            <div className="set-inline">
              <NeuButton size="sm" shape="wide" onClick={() => onChange({ fontSize: DEFAULT_SETTINGS.fontSize })}>
                恢复默认 <span className="num">{DEFAULT_SETTINGS.fontSize}</span>
              </NeuButton>
            </div>
          </div>
          <Knob label="正文字号" value={settings.fontSize} min={FONT_MIN} max={FONT_MAX} unit="px" onChange={(v) => onChange({ fontSize: v })} />
        </div>
        <Row title="正文宽度">
          <Segmented<ContentWidth>
            label="正文宽度"
            value={settings.contentWidth}
            onChange={(v) => onChange({ contentWidth: v })}
            options={[
              { value: "narrow", label: "窄" },
              { value: "medium", label: "适中" },
              { value: "wide", label: "宽" },
              { value: "full", label: "铺满" },
            ]}
          />
        </Row>
        <Row title="渲染 Markdown 中的 HTML" desc="经过安全过滤后渲染内嵌 HTML 标签。">
          <Toggle label="渲染 HTML" checked={settings.renderHtml} onChange={(v) => onChange({ renderHtml: v })} />
        </Row>

        <h3 className="set-group">文件</h3>
        <Row title="文件变化时自动刷新" desc="其他程序修改了正在阅读的文件时自动重新载入，并保持阅读位置。">
          <Toggle label="自动刷新" checked={settings.autoReload} onChange={(v) => onChange({ autoReload: v })} />
        </Row>

        <h3 className="set-group">数据</h3>
        <div className="set-row">
          <div className="set-label">
            <span className="set-title set-title-lamp">
              <Lamp state={info?.portableFailed ? "warn" : info?.portable ? "on" : "off"} />
              {info?.portable ? "便携模式" : "安装模式"}
            </span>
            <span className="set-desc">
              {info?.portable
                ? "设置、最近文件、阅读位置和窗口状态都保存在软件目录的 data 文件夹，可以连同软件一起拷走。"
                : info?.portableFailed
                  ? "软件目录有 portable.flag，但该目录不可写，数据暂存到用户目录。请把软件放到可写的位置。"
                  : "数据保存在用户目录。在软件所在文件夹放一个 portable.flag 文件，重启后即切换为便携模式。"}
            </span>
            {info && (
              <span className="set-path num" title={info.dataDir}>
                {info.dataDir}
              </span>
            )}
          </div>
          <div className="set-ctl">
            <NeuButton size="sm" shape="wide" onClick={() => void openDataDir()}>
              打开文件夹
            </NeuButton>
          </div>
        </div>

        <footer className="set-foot">
          <span>
            拟物阅读 <span className="num">{version && `v${version}`}</span> · MIT
          </span>
          <button type="button" className="sb-link" onClick={() => void openUrl("https://github.com/Achilng/floral-notepaper")}>
            致谢：花笺 Floral Notepaper
          </button>
        </footer>
      </section>
    </div>
  );
}
