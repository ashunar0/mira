import { invoke } from "@tauri-apps/api/core";
import type { SearchResults } from "./type";

export function searchWorkspace(root: string, query: string): Promise<SearchResults> {
  return invoke("search_workspace", { root, query });
}
