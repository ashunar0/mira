import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColorThemeData } from "../../infrastructure/monaco/theme";
import { themeKeys } from "./keys";
import { loadColorTheme } from "./lib/themeFile";
import { listColorThemes, readThemeFile } from "./transport";

/**
 * workbench.colorTheme のテーマ。読み終わるまでは undefined、見つからない・読めないときは null
 * （VS Code をアンインストールした、テーマの拡張機能を消した、など）
 */
export function useColorThemeQuery(settingsId: string | null): ColorThemeData | null | undefined {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: themeKeys.theme(settingsId ?? ""),
    queryFn: async () => {
      const themes = await queryClient.fetchQuery({ queryKey: themeKeys.list, queryFn: listColorThemes, staleTime: Infinity });
      const entry = themes.find((theme) => theme.settingsId === settingsId);
      if (!entry) return null;
      try {
        return await loadColorTheme(entry.path, entry.uiTheme, readThemeFile);
      } catch (error) {
        console.error(error);
        return null;
      }
    },
    enabled: settingsId !== null,
    staleTime: Infinity,
  });
  return settingsId === null ? null : data;
}
