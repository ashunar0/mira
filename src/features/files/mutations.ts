import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fileKeys } from "./keys";
import { parentPath } from "./lib/path";
import { createDirectory, createFile, renamePath, trashPath, writeTextFile } from "./transport";

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

/**
 * 監視は .gitignore の対象を通知しないので、自分の操作の分は通知を待たずに読み直す。
 * a/b.ts のように途中のフォルダも作られるので、開いているフォルダ一覧はまとめて読み直す。
 */
function useInvalidateListings() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: fileKeys.directories }),
      queryClient.invalidateQueries({ queryKey: fileKeys.workspace }),
    ]);
}

export function useCreateFileMutation() {
  const invalidate = useInvalidateListings();
  return useMutation({ mutationFn: createFile, onSuccess: invalidate });
}

export function useCreateDirectoryMutation() {
  const invalidate = useInvalidateListings();
  return useMutation({ mutationFn: createDirectory, onSuccess: invalidate });
}

export function useRenamePathMutation() {
  const invalidate = useInvalidateListings();
  return useMutation({ mutationFn: renamePath, onSuccess: invalidate });
}

export function useDeletePathMutation() {
  const invalidate = useInvalidateListings();
  return useMutation({ mutationFn: trashPath, onSuccess: invalidate });
}
