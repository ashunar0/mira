//! 言語サーバー（TypeScript 7 と rust-analyzer、設定の mira.languageServers に書いたもの）を起動し、標準入出力の JSON-RPC をフロントエンドとの間で中継する。
//! メッセージの中身は解釈しない。LSP のやりとりはフロントエンドが受け持つ。

use std::{
    collections::HashMap,
    env,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    thread,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

const PATH_MARKER: &str = "__MIRA_PATH__";

/// Dock や open から起動したアプリにはターミナルの PATH が渡らないので、ログインシェルに聞く。
/// 聞けなければ自分の PATH を使う。
fn login_path() -> &'static str {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        let shell = env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_owned());
        // .zshrc の出力に紛れないよう、目印で挟んで取り出す
        let script = format!("printf '{PATH_MARKER}%s{PATH_MARKER}' \"$PATH\"");
        Command::new(shell)
            .args(["-ilc", &script])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()
            .and_then(|output| {
                let text = String::from_utf8_lossy(&output.stdout);
                let start = text.find(PATH_MARKER)? + PATH_MARKER.len();
                let end = start + text[start..].find(PATH_MARKER)?;
                Some(text[start..end].to_owned())
            })
            .filter(|path| !path.is_empty())
            .unwrap_or_else(|| env::var("PATH").unwrap_or_default())
    })
}

/// npm でグローバルに入れた TypeScript 7 の実行ファイル。VS Code が同梱の版を使うのと同じく、
/// フォルダの node_modules の版は使わない（開いただけでそのリポジトリのコードを動かさないため）。
fn global_typescript(path: &str) -> Option<&'static Path> {
    static TSC: OnceLock<Option<PathBuf>> = OnceLock::new();
    TSC.get_or_init(|| {
        let output = Command::new("npm").args(["root", "-g"]).env("PATH", path).output().ok()?;
        let root = String::from_utf8(output.stdout).ok()?;
        let arch = match env::consts::ARCH {
            "aarch64" => "arm64",
            "x86_64" => "x64",
            other => other,
        };
        // 本体は OS ごとのパッケージに入っている。npm の入れ方によって置き場所が 2 通りある
        let package = format!("@typescript/typescript-darwin-{arch}/lib/tsc");
        let root = Path::new(root.trim());
        [root.join("typescript/node_modules").join(&package), root.join(&package)]
            .into_iter()
            .find(|file| file.is_file())
    })
    .as_deref()
}

struct Server {
    child: Child,
    stdin: ChildStdin,
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// 動いている言語サーバー。起動したクライアントが番号で持ち、自分のものだけを止める。
/// 「最新の 1 つだけを残す」作りにしないのは、起動が重なると終わる順番が呼んだ順と限らないため
#[derive(Default)]
pub struct LanguageServers {
    servers: Mutex<HashMap<u64, Server>>,
    next_id: AtomicU64,
}

#[derive(Clone, Serialize)]
struct ServerMessage {
    id: u64,
    message: String,
}

/// Content-Length のヘッダーで区切られたメッセージを 1 つ読む。終わりに来たら None
fn read_message(reader: &mut impl BufRead) -> Option<String> {
    let mut length = None;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header).ok()? == 0 {
            return None;
        }
        let header = header.trim_end();
        if header.is_empty() {
            break;
        }
        if let Some((name, value)) = header.split_once(':') {
            if name.eq_ignore_ascii_case("content-length") {
                length = value.trim().parse::<usize>().ok();
            }
        }
    }
    let mut body = vec![0; length?];
    reader.read_exact(&mut body).ok()?;
    String::from_utf8(body).ok()
}

fn write_message(writer: &mut impl Write, message: &str) -> std::io::Result<()> {
    write!(writer, "Content-Length: {}\r\n\r\n{message}", message.len())?;
    writer.flush()
}

/// Mira が動かす言語サーバー
/// フロントエンドからは "typescript"、"rust"、{ "custom": { "command": [...], "rootMarkers": [...] } } で届く
#[derive(Clone, Debug, PartialEq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerSpec {
    /// Mira に組み込んだもの
    TypeScript,
    Rust,
    /// 設定に書いたもの。command の先頭が実行ファイルで、ログインシェルの PATH で探す
    #[serde(rename_all = "camelCase")]
    Custom { command: Vec<String>, root_markers: Vec<String> },
}

/// 直下か 1 段下に name があるか。VS Code の rust-analyzer 拡張機能が Cargo.toml を探すのと同じ範囲
fn has_marker(root: &Path, name: &str) -> bool {
    root.join(name).exists()
        || root.read_dir().is_ok_and(|entries| entries.flatten().any(|entry| entry.path().join(name).exists()))
}

fn has_cargo_manifest(root: &Path) -> bool {
    has_marker(root, "Cargo.toml")
}

/// 起動するコマンド。そのフォルダで動かさない言語なら None
fn server_command(spec: ServerSpec, root: &Path) -> Result<Option<Command>, String> {
    let path = login_path();
    match spec {
        ServerSpec::TypeScript => {
            let tsc = global_typescript(path).ok_or("TypeScript 7 is not installed. Run: npm i -g typescript@7")?;
            let mut command = Command::new(tsc);
            command.args(["--lsp", "--stdio"]);
            Ok(Some(command))
        }
        ServerSpec::Rust => {
            if !has_cargo_manifest(root) {
                return Ok(None);
            }
            // rustup の rust-analyzer。フォルダの rust-toolchain.toml の版を使う。
            // cargo check を走らせるので、子にもログインシェルの PATH を渡す（コマンドもこの PATH で探す）
            let mut command = Command::new("rust-analyzer");
            command.env("PATH", path);
            Ok(Some(command))
        }
        ServerSpec::Custom { command, root_markers } => {
            if !root_markers.is_empty() && !root_markers.iter().any(|marker| has_marker(root, marker)) {
                return Ok(None);
            }
            let (program, args) = command.split_first().ok_or("mira.languageServers: command is empty")?;
            let mut command = Command::new(program);
            command.args(args).env("PATH", path);
            Ok(Some(command))
        }
    }
}

/// root で言語サーバーを起動する。返した番号を lsp_send と lsp_stop に渡す。そのフォルダで動かさない言語なら None
#[tauri::command(async)]
pub fn lsp_start(
    app: AppHandle,
    state: State<'_, LanguageServers>,
    root: String,
    server: ServerSpec,
) -> Result<Option<u64>, String> {
    let Some(mut command) = server_command(server, Path::new(&root))? else {
        return Ok(None);
    };
    let mut child = command
        .current_dir(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Unable to start the language server {:?}: {error}", command.get_program()))?;
    let stdin = child.stdin.take().ok_or("No stdin")?;
    let stdout = child.stdout.take().ok_or("No stdout")?;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;

    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        while let Some(message) = read_message(&mut reader) {
            let _ = app.emit("lsp-message", ServerMessage { id, message });
        }
        let _ = app.emit("lsp-exit", id);
    });

    state.servers.lock().unwrap().insert(id, Server { child, stdin });
    Ok(Some(id))
}

/// 止まったサーバー宛てのメッセージは捨てる
#[tauri::command]
pub fn lsp_send(state: State<'_, LanguageServers>, id: u64, message: String) {
    if let Some(server) = state.servers.lock().unwrap().get_mut(&id) {
        let _ = write_message(&mut server.stdin, &message);
    }
}

#[tauri::command]
pub fn lsp_stop(state: State<'_, LanguageServers>, id: u64) {
    state.servers.lock().unwrap().remove(&id);
}

/// 画面を読み込み直すと、前の画面のクライアントは後片付けをせずに消える。持ち主のいないサーバーを止める
pub fn stop_all(app: &AppHandle) {
    app.state::<LanguageServers>().servers.lock().unwrap().clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_messages_split_by_content_length() {
        let mut buffer = Vec::new();
        write_message(&mut buffer, r#"{"id":1}"#).unwrap();
        write_message(&mut buffer, "{\"text\":\"日本語\"}").unwrap();
        let mut reader = BufReader::new(buffer.as_slice());
        assert_eq!(read_message(&mut reader).as_deref(), Some(r#"{"id":1}"#));
        // 長さはバイトで数える
        assert_eq!(read_message(&mut reader).as_deref(), Some("{\"text\":\"日本語\"}"));
        assert_eq!(read_message(&mut reader), None);
    }

    #[test]
    fn finds_cargo_manifest_at_the_root_or_one_level_down() {
        let root = std::env::temp_dir().join(format!("mira-lsp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("app/src")).unwrap();
        assert!(!has_cargo_manifest(&root));
        std::fs::write(root.join("app/src/Cargo.toml"), "").unwrap();
        assert!(!has_cargo_manifest(&root), "2 段下は見ない");
        std::fs::write(root.join("app/Cargo.toml"), "").unwrap();
        assert!(has_cargo_manifest(&root));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn specs_arrive_in_the_shape_the_frontend_sends() {
        let parse = |json: &str| serde_json::from_str::<ServerSpec>(json).unwrap();
        assert_eq!(parse(r#""typescript""#), ServerSpec::TypeScript);
        assert_eq!(parse(r#""rust""#), ServerSpec::Rust);
        assert_eq!(
            parse(r#"{"custom": {"command": ["a", "b"], "rootMarkers": ["c"]}}"#),
            ServerSpec::Custom { command: vec!["a".into(), "b".into()], root_markers: vec!["c".into()] }
        );
    }

    #[test]
    fn custom_servers_start_only_where_a_marker_is() {
        let root = std::env::temp_dir().join(format!("mira-lsp-custom-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("web")).unwrap();
        let spec = |markers: &[&str]| ServerSpec::Custom {
            command: vec!["echo".into(), "--stdio".into()],
            root_markers: markers.iter().map(|m| m.to_string()).collect(),
        };
        assert!(server_command(spec(&["package.json"]), &root).unwrap().is_none());
        std::fs::write(root.join("web/package.json"), "{}").unwrap();
        let command = server_command(spec(&["package.json"]), &root).unwrap().unwrap();
        assert_eq!(command.get_program(), "echo");
        assert_eq!(command.get_args().collect::<Vec<_>>(), ["--stdio"]);
        assert!(server_command(spec(&[]), &root).unwrap().is_some(), "目印がなければどこでも動かす");
        assert!(server_command(ServerSpec::Custom { command: vec![], root_markers: vec![] }, &root).is_err());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn ignores_other_headers() {
        let raw = "Content-Type: application/vscode-jsonrpc\r\ncontent-length: 2\r\n\r\n{}";
        let mut reader = BufReader::new(raw.as_bytes());
        assert_eq!(read_message(&mut reader).as_deref(), Some("{}"));
    }
}
