import type { GitFileState, GitFileStatus } from "../type";

// フォルダの中に複数の状態があれば、先にあるものをフォルダの色にする
const FOLDER_PRIORITY: GitFileState[] = ["conflicted", "modified", "deleted", "added", "renamed", "untracked"];

/** root より下、path より上のフォルダ */
function foldersAbove(root: string, path: string): string[] {
  const folders: string[] = [];
  let folder = path.slice(0, path.lastIndexOf("/"));
  while (folder.startsWith(`${root}/`)) {
    folders.push(folder);
    folder = folder.slice(0, folder.lastIndexOf("/"));
  }
  return folders;
}

/** パスごとの状態。フォルダには中のファイルの状態を伝える */
export function toGitDecorations(root: string, files: GitFileStatus[]): Map<string, GitFileState> {
  const decorations = new Map<string, GitFileState>();
  for (const { path, state } of files) {
    decorations.set(path, state);
    for (const folder of foldersAbove(root, path)) {
      const current = decorations.get(folder);
      if (!current || FOLDER_PRIORITY.indexOf(state) < FOLDER_PRIORITY.indexOf(current)) {
        decorations.set(folder, state);
      }
    }
  }
  return decorations;
}
