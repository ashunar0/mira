use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use serde::Serialize;

use crate::files::is_excluded_name;

/// 開いたフォルダの何階層下までリポジトリを探すか
const MAX_REPOSITORY_SEARCH_DEPTH: usize = 3;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitFileState {
    Modified,
    Added,
    Untracked,
    Renamed,
    Deleted,
    Conflicted,
}

#[derive(Debug, PartialEq, Serialize)]
pub struct GitFileStatus {
    path: String,
    state: GitFileState,
}

/// 成功した時の標準出力を返す。
/// optional lock を取らせない: status が .git/index を書き換えると、監視と無限ループするおそれがある。
fn run_git(dir: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let output = Command::new("git")
        .args(["--no-optional-locks", "-C"])
        .arg(dir)
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(output.stdout)
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

fn ordinary_state(xy: &str) -> GitFileState {
    if xy.contains('D') {
        GitFileState::Deleted
    } else if xy.contains('A') {
        GitFileState::Added
    } else {
        GitFileState::Modified
    }
}

/// `git status --porcelain=v2 -z` を読む。パスはリポジトリのルートからの相対パス。
fn parse_status(output: &str) -> Vec<(&str, GitFileState)> {
    let mut records = output.split('\0');
    let mut files = Vec::new();
    while let Some(record) = records.next() {
        let Some((kind, rest)) = record.split_once(' ') else {
            continue;
        };
        let xy = rest.get(..2).unwrap_or_default();
        let path_after = |fields: usize| rest.splitn(fields, ' ').nth(fields - 1);
        let entry = match kind {
            "1" => path_after(8).map(|path| (path, ordinary_state(xy))),
            "2" => {
                // リネームは、次のレコードに元のパスが続く
                records.next();
                path_after(9).map(|path| (path, GitFileState::Renamed))
            }
            "u" => path_after(10).map(|path| (path, GitFileState::Conflicted)),
            "?" => Some((rest, GitFileState::Untracked)),
            _ => None,
        };
        files.extend(entry);
    }
    files
}

/// dir より下にあるリポジトリを探す。見つけたリポジトリの中までは探さない。
fn find_repositories(dir: &Path, depth: usize, found: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let is_folder = entry.file_type().is_ok_and(|kind| kind.is_dir());
        if !is_folder || is_excluded_name(&name) || name.to_string_lossy().starts_with('.') {
            continue;
        }
        let path = entry.path();
        if path.join(".git").exists() {
            found.push(path);
        } else if depth > 1 {
            find_repositories(&path, depth - 1, found);
        }
    }
}

/// dir 以下の変更を返す。prefix はリポジトリのルートから dir までの相対パス。
fn repository_status(dir: &Path, prefix: &str) -> Vec<GitFileStatus> {
    let args = ["status", "--porcelain=v2", "-z", "--untracked-files=all", "--", "."];
    let output = match run_git(dir, &args) {
        Ok(output) => output,
        Err(error) => {
            eprintln!("git status failed in {}: {error}", dir.display());
            return Vec::new();
        }
    };
    parse_status(&String::from_utf8_lossy(&output))
        .into_iter()
        .filter_map(|(path, state)| {
            let relative = path.strip_prefix(prefix)?;
            Some(GitFileStatus {
                path: dir.join(relative).to_string_lossy().into_owned(),
                state,
            })
        })
        .collect()
}

/// root と、その下にあるリポジトリの変更を返す。Git の管理下になければ空。
/// 色分けは飾りなので、Git が使えないときも編集を止めずに空を返す。
#[tauri::command(async)]
pub fn git_status(root: String) -> Vec<GitFileStatus> {
    let root = Path::new(&root);
    let mut files = Vec::new();

    // root がリポジトリのサブフォルダのときは、status のパスからこの分を取り除く
    if let Ok(prefix) = run_git(root, &["rev-parse", "--show-prefix"]) {
        let prefix = String::from_utf8_lossy(&prefix);
        files.extend(repository_status(root, prefix.trim_end_matches('\n')));
    }

    let mut repositories = Vec::new();
    find_repositories(root, MAX_REPOSITORY_SEARCH_DEPTH, &mut repositories);
    for repository in repositories {
        files.extend(repository_status(&repository, ""));
    }
    files
}

/// 最後のコミット時点の内容を返す。そのコミットになければ None。
/// エディタと同じく BOM は除く。残すと 1 行目が変更として出てしまう。
#[tauri::command(async)]
pub fn git_head_text(path: String) -> Option<String> {
    let path = Path::new(&path);
    let dir = path.parent()?;
    let name = path.file_name()?.to_string_lossy();
    let bytes = run_git(dir, &["show", &format!("HEAD:./{name}")]).ok()?;
    let text = String::from_utf8(bytes).ok()?;
    Some(text.strip_prefix('\u{FEFF}').map(str::to_owned).unwrap_or(text))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(root: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(["-c", "user.name=mira", "-c", "user.email=mira@example.com"])
            .args(["-c", "commit.gpgsign=false", "-C"])
            .arg(root)
            .args(args)
            .output()
            .unwrap();
        assert!(status.status.success(), "{status:?}");
    }

    /// a.txt と sub/b.txt をコミット済みのリポジトリを作る
    fn temp_repo(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("mira-git-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("a.txt"), "a\n").unwrap();
        fs::write(root.join("sub/b.txt"), "b\n").unwrap();
        git(&root, &["init", "-q"]);
        git(&root, &["add", "."]);
        git(&root, &["commit", "-qm", "init"]);
        root
    }

    fn status_of(root: &Path) -> Vec<(String, GitFileState)> {
        let root = root.to_string_lossy().into_owned();
        let mut files: Vec<_> = git_status(root.clone())
            .into_iter()
            .map(|file| (file.path[root.len() + 1..].to_owned(), file.state))
            .collect();
        files.sort_by(|a, b| a.0.cmp(&b.0));
        files
    }

    #[test]
    fn parses_every_record_kind() {
        let hash = "0".repeat(40);
        let output = format!(
            "1 .M N... 100644 100644 100644 {hash} {hash} with space.txt\0\
             2 R. N... 100644 100644 100644 {hash} {hash} R100 new.txt\0old.txt\0\
             u UU N... 100644 100644 100644 100644 {hash} {hash} {hash} both.txt\0\
             ? new dir/x.txt\0"
        );
        assert_eq!(
            parse_status(&output),
            [
                ("with space.txt", GitFileState::Modified),
                ("new.txt", GitFileState::Renamed),
                ("both.txt", GitFileState::Conflicted),
                ("new dir/x.txt", GitFileState::Untracked),
            ]
        );
    }

    #[test]
    fn reports_each_kind_of_change_in_a_real_repository() {
        let root = temp_repo("kinds");
        fs::write(root.join("a.txt"), "changed\n").unwrap();
        fs::remove_file(root.join("sub/b.txt")).unwrap();
        fs::create_dir_all(root.join("new")).unwrap();
        fs::write(root.join("new/c.txt"), "c\n").unwrap();
        fs::write(root.join("staged.txt"), "s\n").unwrap();
        git(&root, &["add", "staged.txt"]);

        assert_eq!(
            status_of(&root),
            [
                ("a.txt".to_owned(), GitFileState::Modified),
                ("new/c.txt".to_owned(), GitFileState::Untracked),
                ("staged.txt".to_owned(), GitFileState::Added),
                ("sub/b.txt".to_owned(), GitFileState::Deleted),
            ]
        );
    }

    #[test]
    fn a_subfolder_of_the_repository_sees_only_its_own_changes() {
        let root = temp_repo("subfolder");
        fs::write(root.join("a.txt"), "changed\n").unwrap();
        fs::write(root.join("sub/b.txt"), "changed\n").unwrap();

        assert_eq!(
            status_of(&root.join("sub")),
            [("b.txt".to_owned(), GitFileState::Modified)]
        );
    }

    #[test]
    fn repositories_inside_a_plain_folder_are_found() {
        let root = std::env::temp_dir().join(format!("mira-git-parent-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("group")).unwrap();
        fs::create_dir_all(root.join("node_modules")).unwrap();

        for parent in ["group", "node_modules"] {
            let source = temp_repo(&format!("nested-{parent}"));
            fs::write(source.join("a.txt"), "changed\n").unwrap();
            fs::rename(&source, root.join(parent).join("repo")).unwrap();
        }

        assert_eq!(
            status_of(&root),
            [("group/repo/a.txt".to_owned(), GitFileState::Modified)]
        );
    }

    #[test]
    fn a_repository_inside_a_repository_reports_its_own_changes() {
        let root = temp_repo("outer");
        let inner = temp_repo("inner");
        fs::write(inner.join("a.txt"), "changed\n").unwrap();
        fs::rename(&inner, root.join("sub/inner")).unwrap();

        let files = status_of(&root);
        assert!(
            files.contains(&("sub/inner/a.txt".to_owned(), GitFileState::Modified)),
            "{files:?}"
        );
    }

    fn head_text(path: PathBuf) -> Option<String> {
        git_head_text(path.to_string_lossy().into_owned())
    }

    #[test]
    fn head_text_is_the_last_committed_content() {
        let root = temp_repo("head");
        fs::write(root.join("sub/b.txt"), "changed\n").unwrap();
        fs::write(root.join("new.txt"), "new\n").unwrap();

        assert_eq!(head_text(root.join("sub/b.txt")).as_deref(), Some("b\n"));
        assert_eq!(head_text(root.join("new.txt")), None);
    }

    #[test]
    fn head_text_hides_the_bom_like_the_editor_does() {
        let root = temp_repo("bom");
        fs::write(root.join("bom.txt"), b"\xEF\xBB\xBFhello\n").unwrap();
        git(&root, &["add", "bom.txt"]);
        git(&root, &["commit", "-qm", "bom"]);

        assert_eq!(head_text(root.join("bom.txt")).as_deref(), Some("hello\n"));
    }

    #[test]
    fn a_folder_outside_git_has_no_changes() {
        let root = std::env::temp_dir().join(format!("mira-nogit-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("a.txt"), "a").unwrap();
        assert_eq!(status_of(&root), []);
    }
}
