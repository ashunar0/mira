import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type ServerMessage = { generation: number; message: string };

/** root で言語サーバーを起動し直す。返る番号で、どのサーバーとのやりとりかを見分ける */
export function startLanguageServer(root: string): Promise<number> {
  return invoke("lsp_start", { root });
}

export function sendToLanguageServer(generation: number, message: string): Promise<void> {
  return invoke("lsp_send", { generation, message });
}

export function stopLanguageServer(generation: number): Promise<void> {
  return invoke("lsp_stop", { generation });
}

/** generation のサーバーからのメッセージと終了を受け取る。購読を解除する関数を返す */
export function listenLanguageServer(
  generation: number,
  onMessage: (message: string) => void,
  onExit: () => void,
): () => void {
  const unlisten = Promise.all([
    listen<ServerMessage>("lsp-message", ({ payload }) => {
      if (payload.generation === generation) onMessage(payload.message);
    }),
    listen<number>("lsp-exit", ({ payload }) => {
      if (payload === generation) onExit();
    }),
  ]);
  return () => {
    void unlisten.then((stops) => {
      for (const stop of stops) stop();
    });
  };
}
