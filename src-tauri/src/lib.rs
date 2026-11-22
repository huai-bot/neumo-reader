use serde::Serialize;
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::Mutex,
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024;
const STATE_FILE: &str = "state.json";

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

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(STATE_FILE))
}

#[tauri::command]
fn load_state(app: AppHandle) -> Result<Option<String>, String> {
    let path = state_path(&app)?;
    match fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn save_state(app: AppHandle, state: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&state).map_err(|e| e.to_string())?;
    let path = state_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, state).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn take_startup_file(state: State<'_, StartupFile>) -> Option<String> {
    state.0.lock().ok().and_then(|mut f| f.take())
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
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cwd = std::env::current_dir().unwrap_or_default();
    let startup = extract_file_arg(std::env::args(), &cwd);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            if let Some(file) = extract_file_arg(args, Path::new(&cwd)) {
                let _ = app.emit("open-file", file);
            }
            focus_main(app);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(StartupFile(Mutex::new(startup)))
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            file_stat,
            load_state,
            save_state,
            take_startup_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Floral Reader");
}
