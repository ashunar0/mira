use std::{path::PathBuf, sync::Mutex};

use tauri::{AppHandle, Emitter, Manager, State, Url};

/// `mira .`（中身は `open -a mira <path>`）で渡されたフォルダ。
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
        .map(|path: PathBuf| path.to_string_lossy().into_owned())
        .last()
    else {
        return;
    };
    *app.state::<PendingFolder>().0.lock().unwrap() = Some(folder);
    let _ = app.emit("pending-folder", ());
}

#[tauri::command]
pub fn take_pending_folder(pending: State<PendingFolder>) -> Option<String> {
    pending.0.lock().unwrap().take()
}
