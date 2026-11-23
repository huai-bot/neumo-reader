/** 悬浮层热键，如 "Alt+Shift+Backquote" 或 "Menu+ArrowDown"；空字符串表示不使用 */
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
export type HotkeyEnabled = Record<HotkeyAction, boolean>;

export interface HotkeyMeta {
  id: HotkeyAction;
  label: string;
  desc?: string;
  /** 始终注册（否则只在悬浮层显示时注册） */
  global: boolean;
}

export const HOTKEY_ACTIONS: HotkeyMeta[] = [
  { id: "peek", label: "偷看 / 固定", desc: "按住显示、松开隐藏；轻按固定 / 取消固定", global: true },
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

export const DEFAULT_HOTKEY_ENABLED = Object.fromEntries(HOTKEY_ACTIONS.map((a) => [a.id, true])) as HotkeyEnabled;

const MODS = ["Ctrl", "Alt", "Shift", "Super", "Menu"] as const;
const MOD_CODES = new Set([
  "ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight",
  "MetaLeft", "MetaRight", "OSLeft", "OSRight",
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
  ContextMenu: "菜单键",
  Numpad0: "Num0/Ins",
  Numpad1: "Num1/End",
  Numpad2: "Num2/↓",
  Numpad3: "Num3/PgDn",
  Numpad4: "Num4/←",
  Numpad5: "Num5",
  Numpad6: "Num6/→",
  Numpad7: "Num7/Home",
  Numpad8: "Num8/↑",
  Numpad9: "Num9/PgUp",
  NumpadAdd: "Num+",
  NumpadSubtract: "Num-",
  NumpadMultiply: "Num*",
  NumpadDivide: "Num/",
  NumpadDecimal: "Num./Del",
  NumpadEnter: "NumEnter",
};

const NUMPAD_NAV: Record<string, string> = {
  Insert: "Numpad0", End: "Numpad1", ArrowDown: "Numpad2", PageDown: "Numpad3",
  ArrowLeft: "Numpad4", Clear: "Numpad5", ArrowRight: "Numpad6", Home: "Numpad7",
  ArrowUp: "Numpad8", PageUp: "Numpad9", Delete: "NumpadDecimal", Enter: "NumpadEnter",
};

export const isMenuKey = (e: Pick<KeyboardEvent, "code" | "key">) =>
  e.code === "ContextMenu" || e.key === "ContextMenu" || e.key === "Apps";

/** 优先使用物理键位置；兼容小键盘关掉 NumLock 后的方向键及缺失 code 的键盘。 */
export function eventKeyCode(e: Pick<KeyboardEvent, "code" | "key" | "location">): string {
  if (isMenuKey(e)) return "ContextMenu";
  if (e.location === 3 && !e.code.startsWith("Numpad")) {
    const num = NUMPAD_NAV[e.key] ?? (/^[0-9]$/.test(e.key) ? `Numpad${e.key}` : undefined);
    if (num) return num;
  }
  if (e.code && e.code !== "Unidentified") return e.code;
  return e.key;
}

function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code) || /^Digit[0-9]$/.test(code) || /^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (/^Numpad[0-9]$/.test(code)) return code;
  if (code in KEY_LABEL || code === "Home" || code === "End") return code;
  return null;
}

const SAFE_BARE = /^(F([1-9]|1[0-9]|2[0-4])|Pause|ScrollLock|Insert|ContextMenu|Numpad.*)$/;
const RESERVED = new Set(["Alt+Tab", "Alt+F4", "Alt+Space", "Alt+Escape", "Ctrl+Escape", "Ctrl+Alt+Delete", "Ctrl+Shift+Escape"]);
const modLabel = (m: string) => m === "Super" ? "Win" : m === "Menu" ? "菜单键" : m;

export function splitHotkey(acc: string): { mods: string[]; key: string } {
  const parts = acc.split("+").filter(Boolean);
  const key = parts.pop() ?? "";
  return { mods: parts, key };
}

export function formatHotkey(acc: string): string {
  if (!acc) return "未设置";
  const { mods, key } = splitHotkey(acc);
  const label = KEY_LABEL[key] ?? key.replace(/^Key/, "").replace(/^Digit/, "").replace(/^Numpad/, "Num");
  return [...mods.map(modLabel), label].join(" ");
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
    return [...x.mods.map(modLabel), `${fa}/${fb}`].join(" ");
  }
  return `${formatHotkey(a)} / ${formatHotkey(b)}`;
}

export type RecordResult =
  | { kind: "pending"; preview: string }
  | { kind: "done"; value: string }
  | { kind: "error"; message: string };

/** menuHeld 由录制器跟踪，因为浏览器没有菜单键对应的 modifier 标志。 */
export function hotkeyFromEvent(e: KeyboardEvent, meta: HotkeyMeta, menuHeld = false): RecordResult {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  if (menuHeld && !isMenuKey(e)) mods.push("Menu");
  const ordered = MODS.filter((m) => mods.includes(m));
  const code = eventKeyCode(e);
  if (MOD_CODES.has(code)) {
    return { kind: "pending", preview: ordered.length ? `${ordered.map(modLabel).join(" ")} …` : "" };
  }
  const key = keyName(code);
  if (!key) return { kind: "error", message: "不支持这个按键，请换一个组合键" };
  const value = [...ordered, key].join("+");
  if (RESERVED.has(value)) return { kind: "error", message: "这是系统保留的组合键，请换一个" };
  if (meta.global && ordered.length === 0 && !SAFE_BARE.test(key)) {
    return { kind: "error", message: "请配合 Ctrl / Alt / Shift / 菜单键使用，避免和游戏按键冲突（功能键除外）" };
  }
  return { kind: "done", value };
}

export function parseHotkeys(v: unknown): Hotkeys {
  const out: Hotkeys = { ...DEFAULT_HOTKEYS };
  if (typeof v !== "object" || v === null) return out;
  const o = v as Record<string, unknown>;
  for (const a of HOTKEY_ACTIONS) {
    const x = o[a.id];
    if (typeof x === "string") out[a.id] = x;
  }
  return out;
}

export function parseHotkeyEnabled(v: unknown): HotkeyEnabled {
  const out = { ...DEFAULT_HOTKEY_ENABLED };
  if (typeof v !== "object" || v === null) return out;
  const o = v as Record<string, unknown>;
  for (const a of HOTKEY_ACTIONS) {
    if (typeof o[a.id] === "boolean") out[a.id] = o[a.id] as boolean;
  }
  return out;
}

/** 仅生效的热键发送给后端和悬浮层，关闭的组合键仍保留在设置里。 */
export function effectiveHotkeys(settings: { hotkeys: Hotkeys; hotkeyEnabled: HotkeyEnabled }): Hotkeys {
  return Object.fromEntries(HOTKEY_ACTIONS.map((a) => [a.id, settings.hotkeyEnabled[a.id] ? settings.hotkeys[a.id] : ""])) as Hotkeys;
}

export const sameHotkeys = (a: Hotkeys, b: Hotkeys) => HOTKEY_ACTIONS.every((x) => a[x.id] === b[x.id]);
