import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { searchKeys } from "./keys";
import { searchWorkspace } from "./transport";

/** 打っている間も、次の結果が出るまでは前の結果を見せる */
export function useSearchQuery(root: string, query: string, isEnabled: boolean) {
  return useQuery({
    queryKey: searchKeys.results(root, query),
    queryFn: () => searchWorkspace(root, query),
    enabled: isEnabled && query !== "",
    placeholderData: keepPreviousData,
  });
}

export function useRefreshSearch() {
  const queryClient = useQueryClient();
  return useCallback(() => queryClient.invalidateQueries({ queryKey: searchKeys.all }), [queryClient]);
}
