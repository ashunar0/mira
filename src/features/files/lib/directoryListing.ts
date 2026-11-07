import type { DirEntry } from "../type";

// VS Code の files.exclude の既定値
const EXCLUDED_NAMES = new Set([".git", ".svn", ".hg", ".jj", ".DS_Store", "Thumbs.db"]);

// VS Code の compareFileNamesDefault と同じく、数字を数値として比べる（file2 < file10）
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** VS Code の Explorer の既定の並び: 除外を消し、フォルダを先に、名前の自然順で */
export function toDirectoryListing(entries: DirEntry[]): DirEntry[] {
  return entries
    .filter((entry) => !EXCLUDED_NAMES.has(entry.name))
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return collator.compare(a.name, b.name);
    });
}
