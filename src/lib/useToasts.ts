import { useCallback, useState } from "react";
import type { ToastItem, ToastTone } from "./types";

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const pushToast = useCallback((text: string, tone: ToastTone = "info") => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3600);
  }, []);
  return { toasts, pushToast };
}
