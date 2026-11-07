import { invoke } from "@tauri-apps/api/core";
import type { GitFileStatus } from "./type";

export function gitStatus(root: string): Promise<GitFileStatus[]> {
  return invoke("git_status", { root });
}

/** 最後のコミット時点の内容。そのコミットになければ null */
export function gitHeadText(path: string): Promise<string | null> {
  return invoke("git_head_text", { path });
}
