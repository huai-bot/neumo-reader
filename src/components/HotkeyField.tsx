import { useEffect, useRef, useState } from "react";
import type { HotkeyMeta } from "../lib/hotkeys";
import { eventKeyCode, formatHotkey, hotkeyFromEvent, isMenuKey } from "../lib/hotkeys";
import { Toggle } from "./neu";

/** 点击后录制；菜单键先按住等待第二个键，单独松开则录制菜单键本身。 */
export function HotkeyField({
  meta, value, enabled, error, onChange, onEnabledChange, onRecording,
}: {
  meta: HotkeyMeta;
  value: string;
  enabled: boolean;
  error?: string;
  onChange: (v: string) => void;
  onEnabledChange: (v: boolean) => void;
  onRecording: (recording: boolean) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState("");
  const [local, setLocal] = useState("");
  const live = useRef({ meta, onChange, onRecording });
  live.current = { meta, onChange, onRecording };

  useEffect(() => {
    if (!recording) return;
    live.current.onRecording(true);
    let menuHeld = false;
    const stop = () => {
      menuHeld = false;
      setRecording(false);
      setPreview("");
    };
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      const code = eventKeyCode(e);
      const noMods = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && !menuHeld;
      if (code === "Escape" && noMods) {
        stop();
        return;
      }
      if ((code === "Backspace" || code === "Delete") && noMods) {
        live.current.onChange("");
        stop();
        return;
      }
      if (isMenuKey(e)) {
        menuHeld = true;
        const r = hotkeyFromEvent(e, live.current.meta);
        if (r.kind === "done") setPreview(`${formatHotkey(r.value)} …`);
        return;
      }
      const r = hotkeyFromEvent(e, live.current.meta, menuHeld);
      if (r.kind === "pending") setPreview(r.preview);
      else if (r.kind === "error") {
        setLocal(r.message);
        stop();
      } else {
        live.current.onChange(r.value);
        stop();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isMenuKey(e) && menuHeld) {
        const r = hotkeyFromEvent(e, live.current.meta);
        if (r.kind === "done") live.current.onChange(r.value);
        stop();
      } else if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && !menuHeld) setPreview("");
    };
    const onContextMenu = (e: Event) => e.preventDefault();
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("blur", stop);
      live.current.onRecording(false);
    };
  }, [recording]);

  const msg = local || (enabled ? error : "");
  return (
    <div className="hk">
      <div className="hk-controls">
        <button
          type="button"
          className={`hk-field num ${recording ? "is-recording" : ""} ${enabled && value ? "" : "is-empty"} ${msg ? "is-error" : ""}`}
          aria-label={`${meta.label}：${formatHotkey(value)}${enabled ? "" : "，已关闭"}，点击修改`}
          onClick={() => {
            setLocal("");
            setRecording((r) => !r);
          }}
        >
          {recording ? preview || "请按下组合键…" : formatHotkey(value)}
        </button>
        <div className="hk-enable">
          <Toggle label={`启用${meta.label}快捷键`} checked={enabled} onChange={onEnabledChange} />
          <span className="set-desc">{enabled ? "开启" : "关闭"}</span>
        </div>
      </div>
      {msg && !recording && <span className="hk-error" role="alert">{msg}</span>}
    </div>
  );
}
