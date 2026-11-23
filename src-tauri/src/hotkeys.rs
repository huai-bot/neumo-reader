//! 标准热键沿用系统注册；菜单键组合和小键盘使用物理键事件，避免 NumLock 改变键值。
use std::str::FromStr;
use tauri::{AppHandle, Runtime};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) struct Binding {
    pub shortcut: Shortcut,
    pub menu: bool,
}

impl Binding {
    pub fn parse(raw: &str) -> Result<Self, String> {
        let mut parts: Vec<_> = raw.split('+').map(str::trim).collect();
        let key = parts.pop().ok_or("缺少按键")?;
        let menu = parts.contains(&"Menu");
        parts.retain(|p| *p != "Menu");
        if key.is_empty() || parts.iter().any(|p| p.is_empty()) || (menu && key == "ContextMenu") {
            return Err("无效的组合键".into());
        }
        let main = if key == "ContextMenu" { "F24" } else { key };
        parts.push(main);
        let mut shortcut = Shortcut::from_str(&parts.join("+")).map_err(|e| e.to_string())?;
        if key == "ContextMenu" {
            shortcut = Shortcut::new(Some(shortcut.mods), Code::ContextMenu);
        }
        Ok(Self { shortcut, menu })
    }

    fn native(self) -> bool {
        self.menu || self.shortcut.key == Code::ContextMenu || self.shortcut.key.to_string().starts_with("Numpad")
    }
}

pub(crate) fn register<R: Runtime>(app: &AppHandle<R>, binding: Binding) -> Result<(), String> {
    if binding.native() {
        #[cfg(windows)]
        return native::register(binding);
        #[cfg(not(windows))]
        if binding.menu || binding.shortcut.key == Code::ContextMenu {
            return Err("菜单键组合目前仅支持 Windows".into());
        }
    }
    app.global_shortcut().register(binding.shortcut).map_err(|_| "注册失败，可能已被其他程序占用".into())
}

pub(crate) fn unregister<R: Runtime>(app: &AppHandle<R>, binding: Binding) {
    #[cfg(windows)]
    if binding.native() {
        native::unregister(binding);
        return;
    }
    let _ = app.global_shortcut().unregister(binding.shortcut);
}

pub(crate) fn init<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    #[cfg(windows)]
    return native::init(app);
    #[cfg(not(windows))]
    { let _ = app; Ok(()) }
}

pub(crate) fn shutdown<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(windows)]
    native::shutdown();
    let _ = app.global_shortcut().unregister_all();
}

pub(crate) fn menu_pressed() -> bool {
    #[cfg(windows)]
    return native::menu_pressed();
    #[cfg(not(windows))]
    false
}

#[cfg(windows)]
mod native {
    use super::Binding;
    use std::{
        collections::{HashMap, HashSet},
        sync::{mpsc, Mutex, OnceLock},
        time::Duration,
    };
    use tauri::{AppHandle, Runtime};
    use tauri_plugin_global_shortcut::{Code, Modifiers};
    use windows::Win32::{
        Foundation::{LPARAM, LRESULT, WPARAM},
        UI::WindowsAndMessaging::{
            CallNextHookEx, GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx,
            KBDLLHOOKSTRUCT, LLKHF_EXTENDED, MSG, WH_KEYBOARD_LL,
            WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
        },
    };

    struct State {
        available: bool,
        bindings: HashMap<Binding, bool>,
        held: HashSet<Code>,
        virtual_down: [bool; 256],
        swallowed: HashSet<Code>,
        events: mpsc::Sender<(Binding, bool)>,
    }
    static STATE: OnceLock<Mutex<State>> = OnceLock::new();

    pub fn init<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
        if STATE.get().is_some() { return Ok(()); }
        let (events, rx) = mpsc::channel();
        let (ready, wait) = mpsc::sync_channel(1);
        STATE.set(Mutex::new(State {
            available: false,
            bindings: HashMap::new(),
            held: HashSet::new(),
            virtual_down: [false; 256],
            swallowed: HashSet::new(),
            events,
        })).map_err(|_| "键盘监听已启动".to_string())?;
        // 回调只更新键盘状态并排队，窗口操作由独立线程处理，避免阻塞 Windows 键盘钩子。
        let app = app.clone();
        std::thread::spawn(move || {
            while let Ok((binding, pressed)) = rx.recv() {
                crate::overlay::handle_binding(&app, binding, pressed);
            }
        });
        std::thread::spawn(move || unsafe {
            let hook = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(callback), None, 0) {
                Ok(hook) => hook,
                Err(e) => { let _ = ready.send(Err(format!("键盘监听启动失败：{e}"))); return; }
            };
            if let Some(state) = STATE.get() {
                if let Ok(mut s) = state.lock() { s.available = true; }
            }
            let _ = ready.send(Ok(()));
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).0 > 0 {}
            let _ = UnhookWindowsHookEx(hook);
        });
        wait.recv_timeout(Duration::from_secs(3)).map_err(|_| "键盘监听启动超时".to_string())?
    }

    pub fn register(binding: Binding) -> Result<(), String> {
        let state = STATE.get().ok_or("键盘监听未启动")?;
        let mut s = state.lock().map_err(|_| "键盘监听不可用")?;
        if !s.available { return Err("键盘监听不可用，请重启软件".into()); }
        s.bindings.insert(binding, false);
        Ok(())
    }

    pub fn unregister(binding: Binding) {
        if let Some(state) = STATE.get() {
            if let Ok(mut s) = state.lock() {
                if s.bindings.remove(&binding) == Some(true) { let _ = s.events.send((binding, false)); }
            }
        }
    }

    pub fn shutdown() {
        if let Some(state) = STATE.get() {
            if let Ok(mut s) = state.lock() {
                s.bindings.clear();
                s.swallowed.clear();
            }
        }
    }

    pub fn menu_pressed() -> bool {
        STATE.get().and_then(|s| s.lock().ok()).is_some_and(|s| s.virtual_down[0x5d])
    }

    fn modifiers(down: &[bool; 256]) -> Modifiers {
        let mut mods = Modifiers::empty();
        if down[0x11] || down[0xa2] || down[0xa3] { mods |= Modifiers::CONTROL; }
        if down[0x12] || down[0xa4] || down[0xa5] { mods |= Modifiers::ALT; }
        if down[0x10] || down[0xa0] || down[0xa1] { mods |= Modifiers::SHIFT; }
        if down[0x5b] || down[0x5c] { mods |= Modifiers::SUPER; }
        mods
    }

    unsafe extern "system" fn callback(n: i32, w: WPARAM, l: LPARAM) -> LRESULT {
        if n < 0 { return unsafe { CallNextHookEx(None, n, w, l) }; }
        let pressed = match w.0 as u32 {
            WM_KEYDOWN | WM_SYSKEYDOWN => true,
            WM_KEYUP | WM_SYSKEYUP => false,
            _ => return unsafe { CallNextHookEx(None, n, w, l) },
        };
        let key = unsafe { &*(l.0 as *const KBDLLHOOKSTRUCT) };
        let code = code_from_event(key.vkCode, key.scanCode, key.flags.contains(LLKHF_EXTENDED));
        let mut consume = false;
        if let Some(state) = STATE.get() {
            if let Ok(mut s) = state.lock() {
                if key.vkCode < 256 { s.virtual_down[key.vkCode as usize] = pressed; }
                if let Some(code) = code {
                    if pressed { s.held.insert(code); } else { s.held.remove(&code); }
                    consume = if pressed { s.swallowed.contains(&code) } else { s.swallowed.remove(&code) };
                }
                let mods = modifiers(&s.virtual_down);
                let menu = s.virtual_down[0x5d];
                let bindings: Vec<_> = s.bindings.iter().map(|(b, active)| (*b, *active)).collect();
                for (binding, active) in bindings {
                    let matches = binding.shortcut.mods == mods
                        && (binding.menu == menu || binding.shortcut.key == Code::ContextMenu);
                    if active && (!matches || !s.held.contains(&binding.shortcut.key)) {
                        s.bindings.insert(binding, false);
                        let _ = s.events.send((binding, false));
                    } else if !active && pressed && code == Some(binding.shortcut.key) && matches {
                        s.bindings.insert(binding, true);
                        s.swallowed.insert(binding.shortcut.key);
                        consume = true;
                        let _ = s.events.send((binding, true));
                    }
                }
                // 菜单键作修饰键时拦下默认右键菜单；停用所有相关绑定后恢复系统行为。
                if code == Some(Code::ContextMenu) && s.bindings.keys().any(|b| b.menu) {
                    if pressed { s.swallowed.insert(Code::ContextMenu); }
                    consume = true;
                }
            }
        }
        if consume { LRESULT(1) } else { unsafe { CallNextHookEx(None, n, w, l) } }
    }

    /// 小键盘导航键用扫描码定位，同一物理键的数字 / 方向键两种键值归为一个按键。
    fn code_from_event(vk: u32, scan: u32, extended: bool) -> Option<Code> {
        if !extended {
            let num = match scan {
                0x52 => Some(Code::Numpad0), 0x4f => Some(Code::Numpad1), 0x50 => Some(Code::Numpad2),
                0x51 => Some(Code::Numpad3), 0x4b => Some(Code::Numpad4), 0x4c => Some(Code::Numpad5),
                0x4d => Some(Code::Numpad6), 0x47 => Some(Code::Numpad7), 0x48 => Some(Code::Numpad8),
                0x49 => Some(Code::Numpad9), 0x53 => Some(Code::NumpadDecimal), _ => None,
            };
            if num.is_some() { return num; }
        }
        let name = match vk {
            0x30..=0x39 => format!("Digit{}", vk - 0x30),
            0x41..=0x5a => format!("Key{}", char::from_u32(vk)?),
            0x70..=0x87 => format!("F{}", vk - 0x6f),
            0x60..=0x69 => format!("Numpad{}", vk - 0x60),
            _ => return Some(match vk {
                0x08 => Code::Backspace, 0x09 => Code::Tab,
                0x0d if extended => Code::NumpadEnter, 0x0d => Code::Enter,
                0x13 => Code::Pause, 0x1b => Code::Escape, 0x20 => Code::Space,
                0x21 => Code::PageUp, 0x22 => Code::PageDown, 0x23 => Code::End, 0x24 => Code::Home,
                0x25 => Code::ArrowLeft, 0x26 => Code::ArrowUp, 0x27 => Code::ArrowRight, 0x28 => Code::ArrowDown,
                0x2d => Code::Insert, 0x2e => Code::Delete, 0x5d => Code::ContextMenu,
                0x6a => Code::NumpadMultiply, 0x6b => Code::NumpadAdd, 0x6d => Code::NumpadSubtract,
                0x6e => Code::NumpadDecimal, 0x6f => Code::NumpadDivide, 0x91 => Code::ScrollLock,
                0xba => Code::Semicolon, 0xbb => Code::Equal, 0xbc => Code::Comma, 0xbd => Code::Minus,
                0xbe => Code::Period, 0xbf => Code::Slash, 0xc0 => Code::Backquote,
                0xdb => Code::BracketLeft, 0xdc | 0xe2 => Code::Backslash, 0xdd => Code::BracketRight, 0xde => Code::Quote,
                _ => return None,
            }),
        };
        Code::from_str(&name).ok()
    }

    use std::str::FromStr;

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn numpad_down_ignores_numlock_and_preserves_arrow_cluster() {
            assert_eq!(code_from_event(0x62, 0x50, false), Some(Code::Numpad2));
            assert_eq!(code_from_event(0x28, 0x50, false), Some(Code::Numpad2));
            assert_eq!(code_from_event(0x28, 0x50, true), Some(Code::ArrowDown));
            assert_eq!(code_from_event(0x0d, 0x1c, true), Some(Code::NumpadEnter));
            assert_eq!(code_from_event(0x0d, 0x1c, false), Some(Code::Enter));
        }
        #[test]
        fn menu_key_and_menu_prefix_are_distinct() {
            assert_eq!(code_from_event(0x5d, 0x5d, true), Some(Code::ContextMenu));
            let menu = Binding::parse("Menu+ArrowDown").unwrap();
            assert!(menu.menu && menu.native());
            assert_eq!(menu.shortcut.key, Code::ArrowDown);
            assert_ne!(menu, Binding::parse("ArrowDown").unwrap());
            assert!(Binding::parse("ContextMenu").unwrap().native());
            assert!(Binding::parse("Alt+ContextMenu").unwrap().native());
            assert!(Binding::parse("Menu+Numpad2").unwrap().native());
        }
    }
}
