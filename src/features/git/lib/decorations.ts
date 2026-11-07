import { ancestorsWithin } from "../../files/lib/path";
import type { GitFileState, GitFileStatus } from "../type";

// フォルダの中に複数の状態があれば、先にあるものをフォルダの色にする
const FOLDER_PRIORITY: GitFileState[] = ["conflicted", "modified", "deleted", "added", "renamed", "untracked"];

/** パスごとの状態。フォルダには中のファイルの状態を伝える */
export function toGitDecorations(root: string, files: GitFileStatus[]): Map<string, GitFileState> {
  const decorations = new Map<string, GitFileState>();
  for (const { path, state } of files) {
    decorations.set(path, state);
    for (const folder of ancestorsWithin(root, path)) {
      const current = decorations.get(folder);
      if (!current || FOLDER_PRIORITY.indexOf(state) < FOLDER_PRIORITY.indexOf(current)) {
        decorations.set(folder, state);
      }
    }
  }
  return decorations;
}
