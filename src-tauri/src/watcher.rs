use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use notify_debouncer_full::{
    new_debouncer,
    notify::{RecommendedWatcher, RecursiveMode},
    DebounceEventResult, Debouncer, RecommendedCache,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::{
    files::{is_excluded_name, FileError},
    ignore_rules::IgnoreRules,
};

const DEBOUNCE: Duration = Duration::from_millis(200);

type WorkspaceDebouncer = Debouncer<RecommendedWatcher, RecommendedCache>;

/// 監視中のフォルダ。フォルダを開き直すと差し替わり、前の監視は止まる。
#[derive(Default)]
pub struct WorkspaceWatcher(Mutex<Option<WorkspaceDebouncer>>);

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChanges {
    paths: Vec<String>,
    /// OS がイベントを取りこぼした。paths は当てにせず全体を読み直す必要がある
    needs_rescan: bool,
}

/// OS は実体のパスを返す（macOS の /tmp は /private/tmp など）ので、開いた時のパスに戻す。
/// 監視対象から除くものは None を返す。
fn to_workspace_path(path: &Path, real_root: &Path, root: &Path) -> Option<PathBuf> {
    let relative = path.strip_prefix(real_root).ok()?;
    let is_excluded = relative
        .components()
        .any(|component| is_excluded_name(component.as_os_str()));
    (!is_excluded).then(|| root.join(relative))
}

fn start(
    root: &Path,
    on_change: impl Fn(FileChanges) + Send + 'static,
) -> Result<WorkspaceDebouncer, FileError> {
    let real_root = fs::canonicalize(root)?;
    let workspace_root = root.to_path_buf();
    let watched_root = real_root.clone();
    let mut ignore_rules = IgnoreRules::new(&real_root);

    let handler = move |result: DebounceEventResult| {
        let events = match result {
            Ok(events) => events,
            Err(errors) => {
                eprintln!("file watcher error: {errors:?}");
                on_change(FileChanges {
                    needs_rescan: true,
                    ..FileChanges::default()
                });
                return;
            }
        };

        let touches_gitignore = events.iter().flat_map(|event| &event.paths).any(|path| {
            path.file_name().is_some_and(|name| name == ".gitignore")
        });
        if touches_gitignore {
            ignore_rules.clear_cache();
        }

        let mut needs_rescan = false;
        let mut paths = BTreeSet::new();
        for event in events.iter().filter(|event| !event.kind.is_access()) {
            needs_rescan |= event.need_rescan();
            // ビルド出力などの .gitignore 対象は、フロントエンドへ通知しない
            paths.extend(event.paths.iter().filter_map(|path| {
                let mapped = to_workspace_path(path, &watched_root, &workspace_root)?;
                (!ignore_rules.is_ignored(path)).then(|| mapped.to_string_lossy().into_owned())
            }));
        }
        if needs_rescan || !paths.is_empty() {
            on_change(FileChanges {
                paths: paths.into_iter().collect(),
                needs_rescan,
            });
        }
    };

    let mut debouncer = new_debouncer(DEBOUNCE, None, handler).map_err(FileError::watch)?;
    debouncer
        .watch(&real_root, RecursiveMode::Recursive)
        .map_err(FileError::watch)?;
    Ok(debouncer)
}

#[tauri::command(async)]
pub fn watch_workspace(
    app: AppHandle,
    watcher: State<'_, WorkspaceWatcher>,
    root: String,
) -> Result<(), FileError> {
    let debouncer = start(Path::new(&root), move |changes| {
        let _ = app.emit("files-changed", changes);
    })?;
    *watcher.0.lock().unwrap() = Some(debouncer);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("mira-watch-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".git")).unwrap();
        root
    }

    /// 2 秒静かになるまでの変更をまとめて返す
    fn collect(receiver: &mpsc::Receiver<FileChanges>) -> BTreeSet<String> {
        let mut paths = BTreeSet::new();
        while let Ok(changes) = receiver.recv_timeout(Duration::from_secs(2)) {
            paths.extend(changes.paths);
        }
        paths
    }

    #[test]
    fn reports_changes_with_the_opened_path_and_skips_excluded_folders() {
        let root = temp_root("changes");
        let (sender, receiver) = mpsc::channel();
        let _watcher = start(&root, move |changes| sender.send(changes).unwrap()).unwrap();
        std::thread::sleep(Duration::from_millis(500));

        fs::write(root.join("a.txt"), "x").unwrap();
        fs::write(root.join(".git/index"), "x").unwrap();

        let paths = collect(&receiver);
        let expected = root.join("a.txt").to_string_lossy().into_owned();
        assert!(paths.contains(&expected), "{paths:?}");
        assert!(!paths.iter().any(|path| path.contains("/.git/")), "{paths:?}");
    }

    #[test]
    fn build_output_in_gitignored_folders_is_not_reported() {
        let root = temp_root("build");
        fs::write(root.join(".gitignore"), "target/\n").unwrap();
        fs::create_dir_all(root.join("target/debug")).unwrap();
        let (sender, receiver) = mpsc::channel();
        let _watcher = start(&root, move |changes| sender.send(changes).unwrap()).unwrap();
        std::thread::sleep(Duration::from_millis(500));

        for index in 0..500 {
            fs::write(root.join(format!("target/debug/{index}.o")), "x").unwrap();
        }
        fs::write(root.join("kept.txt"), "x").unwrap();

        let paths = collect(&receiver);
        let kept = root.join("kept.txt").to_string_lossy().into_owned();
        assert!(paths.contains(&kept), "{paths:?}");
        assert!(!paths.iter().any(|path| path.contains("/target/")), "{paths:?}");
    }

    #[test]
    fn maps_real_paths_back_to_the_opened_root() {
        let mapped = to_workspace_path(
            Path::new("/private/tmp/w/src/a.ts"),
            Path::new("/private/tmp/w"),
            Path::new("/tmp/w"),
        );
        assert_eq!(mapped, Some(PathBuf::from("/tmp/w/src/a.ts")));
    }

    #[test]
    fn excluded_folders_are_dropped_at_any_depth() {
        let root = Path::new("/w");
        assert_eq!(to_workspace_path(Path::new("/w/node_modules/a/b.js"), root, root), None);
        assert_eq!(to_workspace_path(Path::new("/w/packages/x/.git/HEAD"), root, root), None);
    }
}
