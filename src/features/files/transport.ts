import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DirEntry, FileChanges, FileContent, SaveFileRequest } from "./type";

export function readDirectory(path: string): Promise<DirEntry[]> {
  return invoke("read_directory", { path });
}

export function listWorkspaceFiles(root: string): Promise<string[]> {
  return invoke("list_workspace_files", { root });
}

export function readTextFile(path: string): Promise<FileContent> {
  return invoke("read_text_file", { path });
}

export function watchWorkspace(root: string): Promise<void> {
  return invoke("watch_workspace", { root });
}

/** 購読を解除する関数を返す。登録が終わる前に解除されても漏れない */
export function listenFileChanges(handler: (changes: FileChanges) => void): () => void {
  const unlisten = listen<FileChanges>("files-changed", (event) => handler(event.payload));
  return () => {
    void unlisten.then((stop) => stop());
  };
}

/** 保存後の mtime を返す */
export function writeTextFile(request: SaveFileRequest): Promise<number> {
  return invoke("write_text_file", request);
}
