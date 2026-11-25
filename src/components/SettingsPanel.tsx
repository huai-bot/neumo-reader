import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { CloseAction, ContentWidth, Settings } from "../lib/state";
import type { PeekView } from "../peek/protocol";
import type { CardSplit } from "../peek/cards";
import { appInfo, openDataDir, overlayToggle } from "../lib/api";
import type { AppInfo } from "../lib/api";
import { DEFAULT_SETTINGS, FONT_MAX, FONT_MIN } from "../lib/state";
import { Knob, Lamp, NeuButton, Segmented, Toggle } from "./neu";
import { HotkeyField } from "./HotkeyField";
import { DEFAULT_HOTKEYS, MAIN_HOTKEY, OVERLAY_ACTIONS } from "../lib/hotkeys";
import type { HotkeyMeta } from "../lib/hotkeys";
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
  hotkeyErrors,
  onHotkeyRecording,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
  hotkeyErrors: Record<string, string>;
  onHotkeyRecording: (recording: boolean) => void;
}) {
  const [version, setVersion] = useState("");
  const [info, setInfo] = useState<AppInfo | null>(null);
  const hotkeyField = (meta: HotkeyMeta) => (
    <HotkeyField meta={meta} value={settings.hotkeys[meta.id]} enabled={settings.hotkeyEnabled[meta.id]}
      error={hotkeyErrors[meta.id]} onRecording={onHotkeyRecording}
      onEnabledChange={(enabled) => onChange({ hotkeyEnabled: { ...settings.hotkeyEnabled, [meta.id]: enabled } })}
      onChange={(value) => onChange({
        hotkeys: { ...settings.hotkeys, [meta.id]: value },
        hotkeyEnabled: { ...settings.hotkeyEnabled, [meta.id]: value !== "" },
      })} />
  );
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

        <h3 className="set-group">常规</h3>
        <Row title="显示主窗口" desc="全局热键">{hotkeyField(MAIN_HOTKEY)}</Row>
        <Row title="关闭窗口时">
          <Segmented<CloseAction>
            label="点击关闭按钮时"
            value={settings.closeAction}
            onChange={(v) => onChange({ closeAction: v })}
            options={[
              { value: "ask", label: "询问" },
              { value: "tray", label: "收到托盘" },
              { value: "exit", label: "退出" },
            ]}
          />
        </Row>

        <h3 className="set-group">阅读恢复</h3>
        <Row title="启动时恢复上次阅读">
          <Toggle label="启动时恢复上次阅读" checked={settings.restoreLastSession} onChange={(v) => onChange({ restoreLastSession: v })} />
        </Row>
        <Row title="记住每个文件的阅读位置">
          <Toggle label="记住每个文件的阅读位置" checked={settings.rememberPositions} onChange={(v) => onChange({ rememberPositions: v })} />
        </Row>

        <h3 className="set-group">显示</h3>
        <div className="set-row set-row-knob">
          <div className="set-label">
            <span className="set-title">正文字号</span>
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
        <Row title="渲染 Markdown 中的 HTML">
          <Toggle label="渲染 HTML" checked={settings.renderHtml} onChange={(v) => onChange({ renderHtml: v })} />
        </Row>

        <h3 className="set-group">悬浮层</h3>
        <div className="set-row">
          <div className="set-label">
            <span className="set-title">预览</span>
          </div>
          <div className="set-ctl">
            <NeuButton size="sm" shape="wide" onClick={() => void overlayToggle()}>
              显示 / 隐藏
            </NeuButton>
          </div>
        </div>
        <div className="set-row set-row-knob">
          <div className="set-label">
            <span className="set-title">背景不透明度</span>
            <div className="set-inline">
              <Toggle label="背景模糊" checked={settings.overlayBlur} onChange={(v) => onChange({ overlayBlur: v })} />
              <span className="set-desc">背景模糊</span>
            </div>
          </div>
          <Knob
            label="背景不透明度"
            value={Math.round(settings.overlayOpacity * 100)}
            min={0}
            max={100}
            step={5}
            majorEvery={2}
            unit="%"
            onChange={(v) => onChange({ overlayOpacity: v / 100 })}
          />
        </div>
        <Row title="悬浮层字号">
          <Segmented<string>
            label="悬浮层字号"
            value={String(settings.overlayFontSize)}
            onChange={(v) => onChange({ overlayFontSize: Number(v) })}
            options={[
              { value: "14", label: "14" },
              { value: "16", label: "16" },
              { value: "18", label: "18" },
              { value: "20", label: "20" },
            ]}
          />
        </Row>

        <Row title="显示方式">
          <Segmented<PeekView>
            label="显示方式"
            value={settings.overlayView}
            onChange={(v) => onChange({ overlayView: v })}
            options={[
              { value: "card", label: "步骤卡片" },
              { value: "scroll", label: "全文" },
            ]}
          />
        </Row>
        <Row title="卡片拆分">
          <Segmented<CardSplit>
            label="卡片拆分"
            value={settings.overlayCardSplit}
            onChange={(v) => onChange({ overlayCardSplit: v })}
            options={[
              { value: "step", label: "按步骤" },
              { value: "section", label: "按章节" },
            ]}
          />
        </Row>
        <Row
          title="看完自动翻到下一步"
          desc="按住偷看超过 1 秒且未手动翻页，下次从下一步开始。"
        >
          <Toggle
            label="看完自动翻到下一步"
            checked={settings.overlayAutoAdvance}
            onChange={(v) => onChange({ overlayAutoAdvance: v })}
          />
        </Row>

        <h3 className="set-group">悬浮层热键</h3>
        {OVERLAY_ACTIONS.map((meta) => (
          <Row key={meta.id} title={meta.label} desc={meta.desc}>
            {hotkeyField(meta)}
          </Row>
        ))}
        <div className="set-row set-reset">
          <div className="set-ctl">
            <NeuButton
              size="sm"
              shape="wide"
              disabled={OVERLAY_ACTIONS.every(({ id }) => settings.hotkeyEnabled[id] && settings.hotkeys[id] === DEFAULT_HOTKEYS[id])}
              onClick={() => {
                const hotkeys = { ...settings.hotkeys };
                const hotkeyEnabled = { ...settings.hotkeyEnabled };
                for (const { id } of OVERLAY_ACTIONS) { hotkeys[id] = DEFAULT_HOTKEYS[id]; hotkeyEnabled[id] = true; }
                onChange({ hotkeys, hotkeyEnabled });
              }}
            >
              恢复悬浮层默认热键
            </NeuButton>
          </div>
        </div>

        <h3 className="set-group">文件</h3>
        <Row title="文件变化时自动刷新">
          <Toggle label="自动刷新" checked={settings.autoReload} onChange={(v) => onChange({ autoReload: v })} />
        </Row>

        <h3 className="set-group">数据</h3>
        <div className="set-row">
          <div className="set-label">
            <span className="set-title set-title-lamp">
              <Lamp state={info?.portableFailed ? "warn" : info?.portable ? "on" : "off"} />
              {info?.portable ? "便携模式" : "安装模式"}
            </span>
            {info?.portableFailed && <span className="set-desc">软件目录不可写，数据已保存到用户目录。</span>}
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
