import { Menu } from "@tauri-apps/api/menu";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { revealItemInDir } from "@tauri-apps/plugin-opener";

export type ContextMenuEntry = { label: string; run: () => void } | "separator";

/** OS のコンテキストメニューをカーソルの位置に出す */
export async function showContextMenu(entries: ContextMenuEntry[]): Promise<void> {
  const menu = await Menu.new({
    items: entries.map((entry) =>
      entry === "separator"
        ? { item: "Separator" as const }
        : { text: entry.label, action: entry.run },
    ),
  });
  await menu.popup();
}

export function copyText(text: string): Promise<void> {
  return writeText(text);
}

export function revealInFinder(path: string): Promise<void> {
  return revealItemInDir(path);
}
