use std::{
    fs,
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex,
    },
};

use ignore::WalkState;
use regex::{Regex, RegexBuilder};
use serde::Serialize;

use crate::files::workspace_walk;

/// 候補が多すぎても画面が固まらないよう、件数に上限を設ける
const MAX_MATCHES: usize = 2_000;
/// ロックファイルや生成物に時間を取られないよう、大きなファイルは調べない
const MAX_SEARCH_FILE_BYTES: u64 = 5 * 1024 * 1024;
const BINARY_SNIFF_BYTES: usize = 8 * 1024;
const PREVIEW_CHARS_BEFORE_MATCH: usize = 30;
const PREVIEW_CHARS_AFTER_MATCH: usize = 200;

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    /// 1 始まり
    line: usize,
    /// 1 始まり。Monaco と同じく UTF-16 で数える
    column: usize,
    length: usize,
    /// 一覧に出す行。長い行は一致した場所の周りだけ切り出す
    preview: String,
    /// preview の中で一致した場所。UTF-16 で数える
    preview_column: usize,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchFile {
    path: String,
    matches: Vec<SearchMatch>,
}

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResults {
    files: Vec<SearchFile>,
    is_truncated: bool,
}

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

fn to_match(line_number: usize, line: &str, start: usize, end: usize) -> SearchMatch {
    let before = &line[..start];
    let found = &line[start..end];
    let after = &line[end..];

    let before_chars = before.chars().count();
    let kept_before = if before_chars > PREVIEW_CHARS_BEFORE_MATCH {
        let skipped = before_chars - PREVIEW_CHARS_BEFORE_MATCH;
        format!("…{}", before.chars().skip(skipped).collect::<String>())
    } else {
        before.trim_start().to_owned()
    };
    let kept_after: String = after.chars().take(PREVIEW_CHARS_AFTER_MATCH).collect();

    SearchMatch {
        line: line_number,
        column: utf16_len(before) + 1,
        length: utf16_len(found),
        preview_column: utf16_len(&kept_before),
        preview: format!("{kept_before}{found}{kept_after}"),
    }
}

/// 見つけるたびに remaining を減らし、0 になったら打ち切る。ほかのスレッドと共有する
fn search_text(text: &str, pattern: &Regex, remaining: &AtomicUsize) -> Vec<SearchMatch> {
    let mut matches = Vec::new();
    // 一致がないファイルが大半なので、行に分ける前に確かめる
    if !pattern.is_match(text) {
        return matches;
    }
    for (index, line) in text.split('\n').enumerate() {
        let line = line.strip_suffix('\r').unwrap_or(line);
        for found in pattern.find_iter(line) {
            let took = remaining.try_update(Ordering::Relaxed, Ordering::Relaxed, |n| n.checked_sub(1));
            if took.is_err() {
                return matches;
            }
            matches.push(to_match(index + 1, line, found.start(), found.end()));
        }
    }
    matches
}

/// エディタで開けるテキストだけを読む。読めないものは検索の対象にしない
fn read_searchable(path: &Path) -> Option<String> {
    if fs::metadata(path).ok()?.len() > MAX_SEARCH_FILE_BYTES {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    let sniff_len = bytes.len().min(BINARY_SNIFF_BYTES);
    if bytes[..sniff_len].contains(&0) {
        return None;
    }
    let text = String::from_utf8(bytes).ok()?;
    Some(text.strip_prefix('\u{FEFF}').map(str::to_owned).unwrap_or(text))
}

/// 大文字小文字を区別せず、query をそのままの文字列として探す。保存済みの内容が対象。
/// ファイルは並行して読むので、結果はパスの順に並べ直す。
#[tauri::command(async)]
pub fn search_workspace(root: String, query: String) -> SearchResults {
    if query.is_empty() {
        return SearchResults::default();
    }
    let Ok(pattern) = RegexBuilder::new(&regex::escape(&query)).case_insensitive(true).build() else {
        return SearchResults::default();
    };

    let files = Mutex::new(Vec::new());
    let remaining = AtomicUsize::new(MAX_MATCHES);
    workspace_walk(&root).build_parallel().run(|| {
        Box::new(|entry| {
            if remaining.load(Ordering::Relaxed) == 0 {
                return WalkState::Quit;
            }
            let Ok(entry) = entry else {
                return WalkState::Continue;
            };
            if !entry.file_type().is_some_and(|kind| kind.is_file()) {
                return WalkState::Continue;
            }
            if let Some(text) = read_searchable(entry.path()) {
                let matches = search_text(&text, &pattern, &remaining);
                if !matches.is_empty() {
                    files.lock().unwrap().push(SearchFile {
                        path: entry.path().to_string_lossy().into_owned(),
                        matches,
                    });
                }
            }
            WalkState::Continue
        })
    });

    let mut files = files.into_inner().unwrap();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    SearchResults {
        files,
        is_truncated: remaining.load(Ordering::Relaxed) == 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("mira-search-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".git")).unwrap();
        root
    }

    fn search(root: &Path, query: &str) -> SearchResults {
        search_workspace(root.to_string_lossy().into_owned(), query.to_owned())
    }

    fn pattern(query: &str) -> Regex {
        RegexBuilder::new(&regex::escape(query)).case_insensitive(true).build().unwrap()
    }

    #[test]
    fn finds_every_match_ignoring_case_and_reports_positions() {
        let remaining = AtomicUsize::new(10);
        let matches = search_text("  Foo foo\r\nbar\nfoo", &pattern("foo"), &remaining);
        let positions: Vec<_> = matches.iter().map(|m| (m.line, m.column, m.length)).collect();
        assert_eq!(positions, [(1, 3, 3), (1, 7, 3), (3, 1, 3)]);
        assert_eq!(matches[0].preview, "Foo foo");
        assert_eq!(matches[0].preview_column, 0);
        assert_eq!(remaining.load(Ordering::Relaxed), 7);
    }

    #[test]
    fn positions_are_counted_in_utf16_like_monaco() {
        let remaining = AtomicUsize::new(10);
        let matches = search_text("日本語😀 関数 end", &pattern("関数"), &remaining);
        // 😀 は UTF-16 で 2 単位
        assert_eq!(matches[0].column, 7);
        assert_eq!(matches[0].length, 2);
        assert_eq!(matches[0].preview_column, 6);
    }

    #[test]
    fn query_is_a_plain_string_not_a_regex() {
        let remaining = AtomicUsize::new(10);
        assert!(search_text("abc", &pattern("a.c"), &remaining).is_empty());
        assert_eq!(search_text("a.c", &pattern("a.c"), &remaining).len(), 1);
    }

    #[test]
    fn long_lines_are_cut_around_the_match() {
        let line = format!("{}needle{}", "x".repeat(1000), "y".repeat(1000));
        let remaining = AtomicUsize::new(10);
        let matches = search_text(&line, &pattern("needle"), &remaining);
        let found = &matches[0];
        assert_eq!(found.column, 1001);
        assert_eq!(found.preview.chars().count(), 1 + 30 + 6 + 200);
        assert_eq!(&found.preview[found.preview.find('n').unwrap()..][..6], "needle");
        assert_eq!(found.preview_column, 31);
    }

    #[test]
    fn follows_gitignore_and_skips_binary_excluded_and_huge_files() {
        let root = temp_root("walk");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("dist")).unwrap();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join(".gitignore"), "dist\n").unwrap();
        fs::write(root.join("src/a.ts"), "needle\n").unwrap();
        fs::write(root.join(".env.example"), "needle\n").unwrap();
        fs::write(root.join("dist/out.js"), "needle\n").unwrap();
        fs::write(root.join("node_modules/pkg/index.js"), "needle\n").unwrap();
        fs::write(root.join(".git/config"), "needle\n").unwrap();
        fs::write(root.join("bin.dat"), b"needle\0").unwrap();
        fs::write(root.join("latin1.txt"), b"needle caf\xE9").unwrap();
        fs::write(root.join("huge.txt"), "needle\n".repeat(1024 * 1024)).unwrap();

        let results = search(&root, "needle");
        let names: Vec<_> = results
            .files
            .iter()
            .map(|file| file.path.strip_prefix(&format!("{}/", root.display())).unwrap())
            .collect();
        assert_eq!(names, [".env.example", "src/a.ts"]);
        assert!(!results.is_truncated);
    }

    #[test]
    fn stops_at_the_limit_and_says_so() {
        let root = temp_root("limit");
        fs::write(root.join("a.txt"), "x\n".repeat(MAX_MATCHES)).unwrap();
        fs::write(root.join("b.txt"), "x\n").unwrap();

        let results = search(&root, "x");
        let total: usize = results.files.iter().map(|file| file.matches.len()).sum();
        // どのファイルの結果が残るかは、並行して読む順番で変わる
        assert_eq!(total, MAX_MATCHES);
        assert!(results.is_truncated);
    }

    #[test]
    fn an_empty_query_finds_nothing() {
        let root = temp_root("empty");
        fs::write(root.join("a.txt"), "x").unwrap();
        assert_eq!(search(&root, ""), SearchResults::default());
    }
}
