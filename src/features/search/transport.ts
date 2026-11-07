import { invoke } from "@tauri-apps/api/core";
import type { SearchOptions, SearchResults } from "./type";

/** 正規表現が読めないと、その説明の文字列で失敗する */
export function searchWorkspace(root: string, query: string, options: SearchOptions): Promise<SearchResults> {
  return invoke("search_workspace", { root, query, options });
}
