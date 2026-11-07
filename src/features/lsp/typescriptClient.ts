import { monaco } from "../../infrastructure/monaco/setup";
import { LanguageServerConnection } from "./connection";
import { listenLanguageServer, sendToLanguageServer, startLanguageServer, stopLanguageServer } from "./transport";

/** 定義へ飛ぶ先。行と列は 1 始まり */
export type OpenLocation = (path: string, position: { line: number; column: number }) => void;

type Position = { line: number; character: number };
type Range = { start: Position; end: Position };
type Diagnostic = {
  range: Range;
  severity?: 1 | 2 | 3 | 4;
  message: string;
  source?: string;
  code?: number | string;
  tags?: (1 | 2)[];
};
type MarkupContent = { kind: string; value: string };
type MarkedString = string | { language: string; value: string };
type Hover = { contents: MarkupContent | MarkedString | MarkedString[]; range?: Range };
type Location = { uri: string; range: Range };
type LocationLink = { targetUri: string; targetSelectionRange: Range; originSelectionRange?: Range };

const MARKER_OWNER = "typescript";
/** Monaco の言語。.tsx も typescript になっている */
const MONACO_LANGUAGES = ["typescript", "javascript"];

/** サーバーに伝える言語は、拡張子で決める。ほかのファイルは渡さない */
function languageIdOf(uri: monaco.Uri): string | null {
  if (uri.scheme !== "file") return null;
  const extension = /\.([^./]+)$/.exec(uri.path)?.[1];
  switch (extension) {
    case "ts":
    case "mts":
    case "cts":
      return "typescript";
    case "tsx":
      return "typescriptreact";
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "jsx":
      return "javascriptreact";
    default:
      return null;
  }
}

const toPosition = (position: monaco.IPosition): Position => ({
  line: position.lineNumber - 1,
  character: position.column - 1,
});

const toMonacoRange = (range: Range): monaco.IRange => ({
  startLineNumber: range.start.line + 1,
  startColumn: range.start.character + 1,
  endLineNumber: range.end.line + 1,
  endColumn: range.end.character + 1,
});

/** サーバーの URI は % の付け方が Monaco と違うことがあるので、Monaco の形に揃えて比べる */
const uriKey = (uri: string) => monaco.Uri.parse(uri).toString();

const SEVERITIES = {
  1: monaco.MarkerSeverity.Error,
  2: monaco.MarkerSeverity.Warning,
  3: monaco.MarkerSeverity.Info,
  4: monaco.MarkerSeverity.Hint,
} as const;

function toMarker(diagnostic: Diagnostic): monaco.editor.IMarkerData {
  return {
    ...toMonacoRange(diagnostic.range),
    severity: SEVERITIES[diagnostic.severity ?? 1],
    message: diagnostic.message,
    source: diagnostic.source,
    code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
    tags: diagnostic.tags?.map((tag) => (tag === 1 ? monaco.MarkerTag.Unnecessary : monaco.MarkerTag.Deprecated)),
  };
}

function toMarkdown(contents: Hover["contents"]): monaco.IMarkdownString[] {
  const items = Array.isArray(contents) ? contents : [contents];
  return items.map((item) => {
    if (typeof item === "string") return { value: item };
    if ("language" in item) return { value: `\`\`\`${item.language}\n${item.value}\n\`\`\`` };
    return { value: item.value };
  });
}

/** フォルダの監視で分かった変更。開いていないファイルの変更は、こちらから伝えないとサーバーは気づかない */
export type WatchedFileChanges = { paths: string[]; removed: string[] };

type DocumentDiagnosticReport = { kind: "full"; resultId?: string; items: Diagnostic[] } | { kind: "unchanged"; resultId: string };

/** 打っている間は聞かず、止まってから型エラーを聞き直す */
const DIAGNOSTICS_DELAY_MS = 300;

/**
 * root で TypeScript 7 の言語サーバーを動かし、型エラー・定義へジャンプ・ホバーを Monaco に足す。
 * Monaco 組み込みの同じ機能は setup で止めてある。サーバーを起動できなければ、これらは出ない。
 */
export function startTypeScriptClient(
  root: string,
  openLocation: OpenLocation,
): { dispose: () => void; notifyFileChanges: (changes: WatchedFileChanges) => void } {
  const disposables: monaco.IDisposable[] = [];
  /** 型エラーは、エディタから聞く（pull）ものと、サーバーから届く（push）ものの両方を同じ形で持つ */
  const diagnostics = new Map<string, Diagnostic[]>();
  const resultIds = new Map<string, string>();
  const syncedModels = new Set<monaco.editor.ITextModel>();
  let stopListening: (() => void) | null = null;
  let connection: LanguageServerConnection | null = null;
  let serverId: number | null = null;
  let diagnosticsTimer: ReturnType<typeof setTimeout> | undefined;
  let isDisposed = false;

  const applyMarkers = (model: monaco.editor.ITextModel) => {
    const found = diagnostics.get(model.uri.toString()) ?? [];
    monaco.editor.setModelMarkers(model, MARKER_OWNER, found.map(toMarker));
  };

  /** ほかのファイルの変更でも型エラーは変わるので、開いているファイルをすべて聞き直す */
  const refreshDiagnostics = () => {
    clearTimeout(diagnosticsTimer);
    diagnosticsTimer = setTimeout(() => {
      const server = connection;
      if (!server) return;
      for (const model of syncedModels) {
        const uri = model.uri.toString();
        server
          .request<DocumentDiagnosticReport>("textDocument/diagnostic", {
            textDocument: { uri },
            previousResultId: resultIds.get(uri),
          })
          .then((report) => {
            if (report.resultId) resultIds.set(uri, report.resultId);
            if (report.kind === "full") diagnostics.set(uri, report.items);
            if (!model.isDisposed()) applyMarkers(model);
          })
          // サーバーが止まった、またはその間に閉じられた
          .catch(() => {});
      }
    }, DIAGNOSTICS_DELAY_MS);
  };

  const openDocument = (server: LanguageServerConnection, model: monaco.editor.ITextModel) => {
    const languageId = languageIdOf(model.uri);
    if (!languageId || syncedModels.has(model)) return;
    syncedModels.add(model);
    const uri = model.uri.toString();
    server.notify("textDocument/didOpen", {
      textDocument: { uri, languageId, version: model.getVersionId(), text: model.getValue() },
    });
    refreshDiagnostics();
    // Monaco の変更は後ろから並んでいるので、そのまま順に当てればよい
    disposables.push(
      model.onDidChangeContent((event) => {
        server.notify("textDocument/didChange", {
          textDocument: { uri, version: model.getVersionId() },
          contentChanges: event.changes.map((change) => ({
            range: {
              start: toPosition({ lineNumber: change.range.startLineNumber, column: change.range.startColumn }),
              end: toPosition({ lineNumber: change.range.endLineNumber, column: change.range.endColumn }),
            },
            text: change.text,
          })),
        });
        refreshDiagnostics();
      }),
    );
  };

  const shutdown = () => {
    if (isDisposed) return;
    isDisposed = true;
    clearTimeout(diagnosticsTimer);
    stopListening?.();
    connection?.close();
    connection = null;
    for (const disposable of disposables) disposable.dispose();
    monaco.editor.removeAllMarkers(MARKER_OWNER);
  };

  const start = async () => {
    const started = await startLanguageServer(root);
    serverId = started;
    // 起動を待つ間に閉じられた
    if (isDisposed) {
      void stopLanguageServer(started);
      return;
    }
    const server = new LanguageServerConnection((text) => void sendToLanguageServer(started, text), {
      onNotification: (method, params) => {
        if (method !== "textDocument/publishDiagnostics") return;
        const { uri, diagnostics: found } = params as { uri: string; diagnostics: Diagnostic[] };
        const key = uriKey(uri);
        diagnostics.set(key, found);
        const model = monaco.editor.getModel(monaco.Uri.parse(key));
        if (model) applyMarkers(model);
      },
      onRequest: (method, params) => {
        if (method === "workspace/configuration") return (params as { items: unknown[] }).items.map(() => null);
        if (method === "workspace/diagnostic/refresh") refreshDiagnostics();
        // ファイルの監視の登録（client/registerCapability）は受けるだけ。変更はフォルダの監視から全部伝える
        return null;
      },
    });
    const rootUri = monaco.Uri.file(root).toString();
    stopListening = listenLanguageServer(started, (text) => server.receive(text), shutdown);

    await server.request("initialize", {
      processId: null,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: root.slice(root.lastIndexOf("/") + 1) }],
      capabilities: {
        textDocument: {
          synchronization: { didSave: false },
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: { linkSupport: true },
          diagnostic: { dynamicRegistration: false },
          publishDiagnostics: { tagSupport: { valueSet: [1, 2] } },
        },
        workspace: {
          configuration: true,
          workspaceFolders: true,
          didChangeWatchedFiles: { dynamicRegistration: true },
          diagnostics: { refreshSupport: true },
        },
      },
    });
    if (isDisposed) return;
    server.notify("initialized", {});
    connection = server;
    for (const model of monaco.editor.getModels()) openDocument(server, model);
    disposables.push(
      monaco.editor.onDidCreateModel((model) => openDocument(server, model)),
      monaco.editor.onWillDisposeModel((model) => {
        if (!syncedModels.delete(model)) return;
        server.notify("textDocument/didClose", { textDocument: { uri: model.uri.toString() } });
      }),
      monaco.languages.registerHoverProvider(MONACO_LANGUAGES, {
        provideHover: async (model, position) => {
          if (!syncedModels.has(model)) return null;
          const hover = await server.request<Hover | null>("textDocument/hover", {
            textDocument: { uri: model.uri.toString() },
            position: toPosition(position),
          });
          if (!hover) return null;
          return { contents: toMarkdown(hover.contents), range: hover.range && toMonacoRange(hover.range) };
        },
      }),
      monaco.languages.registerDefinitionProvider(MONACO_LANGUAGES, {
        provideDefinition: async (model, position) => {
          if (!syncedModels.has(model)) return null;
          const result = await server.request<Location | Location[] | LocationLink[] | null>(
            "textDocument/definition",
            { textDocument: { uri: model.uri.toString() }, position: toPosition(position) },
          );
          const locations = result === null ? [] : Array.isArray(result) ? result : [result];
          return locations.map((location): monaco.languages.LocationLink =>
            "targetUri" in location
              ? {
                  uri: monaco.Uri.parse(location.targetUri),
                  range: toMonacoRange(location.targetSelectionRange),
                  originSelectionRange: location.originSelectionRange && toMonacoRange(location.originSelectionRange),
                }
              : { uri: monaco.Uri.parse(location.uri), range: toMonacoRange(location.range) },
          );
        },
      }),
      // 別のファイルの定義は、タブで開いてもらう
      monaco.editor.registerEditorOpener({
        openCodeEditor: (_source, resource, selectionOrPosition) => {
          if (resource.scheme !== "file") return false;
          const position =
            selectionOrPosition && "startLineNumber" in selectionOrPosition
              ? { line: selectionOrPosition.startLineNumber, column: selectionOrPosition.startColumn }
              : { line: selectionOrPosition?.lineNumber ?? 1, column: selectionOrPosition?.column ?? 1 };
          openLocation(resource.path, position);
          return true;
        },
      }),
    );
  };

  start().catch((error: unknown) => {
    // サーバーがなくても編集はできる
    console.warn(error);
    shutdown();
  });

  return {
    notifyFileChanges: ({ paths, removed }) => {
      const server = connection;
      if (!server || paths.length === 0) return;
      const gone = new Set(removed);
      // 作られたファイルも「変わった」で伝える。「作られた」だと、その後の書き換えを読み直さないため
      server.notify("workspace/didChangeWatchedFiles", {
        changes: paths.map((path) => ({ uri: monaco.Uri.file(path).toString(), type: gone.has(path) ? 3 : 2 })),
      });
      refreshDiagnostics();
    },
    dispose: () => {
      shutdown();
      if (serverId !== null) void stopLanguageServer(serverId);
    },
  };
}
