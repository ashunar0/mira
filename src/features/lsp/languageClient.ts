import { monaco } from "../../infrastructure/monaco/setup";
import { ensureLanguages } from "../../infrastructure/monaco/syntaxHighlighting";
import { semanticStyleIndex, semanticTokenLegend } from "../../infrastructure/monaco/semanticTokenStyles";
import { LanguageServerConnection } from "./connection";
import { kindContains } from "./lib/codeActionKinds";
import type { LanguageServerDefinition } from "./lib/serverDefinitions";
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
type TextEdit = { range: Range; newText: string };
type WorkspaceEdit = {
  changes?: Record<string, TextEdit[]>;
  documentChanges?: ({ textDocument: { uri: string }; edits: TextEdit[] } | { kind: string })[];
};
type Command = { title: string; command: string; arguments?: unknown[] };
type CodeAction = { title: string; kind?: string; edit?: WorkspaceEdit; command?: Command; disabled?: unknown; data?: unknown };

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
 * サーバーの「種類と修飾」を、Mira が決めた色（semanticTokenLegend）に置き換える。
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

/** 1 回の操作として当て、元に戻すで当てる前に戻れるようにする */
function applyTextEdits(model: monaco.editor.ITextModel, edits: TextEdit[]): void {
  if (edits.length === 0) return;
  model.pushStackElement();
  model.pushEditOperations([], edits.map((edit) => ({ range: toMonacoRange(edit.range), text: edit.newText })), () => null);
  model.pushStackElement();
}

/**
 * サーバーから届いた書き換えを、開いているファイルに当てる。開いていないファイルの書き換えとファイルの作成・削除は
 * まだ扱わない（保存時のコードアクションは、そのファイルの中で済むため）。全部当てられたら true
 */
function applyWorkspaceEdit(edit: WorkspaceEdit): boolean {
  const byUri: [string, TextEdit[]][] = [
    ...Object.entries(edit.changes ?? {}),
    ...(edit.documentChanges ?? []).flatMap((change): [string, TextEdit[]][] =>
      "textDocument" in change ? [[change.textDocument.uri, change.edits]] : [],
    ),
  ];
  let applied = (edit.documentChanges ?? []).every((change) => "textDocument" in change);
  for (const [uri, edits] of byUri) {
    const model = monaco.editor.getModel(monaco.Uri.parse(uriKey(uri)));
    if (model) applyTextEdits(model, edits);
    else applied = false;
  }
  return applied;
}

/** 打っている間は聞かず、止まってから型エラーを聞き直す */
const DIAGNOSTICS_DELAY_MS = 300;

export type LanguageClient = {
  dispose: () => void;
  notifyFileChanges: (changes: WatchedFileChanges) => void;
  /** 設定が変わったと伝える。サーバーは workspace/configuration で聞き直す */
  notifyConfigurationChange: () => void;
  /** editor.defaultFormatter と照らす ID */
  formatterId: string | null;
  /** このファイルを整形できるか（サーバーが動いていて、整形に応じ、このファイルを受け持つ） */
  canFormat: (model: monaco.editor.ITextModel) => boolean;
  /** 整形して、結果をモデルに当てる（元に戻せる）。待つ間にモデルが変わったか、取りやめたら当てない */
  format: (model: monaco.editor.ITextModel, signal: AbortSignal) => Promise<void>;
  /** kind のコードアクション（source.fixAll など）をファイル全体に当てる。excludes の種類は除く */
  runCodeActions: (model: monaco.editor.ITextModel, kind: string, excludes: string[], signal: AbortSignal) => Promise<void>;
};

/**
 * root で言語サーバーを動かし、型エラー・定義へジャンプ・ホバー・意味に基づく色分け・整形を Monaco に足す。
 * TypeScript について、Monaco 組み込みの同じ機能は setup で止めてある。サーバーを起動できなければ、これらは出ない。
 * サーバーから設定を聞かれたら getConfiguration で答える（VS Code の vscode-languageclient と同じく、設定の同じ名前の所）
 */
export function startLanguageClient(
  config: LanguageServerDefinition,
  root: string,
  getConfiguration: (section: string | undefined) => unknown,
): LanguageClient {
  const markerOwner = `lsp.${config.name}`;
  let canServerFormat = false;
  let codeActionSupport: { resolve: boolean } | null = null;
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
    // サーバーがなくても色は付くよう、先に言語を登録する
    const monacoLanguages = config.monacoLanguages ?? (await ensureLanguages(config.languageIds));
    if (isDisposed) return;
    const started = await startLanguageServer(config.spec, root);
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
        if (method === "workspace/configuration") {
          return (params as { items: { section?: string }[] }).items.map((item) => getConfiguration(item.section) ?? null);
        }
        if (method === "workspace/applyEdit") return { applied: applyWorkspaceEdit((params as { edit: WorkspaceEdit }).edit) };
        if (method === "workspace/diagnostic/refresh") refreshDiagnostics();
        if (method === "workspace/semanticTokens/refresh") semanticTokensChanged.fire();
        // ファイルの監視の登録（client/registerCapability）は受けるだけ。変更はフォルダの監視から全部伝える
        return null;
      },
    });
    const rootUri = monaco.Uri.file(root).toString();
    stopListening = listenLanguageServer(started, (text) => server.receive(text), shutdown);

    const { capabilities } = await server.request<{
      capabilities: {
        semanticTokensProvider?: { legend: SemanticTokensLegend };
        diagnosticProvider?: unknown;
        documentFormattingProvider?: unknown;
        codeActionProvider?: boolean | { resolveProvider?: boolean };
      };
    }>("initialize", {
      processId: null,
      rootUri,
      initializationOptions: config.initializationOptions,
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
          formatting: { dynamicRegistration: false },
          codeAction: {
            codeActionLiteralSupport: {
              codeActionKind: { valueSet: ["", "quickfix", "refactor", "source", "source.organizeImports", "source.fixAll"] },
            },
            dataSupport: true,
            resolveSupport: { properties: ["edit"] },
          },
        },
        workspace: {
          configuration: true,
          didChangeConfiguration: { dynamicRegistration: false },
          applyEdit: true,
          workspaceEdit: { documentChanges: true },
          workspaceFolders: true,
          didChangeWatchedFiles: { dynamicRegistration: true },
          diagnostics: { refreshSupport: true },
          semanticTokens: { refreshSupport: true },
        },
      },
    });
    if (isDisposed) return;
    canPullDiagnostics = capabilities.diagnosticProvider !== undefined;
    canServerFormat = Boolean(capabilities.documentFormattingProvider);
    const codeActionProvider = capabilities.codeActionProvider;
    codeActionSupport = codeActionProvider
      ? { resolve: typeof codeActionProvider === "object" && codeActionProvider.resolveProvider === true }
      : null;
    server.notify("initialized", {});
    connection = server;
    for (const model of monaco.editor.getModels()) openDocument(server, model);
    disposables.push(
      monaco.editor.onDidCreateModel((model) => openDocument(server, model)),
      monaco.editor.onWillDisposeModel((model) => {
        if (!syncedModels.delete(model)) return;
        server.notify("textDocument/didClose", { textDocument: { uri: model.uri.toString() } });
      }),
      monaco.languages.registerHoverProvider(monacoLanguages, {
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
      monaco.languages.registerDefinitionProvider(monacoLanguages, {
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
      monaco.languages.registerDocumentSemanticTokensProvider(monacoLanguages, {
        onDidChange: semanticTokensChanged.event,
        getLegend: () => ({ tokenTypes: semanticTokenLegend(), tokenModifiers: [] }),
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
    formatterId: config.formatterId,
    canFormat: (model) => connection !== null && canServerFormat && syncedModels.has(model),
    format: async (model, signal) => {
      const server = connection;
      if (!server || !syncedModels.has(model)) return;
      const version = model.getVersionId();
      const { tabSize, insertSpaces } = model.getOptions();
      const edits = await server.request<TextEdit[] | null>("textDocument/formatting", {
        textDocument: { uri: model.uri.toString() },
        options: { tabSize, insertSpaces },
      });
      if (!edits?.length || signal.aborted || model.isDisposed() || model.getVersionId() !== version) return;
      applyTextEdits(model, edits);
    },
    runCodeActions: async (model, kind, excludes, signal) => {
      const server = connection;
      if (!server || !codeActionSupport || !syncedModels.has(model)) return;
      const lastLine = model.getLineCount();
      const found = await server.request<(CodeAction | Command)[] | null>("textDocument/codeAction", {
        textDocument: { uri: model.uri.toString() },
        range: { start: { line: 0, character: 0 }, end: toPosition({ lineNumber: lastLine, column: model.getLineMaxColumn(lastLine) }) },
        // 保存時なので自動（2）。VS Code と同じく、型エラーは渡さない
        context: { diagnostics: [], only: [kind], triggerKind: 2 },
      });
      // VS Code と同じく、種類が合うものだけ。種類のないもの（コマンドだけのもの）や、使えないとされたものは除く
      const actions = (found ?? []).filter(
        (action): action is CodeAction =>
          typeof action.command !== "string" &&
          "kind" in action &&
          action.kind !== undefined &&
          kindContains(kind, action.kind) &&
          !excludes.some((exclude) => kindContains(exclude, action.kind!)) &&
          !action.disabled,
      );
      for (const candidate of actions) {
        if (signal.aborted || model.isDisposed()) return;
        let action = candidate;
        if (!action.edit && action.data !== undefined && codeActionSupport.resolve) {
          action = await server.request<CodeAction>("codeAction/resolve", action);
          if (signal.aborted || model.isDisposed()) return;
        }
        if (action.edit) applyWorkspaceEdit(action.edit);
        if (action.command) {
          await server.request("workspace/executeCommand", { command: action.command.command, arguments: action.command.arguments });
        }
      }
    },
    notifyConfigurationChange: () => {
      connection?.notify("workspace/didChangeConfiguration", { settings: null });
    },
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
