import { useEffect, useRef, useState } from "react";
import type { HotkeyMeta } from "../lib/hotkeys";
import { formatHotkey, hotkeyFromEvent } from "../lib/hotkeys";

/** 点击后录制一个组合键 */
export function HotkeyField({
  meta,
  value,
  error,
  onChange,
  onRecording,
}: {
  meta: HotkeyMeta;
  value: string;
  error?: string;
  onChange: (v: string) => void;
  onRecording: (recording: boolean) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState("");
  const [local, setLocal] = useState("");
  const btn = useRef<HTMLButtonElement>(null);
  const live = useRef({ meta, onChange, onRecording });
  live.current = { meta, onChange, onRecording };

  useEffect(() => {
    if (!recording) return;
    live.current.onRecording(true);
    const stop = () => {
      setRecording(false);
      setPreview("");
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // 捕获阶段拦下，避免触发主窗口快捷键或关闭设置
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      const noMods = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
      if (e.code === "Escape" && noMods) {
        stop();
        return;
      }
      if ((e.code === "Backspace" || e.code === "Delete") && noMods) {
        if (live.current.meta.required) setLocal("这个动作必须设置热键");
        else live.current.onChange("");
        stop();
        return;
      }
      const r = hotkeyFromEvent(e, live.current.meta);
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
      if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) setPreview("");
    };
    const onBlur = () => stop();
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      live.current.onRecording(false);
    };
  }, [recording]);

  const msg = local || error;
  return (
    <div className="hk">
      <button
        ref={btn}
        type="button"
        className={`hk-field num ${recording ? "is-recording" : ""} ${value ? "" : "is-empty"} ${msg ? "is-error" : ""}`}
        aria-label={`${meta.label}：${formatHotkey(value)}，点击修改`}
        onClick={() => {
          setLocal("");
          setRecording((r) => !r);
        }}
      >
        {recording ? preview || "请按下组合键…" : formatHotkey(value)}
      </button>
      {msg && !recording && <span className="hk-error">{msg}</span>}
    </div>
  );
}
