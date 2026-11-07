//! 言語サーバーを起動し、標準入出力の JSON-RPC をフロントエンドとの間で中継する。
//! メッセージの中身は解釈しない。LSP のやりとりはフロントエンドが受け持つ。

use std::{
    env,
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    thread,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

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

struct Server {
    /// フォルダを開き直すと新しいサーバーに替わる。前のサーバーの遅れて届いたメッセージを捨てるための番号
    generation: u64,
    child: Child,
    stdin: ChildStdin,
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// 動いている言語サーバー。いまは TypeScript の 1 つだけ
#[derive(Default)]
pub struct LanguageServer {
    server: Mutex<Option<Server>>,
    generations: AtomicU64,
}

#[derive(Clone, Serialize)]
struct ServerMessage {
    generation: u64,
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

/// root で言語サーバーを起動し直す。返した番号を lsp_send に渡す
#[tauri::command(async)]
pub fn lsp_start(app: AppHandle, state: State<'_, LanguageServer>, root: String) -> Result<u64, String> {
    // 前のサーバーは、新しいものを起動する前に止める
    state.server.lock().unwrap().take();

    let mut child = Command::new("typescript-language-server")
        .arg("--stdio")
        .current_dir(&root)
        .env("PATH", login_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Unable to start typescript-language-server: {error}"))?;
    let stdin = child.stdin.take().ok_or("No stdin")?;
    let stdout = child.stdout.take().ok_or("No stdout")?;
    let generation = state.generations.fetch_add(1, Ordering::Relaxed) + 1;

    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        while let Some(message) = read_message(&mut reader) {
            let _ = app.emit("lsp-message", ServerMessage { generation, message });
        }
        let _ = app.emit("lsp-exit", generation);
    });

    *state.server.lock().unwrap() = Some(Server { generation, child, stdin });
    Ok(generation)
}

/// 止まったサーバーや、入れ替わった前のサーバー宛てのメッセージは捨てる
#[tauri::command]
pub fn lsp_send(state: State<'_, LanguageServer>, generation: u64, message: String) {
    let mut server = state.server.lock().unwrap();
    if let Some(server) = server.as_mut().filter(|server| server.generation == generation) {
        let _ = write_message(&mut server.stdin, &message);
    }
}

/// 入れ替わった後に届いた、前のサーバーへの停止は無視する
#[tauri::command]
pub fn lsp_stop(state: State<'_, LanguageServer>, generation: u64) {
    let mut server = state.server.lock().unwrap();
    if server.as_ref().is_some_and(|server| server.generation == generation) {
        server.take();
    }
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
    fn ignores_other_headers() {
        let raw = "Content-Type: application/vscode-jsonrpc\r\ncontent-length: 2\r\n\r\n{}";
        let mut reader = BufReader::new(raw.as_bytes());
        assert_eq!(read_message(&mut reader).as_deref(), Some("{}"));
    }
}
