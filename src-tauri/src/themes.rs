//! VS Code のテーマを探す。インストール済みの拡張機能（~/.vscode/extensions）と、VS Code 本体に入っているもの
//! （Dark Modern など）の package.json の contributes.themes を読む。テーマのファイルの中身はフロントエンドが読む。

use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

const VSCODE_BUILTIN_EXTENSIONS: &str = "/Applications/Visual Studio Code.app/Contents/Resources/app/extensions";

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorThemeEntry {
    /// workbench.colorTheme に書く名前。VS Code と同じく id、なければ label
    settings_id: String,
    /// vs / vs-dark / hc-black / hc-light
    ui_theme: Option<String>,
    path: String,
}

#[derive(Deserialize)]
struct Manifest {
    contributes: Option<Contributes>,
}

#[derive(Deserialize)]
struct Contributes {
    #[serde(default)]
    themes: Vec<ThemeContribution>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThemeContribution {
    id: Option<String>,
    label: Option<String>,
    ui_theme: Option<String>,
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstalledExtension {
    relative_location: Option<String>,
}

/// VS Code が使っている拡張機能のフォルダ。extensions.json に載っているものだけ（古い版や消したものは残っていることがある）
fn installed_extension_dirs(root: &Path) -> Vec<PathBuf> {
    let listed: Option<Vec<InstalledExtension>> =
        fs::read_to_string(root.join("extensions.json")).ok().and_then(|text| serde_json::from_str(&text).ok());
    match listed {
        Some(extensions) => extensions
            .into_iter()
            .filter_map(|extension| extension.relative_location)
            .map(|location| root.join(location))
            .collect(),
        // 一覧がなければ、フォルダをすべて見る
        None => subdirs(root),
    }
}

fn subdirs(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(root) else { return Vec::new() };
    let mut dirs: Vec<PathBuf> = entries.flatten().map(|entry| entry.path()).filter(|path| path.is_dir()).collect();
    dirs.sort();
    dirs
}

fn themes_in(extension_dir: &Path) -> Vec<ColorThemeEntry> {
    let Some(manifest) = fs::read_to_string(extension_dir.join("package.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Manifest>(&text).ok())
    else {
        return Vec::new();
    };
    let themes = manifest.contributes.map(|contributes| contributes.themes).unwrap_or_default();
    themes
        .into_iter()
        .filter_map(|theme| {
            let settings_id = theme.id.or(theme.label)?;
            let path = extension_dir.join(&theme.path);
            Some(ColorThemeEntry { settings_id, ui_theme: theme.ui_theme, path: path.to_string_lossy().into_owned() })
        })
        .collect()
}

/// 先に見つかったものを使う。インストールした拡張機能を、VS Code 本体のものより先に並べる
fn collect(roots: &[(PathBuf, bool)]) -> Vec<ColorThemeEntry> {
    let mut found: Vec<ColorThemeEntry> = Vec::new();
    for (root, is_installed) in roots {
        let dirs = if *is_installed { installed_extension_dirs(root) } else { subdirs(root) };
        for theme in dirs.iter().flat_map(|dir| themes_in(dir)) {
            if !found.iter().any(|existing| existing.settings_id == theme.settings_id) {
                found.push(theme);
            }
        }
    }
    found
}

#[tauri::command(async)]
pub fn list_color_themes() -> Vec<ColorThemeEntry> {
    let mut roots = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        roots.push((Path::new(&home).join(".vscode/extensions"), true));
    }
    roots.push((PathBuf::from(VSCODE_BUILTIN_EXTENSIONS), false));
    collect(&roots)
}

/// テーマのファイル（include や tokenColors の先も）。JSON だけ（tmTheme には未対応）
#[tauri::command(async)]
pub fn read_theme_file(path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    if path.extension().is_none_or(|extension| extension != "json") {
        return Err(format!("only JSON theme files are supported: {}", path.display()));
    }
    fs::read_to_string(&path).map_err(|error| format!("{}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mira-themes-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_extension(root: &Path, name: &str, themes: &str) {
        fs::create_dir_all(root.join(name)).unwrap();
        fs::write(root.join(name).join("package.json"), format!(r#"{{"contributes": {{"themes": {themes}}}}}"#)).unwrap();
    }

    #[test]
    fn uses_the_id_or_else_the_label_and_skips_unlisted_versions() {
        let root = temp_dir("installed");
        write_extension(&root, "a.theme-1.0.0", r#"[{"label": "Old", "path": "./old.json"}]"#);
        write_extension(
            &root,
            "a.theme-2.0.0",
            r#"[{"label": "Night", "uiTheme": "vs-dark", "path": "./night.json"}, {"id": "Day", "label": "%day%", "path": "./day.json"}]"#,
        );
        fs::write(root.join("extensions.json"), r#"[{"relativeLocation": "a.theme-2.0.0"}]"#).unwrap();

        let themes = collect(&[(root.clone(), true)]);
        let ids: Vec<&str> = themes.iter().map(|theme| theme.settings_id.as_str()).collect();
        assert_eq!(ids, ["Night", "Day"]);
        assert_eq!(themes[0].ui_theme.as_deref(), Some("vs-dark"));
        assert!(themes[0].path.ends_with("a.theme-2.0.0/./night.json"), "{}", themes[0].path);
    }

    #[test]
    fn installed_themes_win_over_builtin_ones() {
        let installed = temp_dir("first");
        let builtin = temp_dir("second");
        write_extension(&installed, "x", r#"[{"label": "Same", "path": "./mine.json"}]"#);
        write_extension(&builtin, "y", r#"[{"label": "Same", "path": "./builtin.json"}, {"label": "Other", "path": "./o.json"}]"#);

        let themes = collect(&[(installed, true), (builtin, false)]);
        assert_eq!(themes.len(), 2);
        assert!(themes[0].path.ends_with("mine.json"));
    }

    #[test]
    fn refuses_files_that_are_not_json() {
        assert!(read_theme_file("/etc/hosts".into()).is_err());
    }
}
