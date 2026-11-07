use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use ignore::{
    gitignore::{Gitignore, GitignoreBuilder},
    Match,
};

/// パスが git の無視対象かを判定する。ファイル一覧の WalkBuilder と同じく、
/// git リポジトリの中でだけ .gitignore、.git/info/exclude、グローバル設定に従う。
pub struct IgnoreRules {
    repo_root: Option<PathBuf>,
    /// フォルダごとの .gitignore。ビルド中は同じフォルダを何度も聞かれるので読み直さない
    per_directory: HashMap<PathBuf, Gitignore>,
    exclude: Gitignore,
    global: Gitignore,
}

fn load(directory: &Path, file: &Path) -> Gitignore {
    let mut builder = GitignoreBuilder::new(directory);
    // 読めないファイルや不正な行は、無いものとして扱う
    let _ = builder.add(file);
    builder.build().unwrap_or_else(|_| Gitignore::empty())
}

impl IgnoreRules {
    pub fn new(root: &Path) -> Self {
        let repo_root = root
            .ancestors()
            .find(|directory| directory.join(".git").exists())
            .map(Path::to_path_buf);
        let exclude = repo_root.as_deref().map_or_else(Gitignore::empty, |repo| {
            load(repo, &repo.join(".git/info/exclude"))
        });
        Self {
            repo_root,
            per_directory: HashMap::new(),
            exclude,
            global: Gitignore::global().0,
        }
    }

    /// .gitignore が書き換えられたら呼ぶ
    pub fn clear_cache(&mut self) {
        self.per_directory.clear();
    }

    /// 上の階層から順に調べ、無視されたフォルダに当たったらそこで打ち切る。
    /// git と同じく、無視されたフォルダの中は再び含められない。
    pub fn is_ignored(&mut self, path: &Path) -> bool {
        let Some(repo_root) = self.repo_root.clone() else {
            return false;
        };
        let Ok(relative) = path.strip_prefix(&repo_root) else {
            return false;
        };

        let mut current = repo_root.clone();
        for component in relative.components() {
            current.push(component);
            // 途中の階層は必ずフォルダ。末端は消えていると判定できないのでファイル扱いになる
            let is_directory = current != path || path.is_dir();
            if self.decide(&repo_root, &current, is_directory) {
                return true;
            }
        }
        false
    }

    fn decide(&mut self, repo_root: &Path, path: &Path, is_directory: bool) -> bool {
        // 近い .gitignore ほど優先する
        let mut directory = path.parent();
        while let Some(current) = directory {
            let rules = self
                .per_directory
                .entry(current.to_path_buf())
                .or_insert_with(|| load(current, &current.join(".gitignore")));
            match rules.matched(path, is_directory) {
                Match::Ignore(_) => return true,
                Match::Whitelist(_) => return false,
                Match::None => {}
            }
            if current == repo_root {
                break;
            }
            directory = current.parent();
        }
        match self.exclude.matched(path, is_directory) {
            Match::Ignore(_) => true,
            Match::Whitelist(_) => false,
            Match::None => self.global.matched(path, is_directory).is_ignore(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn repo(name: &str, gitignore: &str) -> PathBuf {
        let root = fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("mira-ignore-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".gitignore"), gitignore).unwrap();
        root
    }

    #[test]
    fn ignored_folders_cover_everything_below_them() {
        let root = repo("dirs", "target/\n*.log\n");
        fs::create_dir_all(root.join("target/debug/deps")).unwrap();
        let mut rules = IgnoreRules::new(&root);

        assert!(rules.is_ignored(&root.join("target")));
        assert!(rules.is_ignored(&root.join("target/debug/deps/a.rlib")));
        assert!(rules.is_ignored(&root.join("debug.log")));
        assert!(!rules.is_ignored(&root.join("src/main.rs")));
        assert!(!rules.is_ignored(&root.join(".gitignore")));
    }

    #[test]
    fn nested_gitignore_applies_only_below_itself_and_can_reinclude() {
        let root = repo("nested", "*.gen\n");
        fs::create_dir_all(root.join("pkg")).unwrap();
        fs::write(root.join("pkg/.gitignore"), "out/\n!keep.gen\n").unwrap();
        let mut rules = IgnoreRules::new(&root);

        assert!(rules.is_ignored(&root.join("pkg/out/a.js")));
        assert!(!rules.is_ignored(&root.join("out/a.js")));
        assert!(rules.is_ignored(&root.join("pkg/other.gen")));
        assert!(!rules.is_ignored(&root.join("pkg/keep.gen")));
    }

    #[test]
    fn opened_subfolder_still_follows_the_repository_rules() {
        let root = repo("sub", "dist/\n");
        fs::create_dir_all(root.join("apps/web/dist")).unwrap();
        let mut rules = IgnoreRules::new(&root.join("apps/web"));
        assert!(rules.is_ignored(&root.join("apps/web/dist/a.js")));
    }

    #[test]
    fn outside_a_repository_gitignore_has_no_effect() {
        let root = repo("norepo", "dist/\n");
        fs::remove_dir_all(root.join(".git")).unwrap();
        let mut rules = IgnoreRules::new(&root);
        assert!(!rules.is_ignored(&root.join("dist/a.js")));
    }

    #[test]
    fn clearing_the_cache_picks_up_gitignore_edits() {
        let root = repo("edit", "");
        let mut rules = IgnoreRules::new(&root);
        assert!(!rules.is_ignored(&root.join("a.tmp")));

        fs::write(root.join(".gitignore"), "*.tmp\n").unwrap();
        rules.clear_cache();
        assert!(rules.is_ignored(&root.join("a.tmp")));
    }
}
