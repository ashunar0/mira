import { invoke } from "@tauri-apps/api/core";
import type { DirEntry, FileContent, SaveFileRequest } from "./type";

export function readDirectory(path: string): Promise<DirEntry[]> {
  return invoke("read_directory", { path });
}

export function readTextFile(path: string): Promise<FileContent> {
  return invoke("read_text_file", { path });
}

/** 保存後の mtime を返す */
export function writeTextFile(request: SaveFileRequest): Promise<number> {
  return invoke("write_text_file", request);
}
