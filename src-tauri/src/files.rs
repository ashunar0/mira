use std::{fs, io, path::Path, time::UNIX_EPOCH};

use serde::Serialize;

/// VS Code と同じく、巨大ファイルでエディタごと固まらないよう上限を設ける。
const MAX_TEXT_FILE_BYTES: u64 = 50 * 1024 * 1024;
const BINARY_SNIFF_BYTES: usize = 8 * 1024;
const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileErrorKind {
    NotFound,
    Binary,
    TooLarge,
    Conflict,
    Io,
}

#[derive(Debug, Serialize)]
pub struct FileError {
    kind: FileErrorKind,
    message: String,
}

impl FileError {
    fn new(kind: FileErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

impl From<io::Error> for FileError {
    fn from(error: io::Error) -> Self {
        let kind = match error.kind() {
            io::ErrorKind::NotFound => FileErrorKind::NotFound,
            _ => FileErrorKind::Io,
        };
        Self::new(kind, error.to_string())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    name: String,
    path: String,
    is_directory: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    text: String,
    has_bom: bool,
    mtime_ms: u64,
}

fn mtime_ms(metadata: &fs::Metadata) -> io::Result<u64> {
    let elapsed = metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .map_err(io::Error::other)?;
    Ok(elapsed.as_millis() as u64)
}

#[tauri::command(async)]
pub fn read_directory(path: String) -> Result<Vec<DirEntry>, FileError> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(&path)? {
        let entry = entry?;
        // シンボリックリンクはリンク先で判定する。リンク切れはファイル扱いにして一覧には残す。
        let is_directory = fs::metadata(entry.path()).is_ok_and(|m| m.is_dir());
        entries.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            is_directory,
        });
    }
    Ok(entries)
}

#[tauri::command(async)]
pub fn read_text_file(path: String) -> Result<FileContent, FileError> {
    let metadata = fs::metadata(&path)?;
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err(FileError::new(
            FileErrorKind::TooLarge,
            "The file is too large to open in the editor.",
        ));
    }

    let bytes = fs::read(&path)?;
    let binary_error = || {
        FileError::new(
            FileErrorKind::Binary,
            "The file is not displayed in the text editor because it is either binary or uses an unsupported text encoding.",
        )
    };
    let sniff_len = bytes.len().min(BINARY_SNIFF_BYTES);
    if bytes[..sniff_len].contains(&0) {
        return Err(binary_error());
    }

    let has_bom = bytes.starts_with(UTF8_BOM);
    let body = if has_bom {
        bytes[UTF8_BOM.len()..].to_vec()
    } else {
        bytes
    };
    let text = String::from_utf8(body).map_err(|_| binary_error())?;

    Ok(FileContent {
        text,
        has_bom,
        mtime_ms: mtime_ms(&metadata)?,
    })
}

/// `expected_mtime_ms` が渡されたら、開いた後に外部で変更されていないことを確かめてから書く。
/// リネーム経由の atomic write にはせず上書きする（権限とシンボリックリンクを保つため。VS Code の既定と同じ）。
#[tauri::command(async)]
pub fn write_text_file(
    path: String,
    text: String,
    has_bom: bool,
    expected_mtime_ms: Option<u64>,
) -> Result<u64, FileError> {
    let target = Path::new(&path);

    if let Some(expected) = expected_mtime_ms {
        match fs::metadata(target) {
            Ok(metadata) if mtime_ms(&metadata)? != expected => {
                return Err(FileError::new(
                    FileErrorKind::Conflict,
                    "The content of the file on disk is newer.",
                ));
            }
            // 外部で削除されたファイルは、保存で作り直す。
            Err(error) if error.kind() != io::ErrorKind::NotFound => return Err(error.into()),
            _ => {}
        }
    }

    let mut bytes = Vec::with_capacity(text.len() + UTF8_BOM.len());
    if has_bom {
        bytes.extend_from_slice(UTF8_BOM);
    }
    bytes.extend_from_slice(text.as_bytes());
    fs::write(target, bytes)?;

    Ok(mtime_ms(&fs::metadata(target)?)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_file(name: &str, bytes: &[u8]) -> String {
        let dir = std::env::temp_dir().join(format!("mira-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        fs::write(&path, bytes).unwrap();
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn bom_is_hidden_from_the_editor_and_restored_on_save() {
        let path = temp_file("bom.txt", b"\xEF\xBB\xBFhello");
        let content = read_text_file(path.clone()).unwrap();
        assert_eq!(content.text, "hello");
        assert!(content.has_bom);

        write_text_file(path.clone(), "bye".into(), true, None).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"\xEF\xBB\xBFbye");
    }

    #[test]
    fn line_endings_survive_a_round_trip() {
        let path = temp_file("crlf.txt", b"a\r\nb\r\n");
        let content = read_text_file(path.clone()).unwrap();
        write_text_file(path.clone(), content.text, false, None).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"a\r\nb\r\n");
    }

    #[test]
    fn binary_and_invalid_utf8_are_refused() {
        let nul = temp_file("nul.bin", b"ab\0cd");
        assert!(matches!(read_text_file(nul).err().unwrap().kind, FileErrorKind::Binary));
        let latin1 = temp_file("latin1.txt", b"caf\xE9");
        assert!(matches!(read_text_file(latin1).err().unwrap().kind, FileErrorKind::Binary));
    }

    #[test]
    fn stale_mtime_is_a_conflict_and_leaves_the_file_alone() {
        let path = temp_file("conflict.txt", b"disk");
        let mtime = read_text_file(path.clone()).unwrap().mtime_ms;
        let error = write_text_file(path.clone(), "mine".into(), false, Some(mtime + 1));
        assert!(matches!(error.err().unwrap().kind, FileErrorKind::Conflict));
        assert_eq!(fs::read(&path).unwrap(), b"disk");

        write_text_file(path.clone(), "mine".into(), false, Some(mtime)).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"mine");
    }

    #[test]
    fn saving_recreates_an_externally_deleted_file() {
        let path = temp_file("deleted.txt", b"x");
        let mtime = read_text_file(path.clone()).unwrap().mtime_ms;
        fs::remove_file(&path).unwrap();
        write_text_file(path.clone(), "back".into(), false, Some(mtime)).unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"back");
    }

    #[test]
    fn missing_file_is_not_found() {
        let error = read_text_file("/nonexistent/mira".into()).err().unwrap();
        assert!(matches!(error.kind, FileErrorKind::NotFound));
    }
}
