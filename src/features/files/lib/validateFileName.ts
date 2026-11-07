import type { DirEntry } from "../type";

/** 問題があればメッセージを返す。a/b.ts のように途中のフォルダを含む名前は許す */
export function validateFileName(
  name: string,
  siblings: DirEntry[] = [],
  currentName?: string,
): string | null {
  if (!name) return "A file or folder name must be provided.";
  if (name.startsWith("/")) return "A file or folder name cannot start with a slash.";
  const segments = name.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return "The name is not valid as a file or folder name.";
  }
  if (segments.some((segment) => segment !== segment.trim())) {
    return "Leading or trailing whitespace detected in file or folder name.";
  }
  // macOS は大文字小文字を区別しないので、a.ts → A.ts のような変更だけは同じものとして許す
  const lower = name.toLowerCase();
  const isSelf = currentName?.toLowerCase() === lower;
  if (!isSelf && siblings.some((entry) => entry.name.toLowerCase() === lower)) {
    return `A file or folder ${name} already exists at this location. Please choose a different name.`;
  }
  return null;
}
