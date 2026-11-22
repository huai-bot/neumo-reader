import type { ToastItem } from "../lib/types";
import { Lamp } from "./neu";

export function Toasts({ items }: { items: ToastItem[] }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          <Lamp state={t.tone === "warn" ? "warn" : "on"} />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
