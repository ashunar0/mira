import { useCallback, useEffect, useRef } from "react";
import { type OpenLocation, startTypeScriptClient, type WatchedFileChanges } from "./typescriptClient";

/**
 * 開いたフォルダで言語サーバーを動かす。別のファイルの定義へ飛ぶときは openLocation を呼ぶ。
 * 返す関数に、フォルダの監視で分かった変更を渡す
 */
export function useLanguageServer(root: string | null, openLocation: OpenLocation) {
  const openLocationRef = useRef(openLocation);
  openLocationRef.current = openLocation;
  const clientRef = useRef<ReturnType<typeof startTypeScriptClient> | null>(null);

  useEffect(() => {
    if (!root) return;
    const client = startTypeScriptClient(root, (path, position) => openLocationRef.current(path, position));
    clientRef.current = client;
    return () => {
      clientRef.current = null;
      client.dispose();
    };
  }, [root]);

  return useCallback((changes: WatchedFileChanges) => clientRef.current?.notifyFileChanges(changes), []);
}
