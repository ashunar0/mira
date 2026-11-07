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
use tauri::{AppHandle, Emitter, Manager, State};

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
    /// paths のうち、もうないもの。macOS は作成と変更を区別して報告できないので、ほかは区別しない
    removed: Vec<String>,
    /// OS がイベントを取りこぼした。paths は当てにせず全体を読み直す必要がある
    needs_rescan: bool,
    /// コミットやステージなどで Git の状態が変わった
    git_changed: bool,
}

/// git status の結果に関わる .git の中身か。ロックファイルなどの一時的なものは含めない。
/// 開いたフォルダの中にある別のリポジトリの .git も対象にする。
fn is_git_state_path(path: &Path) -> bool {
    let mut after_git_dir = path.components();
    if !after_git_dir.any(|component| component.as_os_str() == ".git") {
        return false;
    }
    let relative = after_git_dir.as_path();
    let is_state = relative.starts_with("refs")
        || ["HEAD", "index", "packed-refs"].iter().any(|name| relative == Path::new(name));
    is_state && relative.extension().is_none_or(|extension| extension != "lock")
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
        let mut git_changed = false;
        let mut paths = BTreeSet::new();
        for event in events.iter().filter(|event| !event.kind.is_access()) {
            needs_rescan |= event.need_rescan();
            git_changed |= event.paths.iter().any(|path| is_git_state_path(path));
            // ビルド出力などの .gitignore 対象は、フロントエンドへ通知しない
            paths.extend(event.paths.iter().filter_map(|path| {
                let mapped = to_workspace_path(path, &watched_root, &workspace_root)?;
                (!ignore_rules.is_ignored(path)).then(|| mapped.to_string_lossy().into_owned())
            }));
        }
        // イベントの種類は当てにならない（作ってすぐ消すこともある）ので、今あるかで決める
        let removed = paths.iter().filter(|path| !Path::new(path).exists()).cloned().collect();
        if needs_rescan || git_changed || !paths.is_empty() {
            on_change(FileChanges {
                paths: paths.into_iter().collect(),
                removed,
                needs_rescan,
                git_changed,
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
    // Markdown プレビューで、開いたフォルダの中の画像を読めるようにする。失敗しても画像が出ないだけ
    let _ = app.asset_protocol_scope().allow_directory(&root, true);
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
    fn reports_which_files_are_gone() {
        let root = temp_root("kinds");
        fs::write(root.join("old.ts"), "x").unwrap();
        fs::write(root.join("kept.ts"), "x").unwrap();
        let (sender, receiver) = mpsc::channel();
        let _watcher = start(&root, move |changes| sender.send(changes).unwrap()).unwrap();
        std::thread::sleep(Duration::from_millis(500));

        fs::write(root.join("new.ts"), "x").unwrap();
        fs::remove_file(root.join("old.ts")).unwrap();
        fs::write(root.join("kept.ts"), "y").unwrap();

        let (mut paths, mut removed) = (BTreeSet::new(), BTreeSet::new());
        while let Ok(changes) = receiver.recv_timeout(Duration::from_secs(2)) {
            paths.extend(changes.paths);
            removed.extend(changes.removed);
        }
        let path = |name: &str| root.join(name).to_string_lossy().into_owned();
        assert!(paths.is_superset(&BTreeSet::from([path("new.ts"), path("old.ts"), path("kept.ts")])), "{paths:?}");
        assert_eq!(removed, BTreeSet::from([path("old.ts")]));
    }

    #[test]
    fn only_git_state_files_count_as_a_git_change() {
        for path in [
            "/w/.git/HEAD",
            "/w/.git/index",
            "/w/.git/packed-refs",
            "/w/.git/refs/heads/main",
            "/w/packages/x/.git/index",
        ] {
            assert!(is_git_state_path(Path::new(path)), "{path}");
        }
        for path in [
            "/w/.git/index.lock",
            "/w/.git/refs/heads/main.lock",
            "/w/.git/objects/ab/cd",
            "/w/.git/logs/HEAD",
            "/w/a.txt",
        ] {
            assert!(!is_git_state_path(Path::new(path)), "{path}");
        }
    }

    fn git(root: &Path, args: &[&str]) {
        let output = std::process::Command::new("git")
            .args(["--no-optional-locks", "-C"])
            .arg(root)
            .args(args)
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
    }

    /// 2 秒静かになるまでに Git の変更の通知が来たか
    fn saw_git_change(receiver: &mpsc::Receiver<FileChanges>) -> bool {
        let mut seen = false;
        while let Ok(changes) = receiver.recv_timeout(Duration::from_secs(2)) {
            seen |= changes.git_changed;
        }
        seen
    }

    #[test]
    fn staging_is_noticed_but_reading_status_does_not_notify_itself() {
        let root = temp_root("git");
        fs::remove_dir_all(root.join(".git")).unwrap();
        fs::write(root.join("a.txt"), "x").unwrap();
        git(&root, &["init", "-q"]);
        // 初回の status で index が更新されないよう、先に一度ステージしておく
        git(&root, &["add", "a.txt"]);

        let (sender, receiver) = mpsc::channel();
        let _watcher = start(&root, move |changes| sender.send(changes).unwrap()).unwrap();
        std::thread::sleep(Duration::from_millis(500));
        saw_git_change(&receiver); // 監視を始める前の変更が遅れて届く分を捨てる

        crate::git::git_status(root.to_string_lossy().into_owned());
        assert!(!saw_git_change(&receiver), "status must not trigger the watcher");

        fs::write(root.join("b.txt"), "x").unwrap();
        git(&root, &["add", "b.txt"]);
        assert!(saw_git_change(&receiver), "staging must be noticed");
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
