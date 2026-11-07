import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { fileKeys } from "./keys";
import { toDirectoryListing } from "./lib/directoryListing";
import { readDirectory, readTextFile } from "./transport";

export function useDirectoryQuery(path: string) {
  return useQuery({
    queryKey: fileKeys.directory(path),
    queryFn: async () => toDirectoryListing(await readDirectory(path)),
  });
}

/** 開いた後の内容は Monaco のモデルが持つので、キャッシュには残さない */
export function useFileReader() {
  const queryClient = useQueryClient();
  return useCallback(
    (path: string) =>
      queryClient.fetchQuery({
        queryKey: fileKeys.content(path),
        queryFn: () => readTextFile(path),
        staleTime: 0,
        gcTime: 0,
      }),
    [queryClient],
  );
}

export function useRefreshDirectories() {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["files", "directory"] }),
    [queryClient],
  );
}
