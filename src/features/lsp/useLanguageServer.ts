import { useCallback, useEffect, useRef } from "react";
import { monaco } from "../../infrastructure/monaco/setup";
import { type ServerKind, startLanguageClient, type WatchedFileChanges } from "./languageClient";

/** 定義へ飛ぶ先。行と列は 1 始まり */
export type OpenLocation = (path: string, position: { line: number; column: number }) => void;

const SERVERS: ServerKind[] = ["typescript", "rust"];

/**
 * 開いたフォルダで言語サーバーを動かす。別のファイルの定義へ飛ぶときは openLocation を呼ぶ。
 * 返す関数に、フォルダの監視で分かった変更を渡す
 */
export function useLanguageServer(root: string | null, openLocation: OpenLocation) {
  const openLocationRef = useRef(openLocation);
  openLocationRef.current = openLocation;
  const clientsRef = useRef<ReturnType<typeof startLanguageClient>[]>([]);

  useEffect(() => {
    if (!root) return;
    const clients = SERVERS.map((kind) => startLanguageClient(kind, root));
    clientsRef.current = clients;
    // 別のファイルの定義は、タブで開いてもらう
    const opener = monaco.editor.registerEditorOpener({
      openCodeEditor: (_source, resource, selectionOrPosition) => {
        if (resource.scheme !== "file") return false;
        const position =
          selectionOrPosition && "startLineNumber" in selectionOrPosition
            ? { line: selectionOrPosition.startLineNumber, column: selectionOrPosition.startColumn }
            : { line: selectionOrPosition?.lineNumber ?? 1, column: selectionOrPosition?.column ?? 1 };
        openLocationRef.current(resource.path, position);
        return true;
      },
    });
    return () => {
      clientsRef.current = [];
      for (const client of clients) client.dispose();
      opener.dispose();
    };
  }, [root]);

  return useCallback((changes: WatchedFileChanges) => {
    for (const client of clientsRef.current) client.notifyFileChanges(changes);
  }, []);
}
