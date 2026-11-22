import { useCallback, useRef } from "react";
import type { ButtonHTMLAttributes, CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react";

/* ---------- 按键 ---------- */

interface NeuButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 开启 / 按下状态：凹陷 + 钴蓝 */
  on?: boolean;
  size?: "sm" | "md" | "lg";
  shape?: "square" | "round" | "wide";
  tone?: "default" | "danger";
}

export function NeuButton({ on, size = "md", shape = "square", tone = "default", className = "", children, ...rest }: NeuButtonProps) {
  return (
    <button
      type="button"
      className={`nbtn nbtn-${size} nbtn-${shape} ${tone === "danger" ? "nbtn-danger" : ""} ${on ? "is-on" : ""} ${className}`}
      aria-pressed={on === undefined ? undefined : on}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ---------- 指示灯（正圆） ---------- */

export function Lamp({ state = "off", title }: { state?: "off" | "on" | "warn"; title?: string }) {
  return <span className={`lamp lamp-${state}`} title={title} aria-hidden={title ? undefined : true} />;
}

/* ---------- 开关 ---------- */

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? "is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-knob" />
    </button>
  );
}

/* ---------- 分段选择 ---------- */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="seg" role="radiogroup" aria-label={label} style={{ "--n": options.length } as CSSProperties}>
      <span className="seg-thumb" style={{ transform: `translateX(${index * 100}%)` }} />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`seg-btn ${o.value === value ? "is-active" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- 旋钮（正圆） ---------- */

const SWEEP = 135;

export function Knob({
  value,
  min,
  max,
  onChange,
  label,
  unit = "",
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  label: string;
  unit?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const steps = max - min;
  const angle = -SWEEP + ((value - min) / steps) * SWEEP * 2;

  const fromPointer = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      let a = (Math.atan2(dx, -dy) * 180) / Math.PI;
      if (a > SWEEP || a < -SWEEP) a = a > 0 ? SWEEP : -SWEEP;
      const v = Math.round(min + ((a + SWEEP) / (SWEEP * 2)) * steps);
      if (v !== value) onChange(v);
    },
    [min, steps, value, onChange],
  );

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") onChange(Math.min(max, value + 1));
    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") onChange(Math.max(min, value - 1));
    else if (e.key === "Home") onChange(min);
    else if (e.key === "End") onChange(max);
    else return;
    e.preventDefault();
  };

  return (
    <div className="knob-wrap">
      {Array.from({ length: steps + 1 }, (_, i) => {
        const a = -SWEEP + (i / steps) * SWEEP * 2;
        return (
          <span
            key={i}
            className={`knob-tick ${min + i <= value ? "is-lit" : ""} ${i % 4 === 0 ? "is-major" : ""}`}
            style={{ transform: `rotate(${a}deg) translateY(-68px)` }}
          />
        );
      })}
      <div
        ref={ref}
        className="knob"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onKeyDown={onKey}
        onWheel={(e) => onChange(Math.min(max, Math.max(min, value + (e.deltaY < 0 ? 1 : -1))))}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.classList.add("is-grabbing");
          fromPointer(e);
        }}
        onPointerMove={(e) => dragging.current && fromPointer(e)}
        onPointerUp={(e) => {
          dragging.current = false;
          e.currentTarget.classList.remove("is-grabbing");
        }}
        onPointerCancel={(e) => {
          dragging.current = false;
          e.currentTarget.classList.remove("is-grabbing");
        }}
      >
        <span className="knob-rotor" style={{ transform: `rotate(${angle}deg)` }}>
          <span className="knob-pointer" />
        </span>
        <span className="knob-value num">
          {value}
          <small>{unit}</small>
        </span>
      </div>
    </div>
  );
}
