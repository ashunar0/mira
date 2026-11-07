use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use tauri::{AppHandle, Emitter, Manager, State, Url};

/// `mira .`（中身は `open -b <identifier> <path>`）で渡されたフォルダ。
/// 起動直後はフロントエンドがまだ聞いていないので、取りに来るまで預かる。
#[derive(Default)]
pub struct PendingFolder(Mutex<Option<String>>);

/// OS から開くよう頼まれたもののうち、最後のフォルダを預けてフロントエンドに知らせる。
/// ファイルは扱わない。
pub fn handle_opened(app: &AppHandle, urls: &[Url]) {
    let Some(folder) = urls
        .iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter(|path| path.is_dir())
        .map(|path| folder_path(&path))
        .last()
    else {
        return;
    };
    *app.state::<PendingFolder>().0.lock().unwrap() = Some(folder);
    let _ = app.emit("pending-folder", ());
}

/// フォルダの URL は末尾が / なので、⌘O で選んだときと同じ形に揃える
fn folder_path(path: &Path) -> String {
    path.components().collect::<PathBuf>().to_string_lossy().into_owned()
}

#[tauri::command]
pub fn take_pending_folder(pending: State<PendingFolder>) -> Option<String> {
    pending.0.lock().unwrap().take()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folder_urls_lose_the_trailing_slash() {
        let url = Url::parse("file:///Users/me/my%20site/").unwrap();
        assert_eq!(folder_path(&url.to_file_path().unwrap()), "/Users/me/my site");
    }
}
