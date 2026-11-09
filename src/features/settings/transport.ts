import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SettingsPaths, SettingsTexts } from "./type";

/** 設定ファイルの場所。ホームフォルダが分からなければ null */
export function settingsPaths(): Promise<SettingsPaths> {
  return invoke("settings_paths");
}

/** 設定ファイルの中身。読めないものは空 */
export function readSettings(): Promise<SettingsTexts> {
  return invoke("read_settings");
}

/** 購読を解除する関数を返す。登録が終わる前に解除されても漏れない */
export function listenSettingsChanges(handler: () => void): () => void {
  const unlisten = listen("settings-changed", () => handler());
  return () => {
    void unlisten.then((stop) => stop());
  };
}
