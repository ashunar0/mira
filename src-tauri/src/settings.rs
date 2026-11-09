//! ユーザーの設定ファイル（~/.config/mira/settings.json）の場所と監視。中身の解釈はフロントエンドが受け持つ。

use std::{
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use notify_debouncer_full::{
    new_debouncer,
    notify::{RecommendedWatcher, RecursiveMode},
    DebounceEventResult, Debouncer, RecommendedCache,
};
use tauri::{AppHandle, Emitter, Manager};

const DEBOUNCE: Duration = Duration::from_millis(200);
const INITIAL_CONTENT: &str = "// Mira の設定。VS Code の settings.json と同じ名前で書く\n{\n}\n";

/// 監視を止めないよう、アプリが終わるまで持っておく
#[derive(Default)]
pub struct SettingsWatcher(Mutex<Option<Debouncer<RecommendedWatcher, RecommendedCache>>>);

fn settings_file() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(Path::new(&home).join(".config/mira/settings.json"))
}

/// ファイルがなければ、空の設定で作る。開いて書き始められるように
fn ensure_exists(path: &Path) -> io::Result<()> {
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, INITIAL_CONTENT)
}

/// 監視するフォルダ。dotfiles の管理でリンクにしていると、書き換わるのはリンク先なので、その親も見る
fn watched_dirs(path: &Path) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = path.parent().map(Path::to_path_buf).into_iter().collect();
    let target_dir = fs::canonicalize(path).ok().and_then(|target| target.parent().map(Path::to_path_buf));
    if let Some(target_dir) = target_dir.filter(|dir| fs::canonicalize(&dirs[0]).ok().as_ref() != Some(dir)) {
        dirs.push(target_dir);
    }
    dirs
}

fn is_settings_event(event_path: &Path, path: &Path) -> bool {
    event_path == path || fs::canonicalize(path).is_ok_and(|target| event_path == target)
        // macOS は実体のパス（/private/var など）で報告することがある
        || event_path.file_name() == path.file_name()
            && fs::canonicalize(event_path.parent().unwrap_or(event_path)).ok()
                == path.parent().and_then(|parent| fs::canonicalize(parent).ok())
}

/// 起動時に呼ぶ。設定ファイルが変わったら "settings-changed" を送る。失敗しても既定の設定で動く
pub fn start_watching(app: &AppHandle) {
    let Some(path) = settings_file() else { return };
    if let Err(error) = ensure_exists(&path) {
        eprintln!("cannot create settings file: {error}");
        return;
    }
    let handle = app.clone();
    let file = path.clone();
    let handler = move |result: DebounceEventResult| {
        let changed = match result {
            Ok(events) => events
                .iter()
                .filter(|event| !event.kind.is_access())
                .flat_map(|event| &event.paths)
                .any(|event_path| is_settings_event(event_path, &file)),
            // 取りこぼしたかもしれないので、読み直してもらう
            Err(_) => true,
        };
        if changed {
            let _ = handle.emit("settings-changed", ());
        }
    };
    let mut debouncer = match new_debouncer(DEBOUNCE, None, handler) {
        Ok(debouncer) => debouncer,
        Err(error) => {
            eprintln!("cannot watch settings: {error}");
            return;
        }
    };
    for dir in watched_dirs(&path) {
        if let Err(error) = debouncer.watch(&dir, RecursiveMode::NonRecursive) {
            eprintln!("cannot watch {}: {error}", dir.display());
        }
    }
    *app.state::<SettingsWatcher>().0.lock().unwrap() = Some(debouncer);
}

#[tauri::command]
pub fn settings_path() -> Option<String> {
    settings_file().map(|path| path.to_string_lossy().into_owned())
}

/// 設定ファイルの中身。読めなければ空にして、既定の設定で動かす
#[tauri::command(async)]
pub fn read_settings() -> String {
    settings_file().and_then(|path| fs::read_to_string(path).ok()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mira-settings-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn creates_the_file_with_its_folder_and_never_overwrites() {
        let path = temp_dir("create").join("mira/settings.json");
        ensure_exists(&path).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), INITIAL_CONTENT);
        fs::write(&path, "{\"a\": 1}").unwrap();
        ensure_exists(&path).unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "{\"a\": 1}");
    }

    #[test]
    fn a_linked_file_is_watched_where_it_really_lives() {
        let root = temp_dir("link");
        fs::create_dir_all(root.join("dotfiles")).unwrap();
        fs::create_dir_all(root.join("config")).unwrap();
        fs::write(root.join("dotfiles/settings.json"), "{}").unwrap();
        let link = root.join("config/settings.json");
        std::os::unix::fs::symlink(root.join("dotfiles/settings.json"), &link).unwrap();

        let dirs = watched_dirs(&link);
        assert_eq!(dirs.len(), 2, "{dirs:?}");
        let target = fs::canonicalize(root.join("dotfiles/settings.json")).unwrap();
        assert!(is_settings_event(&target, &link));
        assert!(!is_settings_event(&root.join("config/other.json"), &link));
    }

    #[test]
    fn a_plain_file_watches_only_its_folder() {
        let path = temp_dir("plain").join("settings.json");
        ensure_exists(&path).unwrap();
        assert_eq!(watched_dirs(&path).len(), 1);
        let real = fs::canonicalize(&path).unwrap();
        assert!(is_settings_event(&real, &path));
    }
}
