import { useCallback, useEffect, useRef } from "react";
import { monaco } from "../../infrastructure/monaco/setup";
import { type LanguageClient, startLanguageClient, type WatchedFileChanges } from "./languageClient";
import { codeActionsOnSave } from "./lib/codeActionKinds";
import type { LanguageServerDefinition } from "./lib/serverDefinitions";

/** 定義へ飛ぶ先。行と列は 1 始まり */
export type OpenLocation = (path: string, position: { line: number; column: number }) => void;

/**
 * 保存時の整形とコードアクションを、1 段ごとに待つ長さ。VS Code は 60 秒待つ（files.participants.timeout）が、進み具合や取り消しの表示があってのこと。
 * Mira にはそれがないので、整形が返らなくても保存が止まって見えないよう短くする
 */
const SAVE_STEP_TIMEOUT_MS = 3000;

/** 時間切れの後に結果が届いても、保存した後の内容を書き換えないよう捨てる。失敗しても保存は続ける */
async function withTimeout(run: (signal: AbortSignal) => Promise<void>): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, SAVE_STEP_TIMEOUT_MS)));
  try {
    await Promise.race([run(controller.signal), timeout]);
  } catch (error) {
    console.warn(error);
  } finally {
    controller.abort();
    clearTimeout(timer);
  }
}

/**
 * 開いたフォルダで言語サーバーを動かす。別のファイルの定義へ飛ぶときは openLocation を呼ぶ。
 * サーバーから設定を聞かれたら getConfiguration で答える。servers のうち、足されたり変わったりしたものだけ起動し直す
 */
export function useLanguageServer(
  root: string | null,
  servers: LanguageServerDefinition[],
  getConfiguration: (section: string | undefined) => unknown,
  openLocation: OpenLocation,
) {
  const openLocationRef = useRef(openLocation);
  openLocationRef.current = openLocation;
  const getConfigurationRef = useRef(getConfiguration);
  getConfigurationRef.current = getConfiguration;
  /** 動いているクライアント。定義の中身（JSON）ごとに持ち、変わったものだけ起動し直す */
  const clientsRef = useRef(new Map<string, LanguageClient>());
  const definitions = new Map(servers.map((server) => [JSON.stringify(server), server]));
  // 設定を読み直すたびに別の配列になるので、中身で比べる
  const serversKey = [...definitions.keys()].join("\n");
  const definitionsRef = useRef(definitions);
  definitionsRef.current = definitions;

  useEffect(() => {
    if (!root) return;
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
    const clients = clientsRef.current;
    return () => {
      for (const client of clients.values()) client.dispose();
      clients.clear();
      opener.dispose();
    };
  }, [root]);

  useEffect(() => {
    if (!root) return;
    const clients = clientsRef.current;
    for (const [key, client] of clients) {
      if (definitionsRef.current.has(key)) continue;
      client.dispose();
      clients.delete(key);
    }
    for (const [key, server] of definitionsRef.current) {
      if (clients.has(key)) continue;
      clients.set(key, startLanguageClient(server, root, (section) => getConfigurationRef.current(section)));
    }
  }, [root, serversKey]);

  const notifyFileChanges = useCallback((changes: WatchedFileChanges) => {
    for (const client of clientsRef.current.values()) client.notifyFileChanges(changes);
  }, []);

  const notifyConfigurationChange = useCallback(() => {
    for (const client of clientsRef.current.values()) client.notifyConfigurationChange();
  }, []);

  /**
   * VS Code と同じ手順（formatActionsMultiple.ts の _analyzeFormatter）で整形の担当を決めて整形する。
   * defaultFormatter が書いてあれば、その担当がこのファイルを整形できるときだけ。書いていなければ、整形できるものが
   * 1 つだけのときだけ。どちらでもなければ整形しない（VS Code は通知を出すだけで、整形せずに保存する）
   */
  const formatDocument = useCallback(async (model: monaco.editor.ITextModel, defaultFormatter: string | null) => {
    const candidates = [...clientsRef.current.values()].filter((client) => client.canFormat(model));
    const chosen = defaultFormatter
      ? candidates.find((client) => client.formatterId?.toLowerCase() === defaultFormatter.toLowerCase())
      : candidates.length === 1
        ? candidates[0]
        : undefined;
    if (!chosen) return;
    await withTimeout((signal) => chosen.format(model, signal));
  }, []);

  /**
   * 保存時のコードアクション（editor.codeActionsOnSave）。種類ごとに、ファイルを受け持つサーバーすべてに聞いて当てる
   * （VS Code と同じく、整形の担当のように 1 つに絞らない）。種類ごとに待つ長さは整形と同じ
   */
  const runCodeActionsOnSave = useCallback(async (model: monaco.editor.ITextModel, setting: unknown) => {
    const { kinds, excludes } = codeActionsOnSave(setting);
    for (const kind of kinds) {
      for (const client of clientsRef.current.values()) {
        await withTimeout((signal) => client.runCodeActions(model, kind, excludes, signal));
      }
    }
  }, []);

  return { notifyFileChanges, notifyConfigurationChange, formatDocument, runCodeActionsOnSave };
}
