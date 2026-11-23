mod overlay;
mod tray;

use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant, UNIX_EPOCH},
};
use tauri::{
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, State, WebviewWindowBuilder,
    Window, WindowEvent,
};

const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
const STATE_FILE: &str = "state.json";
const WINDOW_FILE: &str = "window.json";
/// 软件目录下存在其中任一文件即启用便携模式
const PORTABLE_MARKERS: [&str; 2] = ["portable.flag", "portable"];
const PORTABLE_DATA_DIR: &str = "data";

/* ---------------- 数据目录 ---------------- */

struct AppPaths {
    data_dir: PathBuf,
    portable: bool,
    /// 有便携标记，但软件目录不可写，已回退到用户目录
    portable_failed: bool,
}

fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
}

fn writable(dir: &Path) -> bool {
    if fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".write-test");
    match fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// 返回 (便携数据目录, 便携模式是否因不可写而失败)
fn detect_portable() -> (Option<PathBuf>, bool) {
    let Some(dir) = exe_dir() else {
        return (None, false);
    };
    if !PORTABLE_MARKERS.iter().any(|m| dir.join(m).is_file()) {
        return (None, false);
    }
    let data = dir.join(PORTABLE_DATA_DIR);
    if writable(&data) {
        (Some(normalize(&data)), false)
    } else {
        (None, true)
    }
}

/* ---------------- 文件读取 ---------------- */

/// 通过文件关联 / 命令行启动时传入的文件，前端启动后取走一次。
struct StartupFile(Mutex<Option<String>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TextFile {
    path: String,
    name: String,
    content: String,
    modified: f64,
    size: u64,
    encoding: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileStat {
    exists: bool,
    modified: f64,
    size: u64,
}

fn normalize(p: &Path) -> PathBuf {
    dunce::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

fn modified_ms(meta: &fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64() * 1000.0)
        .unwrap_or(0.0)
}

fn io_msg(e: &std::io::Error) -> String {
    match e.kind() {
        ErrorKind::NotFound => "文件不存在".into(),
        ErrorKind::PermissionDenied => "没有读取权限".into(),
        _ => e.to_string(),
    }
}

/// 自动识别编码：BOM（UTF-8 / UTF-16LE / UTF-16BE）→ UTF-8 → GB18030
fn decode(bytes: &[u8]) -> Result<(String, &'static str), String> {
    if let Some((enc, bom_len)) = encoding_rs::Encoding::for_bom(bytes) {
        let (text, _) = enc.decode_without_bom_handling(&bytes[bom_len..]);
        return Ok((text.into_owned(), enc.name()));
    }
    let head = &bytes[..bytes.len().min(8192)];
    if head.iter().filter(|b| **b == 0).count() > head.len() / 64 + 1 {
        return Err("这不是文本文件".into());
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => Ok((s.to_owned(), "UTF-8")),
        Err(_) => {
            let (text, _, _) = encoding_rs::GB18030.decode(bytes);
            Ok((text.into_owned(), "GB18030"))
        }
    }
}

#[tauri::command]
fn read_text_file(app: AppHandle, path: String) -> Result<TextFile, String> {
    let p = normalize(Path::new(&path));
    let meta = fs::metadata(&p).map_err(|e| io_msg(&e))?;
    if meta.is_dir() {
        return Err("这是一个文件夹".into());
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err("文件过大（超过 64 MB）".into());
    }
    let bytes = fs::read(&p).map_err(|e| io_msg(&e))?;
    let (content, encoding) = decode(&bytes)?;

    // 允许正文引用同目录及上一级目录中的本地图片
    let scope = app.asset_protocol_scope();
    if let Some(parent) = p.parent() {
        let _ = scope.allow_directory(parent, true);
        if let Some(grand) = parent.parent() {
            let _ = scope.allow_directory(grand, true);
        }
    }

    Ok(TextFile {
        name: p
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: p.to_string_lossy().into_owned(),
        content,
        modified: modified_ms(&meta),
        size: meta.len(),
        encoding: encoding.to_string(),
    })
}

#[tauri::command]
fn file_stat(path: String) -> FileStat {
    match fs::metadata(&path) {
        Ok(meta) if meta.is_file() => FileStat {
            exists: true,
            modified: modified_ms(&meta),
            size: meta.len(),
        },
        _ => FileStat {
            exists: false,
            modified: 0.0,
            size: 0,
        },
    }
}

/* ---------------- 应用状态 ---------------- */

fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, data)?;
    fs::rename(&tmp, path)
}

#[tauri::command]
fn load_state(paths: State<'_, AppPaths>) -> Result<Option<String>, String> {
    match fs::read_to_string(paths.data_dir.join(STATE_FILE)) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn save_state(paths: State<'_, AppPaths>, state: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&state).map_err(|e| e.to_string())?;
    write_atomic(&paths.data_dir.join(STATE_FILE), state.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn take_startup_file(state: State<'_, StartupFile>) -> Option<String> {
    state.0.lock().ok().and_then(|mut f| f.take())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    portable: bool,
    portable_failed: bool,
    data_dir: String,
}

#[tauri::command]
fn app_info(paths: State<'_, AppPaths>) -> AppInfo {
    AppInfo {
        portable: paths.portable,
        portable_failed: paths.portable_failed,
        data_dir: paths.data_dir.to_string_lossy().into_owned(),
    }
}

#[tauri::command]
fn open_data_dir(paths: State<'_, AppPaths>) -> Result<(), String> {
    let dir = &paths.data_dir;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/* ---------------- 窗口大小与位置 ---------------- */

#[derive(Serialize, Deserialize, Clone, Copy)]
struct WinBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    maximized: bool,
}

/// 窗口跟踪：committed 为最近一次“稳定”的普通状态位置大小。
/// 最大化时系统会先发一次带最大化尺寸的移动事件，再更新最大化标记，
/// 因此新的位置要稳定 300ms 以上才会提交，避免把最大化尺寸当成普通尺寸。
#[derive(Default)]
struct Track {
    committed: Option<WinBounds>,
    pending: Option<(WinBounds, Instant)>,
    maximized: bool,
}

struct WinState(Mutex<Track>);

const SETTLE: Duration = Duration::from_millis(300);

/// 找到包含该位置的显示器：标题栏左上角 120×40 的区域需要落在显示器内，避免窗口“消失”在屏幕外
fn monitor_for(monitors: &[Monitor], b: &WinBounds) -> Option<Monitor> {
    monitor_for_rect(monitors, b.x, b.y)
}

fn monitor_for_rect(monitors: &[Monitor], x: i32, y: i32) -> Option<Monitor> {
    let b = WinBounds {
        x,
        y,
        width: 0,
        height: 0,
        maximized: false,
    };
    monitors
        .iter()
        .find(|m| {
            let p = m.position();
            let s = m.size();
            let (mr, mb) = (p.x + s.width as i32, p.y + s.height as i32);
            b.x + 120 > p.x && b.x < mr - 40 && b.y >= p.y - 8 && b.y + 40 < mb
        })
        .cloned()
}

fn load_bounds(data_dir: &Path) -> Option<WinBounds> {
    fs::read(data_dir.join(WINDOW_FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<WinBounds>(&bytes).ok())
        .filter(|b| b.width >= 400 && b.height >= 300)
}

fn bounds_of(pos: Option<PhysicalPosition<i32>>, size: Option<PhysicalSize<u32>>) -> Option<WinBounds> {
    match (pos, size) {
        (Some(p), Some(s)) => Some(WinBounds {
            x: p.x,
            y: p.y,
            width: s.width,
            height: s.height,
            maximized: false,
        }),
        _ => None,
    }
}

fn record_bounds(
    state: &WinState,
    maximized: bool,
    minimized: bool,
    pos: Option<PhysicalPosition<i32>>,
    size: Option<PhysicalSize<u32>>,
) {
    let Ok(mut t) = state.0.lock() else {
        return;
    };
    if minimized {
        return;
    }
    // 之前的候选值如果已经稳定足够久，先提交
    if let Some((b, at)) = t.pending.take() {
        if at.elapsed() >= SETTLE {
            t.committed = Some(b);
        }
    }
    t.maximized = maximized;
    if maximized {
        return;
    }
    if let Some(b) = bounds_of(pos, size) {
        t.pending = Some((b, Instant::now()));
    }
}

fn track_window(window: &Window) {
    record_bounds(
        &window.state::<WinState>(),
        window.is_maximized().unwrap_or(false),
        window.is_minimized().unwrap_or(false),
        window.outer_position().ok(),
        window.inner_size().ok(),
    );
}

fn save_window(window: &Window) {
    let maximized = window.is_maximized().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(false);
    let state = window.state::<WinState>();
    let bounds = {
        let Ok(mut t) = state.0.lock() else {
            return;
        };
        if !maximized && !minimized {
            // 普通状态：直接取当前值
            bounds_of(window.outer_position().ok(), window.inner_size().ok())
        } else {
            if let Some((b, at)) = t.pending.take() {
                if at.elapsed() >= SETTLE {
                    t.committed = Some(b);
                }
            }
            t.committed.map(|mut b| {
                b.maximized = if minimized { t.maximized } else { true };
                b
            })
        }
    };
    let Some(b) = bounds else {
        return;
    };
    let dir = window.state::<AppPaths>().data_dir.clone();
    if let Ok(bytes) = serde_json::to_vec_pretty(&b) {
        let _ = write_atomic(&dir.join(WINDOW_FILE), &bytes);
    }
}

/* ---------------- 启动 ---------------- */

/// 0.1.0 使用旧标识，首次运行新版本时把设置与阅读记录迁移过来（不删除旧文件）
const LEGACY_IDENTIFIER: &str = "com.masu.floral-reader";

fn migrate_legacy(dir: &Path) {
    if dir.join(STATE_FILE).exists() {
        return;
    }
    let Some(old) = dir.parent().map(|p| p.join(LEGACY_IDENTIFIER)) else {
        return;
    };
    let src = old.join(STATE_FILE);
    if !src.is_file() || fs::create_dir_all(dir).is_err() {
        return;
    }
    let _ = fs::copy(&src, dir.join(STATE_FILE));
    let win = old.join(WINDOW_FILE);
    if win.is_file() {
        let _ = fs::copy(&win, dir.join(WINDOW_FILE));
    }
}

/// 从命令行参数中取出第一个存在的文件路径（相对路径基于 cwd 解析）
fn extract_file_arg<I, S>(args: I, cwd: &Path) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter().skip(1).find_map(|arg| {
        let arg = arg.as_ref();
        if arg.starts_with('-') || arg.is_empty() {
            return None;
        }
        let raw = PathBuf::from(arg);
        let p = if raw.is_absolute() { raw } else { cwd.join(raw) };
        p.is_file()
            .then(|| normalize(&p).to_string_lossy().into_owned())
    })
}

fn focus_main(app: &AppHandle) {
    tray::show_main(app);
}

/// 保存主窗口大小位置（隐藏到托盘、从托盘退出时调用）
pub(crate) fn save_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        save_window(&w.as_ref().window());
    }
}

/// 关闭按钮选择“收到托盘”时：隐藏主窗口，程序留在后台
#[tauri::command]
fn hide_main(app: AppHandle) {
    save_main_window(&app);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

/// 前端保存完状态后调用，真正退出程序
#[tauri::command]
fn quit_app(app: AppHandle) {
    save_main_window(&app);
    overlay::save_bounds(&app);
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cwd = std::env::current_dir().unwrap_or_default();
    let startup = extract_file_arg(std::env::args(), &cwd);
    let (portable_dir, portable_failed) = detect_portable();

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some(file) = extract_file_arg(args, Path::new(&cwd)) {
                let _ = app.emit("open-file", file);
            }
            focus_main(app);
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| overlay::handle(app, shortcut, event))
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(StartupFile(Mutex::new(startup)))
        .manage(WinState(Mutex::new(Track::default())))
        .manage(overlay::Overlay::default())
        .setup(move |app| {
            let data_dir = match &portable_dir {
                Some(dir) => dir.clone(),
                None => {
                    let dir = app.path().app_config_dir()?;
                    migrate_legacy(&dir);
                    dir
                }
            };
            fs::create_dir_all(&data_dir)?;
            app.manage(AppPaths {
                data_dir: data_dir.clone(),
                portable: portable_dir.is_some(),
                portable_failed,
            });

            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .cloned()
                .ok_or("tauri.conf.json 缺少 main 窗口配置")?;
            let mut builder = WebviewWindowBuilder::from_config(app.handle(), &config)?.visible(false);
            if let Some(dir) = &portable_dir {
                // 便携模式下 WebView2 的缓存也放在软件目录
                builder = builder.data_directory(dir.join("webview"));
            }
            // 在创建窗口时就给出上次的位置和大小（逻辑像素），避免创建后再移动被改回
            let saved = load_bounds(&data_dir);
            let monitors = app.available_monitors().unwrap_or_default();
            match saved.and_then(|b| monitor_for(&monitors, &b).map(|m| (b, m))) {
                Some((b, m)) => {
                    let sf = m.scale_factor();
                    builder = builder
                        .inner_size(b.width as f64 / sf, b.height as f64 / sf)
                        .position(b.x as f64 / sf, b.y as f64 / sf);
                }
                None => builder = builder.center(),
            }
            let window = builder.build()?;
            let track = window.state::<WinState>();
            if let Ok(mut t) = track.0.lock() {
                t.committed = bounds_of(window.outer_position().ok(), window.inner_size().ok());
                t.maximized = saved.is_some_and(|b| b.maximized);
            }
            if saved.is_some_and(|b| b.maximized) {
                let _ = window.maximize();
            }
            window.show()?;
            let _ = window.set_focus();
            if let Err(e) = tray::create(app.handle()) {
                eprintln!("创建托盘图标失败：{e}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == overlay::LABEL {
                overlay::on_event(window, event);
                return;
            }
            match event {
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => track_window(window),
                WindowEvent::CloseRequested { .. } => save_window(window),
                WindowEvent::Destroyed => overlay::on_main_destroyed(window.app_handle()),
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            file_stat,
            load_state,
            save_state,
            take_startup_file,
            app_info,
            open_data_dir,
            hide_main,
            quit_app,
            overlay::overlay_init,
            overlay::overlay_set_hotkeys,
            overlay::overlay_suspend_hotkeys,
            overlay::overlay_toggle,
            overlay::overlay_set_blur,
            overlay::overlay_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running the reader");
}
