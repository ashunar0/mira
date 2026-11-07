import { useEffect, useRef } from "react";
import { type OpenLocation, startTypeScriptClient } from "./typescriptClient";

/** 開いたフォルダで言語サーバーを動かす。別のファイルの定義へ飛ぶときは openLocation を呼ぶ */
export function useLanguageServer(root: string | null, openLocation: OpenLocation) {
  const openLocationRef = useRef(openLocation);
  openLocationRef.current = openLocation;

  useEffect(() => {
    if (!root) return;
    const client = startTypeScriptClient(root, (path, position) => openLocationRef.current(path, position));
    return client.dispose;
  }, [root]);
}
