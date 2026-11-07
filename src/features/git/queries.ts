import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { gitKeys } from "./keys";
import { toGitDecorations } from "./lib/decorations";
import { gitStatus } from "./transport";
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

export function useRefreshGitStatus() {
  const queryClient = useQueryClient();
  return useCallback(() => queryClient.invalidateQueries({ queryKey: gitKeys.all }), [queryClient]);
}
