import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fileKeys } from "./keys";
import { parentPath } from "./lib/path";
import { writeTextFile } from "./transport";

export function useSaveFileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: writeTextFile,
    onSuccess: (_mtimeMs, { path }) => {
      // 外部で消されたファイルは保存で作り直されるので、親の一覧も読み直す
      void queryClient.invalidateQueries({ queryKey: fileKeys.directory(parentPath(path)) });
    },
  });
}
