use std::{ffi::OsStr, fs, io, path::Path, time::UNIX_EPOCH};

use ignore::WalkBuilder;
use serde::Serialize;

/// VS Code と同じく、巨大ファイルでエディタごと固まらないよう上限を設ける。
const MAX_TEXT_FILE_BYTES: u64 = 50 * 1024 * 1024;
const BINARY_SNIFF_BYTES: usize = 8 * 1024;
const UTF8_BOM: &[u8] = &[0xEF, 0xBB, 0xBF];
/// 巨大なリポジトリでもパレットが固まらないよう、列挙するファイル数に上限を設ける。
const MAX_WORKSPACE_FILES: usize = 100_000;
/// VS Code の files.exclude と search.exclude の既定値
const EXCLUDED_NAMES: &[&str] = &[
    ".git",
    ".svn",
    ".hg",
    ".jj",
    ".DS_Store",
    "Thumbs.db",
    "node_modules",
    "bower_components",
];

pub fn is_excluded_name(name: &OsStr) -> bool {
    EXCLUDED_NAMES.iter().any(|excluded| name == OsStr::new(excluded))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FileErrorKind {
    NotFound,
    AlreadyExists,
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

    pub fn watch(error: impl std::fmt::Display) -> Self {
        Self::new(FileErrorKind::Io, format!("Unable to watch for file changes: {error}"))
    }
}

impl From<io::Error> for FileError {
    fn from(error: io::Error) -> Self {
        let kind = match error.kind() {
            io::ErrorKind::NotFound => FileErrorKind::NotFound,
            io::ErrorKind::AlreadyExists => FileErrorKind::AlreadyExists,
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

/// Quick Open 用の一覧。VS Code と同じく隠しファイルは含め、.gitignore に従う。
#[tauri::command(async)]
pub fn list_workspace_files(root: String) -> Result<Vec<String>, FileError> {
    fs::metadata(&root)?;
    let mut paths: Vec<String> = WalkBuilder::new(&root)
        .hidden(false)
        .filter_entry(|entry| !is_excluded_name(entry.file_name()))
        .build()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_some_and(|kind| kind.is_file()))
        .take(MAX_WORKSPACE_FILES)
        .map(|entry| entry.path().to_string_lossy().into_owned())
        .collect();
    paths.sort_unstable();
    Ok(paths)
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

fn create_parents(path: &Path) -> io::Result<()> {
    match path.parent() {
        Some(parent) => fs::create_dir_all(parent),
        None => Ok(()),
    }
}

/// 名前に a/b.ts のようなパスが入っていたら途中のフォルダも作る。既にあれば上書きせず失敗する。
#[tauri::command(async)]
pub fn create_file(path: String) -> Result<(), FileError> {
    let target = Path::new(&path);
    create_parents(target)?;
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)?;
    Ok(())
}

#[tauri::command(async)]
pub fn create_directory(path: String) -> Result<(), FileError> {
    let target = Path::new(&path);
    create_parents(target)?;
    fs::create_dir(target)?;
    Ok(())
}

/// 移動先に別のファイルがあれば上書きせず失敗する。
/// a.ts → A.ts のような大文字小文字だけの変更は、macOS では同じファイルを指すので許す。
#[tauri::command(async)]
pub fn rename_path(from: String, to: String) -> Result<(), FileError> {
    let (source, target) = (Path::new(&from), Path::new(&to));
    let is_same_file = || {
        matches!(
            (fs::canonicalize(source), fs::canonicalize(target)),
            (Ok(a), Ok(b)) if a == b
        )
    };
    if fs::symlink_metadata(target).is_ok() && !is_same_file() {
        return Err(io::Error::from(io::ErrorKind::AlreadyExists).into());
    }
    create_parents(target)?;
    fs::rename(source, target)?;
    Ok(())
}

/// 完全には消さず、ゴミ箱へ移す。
#[tauri::command(async)]
pub fn trash_path(path: String) -> Result<(), FileError> {
    trash::delete(&path).map_err(|error| FileError::new(FileErrorKind::Io, error.to_string()))
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
    fn workspace_listing_follows_gitignore_and_keeps_hidden_files() {
        let root = std::env::temp_dir().join(format!("mira-walk-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        for dir in [".git", "src", "node_modules/pkg", "dist"] {
            fs::create_dir_all(root.join(dir)).unwrap();
        }
        for file in [
            ".gitignore",
            ".env.example",
            "src/a.ts",
            "dist/out.js",
            "node_modules/pkg/index.js",
            ".git/config",
        ] {
            fs::write(root.join(file), "dist\n").unwrap();
        }

        let listed = list_workspace_files(root.to_string_lossy().into_owned()).unwrap();
        let relative: Vec<_> = listed
            .iter()
            .map(|path| path.strip_prefix(&format!("{}/", root.display())).unwrap())
            .collect();
        assert_eq!(relative, [".env.example", ".gitignore", "src/a.ts"]);
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mira-ops-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn string(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn create_file_makes_parents_and_never_overwrites() {
        let dir = temp_dir("create");
        let target = dir.join("a/b/c.txt");
        create_file(string(&target)).unwrap();
        assert!(target.is_file());

        fs::write(&target, "keep").unwrap();
        let error = create_file(string(&target)).err().unwrap();
        assert!(matches!(error.kind, FileErrorKind::AlreadyExists));
        assert_eq!(fs::read(&target).unwrap(), b"keep");
    }

    #[test]
    fn create_directory_refuses_an_existing_name() {
        let dir = temp_dir("mkdir");
        create_directory(string(&dir.join("x/y"))).unwrap();
        assert!(dir.join("x/y").is_dir());
        let error = create_directory(string(&dir.join("x/y"))).err().unwrap();
        assert!(matches!(error.kind, FileErrorKind::AlreadyExists));
    }

    #[test]
    fn rename_never_overwrites_another_file() {
        let dir = temp_dir("rename");
        fs::write(dir.join("a.txt"), "a").unwrap();
        fs::write(dir.join("b.txt"), "b").unwrap();
        let error = rename_path(string(&dir.join("a.txt")), string(&dir.join("b.txt")));
        assert!(matches!(error.err().unwrap().kind, FileErrorKind::AlreadyExists));
        assert_eq!(fs::read(dir.join("b.txt")).unwrap(), b"b");

        rename_path(string(&dir.join("a.txt")), string(&dir.join("sub/c.txt"))).unwrap();
        assert_eq!(fs::read(dir.join("sub/c.txt")).unwrap(), b"a");
        assert!(!dir.join("a.txt").exists());
    }

    #[test]
    fn rename_allows_changing_only_the_case() {
        let dir = temp_dir("case");
        fs::write(dir.join("readme.md"), "x").unwrap();
        rename_path(string(&dir.join("readme.md")), string(&dir.join("README.md"))).unwrap();
        let names: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["README.md"]);
    }

    #[test]
    fn missing_file_is_not_found() {
        let error = read_text_file("/nonexistent/mira".into()).err().unwrap();
        assert!(matches!(error.kind, FileErrorKind::NotFound));
    }
}
