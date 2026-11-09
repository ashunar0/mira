import { monaco } from "../../infrastructure/monaco/setup";
import { SEMANTIC_TOKEN_LEGEND, semanticStyleIndex } from "../../infrastructure/monaco/semanticTokenStyles";
import { LanguageServerConnection } from "./connection";
import { listenLanguageServer, sendToLanguageServer, startLanguageServer, stopLanguageServer } from "./transport";

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

/** Mira が動かす言語サーバー（src-tauri の lsp.rs と同じ名前） */
export type ServerKind = "typescript" | "rust";

type ServerConfig = {
  /** Monaco の言語。.tsx と .jsx は色の付け方のために別の言語にしてある（syntaxHighlighting） */
  monacoLanguages: string[];
  /** 拡張子ごとの、サーバーに伝える言語。ほかのファイルは渡さない */
  languageIds: Record<string, string>;
  /**
   * 外で書き換えられたファイルも、保存したと伝える。rust-analyzer は保存で cargo check を走らせ、
   * 型エラーの多くはその結果で届く。VS Code は Mira の中で保存したときだけ伝えるが、Mira は AI が外で
   * 書き換える前提なので、伝えないと型エラーが古いまま残る
   */
  saveOnExternalChange: boolean;
};

const SERVERS: Record<ServerKind, ServerConfig> = {
  typescript: {
    monacoLanguages: ["typescript", "tsx", "javascript", "jsx"],
    languageIds: {
      ts: "typescript",
      mts: "typescript",
      cts: "typescript",
      tsx: "typescriptreact",
      js: "javascript",
      mjs: "javascript",
      cjs: "javascript",
      jsx: "javascriptreact",
    },
    saveOnExternalChange: false,
  },
  rust: { monacoLanguages: ["rust"], languageIds: { rs: "rust" }, saveOnExternalChange: true },
};

const extensionOf = (path: string) => /\.([^./]+)$/.exec(path)?.[1];

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

/** 意味に基づく色分けで、サーバーに伝える種類と修飾（LSP の標準のもの） */
const SEMANTIC_TOKEN_TYPES = [
  "namespace", "type", "class", "enum", "interface", "struct", "typeParameter", "parameter", "variable", "property",
  "enumMember", "event", "function", "method", "macro", "keyword", "modifier", "comment", "string", "number",
  "regexp", "operator", "decorator",
];
const SEMANTIC_TOKEN_MODIFIERS = [
  "declaration", "definition", "readonly", "static", "deprecated", "abstract", "async", "modification",
  "documentation", "defaultLibrary",
];

type SemanticTokensLegend = { tokenTypes: string[]; tokenModifiers: string[] };

/**
 * サーバーの「種類と修飾」を、Mira が決めた色（SEMANTIC_TOKEN_LEGEND）に置き換える。
 * 色を変えないものは外すので、位置は相対で数え直す
 */
function toStyledTokens(data: number[], legend: SemanticTokensLegend, languageId: string): Uint32Array {
  const styled: number[] = [];
  let line = 0;
  let character = 0;
  let previousLine = 0;
  let previousCharacter = 0;
  for (let i = 0; i < data.length; i += 5) {
    line += data[i];
    character = data[i] === 0 ? character + data[i + 1] : data[i + 1];
    const modifiers = legend.tokenModifiers.filter((_, bit) => data[i + 4] & (1 << bit));
    const style = semanticStyleIndex(legend.tokenTypes[data[i + 3]], modifiers, languageId);
    if (style === null) continue;
    const deltaLine = line - previousLine;
    styled.push(deltaLine, deltaLine === 0 ? character - previousCharacter : character, data[i + 2], style, 0);
    previousLine = line;
    previousCharacter = character;
  }
  return new Uint32Array(styled);
}

/** 打っている間は聞かず、止まってから型エラーを聞き直す */
const DIAGNOSTICS_DELAY_MS = 300;

/**
 * root で言語サーバーを動かし、型エラー・定義へジャンプ・ホバー・意味に基づく色分けを Monaco に足す。
 * TypeScript について、Monaco 組み込みの同じ機能は setup で止めてある。サーバーを起動できなければ、これらは出ない。
 */
export function startLanguageClient(
  kind: ServerKind,
  root: string,
): { dispose: () => void; notifyFileChanges: (changes: WatchedFileChanges) => void } {
  const config = SERVERS[kind];
  const markerOwner = kind;
  /** 拡張子で決める。ほかのファイルは渡さない */
  const languageIdOf = (uri: monaco.Uri): string | null => {
    if (uri.scheme !== "file") return null;
    const extension = extensionOf(uri.path);
    return (extension && config.languageIds[extension]) ?? null;
  };
  const disposables: monaco.IDisposable[] = [];
  /**
   * 型エラーは、エディタから聞く（pull）ものと、サーバーから届く（push）ものを分けて持ち、合わせて出す。
   * rust-analyzer は自分で見つけたものを pull で、cargo check の結果を push で返す
   */
  const pulledDiagnostics = new Map<string, Diagnostic[]>();
  const pushedDiagnostics = new Map<string, Diagnostic[]>();
  const resultIds = new Map<string, string>();
  const syncedModels = new Set<monaco.editor.ITextModel>();
  let stopListening: (() => void) | null = null;
  let connection: LanguageServerConnection | null = null;
  let serverId: number | null = null;
  let diagnosticsTimer: ReturnType<typeof setTimeout> | undefined;
  /** 開いていないファイルが変わると、開いているファイルの色分けも変わりうる。Monaco に聞き直してもらう */
  const semanticTokensChanged = new monaco.Emitter<void>();
  let isDisposed = false;

  const applyMarkers = (model: monaco.editor.ITextModel) => {
    const uri = model.uri.toString();
    const found = [...(pulledDiagnostics.get(uri) ?? []), ...(pushedDiagnostics.get(uri) ?? [])];
    monaco.editor.setModelMarkers(model, markerOwner, found.map(toMarker));
  };
  /** サーバーが pull に応じるか。initialize の答えで決まる */
  let canPullDiagnostics = false;

  /** ほかのファイルの変更でも型エラーは変わるので、開いているファイルをすべて聞き直す */
  const refreshDiagnostics = () => {
    clearTimeout(diagnosticsTimer);
    diagnosticsTimer = setTimeout(() => {
      const server = connection;
      if (!server || !canPullDiagnostics) return;
      for (const model of syncedModels) {
        const uri = model.uri.toString();
        server
          .request<DocumentDiagnosticReport>("textDocument/diagnostic", {
            textDocument: { uri },
            previousResultId: resultIds.get(uri),
          })
          .then((report) => {
            if (report.resultId) resultIds.set(uri, report.resultId);
            if (report.kind === "full") pulledDiagnostics.set(uri, report.items);
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
    semanticTokensChanged.dispose();
    monaco.editor.removeAllMarkers(markerOwner);
  };

  const start = async () => {
    const started = await startLanguageServer(kind, root);
    // このフォルダでは動かさない言語
    if (started === null) return;
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
        pushedDiagnostics.set(key, found);
        const model = monaco.editor.getModel(monaco.Uri.parse(key));
        if (model) applyMarkers(model);
      },
      onRequest: (method, params) => {
        if (method === "workspace/configuration") return (params as { items: unknown[] }).items.map(() => null);
        if (method === "workspace/diagnostic/refresh") refreshDiagnostics();
        if (method === "workspace/semanticTokens/refresh") semanticTokensChanged.fire();
        // ファイルの監視の登録（client/registerCapability）は受けるだけ。変更はフォルダの監視から全部伝える
        return null;
      },
    });
    const rootUri = monaco.Uri.file(root).toString();
    stopListening = listenLanguageServer(started, (text) => server.receive(text), shutdown);

    const { capabilities } = await server.request<{
      capabilities: { semanticTokensProvider?: { legend: SemanticTokensLegend }; diagnosticProvider?: unknown };
    }>("initialize", {
      processId: null,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: root.slice(root.lastIndexOf("/") + 1) }],
      capabilities: {
        textDocument: {
          synchronization: { didSave: false },
          hover: { contentFormat: ["markdown", "plaintext"] },
          definition: { linkSupport: true },
          semanticTokens: {
            requests: { full: true },
            tokenTypes: SEMANTIC_TOKEN_TYPES,
            tokenModifiers: SEMANTIC_TOKEN_MODIFIERS,
            formats: ["relative"],
          },
          diagnostic: { dynamicRegistration: false },
          publishDiagnostics: { tagSupport: { valueSet: [1, 2] } },
        },
        workspace: {
          configuration: true,
          workspaceFolders: true,
          didChangeWatchedFiles: { dynamicRegistration: true },
          diagnostics: { refreshSupport: true },
          semanticTokens: { refreshSupport: true },
        },
      },
    });
    if (isDisposed) return;
    canPullDiagnostics = capabilities.diagnosticProvider !== undefined;
    server.notify("initialized", {});
    connection = server;
    for (const model of monaco.editor.getModels()) openDocument(server, model);
    disposables.push(
      monaco.editor.onDidCreateModel((model) => openDocument(server, model)),
      monaco.editor.onWillDisposeModel((model) => {
        if (!syncedModels.delete(model)) return;
        server.notify("textDocument/didClose", { textDocument: { uri: model.uri.toString() } });
      }),
      monaco.languages.registerHoverProvider(config.monacoLanguages, {
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
      monaco.languages.registerDefinitionProvider(config.monacoLanguages, {
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
      monaco.languages.registerDocumentSemanticTokensProvider(config.monacoLanguages, {
        onDidChange: semanticTokensChanged.event,
        getLegend: () => ({ tokenTypes: SEMANTIC_TOKEN_LEGEND, tokenModifiers: [] }),
        provideDocumentSemanticTokens: async (model) => {
          const legend = capabilities.semanticTokensProvider?.legend;
          const languageId = languageIdOf(model.uri);
          if (!legend || !languageId || !syncedModels.has(model)) return null;
          const result = await server.request<{ data: number[] } | null>("textDocument/semanticTokens/full", {
            textDocument: { uri: model.uri.toString() },
          });
          return result && { data: toStyledTokens(result.data, legend, languageId) };
        },
        releaseDocumentSemanticTokens: () => {},
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
      if (config.saveOnExternalChange) {
        // cargo check はフォルダ全体を見るので、1 つ伝えれば足りる。何度も伝えると、そのたびにやり直す
        const saved = paths.find((path) => !gone.has(path) && languageIdOf(monaco.Uri.file(path)) !== null);
        if (saved) server.notify("textDocument/didSave", { textDocument: { uri: monaco.Uri.file(saved).toString() } });
      }
      refreshDiagnostics();
      semanticTokensChanged.fire();
    },
    dispose: () => {
      shutdown();
      if (serverId !== null) void stopLanguageServer(serverId);
    },
  };
}
