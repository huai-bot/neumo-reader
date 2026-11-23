//! 悬浮层（Peek）：置顶、不抢焦点、鼠标穿透的阅读小窗，用全局热键控制。
//!
//! - 按住 Alt+`：显示，松开即隐藏（偷看）
//! - 轻按 Alt+`：固定显示 / 取消固定
//! - 显示期间：Alt+↑/↓ 滚动（按住连续滚动）、Alt+PgUp/PgDn 翻页、Alt+[ / ] 上一节 / 下一节
//! - Alt+Shift+`：调整模式（可用鼠标拖动、缩放）
//!
//! 显示 / 隐藏直接调用 Win32（SW_SHOWNOACTIVATE / SW_HIDE），保证不会把焦点从游戏抢走。
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState};

use crate::{monitor_for_rect, write_atomic, AppPaths};

pub const LABEL: &str = "overlay";
const BOUNDS_FILE: &str = "overlay.json";
/// 短于这个时长的按键视为“轻按”，切换固定
const TAP: Duration = Duration::from_millis(250);
/// 窗口圆角（逻辑像素），需与 peek.css 中的圆角一致
const RADIUS: f64 = 14.0;

const NAV: [(Code, &str, i32); 6] = [
    (Code::ArrowUp, "scroll", -1),
    (Code::ArrowDown, "scroll", 1),
    (Code::PageUp, "page", -1),
    (Code::PageDown, "page", 1),
    (Code::BracketLeft, "heading", -1),
    (Code::BracketRight, "heading", 1),
];

fn peek_key() -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT), Code::Backquote)
}
fn adjust_key() -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::Backquote)
}
fn nav_key(code: Code) -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT), code)
}

#[derive(Serialize, Deserialize, Clone, Copy)]
struct Bounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

struct Inner {
    visible: bool,
    pinned: bool,
    interactive: bool,
    pressed_at: Option<Instant>,
    was_pinned: bool,
    blur: bool,
    bounds: Option<Bounds>,
    hotkey_error: Option<String>,
    data_dir: Option<PathBuf>,
}

pub struct Overlay {
    inner: Mutex<Inner>,
    /// 串行化导航热键的注册 / 注销
    nav_lock: Mutex<bool>,
}

impl Default for Overlay {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                visible: false,
                pinned: false,
                interactive: false,
                pressed_at: None,
                was_pinned: false,
                blur: true,
                bounds: None,
                hotkey_error: None,
                data_dir: None,
            }),
            nav_lock: Mutex::new(false),
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VisiblePayload {
    visible: bool,
    pinned: bool,
    interactive: bool,
}

#[derive(Clone, Serialize)]
struct NavPayload {
    action: &'static str,
    dir: i32,
    held: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayStatus {
    available: bool,
    hotkey_error: Option<String>,
    visible: bool,
    pinned: bool,
}

fn window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(LABEL)
}

/* ---------------- 创建 ---------------- */

pub fn create<R: Runtime>(app: &AppHandle<R>, data_dir: &Path, webview_dir: Option<PathBuf>) -> tauri::Result<()> {
    let saved: Option<Bounds> = fs::read(data_dir.join(BOUNDS_FILE))
        .ok()
        .and_then(|b| serde_json::from_slice::<Bounds>(&b).ok())
        .filter(|b| b.width >= 240 && b.height >= 200);

    let mut builder = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html".into()))
        .title("拟物阅读 · 悬浮层")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .focused(false)
        .focusable(false)
        .visible(true)
        .disable_drag_drop_handler()
        .min_inner_size(260.0, 220.0);
    if let Some(dir) = webview_dir {
        builder = builder.data_directory(dir);
    }

    let monitors = app.available_monitors().unwrap_or_default();
    match saved.and_then(|b| monitor_for_rect(&monitors, b.x, b.y).map(|m| (b, m))) {
        Some((b, m)) => {
            let sf = m.scale_factor();
            builder = builder
                .inner_size(b.width as f64 / sf, b.height as f64 / sf)
                .position(b.x as f64 / sf, b.y as f64 / sf);
        }
        None => {
            // 默认放在主显示器右侧
            let (w, h, x, y) = match app.primary_monitor().ok().flatten() {
                Some(m) => {
                    let sf = m.scale_factor();
                    let (mw, mh) = (m.size().width as f64 / sf, m.size().height as f64 / sf);
                    let (mx, my) = (m.position().x as f64 / sf, m.position().y as f64 / sf);
                    let w = 440.0_f64.min(mw * 0.4);
                    let h = 680.0_f64.min(mh - 180.0);
                    (w, h, mx + mw - w - 28.0, my + 90.0)
                }
                None => (440.0, 640.0, 40.0, 90.0),
            };
            builder = builder.inner_size(w, h).position(x, y);
        }
    }

    let win = builder.build()?;
    // 鼠标穿透（tao 会同时加上 WS_EX_LAYERED）；之后的切换直接改扩展样式，不再经过 tao
    let _ = win.set_ignore_cursor_events(true);
    platform::hide(&win);

    let state = app.state::<Overlay>();
    if let Ok(mut st) = state.inner.lock() {
        st.data_dir = Some(data_dir.to_path_buf());
        st.bounds = current_bounds(&win);
        platform::blur(&win, st.blur);
    }
    update_region(&win);
    Ok(())
}

pub fn register_hotkeys<R: Runtime>(app: &AppHandle<R>) {
    let gs = app.global_shortcut();
    let mut errors = Vec::new();
    if let Err(e) = gs.register(peek_key()) {
        errors.push(format!("Alt+`：{e}"));
    }
    if let Err(e) = gs.register(adjust_key()) {
        errors.push(format!("Alt+Shift+`：{e}"));
    }
    if !errors.is_empty() {
        if let Ok(mut st) = app.state::<Overlay>().inner.lock() {
            st.hotkey_error = Some(errors.join("；"));
        }
    }
}

/* ---------------- 热键 ---------------- */

enum Act {
    Nothing,
    Show,
    Hide,
    Notify,
}

pub fn handle<R: Runtime>(app: &AppHandle<R>, sc: &Shortcut, ev: ShortcutEvent) {
    let pressed = ev.state == ShortcutState::Pressed;
    if *sc == peek_key() {
        on_peek(app, pressed);
    } else if *sc == adjust_key() {
        if pressed {
            toggle_interactive(app);
        }
    } else if let Some((_, action, dir)) = NAV.iter().find(|(c, _, _)| *sc == nav_key(*c)) {
        // 滚动支持按住连续滚动，因此按下 / 松开都转发；其余只在按下时触发
        if *action == "scroll" || pressed {
            let _ = app.emit_to(
                LABEL,
                "peek:nav",
                NavPayload {
                    action,
                    dir: *dir,
                    held: pressed,
                },
            );
        }
    }
}

fn on_peek<R: Runtime>(app: &AppHandle<R>, pressed: bool) {
    let act = {
        let state = app.state::<Overlay>();
        let Ok(mut st) = state.inner.lock() else {
            return;
        };
        if pressed {
            if st.pressed_at.is_some() {
                Act::Nothing
            } else {
                st.pressed_at = Some(Instant::now());
                st.was_pinned = st.pinned;
                if st.visible {
                    Act::Nothing
                } else {
                    st.visible = true;
                    Act::Show
                }
            }
        } else {
            match st.pressed_at.take() {
                None => Act::Nothing,
                Some(at) if at.elapsed() < TAP => {
                    if st.was_pinned {
                        st.pinned = false;
                        st.visible = false;
                        Act::Hide
                    } else {
                        st.pinned = true;
                        Act::Notify
                    }
                }
                Some(_) if st.pinned => Act::Nothing,
                Some(_) => {
                    st.visible = false;
                    Act::Hide
                }
            }
        }
    };
    apply(app, act);
}

fn toggle_interactive<R: Runtime>(app: &AppHandle<R>) {
    let act = {
        let state = app.state::<Overlay>();
        let Ok(mut st) = state.inner.lock() else {
            return;
        };
        st.interactive = !st.interactive;
        if st.interactive {
            // 进入调整模式时自动固定显示
            st.pinned = true;
            if st.visible {
                Act::Notify
            } else {
                st.visible = true;
                Act::Show
            }
        } else {
            Act::Notify
        }
    };
    apply(app, act);
}

/// 主窗口按钮：固定显示 / 隐藏
pub fn toggle<R: Runtime>(app: &AppHandle<R>) {
    let act = {
        let state = app.state::<Overlay>();
        let Ok(mut st) = state.inner.lock() else {
            return;
        };
        if st.visible {
            st.visible = false;
            st.pinned = false;
            Act::Hide
        } else {
            st.visible = true;
            st.pinned = true;
            Act::Show
        }
    };
    apply(app, act);
}

fn apply<R: Runtime>(app: &AppHandle<R>, act: Act) {
    let Some(win) = window(app) else {
        return;
    };
    let (visible, pinned, interactive) = {
        let state = app.state::<Overlay>();
        let Ok(mut st) = state.inner.lock() else {
            return;
        };
        if matches!(act, Act::Hide) {
            st.interactive = false;
        }
        (st.visible, st.pinned, st.interactive)
    };
    match act {
        Act::Nothing => return,
        Act::Show => platform::show(&win),
        Act::Hide => {
            platform::hide(&win);
            save_bounds(app);
        }
        Act::Notify => {}
    }
    platform::click_through(&win, !interactive);
    let _ = app.emit_to(
        LABEL,
        "peek:visible",
        VisiblePayload {
            visible,
            pinned,
            interactive,
        },
    );
    if matches!(act, Act::Show | Act::Hide) {
        sync_nav(app);
    }
}

/// 导航热键只在悬浮层显示时注册，避免平时占用 Alt+↑ 等系统按键。
/// 插件的注册会等待主线程，所以放到单独线程执行。
fn sync_nav<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<Overlay>();
        let Ok(mut registered) = state.nav_lock.lock() else {
            return;
        };
        let want = state.inner.lock().map(|s| s.visible).unwrap_or(false);
        if want == *registered {
            return;
        }
        let gs = app.global_shortcut();
        for (code, _, _) in NAV {
            let sc = nav_key(code);
            if want {
                let _ = gs.register(sc);
            } else {
                let _ = gs.unregister(sc);
            }
        }
        *registered = want;
    });
}

/* ---------------- 窗口事件与位置记忆 ---------------- */

fn current_bounds<R: Runtime>(win: &WebviewWindow<R>) -> Option<Bounds> {
    let p = win.outer_position().ok()?;
    let s = win.inner_size().ok()?;
    Some(Bounds {
        x: p.x,
        y: p.y,
        width: s.width,
        height: s.height,
    })
}

fn update_region<R: Runtime>(win: &WebviewWindow<R>) {
    if let (Ok(size), Ok(sf)) = (win.inner_size(), win.scale_factor()) {
        platform::round(win, size.width as i32, size.height as i32, (RADIUS * sf).round() as i32);
    }
}

pub fn on_event(window: &Window, event: &WindowEvent) {
    let Some(win) = window.app_handle().get_webview_window(LABEL) else {
        return;
    };
    match event {
        WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
            if matches!(event, WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }) {
                update_region(&win);
            }
            let b = current_bounds(&win);
            if let Ok(mut st) = window.app_handle().state::<Overlay>().inner.lock() {
                if b.is_some() {
                    st.bounds = b;
                }
            }
        }
        _ => {}
    }
}

pub fn save_bounds<R: Runtime>(app: &AppHandle<R>) {
    let (bounds, dir) = {
        let state = app.state::<Overlay>();
        let Ok(st) = state.inner.lock() else {
            return;
        };
        (st.bounds, st.data_dir.clone())
    };
    let (Some(b), Some(dir)) = (bounds, dir) else {
        return;
    };
    if let Ok(bytes) = serde_json::to_vec_pretty(&b) {
        let _ = write_atomic(&dir.join(BOUNDS_FILE), &bytes);
    }
}

/// 主窗口关闭时一并关闭悬浮层，否则进程会因为还有窗口而不退出
pub fn on_main_destroyed<R: Runtime>(app: &AppHandle<R>) {
    save_bounds(app);
    let _ = app.global_shortcut().unregister_all();
    if let Some(w) = window(app) {
        let _ = w.destroy();
    }
}

/* ---------------- 命令 ---------------- */

/// 主窗口页面加载完成后调用。
/// 不在 setup 里创建：两个 WebView2 同时用同一个数据目录初始化会报“资源在使用中”。
/// 必须是 async 命令：同步命令跑在主线程上，在里面创建窗口会死锁。
#[tauri::command]
pub async fn overlay_init(app: AppHandle) -> Result<(), String> {
    if window(&app).is_some() {
        return Ok(());
    }
    let (data_dir, webview_dir) = {
        let paths = app.state::<AppPaths>();
        let dir = paths.data_dir.clone();
        let wv = paths.portable.then(|| dir.join("webview"));
        (dir, wv)
    };
    create(&app, &data_dir, webview_dir).map_err(|e| e.to_string())?;
    register_hotkeys(&app);
    // 创建过程中系统可能短暂激活了悬浮层，把焦点还给主窗口
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub fn overlay_toggle(app: AppHandle) {
    toggle(&app);
}

#[tauri::command]
pub fn overlay_set_blur(app: AppHandle, enabled: bool) {
    if let Ok(mut st) = app.state::<Overlay>().inner.lock() {
        st.blur = enabled;
    }
    if let Some(w) = window(&app) {
        platform::blur(&w, enabled);
    }
}

#[tauri::command]
pub fn overlay_status(app: AppHandle) -> OverlayStatus {
    let st = app.state::<Overlay>();
    let st = st.inner.lock();
    match st {
        Ok(s) => OverlayStatus {
            available: window(&app).is_some(),
            hotkey_error: s.hotkey_error.clone(),
            visible: s.visible,
            pinned: s.pinned,
        },
        Err(_) => OverlayStatus {
            available: false,
            hotkey_error: None,
            visible: false,
            pinned: false,
        },
    }
}

/* ---------------- 平台实现 ---------------- */

#[cfg(windows)]
mod platform {
    use tauri::{Runtime, WebviewWindow};
    use windows::core::{s, w};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn};
    use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, ShowWindow, GWL_EXSTYLE, HWND_TOPMOST, SWP_NOACTIVATE,
        SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_HIDE, WS_EX_LAYERED, WS_EX_TRANSPARENT,
    };

    fn hwnd<R: Runtime>(win: &WebviewWindow<R>) -> Option<HWND> {
        win.hwnd().ok().map(|h| HWND(h.0 as _))
    }

    /// 显示但不激活，并重新确认置顶（全屏游戏可能把自己提到最前）
    pub fn show<R: Runtime>(win: &WebviewWindow<R>) {
        if let Some(h) = hwnd(win) {
            unsafe {
                let _ = SetWindowPos(
                    h,
                    Some(HWND_TOPMOST),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
                );
            }
        }
    }

    pub fn hide<R: Runtime>(win: &WebviewWindow<R>) {
        if let Some(h) = hwnd(win) {
            unsafe {
                let _ = ShowWindow(h, SW_HIDE);
            }
        }
    }

    pub fn click_through<R: Runtime>(win: &WebviewWindow<R>, on: bool) {
        let Some(h) = hwnd(win) else {
            return;
        };
        unsafe {
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
            let t = WS_EX_TRANSPARENT.0 as isize;
            let next = if on {
                ex | t | WS_EX_LAYERED.0 as isize
            } else {
                ex & !t
            };
            if next != ex {
                SetWindowLongPtrW(h, GWL_EXSTYLE, next);
            }
        }
    }

    pub fn round<R: Runtime>(win: &WebviewWindow<R>, w: i32, h: i32, r: i32) {
        let Some(hw) = hwnd(win) else {
            return;
        };
        unsafe {
            let rgn = CreateRoundRectRgn(0, 0, w + 1, h + 1, r * 2, r * 2);
            // 设置成功后区域归系统所有，不需要手动释放
            let _ = SetWindowRgn(hw, Some(rgn), true);
        }
    }

    #[repr(C)]
    struct AccentPolicy {
        accent_state: u32,
        accent_flags: u32,
        gradient_color: u32,
        animation_id: u32,
    }

    #[repr(C)]
    struct CompositionAttribute {
        attribute: u32,
        data: *mut core::ffi::c_void,
        size: usize,
    }

    const WCA_ACCENT_POLICY: u32 = 19;
    const ACCENT_DISABLED: u32 = 0;
    const ACCENT_ENABLE_ACRYLICBLURBEHIND: u32 = 4;

    /// 背景模糊。DWM 的系统背景（Mica / Acrylic backdrop）在窗口未激活时会退化为纯色，
    /// 悬浮层永远不激活，所以改用 SetWindowCompositionAttribute 的亚克力模糊。
    pub fn blur<R: Runtime>(win: &WebviewWindow<R>, on: bool) {
        let Some(h) = hwnd(win) else {
            return;
        };
        unsafe {
            let Ok(user32) = GetModuleHandleW(w!("user32.dll")) else {
                return;
            };
            let Some(f) = GetProcAddress(user32, s!("SetWindowCompositionAttribute")) else {
                return;
            };
            let f: unsafe extern "system" fn(HWND, *mut CompositionAttribute) -> i32 = std::mem::transmute(f);
            let mut policy = AccentPolicy {
                accent_state: if on { ACCENT_ENABLE_ACRYLICBLURBEHIND } else { ACCENT_DISABLED },
                accent_flags: 0,
                // AABBGGRR：极淡的暖米白，真正的底色由页面绘制
                gradient_color: 0x01E0_E8F2,
                animation_id: 0,
            };
            let mut data = CompositionAttribute {
                attribute: WCA_ACCENT_POLICY,
                data: &mut policy as *mut _ as *mut core::ffi::c_void,
                size: std::mem::size_of::<AccentPolicy>(),
            };
            f(h, &mut data);
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use tauri::{Runtime, WebviewWindow};
    pub fn show<R: Runtime>(win: &WebviewWindow<R>) {
        let _ = win.show();
    }
    pub fn hide<R: Runtime>(win: &WebviewWindow<R>) {
        let _ = win.hide();
    }
    pub fn click_through<R: Runtime>(win: &WebviewWindow<R>, on: bool) {
        let _ = win.set_ignore_cursor_events(on);
    }
    pub fn round<R: Runtime>(_: &WebviewWindow<R>, _: i32, _: i32, _: i32) {}
    pub fn blur<R: Runtime>(_: &WebviewWindow<R>, _: bool) {}
}
