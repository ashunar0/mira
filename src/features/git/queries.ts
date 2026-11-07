import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { gitKeys } from "./keys";
import { toGitDecorations } from "./lib/decorations";
import { gitHeadText, gitStatus } from "./transport";
import type { GitFileStatus } from "./type";

export function useGitDecorationsQuery(root: string | null) {
  const select = useCallback((files: GitFileStatus[]) => toGitDecorations(root ?? "", files), [root]);
  return useQuery({
    queryKey: gitKeys.status(root ?? ""),
    queryFn: () => gitStatus(root!),
    enabled: root !== null,
    select,
  });
}

export function useHeadTextQuery(path: string | null) {
  return useQuery({
    queryKey: gitKeys.headText(path ?? ""),
    queryFn: () => gitHeadText(path!),
    enabled: path !== null,
  });
}

export function useRefreshGitStatus() {
  const queryClient = useQueryClient();
  return useCallback(() => queryClient.invalidateQueries({ queryKey: gitKeys.all }), [queryClient]);
}
