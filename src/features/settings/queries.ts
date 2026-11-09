import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { settingsKeys } from "./keys";
import { parseSettings } from "./lib/settings";
import { listenSettingsChanges, readSettings, settingsPath } from "./transport";
import type { Settings } from "./type";

const EMPTY: Settings = { values: {}, languageOverrides: [] };

/** 読み終わるまでと読めないときは、何も書いていない設定として扱う */
export function useSettingsQuery(): Settings {
  const { data } = useQuery({
    queryKey: settingsKeys.user,
    queryFn: async () => parseSettings(await readSettings()),
    staleTime: Infinity,
  });
  return data ?? EMPTY;
}

export function useSettingsPathQuery() {
  return useQuery({ queryKey: settingsKeys.path, queryFn: settingsPath, staleTime: Infinity }).data ?? null;
}

/** 設定ファイルが書き換わったら読み直す。開いているタブの扱いは onChange に任せる */
export function useSettingsWatcher(onChange: () => void) {
  const queryClient = useQueryClient();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(
    () =>
      listenSettingsChanges(() => {
        void queryClient.invalidateQueries({ queryKey: settingsKeys.user });
        onChangeRef.current();
      }),
    [queryClient],
  );
}
