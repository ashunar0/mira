import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { fileKeys } from "./keys";
import { parentPath } from "./lib/path";
import { listenFileChanges, watchWorkspace } from "./transport";
import type { FileChanges } from "./type";

/** フォルダの外部変更を監視し、一覧を読み直す。開いているファイルの扱いは onChange に任せる */
export function useWorkspaceWatcher(root: string | null, onChange: (changes: FileChanges) => void) {
  const queryClient = useQueryClient();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!root) return;
    const stopListening = listenFileChanges((changes) => {
      if (changes.needsRescan) {
        void queryClient.invalidateQueries({ queryKey: fileKeys.all });
      } else {
        const parents = new Set(changes.paths.map(parentPath));
        for (const parent of parents) {
          void queryClient.invalidateQueries({ queryKey: fileKeys.directory(parent) });
        }
        void queryClient.invalidateQueries({ queryKey: fileKeys.workspaceFiles(root) });
      }
      onChangeRef.current(changes);
    });
    // 監視できなくても編集はできるし、保存時の衝突確認は別に働くので、作業は止めない
    watchWorkspace(root).catch((error: unknown) => console.error(error));
    return stopListening;
  }, [queryClient, root]);
}
