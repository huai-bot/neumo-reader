use crate::{decode, modified_ms, normalize, write_atomic, AppPaths, TextFile, MAX_FILE_BYTES};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fs, io::{ErrorKind, Write}, path::{Path, PathBuf}, sync::Mutex};
use tauri::{State, WebviewWindow};

#[derive(Default)]
pub(crate) struct Opened(Mutex<HashSet<PathBuf>>);

impl Opened {
    pub(crate) fn remember(&self, path: &Path) -> Result<(), String> {
        self.0.lock().map_err(|_| "文件列表暂不可用")?.insert(path.to_path_buf());
        Ok(())
    }
}

pub(crate) fn revision(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }

fn main_only(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" { Ok(()) } else { Err("请在主窗口中操作".into()) }
}

fn annotation_file(paths: &AppPaths, key: &str) -> PathBuf {
    paths.data_dir.join("annotations").join(format!("{}.json", revision(key.as_bytes())))
}

#[tauri::command]
pub(crate) fn load_annotations(window: WebviewWindow, paths: State<'_, AppPaths>, key: String) -> Result<Option<String>, String> {
    main_only(&window)?;
    match fs::read_to_string(annotation_file(&paths, &key)) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub(crate) fn save_annotations(window: WebviewWindow, paths: State<'_, AppPaths>, key: String, marks: String) -> Result<(), String> {
    main_only(&window)?;
    serde_json::from_str::<Vec<serde_json::Value>>(&marks).map_err(|error| error.to_string())?;
    write_atomic(&annotation_file(&paths, &key), marks.as_bytes()).map_err(|error| error.to_string())
}

fn encode_like(original: &[u8], input: &str) -> Result<(String, Vec<u8>, &'static str), String> {
    use encoding_rs::{Encoding, GB18030, UTF_16BE, UTF_16LE, UTF_8};
    let (old, name) = decode(original)?;
    let (encoding, bom) = Encoding::for_bom(original).unwrap_or((if name == "GB18030" { GB18030 } else { UTF_8 }, 0));
    if encoding.decode_without_bom_handling_and_without_replacement(&original[bom..]).is_none() {
        return Err("原文件包含无法解码的字符，为避免丢字，未写入文件。".into());
    }
    let crlf = old.matches("\r\n").count();
    let lf = old.bytes().filter(|byte| *byte == b'\n').count() - crlf;
    let cr = old.bytes().filter(|byte| *byte == b'\r').count() - crlf;
    let newline = if crlf > 0 && crlf >= lf && crlf >= cr { "\r\n" } else if cr > lf { "\r" } else { "\n" };
    let content = input.replace("\r\n", "\n").replace('\r', "\n").replace('\n', newline);
    let mut bytes = original[..bom].to_vec();
    if encoding == UTF_16LE || encoding == UTF_16BE {
        for unit in content.encode_utf16() {
            let pair = if encoding == UTF_16LE { unit.to_le_bytes() } else { unit.to_be_bytes() };
            bytes.extend_from_slice(&pair);
        }
    } else if encoding == UTF_8 {
        bytes.extend_from_slice(content.as_bytes());
    } else {
        let (encoded, _, lossy) = encoding.encode(&content);
        if lossy { return Err("原编码无法保存这些字符，草稿已保留。".into()); }
        bytes.extend_from_slice(&encoded);
    }
    Ok((content, bytes, name))
}

fn save_to_path(path: &Path, expected: &str, input: &str) -> Result<TextFile, String> {
    let conflict = "原文件已被其他程序修改。草稿已保留，请先复制修改，再重新打开原文件。";
    let meta = fs::metadata(path).map_err(|_| "原文件不可用，草稿已保留。")?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES { return Err(conflict.into()); }
    if meta.permissions().readonly() { return Err("文件是只读的，草稿已保留。".into()); }
    let original = fs::read(path).map_err(|error| error.to_string())?;
    if revision(&original) != expected { return Err(conflict.into()); }
    let (content, bytes, encoding) = encode_like(&original, input)?;
    if bytes.len() as u64 > MAX_FILE_BYTES { return Err("保存后会超过 64 MB，草稿已保留。".into()); }
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().ok_or("文件路径无效")?).map_err(|error| error.to_string())?;
    temp.as_file().set_permissions(meta.permissions()).map_err(|error| error.to_string())?;
    temp.write_all(&bytes).and_then(|_| temp.as_file().sync_all()).map_err(|error| error.to_string())?;
    if fs::read(path).map_err(|_| conflict)? != original { return Err(conflict.into()); }
    let saved = temp.persist(path).map_err(|error| error.to_string())?;
    let meta = saved.metadata().map_err(|error| error.to_string())?;
    Ok(TextFile {
        path: path.to_string_lossy().into_owned(), name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(),
        content, encoding: encoding.into(), size: meta.len(), modified: modified_ms(&meta), revision: revision(&bytes),
    })
}

#[tauri::command]
pub(crate) async fn save_document(window: WebviewWindow, opened: State<'_, Opened>, path: String, expected: String, content: String) -> Result<TextFile, String> {
    main_only(&window)?;
    let path = normalize(Path::new(&path));
    if !opened.0.lock().map_err(|_| "文件列表暂不可用")?.contains(&path) { return Err("请先打开该文件".into()); }
    tauri::async_runtime::spawn_blocking(move || save_to_path(&path, &expected, &content)).await.map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn editor_preserves_encoding_and_detects_conflicts() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("sample.txt");
        let old = "中文\r\n原文";
        let gb = encoding_rs::GB18030.encode(old).0.into_owned();
        for bytes in [old.as_bytes().to_vec(), [b"\xef\xbb\xbf".as_slice(), old.as_bytes()].concat(), gb,
            [vec![255,254], old.encode_utf16().flat_map(u16::to_le_bytes).collect()].concat(),
            [vec![254,255], old.encode_utf16().flat_map(u16::to_be_bytes).collect()].concat()] {
            fs::write(&file, &bytes).unwrap();
            let saved = save_to_path(&file, &revision(&bytes), "中文\n改写").unwrap();
            let output = fs::read(&file).unwrap();
            assert_eq!(decode(&output).unwrap().0, "中文\r\n改写");
            assert_eq!(encoding_rs::Encoding::for_bom(&bytes), encoding_rs::Encoding::for_bom(&output));
            assert_eq!(decode(&bytes).unwrap().1, saved.encoding);
            fs::write(&file, b"external").unwrap();
            assert!(save_to_path(&file, &saved.revision, "stale").is_err());
            assert_eq!(fs::read(&file).unwrap(), b"external");
        }
    }
}
