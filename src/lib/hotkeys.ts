/** 悬浮层热键。格式与后端 global-hotkey 一致，如 "Alt+Shift+Backquote"；空字符串表示不使用 */
export type HotkeyAction =
  | "peek"
  | "adjust"
  | "scrollUp"
  | "scrollDown"
  | "pageUp"
  | "pageDown"
  | "prevSection"
  | "nextSection"
  | "toggleView";

export type Hotkeys = Record<HotkeyAction, string>;

export interface HotkeyMeta {
  id: HotkeyAction;
  label: string;
  desc?: string;
  /** 始终注册（否则只在悬浮层显示时注册） */
  global: boolean;
  required?: boolean;
}

export const HOTKEY_ACTIONS: HotkeyMeta[] = [
  { id: "peek", label: "偷看 / 固定", desc: "按住显示、松开隐藏；轻按固定 / 取消固定", global: true, required: true },
  { id: "adjust", label: "调整模式", desc: "可以用鼠标拖动位置、拖右下角缩放", global: true },
  { id: "scrollUp", label: "向上滚动", desc: "按住连续滚动", global: false },
  { id: "scrollDown", label: "向下滚动", desc: "按住连续滚动", global: false },
  { id: "pageUp", label: "上一页", global: false },
  { id: "pageDown", label: "下一页", global: false },
  { id: "prevSection", label: "上一节 / 上一步", global: false },
  { id: "nextSection", label: "下一节 / 下一步", global: false },
  { id: "toggleView", label: "切换全文 / 卡片", global: false },
];

export const DEFAULT_HOTKEYS: Hotkeys = {
  peek: "Alt+Backquote",
  adjust: "Alt+Shift+Backquote",
  scrollUp: "Alt+ArrowUp",
  scrollDown: "Alt+ArrowDown",
  pageUp: "Alt+PageUp",
  pageDown: "Alt+PageDown",
  prevSection: "Alt+BracketLeft",
  nextSection: "Alt+BracketRight",
  toggleView: "Alt+Backslash",
};

const MODS = ["Ctrl", "Alt", "Shift", "Super"] as const;
const MOD_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
]);

const KEY_LABEL: Record<string, string> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  PageUp: "PgUp",
  PageDown: "PgDn",
  Delete: "Del",
  Insert: "Ins",
  Space: "Space",
  Enter: "Enter",
  Tab: "Tab",
  Pause: "Pause",
  ScrollLock: "ScrLk",
  NumpadAdd: "Num+",
  NumpadSubtract: "Num-",
  NumpadMultiply: "Num*",
  NumpadDivide: "Num/",
  NumpadDecimal: "Num.",
  NumpadEnter: "NumEnter",
};

/** 浏览器 KeyboardEvent.code → 后端可识别的按键名 */
function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code) || /^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (/^Numpad[0-9]$/.test(code)) return code;
  if (code in KEY_LABEL || code === "Home" || code === "End") return code;
  return null;
}

/** 不加修饰键也可以作为全局热键的按键 */
const SAFE_BARE = /^(F([1-9]|1[0-9]|2[0-4])|Pause|ScrollLock|Insert|Numpad.*)$/;

const RESERVED = new Set(["Alt+Tab", "Alt+F4", "Alt+Space", "Alt+Escape", "Ctrl+Escape", "Ctrl+Alt+Delete", "Ctrl+Shift+Escape"]);

export function splitHotkey(acc: string): { mods: string[]; key: string } {
  const parts = acc.split("+").filter(Boolean);
  const key = parts.pop() ?? "";
  return { mods: parts, key };
}

export function formatHotkey(acc: string): string {
  if (!acc) return "未设置";
  const { mods, key } = splitHotkey(acc);
  const label = KEY_LABEL[key] ?? key.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num");
  return [...mods.map((m) => (m === "Super" ? "Win" : m)), label].join(" ");
}

/** 两个热键修饰键相同时合并显示，如 "Alt ↑/↓" */
export function formatPair(a: string, b: string): string {
  if (!a && !b) return "";
  if (!a || !b) return formatHotkey(a || b);
  const x = splitHotkey(a);
  const y = splitHotkey(b);
  if (x.mods.join("+") === y.mods.join("+")) {
    const fa = formatHotkey(a).split(" ").pop();
    const fb = formatHotkey(b).split(" ").pop();
    return [...x.mods.map((m) => (m === "Super" ? "Win" : m)), `${fa}/${fb}`].join(" ");
  }
  return `${formatHotkey(a)} / ${formatHotkey(b)}`;
}

export type RecordResult =
  | { kind: "pending"; preview: string }
  | { kind: "done"; value: string }
  | { kind: "error"; message: string };

/** 把一次按键转换成热键；只按了修饰键时返回 pending */
export function hotkeyFromEvent(e: KeyboardEvent, meta: HotkeyMeta): RecordResult {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  const ordered = MODS.filter((m) => mods.includes(m));
  if (MOD_CODES.has(e.code)) {
    return { kind: "pending", preview: ordered.length ? `${ordered.map((m) => (m === "Super" ? "Win" : m)).join(" ")} …` : "" };
  }
  const key = keyName(e.code);
  if (!key) return { kind: "error", message: "不支持这个按键" };
  const value = [...ordered, key].join("+");
  if (RESERVED.has(value)) return { kind: "error", message: "这是系统保留的组合键" };
  if (meta.global && ordered.length === 0 && !SAFE_BARE.test(key)) {
    return { kind: "error", message: "请配合 Ctrl / Alt / Shift 使用，避免和游戏按键冲突（F1–F24 等功能键除外）" };
  }
  return { kind: "done", value };
}

export function parseHotkeys(v: unknown): Hotkeys {
  const out: Hotkeys = { ...DEFAULT_HOTKEYS };
  if (typeof v !== "object" || v === null) return out;
  const o = v as Record<string, unknown>;
  for (const a of HOTKEY_ACTIONS) {
    const x = o[a.id];
    if (typeof x === "string" && (x !== "" || !a.required)) out[a.id] = x;
  }
  return out;
}

export const sameHotkeys = (a: Hotkeys, b: Hotkeys) => HOTKEY_ACTIONS.every((x) => a[x.id] === b[x.id]);
