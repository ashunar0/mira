import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

type ServerMessage = { id: number; message: string };

/** root で言語サーバーを起動する。返る番号でやりとりし、使い終わったら stopLanguageServer で止める */
export function startLanguageServer(root: string): Promise<number> {
  return invoke("lsp_start", { root });
}

export function sendToLanguageServer(id: number, message: string): Promise<void> {
  return invoke("lsp_send", { id, message });
}

export function stopLanguageServer(id: number): Promise<void> {
  return invoke("lsp_stop", { id });
}

/** id のサーバーからのメッセージと終了を受け取る。購読を解除する関数を返す */
export function listenLanguageServer(id: number, onMessage: (message: string) => void, onExit: () => void): () => void {
  const unlisten = Promise.all([
    listen<ServerMessage>("lsp-message", ({ payload }) => {
      if (payload.id === id) onMessage(payload.message);
    }),
    listen<number>("lsp-exit", ({ payload }) => {
      if (payload === id) onExit();
    }),
  ]);
  return () => {
    void unlisten.then((stops) => {
      for (const stop of stops) stop();
    });
  };
}
