import { invoke } from "@tauri-apps/api/core";
import type { GitFileStatus } from "./type";

export function gitStatus(root: string): Promise<GitFileStatus[]> {
  return invoke("git_status", { root });
}
