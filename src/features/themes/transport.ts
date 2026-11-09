import { invoke } from "@tauri-apps/api/core";
import type { ColorThemeEntry } from "./type";

export function listColorThemes(): Promise<ColorThemeEntry[]> {
  return invoke("list_color_themes");
}

/** テーマのファイルの中身。JSON 以外と読めないものは失敗する */
export function readThemeFile(path: string): Promise<string> {
  return invoke("read_theme_file", { path });
}
